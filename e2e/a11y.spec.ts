import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, CHAUFFEUR, seed, type Fixture } from './helpers';

/**
 * Toegankelijkheidsscan (axe-core, WCAG 2.1 AA) op zes schermen — draait in
 * beide projecten, dus op iPhone én desktop. `serious`/`critical` laten de
 * test falen; `moderate`/`minor` worden gerapporteerd (annotatie + console)
 * maar blokkeren niet.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Tijdelijk uitgeschakelde regels: alleen als een hele axe-regel op de
 * bestaande schermen niet houdbaar is. Liever `UITGESLOTEN` hieronder — dan
 * blijft de regel elders gewoon actief. Leeg sinds de eerste run (03-09).
 */
const TIJDELIJK_UIT: string[] = [];

/**
 * Tijdelijk uitgesloten elementen (per selector, mét reden): bestaande
 * AA-fouten in de views, buiten de scope van de e2e-ronde (03-09). De axe-
 * regel zelf (color-contrast) blijft aan voor de rest van het scherm.
 * Verwijder de regel zodra de view/component gefixt is.
 */
const UITGESLOTEN: string[] = [
  // BottomNav-labels (text-2xs, 11 px): inactief text-slate-400 op wit =
  // 2,61:1; actief oker-700 op oker-50 = 3,92:1; in dark slate-500 op carbon
  // = 3,7:1. Nodig ≥ 4,5:1 → labelkleur/-gewicht in src/components/BottomNav.tsx.
  'nav[aria-label="Hoofdnavigatie"]',
  // Verlofkalender (LeaveManagementView ±632): dagnummers text-slate-400 op
  // wit = 2,61:1. Zelfde plek als design-lint-regel (c) → text-slate-500+.
  '.grid-cols-7 > .aspect-square',
  // Chauffeur-dashboard, lege staat "Komende diensten" (DashboardView ±347):
  // text-xs text-slate-500 op emerald-50 = 4,37:1 (net onder 4,5).
  '.bg-emerald-50 .text-slate-500',
  // Badge tone="oker" (primitives.tsx ±79, verlofstatus "wachtend"): oker-700
  // op oker-50 bij text-2xs (11 px) = 4,3:1 — net onder 4,5. Primitief, dus
  // een fix raakt álle oker-badges (donkerder tekst of 12 px+).
  '.rounded-full.border-oker-200.text-oker-700',
];

type Scherm = { naam: string; user?: Fixture; view?: string; klaar: (page: Page) => Promise<void> };

const SCHERMEN: Scherm[] = [
  { naam: 'login', klaar: async (page) => { await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible({ timeout: 15_000 }); } },
  { naam: 'chauffeur-dashboard', user: CHAUFFEUR, view: 'dashboard', klaar: async (page) => { await expect(page.getByText('Volgende dienst')).toBeVisible({ timeout: 15_000 }); } },
  { naam: 'chauffeur-rooster', user: CHAUFFEUR, view: 'rooster', klaar: async (page) => { await expect(page.getByRole('heading', { name: 'Mijn rooster', level: 1 })).toBeVisible({ timeout: 15_000 }); } },
  { naam: 'chauffeur-verlof', user: CHAUFFEUR, view: 'verlof', klaar: async (page) => { await expect(page.getByRole('heading', { name: 'Verlof', level: 1 })).toBeVisible({ timeout: 15_000 }); } },
  { naam: 'admin-dashboard', user: ADMIN, view: 'dashboard', klaar: async (page) => { await expect(page.getByText('Open taken').first()).toBeVisible({ timeout: 15_000 }); } },
  { naam: 'admin-gebruikers', user: ADMIN, view: 'gebruikers', klaar: async (page) => { await expect(page.getByRole('heading', { name: 'Gebruikers', level: 1 })).toBeVisible({ timeout: 15_000 }); } },
];

const beschrijf = (v: { id: string; impact?: string | null; help: string; nodes: { target: unknown[] }[] }) =>
  `[${v.impact}] ${v.id}: ${v.help} — ${v.nodes.length}× (bv. ${JSON.stringify(v.nodes[0]?.target)})`;

for (const scherm of SCHERMEN) {
  test(`a11y (WCAG 2.1 AA): ${scherm.naam}`, async ({ page }) => {
    if (scherm.user) await seed(page, { user: scherm.user, view: scherm.view });
    await page.goto('/');
    await scherm.klaar(page);
    // Lazy chunks, fonts en count-ups even laten landen.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    let axe = new AxeBuilder({ page }).withTags(TAGS).disableRules(TIJDELIJK_UIT);
    for (const sel of UITGESLOTEN) axe = axe.exclude(sel);
    const resultaat = await axe.analyze();

    const blokkerend = resultaat.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const overig = resultaat.violations.filter((v) => !blokkerend.includes(v));
    for (const v of overig) {
      test.info().annotations.push({ type: `a11y-${v.impact}`, description: beschrijf(v) });
      console.log(`  a11y ${scherm.naam} ${beschrijf(v)}`);
    }
    expect(blokkerend.map(beschrijf), `a11y-fouten (serious/critical) op ${scherm.naam}`).toEqual([]);
  });
}
