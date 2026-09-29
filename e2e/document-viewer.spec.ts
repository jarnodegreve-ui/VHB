import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ADMIN, CHAUFFEUR, gaIntern, kanScrollen, seed, type Fixture } from './helpers';

/**
 * Persoonlijke documenten (loonbrieven, attesten) in de app, zonder iets op
 * het toestel (29-09; src/components/BijlageViewer.tsx met soort "document").
 * Draait op de telefoon (Chromium en WebKit) en op desktop.
 *
 * Wat hier telt: een PDF opent in een laag boven Documenten, met de echte
 * pdfjs-render; Terug sluit alleen de viewer, nog eens Terug verlaat het
 * scherm; de leesbevestiging gaat pas weg als de PDF in beeld staat, nooit bij
 * een mislukte opening; een foto gaat de oude weg (extern); zonder bereik
 * opent een document niet, met de uitleg waarom. In het beheer opent een PDF
 * in dezelfde viewer, boven het documentenvenster, zonder leesbevestiging.
 *
 * De service worker staat in deze projecten uit; dat er niets in Cache
 * Storage belandt en dat de aanvraag no-store gebruikt, staat in
 * e2e/pwa.spec.ts (mét service worker).
 */

const PDF_PAD = '/__test__/opslag/user-documents/42/3f2a-loonbrief.pdf';
const FOTO_PAD = '/__test__/opslag/user-documents/42/9c1e-rijbewijs.png';
const LOONBRIEF = 'Loonbrief september.pdf';
const FOTO = 'Rijbewijs.png';
const RAUWE_FOUT = { statusCode: '400', error: 'InvalidJWT', message: '"exp" claim timestamp check failed' };
// Eén pixel, genoeg voor een foto die extern opent.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function maakPdf(kop: string, paginas = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i++) pdf.addPage([595, 842]).drawText(`${kop}, blad ${i}`, { x: 40, y: 780, size: 18, font });
  return Buffer.from(await pdf.save());
}

type Staat = { bevestigd: string[]; lijstVan: string[] };

/** Sessie en API: de documenten van de chauffeur, en elke leesbevestiging. */
async function opzet(page: Page, baseURL: string, user: Fixture = CHAUFFEUR): Promise<Staat> {
  const staat: Staat = { bevestigd: [], lijstVan: [] };
  const urlVan = (pad: string) => new URL(pad, baseURL).href;
  await seed(page, {
    user,
    extra: (pad, request) => {
      if (pad.endsWith('/opened') && request.method() === 'POST') {
        staat.bevestigd.push(pad.split('/api/documents/')[1].replace('/opened', ''));
        return {};
      }
      if (pad.endsWith('/api/documents') && request.method() === 'GET') {
        staat.lijstVan.push(new URL(request.url()).search);
        return [
          { id: 'd-loon', userId: '42', filename: LOONBRIEF, category: 'Loonbrief', sizeBytes: 182_000, uploadedAt: '2026-09-25T08:00:00Z', uploadedBy: 'Admin', url: urlVan(PDF_PAD), openedAt: null },
          { id: 'd-foto', userId: '42', filename: FOTO, category: 'Attest', sizeBytes: 64_000, uploadedAt: '2026-09-20T08:00:00Z', uploadedBy: 'Admin', url: urlVan(FOTO_PAD), openedAt: null },
        ];
      }
      return undefined;
    },
  });
  return staat;
}

/** Eén pad in de opslag beantwoorden; geeft de lijst van verzoeken terug. */
async function serveer(page: Page, pad: string, antwoord: (route: Route) => Promise<void> | void) {
  const verzoeken: string[] = [];
  await page.context().route(`**${pad}*`, async (route) => {
    verzoeken.push(route.request().url());
    await antwoord(route);
  });
  return verzoeken;
}
const alsPdf = (bytes: Buffer) => (route: Route) => route.fulfill({ contentType: 'application/pdf', headers: { 'cache-control': 'max-age=3600' }, body: bytes });

const pad = (page: Page) => new URL(page.url()).pathname;
const viewer = (page: Page) => page.getByRole('dialog', { name: LOONBRIEF, exact: true });

/** De pagina staat er echt: PDF-papier is opaak, een leeg canvas transparant. */
async function paginaGetekend(laag: Locator) {
  const canvas = laag.getByRole('img', { name: `Pagina 1 van ${LOONBRIEF}`, exact: true });
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.getContext('2d')!.getImageData(10, 10, 1, 1).data[3]), { timeout: 20_000 }).toBe(255);
}

/** Dashboard → Documenten (intern), zodat Terug een vorige pagina heeft. */
async function naarDocumenten(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await gaIntern(page, '/documenten');
  await expect(page.getByRole('heading', { level: 1, name: 'Documenten' })).toBeVisible({ timeout: 15_000 });
}
const openKnop = (page: Page, naam: string) => page.getByRole('button', { name: `Open ${naam}`, exact: true });

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('documenten: een PDF opent in de app; bevestigd pas als hij in beeld staat; Terug sluit alleen de viewer', async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const staat = await opzet(page, baseURL!);
  let geleverd = false;
  let loslaten!: () => void;
  const mag = new Promise<void>((r) => { loslaten = r; });
  const verzoeken = await serveer(page, PDF_PAD, async (route) => {
    // De opslag houdt het antwoord even vast: zo is te zien dat de tik zelf
    // nog niets bevestigt.
    await mag;
    geleverd = true;
    await alsPdf(await maakPdf('Loonbrief', 2))(route);
  });
  let popups = 0;
  page.on('popup', () => { popups += 1; });
  await naarDocumenten(page);

  await openKnop(page, LOONBRIEF).click();
  const laag = viewer(page);
  await expect(laag).toBeVisible();
  await expect(laag.getByText('Document laden…').first()).toBeVisible();
  await expect.poll(() => verzoeken.length).toBe(1);
  expect(staat.bevestigd).toEqual([]);
  loslaten();
  await paginaGetekend(laag);
  expect(geleverd).toBe(true);
  await expect(laag.getByText('2 pagina’s')).toBeVisible();
  await expect.poll(() => staat.bevestigd).toEqual(['d-loon']);
  // In de app: geen nieuw venster, en het portaal staat nog op Documenten.
  expect(popups).toBe(0);
  expect(pad(page)).toBe('/documenten');
  await expect(laag.getByRole('button', { name: 'Terug', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(laag.getByRole('button', { name: 'Extern openen', exact: true })).toBeInViewport({ ratio: 1 });

  // Terug (browser of terugveeg) sluit alleen de viewer.
  await page.goBack();
  await expect(laag).toHaveCount(0);
  expect(pad(page)).toBe('/documenten');
  await expect(openKnop(page, LOONBRIEF)).toBeVisible();

  // Nog eens openen: niets bewaard, dus opnieuw van de opslag; de terugknop
  // in de viewer sluit hem zonder dode terugstap.
  await openKnop(page, LOONBRIEF).click();
  await paginaGetekend(viewer(page));
  expect(verzoeken).toHaveLength(2);
  await viewer(page).getByRole('button', { name: 'Terug', exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);

  // Nog eens Terug: nu verlaat je Documenten.
  await page.goBack();
  await expect.poll(() => pad(page)).toBe('/');
  await kanScrollen(page);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('documenten: laadt de PDF niet, dan een foutstaat en geen bevestiging; een foto gaat de oude weg', async ({ page, baseURL }) => {
  const staat = await opzet(page, baseURL!);
  await serveer(page, PDF_PAD, (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(RAUWE_FOUT) }));
  await serveer(page, FOTO_PAD, (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await naarDocumenten(page);
  const lijstVooraf = staat.lijstVan.length;

  await openKnop(page, LOONBRIEF).click();
  const laag = viewer(page);
  await expect(laag.getByRole('heading', { name: 'Document kon niet geladen worden' })).toBeVisible({ timeout: 20_000 });
  await expect(laag).not.toContainText(/InvalidJWT|claim timestamp|statusCode/);
  await expect(laag.getByRole('button', { name: 'Opnieuw proberen', exact: true })).toBeVisible();
  await expect(laag.getByRole('button', { name: 'Extern openen', exact: true })).toBeEnabled();
  // De viewer vroeg eerst een verse link aan de documentenlijst voor hij opgaf.
  expect(staat.lijstVan.length).toBeGreaterThan(lijstVooraf);
  await page.waitForTimeout(300);
  expect(staat.bevestigd).toEqual([]);
  await laag.getByRole('button', { name: 'Terug', exact: true }).click();
  await expect(laag).toHaveCount(0);

  // Een foto opent zoals vroeger buiten de app, en telt meteen als geopend.
  const fotoUrl = new URL(FOTO_PAD, baseURL!).href;
  const popupBelofte = page.waitForEvent('popup');
  await openKnop(page, FOTO).click();
  const popup = await popupBelofte;
  await expect.poll(() => popup.url()).toBe(fotoUrl);
  await popup.close();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => staat.bevestigd).toEqual(['d-foto']);
});

test('documenten: zonder bereik opent een persoonlijk document niet, met de uitleg waarom', async ({ page, baseURL, context }) => {
  await opzet(page, baseURL!);
  const verzoeken = await serveer(page, PDF_PAD, alsPdf(await maakPdf('Loonbrief')));
  await naarDocumenten(page);
  // Eén keer met bereik, zodat de viewer geladen is (in de PWA zit hij in de
  // precache van de service worker, zie pwa.spec.ts).
  await openKnop(page, LOONBRIEF).click();
  await paginaGetekend(viewer(page));
  await viewer(page).getByRole('button', { name: 'Terug', exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);
  expect(verzoeken).toHaveLength(1);

  // Bereik weg. De routes vangen ook dan nog aanvragen op, dus elke
  // aanvraag naar de opslag zou hier geteld worden. De API breekt af (op
  // paginaniveau, zodat dat wint van de fixtures).
  const afbreken = (route: Route) => route.abort('internetdisconnected');
  await page.route('**/api/**', afbreken);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await openKnop(page, LOONBRIEF).click();
  const laag = viewer(page);
  await expect(laag.getByRole('heading', { name: 'Document kon niet geladen worden' })).toBeVisible({ timeout: 10_000 });
  await expect(laag.getByText(/Persoonlijke documenten openen alleen met bereik: ze worden niet op dit toestel bewaard\./)).toBeVisible();
  await expect(laag.getByRole('button', { name: 'Extern openen', exact: true })).toBeDisabled();
  await expect(laag.getByRole('img', { name: `Pagina 1 van ${LOONBRIEF}` })).toHaveCount(0);
  expect(verzoeken).toHaveLength(1);

  // Weer bereik: opnieuw proberen opent het document.
  await context.setOffline(false);
  await page.unroute('**/api/**', afbreken);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await laag.getByRole('button', { name: 'Opnieuw proberen', exact: true }).click();
  await paginaGetekend(laag);
  expect(verzoeken).toHaveLength(2);
});

test('beheer: “Openen” bij een PDF toont hem in de app boven het documentenvenster, zonder leesbevestiging', async ({ page, baseURL, isMobile }) => {
  const staat = await opzet(page, baseURL!, ADMIN);
  await serveer(page, PDF_PAD, alsPdf(await maakPdf('Loonbrief')));
  let popups = 0;
  page.on('popup', () => { popups += 1; });
  await page.goto('/beheer/gebruikers');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Meer acties voor Test Chauffeur' }).first().click();
  await page.getByRole('menuitem', { name: 'Documenten beheren' }).click();
  const venster = page.getByRole('dialog', { name: 'Documenten, Test Chauffeur' });
  await expect(venster).toBeVisible();
  await expect(venster.getByText(LOONBRIEF, { exact: false })).toBeVisible();
  // De lijst volgt de volgorde van de server: eerst de loonbrief, dan de foto.
  const openLoonbrief = venster.getByRole('button', { name: 'Openen', exact: true }).first();
  await openLoonbrief.click();
  const laag = viewer(page);
  await paginaGetekend(laag);
  expect(popups).toBe(0);
  // De verse link zou uit de lijst van deze gebruiker komen.
  expect(staat.lijstVan).toContain('?userId=42');

  // Terug sluit alleen de viewer; het documentenvenster blijft open.
  await page.goBack();
  await expect(laag).toHaveCount(0);
  await expect(venster).toBeVisible();
  await page.waitForTimeout(300);
  expect(staat.bevestigd).toEqual([]);
  if (!isMobile) {
    await openLoonbrief.click();
    await paginaGetekend(viewer(page));
    await page.keyboard.press('Escape');
    await expect(viewer(page)).toHaveCount(0);
    await expect(venster).toBeVisible();
  }
});
