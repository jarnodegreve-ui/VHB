import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { CHAUFFEUR, seed, type Extra, type Fixture } from './helpers';

/**
 * Ronde 6, punt 13: de dag zegt of verlof kan. Voor wie verlof aanvraagt
 * (geen staf): het dagdetail noemt de stand van de dag in woorden, een knop
 * opent de aanvraag met die dag als start, het bereikraster toont de
 * bezettingsstip, de uitkomst van de periode staat vóór type en opmerking, en
 * op de telefoon staan saldo en openstaande aanvragen boven de kalender. Voor
 * staf verandert er niets.
 *
 * De bestandsnaam begint met `datumveld` omdat playwright.config.ts dat patroon
 * al op alle drie de projecten draait (iPhone WebKit en Chromium, desktop).
 *
 * Vaste klok op woensdag 10/03/2027: de dagen hieronder zijn werkdagen zonder
 * feestdag, zodat het aantal verlofdagen niet van de dag van de testrun afhangt.
 */
const NU = new Date('2027-03-10T08:00:00Z');
const VOLZET = '2027-03-17';
const DEELS = '2027-03-18';
const VRIJ = '2027-03-19';
const GEEN = '2027-03-21';
const VERLEDEN = '2027-03-08';
const LATER_VOLZET = '2027-05-12';

/** Aantal afwezigen per dag zoals GET /api/leave/bezetting ze geeft (zonder namen); elke andere dag is 0. */
const AFWEZIG: Record<string, number> = { [VOLZET]: 2, [DEELS]: 1, [LATER_VOLZET]: 2 };
const LIMIETEN = { standaard: 2, periodes: [], perDag: { [GEEN]: 0 } as Record<string, number> };

/** Het antwoord van de server: elke dag van het gevraagde bereik, ook met aantal 0. */
const bezettingAntwoord = (url: string) => {
  const q = new URL(url).searchParams;
  const dagen: Array<{ datum: string; aantal: number; limiet: number }> = [];
  const eind = Date.parse(`${q.get('tot')}T00:00:00Z`);
  for (let ms = Date.parse(`${q.get('van')}T00:00:00Z`); ms <= eind; ms += 86_400_000) {
    const datum = new Date(ms).toISOString().slice(0, 10);
    dagen.push({ datum, aantal: AFWEZIG[datum] ?? 0, limiet: LIMIETEN.perDag[datum] ?? LIMIETEN.standaard });
  }
  return { dagen };
};

const verlof = (id: string, userId: string, van: string, tot: string, status: string) => ({
  id, userId, startDate: van, endDate: tot, type: 'betaald_verlof', status, createdAt: '2027-03-01T08:00:00.000Z',
  ...(status === 'pending' ? {} : { decidedAt: '2027-03-02T08:00:00.000Z' }),
});
/** Eigen verlof van de chauffeur: één wachtende aanvraag en één goedgekeurde dag op de deels vrije dag. */
const EIGEN = [verlof('e1', '42', '2027-04-06', '2027-04-07', 'pending'), verlof('e2', '42', DEELS, DEELS, 'approved')];

const metBezetting = (leave: unknown[] = EIGEN): Extra => (p, request: Request) => {
  if (p.endsWith('/api/leave/bezetting')) return bezettingAntwoord(request.url());
  if (p.endsWith('/api/verlof/limieten')) return LIMIETEN;
  if (p.endsWith('/api/leave') && request.method() === 'GET') return leave;
  return undefined;
};

async function openVerlof(page: Page, user: Fixture, extra?: Extra) {
  await page.clock.setFixedTime(NU);
  await seed(page, { user, extra });
  await page.goto('/verlof');
  await expect(page.getByRole('heading', { name: 'Verlof', level: 1 })).toBeVisible({ timeout: 15_000 });
}

/** De dagcel in de kalender van het scherm (niet het raster van de aanvraag): het label begint met het dagcijfer. */
const kalenderCel = (page: Page, iso: string) => page.getByRole('button', { name: new RegExp(`^${Number(iso.slice(8))}: `) });
const dagdetail = (page: Page) => page.locator('h3', { hasText: /^Verlof op / }).locator('xpath=ancestor::div[contains(@class,"surface-card")][1]');
const stand = (page: Page) => page.locator('[data-dagstand]');
const vanafKnop = (page: Page) => page.getByRole('button', { name: 'Verlof aanvragen vanaf deze dag', exact: true });
const aanvraag = (page: Page) => page.locator('form').filter({ hasText: 'Periode kiezen' });
const rasterCel = (modal: Locator, iso: string) => modal.locator(`[role="gridcell"][data-iso="${iso}"]`);
const telefoon = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;
const boven = async (a: Locator, b: Locator) => (await a.boundingBox())!.y < (await b.boundingBox())!.y;
/** Staat `a` in de opbouw vóór `b`? Dat is de volgorde voor toetsenbord en schermlezer. */
const eerderInOpbouw = async (a: Locator, b: Locator) =>
  a.evaluate((el, andere) => !!(el.compareDocumentPosition(andere as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await b.elementHandle());

test.describe('chauffeur: de dag zegt of het kan', () => {
  test('een volzette dag: de stand in woorden, geen namen, en de knop opent de aanvraag met die dag als start', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await openVerlof(page, CHAUFFEUR, metBezetting());

    // De cel zelf is ongewijzigd: dezelfde tekst in het label als vroeger.
    await expect(kalenderCel(page, VOLZET)).toHaveAttribute('aria-label', '17: volzet, 2 van 2 afwezig');
    await kalenderCel(page, VOLZET).click();
    await expect(stand(page)).toHaveText('Volzet, 2 van 2 afwezig');
    await expect(stand(page)).toHaveAttribute('data-dagstand', 'volzet');
    await expect(page.getByText('Geen afwezigen')).toHaveCount(0);
    await expect(dagdetail(page).getByText(/Du Priez|Van Haute/)).toHaveCount(0);

    // De knop opent het bestaande venster met die dag als start, nog zonder einde.
    await vanafKnop(page).click();
    const modal = aanvraag(page);
    await expect(modal).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Verlof aanvragen' })).toBeVisible();
    await expect(modal.getByLabel('Startdatum', { exact: true })).toHaveAttribute('data-datum', VOLZET);
    await expect(modal.getByLabel('Einddatum', { exact: true })).not.toHaveAttribute('data-datum', /.+/);

    // Alleen een startdatum uit de knop is geen onbewaarde invoer: sluiten vraagt niets.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Wijzigingen niet bewaren?' })).toHaveCount(0);
    await vanafKnop(page).click();
    await expect(modal).toBeVisible();

    // Het raster toont dezelfde stip en dezelfde tekst als de kalender; elke dag blijft kiesbaar.
    const volzet = rasterCel(modal, VOLZET);
    await expect(volzet).toHaveAttribute('data-bezetting', 'volzet');
    await expect(volzet).toHaveAttribute('aria-label', /^wo 17 mrt 2027, volzet, 2 van 2 afwezig, begin van de periode$/);
    await expect(volzet.locator('span[aria-hidden="true"]')).toBeVisible();
    await expect(volzet.locator('span[aria-hidden="true"]')).toHaveClass(/bg-red-500/);
    await expect(volzet).toBeEnabled();
    await expect(rasterCel(modal, DEELS)).toHaveAttribute('aria-label', 'do 18 mrt 2027, deels vrij, 1 van 2 afwezig');
    await expect(rasterCel(modal, DEELS).locator('span[aria-hidden="true"]')).toHaveClass(/bg-amber-500/);
    await expect(rasterCel(modal, VRIJ)).toHaveAttribute('aria-label', 'vr 19 mrt 2027, vrij');
    await expect(rasterCel(modal, VRIJ).locator('span[aria-hidden="true"]')).toHaveClass(/bg-emerald-500/);
    await expect(rasterCel(modal, GEEN)).toHaveAttribute('aria-label', 'zo 21 mrt 2027, geen verlof mogelijk');
    await expect(rasterCel(modal, GEEN)).toBeEnabled();
    // Een dag in het verleden is uitgeschakeld en krijgt geen stip.
    await expect(rasterCel(modal, VERLEDEN)).toBeDisabled();
    await expect(rasterCel(modal, VERLEDEN)).not.toHaveAttribute('data-bezetting', /.+/);

    // Eén dag verlof op de volzette dag: de uitkomst staat direct onder de periode, vóór type en opmerking.
    await volzet.click();
    await expect(modal.getByLabel('Einddatum', { exact: true })).toHaveAttribute('data-datum', VOLZET);
    const dagen = modal.getByText('1 verlofdag aangevraagd');
    const limiet = modal.getByText('Boven de verloflimiet op 1 dag');
    await expect(dagen).toBeVisible();
    await expect(limiet).toBeVisible();
    await expect(modal.getByText(/resterend na deze aanvraag/)).toBeVisible();
    const periode = modal.getByText('Gekozen periode', { exact: true });
    const type = modal.getByText('Type verlof', { exact: true });
    const opmerking = modal.getByText('Opmerking', { exact: true });
    for (const uitkomst of [dagen, limiet]) {
      expect(await boven(periode, uitkomst), 'uitkomst onder de gekozen periode').toBe(true);
      expect(await boven(uitkomst, type), 'uitkomst boven Type verlof').toBe(true);
      expect(await eerderInOpbouw(uitkomst, type), 'uitkomst vóór Type verlof in de opbouw').toBe(true);
    }
    expect(await boven(type, opmerking)).toBe(true);

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('elke stand in het dagdetail, eigen verlof blijft staan, en de knop alleen vanaf vandaag en niet op een dag zonder verlof', async ({ page }) => {
    await openVerlof(page, CHAUFFEUR, metBezetting());

    await kalenderCel(page, DEELS).click();
    await expect(stand(page)).toHaveText('Nog 1 plaats, 1 van 2 afwezig');
    // Zijn eigen goedgekeurde verlof op die dag staat er zoals vroeger.
    await expect(dagdetail(page).getByText('Test Chauffeur')).toBeVisible();
    await expect(vanafKnop(page)).toBeVisible();

    await kalenderCel(page, VRIJ).click();
    await expect(stand(page)).toHaveText('Vrij, niemand afwezig');
    await expect(dagdetail(page).getByText('Test Chauffeur')).toHaveCount(0);
    await expect(vanafKnop(page)).toBeVisible();

    await kalenderCel(page, GEEN).click();
    await expect(stand(page)).toHaveText('Geen verlof mogelijk op deze dag');
    await expect(stand(page)).toHaveAttribute('data-dagstand', 'geen');
    // Geen knop onder "Geen verlof mogelijk": dat spreekt zichzelf tegen. In het venster blijft de dag kiesbaar (eerste test).
    await expect(vanafKnop(page)).toHaveCount(0);

    // Een dag vóór vandaag: wel de stand, geen knop om er verlof te starten.
    await kalenderCel(page, VERLEDEN).click();
    await expect(stand(page)).toHaveText('Vrij, niemand afwezig');
    await expect(vanafKnop(page)).toHaveCount(0);
    await expect(page.getByText('Geen afwezigen')).toHaveCount(0);
  });

  test('bezetting niet geladen of mislukt: geen stand en geen stippen, nooit "vrij"', async ({ page }) => {
    // De standaardfixture geeft voor geen enkele dag een aantal; de limieten zijn er wel.
    const antwoord = page.waitForResponse((r) => r.url().includes('/api/leave/bezetting'));
    await openVerlof(page, CHAUFFEUR, (p) => (p.endsWith('/api/verlof/limieten') ? LIMIETEN : undefined));
    await antwoord;
    await kalenderCel(page, VRIJ).click();
    await expect(dagdetail(page)).toBeVisible();
    await expect(stand(page)).toHaveCount(0);
    await expect(dagdetail(page).getByText('De bezetting van deze dag is niet geladen.')).toBeVisible();
    await expect(dagdetail(page).getByText(/vrij|volzet|afwezig/i)).toHaveCount(0);
    await vanafKnop(page).click();
    const modal = aanvraag(page);
    await expect(rasterCel(modal, VRIJ)).toHaveAttribute('aria-label', 'vr 19 mrt 2027, begin van de periode');
    await expect(modal.locator('[data-bezetting]')).toHaveCount(0);
    await expect(modal.locator('[role="gridcell"] span')).toHaveCount(0);
  });

  test('bezetting laden mislukt (500): geen stand in het dagdetail', async ({ page }) => {
    await page.clock.setFixedTime(NU);
    await seed(page, { user: CHAUFFEUR, extra: (p) => (p.endsWith('/api/verlof/limieten') ? LIMIETEN : undefined) });
    await page.route('**/api/leave/bezetting**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'kapot' }) }));
    // Pas kijken nadat het antwoord er is: zonder stand vóór het antwoord bewijst niets.
    const mislukt = page.waitForResponse((r) => r.url().includes('/api/leave/bezetting') && r.status() === 500);
    await page.goto('/verlof');
    await mislukt;
    await kalenderCel(page, VOLZET).click();
    await expect(dagdetail(page)).toBeVisible();
    await expect(stand(page)).toHaveCount(0);
    await expect(dagdetail(page).getByText(/vrij|volzet|afwezig/i)).toHaveCount(0);
    await expect(page.getByText('Geen afwezigen')).toHaveCount(0);
    await expect(vanafKnop(page)).toBeVisible();
    // De knop volgt de limiet van de dag, niet de telling: op een dag met limiet 0 staat hij er ook zonder telling niet.
    await kalenderCel(page, GEEN).click();
    await expect(dagdetail(page).getByText('De bezetting van deze dag is niet geladen.')).toBeVisible();
    await expect(vanafKnop(page)).toHaveCount(0);
  });

  test('limieten laden mislukt (500): geen stand, geen stippen en geen knop, de limiet wordt niet geraden', async ({ page }) => {
    await page.clock.setFixedTime(NU);
    await seed(page, { user: CHAUFFEUR, extra: metBezetting() });
    await page.route('**/api/verlof/limieten**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'kapot' }) }));
    const mislukt = page.waitForResponse((r) => r.url().includes('/api/verlof/limieten') && r.status() === 500);
    const bezetting = page.waitForResponse((r) => r.url().includes('/api/leave/bezetting') && r.status() === 200);
    await page.goto('/verlof');
    await mislukt;
    await bezetting;

    // De kalendercel is ongewijzigd: ze kleurt zoals vroeger met de standaard van 2.
    await expect(kalenderCel(page, DEELS)).toHaveAttribute('aria-label', '18: deels vrij, 1 van 2 afwezig');
    // Het dagdetail maakt er geen zin van: met de echte limiet kan dit "Volzet" zijn.
    await kalenderCel(page, DEELS).click();
    await expect(dagdetail(page).getByText('De bezetting van deze dag is niet geladen.')).toBeVisible();
    await expect(stand(page)).toHaveCount(0);
    await expect(dagdetail(page).getByText(/Nog \d|Volzet|Vrij,|Geen verlof mogelijk/)).toHaveCount(0);
    // Zijn eigen verlof op die dag staat er wel.
    await expect(dagdetail(page).getByText('Test Chauffeur')).toBeVisible();
    await expect(vanafKnop(page)).toHaveCount(0);
    // Een dag die in het echt limiet 0 heeft: geen "Vrij", geen knop.
    await kalenderCel(page, GEEN).click();
    await expect(dagdetail(page).getByText('De bezetting van deze dag is niet geladen.')).toBeVisible();
    await expect(stand(page)).toHaveCount(0);
    await expect(vanafKnop(page)).toHaveCount(0);

    // Aanvragen blijft kunnen via de knop bovenaan; het raster toont dan geen stippen.
    await page.getByRole('button', { name: 'Verlof aanvragen', exact: true }).click();
    const modal = aanvraag(page);
    await expect(modal).toBeVisible();
    await expect(rasterCel(modal, VOLZET)).toHaveAttribute('aria-label', 'wo 17 mrt 2027');
    await expect(modal.locator('[data-bezetting]')).toHaveCount(0);
    await expect(modal.locator('[role="gridcell"] span')).toHaveCount(0);
    await expect(rasterCel(modal, VOLZET)).toBeEnabled();
  });

  test('limieten komen laat: eerst geen stand en geen knop, daarna de echte stand; de knop verschijnt nooit eerst om dan te verdwijnen', async ({ page }) => {
    await page.clock.setFixedTime(NU);
    await seed(page, { user: CHAUFFEUR, extra: metBezetting() });
    let laatLos!: () => void;
    const poort = new Promise<void>((klaar) => { laatLos = klaar; });
    await page.route('**/api/verlof/limieten**', async (route) => {
      await poort;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIMIETEN) });
    });
    const bezetting = page.waitForResponse((r) => r.url().includes('/api/leave/bezetting') && r.status() === 200);
    await page.goto('/verlof');
    await bezetting;

    // De telling is er, de limieten nog niet: op de dag met limiet 0 geen "Vrij" en geen knop.
    await expect(kalenderCel(page, VOLZET)).toHaveAttribute('aria-label', '17: volzet, 2 van 2 afwezig');
    await kalenderCel(page, GEEN).click();
    await expect(dagdetail(page).getByText('De bezetting van deze dag is niet geladen.')).toBeVisible();
    await expect(stand(page)).toHaveCount(0);
    await expect(vanafKnop(page)).toHaveCount(0);

    laatLos();
    await expect(stand(page)).toHaveText('Geen verlof mogelijk op deze dag');
    await expect(vanafKnop(page)).toHaveCount(0);
    await expect(page.getByText('De bezetting van deze dag is niet geladen.')).toHaveCount(0);
    // Op een gewone dag staan stand en knop er nu allebei.
    await kalenderCel(page, DEELS).click();
    await expect(stand(page)).toHaveText('Nog 1 plaats, 1 van 2 afwezig');
    await expect(vanafKnop(page)).toBeVisible();
  });

  test('de start uit de knop blijft niet hangen: na gewoon sluiten begint "Verlof aanvragen" zonder startdatum', async ({ page }) => {
    await openVerlof(page, CHAUFFEUR, metBezetting());
    const modal = aanvraag(page);
    const start = modal.getByLabel('Startdatum', { exact: true });
    const kopknop = page.getByRole('button', { name: 'Verlof aanvragen', exact: true });

    // Het dagdetail blijft open onder het venster; een tweede tik op de dag zou het sluiten.
    await kalenderCel(page, DEELS).click();
    for (const sluit of ['Escape', 'kruisje'] as const) {
      await vanafKnop(page).click();
      await expect(start).toHaveAttribute('data-datum', DEELS);
      if (sluit === 'Escape') await page.keyboard.press('Escape');
      else await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click();
      await expect(modal).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Wijzigingen niet bewaren?' })).toHaveCount(0);

      // De knop bovenaan: geen start die de chauffeur daar niet koos.
      await kopknop.click();
      await expect(modal).toBeVisible();
      await expect(start).not.toHaveAttribute('data-datum', /.+/);
      await expect(modal.getByText('Kies de startdatum.')).toBeVisible();
      await expect(modal.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
    }

    // Wat hij zelf wijzigde na de knop blijft beschermd door de vraag, zoals vroeger.
    await vanafKnop(page).click();
    await rasterCel(modal, VRIJ).click();
    await expect(modal.getByLabel('Einddatum', { exact: true })).toHaveAttribute('data-datum', VRIJ);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Wijzigingen niet bewaren?' })).toBeVisible();
    await page.getByRole('button', { name: 'Niet bewaren', exact: true }).click();
    await expect(modal).toBeHidden();
    await kopknop.click();
    await expect(start).not.toHaveAttribute('data-datum', /.+/);
  });

  test('de limietwaarschuwing komt ook als de bezetting van de periode pas na de keuze binnenkomt', async ({ page }) => {
    await page.clock.setFixedTime(NU);
    await seed(page, { user: CHAUFFEUR, extra: metBezetting() });
    // Alles van mei blijft hangen tot de test het loslaat.
    let laatLos!: () => void;
    const poort = new Promise<void>((klaar) => { laatLos = klaar; });
    await page.route('**/api/leave/bezetting**', async (route) => {
      const url = route.request().url();
      if (new URL(url).searchParams.get('van')?.startsWith('2027-05')) await poort;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bezettingAntwoord(url)) });
    });
    await page.goto('/verlof');
    await page.getByRole('button', { name: 'Verlof aanvragen', exact: true }).click();
    const modal = aanvraag(page);
    const van = modal.getByLabel('Startdatum', { exact: true });
    const tot = modal.getByLabel('Einddatum', { exact: true });
    await van.fill('12/05/2027');
    await van.press('Tab');
    await tot.fill('13/05/2027');
    await tot.blur();
    await expect(modal.getByText('2 verlofdagen aangevraagd')).toBeVisible();
    await expect(rasterCel(modal, LATER_VOLZET)).not.toHaveAttribute('data-bezetting', /.+/);
    await expect(modal.getByText(/Boven de verloflimiet/)).toHaveCount(0);
    laatLos();
    await expect(rasterCel(modal, LATER_VOLZET)).toHaveAttribute('data-bezetting', 'volzet');
    await expect(modal.getByText('Boven de verloflimiet op 1 dag')).toBeVisible();
  });

  test('volgorde: op de telefoon saldo en openstaande aanvragen boven de kalender, op desktop zoals vroeger', async ({ page }) => {
    await openVerlof(page, CHAUFFEUR, metBezetting());
    const saldo = page.getByText('Verlofbalans', { exact: true });
    const openstaand = page.getByText('Mijn openstaande aanvragen', { exact: true });
    const gepland = page.getByText('Mijn geplande verloven', { exact: true });
    const kalender = kalenderCel(page, VOLZET);
    await expect(saldo).toBeVisible();
    // Eén keer gemount, nooit een verborgen kopie.
    await expect(saldo).toHaveCount(1);
    await expect(openstaand).toHaveCount(1);
    await expect(page.locator('[data-record="e1"]')).toHaveCount(1);

    if (telefoon(page)) {
      // Zichtbare volgorde én opbouw: saldo, openstaande aanvragen, kalender, de rest.
      expect(await boven(saldo, openstaand)).toBe(true);
      expect(await boven(openstaand, kalender)).toBe(true);
      expect(await boven(kalender, gepland)).toBe(true);
      expect(await eerderInOpbouw(saldo, openstaand)).toBe(true);
      expect(await eerderInOpbouw(openstaand, kalender)).toBe(true);
      expect(await eerderInOpbouw(kalender, gepland)).toBe(true);
    } else {
      // Twee kolommen: kalender links, saldo en aanvragen rechts ernaast, de kalender eerst in de opbouw.
      const k = (await kalender.boundingBox())!;
      const s = (await saldo.boundingBox())!;
      expect(k.x).toBeLessThan(s.x);
      expect(s.y).toBeLessThan(k.y + 200);
      expect(await boven(saldo, openstaand)).toBe(true);
      expect(await boven(openstaand, gepland)).toBe(true);
      expect(await eerderInOpbouw(kalender, saldo)).toBe(true);
      expect(await eerderInOpbouw(saldo, openstaand)).toBe(true);
      expect(await eerderInOpbouw(openstaand, gepland)).toBe(true);
    }
  });

  test('de grens ligt op 1024 px: op 1023 staat het saldo boven de kalender, op 1024 ernaast', async ({ page }) => {
    test.skip(telefoon(page), 'De breedte van een telefoonproject ligt vast; de grens meet het desktopproject.');
    await page.setViewportSize({ width: 1023, height: 900 });
    await openVerlof(page, CHAUFFEUR, metBezetting());
    const saldo = page.getByText('Verlofbalans', { exact: true });
    const openstaand = page.getByText('Mijn openstaande aanvragen', { exact: true });
    const kalender = kalenderCel(page, VOLZET);
    await expect(saldo).toBeVisible();
    expect(await boven(saldo, openstaand)).toBe(true);
    expect(await boven(openstaand, kalender)).toBe(true);
    expect(await eerderInOpbouw(saldo, kalender)).toBe(true);
    expect(await eerderInOpbouw(openstaand, kalender)).toBe(true);

    await page.setViewportSize({ width: 1024, height: 900 });
    // Twee kolommen: de kalender links en eerst in de opbouw, het saldo rechts ernaast.
    await expect.poll(async () => eerderInOpbouw(kalender, saldo)).toBe(true);
    const k = (await kalender.boundingBox())!;
    const s = (await saldo.boundingBox())!;
    expect(k.x).toBeLessThan(s.x);
    expect(s.y).toBeLessThan(k.y + 200);
    expect(await boven(saldo, openstaand)).toBe(true);
    await expect(saldo).toHaveCount(1);
    await expect(openstaand).toHaveCount(1);
  });

  test('een link naar een aanvraag die er niet is: de melding blijft het eerste wat je ziet', async ({ page }) => {
    await page.clock.setFixedTime(NU);
    await seed(page, { user: CHAUFFEUR, extra: metBezetting() });
    await page.goto('/verlof/bestaat-niet');
    const melding = page.getByText('Deze verlofaanvraag is niet beschikbaar');
    const saldo = page.getByText('Verlofbalans', { exact: true });
    await expect(melding).toBeVisible();
    await expect(melding).toHaveCount(1);
    await expect(melding).toBeInViewport();
    if (telefoon(page)) {
      // Op de telefoon staat het saldo nu boven de kalender; de melding gaat mee naar boven.
      expect(await boven(melding, saldo)).toBe(true);
      expect(await eerderInOpbouw(melding, saldo)).toBe(true);
    }
    expect(await boven(melding, kalenderCel(page, VOLZET))).toBe(true);
    expect(await eerderInOpbouw(melding, kalenderCel(page, VOLZET))).toBe(true);
  });
});

test.describe('planner: niets verandert', () => {
  const PLANNER = { id: '7', name: 'Planner E2E', role: 'planner', employeeId: 'VHB-000007', email: 'planner@vhb.be', isActive: true, verlofBudget: 20 };
  /** Goedgekeurd verlof van een collega: staf ziet namen en rekent de bezetting zelf. */
  const TEAM = [verlof('t1', '43', VOLZET, VOLZET, 'approved')];

  test('dagdetail met namen en "Geen afwezigen", geen stand en geen knop; kalender blijft boven het saldo', async ({ page }) => {
    await openVerlof(page, PLANNER, metBezetting(TEAM));

    await expect(kalenderCel(page, VOLZET)).toHaveAttribute('aria-label', '17: deels vrij, 1 van 2 afwezig');
    await kalenderCel(page, VOLZET).click();
    await expect(dagdetail(page).getByText('Alex Du Priez')).toBeVisible();
    await expect(dagdetail(page).getByRole('button', { name: 'Annuleren' })).toBeVisible();
    await expect(stand(page)).toHaveCount(0);
    await expect(vanafKnop(page)).toHaveCount(0);

    await kalenderCel(page, VRIJ).click();
    await expect(dagdetail(page).getByText('Geen afwezigen op deze dag.')).toBeVisible();
    await expect(stand(page)).toHaveCount(0);
    await expect(vanafKnop(page)).toHaveCount(0);
    await expect(page.getByText('De bezetting van deze dag is niet geladen.')).toHaveCount(0);

    // De volgorde van de blokken is die van vroeger, op elke breedte: de kalender eerst.
    const saldo = page.getByText('Verlofbalans', { exact: true });
    expect(await eerderInOpbouw(kalenderCel(page, VOLZET), saldo)).toBe(true);
    if (telefoon(page)) expect(await boven(kalenderCel(page, VOLZET), saldo)).toBe(true);
  });

  test('verlof registreren: geen stippen in het raster en de uitkomst staat nog onder Opmerking', async ({ page }) => {
    await openVerlof(page, PLANNER, metBezetting(TEAM));
    await page.getByRole('button', { name: 'Verlof registreren', exact: true }).click();
    const modal = aanvraag(page);
    await expect(modal).toBeVisible();
    await modal.getByLabel(/Chauffeur/).selectOption(CHAUFFEUR.id as string);
    await rasterCel(modal, VOLZET).click();
    await rasterCel(modal, DEELS).click();
    await expect(rasterCel(modal, VOLZET)).toHaveAttribute('aria-label', 'wo 17 mrt 2027, begin van de periode');
    await expect(modal.locator('[data-bezetting]')).toHaveCount(0);
    await expect(modal.locator('[role="gridcell"] span')).toHaveCount(0);
    const dagen = modal.getByText('2 verlofdagen vast te leggen');
    await expect(dagen).toBeVisible();
    const opmerking = modal.getByText('Opmerking', { exact: true });
    expect(await boven(modal.getByText('Type verlof', { exact: true }), opmerking)).toBe(true);
    expect(await boven(opmerking, dagen), 'uitkomst onder Opmerking').toBe(true);
    expect(await eerderInOpbouw(opmerking, dagen)).toBe(true);
  });
});
