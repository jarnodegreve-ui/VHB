import { test, expect, type Page } from '@playwright/test';

/**
 * Bottom-nav (dock) over de toestel-matrix: van Galaxy Fold dichtgeklapt
 * (280px) tot iPad. Gegroeid uit een echte bug (09-08): met flex-1 zonder
 * min-w-0 duwden brede labels ("Vervaldata"/"Omleidingen") op toestellen
 * ≤375px de "Meer"-tab buiten de kaart — onbereikbare navigatie die op de
 * gangbare testmaten onzichtbaar bleef.
 *
 * Bewaakt per profiel × rol: geen tab buiten de kaart, touch-hoogte ≥44px,
 * geen afgekapte labels op >=340px (daaronder bewust icoon-only, labels sr-only),
 * dock verborgen op ≥768px (daar neemt de sidebar het over).
 */

const SESSION_KEY = 'sb-localhost-auth-token';
const ADMIN = { id: '1', name: 'Admin E2E', role: 'admin', employeeId: 'VHB-000001', email: 'admin@vhb.be', isActive: true, verlofBudget: 20 };
const CHAUFFEUR = { id: '2', name: 'Chauffeur E2E', role: 'chauffeur', employeeId: 'VHB-000002', email: 'c@vhb.be', isActive: true, verlofBudget: 20 };

type Profiel = { naam: string; viewport: { width: number; height: number }; dockVerwacht: boolean };
const PROFIELEN: Profiel[] = [
  { naam: 'Galaxy Fold dicht (280)', viewport: { width: 280, height: 653 }, dockVerwacht: true },
  { naam: 'iPhone 5-SE1 (320)', viewport: { width: 320, height: 568 }, dockVerwacht: true },
  { naam: 'iPhone SE2-3 (375)', viewport: { width: 375, height: 667 }, dockVerwacht: true },
  { naam: 'iPhone 13-14 (390)', viewport: { width: 390, height: 844 }, dockVerwacht: true },
  { naam: 'Pixel 7 (412)', viewport: { width: 412, height: 915 }, dockVerwacht: true },
  { naam: 'Tablet smal portret (600)', viewport: { width: 600, height: 960 }, dockVerwacht: true },
  { naam: 'iPad Mini portret (768)', viewport: { width: 768, height: 1024 }, dockVerwacht: false },
  { naam: 'Telefoon landscape (844)', viewport: { width: 844, height: 390 }, dockVerwacht: false },
];

const seed = async (page: Page, email: string) => {
  await page.addInitScript(
    ([key, mail]) => {
      const inAnHour = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(key as string, JSON.stringify({
        access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, expires_at: inAnHour,
        user: { id: 'auth-e2e', email: mail, aud: 'authenticated' },
      }));
      window.localStorage.setItem('vhb-current-view', 'dashboard');
    },
    [SESSION_KEY, email] as const,
  );
};

for (const rol of ['planner', 'chauffeur'] as const) {
  for (const p of PROFIELEN) {
    test(`dock · ${rol} · ${p.naam}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: p.viewport, isMobile: p.viewport.width < 768, hasTouch: true,
        baseURL: 'http://localhost:4173', serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const me = rol === 'planner' ? ADMIN : CHAUFFEUR;
      await seed(page, me.email);
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (path.endsWith('/api/me')) return json(me);
        if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
        if (path.endsWith('/api/users')) return json([ADMIN, CHAUFFEUR]);
        // Badge op de Verlof-tab meetesten (planner ziet openstaande aanvraag).
        if (rol === 'planner' && path.endsWith('/api/leave')) {
          return json([{ id: 'l1', userId: '2', startDate: '2099-01-05', endDate: '2099-01-06', type: 'betaald_verlof', status: 'pending', createdAt: '2026-08-01T10:00:00Z' }]);
        }
        return json([]);
      });
      await page.goto('/');
      await page.waitForSelector('main, [data-scroll-root]', { timeout: 15_000 });
      const nav = page.locator('nav[aria-label="Hoofdnavigatie"]');

      if (!p.dockVerwacht) {
        await expect(nav).toBeHidden();
        await context.close();
        return;
      }
      await expect(nav).toBeVisible();

      // Meet pas als de webfonts geladen zijn: Inter is ±2px breder dan de
      // systeemfallback — precies het verschil tussen wel/geen ellipsis.
      await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
      await page.waitForTimeout(100);

      const meting = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Hoofdnavigatie"]')!;
        const navR = nav.getBoundingClientRect();
        const knoppen = Array.from(nav.querySelectorAll('button'));
        const geclipt: string[] = [];
        const afgekapt: string[] = [];
        for (const b of knoppen) {
          const tekst = b.getAttribute('aria-label') ?? '?';
          const r = b.getBoundingClientRect();
          if (r.right > navR.right + 1 || r.left < navR.left - 1) geclipt.push(tekst);
          const labelSpan = (Array.from(b.children) as HTMLElement[]).filter((el) => el.tagName === 'SPAN' && !el.querySelector('svg')).pop();
          // sr-only labels (icoon-only-modus <340px) zijn bewust 1px breed.
          if (labelSpan && labelSpan.offsetWidth > 2 && labelSpan.scrollWidth > labelSpan.clientWidth + 1) afgekapt.push(tekst);
        }
        const badge = nav.querySelector('button [class*="rounded-full"][class*="bg-oker-500"]');
        const badgeR = badge?.getBoundingClientRect();
        return {
          minKnopH: Math.min(...knoppen.map((b) => b.getBoundingClientRect().height)),
          tabs: knoppen.length, geclipt, afgekapt,
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          badgeBinnen: !badgeR || (badgeR.top >= navR.top - 1 && badgeR.right <= navR.right + 1),
        };
      });

      expect(meting.tabs, 'zes tabs (5 views + Meer)').toBe(6);
      expect(meting.geclipt, 'tabs buiten de kaart').toEqual([]);
      expect(meting.afgekapt, 'afgekapte labels').toEqual([]);
      expect(meting.minKnopH, 'touch-hoogte').toBeGreaterThanOrEqual(44);
      expect(meting.overflowX, 'horizontale pagina-overflow').toBe(false);
      expect(meting.badgeBinnen, 'badge binnen de kaart').toBe(true);
      await context.close();
    });
  }
}
