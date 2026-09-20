import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, CHAUFFEUR, seed } from './helpers';

/**
 * Rapporten: catalogus → rapport → filter → leeg → de print-URL klopt en het
 * blad toont wat het scherm toonde. Draait op de telefoon én op desktop; de
 * API komt uit scripts/audit-fixtures.mjs (RAPPORT_VERLOFSALDO: twaalf
 * medewerkers, gegevens vanaf 05/01/2026).
 */

/** Vangt window.open af (openPdfInNewTab) zodat de test de URL kan lezen zonder een tweede tabblad. */
const vangNieuwTabblad = (page: Page) => page.addInitScript(() => {
  (window as unknown as { __geopend: string[] }).__geopend = [];
  window.open = ((url?: string | URL) => {
    (window as unknown as { __geopend: string[] }).__geopend.push(String(url));
    return { opener: null } as unknown as Window;
  }) as typeof window.open;
  window.print = () => {};
});
const geopend = (page: Page) => page.evaluate(() => (window as unknown as { __geopend: string[] }).__geopend);
const paginaScrolltNiet = async (page: Page) => {
  const { breed, venster } = await page.evaluate(() => ({ breed: document.documentElement.scrollWidth, venster: window.innerWidth }));
  expect(breed).toBeLessThanOrEqual(venster);
};

test('catalogus, rapport, filter, leeg en de print-URL', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);

  // Catalogus: domeinen, het rapport, de bestaande printbladen en "volgt later".
  await page.goto('/rapporten');
  await expect(page.getByRole('heading', { name: 'Rapporten', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Gewerkte uren', level: 2 })).toBeVisible();
  await expect(page.getByText('Volgt later')).toBeVisible();
  await expect(page.getByRole('button', { name: /Maandrooster per chauffeur/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Laadpalen/ })).toBeVisible();

  // Zoeken in de catalogus.
  await page.getByPlaceholder('Zoek een rapport…').fill('saldo');
  await expect(page.getByRole('link', { name: /Verlofsaldo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Maandrooster per chauffeur/ })).toHaveCount(0);

  // Naar het rapport: de URL is de bron.
  await page.getByRole('link', { name: /Verlofsaldo/ }).click();
  await expect(page).toHaveURL(/\/rapporten\/verlof\/verlofsaldo$/);
  await expect(page.getByRole('heading', { name: 'Verlofsaldo', level: 1 })).toBeVisible();
  await page.getByLabel('Jaar').selectOption('2026');
  await expect(page).toHaveURL(/jaar=2026/);
  await expect(page.getByRole('cell', { name: 'Alex Du Priez' })).toBeVisible();
  await expect(page.getByText('12 rijen')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Totaal (12)' })).toBeVisible();
  // De tabel schuift binnen haar kader, nooit de pagina.
  await paginaScrolltNiet(page);

  // Filter: één medewerker, in de URL.
  await page.getByLabel('Medewerker').selectOption({ label: 'Alex Du Priez' });
  await expect(page).toHaveURL(/chauffeur=43/);
  await expect(page.getByText('1 rij', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Bart Claeys' })).toHaveCount(0);

  // Leeg door een filter: eigen tekst, met "Filters wissen"; afdrukken blijft kunnen.
  await page.getByPlaceholder('Zoek in dit rapport…').fill('bestaatniet');
  await expect(page.getByRole('heading', { name: 'Geen resultaten voor deze filters' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV' })).toBeDisabled();
  await page.getByRole('button', { name: 'Afdrukken' }).click();
  const [printUrl] = await geopend(page);
  const url = new URL(printUrl);
  expect(url.pathname).toBe('/rapporten/verlof/verlofsaldo');
  expect(Object.fromEntries(url.searchParams)).toEqual({ 'print-rapport': 'verlofsaldo', jaar: '2026', chauffeur: '43', zoek: 'bestaatniet' });

  // Filters wissen brengt alles terug.
  await page.getByRole('button', { name: 'Filters wissen' }).click();
  await expect(page).not.toHaveURL(/chauffeur=|zoek=/);
  await expect(page.getByRole('cell', { name: 'Bart Claeys' })).toBeVisible();

  // Het blad zelf: kop, filters in woorden, wie afdrukt, en de lege zin.
  await page.goto(url.pathname + url.search);
  await expect(page.getByRole('heading', { name: 'Verlofsaldo', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Jaar 2026 · Medewerker: Alex Du Priez · Zoekterm: “bestaatniet”')).toBeVisible();
  await expect(page.getByText(/Afgedrukt op \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} door Jarno De Greve/)).toBeVisible();
  await expect(page.getByText('Geen gegevens voor deze periode.')).toBeVisible();
  // Altijd licht, ook al staat staf standaard op donker.
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('het blad toont alle rijen met de totaalrij', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);
  await page.goto('/?print-rapport=verlofsaldo&jaar=2026');
  await expect(page.getByRole('heading', { name: 'Verlofsaldo', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Jaar 2026 · Medewerker: alle')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(14); // kop + 12 + totaal
  await expect(page.getByRole('row', { name: /Totaal \(12\)\s+258\s+144\s+14\s+100\s+3/ })).toBeVisible();
});

test('periode zonder gegevens zegt vanaf wanneer, een laadfout is een foutkaart', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await page.goto('/rapporten/verlof/verlofsaldo?jaar=2024');
  await expect(page.getByRole('heading', { name: 'Geen gegevens voor deze periode' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Er zijn pas verlofgegevens vanaf 05/01/2026.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  await page.route('**/api/rapporten/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Het rapport kon niet geladen worden.' }) }));
  await page.getByLabel('Jaar').selectOption('2026');
  await expect(page.getByText('Het rapport kon niet geladen worden.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Geen (gegevens|resultaten)/ })).toHaveCount(0);
});

test('een bestaand printblad opent zijn eigen print-URL na het kiezen van de parameters', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);
  await page.goto('/rapporten');
  await page.getByRole('button', { name: /Gele boek, openstaande werken/ }).click();
  const dialoog = page.getByRole('dialog', { name: 'Gele boek, openstaande werken' });
  await dialoog.getByRole('button', { name: 'Alles' }).click();
  await dialoog.getByRole('button', { name: 'Afdrukken' }).click();
  expect((await geopend(page))[0]).toMatch(/\/rapporten\?print-gele-boek=alles$/);

  await page.getByRole('button', { name: /Verlofjaar per chauffeur/ }).click();
  const verlof = page.getByRole('dialog', { name: 'Verlofjaar per chauffeur' });
  await expect(verlof.getByRole('button', { name: 'Afdrukken' })).toBeDisabled();
  await verlof.getByLabel('Medewerker').selectOption({ label: 'Alex Du Priez' });
  await verlof.getByLabel('Jaar').selectOption('2026');
  await verlof.getByRole('button', { name: 'Afdrukken' }).click();
  expect((await geopend(page))[1]).toMatch(/\?print-verlof-driver=43&print-verlof-jaar=2026$/);
});

test('een chauffeur komt niet op Rapporten', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'dashboard' });
  await page.goto('/rapporten/verlof/verlofsaldo');
  await expect(page.getByRole('heading', { name: 'Verlofsaldo', level: 1 })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Rapporten' })).toHaveCount(0);
});

for (const thema of ['light', 'dark'] as const) {
  test(`a11y (WCAG 2.1 AA): catalogus en rapport, ${thema === 'dark' ? 'donker' : 'licht'}`, async ({ page }) => {
    await seed(page, { user: ADMIN, view: 'rapporten', thema });
    for (const pad of ['/rapporten', '/rapporten/verlof/verlofsaldo?jaar=2026']) {
      await page.goto(pad);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      // De bottom-nav heeft een bekende, elders gedocumenteerde contrastschuld (e2e/a11y.spec.ts).
      const resultaat = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('nav[aria-label="Hoofdnavigatie"]').analyze();
      const blokkerend = resultaat.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(blokkerend.map((v) => `${v.id}: ${v.help} (${JSON.stringify(v.nodes[0]?.target)})`), `${pad} (${thema})`).toEqual([]);
    }
  });
}
