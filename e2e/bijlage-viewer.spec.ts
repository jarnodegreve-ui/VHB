import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ADMIN, CHAUFFEUR, gaIntern, kanScrollen, seed, type Fixture } from './helpers';

/**
 * PDF-bijlagen van omleidingen en updates openen in de app (controle-ronde
 * 29-09, nr. 2; src/components/BijlageViewer.tsx). Draait op de telefoon
 * (Chromium en WebKit) en op desktop.
 *
 * Wat hier telt: de bijlage opent in een laag boven het detail, met de echte
 * pdfjs-render; Terug (browser, terugveeg) sluit alleen de viewer en laat het
 * detail open, nog eens Terug sluit het detail; daarna is de scroll-lock vrij;
 * "Extern openen" gebruikt de oude weg; een verlopen of falende link geeft
 * een foutstaat met twee knoppen en nooit de rauwe fout van de opslag.
 *
 * De service worker staat in deze projecten uit; het bewaren en openen
 * zonder bereik, vervangen en uitloggen staan in e2e/pwa.spec.ts.
 */

const PLAN_PAD = '/__test__/opslag/diversions/d1-1.pdf';
const HALTES_PAD = '/__test__/opslag/diversions/d1-2.pdf';
const MEDEDELING_PAD = '/__test__/opslag/update-bijlagen/u1-1.pdf';
const PLAN = 'Omleidingsplan lijn 58.pdf';
const HALTES = 'Haltekaart station.pdf';
const MEDEDELING = 'Mededeling uniformen.pdf';
const OMLEIDING_TITEL = 'Werken Markt Zottegem';
const UPDATE_TITEL = 'Nieuwe zomeruniformen beschikbaar';
const RAUWE_FOUT = { statusCode: '400', error: 'InvalidJWT', message: '"exp" claim timestamp check failed' };

async function maakPdf(kop: string, paginas = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i++) {
    const blad = pdf.addPage([595, 842]);
    blad.drawText(`${kop}, blad ${i}`, { x: 40, y: 780, size: 18, font });
    blad.drawLine({ start: { x: 40, y: 760 }, end: { x: 555, y: 760 }, thickness: 1 });
  }
  return Buffer.from(await pdf.save());
}

/** De klok van de browser staat vast (page.clock), dus "verlopen" rekent hiertegen. */
const KLOK = new Date('2026-09-25T09:00:00Z');

/** Ondertekende URL zoals Supabase ze geeft: een JWT met `exp` in seconden. */
function link(basis: string, pad: string, verlooptOverMs: number, merk: string) {
  const deel = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${deel({ alg: 'HS256' })}.${deel({ url: pad, exp: Math.floor((KLOK.getTime() + verlooptOverMs) / 1000), merk })}.handtekening`;
  return `${new URL(pad, basis).href}?token=${token}`;
}

type Opzet = {
  user?: Fixture;
  /** De URL van het omleidingsplan, per ophaling van de lijst (1 = eerste). */
  planUrl?: (ophaling: number) => string;
};

async function opzet(page: Page, baseURL: string, opties: Opzet = {}) {
  const teller = { lijst: 0 };
  const urlVan = (pad: string) => new URL(pad, baseURL).href;
  await page.clock.setFixedTime(KLOK);
  await seed(page, {
    user: opties.user ?? CHAUFFEUR,
    extra: (pad, request) => {
      if (request.method() !== 'GET') return undefined;
      if (pad.endsWith('/api/diversions')) {
        teller.lijst += 1;
        return [{
          id: 'd1', line: '58', location: 'Zottegem', title: OMLEIDING_TITEL, description: 'Omleiding via de ring.', startDate: '2026-09-20', endDate: '2026-10-10', _rev: 'r1',
          bijlagen: [
            { slot: 1, filename: PLAN, sizeBytes: 182_000, url: opties.planUrl?.(teller.lijst) ?? urlVan(PLAN_PAD) },
            { slot: 2, filename: HALTES, sizeBytes: 90_000, url: urlVan(HALTES_PAD) },
          ],
        }];
      }
      if (pad.endsWith('/api/updates')) {
        return [{ id: 'u1', title: UPDATE_TITEL, content: 'De nieuwe uniformen liggen klaar in het depot.', date: '2026-09-20', isUrgent: false, category: 'algemeen', _rev: 'r1',
          bijlagen: [{ slot: 1, filename: MEDEDELING, sizeBytes: 64_000, url: urlVan(MEDEDELING_PAD) }] }];
      }
      return undefined;
    },
  });
  return teller;
}

/** Eén PDF-pad beantwoorden; geeft de teller van de verzoeken terug. */
async function serveer(page: Page, pad: string, antwoord: (route: Route, nummer: number) => Promise<void> | void) {
  const verzoeken: string[] = [];
  await page.context().route(`**${pad}*`, async (route) => {
    verzoeken.push(route.request().url());
    await antwoord(route, verzoeken.length);
  });
  return verzoeken;
}
const alsPdf = (bytes: Buffer) => (route: Route) => route.fulfill({ contentType: 'application/pdf', body: bytes });

const pad = (page: Page) => new URL(page.url()).pathname;
const viewer = (page: Page, naam: string) => page.getByRole('dialog', { name: naam, exact: true });

/** De pagina staat er echt: PDF-papier is opaak, een leeg canvas transparant. */
async function paginaGetekend(laag: Locator, naam: string, nummer = 1) {
  const canvas = laag.getByRole('img', { name: `Pagina ${nummer} van ${naam}`, exact: true });
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.getContext('2d')!.getImageData(10, 10, 1, 1).data[3]), { timeout: 20_000 }).toBe(255);
  return canvas;
}

/** Dashboard → Omleidingen (intern) → de omleiding openen. */
async function openOmleiding(page: Page, isMobile: boolean) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await gaIntern(page, '/omleidingen');
  await expect(page.getByRole('heading', { level: 1, name: 'Omleidingen' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: new RegExp(OMLEIDING_TITEL) }).click();
  const detail = page.getByRole(isMobile ? 'dialog' : 'region', { name: OMLEIDING_TITEL, exact: true });
  await expect(detail).toBeVisible();
  expect(pad(page)).toBe('/omleidingen/d1');
  return detail;
}

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('omleiding: de bijlage opent in de app; Terug sluit de viewer, nog eens Terug het detail', async ({ page, baseURL, isMobile }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await opzet(page, baseURL!);
  const verzoeken = await serveer(page, PLAN_PAD, alsPdf(await maakPdf('Omleidingsplan', 2)));
  let popups = 0;
  page.on('popup', () => { popups += 1; });
  const detail = await openOmleiding(page, isMobile);

  await detail.getByRole('button', { name: PLAN, exact: true }).click();
  const laag = viewer(page, PLAN);
  await expect(laag).toBeVisible();
  await paginaGetekend(laag, PLAN, 1);
  await expect(laag.getByRole('img', { name: `Pagina 2 van ${PLAN}`, exact: true })).toBeAttached();
  await expect(laag.getByText('2 pagina’s')).toBeVisible();
  await expect(laag.getByText('100 %', { exact: true })).toBeVisible();
  // In de app: geen nieuw venster, en het portaal staat nog op de omleiding.
  expect(popups).toBe(0);
  expect(pad(page)).toBe('/omleidingen/d1');
  const terugKnop = laag.getByRole('button', { name: 'Terug', exact: true });
  await expect(terugKnop).toBeInViewport({ ratio: 1 });
  await expect(laag.getByRole('button', { name: 'Extern openen', exact: true })).toBeInViewport({ ratio: 1 });

  // Zoom werkt zoals bij het ritblad.
  const canvas = laag.getByRole('img', { name: `Pagina 1 van ${PLAN}`, exact: true });
  const breedte = await canvas.evaluate((el) => el.getBoundingClientRect().width);
  await laag.getByRole('button', { name: 'Inzoomen', exact: true }).click();
  await expect(laag.getByText('150 %', { exact: true })).toBeVisible();
  await expect.poll(() => canvas.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(breedte * 1.4);

  // Terug (browser of terugveeg) sluit alleen de viewer.
  await page.goBack();
  await expect(laag).toHaveCount(0);
  await expect(detail).toBeVisible();
  expect(pad(page)).toBe('/omleidingen/d1');

  // De terugknop in de viewer doet hetzelfde, zonder dode terugstap achter te laten.
  await detail.getByRole('button', { name: PLAN, exact: true }).click();
  await paginaGetekend(viewer(page, PLAN), PLAN);
  await expect(viewer(page, PLAN).getByText('100 %', { exact: true })).toBeVisible();
  await viewer(page, PLAN).getByRole('button', { name: 'Terug', exact: true }).click();
  await expect(viewer(page, PLAN)).toHaveCount(0);
  await expect(detail).toBeVisible();

  if (!isMobile) {
    // Escape sluit op desktop de viewer, niet het detail.
    await detail.getByRole('button', { name: PLAN, exact: true }).click();
    await paginaGetekend(viewer(page, PLAN), PLAN);
    await page.keyboard.press('Escape');
    await expect(viewer(page, PLAN)).toHaveCount(0);
    await expect(detail).toBeVisible();
    expect(pad(page)).toBe('/omleidingen/d1');
  }

  // Nog eens Terug: het detail gaat dicht. Op de telefoon blijft de lijst
  // staan; op desktop is het detail geen laag en gaat terug naar de herkomst.
  await page.goBack();
  await expect(detail).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(isMobile ? '/omleidingen' : '/');
  await kanScrollen(page);

  // Na de eerste opening komt de bijlage van het toestel: één download.
  expect(verzoeken).toHaveLength(1);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('omleiding: “Extern openen” gebruikt de oude weg, het portaal blijft staan', async ({ page, baseURL, isMobile }) => {
  await opzet(page, baseURL!);
  await serveer(page, HALTES_PAD, alsPdf(await maakPdf('Haltekaart')));
  const detail = await openOmleiding(page, isMobile);
  await detail.getByRole('button', { name: HALTES, exact: true }).click();
  const laag = viewer(page, HALTES);
  await paginaGetekend(laag, HALTES);

  const pdfUrl = new URL(HALTES_PAD, baseURL!).href;
  const antwoord = page.context().waitForEvent('response', { predicate: (r) => r.url() === pdfUrl && r.request().isNavigationRequest() });
  const popupBelofte = page.waitForEvent('popup');
  await laag.getByRole('button', { name: 'Extern openen', exact: true }).click();
  const popup = await popupBelofte;
  const pdfAntwoord = await antwoord;
  expect(pdfAntwoord.status()).toBe(200);
  expect(pdfAntwoord.request().frame().page()).toBe(popup);
  await popup.close();
  // De viewer en het detail staan er nog.
  await expect(laag).toBeVisible();
  expect(pad(page)).toBe('/omleidingen/d1');
});

test('omleiding: een falende link geeft de foutstaat met twee knoppen, geen rauwe fout', async ({ page, baseURL, isMobile }) => {
  const lijst = await opzet(page, baseURL!);
  const bytes = await maakPdf('Omleidingsplan');
  let hersteld = false;
  const verzoeken = await serveer(page, PLAN_PAD, (route) => (hersteld
    ? route.fulfill({ contentType: 'application/pdf', body: bytes })
    : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(RAUWE_FOUT) })));
  const detail = await openOmleiding(page, isMobile);
  const lijstVooraf = lijst.lijst;

  await detail.getByRole('button', { name: PLAN, exact: true }).click();
  const laag = viewer(page, PLAN);
  await expect(laag.getByRole('heading', { name: 'Bijlage kon niet geladen worden' })).toBeVisible({ timeout: 20_000 });
  await expect(laag).not.toContainText(/InvalidJWT|claim timestamp|statusCode/);
  const opnieuw = laag.getByRole('button', { name: 'Opnieuw proberen', exact: true });
  const extern = laag.getByRole('button', { name: 'Extern openen', exact: true });
  await expect(opnieuw).toBeVisible();
  await expect(extern).toBeVisible();
  // Een laadfout is geen lege staat en geen halve viewer.
  await expect(laag.getByRole('button', { name: 'Inzoomen', exact: true })).toHaveCount(0);
  // De viewer vroeg eerst een verse link aan de server voor hij opgaf.
  expect(lijst.lijst).toBeGreaterThan(lijstVooraf);
  expect(verzoeken.length).toBeGreaterThanOrEqual(1);

  // Extern openen blijft de oude weg, ook vanuit de foutstaat.
  const popupBelofte = page.waitForEvent('popup');
  await extern.click();
  await (await popupBelofte).close();

  // Opnieuw proberen laadt de bijlage zodra de link weer werkt.
  hersteld = true;
  await opnieuw.click();
  await paginaGetekend(laag, PLAN);
  await expect(laag.getByRole('heading', { name: 'Bijlage kon niet geladen worden' })).toHaveCount(0);

  await page.goBack();
  await expect(laag).toHaveCount(0);
  await expect(detail).toBeVisible();
});

test('omleiding: een verlopen link wordt eerst ververst, de oude link gaat nooit naar de opslag', async ({ page, baseURL, isMobile }) => {
  // De lijst van gisteren: de link is een uur geleden verlopen. Elke volgende
  // ophaling van de lijst geeft een verse link (12 uur geldig).
  const oud = link(baseURL!, PLAN_PAD, -3600_000, 'oud');
  const vers = link(baseURL!, PLAN_PAD, 12 * 3600_000, 'vers');
  await opzet(page, baseURL!, { planUrl: (ophaling) => (ophaling === 1 ? oud : vers) });
  const bytes = await maakPdf('Omleidingsplan');
  const verzoeken = await serveer(page, PLAN_PAD, (route) => (route.request().url() === vers
    ? route.fulfill({ contentType: 'application/pdf', body: bytes })
    : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(RAUWE_FOUT) })));
  const detail = await openOmleiding(page, isMobile);
  await detail.getByRole('button', { name: PLAN, exact: true }).click();
  const laag = viewer(page, PLAN);
  await paginaGetekend(laag, PLAN);
  await expect(laag.getByRole('heading', { name: 'Bijlage kon niet geladen worden' })).toHaveCount(0);
  expect(verzoeken).toEqual([vers]);
});

test('update: de bijlage opent in de app; Terug sluit de viewer, nog eens Terug het bericht', async ({ page, baseURL, isMobile }) => {
  await opzet(page, baseURL!);
  await serveer(page, MEDEDELING_PAD, alsPdf(await maakPdf('Mededeling')));
  let popups = 0;
  page.on('popup', () => { popups += 1; });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await gaIntern(page, '/updates');
  await expect(page.getByRole('heading', { level: 1, name: 'Updates' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: new RegExp(UPDATE_TITEL) }).click();
  const detail = page.getByRole(isMobile ? 'dialog' : 'region', { name: UPDATE_TITEL, exact: true });
  await expect(detail).toBeVisible();
  expect(pad(page)).toBe('/updates/u1');

  await detail.getByRole('button', { name: MEDEDELING, exact: true }).click();
  const laag = viewer(page, MEDEDELING);
  await paginaGetekend(laag, MEDEDELING);
  await expect(laag.getByText('1 pagina', { exact: true })).toBeVisible();
  expect(popups).toBe(0);

  await page.goBack();
  await expect(laag).toHaveCount(0);
  await expect(detail).toBeVisible();
  expect(pad(page)).toBe('/updates/u1');

  await page.goBack();
  await expect(detail).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(isMobile ? '/updates' : '/');
  await kanScrollen(page);
});

test('beheer: “Openen” bij een bijlage toont dezelfde viewer boven het bewerkpaneel', async ({ page, baseURL, isMobile }) => {
  await opzet(page, baseURL!, { user: ADMIN });
  await serveer(page, PLAN_PAD, alsPdf(await maakPdf('Omleidingsplan')));
  let popups = 0;
  page.on('popup', () => { popups += 1; });
  await page.goto('/beheer/omleidingen/d1');
  const bewerk = page.getByRole(isMobile ? 'dialog' : 'region', { name: /Omleiding bewerken/ });
  await expect(bewerk).toBeVisible({ timeout: 15_000 });
  const rij = bewerk.getByRole('listitem').filter({ hasText: PLAN });
  await rij.getByRole('button', { name: 'Openen', exact: true }).click();
  const laag = viewer(page, PLAN);
  await paginaGetekend(laag, PLAN);
  expect(popups).toBe(0);

  await page.goBack();
  await expect(laag).toHaveCount(0);
  await expect(bewerk).toBeVisible();
  expect(pad(page)).toBe('/beheer/omleidingen/d1');
  // Het formulier is niet aangeraakt: geen vraag over onbewaarde wijzigingen.
  await expect(page.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' })).toHaveCount(0);
});
