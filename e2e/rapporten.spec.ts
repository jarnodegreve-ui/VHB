import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, CHAUFFEUR, seed } from './helpers';

/**
 * Rapporten: catalogus → rapport → filter → leeg → de print-URL klopt en het
 * blad toont wat het scherm toonde. Draait op de telefoon én op desktop; de
 * API komt uit scripts/audit-fixtures.mjs (RAPPORT_VERLOFSALDO: twaalf
 * medewerkers, gegevens vanaf 05/01/2026; sinds stap 2 ook
 * RAPPORT_ZIEKTE_KALENDERDAGEN en RAPPORT_VERLOFBEZETTING), voor voertuigen
 * en personeel uit scripts/fixtures-rapporten-wagenpark-personeel.mjs, en voor
 * ruilen en planning uit scripts/fixtures-rapporten-ruilen-planning.mjs.
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

/**
 * De rechterrand van de tabel op een smal scherm: welke kolomkoppen volledig binnen het kader vallen, en of
 * er een cel met een statuspil of -puntje (Badge) half in beeld staat. Een kolom `achteraan` mag half in
 * beeld staan (dat toont dat er meer is), een doorgesneden pil niet.
 */
const randVanDeTabel = (page: Page) => page.evaluate(() => {
  const kader = document.querySelector('table')!.parentElement!.getBoundingClientRect();
  const binnen = (el: Element) => el.getBoundingClientRect().right <= kader.right + 0.5;
  const snijdt = (el: Element) => { const r = el.getBoundingClientRect(); return r.left < kader.right - 0.5 && r.right > kader.right + 0.5; };
  return {
    koppenBinnen: [...document.querySelectorAll('thead th')].filter(binnen).map((th) => (th.textContent ?? '').trim()),
    doorgesnedenPil: [...document.querySelectorAll('tbody td')].some((td) => snijdt(td) && td.querySelector('.rounded-full') !== null),
  };
});

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

test('telefoon: naam met sectie eronder en Budget, Opgenomen en Vrij zonder scrollen; breed: alle kolommen', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await page.goto('/rapporten/verlof/verlofsaldo?jaar=2026');
  await expect(page.getByRole('cell', { name: /Alex Du Priez/ })).toBeVisible({ timeout: 15_000 });
  const koppen = page.getByRole('columnheader');
  const smal = (page.viewportSize()?.width ?? 0) < 768;

  if (!smal) {
    await expect(koppen.filter({ hasText: /^(Naam|Sectie|Budget|Opgenomen|Aangevraagd|Vrij|Klein verlet)$/ })).toHaveCount(7);
    await expect(page.getByRole('cell', { name: 'Reguliere diensten' }).first()).toBeVisible();
    return;
  }

  // Geen eigen kolom Sectie: ze staat als tweede regel onder de naam.
  await expect(page.getByRole('columnheader', { name: 'Sectie' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Alex Du Priez Reguliere diensten' })).toBeVisible();
  // Korte kop in beeld, de volledige naam voor hulptechnologie.
  await expect(page.getByRole('button', { name: 'Opgenomen' })).toHaveText('Opgen.');

  // Naam, Budget, Opgenomen en Vrij vallen binnen het kader; Aangevraagd en Klein verlet erachter.
  const binnenKader = await page.evaluate(() => {
    const kader = document.querySelector('table')!.parentElement!.getBoundingClientRect();
    return [...document.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().right <= kader.right + 0.5);
  });
  expect(binnenKader).toEqual([true, true, true, true, false, false]);
  await expect(koppen.nth(4)).toHaveText('Aangevr.');
  await paginaScrolltNiet(page);

  // De totaalrij volgt dezelfde kolommen, en sorteren werkt op de smalle koppen.
  await expect(page.getByRole('row', { name: /Totaal \(12\)\s*258\s*144\s*100\s*14\s*3/ })).toBeVisible();
  await page.getByRole('button', { name: 'Vrij' }).click();
  await expect(koppen.nth(3)).toHaveAttribute('aria-sort', 'ascending');
  // Drie mensen staan op 0 vrij; wie bovenaan staat hangt van de aanlevering af.
  await expect(page.getByRole('row').nth(1)).toContainText(/Carine De Smet|Diether Van Haute|Hans Vermeulen/);
  await page.getByRole('button', { name: 'Vrij' }).click();
  await expect(koppen.nth(3)).toHaveAttribute('aria-sort', 'descending');
  await expect(page.getByRole('row').nth(1)).toContainText('Greet Lambrecht');
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

// === Stap 2 (21-09): ziekte en verlof ===

test('ziekte in kalenderdagen: standaard dit jaar, chauffeurfilter, totaalrij en het blad', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);
  const smal = (page.viewportSize()?.width ?? 0) < 768;

  // Via de catalogus: het domein Ziekte heeft nu rapporten.
  await page.goto('/rapporten');
  await page.getByRole('link', { name: /Ziekte in kalenderdagen/ }).click();
  await expect(page).toHaveURL(/\/rapporten\/ziekte\/ziekte-kalenderdagen$/);
  await expect(page.getByRole('heading', { name: 'Ziekte in kalenderdagen', level: 1 })).toBeVisible();
  // Ziekte lees je per jaar: de periode staat standaard op "Dit jaar".
  await expect(page.getByLabel('Periode', { exact: true })).toHaveValue('dit-jaar');
  // Verder met een vast jaar, zodat de spec ook na 2026 hetzelfde toont.
  await page.goto('/rapporten/ziekte/ziekte-kalenderdagen?van=2026-01-01&tot=2026-12-31');
  await expect(page.getByText('4 rijen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('row', { name: /Totaal \(4\)\s*6\s*59/ })).toBeVisible();
  // Standaardsortering: meeste kalenderdagen eerst.
  await expect(page.getByRole('row').nth(1)).toContainText('Diether Van Haute');

  if (smal) {
    // Personeelsnummer onder de naam; meldingen, dagen en langste periode zonder scrollen, de datum erachter.
    await expect(page.getByRole('cell', { name: 'Diether Van Haute VHB-044' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kalenderdagen' })).toHaveText('Dagen');
    const binnenKader = await page.evaluate(() => {
      const kader = document.querySelector('table')!.parentElement!.getBoundingClientRect();
      return [...document.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().right <= kader.right + 0.5);
    });
    expect(binnenKader).toEqual([true, true, true, true, false]);
  } else {
    // Alleen de kop: de totaalrij bestaat ook uit kopcellen.
    await expect(page.locator('thead th')).toHaveCount(6);
    // Datums in dd/mm/jjjj, nooit rauwe ISO.
    await expect(page.getByRole('cell', { name: '17/08/2026' })).toBeVisible();
  }
  await paginaScrolltNiet(page);

  await page.getByLabel('Chauffeur', { exact: true }).selectOption({ label: 'Alex Du Priez' });
  await expect(page).toHaveURL(/chauffeur=43/);
  await expect(page.getByText('1 rij', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Afdrukken' }).click();
  const url = new URL((await geopend(page))[0]);
  expect(url.searchParams.get('print-rapport')).toBe('ziekte-kalenderdagen');
  expect(url.searchParams.get('chauffeur')).toBe('43');
  expect(url.searchParams.get('van')).toBe('2026-01-01');

  await page.goto('/?print-rapport=ziekte-kalenderdagen&van=2026-01-01&tot=2026-12-31');
  await expect(page.getByRole('heading', { name: 'Ziekte in kalenderdagen', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Periode 01/01/2026 t/m 31/12/2026 · Chauffeur: alle')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(6); // kop + 4 + totaal
  expect(pageErrors).toEqual([]);
});

test('verlofbezetting: het vinkje "alleen boven de limiet" staat in de URL, op het blad en filtert', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);
  const smal = (page.viewportSize()?.width ?? 0) < 768;
  await page.goto('/rapporten/verlof/verlofbezetting?van=2026-08-01&tot=2026-08-31');
  await expect(page.getByRole('heading', { name: 'Verlofbezetting per dag', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('31 rijen')).toBeVisible();
  await expect(page.getByRole('cell', { name: smal ? '01/08/2026 za' : '01/08/2026' })).toBeVisible();
  if (!smal) await expect(page.getByRole('cell', { name: 'Alex Du Priez, Dirk Maes, Els Goossens, Bart Claeys (flexi, telt niet mee)' })).toBeVisible();

  const vinkje = page.getByRole('button', { name: 'Alleen boven de limiet' });
  await expect(vinkje).toHaveAttribute('aria-pressed', 'false');
  await vinkje.click();
  await expect(page).toHaveURL(/bovenLimiet=1/);
  await expect(vinkje).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('2 rijen')).toBeVisible();
  await expect(page.getByRole('cell', { name: /^13\/08\/2026/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^12\/08\/2026/ })).toHaveCount(0);
  // "Boven limiet: ja" is een rode pil, ook op de telefoon in beeld; "nee" blijft stille tekst.
  const pil = page.getByRole('cell', { name: 'ja', exact: true }).first().locator('span');
  await expect(pil).toBeVisible();
  await expect(pil).toHaveClass(/text-red-700/);
  if (smal) {
    await expect(page.getByRole('button', { name: 'Boven limiet' })).toHaveText('Boven');
    const binnenKader = await page.evaluate(() => {
      const kader = document.querySelector('table')!.parentElement!.getBoundingClientRect();
      return [...document.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().right <= kader.right + 0.5);
    });
    expect(binnenKader).toEqual([true, true, true, true, false]);
  }
  await paginaScrolltNiet(page);

  await page.getByRole('button', { name: 'Afdrukken' }).click();
  const url = new URL((await geopend(page))[0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ 'print-rapport': 'verlofbezetting', van: '2026-08-01', tot: '2026-08-31', bovenLimiet: '1' });
  await page.goto(url.pathname + url.search);
  await expect(page.getByText('Periode 01/08/2026 t/m 31/08/2026 · Alleen boven de limiet')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('row')).toHaveCount(3); // kop + 2, geen totaalrij
  // Op papier valt "ja" op zonder kleur: vet, met een stip ervoor.
  await expect(page.getByRole('cell', { name: '● ja' })).toHaveCount(2);
  expect(await page.getByRole('cell', { name: '● ja' }).first().evaluate((td) => getComputedStyle(td).fontWeight)).toBe('700');

  // Uitvinken haalt de parameter weer uit de URL ("Filters wissen" doet hetzelfde).
  await page.goBack();
  await page.getByRole('button', { name: 'Alleen boven de limiet' }).click();
  await expect(page).not.toHaveURL(/bovenLimiet/);
});

test('een chauffeur komt niet op Rapporten', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'dashboard' });
  await page.goto('/rapporten/verlof/verlofsaldo');
  await expect(page.getByRole('heading', { name: 'Verlofsaldo', level: 1 })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Rapporten' })).toHaveCount(0);
});

// === Stap 3: voertuigen en personeel (fixtures in scripts/fixtures-rapporten-wagenpark-personeel.mjs) ===

test('voertuigrapport: wagenpark met keuzelijsten, peildatum, totaalrij en het blad', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);
  await page.goto('/rapporten');
  await expect(page.getByRole('heading', { name: 'Personeel', level: 2 })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: /Wagenpark, overzicht/ }).click();
  await expect(page).toHaveURL(/\/rapporten\/voertuigen\/wagenpark-overzicht$/);
  await expect(page.getByRole('heading', { name: 'Wagenpark, overzicht', level: 1 })).toBeVisible();

  // Standaard alles wat in dienst is; de peildatum staat in de filterregel, in dd/mm/jjjj.
  await expect(page.getByText('7 rijen')).toBeVisible();
  await expect(page.getByText('21/09/2026')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Oud 01/ })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Totaal (7)' })).toBeVisible();
  await paginaScrolltNiet(page);

  if ((page.viewportSize()?.width ?? 0) < 768) {
    // Telefoon: Status (een puntje met tekst) staat als laatste achter het scrollen, nooit half in beeld.
    for (const breedte of [375, 390]) {
      await page.setViewportSize({ width: breedte, height: 800 });
      await expect(page.getByRole('columnheader', { name: 'Leeftijd (jaar)' })).toBeVisible();
      const rand = await randVanDeTabel(page);
      expect(rand.koppenBinnen, `${breedte} px`).toEqual(['Busnr.', 'Merk', 'Leeft.']);
      expect(rand.doorgesnedenPil, `${breedte} px`).toBe(false);
    }
  }

  // Uit dienst zit achter een keuze, en die keuze staat in de URL.
  await page.getByLabel('Status').selectOption('uit_dienst');
  await expect(page).toHaveURL(/status=uit_dienst/);
  await expect(page.getByRole('cell', { name: /Oud 01/ })).toBeVisible();
  await expect(page.getByText('1 rij', { exact: true })).toBeVisible();
  await page.getByLabel('Aandrijving').selectOption('elektrisch');
  await expect(page.getByRole('heading', { name: 'Geen resultaten voor deze filters' })).toBeVisible();
  await expect(page.getByText(/^Er zijn wel gegevens, maar niets past/)).toBeVisible();

  await page.getByRole('button', { name: 'Afdrukken' }).click();
  const url = new URL((await geopend(page))[0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ 'print-rapport': 'wagenpark-overzicht', status: 'uit_dienst', categorie: 'alle', aandrijving: 'elektrisch' });

  // Het blad: keuzes en peildatum in woorden, liggend, met de totaalrij.
  await page.goto('/?print-rapport=wagenpark-overzicht&status=alle');
  await expect(page.getByRole('heading', { name: 'Wagenpark, overzicht', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Status: Alle, ook uit dienst · Categorie: Alle · Aandrijving: Alle · Peildatum 21/09/2026')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(10); // kop + 8 + totaal
  await expect(page.getByRole('row', { name: /Totaal \(8\)\s+277\s+7,7/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: '23/01/2019' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('personeelsrapport: medische schiftingen, dringendste eerst, termijn en wie geen datum heeft', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await page.goto('/rapporten/personeel/medische-schiftingen');
  await expect(page.getByRole('heading', { name: 'Medische schiftingen', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('6 rijen')).toBeVisible();
  const smal = (page.viewportSize()?.width ?? 0) < 768;

  // Vervallen bovenaan, wie geen datum heeft onderaan.
  const rijen = page.getByRole('row');
  await expect(rijen.nth(1)).toContainText('Annelies Verstraete');
  await expect(rijen.nth(1)).toContainText('-7');
  await expect(rijen.nth(6)).toContainText('Carine De Smet');
  // Wie geen datum heeft: "Geen datum" staat in de cel Geldig tot zelf, dus ook zonder de statuskolom zichtbaar.
  await expect(rijen.nth(6).getByRole('cell', { name: 'Geen datum', exact: true }).first()).toBeVisible();
  if (smal) {
    // Telefoon (375 en 390 px): personeelsnummer onder de naam; Naam, Geldig tot en Dagen passen volledig
    // in het kader en de kolom Status valt weg: geen half zichtbare, doorgesneden pil aan de rechterrand.
    await expect(page.getByRole('cell', { name: 'Annelies Verstraete VHB-000060' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Personeelsnr.' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Status' })).toHaveCount(0);
    for (const breedte of [375, 390]) {
      await page.setViewportSize({ width: breedte, height: 800 });
      await expect(page.getByRole('columnheader', { name: 'Resterende dagen' })).toBeVisible();
      expect(await randVanDeTabel(page), `${breedte} px`).toEqual({ koppenBinnen: ['Naam', 'Geldig tot', 'Dagen'], doorgesnedenPil: false });
      await paginaScrolltNiet(page);
    }
  } else {
    await expect(rijen.nth(1)).toContainText('Vervallen');
    await expect(rijen.nth(1).getByRole('cell', { name: '14/09/2026', exact: true })).toBeVisible();
  }

  // Binnen 30 dagen: wat vervallen is hoort erbij, wie geen datum heeft ook.
  await page.getByLabel('Vervalt binnen').selectOption('30');
  await expect(page).toHaveURL(/termijn=30/);
  await expect(page.getByText('3 rijen')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Bart Claeys/ })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /Carine De Smet/ })).toBeVisible();
});

test('ruilrapport: ruilaanvragen met status, antwoord van de collega, peildatum en het blad', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);
  await page.goto('/rapporten');
  await expect(page.getByRole('heading', { name: 'Ruilen', level: 2 })).toBeVisible({ timeout: 15_000 });
  // De drie rapporten staan naast het bestaande weekblad.
  await expect(page.getByRole('link', { name: /Uitgevoerde wissels/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ruilen per chauffeur/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ruiloverzicht per week/ })).toBeVisible();
  await page.getByRole('link', { name: /Ruilaanvragen/ }).click();
  await expect(page).toHaveURL(/\/rapporten\/ruilen\/ruilaanvragen$/);

  await page.goto('/rapporten/ruilen/ruilaanvragen?van=2026-09-01&tot=2026-09-30');
  await expect(page.getByRole('heading', { name: 'Ruilaanvragen', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('8 rijen')).toBeVisible();
  // De peildatum (open aanvragen tellen door tot vandaag) staat in de filterregel, in dd/mm/jjjj.
  await expect(page.getByText('21/09/2026')).toBeVisible();
  await paginaScrolltNiet(page);
  const smal = (page.viewportSize()?.width ?? 0) < 768;

  if (smal) {
    // Telefoon: de status staat onder de dag van de aanvraag, aanvrager en dienst in beeld, geen doorgesneden pil.
    await expect(page.getByRole('cell', { name: '19/09/2026 Bij planning' })).toBeVisible();
    for (const breedte of [375, 390]) {
      await page.setViewportSize({ width: breedte, height: 800 });
      const rand = await randVanDeTabel(page);
      expect(rand.koppenBinnen, `${breedte} px`).toEqual(['Aangevr.', 'Aanvrager', 'Dienst']);
      expect(rand.doorgesnedenPil, `${breedte} px`).toBe(false);
      await paginaScrolltNiet(page);
    }
  } else {
    const eerste = page.getByRole('row').nth(1);
    await expect(eerste).toContainText('19/09/2026');
    await expect(eerste).toContainText('Bij planning');
    await expect(eerste).toContainText('Geaccepteerd');
    // Rechtstreeks goedgekeurd: het antwoord van de collega is niet afgewacht.
    await expect(page.getByRole('row', { name: /Bart Claeys.*Niet afgewacht.*18\/09\/2026.*Jarno De Greve/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Totaal \(8\)/ })).toBeVisible();
    // Elf kolommen passen niet altijd in het kader: dan schuift de tabel erin (ook vanaf xl), niets valt afgesneden buiten beeld.
    const kader = await page.evaluate(() => {
      const k = document.querySelector('table')!.parentElement!;
      return { past: k.scrollWidth <= k.clientWidth + 1, overloop: getComputedStyle(k).overflowX };
    });
    expect(kader.past || kader.overloop === 'auto', JSON.stringify(kader)).toBe(true);
  }

  // Status en soort zijn keuzelijsten, in de URL.
  await page.getByLabel('Status').selectOption('teruggedraaid');
  await expect(page).toHaveURL(/status=teruggedraaid/);
  await expect(page.getByText('1 rij', { exact: true })).toBeVisible();
  await page.getByLabel('Soort').selectOption('ruil');
  await expect(page.getByRole('heading', { name: 'Geen resultaten voor deze filters' })).toBeVisible();

  await page.getByRole('button', { name: 'Afdrukken' }).click();
  const url = new URL((await geopend(page))[0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ 'print-rapport': 'ruilaanvragen', van: '2026-09-01', tot: '2026-09-30', status: 'teruggedraaid', soort: 'ruil' });

  // Het blad: filters en peildatum in woorden, de status met een stip waar ze aandacht vraagt, het gemiddelde in de totaalrij.
  await page.goto('/?print-rapport=ruilaanvragen&van=2026-09-01&tot=2026-09-30');
  await expect(page.getByRole('heading', { name: 'Ruilaanvragen', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Periode 01/09/2026 t/m 30/09/2026 · Status: Alle · Chauffeur: alle · Soort: Alle · Peildatum 21/09/2026')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(10); // kop + 8 + totaal
  await expect(page.getByRole('cell', { name: '● Bij planning' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Totaal \(8\)\s+2,33/ })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('planningsrapport: diensten per dag met delen en uren, zonder bus, en hele maanden in het overzicht', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await vangNieuwTabblad(page);
  await page.goto('/rapporten/planning/diensten-per-dag?van=2026-09-21&tot=2026-09-27');
  await expect(page.getByRole('heading', { name: 'Diensten per dag', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('12 rijen')).toBeVisible();
  await paginaScrolltNiet(page);
  const smal = (page.viewportSize()?.width ?? 0) < 768;

  if (smal) {
    // Telefoon: dag en chauffeur onder de datum; dienst, start en einde passen ervoor.
    await expect(page.getByRole('cell', { name: '21/09/2026 ma · Test Chauffeur' }).first()).toBeVisible();
    for (const breedte of [375, 390]) {
      await page.setViewportSize({ width: breedte, height: 800 });
      expect((await randVanDeTabel(page)).koppenBinnen, `${breedte} px`).toEqual(['Datum', 'Dienst', 'Start', 'Einde']);
      await paginaScrolltNiet(page);
      // Na één veeg: deel, duur en loop staan samen volledig in beeld naast de vaste datum (er is geen kolom Bus meer die ze wegduwt).
      await page.evaluate(() => { const k = document.querySelector('table')!.parentElement!; k.scrollLeft = k.scrollWidth; });
      expect((await randVanDeTabel(page)).koppenBinnen, `${breedte} px, gescrold`).toEqual(expect.arrayContaining(['Datum', 'Deel', 'Duur', 'Loop']));
      await page.evaluate(() => { document.querySelector('table')!.parentElement!.scrollLeft = 0; });
    }
  } else {
    // Een gesplitste dienst staat er met elk deel in, in volgorde; tijden in 24 uur, de duur als u:mm.
    const rijen = page.getByRole('row');
    await expect(rijen.nth(1)).toContainText('2101');
    await expect(rijen.nth(1)).toContainText('04:36');
    await expect(rijen.nth(1)).toContainText('3:16');
    await expect(rijen.nth(2)).toContainText('13:39');
    // Een busdag loopt voorbij middernacht door: 26:16 blijft 26:16.
    await expect(page.getByRole('cell', { name: '26:16', exact: true })).toBeVisible();
    // Geen bus: het portaal houdt er geen bij en toont bewust ook geen geplande bus. De loop staat er wel.
    await expect(page.getByRole('columnheader', { name: 'Bus' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Loop' })).toBeVisible();
    await expect(rijen.nth(1)).toContainText('4500');
  }

  // Filter op chauffeur, in de URL; de print-URL draagt dezelfde periode.
  await page.getByLabel('Chauffeur', { exact: true }).selectOption({ label: 'Alex Du Priez' });
  await expect(page).toHaveURL(/chauffeur=43/);
  await expect(page.getByText('4 rijen')).toBeVisible();
  await page.getByRole('button', { name: 'Afdrukken' }).click();
  const url = new URL((await geopend(page))[0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ 'print-rapport': 'diensten-per-dag', van: '2026-09-21', tot: '2026-09-27', chauffeur: '43' });

  // Overzicht per chauffeur telt per hele maand: twee maandvelden, en een link met losse datums wordt afgerond.
  await page.goto('/rapporten/planning/overzicht-per-chauffeur?van=2026-09-10&tot=2026-09-20');
  await expect(page.getByRole('heading', { name: 'Overzicht per chauffeur', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Van maand')).toHaveValue('2026-09');
  await expect(page.getByLabel('Tot en met maand')).toHaveValue('2026-09');
  await expect(page.getByText('6 rijen')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Totaal (6)' })).toBeVisible();
  await page.getByLabel('Van maand').selectOption('2026-07');
  await expect(page).toHaveURL(/van=2026-07-01&tot=2026-09-30/);
  await paginaScrolltNiet(page);

  // Er is geen rapport per voertuig op de planning: de catalogus toont het niet en een oude link zegt dat eerlijk.
  await page.goto('/rapporten/voertuigen/inzet-per-voertuig');
  await expect(page.getByRole('heading', { name: 'Dit rapport bestaat niet' })).toBeVisible({ timeout: 15_000 });
  await page.goto('/rapporten');
  await expect(page.getByRole('heading', { name: 'Voertuigen', level: 2 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: /Inzet per voertuig/ })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('een tabel die nog leeg is zegt dat eerlijk, en waar je ze invult', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'rapporten' });
  await page.goto('/rapporten/voertuigen/vervaldata-voertuigen');
  await expect(page.getByRole('heading', { name: 'Nog niets geregistreerd' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Er zijn nog geen vervaldata van voertuigen geregistreerd. Je vult ze in op de fiche van een voertuig, onder Vervaldata.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Geen (gegevens|resultaten)/ })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);

  // Met een periode erbij: dezelfde eerlijke tekst, niet "geen gegevens voor deze periode".
  await page.goto('/rapporten/voertuigen/uitgevoerde-werken');
  await expect(page.getByRole('heading', { name: 'Nog niets geregistreerd' })).toBeVisible();
  await expect(page.getByText(/Er zijn nog geen werkprestaties geregistreerd\./)).toBeVisible();

  await page.goto('/rapporten/voertuigen/vervaldata-voertuigen');
  await page.getByRole('button', { name: 'Naar Voertuigen' }).click();
  await expect(page).toHaveURL(/\/techniek\/voertuigen$/);
});

for (const thema of ['light', 'dark'] as const) {
  test(`a11y (WCAG 2.1 AA): catalogus en rapport, ${thema === 'dark' ? 'donker' : 'licht'}`, async ({ page }) => {
    await seed(page, { user: ADMIN, view: 'rapporten', thema });
    for (const pad of [
      '/rapporten',
      '/rapporten/verlof/verlofsaldo?jaar=2026',
      '/rapporten/verlof/verlofbezetting?van=2026-08-01&tot=2026-08-31&bovenLimiet=1',
      '/rapporten/ziekte/ziekte-kalenderdagen?van=2026-01-01&tot=2026-12-31',
      '/rapporten/voertuigen/wagenpark-overzicht?status=alle',
      '/rapporten/personeel/medische-schiftingen',
      '/rapporten/ruilen/ruilaanvragen?van=2026-09-01&tot=2026-09-30',
      '/rapporten/ruilen/uitgevoerde-wissels?van=2026-09-01&tot=2026-09-30',
      '/rapporten/planning/diensten-per-dag?van=2026-09-21&tot=2026-09-27',
      '/rapporten/planning/overzicht-per-chauffeur?van=2026-09-01&tot=2026-09-30',
      '/rapporten/planning/openstaande-diensten?van=2026-09-21&tot=2026-10-18',
    ]) {
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
