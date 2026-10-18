import { test, expect, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Navigeren vanuit de mobiele zijbalk (melding Jarno 11-09: "wat ik ook
 * aantik in het menu, ik kom steeds op dezelfde pagina terecht").
 *
 * De zijbalk is op mobiel een overlay met een eigen history-entry
 * (useHistoryDismiss), zodat de systeem-terugknop hem sluit. Een tik op een
 * menu-item wisselt de route én sluit de lade in één commit. Deze test rijdt
 * dat in een échte browser mét view transitions — de plek waar de volgorde
 * van history-mutaties telt, en waar een unit-test met een nagebootste
 * historiek niets bewijst.
 *
 * De profielen hieronder variëren de toestelmaat, niet de engine: het project
 * draait chromium (zie playwright.config.ts) — de engine van Chrome op
 * Android, en daar ging het deterministisch mis (12 van de 12 tikken vóór de
 * fix). WebKit (iOS Safari) is handmatig nagereden op een tijdelijk
 * webkit-project: die heeft view transitions net zo goed, maar wint de race
 * meestal, dus daar viel het maar bij uitzondering om. Vast in CI zetten zou
 * elke run een extra browserdownload kosten voor weinig extra zekerheid: de
 * fix haalt de race helemaal weg, in beide engines.
 */

const PROFIELEN = [
  { naam: 'iPhone 13 (390)', viewport: { width: 390, height: 844 } },
  { naam: 'Android compact (360)', viewport: { width: 360, height: 800 } },
  { naam: 'Pixel 7 (412)', viewport: { width: 412, height: 915 } },
] as const;

/** Zijbalk openen via "Meer" in de dock en één menu-item aantikken. */
async function kiesInZijbalk(page: Page, label: string) {
  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
  await expect(zijbalk).toBeVisible();
  await zijbalk.getByRole('button', { name: label, exact: true }).click();
}

for (const profiel of PROFIELEN) {
  test(`zijbalk · ${profiel.naam}: elk menu-item opent zijn eigen pagina`, async ({ browser, baseURL }) => {
    // baseURL uit de config, niet hardcoded: E2E_PORT en de handmatige
    // webkit-run draaien op een andere poort.
    const context = await browser.newContext({
      viewport: profiel.viewport, isMobile: true, hasTouch: true,
      baseURL, serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await seed(page, { user: ADMIN, view: 'verlof' });
    await page.goto('/verlof');
    await page.waitForSelector('[data-scroll-root]');

    for (const [label, pad] of [['Rooster', '/rooster'], ['Contacten', '/contacten'], ['Omleidingen', '/omleidingen']] as const) {
      await kiesInZijbalk(page, label);
      await expect(page, `menu-item ${label}`).toHaveURL(new RegExp(`${pad}$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await context.close();
  });
}

test('zijbalk: één terugstap gaat terug naar de vorige pagina', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'verlof' });
  await page.goto('/verlof');
  await page.waitForSelector('[data-scroll-root]');

  await kiesInZijbalk(page, 'Rooster');
  await expect(page).toHaveURL(/\/rooster$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/verlof$/);
});
