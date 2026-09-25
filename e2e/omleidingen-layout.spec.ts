import { test, expect, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { CHAUFFEUR, seed } from './helpers';
import type { Diversion } from '../src/types';

const TITEL = 'Leestjeskermis (S26WRT0004), tijdelijke verplaatsing van de halte aan de Leestjesbrug en gewijzigde reisweg naar het station';
const OMSCHRIJVING = 'Richting station rijdt de bus via de ring en de tijdelijke halte aan de school.\nDe haltes Markt en Leestjesbrug worden niet bediend.\nRichting centrum blijft de normale reisweg behouden.';
const PDF_PAD = '/__test__/omleiding.pdf';
const PDF_PAD_2 = '/__test__/haltekaart.pdf';
const PDF_NAAM = 'Omleidingsplan lijn 50.pdf';
const PDF_NAAM_2 = 'Haltekaart station.pdf';
const OMLEIDINGEN: Diversion[] = [
  { id: 'lange-omleiding', line: '50, 58, 82', title: TITEL, location: 'Maldegem, stationsomgeving', description: OMSCHRIJVING, startDate: '2026-09-12', endDate: '2026-09-19' },
  { id: 'andere-lijn', line: '883, 884', title: 'Brugwerken aan de Zuidlaan', location: 'Eeklo', description: 'De brug blijft afgesloten voor doorgaand verkeer.', startDate: '2026-09-14', endDate: '2026-09-21' },
  { id: 'alle-lijnen', line: 'Alle', title: 'Marktplein tijdelijk afgesloten voor alle lijnen', location: 'Aalter', description: 'Gebruik de vervanghalte aan de bibliotheek.', startDate: '2026-09-15' },
  { id: 'binnenkort', line: '58', title: 'Nachtelijke werken aan de spooroverweg', location: 'Evergem', description: 'Volg na 22 uur de omleiding via de Industrieweg.', startDate: '2026-09-20', endDate: '2026-09-23' },
  { id: 'voorbij', line: '883', title: 'Wielerwedstrijd rond het dorpscentrum', location: 'Zomergem', description: 'De normale haltes zijn opnieuw beschikbaar.', startDate: '2026-09-13', endDate: '2026-09-13' },
  { id: 'oud-archief', line: '82', title: 'Afgewerkte rioleringswerken van juli', location: 'Maldegem', description: 'Ouder dan de zichtbare bewaartermijn.', startDate: '2026-07-01', endDate: '2026-07-31' },
];

async function openOmleidingen(page: Page, baseURL: string, pad = '/omleidingen', omleidingen = OMLEIDINGEN) {
  await page.clock.setFixedTime(new Date('2026-09-16T08:00:00Z'));
  await seed(page, {
    user: CHAUFFEUR, view: 'omleidingen', thema: 'dark',
    // Zoals de server ze geeft: de lijst met per bijlage een ondertekende URL.
    extra: (endpoint) => endpoint.endsWith('/api/diversions')
      ? omleidingen.map((item) => item.id === 'lange-omleiding'
        ? { ...item, bijlagen: [
          { slot: 1, filename: PDF_NAAM, sizeBytes: 1200, url: new URL(PDF_PAD, baseURL).href },
          { slot: 2, filename: PDF_NAAM_2, sizeBytes: 800, url: new URL(PDF_PAD_2, baseURL).href },
        ] }
        : item)
      : undefined,
  });
  await page.goto(pad);
  await expect(page.getByRole('heading', { level: 1, name: 'Omleidingen' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Leestjeskermis/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function pastZonderHorizontaleScroll(page: Page) {
  const afmetingen = await page.evaluate(() => {
    const inhoud = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    return { pagina: document.documentElement.scrollWidth - window.innerWidth, inhoud: inhoud.scrollWidth - inhoud.clientWidth };
  });
  expect(afmetingen.pagina, 'de pagina blijft binnen de viewport').toBeLessThanOrEqual(1);
  expect(afmetingen.inhoud, 'de lijst past zonder horizontaal schuiven').toBeLessThanOrEqual(1);
}

async function volledigeTekstZichtbaar(element: Locator) {
  await expect(element).toBeVisible();
  const past = await element.evaluate((el) => ({
    breed: el.scrollWidth <= el.clientWidth + 1,
    hoog: el.scrollHeight <= el.clientHeight + 1,
  }));
  expect(past, 'de volledige tekst past, zonder afkappen of regelbegrenzing').toEqual({ breed: true, hoog: true });
}

test('omleidingen: lange titels, alle lijnnummers en filters blijven bruikbaar', async ({ page, baseURL, isMobile }) => {
  await openOmleidingen(page, baseURL!);
  const langeRij = page.getByRole('button', { name: /Leestjeskermis/ });
  await volledigeTekstZichtbaar(langeRij.getByRole('heading'));
  await expect(langeRij).toHaveAccessibleName(/50.*58.*82/);
  await expect(page.getByRole('heading', { name: /^Nu geldig/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Binnenkort/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Wielerwedstrijd rond/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Afgewerkte rioleringswerken/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/omleidingen$/);
  if (isMobile) await expect(page.getByRole('dialog')).toHaveCount(0);
  await pastZonderHorizontaleScroll(page);

  const lijnen = page.getByRole('combobox', { name: 'Filter op lijn' });
  await lijnen.selectOption('58');
  await expect(langeRij).toBeVisible();
  await expect(page.getByRole('button', { name: /Nachtelijke werken/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Marktplein tijdelijk/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Brugwerken aan/ })).toHaveCount(0);
  const zoek = page.getByRole('textbox', { name: 'Zoek in omleidingen' });
  await zoek.fill('stationsomgeving');
  await expect(langeRij).toBeVisible();
  await expect(page.getByRole('button', { name: /Nachtelijke werken|Marktplein tijdelijk/ })).toHaveCount(0);
  await zoek.fill('bestaat-niet-zoeken');
  await expect(page.getByText('Geen resultaten', { exact: true })).toBeVisible();
  await zoek.fill('');
  await lijnen.selectOption('all');

  // Zoeken blijft ook in de volledige omschrijving zoeken, al bevat de
  // overzichtsrij zelf alleen de kerngegevens.
  await zoek.fill('normale reisweg behouden');
  await expect(langeRij).toBeVisible();
  await expect(page.getByRole('button', { name: /Brugwerken aan/ })).toHaveCount(0);
  await zoek.fill('Wielerwedstrijd');
  await expect(page.getByRole('button', { name: /Wielerwedstrijd rond/ })).toBeVisible();
  await pastZonderHorizontaleScroll(page);
});

test('omleidingen: volledig detail, PDF-bijlagen, URL-selectie en mobiel sluiten blijven werken', async ({ page, baseURL, isMobile }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const pdfBytes = Buffer.from(await pdf.save());
  await page.context().route(`**${PDF_PAD}`, (route) => route.fulfill({ contentType: 'application/pdf', body: pdfBytes }));
  await page.context().route(`**${PDF_PAD_2}`, (route) => route.fulfill({ contentType: 'application/pdf', body: pdfBytes }));
  await openOmleidingen(page, baseURL!);
  await page.getByRole('button', { name: /Leestjeskermis/ }).click();
  await expect(page).toHaveURL(/\/omleidingen\/lange-omleiding$/);
  const detail = page.getByRole(isMobile ? 'dialog' : 'region', { name: TITEL, exact: true });
  await expect(detail).toBeVisible();
  await volledigeTekstZichtbaar(detail.getByRole('heading', { level: 2, name: TITEL, exact: true }));
  const beschrijving = detail.getByText(OMSCHRIJVING, { exact: true });
  await volledigeTekstZichtbaar(beschrijving);
  await expect(detail).toContainText('50');
  await expect(detail).toContainText('58');
  await expect(detail).toContainText('82');
  expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(detail.getByRole('term')).toHaveText(['Vanaf', 'Tot en met']);
  await expect(detail.locator('time')).toHaveCount(2);
  await expect(detail.locator('time').nth(0)).toHaveAttribute('datetime', '2026-09-12');
  await expect(detail.locator('time').nth(1)).toHaveAttribute('datetime', '2026-09-19');

  // Elke bijlage is een eigen knop met de bestandsnaam; de lijst staat
  // vóór de omschrijving zodat een lange tekst ze niet verstopt.
  const bijlagen = detail.getByRole('list', { name: 'Bijlagen' });
  await expect(bijlagen.getByRole('button')).toHaveText([PDF_NAAM, PDF_NAAM_2]);
  const pdfUrl = new URL(PDF_PAD_2, baseURL!).href;
  const pdfResponsePromise = page.context().waitForEvent('response', { predicate: (response) => response.url() === pdfUrl });
  const popupPromise = page.waitForEvent('popup');
  await bijlagen.getByRole('button', { name: PDF_NAAM_2, exact: true }).click();
  const popup = await popupPromise;
  const pdfResponse = await pdfResponsePromise;
  // Headless browsers behandelen een PDF als download of native reader en
  // houden soms about:blank. De bijlage moet wel in de nieuwe tab opgevraagd
  // worden; het portaal zelf blijft in het geselecteerde detail.
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.request().isNavigationRequest()).toBe(true);
  expect(pdfResponse.request().frame().page()).toBe(popup);
  await expect(page).toHaveURL(/\/omleidingen\/lange-omleiding$/);
  await popup.close();

  if (isMobile) {
    await detail.getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(detail).toHaveCount(0);
    await expect(page).toHaveURL(/\/omleidingen$/);
    await expect.poll(() => page.evaluate(() => history.state?.vhbOverlay ?? null)).toBeNull();
    await page.getByRole('button', { name: /Leestjeskermis/ }).click();
    await expect(detail).toBeVisible();
    await page.goBack();
    await expect(detail).toHaveCount(0);
    await expect(page).toHaveURL(/\/omleidingen$/);
  } else {
    await page.getByRole('button', { name: /Nachtelijke werken/ }).click();
    await expect(page.getByRole('region', { name: 'Nachtelijke werken aan de spooroverweg', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/omleidingen\/binnenkort$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('button', { name: /Marktplein tijdelijk/ }).click();
  const zonderEinddatum = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Marktplein tijdelijk afgesloten voor alle lijnen', exact: true });
  await expect(zonderEinddatum.getByText('Geen einddatum', { exact: true })).toBeVisible();
  await expect(zonderEinddatum.getByRole('list', { name: 'Bijlagen' })).toHaveCount(0);
  await pastZonderHorizontaleScroll(page);
});

test('omleidingen: directe link naar een verlopen record blijft na refresh geselecteerd', async ({ page, baseURL, isMobile }) => {
  await openOmleidingen(page, baseURL!, '/omleidingen/voorbij');
  const detail = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Wielerwedstrijd rond het dorpscentrum', exact: true });
  await expect(detail).toBeVisible();
  await expect(page.getByRole('button', { name: /Wielerwedstrijd rond/ })).toBeVisible();
  await page.reload();
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await expect(detail).toContainText('De normale haltes zijn opnieuw beschikbaar.');
  await expect(page).toHaveURL(/\/omleidingen\/voorbij$/);
  if (isMobile) {
    await detail.getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(detail).toHaveCount(0);
    await expect(page).toHaveURL(/\/omleidingen$/);
  }
});

for (const viewport of [{ width: 320, height: 800 }, { width: 844, height: 390 }]) {
  test(`omleidingen: op ${viewport.width}×${viewport.height} blijven filters, detail en sluiten bereikbaar`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'Portret en landschap zijn mobiele regressies.');
    await page.setViewportSize(viewport);
    await openOmleidingen(page, baseURL!);
    await pastZonderHorizontaleScroll(page);
    for (const veld of [page.getByRole('textbox', { name: 'Zoek in omleidingen' }), page.getByRole('combobox', { name: 'Filter op lijn' })]) {
      const rect = await veld.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const rij = page.getByRole('button', { name: /Leestjeskermis/ });
    await volledigeTekstZichtbaar(rij.getByRole('heading'));
    await rij.click();
    const detail = page.getByRole('dialog', { name: TITEL, exact: true });
    await volledigeTekstZichtbaar(detail.getByRole('heading', { level: 2 }));
    await volledigeTekstZichtbaar(detail.getByText(OMSCHRIJVING, { exact: true }));
    const sluit = detail.getByRole('button', { name: 'Sluiten', exact: true });
    await expect(sluit).toBeInViewport();
    await detail.getByRole('button', { name: PDF_NAAM, exact: true }).scrollIntoViewIfNeeded();
    await expect(sluit).toBeInViewport();
    await sluit.click();
    await expect(detail).toHaveCount(0);
  });
}

test('omleidingen: een volgend desktopdetail begint ook na scrollen in een lange titel bovenaan', async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, 'Alleen desktop wisselt records in hetzelfde open paneel.');
  await page.setViewportSize({ width: 1100, height: 650 });
  const langeTitels = OMLEIDINGEN.map((item) => ['lange-omleiding', 'andere-lijn'].includes(item.id)
    ? { ...item, title: `${item.title}. ${'De halte wordt tijdelijk verplaatst wegens werkzaamheden aan de rijweg. '.repeat(8)}`.trim() }
    : item);
  await openOmleidingen(page, baseURL!, '/omleidingen', langeTitels);
  const eerste = page.getByRole('region', { name: langeTitels[0].title, exact: true });
  const scrollTop = await eerste.getByRole('heading', { level: 2 }).evaluate((kop) => {
    for (let el = kop.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
        return el.scrollTop;
      }
    }
    return 0;
  });
  expect(scrollTop, 'de eerste kop is lang genoeg om binnen het paneel te scrollen').toBeGreaterThan(0);
  await page.getByRole('button', { name: /Brugwerken aan de Zuidlaan/ }).click();
  const tweede = page.getByRole('region', { name: langeTitels[1].title, exact: true });
  await expect(tweede).toBeVisible();
  await expect.poll(() => tweede.getByRole('heading', { level: 2 }).evaluate((kop) => {
    for (let el = kop.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight) return el.scrollTop;
    }
    return -1;
  })).toBe(0);
});
