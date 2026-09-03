import { test, expect, type Page } from '@playwright/test';

/**
 * Donkere modus: geen enkel zichtbaar vlak mag (bijna) wit blijven.
 *
 * De app kleurt donker via semantische tokens (bg-surface-*) plus een tabel
 * blanket-overrides in index.css. Een nieuwe utility zonder tegenhanger valt
 * daardoor stil door de mand: hij blijft wit op een carbon achtergrond. Deze
 * test vangt dat af — hij was de reden om de dashboard-tokens over de hele
 * app uit te rollen.
 */

const SESSION_KEY = 'sb-localhost-auth-token';

const ADMIN = { id: '1', name: 'Admin E2E', role: 'admin', employeeId: 'VHB-000001', email: 'admin@vhb.be', isActive: true, verlofBudget: 20 };
const CHAUFFEUR = { id: '2', name: 'Chauffeur E2E', role: 'chauffeur', employeeId: 'VHB-000002', email: 'c@vhb.be', isActive: true, verlofBudget: 20 };

const seed = async (page: Page, view: string) => {
  await page.addInitScript(
    ([key, email, v]) => {
      const inAnHour = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(key as string, JSON.stringify({
        access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, expires_at: inAnHour,
        user: { id: 'auth-e2e', email, aud: 'authenticated' },
      }));
      window.localStorage.setItem('vhb-theme', 'dark');
      window.localStorage.setItem('vhb-current-view', v as string);
    },
    [SESSION_KEY, ADMIN.email, view] as const,
  );
};

/** Zichtbare vlakken met een (bijna) witte, dekkende achtergrond. */
const witteVlakken = (page: Page) =>
  page.evaluate(() => {
    const treffers: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 12) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      const m = /rgba?\(([^)]+)\)/.exec(st.backgroundColor);
      if (!m) continue;
      const [rr, gg, bb, aa] = m[1].split(',').map((x) => parseFloat(x));
      const alpha = Number.isFinite(aa) ? aa : 1;
      if (alpha < 0.5) continue;
      if (rr > 235 && gg > 235 && bb > 235) {
        treffers.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)}`);
      }
    }
    return treffers.slice(0, 8);
  });

// Alle hoofdschermen die een gewone gebruiker of planner dagelijks opent,
// plus de beheerschermen met veel oppervlakken. Bewust niet: de printviews
// (die zijn per definitie wit, A4) en het inlogscherm (altijd carbon).
const SCHERMEN = [
  'dashboard', 'mijn-dag', 'rooster', 'omleidingen', 'ritblaadjes', 'documenten',
  'contacten', 'updates', 'ruil-verzoeken', 'verlof', 'bezetting',
  'dekking', 'verlof-kalender', 'dienstoverzicht', 'planning-codes',
  'vervaldata', 'gebruikers', 'toestellen', 'activiteit',
] as const;

for (const view of SCHERMEN) {
  const naam = view;
  test(`donkere modus: geen witte vlakken op ${naam}`, async ({ page }) => {
    await seed(page, view);
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (path.endsWith('/api/me')) return json(ADMIN);
      if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
      if (path.endsWith('/api/users')) return json([ADMIN, CHAUFFEUR]);
      if (path.endsWith('/api/user-expiries')) return json([{ userId: '2', soort: 'code95', validUntil: '2027-05-01' }]);
      if (path.endsWith('/api/push/subscribers')) return json({ userIds: ['2'] });
      return json([]);
    });

    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 15_000 });
    await page.waitForTimeout(700);
    // Vangnet tegen een vals-groene test: als het scherm niet rendert (lazy
    // chunk stuk, view niet toegestaan) valt er niets te controleren en zou
    // "geen witte vlakken" niets betekenen.
    const aantalVlakken = await page.locator('main div').count();
    expect(aantalVlakken, `${naam} rendert nauwelijks iets`).toBeGreaterThan(10);
    expect(await witteVlakken(page), 'witte vlakken in donkere modus').toEqual([]);
  });
}

/**
 * Anti-witflits: het inline boot-script in index.html moet de dark-class
 * zetten vóórdat de bundel laadt. We blokkeren de JS-bundel volledig — als
 * de class er dan tóch staat, kan hij alleen van het boot-script komen.
 * (Zonder dit flitste dark mode bij elke herlaad even wit — Jarno 01-09.)
 */
test('dark staat al op <html> vóór de bundel laadt (boot-script)', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('vhb-theme', 'dark');
  });
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
});

/** Zelfde vangnet voor de rol-standaard: een planner die nooit zelf koos
 *  heeft geen 'vhb-theme', maar wél de gespiegelde effectieve waarde. */
test('boot-script leest ook vhb-theme-effectief (rol-standaard donker)', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('vhb-theme-effectief', 'dark');
  });
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
});
