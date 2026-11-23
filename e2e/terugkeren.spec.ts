import { test, expect, type BrowserContext, type Page, type Request, type Route, type TestInfo } from '@playwright/test';
import { ADMIN, CHAUFFEUR, gaIntern, seed, wachtOpAnimaties, type Extra } from './helpers';
import { apiFixtures, dayOffset } from '../scripts/audit-fixtures.mjs';
import { logIn } from './deeplinkHulp';
import { begrensMaandbord, eersteZichtbareDag } from '../shared/maandplanningTerugblik';

/**
 * Terugkeren naar een scherm (ronde 6, punt 22, deel 1: Vervaldata). Wie
 * binnen vijf minuten terugkomt, ziet het laatste antwoord meteen, met de tijd
 * van die lezing in de regel, terwijl de verversing loopt
 * (src/lib/schermGeheugen.ts + `onthoudenOm` van useZelfLadend). Na vijf
 * minuten, na een eigen schrijfactie sinds die lezing en na een afmelding:
 * het skelet zoals vroeger. Een bewerking start nooit vanuit onthouden
 * gegevens: een klik zet alleen het adres, het venster opent pas na een
 * geslaagde lezing van dit bezoek.
 *
 * Navigatie zoals een mens: de dock met een tik (telefoon, planner) of de
 * zijbalk met de muis (desktop, admin). De klok loopt (`clock.install`) en
 * springt met `setSystemTime` vooruit, zodat er geen timers mee afgaan en de
 * onthouden en de nieuwe tijd verschillen. Nooit een stilstaande klok: dan
 * delen elke markering en elk vertrek één tijdstip.
 */

const PLANNER = { id: '7', name: 'Pieter Planner', role: 'planner', employeeId: 'VHB-000007', email: 'pieter@vhb.be', isActive: true };
const IPHONE = 'iPhone 13 (chromium)';
const WEBKIT = 'iPhone 13 (webkit)';
const DESKTOP = 'Desktop (chromium)';

type Rij = { userId: string; soort: string; validUntil: string };
/** De eerste lezing: alleen Alex heeft een datum. */
const EERSTE: Rij[] = [{ userId: '43', soort: 'code95', validUntil: '2029-11-27' }];
/** De lezing bij de terugkeer: Alex een andere datum, Diether verlopen. */
const TWEEDE: Rij[] = [
  { userId: '43', soort: 'code95', validUntil: '2030-01-15' },
  { userId: '44', soort: 'code95', validUntil: dayOffset(-3) },
];

const telefoon = (info: TestInfo) => info.project.name.startsWith('iPhone');
const alleenIn = (info: TestInfo, ...projecten: string[]) => test.skip(!projecten.includes(info.project.name), `alleen in ${projecten.join(', ')}`);

/** GET /api/user-expiries vasthouden, laten mislukken en tellen; een PUT
 *  past de lijst aan zoals de server. Wint van de fixtures (later
 *  geregistreerd). Ook de rustige poll van de datalaag leest dit pad. */
type Poort = { lijst: Rij[]; status: number; houd: boolean; wachtend: Array<() => void>; gets: number; puts: unknown[] };
async function vervaldataPoort(page: Page, lijst: Rij[]): Promise<Poort> {
  const p: Poort = { lijst, status: 200, houd: false, wachtend: [], gets: 0, puts: [] };
  await page.route('**/api/user-expiries', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      p.gets += 1;
      if (p.houd) await new Promise<void>((los) => p.wachtend.push(los));
      if (p.status !== 200) return route.fulfill({ status: p.status, json: { error: 'Serverfout' } }).catch(() => undefined);
      return route.fulfill({ json: p.lijst }).catch(() => undefined);
    }
    const body = req.postDataJSON() as { userId: string; soort: string; validUntil: string | null };
    p.puts.push(body);
    p.lijst = [
      ...p.lijst.filter((r) => !(r.userId === String(body.userId) && r.soort === body.soort)),
      ...(body.validUntil ? [{ userId: String(body.userId), soort: body.soort, validUntil: body.validUntil }] : []),
    ];
    return route.fulfill({ json: { ok: true } });
  });
  return p;
}
const laatLos = (p: Poort) => {
  p.houd = false;
  for (const los of p.wachtend.splice(0)) los();
};

/** Elke schrijfactie naar de API (alles behalve GET en HEAD), voor het rapport. */
function volgSchrijfacties(page: Page): string[] {
  const lijst: string[] = [];
  page.on('request', (r: Request) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') && r.method() !== 'GET' && r.method() !== 'HEAD') lijst.push(`${r.method()} ${url.pathname}`);
  });
  return lijst;
}

/** Ingelogd op het dashboard, met lopende klok; wacht op de hervatting van de
 *  sessie (een niet-stille POST bij elke start) en op de eerste poll van de
 *  datalaag, zodat die niets van de proef raken. */
async function start(page: Page, info: TestInfo, opties: { lijst?: Rij[]; extra?: Extra } = {}) {
  const user = telefoon(info) ? PLANNER : ADMIN;
  const begin = new Date();
  begin.setSeconds(2, 0);
  await page.clock.install({ time: begin });
  await seed(page, { user, view: 'dashboard', extra: opties.extra });
  const poort = await vervaldataPoort(page, opties.lijst ?? EERSTE);
  const hervat = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/session' && r.request().method() === 'POST');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await hervat;
  await expect.poll(() => poort.gets, { message: 'de datalaag las de vervaldata bij de start' }).toBeGreaterThanOrEqual(1);
  return { poort, user };
}

const PAD = { Dashboard: '/', Vandaag: '/vandaag', Vervaldata: '/beheer/vervaldata' } as const;

/** Naar een scherm via de dock (tik) of de zijbalk (muis). Tussen 768 en
 *  1024 px is er geen van beide in beeld: dan via de router, zoals het menu. */
async function ga(page: Page, info: TestInfo, scherm: keyof typeof PAD) {
  if (telefoon(info)) {
    await page.locator('nav[aria-label="Hoofdnavigatie"]').getByRole('button', { name: scherm, exact: true }).tap();
  } else if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await gaIntern(page, PAD[scherm]);
  } else {
    await page.getByRole('navigation', { name: 'Zijbalk' }).getByRole('button', { name: new RegExp(`^${scherm}(\\s|$)`) }).click();
  }
  if (scherm === 'Dashboard') await expect(page.getByRole('heading', { level: 1, name: /, \w+$/ })).toBeVisible();
  else await expect(page.getByRole('heading', { level: 1, name: scherm, exact: true })).toBeVisible();
}

const SKELET = '[aria-label="Vervaldata worden geladen"]';
const skelet = (page: Page) => page.locator(SKELET);
const regel = (page: Page) => page.locator('p[aria-live="polite"]').filter({ hasText: /^(Bijgewerkt om|Bijwerken)/ });
const zichtbaar = (page: Page, tekst: string) => page.getByText(tekst, { exact: true }).locator('visible=true');
const dialoog = (page: Page) => page.getByRole('dialog');
/** "Bijgewerkt om HH:MM" voor een tijdstip, zoals de app het schrijft. */
const regelVoor = (page: Page, t: number) => page.evaluate((om) => `Bijgewerkt om ${new Date(om).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`, t);
const nu = (page: Page) => page.evaluate(() => Date.now());

/** Vanaf nu: verschijnt het skelet ergens, ook heel even? */
const volgSkelet = (page: Page) => page.evaluate((sel) => {
  const w = window as unknown as { __skeletGezien?: boolean };
  w.__skeletGezien = false;
  const isSkelet = (n: Node) => n instanceof Element && (n.matches(sel) || !!n.querySelector(sel));
  new MutationObserver((records) => {
    if (records.some((r) => [...r.addedNodes].some(isSkelet))) w.__skeletGezien = true;
  }).observe(document.body, { childList: true, subtree: true });
}, SKELET);
const skeletGezien = (page: Page) => page.evaluate(() => (window as unknown as { __skeletGezien?: boolean }).__skeletGezien === true);

/** Eerste bezoek aan Vervaldata (geen geheugen), terug naar het dashboard.
 *  Geeft de regel van die eerste lezing. */
async function eersteBezoek(page: Page, info: TestInfo, poort: Poort): Promise<string> {
  const voor = poort.gets;
  await ga(page, info, 'Vervaldata');
  await expect.poll(() => poort.gets).toBe(voor + 1);
  await expect(zichtbaar(page, '27 nov 2029')).toBeVisible();
  await expect(regel(page)).toHaveText(/^Bijgewerkt om \d\d:\d\d$/);
  const tekst = (await regel(page).textContent())!.trim();
  await ga(page, info, 'Dashboard');
  return tekst;
}

/** Terug naar Vervaldata met de verversing vastgehouden, na `sprongMs`. */
async function terugVastgehouden(page: Page, info: TestInfo, poort: Poort, sprongMs: number, lijst: Rij[] = TWEEDE) {
  await page.clock.setSystemTime((await nu(page)) + sprongMs);
  poort.lijst = lijst;
  poort.houd = true;
  const voor = poort.gets;
  await volgSkelet(page);
  await ga(page, info, 'Vervaldata');
  await expect.poll(() => poort.gets, { message: 'de verversing is vertrokken en wordt vastgehouden' }).toBe(voor + 1);
}

// ---------------------------------------------------------------------------
// 1. Terug binnen vijf minuten
// ---------------------------------------------------------------------------

test('terug binnen 5 min: de lijst staat er meteen, geen skelet, de regel noemt de onthouden tijd tot de verversing binnen is', async ({ page }, info) => {
  const schrijf = volgSchrijfacties(page);
  const { poort } = await start(page, info);
  const eersteRegel = await eersteBezoek(page, info, poort);
  const naEerste = schrijf.length;

  // 2 min 5 s: de terugkeer valt rond seconde 10 van een minuut (start op
  // seconde 2), ruim vóór de volgende minuutgrens.
  await terugVastgehouden(page, info, poort, 125_000);
  // Meteen de onthouden rijen, met de tijd van die lezing.
  await expect(zichtbaar(page, '27 nov 2029')).toBeVisible();
  await expect(regel(page)).toHaveText(eersteRegel);
  await page.waitForTimeout(500);
  await expect(regel(page), 'blijft de onthouden tijd zolang de verversing loopt').toHaveText(eersteRegel);
  await expect(skelet(page)).toHaveCount(0);
  await expect(page.getByText(/Kon de vervaldata niet/)).toHaveCount(0);

  laatLos(poort);
  await expect(zichtbaar(page, '15 jan 2030')).toBeVisible();
  await expect(zichtbaar(page, 'al 3 dagen verlopen')).toBeVisible();
  await expect(zichtbaar(page, '27 nov 2029')).toHaveCount(0);
  const nieuweRegel = await regelVoor(page, await nu(page));
  expect(nieuweRegel).not.toBe(eersteRegel);
  await expect(regel(page)).toHaveText(nieuweRegel);
  expect(await skeletGezien(page), 'het skelet verscheen niet, ook niet even').toBe(false);

  // Voor het rapport: wat er tussen de eerste lezing en de terugkeer schreef
  // (de treffer zelf bewijst het skelet dat uitbleef; niet elke POST loopt
  // via apiFetch en telt mee).
  const tussen = schrijf.slice(naEerste);
  info.annotations.push({ type: 'schrijfacties', description: `bij de start: ${schrijf.slice(0, naEerste).join(', ') || 'geen'}; tussen eerste lezing en terugkeer: ${tussen.join(', ') || 'geen'}` });
  expect(tussen, 'geen meldingen gelezen bij de schermwissel (standaardfixtures)').not.toContain('POST /api/meldingen/gelezen');
});

// ---------------------------------------------------------------------------
// 2. Het skelet zoals vroeger (telefoon, planner)
// ---------------------------------------------------------------------------

test.describe('het skelet zoals vroeger', () => {
  test('na vijf minuten', async ({ page }, info) => {
    alleenIn(info, IPHONE);
    const { poort } = await start(page, info);
    await eersteBezoek(page, info, poort);
    await terugVastgehouden(page, info, poort, 5 * 60_000 + 1000);
    await expect(skelet(page)).toBeVisible();
    await expect(zichtbaar(page, '27 nov 2029')).toHaveCount(0);
    laatLos(poort);
    await expect(zichtbaar(page, '15 jan 2030')).toBeVisible();
    await expect(skelet(page)).toHaveCount(0);
  });

  test('na een eigen schrijfactie op een ander scherm (meldingen gelezen bij de schermwissel)', async ({ page }, info) => {
    alleenIn(info, IPHONE);
    const schrijf = volgSchrijfacties(page);
    // Eén ongelezen melding die naar Vandaag wijst: aankomen op Vandaag
    // markeert ze gelezen met een gewone (niet-stille) POST.
    const meldingen = { ongelezen: 1, meldingen: [{ id: 'm1', titel: 'Open dienst', tekst: 'Dienst 2607 heeft nog geen chauffeur.', soort: 'planning', doel: 'vandaag', createdAt: new Date().toISOString() }] };
    const { poort } = await start(page, info, { extra: (pad, req) => (pad.endsWith('/api/meldingen') && req.method() === 'GET' ? meldingen : undefined) });
    const voor = poort.gets;
    await ga(page, info, 'Vervaldata');
    await expect.poll(() => poort.gets).toBe(voor + 1);
    await expect(zichtbaar(page, '27 nov 2029')).toBeVisible();

    const gelezen = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/meldingen/gelezen' && r.request().method() === 'POST');
    await ga(page, info, 'Vandaag');
    await gelezen;
    expect(schrijf.filter((s) => s === 'POST /api/meldingen/gelezen')).toHaveLength(1);

    await terugVastgehouden(page, info, poort, 30_000);
    await expect(skelet(page)).toBeVisible();
    await expect(zichtbaar(page, '27 nov 2029')).toHaveCount(0);
    laatLos(poort);
    await expect(zichtbaar(page, '15 jan 2030')).toBeVisible();
  });

  test('na een eigen opslag op Vervaldata en de verversing erna: terug binnen 5 min toont de stand van na de opslag, zonder skelet', async ({ page }, info) => {
    alleenIn(info, IPHONE);
    const { poort } = await start(page, info);
    const voor = poort.gets;
    await ga(page, info, 'Vervaldata');
    await expect.poll(() => poort.gets).toBe(voor + 1);
    await page.getByRole('button', { name: /^Alex Du Priez/ }).locator('visible=true').tap();
    const venster = page.getByRole('dialog', { name: 'Vervaldata van Alex Du Priez' });
    await expect(venster).toBeVisible();
    const veld = venster.getByLabel('Code 95 geldig tot', { exact: true });
    await veld.fill('15/01/2030');
    // Enter met een geldige datum neemt ze over en dient in (Formulier).
    await veld.press('Enter');
    await expect(venster).toHaveCount(0);
    await expect.poll(() => poort.puts.length).toBe(1);
    await expect(zichtbaar(page, '15 jan 2030')).toBeVisible();
    await expect.poll(() => poort.gets, { message: 'de verversing na de opslag' }).toBe(voor + 2);
    await ga(page, info, 'Dashboard');

    await terugVastgehouden(page, info, poort, 60_000, poort.lijst);
    await expect(zichtbaar(page, '15 jan 2030')).toBeVisible();
    await expect(skelet(page)).toHaveCount(0);
    laatLos(poort);
    await expect(zichtbaar(page, '15 jan 2030')).toBeVisible();
    expect(await skeletGezien(page)).toBe(false);
  });

  test('na een afmelding in dezelfde pagina zonder herlaad: niets uit het geheugen, ook niet voor dezelfde persoon, en niets voor wie daarna aanmeldt', async ({ page }, info) => {
    alleenIn(info, IPHONE);
    // Let op: de afmelding (POST /api/auth/session "end") en elke aanmelding
    // ("start") zijn zelf niet-stille schrijfacties en maken het geheugen dus
    // ook ongeldig. Deze proef legt de uitkomst vast; dat de wisgebeurtenis
    // van wisPriveCaches het geheugen leegmaakt (ook voor een afmelding
    // zonder POST, zoals een geblokkeerd toestel), bewijzen
    // src/lib/schermGeheugen.test.ts en src/lib/afmelden.test.ts.
    type Wie = 'a' | 'b';
    const GEBRUIKER = { a: PLANNER, b: ADMIN };
    const staat: { volgende: Wie; geladen: number } = { volgende: 'a', geladen: 0 };
    page.on('load', () => { staat.geladen += 1; });
    const sessie = (wie: Wie) => ({
      access_token: `tok-${wie}`, refresh_token: `ververs-${wie}`, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: `auth-${wie}`, email: GEBRUIKER[wie].email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    });
    const wieVan = (route: Route): Wie => (route.request().headers().authorization === 'Bearer tok-b' ? 'b' : 'a');
    await page.route('**/auth/v1/**', (route) => route.fulfill({ json: sessie(staat.volgende) }));
    await page.route('**/auth/v1/token**', (route) => route.fulfill({ json: sessie(staat.volgende) }));
    await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.route('**/auth/v1/user**', (route) => route.fulfill({ json: sessie(wieVan(route)).user }));
    const fixtures = {
      a: apiFixtures(PLANNER, (pad: string) => (pad.endsWith('/api/auth/session') ? PLANNER : undefined)),
      b: apiFixtures(ADMIN, (pad: string) => (pad.endsWith('/api/auth/session') ? ADMIN : undefined)),
    };
    await page.route('**/api/**', (route) => fixtures[wieVan(route)](route).catch(() => undefined));
    const poort = await vervaldataPoort(page, EERSTE);
    // De sessiestart en de hervatting zijn niet-stille POSTs: pas verder als ze terug zijn.
    let sessieLopend = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/auth/session') sessieLopend += 1; });
    const klaar = (r: Request) => { if (new URL(r.url()).pathname === '/api/auth/session') sessieLopend -= 1; };
    page.on('requestfinished', klaar);
    page.on('requestfailed', klaar);
    const aangemeld = async (wie: Wie) => {
      await logIn(page);
      await expect(page.getByRole('heading', { level: 1, name: new RegExp(`, ${GEBRUIKER[wie].name.split(' ')[0]}$`) })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => sessieLopend).toBe(0);
      await page.waitForTimeout(300);
    };
    const meldAfZonderHerlaad = async () => {
      // Zoals e2e/uitloggen.spec.ts: geen bereik en geen service worker =
      // de afronding herlaadt niet.
      const geenBereik = (route: Route) => route.abort('internetdisconnected');
      await page.route('**/api/health**', geenBereik);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.getByRole('button', { name: 'Accountmenu' }).click();
      await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
      await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible({ timeout: 15_000 });
      await page.unroute('**/api/health**', geenBereik);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    };

    await page.goto('/');
    await aangemeld('a');

    // Eerst bewijzen dat het geheugen raakt, anders bewijst de rest niets.
    await eersteBezoek(page, info, poort);
    await terugVastgehouden(page, info, poort, 30_000, EERSTE);
    await expect(zichtbaar(page, '27 nov 2029')).toBeVisible();
    await expect(skelet(page)).toHaveCount(0);
    laatLos(poort);
    await ga(page, info, 'Dashboard');

    // Afmelden zonder herlaad, dezelfde persoon meldt opnieuw aan.
    await meldAfZonderHerlaad();
    await aangemeld('a');
    expect(staat.geladen, 'niet herladen').toBe(1);
    poort.houd = true;
    let voor = poort.gets;
    await ga(page, info, 'Vervaldata');
    await expect.poll(() => poort.gets).toBe(voor + 1);
    await expect(skelet(page)).toBeVisible();
    await expect(zichtbaar(page, '27 nov 2029')).toHaveCount(0);
    laatLos(poort);
    await expect(zichtbaar(page, '27 nov 2029')).toBeVisible();
    await ga(page, info, 'Dashboard');

    // Afmelden zonder herlaad, iemand anders meldt aan: niets van de vorige.
    await meldAfZonderHerlaad();
    staat.volgende = 'b';
    poort.lijst = [];
    await aangemeld('b');
    expect(staat.geladen, 'niet herladen').toBe(1);
    poort.houd = true;
    voor = poort.gets;
    await ga(page, info, 'Vervaldata');
    await expect.poll(() => poort.gets).toBe(voor + 1);
    await expect(skelet(page)).toBeVisible();
    await expect(zichtbaar(page, '27 nov 2029')).toHaveCount(0);
    laatLos(poort);
    await expect(skelet(page)).toHaveCount(0);
    await expect(zichtbaar(page, 'Alex Du Priez')).toBeVisible();
    await expect(zichtbaar(page, '27 nov 2029')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 3. De verversing na een geheugentreffer mislukt
// ---------------------------------------------------------------------------

test('de verversing na een geheugentreffer mislukt: de onthouden lijst blijft, de kleine Foutkaart erboven, de regel houdt de onthouden tijd', async ({ page }, info) => {
  alleenIn(info, IPHONE, DESKTOP);
  const { poort } = await start(page, info);
  const eersteRegel = await eersteBezoek(page, info, poort);
  await terugVastgehouden(page, info, poort, 120_000);
  poort.status = 500;
  laatLos(poort);
  // apiFetch probeert een 5xx-lezing één keer opnieuw (na 600 ms).
  await expect(page.getByText('Kon de vervaldata niet bijwerken. Bewerken kan zodra dat gelukt is.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toBeVisible();
  await expect(zichtbaar(page, '27 nov 2029')).toBeVisible();
  await expect(regel(page)).toHaveText(eersteRegel);
  await expect(skelet(page)).toHaveCount(0);
  expect(await skeletGezien(page)).toBe(false);
});

// ---------------------------------------------------------------------------
// 4. Bewerken start nooit vanuit onthouden gegevens
// ---------------------------------------------------------------------------

/** Klik (muis) of tik op één vaste plek: het midden van `doel`. Eerst moet
 *  de schermwissel uitgelopen zijn: tijdens een view transition gaat een klik
 *  op coördinaten naar de overgang, niet naar de rij. */
async function plek(page: Page, info: TestInfo, naam: string) {
  const doel = telefoon(info)
    ? page.getByRole('button', { name: new RegExp(`^${naam}`) }).locator('visible=true')
    : page.getByRole('button', { name: `Vervaldata van ${naam} bewerken` });
  await doel.scrollIntoViewIfNeeded();
  await wachtOpAnimaties(page);
  // Proefklik: Playwright gaat na dat de rij de klik op die plek echt krijgt.
  await doel.click({ trial: true });
  const vak = (await doel.boundingBox())!;
  const x = vak.x + vak.width / 2;
  const y = vak.y + vak.height / 2;
  return {
    klik: async () => {
      if (telefoon(info)) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
    },
    /** Wat er nu op die plek ligt (voor het rapport). */
    onder: () => page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return 'niets';
      const venster = el.closest('[role="dialog"]') ? 'in het venster' : 'buiten het venster';
      const ctl = el.closest('button, input, a, label');
      const naam = ctl ? `${ctl.tagName.toLowerCase()} “${(ctl.getAttribute('aria-label') || ctl.textContent || '').trim().slice(0, 40)}”` : el.tagName.toLowerCase();
      return `${venster}: ${naam}`;
    }, [x, y] as const),
  };
}
/** Wacht tot `ms` na `t0` (ms sinds epoch, tijd van Node). */
const tot = (page: Page, t0: number, ms: number) => page.waitForTimeout(Math.max(0, t0 + ms - Date.now()));
const pad = (page: Page) => new URL(page.url()).pathname;

/** Toetssteen 1 en 3 op één plek: klikken met de verversing vastgehouden
 *  opent niets, na het loslaten opent het venster met de verse datums, en
 *  klikken op dezelfde plek 0,3, 1 en 2 s na het openen schrijft niets. */
async function bewerkProef(page: Page, info: TestInfo) {
  const { poort } = await start(page, info);
  await eersteBezoek(page, info, poort);
  await terugVastgehouden(page, info, poort, 120_000);

  const { klik, onder } = await plek(page, info, 'Alex Du Priez');
  const t0 = Date.now();
  await klik();
  await expect.poll(() => pad(page)).toBe('/beheer/vervaldata/43');
  await expect(dialoog(page)).toHaveCount(0);
  for (const ms of [300, 1000, 2000]) {
    await tot(page, t0, ms);
    await klik();
    await page.waitForTimeout(100);
    await expect(dialoog(page), `geen venster na een klik op ${ms} ms`).toHaveCount(0);
  }

  laatLos(poort);
  const venster = page.getByRole('dialog', { name: 'Vervaldata van Alex Du Priez' });
  await expect(venster).toBeVisible();
  // De verse datum, niet de onthouden 2029-11-27.
  await expect(venster.getByLabel('Code 95 geldig tot', { exact: true })).toHaveAttribute('data-datum', '2030-01-15');

  const t1 = Date.now();
  const gezien: string[] = [`bij het openen ${await onder()}`];
  for (const ms of [300, 1000, 2000]) {
    await tot(page, t1, ms);
    gezien.push(`${ms} ms ${await onder()}`);
    await klik();
  }
  await page.waitForTimeout(1000);
  info.annotations.push({ type: `onder de klik (${page.viewportSize()?.width} px)`, description: gezien.join(' · ') });
  expect(poort.puts, 'geen PUT /api/user-expiries').toEqual([]);
}

test.describe('bewerken na een terugkeer', () => {
  test.beforeEach(async ({}, info) => alleenIn(info, IPHONE, WEBKIT, DESKTOP));

  test('met de verversing vastgehouden opent een klik geen venster, ook een tweede niet; na het loslaten opent het met de verse datums, en klikken op die plek schrijft niets', async ({ page }, info) => {
    await bewerkProef(page, info);
  });

  // 390 (telefoon) en 1440 (desktop) hierboven; de breedtes daartussen alleen op desktop.
  for (const breedte of [768, 1024, 1280]) {
    test(`op ${breedte} px: geen venster vóór de verse lezing, en na het openen schrijft een klik op de plek van de naam niets`, async ({ page }, info) => {
      alleenIn(info, DESKTOP);
      await page.setViewportSize({ width: breedte, height: 900 });
      await bewerkProef(page, info);
    });
  }

  test('met het toetsenbord: Enter en spatie op de naam openen niets vóór de verse lezing, en na het openen schrijven ze niets', async ({ page }, info) => {
    alleenIn(info, DESKTOP);
    const { poort } = await start(page, info);
    await eersteBezoek(page, info, poort);
    await terugVastgehouden(page, info, poort, 120_000);
    const knop = page.getByRole('button', { name: 'Vervaldata van Alex Du Priez bewerken' });
    await wachtOpAnimaties(page);
    await knop.focus();
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    await expect.poll(() => pad(page)).toBe('/beheer/vervaldata/43');
    for (const [ms, toets] of [[300, 'Enter'], [1000, ' '], [2000, 'Enter']] as const) {
      await tot(page, t0, ms);
      await page.keyboard.press(toets);
      await page.waitForTimeout(100);
      await expect(dialoog(page), `geen venster na ${toets === ' ' ? 'spatie' : toets} op ${ms} ms`).toHaveCount(0);
    }

    laatLos(poort);
    const venster = page.getByRole('dialog', { name: 'Vervaldata van Alex Du Priez' });
    await expect(venster).toBeVisible();
    await expect(venster.getByLabel('Code 95 geldig tot', { exact: true })).toHaveAttribute('data-datum', '2030-01-15');
    const t1 = Date.now();
    const focus: string[] = [];
    for (const [ms, toets] of [[300, 'Enter'], [1000, ' '], [2000, 'Enter']] as const) {
      await tot(page, t1, ms);
      focus.push(`${ms} ms ${await page.evaluate(() => { const el = document.activeElement; return el ? `${el.tagName.toLowerCase()} “${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}”` : 'niets'; })}`);
      await page.keyboard.press(toets);
    }
    await page.waitForTimeout(1000);
    info.annotations.push({ type: 'focus bij Enter/spatie na het openen', description: focus.join(' · ') });
    expect(poort.puts, 'geen PUT /api/user-expiries').toEqual([]);
  });

  test('een klik op een andere naam vóór het loslaten opent na het loslaten die andere', async ({ page }, info) => {
    const { poort } = await start(page, info);
    await eersteBezoek(page, info, poort);
    await terugVastgehouden(page, info, poort, 120_000);
    await (await plek(page, info, 'Alex Du Priez')).klik();
    await expect.poll(() => pad(page)).toBe('/beheer/vervaldata/43');
    await (await plek(page, info, 'Diether Van Haute')).klik();
    await expect.poll(() => pad(page)).toBe('/beheer/vervaldata/44');
    await expect(dialoog(page)).toHaveCount(0);
    laatLos(poort);
    await expect(page.getByRole('dialog', { name: 'Vervaldata van Diether Van Haute' })).toBeVisible();
    await expect(dialoog(page)).toHaveCount(1);
    await expect(page.getByRole('dialog').getByLabel('Code 95 geldig tot', { exact: true })).toHaveAttribute('data-datum', dayOffset(-3));
  });

  test('een schermwissel vóór het loslaten opent nergens iets', async ({ page }, info) => {
    const { poort } = await start(page, info);
    await eersteBezoek(page, info, poort);
    await terugVastgehouden(page, info, poort, 120_000);
    await (await plek(page, info, 'Alex Du Priez')).klik();
    await expect.poll(() => pad(page)).toBe('/beheer/vervaldata/43');
    await ga(page, info, 'Dashboard');
    laatLos(poort);
    await page.waitForTimeout(1000);
    await expect(dialoog(page)).toHaveCount(0);
    await ga(page, info, 'Vervaldata');
    await page.waitForTimeout(1000);
    await expect(dialoog(page)).toHaveCount(0);
    expect(pad(page)).toBe('/beheer/vervaldata');
  });

  test('mislukt de verversing: geen venster, de kleine Foutkaart; na een geslaagde poging opent het adres dat intussen gezet werd', async ({ page }, info) => {
    const { poort } = await start(page, info);
    await eersteBezoek(page, info, poort);
    await terugVastgehouden(page, info, poort, 120_000);
    await (await plek(page, info, 'Alex Du Priez')).klik();
    await expect.poll(() => pad(page)).toBe('/beheer/vervaldata/43');
    poort.status = 500;
    laatLos(poort);
    await expect(page.getByText('Kon de vervaldata niet bijwerken. Bewerken kan zodra dat gelukt is.')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await expect(dialoog(page)).toHaveCount(0);

    poort.status = 200;
    await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
    const venster = page.getByRole('dialog', { name: 'Vervaldata van Alex Du Priez' });
    await expect(venster).toBeVisible();
    await expect(venster.getByLabel('Code 95 geldig tot', { exact: true })).toHaveAttribute('data-datum', '2030-01-15');
    await expect(page.getByText('Kon de vervaldata niet bijwerken. Bewerken kan zodra dat gelukt is.')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Geen telling in de tegels vóór de gegevens
// ---------------------------------------------------------------------------

test('tegels tijdens de eerste lezing (geen geheugen): geen getal en geen oordeel; daarna de echte tellingen', async ({ page }, info) => {
  alleenIn(info, IPHONE, DESKTOP);
  const { poort } = await start(page, info);
  poort.houd = true;
  const voor = poort.gets;
  await ga(page, info, 'Vervaldata');
  await expect.poll(() => poort.gets).toBe(voor + 1);
  await expect(skelet(page)).toBeVisible();
  const tegels = page.locator('.kpi-raster > *');
  await expect(tegels).toHaveCount(4);
  // Afwezigheid, niet het teken: zo blijft dit groen als de tegels later een skelet krijgen.
  const zonderLabel = async () => (await tegels.allInnerTexts()).map((t) => t.replace(/Binnen (30|90) dagen/, ''));
  for (const tekst of await zonderLabel()) {
    expect(tekst).not.toMatch(/\d/);
    expect(tekst).not.toMatch(/niets verlopen|nog in te vullen|alles ingevuld|direct actie nodig/);
  }
  await page.waitForTimeout(500);
  for (const tekst of await zonderLabel()) expect(tekst).not.toMatch(/\d|niets verlopen|nog in te vullen|alles ingevuld/);

  laatLos(poort);
  // EERSTE: niets verlopen, Test Chauffeur en Diether zonder datums.
  await expect(tegels.filter({ hasText: 'Verlopen' })).toContainText('niets verlopen');
  await expect(tegels.filter({ hasText: 'Zonder datums' })).toContainText('nog in te vullen');
  await expect(tegels.filter({ hasText: 'Zonder datums' })).toContainText('2');
});

// ===========================================================================
// 6. De Maandplanning (ronde 6, punt 22, deel 3)
// ===========================================================================
//
// Hetzelfde geheugen, één sleutel per maand (useMaandLaden): terug binnen vijf
// minuten staat het bord er meteen, op desktop ook de kolommen van de maand
// achter de vensterrand, met "Bijgewerkt om <onthouden tijd>" tot de stille
// verversing binnen is. Ongeldig ook na elke 'vhb-planning-changed' sinds het
// vertrek van de lezing (een collega, een lichte ronde met een nieuwe versie,
// en sinds deze ronde elke volledige inhaalronde), en een antwoord uit de cache
// van de service worker wordt nooit onthouden.
//
// De klok van de pagina staat op een vaste woensdag, zodat de proef niet van de
// datum afhangt: KRUIST = 28/10/2026 (venster 26/10 tot 08/11, dus twee
// maanden: oktober en november), BINNEN = 14/10/2026 (venster 12/10 tot 25/10,
// één maand). De klok loopt, zoals hierboven.

const KRUIST = new Date('2026-10-28T10:00:02');
const BINNEN = new Date('2026-10-14T10:00:02');
const MP_RASTER = 'table[aria-label="Maandplanning per chauffeur en dag"]';
const MP_STRIP = '[role="tablist"][aria-label="Kies een dag"]';
/** Het skelet van het bord: in de inhoud, niet dat van het lui ladende scherm (ViewLoader, role=status). */
const MP_SKELET = 'main .skeleton:not([role="status"] .skeleton)';
const MP_RIJDERS = [
  { id: '42', name: 'Test Chauffeur' },
  { id: '43', name: 'Alex Du Priez' },
  { id: '44', name: 'Diether Van Haute' },
];
const mpIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mpDagen = (maand: string) => {
  const [jaar, m] = maand.split('-').map(Number);
  return Array.from({ length: new Date(jaar, m, 0).getDate() }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`);
};
const mpPlus = (dag: string, n: number) => { const d = new Date(`${dag}T00:00:00`); d.setDate(d.getDate() + n); return mpIso(d); };
/** De dienst van chauffeur `id` op `dag` in versie `v` van het bord: vier cijfers, uniek per versie, chauffeur en dag. */
const mpCode = (v: number, id: string, dag: string) => `${v}${MP_RIJDERS.findIndex((r) => r.id === id) + 1}${dag.slice(8, 10)}`;
/** Het bord zoals de server het geeft; voor wie geen staf is geknipt op de maandag van de week van `nu`. */
const mpBord = (maand: string, v: number, chauffeur: boolean, nu: Date) => {
  const dates = mpDagen(maand);
  const bord = {
    month: maand,
    dates,
    drivers: MP_RIJDERS.map((r) => ({ ...r, section: null })),
    cells: Object.fromEntries(MP_RIJDERS.map((r) => [r.id, Object.fromEntries(dates.map((d) => [d, { code: mpCode(v, r.id, d), kind: 'service', label: '', segments: ['05:30 - 13:45'] }]))])),
    geimporteerd: { eerste: '2026-01-01', laatste: '2099-12-31' },
  };
  return chauffeur ? begrensMaandbord(bord, eersteZichtbareDag(nu)) : bord;
};

/** GET /api/month-planning (het bord, niet de export of het overzicht):
 *  versie, vasthouden, laten mislukken, de kop van de cache, en elk gevraagde
 *  maand in volgorde. Wint van de fixtures (later geregistreerd). */
/** Zo veel ouder is een antwoord uit de cache van de service worker in deze proeven. */
const CACHE_OUDER_MS = 3 * 3600_000;
type MaandPoort = { versie: number; status: number; houd: boolean; uitCache: boolean; wachtend: Array<() => void>; gets: string[]; wissels: unknown[] };
async function maandPoort(page: Page, chauffeur: boolean, nu: Date): Promise<MaandPoort> {
  const p: MaandPoort = { versie: 1, status: 200, houd: false, uitCache: false, wachtend: [], gets: [], wissels: [] };
  await page.route('**/api/month-planning**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET' || url.searchParams.get('format')) return route.fallback();
    const maand = url.searchParams.get('month') ?? '';
    p.gets.push(maand);
    if (p.houd) await new Promise<void>((los) => p.wachtend.push(los));
    if (p.status !== 200) return route.fulfill({ status: p.status, json: { error: 'Serverfout' } }).catch(() => undefined);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // Een antwoord uit de cache draagt de Date-kop van het oorspronkelijke
    // antwoord: hier drie uur vóór de start van de proef, zodat de regel het
    // uur van die kop van het uur van nu kan onderscheiden.
    if (p.uitCache) { headers['x-vhb-bron'] = 'cache'; headers.date = new Date(nu.getTime() - CACHE_OUDER_MS).toUTCString(); }
    return route.fulfill({ status: 200, headers, body: JSON.stringify(mpBord(maand, p.versie, chauffeur, nu)) }).catch(() => undefined);
  });
  // Een handmatige dienstwissel: de server heeft daarna een nieuw bord.
  await page.route('**/api/admin/shift-swap', async (route) => {
    p.wissels.push(route.request().postDataJSON());
    p.versie += 1;
    return route.fulfill({ json: { ok: true } });
  });
  return p;
}

type MpRol = 'chauffeur' | 'planner' | 'admin';
const MP_GEBRUIKER: Record<MpRol, Record<string, unknown>> = { chauffeur: CHAUFFEUR, planner: PLANNER, admin: ADMIN };
/** Het andere scherm: het dashboard van een chauffeur vraagt geen bord, dat van de staf wel (PlannerDashboardWidgets); voor staf dus Vervaldata. */
const anderScherm = (rol: MpRol) => (rol === 'chauffeur' ? 'Dashboard' : 'Vervaldata');

/** Ingelogd op het andere scherm, met de klok van de pagina op `tijd` (die loopt). */
async function startMp(page: Page, rol: MpRol, opties: { tijd?: Date; thema?: 'light' | 'dark'; extra?: Extra } = {}) {
  const tijd = opties.tijd ?? KRUIST;
  await page.clock.install({ time: tijd });
  await seed(page, { user: MP_GEBRUIKER[rol], view: rol === 'chauffeur' ? 'dashboard' : 'vervaldata', thema: opties.thema, extra: opties.extra });
  const poort = await maandPoort(page, rol === 'chauffeur', tijd);
  const hervat = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/session' && r.request().method() === 'POST');
  await page.goto(rol === 'chauffeur' ? '/' : '/beheer/vervaldata');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await hervat;
  return poort;
}

/** Naar een scherm zoals een mens: op de telefoon de dock (Maandplanning via
 *  Meer, met een tik), op desktop de zijbalk met de muis. */
async function mpNaar(page: Page, info: TestInfo, scherm: 'Maandplanning' | 'Dashboard' | 'Vervaldata' | 'Rooster') {
  if (telefoon(info)) {
    const dock = page.locator('nav[aria-label="Hoofdnavigatie"]');
    if (scherm === 'Maandplanning') {
      await dock.getByRole('button', { name: 'Meer', exact: true }).tap();
      const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
      await expect(zijbalk).toBeVisible();
      await zijbalk.getByRole('button', { name: 'Maandplanning', exact: true }).tap();
    } else {
      await dock.getByRole('button', { name: scherm, exact: true }).tap();
    }
  } else if ((page.viewportSize()?.width ?? 1440) < 1024) {
    // Tussen 768 en 1024 px is er geen zijbalk in beeld: via de router, zoals het menu.
    await gaIntern(page, { Maandplanning: '/maandplanning', Dashboard: '/', Vervaldata: '/beheer/vervaldata', Rooster: '/rooster' }[scherm]);
  } else {
    await page.getByRole('navigation', { name: 'Zijbalk' }).getByRole('button', { name: new RegExp(`^${scherm}(\\s|$)`) }).click();
  }
  if (scherm === 'Dashboard') await expect(page.getByRole('heading', { level: 1, name: /, \w+$/ })).toBeVisible();
  else await expect(page.getByRole('heading', { level: 1, name: scherm, exact: true })).toBeVisible();
}

const mpSkelet = (page: Page) => page.locator(MP_SKELET);
const volgMpSkelet = (page: Page) => page.evaluate((sel) => {
  const w = window as unknown as { __mpSkeletGezien?: boolean };
  w.__mpSkeletGezien = false;
  const isSkelet = (n: Node) => n instanceof Element && (n.matches(sel) || !!n.querySelector(sel));
  new MutationObserver((records) => {
    if (records.some((r) => [...r.addedNodes].some(isSkelet))) w.__mpSkeletGezien = true;
  }).observe(document.body, { childList: true, subtree: true });
}, MP_SKELET);
const mpSkeletGezien = (page: Page) => page.evaluate(() => (window as unknown as { __mpSkeletGezien?: boolean }).__mpSkeletGezien === true);

/** De code in het raster (desktop) voor een chauffeur op een dag van het venster, of null. */
const rasterCode = (page: Page, wie: string, kolom: number) => page.evaluate(([sel, naam, k]) => {
  const tabel = document.querySelector(sel as string);
  const rij = tabel ? [...tabel.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')?.textContent?.trim().startsWith(naam as string)) : undefined;
  return rij?.querySelectorAll('td')[k as number]?.textContent?.trim() || null;
}, [MP_RASTER, wie, kolom] as const);
/** Wat het bord van versie `v` toont: op de telefoon de rij van Alex op vandaag,
 *  op desktop zijn cel op vandaag (oktober) en op 03/11 (de tweede maand). */
async function toontVersie(page: Page, info: TestInfo, v: number, nu = KRUIST) {
  const vandaag = mpIso(nu);
  if (telefoon(info)) {
    await expect(page.getByRole('button', { name: new RegExp(`^${mpCode(v, '43', vandaag)} Alex Du Priez`) })).toBeVisible();
    return;
  }
  const begin = mpPlus(vandaag, -((nu.getDay() + 6) % 7));
  const tweede = mpPlus(begin, 8);
  await expect.poll(() => rasterCode(page, 'Alex Du Priez', 2)).toBe(mpCode(v, '43', vandaag));
  await expect.poll(() => rasterCode(page, 'Alex Du Priez', 8), `de tweede maand (${tweede})`).toBe(mpCode(v, '43', tweede));
}
const toontNietVersie = async (page: Page, info: TestInfo, v: number) => {
  if (telefoon(info)) await expect(page.getByRole('button', { name: new RegExp(`^${mpCode(v, '43', mpIso(KRUIST))} Alex Du Priez`) })).toHaveCount(0);
  else expect(await rasterCode(page, 'Alex Du Priez', 2)).not.toBe(mpCode(v, '43', mpIso(KRUIST)));
};
/** De dagen in de strip (telefoon), zoals de knoppen ze noemen. */
const stripDagen = (page: Page) => page.locator(MP_STRIP).getByRole('tab').allInnerTexts();

/** De regel boven een bord uit de cache van de service worker (geen "Bijgewerkt"). */
const cacheRegelEl = (page: Page) => page.locator('p[aria-live="polite"]').filter({ hasText: /^(Opgeslagen gegevens|Offline · (gegevens van|opgeslagen gegevens))/ });

/** Eerste bezoek (geen geheugen), terug naar het andere scherm. Geeft de regel van die lezing.
 *  Komt het bord uit de cache van de service worker (`poort.uitCache`), dan noemt de regel het uur
 *  van dat oorspronkelijke antwoord en nooit "Bijgewerkt om" (tegenlezing 23-11). */
async function eersteMpBezoek(page: Page, info: TestInfo, poort: MaandPoort, rol: MpRol, maanden = ['2026-10', '2026-11']) {
  const voor = poort.gets.length;
  await mpNaar(page, info, 'Maandplanning');
  await expect.poll(() => poort.gets.slice(voor).sort()).toEqual([...maanden].sort());
  await toontVersie(page, info, poort.versie);
  if (poort.uitCache) {
    const uur = await page.evaluate((t) => new Date(t).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }), KRUIST.getTime() - CACHE_OUDER_MS);
    await expect(cacheRegelEl(page)).toHaveText(`Opgeslagen gegevens van ${uur}`);
    await expect(regel(page)).toHaveCount(0);
  } else {
    await expect(regel(page)).toHaveText(/^Bijgewerkt om \d\d:\d\d$/);
  }
  const tekst = (await (poort.uitCache ? cacheRegelEl(page) : regel(page)).textContent())!.trim();
  const strip = telefoon(info) ? await stripDagen(page) : [];
  await mpNaar(page, info, anderScherm(rol));
  return { tekst, strip };
}

/** Terug naar de Maandplanning na `sprongMs`, met elke lezing van het bord vastgehouden. */
async function mpTerugVastgehouden(page: Page, info: TestInfo, poort: MaandPoort, sprongMs: number, verwacht = 2) {
  await page.clock.setSystemTime((await nu(page)) + sprongMs);
  poort.versie += 1;
  poort.houd = true;
  const voor = poort.gets.length;
  await volgMpSkelet(page);
  await mpNaar(page, info, 'Maandplanning');
  await expect.poll(() => poort.gets.length - voor, { message: 'de verversing is vertrokken en wordt vastgehouden' }).toBe(verwacht);
}
const mpLaatLos = (p: MaandPoort) => {
  p.houd = false;
  for (const los of p.wachtend.splice(0)) los();
};

// --- toetssteen 1 en 4: terug binnen vijf minuten ---------------------------

const MP_TERUG: Array<[string, MpRol]> = [[IPHONE, 'chauffeur'], [IPHONE, 'planner'], [WEBKIT, 'chauffeur'], [DESKTOP, 'admin']];
for (const [project, rol] of MP_TERUG) {
  test(`Maandplanning, terug binnen 5 min (${rol}, ${project}): het bord meteen zonder skelet${rol === 'admin' ? ', met de tweede maand' : ''}, de onthouden tijd in de regel tot de verversing binnen is`, async ({ page }, info) => {
    alleenIn(info, project);
    const schrijf = volgSchrijfacties(page);
    const poort = await startMp(page, rol);
    const eerste = await eersteMpBezoek(page, info, poort, rol);
    const naEerste = schrijf.length;

    // 2 min 5 s: rond seconde 10 van een minuut, ruim voor de volgende minuutgrens.
    await mpTerugVastgehouden(page, info, poort, 125_000);
    await toontVersie(page, info, 1);
    await expect(regel(page)).toHaveText(eerste.tekst);
    if (rol === 'chauffeur') {
      // Toetssteen 4: uit het geheugen precies de dagen die de server gaf, vanaf de maandag van deze week.
      expect(eerste.strip).toHaveLength(6);
      expect(await stripDagen(page)).toEqual(eerste.strip);
    }
    await page.waitForTimeout(500);
    await expect(regel(page), 'blijft de onthouden tijd zolang de verversing loopt').toHaveText(eerste.tekst);
    await expect(mpSkelet(page)).toHaveCount(0);
    await expect(page.getByText('Bijwerken is niet gelukt')).toHaveCount(0);

    mpLaatLos(poort);
    await toontVersie(page, info, 2);
    await toontNietVersie(page, info, 1);
    const nieuweRegel = await regelVoor(page, await nu(page));
    expect(nieuweRegel).not.toBe(eerste.tekst);
    await expect(regel(page)).toHaveText(nieuweRegel);
    if (rol === 'chauffeur') expect(await stripDagen(page)).toEqual(eerste.strip);
    expect(await mpSkeletGezien(page), 'het skelet verscheen niet, ook niet even').toBe(false);

    const tussen = schrijf.slice(naEerste);
    info.annotations.push({ type: 'geheugen', description: `geraakt; schrijfacties bij de start: ${schrijf.slice(0, naEerste).join(', ') || 'geen'}; tussen eerste lezing en terugkeer: ${tussen.join(', ') || 'geen'}` });
  });
}

// --- toetssteen 2: het skelet zoals vroeger ----------------------------------

test.describe('Maandplanning: het skelet zoals vroeger', () => {
  test.beforeEach(async ({}, info) => alleenIn(info, IPHONE, WEBKIT));

  /** Terug met het skelet: geen onthouden bord, na het loslaten het verse. */
  const metSkelet = async (page: Page, info: TestInfo, poort: MaandPoort, sprongMs: number) => {
    await mpTerugVastgehouden(page, info, poort, sprongMs);
    await expect(mpSkelet(page).first()).toBeVisible();
    await toontNietVersie(page, info, 1);
    await expect(regel(page)).toHaveCount(0);
    mpLaatLos(poort);
    await toontVersie(page, info, 2);
    await expect(mpSkelet(page)).toHaveCount(0);
  };

  test('na vijf minuten', async ({ page }, info) => {
    const poort = await startMp(page, 'chauffeur');
    await eersteMpBezoek(page, info, poort, 'chauffeur');
    await metSkelet(page, info, poort, 5 * 60_000 + 1000);
  });

  test('na een eigen schrijfactie op een ander scherm (een melding gelezen op Rooster)', async ({ page }, info) => {
    const schrijf = volgSchrijfacties(page);
    const meldingen = { ongelezen: 1, meldingen: [{ id: 'm1', titel: 'Rooster gewijzigd', tekst: 'Je dienst van morgen is gewijzigd.', soort: 'planning', doel: 'rooster', createdAt: new Date().toISOString() }] };
    const poort = await startMp(page, 'chauffeur', { extra: (pad, req) => (pad.endsWith('/api/meldingen') && req.method() === 'GET' ? meldingen : undefined) });
    await eersteMpBezoek(page, info, poort, 'chauffeur');
    const gelezen = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/meldingen/gelezen' && r.request().method() === 'POST');
    await mpNaar(page, info, 'Rooster');
    await gelezen;
    expect(schrijf.filter((x) => x === 'POST /api/meldingen/gelezen')).toHaveLength(1);
    await metSkelet(page, info, poort, 30_000);
  });

  test('na een planningswijziging terwijl je op een ander scherm stond', async ({ page }, info) => {
    const poort = await startMp(page, 'chauffeur');
    await eersteMpBezoek(page, info, poort, 'chauffeur');
    // Wat App doet bij een realtime-event van de planning (refetchPlanning).
    await page.evaluate(() => window.dispatchEvent(new Event('vhb-planning-changed')));
    await metSkelet(page, info, poort, 30_000);
  });

  test('na een volledige inhaalronde terwijl je op een ander scherm stond (offline en terug online)', async ({ page, context }, info) => {
    const poort = await startMp(page, 'chauffeur');
    await eersteMpBezoek(page, info, poort, 'chauffeur');
    await inhaalronde(page, context);
    await metSkelet(page, info, poort, 30_000);
  });

  test('als de vorige lezing uit de cache van de service worker kwam (X-VHB-Bron: cache)', async ({ page }, info) => {
    const poort = await startMp(page, 'chauffeur');
    poort.uitCache = true;
    await eersteMpBezoek(page, info, poort, 'chauffeur');
    poort.uitCache = false;
    await metSkelet(page, info, poort, 30_000);
  });

  test('na een afmelding zonder herlaad: niets uit het geheugen, ook niet voor dezelfde persoon, en niets voor wie daarna aanmeldt', async ({ page }, info) => {
    // Zoals de proef voor Vervaldata hierboven, met twee chauffeurs: hun
    // dashboard vraagt geen bord. Ook hier zijn afmelding en aanmelding zelf
    // niet-stille schrijfacties; de wisgebeurtenis bewijzen de unit-proeven.
    type Wie = 'a' | 'b';
    const ALEX = { id: '43', name: 'Alex Du Priez', role: 'chauffeur', employeeId: 'VHB-000043', email: 'alex@vhb.be', isActive: true };
    const GEBRUIKER = { a: CHAUFFEUR, b: ALEX };
    const staat: { volgende: Wie; geladen: number } = { volgende: 'a', geladen: 0 };
    page.on('load', () => { staat.geladen += 1; });
    await page.clock.install({ time: KRUIST });
    const sessie = (wie: Wie) => ({
      access_token: `tok-${wie}`, refresh_token: `ververs-${wie}`, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(KRUIST.getTime() / 1000) + 24 * 3600,
      user: { id: `auth-${wie}`, email: GEBRUIKER[wie].email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    });
    const wieVan = (route: Route): Wie => (route.request().headers().authorization === 'Bearer tok-b' ? 'b' : 'a');
    await page.route('**/auth/v1/**', (route) => route.fulfill({ json: sessie(staat.volgende) }));
    await page.route('**/auth/v1/token**', (route) => route.fulfill({ json: sessie(staat.volgende) }));
    await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.route('**/auth/v1/user**', (route) => route.fulfill({ json: sessie(wieVan(route)).user }));
    const fixtures = {
      a: apiFixtures(CHAUFFEUR, (pad: string) => (pad.endsWith('/api/auth/session') ? CHAUFFEUR : undefined)),
      b: apiFixtures(ALEX, (pad: string) => (pad.endsWith('/api/auth/session') ? ALEX : undefined)),
    };
    await page.route('**/api/**', (route) => fixtures[wieVan(route)](route).catch(() => undefined));
    const poort = await maandPoort(page, true, KRUIST);
    let sessieLopend = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/auth/session') sessieLopend += 1; });
    const klaar = (r: Request) => { if (new URL(r.url()).pathname === '/api/auth/session') sessieLopend -= 1; };
    page.on('requestfinished', klaar);
    page.on('requestfailed', klaar);
    const aangemeld = async (wie: Wie) => {
      await logIn(page);
      await expect(page.getByRole('heading', { level: 1, name: new RegExp(`, ${GEBRUIKER[wie].name.split(' ')[0]}$`) })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => sessieLopend).toBe(0);
      await page.waitForTimeout(300);
    };
    const meldAfZonderHerlaad = async () => {
      const geenBereik = (route: Route) => route.abort('internetdisconnected');
      await page.route('**/api/health**', geenBereik);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.getByRole('button', { name: 'Accountmenu' }).tap();
      await page.getByRole('menuitem', { name: 'Uitloggen' }).tap();
      await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible({ timeout: 15_000 });
      await page.unroute('**/api/health**', geenBereik);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    };
    /** Naar de Maandplanning met het bord vastgehouden: het skelet, na het loslaten het bord van versie v. */
    const terugMetSkelet = async (v: number) => {
      poort.houd = true;
      const voor = poort.gets.length;
      await mpNaar(page, info, 'Maandplanning');
      await expect.poll(() => poort.gets.length - voor).toBe(2);
      await expect(mpSkelet(page).first()).toBeVisible();
      await expect(regel(page)).toHaveCount(0);
      mpLaatLos(poort);
      await toontVersie(page, info, v);
      await mpNaar(page, info, 'Dashboard');
    };

    await page.goto('/');
    await aangemeld('a');
    // Eerst bewijzen dat het geheugen raakt, anders bewijst de rest niets.
    await eersteMpBezoek(page, info, poort, 'chauffeur');
    await mpTerugVastgehouden(page, info, poort, 30_000);
    await toontVersie(page, info, 1);
    await expect(mpSkelet(page)).toHaveCount(0);
    mpLaatLos(poort);
    await toontVersie(page, info, 2);
    await mpNaar(page, info, 'Dashboard');

    await meldAfZonderHerlaad();
    await aangemeld('a');
    expect(staat.geladen, 'niet herladen').toBe(1);
    await terugMetSkelet(2);

    await meldAfZonderHerlaad();
    staat.volgende = 'b';
    await aangemeld('b');
    expect(staat.geladen, 'niet herladen').toBe(1);
    await terugMetSkelet(2);
  });
});

/** Een volledige inhaalronde zoals op een telefoon die even geen bereik had:
 *  offline (de regel of het bord merkt het via de online-store) en terug. Wacht
 *  op een lezing die alleen de inhaalronde doet (de meldingen, voor elke rol). */
async function inhaalronde(page: Page, context: BrowserContext) {
  await context.setOffline(true);
  await page.waitForTimeout(300);
  const ronde = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/meldingen' && r.method() === 'GET', { timeout: 10_000 });
  await context.setOffline(false);
  await ronde;
}

test('Maandplanning: na een eigen wissel en de stille herlaad die erop volgt, toont een terugkeer binnen 5 min het bord van na de wissel, zonder skelet', async ({ page }, info) => {
  alleenIn(info, DESKTOP);
  const schrijf = volgSchrijfacties(page);
  const poort = await startMp(page, 'admin');
  const voor = poort.gets.length;
  await mpNaar(page, info, 'Maandplanning');
  await expect.poll(() => poort.gets.length - voor).toBe(2);
  await toontVersie(page, info, 1);

  // Dienst van Alex op vandaag naar Diether, die zelf rijdt: een 1-op-1-wissel.
  await page.locator(MP_RASTER).locator('tbody tr', { has: page.getByRole('rowheader', { name: 'Alex Du Priez' }) }).locator('td').nth(2).getByRole('button').click();
  const venster = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Alex Du Priez', exact: true }) });
  await expect(venster).toBeVisible();
  await venster.getByLabel('Nieuwe chauffeur').selectOption('44');
  await venster.getByRole('button', { name: 'Diensten wisselen…' }).click();
  const naWissel = poort.gets.length;
  await page.getByRole('dialog', { name: 'Dienstwissel doorvoeren?' }).getByRole('button', { name: 'Doorvoeren' }).click();
  await expect.poll(() => poort.wissels.length).toBe(1);
  // De stille herlaad (reloadTick): beide maanden opnieuw, het bord van na de wissel.
  await expect.poll(() => poort.gets.length - naWissel).toBe(2);
  await toontVersie(page, info, 2);
  await expect(regel(page)).toHaveText(/^Bijgewerkt om \d\d:\d\d$/);
  const naHerlaad = (await regel(page).textContent())!.trim();
  const schrijfNaHerlaad = schrijf.length;
  await mpNaar(page, info, 'Vervaldata');

  await mpTerugVastgehouden(page, info, poort, 60_000);
  await toontVersie(page, info, 2);
  await expect(regel(page)).toHaveText(naHerlaad);
  await expect(mpSkelet(page)).toHaveCount(0);
  mpLaatLos(poort);
  await toontVersie(page, info, 3);
  expect(await mpSkeletGezien(page)).toBe(false);
  info.annotations.push({ type: 'schrijfacties', description: `${schrijf.join(', ')}; na de herlaad: ${schrijf.slice(schrijfNaHerlaad).join(', ') || 'geen'}` });
});

// --- toetssteen 5 en 6: mislukken ----------------------------------------------

test('Maandplanning: mislukt de verversing na een terugkeer (500), dan blijft het onthouden bord met de kleine Foutkaart erboven, op desktop ook de tweede maand', async ({ page }, info) => {
  alleenIn(info, IPHONE, DESKTOP);
  const rol: MpRol = telefoon(info) ? 'chauffeur' : 'admin';
  const poort = await startMp(page, rol);
  const eerste = await eersteMpBezoek(page, info, poort, rol);
  await mpTerugVastgehouden(page, info, poort, 120_000);
  poort.status = 500;
  mpLaatLos(poort);
  // apiFetch probeert een 5xx-lezing één keer opnieuw (na 600 ms).
  await expect(page.getByText('Bijwerken is niet gelukt')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toBeVisible();
  await expect(page.getByText('Dit kon niet laden')).toHaveCount(0);
  await toontVersie(page, info, 1);
  await expect(regel(page)).toHaveText(eerste.tekst);
  await expect(mpSkelet(page)).toHaveCount(0);
  // De kaart staat boven het bord.
  const kaart = (await page.getByText('Bijwerken is niet gelukt').boundingBox())!;
  const bord = (await page.locator(telefoon(info) ? MP_STRIP : MP_RASTER).boundingBox())!;
  expect(kaart.y).toBeLessThan(bord.y);
  expect(await mpSkeletGezien(page)).toBe(false);

  // Opnieuw proberen ververst stil; lukt het, dan het verse bord en geen kaart meer.
  poort.status = 200;
  await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
  await toontVersie(page, info, poort.versie);
  await expect(page.getByText('Bijwerken is niet gelukt')).toHaveCount(0);
  expect(await mpSkeletGezien(page)).toBe(false);
});

// Tegenlezing 23-11: een antwoord uit de cache van de service worker (het
// netwerk viel weg, de SW antwoordt uit 'vhb-ritbladen') is geen verversing.
// Na een terugkeer blijft het onthouden bord met zijn eigen tijd, met de kleine
// Foutkaart erboven; nooit "Bijgewerkt om <nu>" boven een bord dat de server
// niet bevestigde. Zonder service worker in deze proef: de kop zoals de SW
// hem zet (markeerUitCache), met de Date-kop van drie uur eerder.
test('Maandplanning: komt de verversing na een terugkeer uit de cache van de service worker, dan blijft het onthouden bord met zijn tijd en de kleine Foutkaart erboven, nooit het uur van nu', async ({ page }, info) => {
  alleenIn(info, IPHONE, DESKTOP);
  const rol: MpRol = telefoon(info) ? 'chauffeur' : 'admin';
  const poort = await startMp(page, rol);
  const eerste = await eersteMpBezoek(page, info, poort, rol);
  await mpTerugVastgehouden(page, info, poort, 120_000);
  poort.uitCache = true;
  mpLaatLos(poort);
  await expect(page.getByText('Bijwerken is niet gelukt')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^Geen verbinding met de server\./)).toBeVisible();
  await expect(page.getByText('Dit kon niet laden')).toHaveCount(0);
  // Het onthouden bord (versie 1), niet dat uit de cache (versie 2); op desktop ook de tweede maand.
  await toontVersie(page, info, 1);
  await expect(regel(page)).toHaveText(eerste.tekst);
  await expect(cacheRegelEl(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  await toontVersie(page, info, 1);
  await expect(regel(page)).toHaveText(eerste.tekst);
  await expect(mpSkelet(page)).toHaveCount(0);

  // Opnieuw proberen met bereik: het verse bord en de nieuwe tijd.
  poort.uitCache = false;
  await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
  await toontVersie(page, info, poort.versie);
  await expect(page.getByText('Bijwerken is niet gelukt')).toHaveCount(0);
  await expect(regel(page)).toHaveText(await regelVoor(page, await nu(page)));
  expect(await mpSkeletGezien(page)).toBe(false);
});

// Tegenlezing 23-11: na een terugkeer staat het bord uit het geheugen er
// meteen, maar de staf schrijft vanuit het celdetail (notitie, dienstwissel,
// terugdraaien). Een cel opent voor hen pas na de lezing van dit bezoek, zoals
// vroeger onder het skelet: een tik of klik ervoor doet niets, ook een tweede
// niet. Daarna opent ze met de bestaande notitie in het veld.
const NOTITIE = 'Neem bus 412, eerst tanken.';
for (const [project, rol] of [[IPHONE, 'planner'], [DESKTOP, 'admin']] as Array<[string, MpRol]>) {
  test(`Maandplanning (${rol}, ${project}): na een terugkeer opent een cel pas na de verse lezing, met de bestaande notitie in het veld`, async ({ page }, info) => {
    alleenIn(info, project);
    const schrijf = volgSchrijfacties(page);
    const poort = await startMp(page, rol);
    const vandaag = mpIso(KRUIST);
    await page.route('**/api/planning-notes**', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ json: [{ driverId: '43', date: vandaag, note: NOTITIE }] })
      : route.fallback()));
    await eersteMpBezoek(page, info, poort, rol);
    const naEerste = schrijf.length;
    await mpTerugVastgehouden(page, info, poort, 120_000);
    await toontVersie(page, info, 1);
    const cel = (v: number) => (telefoon(info)
      ? page.getByRole('button', { name: new RegExp(`^${mpCode(v, '43', vandaag)} Alex Du Priez`) })
      : page.locator(MP_RASTER).locator('tbody tr', { has: page.getByRole('rowheader', { name: 'Alex Du Priez' }) }).locator('td').nth(2).getByRole('button'));
    const druk = async (v: number) => { if (telefoon(info)) await cel(v).tap(); else await cel(v).click(); };
    const venster = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Alex Du Priez', exact: true }) });

    await druk(1);
    await page.waitForTimeout(400);
    await expect(venster).toHaveCount(0);
    await druk(1);
    await page.waitForTimeout(400);
    await expect(venster).toHaveCount(0);

    mpLaatLos(poort);
    await toontVersie(page, info, 2);
    await expect(venster, 'een tik van vóór het loslaten opent achteraf niets').toHaveCount(0);
    await druk(2);
    await expect(venster).toBeVisible();
    await expect(venster.getByLabel('Notitie voor de chauffeur')).toHaveValue(NOTITIE);
    await expect(venster.getByRole('button', { name: 'Notitie opslaan' })).toBeVisible();
    await expect(venster.getByRole('button', { name: 'Notitie verwijderen' })).toHaveCount(0);
    expect(schrijf.slice(naEerste).filter((x) => x.includes('/api/planning-notes') || x.includes('shift-swap'))).toEqual([]);
  });
}

test('Maandplanning: een maand verder met een 500 geeft de grote Foutkaart, nooit het bord van de vorige maand', async ({ page }, info) => {
  alleenIn(info, IPHONE, DESKTOP);
  const rol: MpRol = telefoon(info) ? 'chauffeur' : 'admin';
  const poort = await startMp(page, rol);
  await mpNaar(page, info, 'Maandplanning');
  await toontVersie(page, info, 1);
  poort.status = 500;
  if (telefoon(info)) await page.getByRole('button', { name: 'Volgende maand' }).tap();
  else await page.getByRole('button', { name: 'Volgende 2 weken' }).click();
  await expect(page.getByText('Dit kon niet laden')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Bijwerken is niet gelukt')).toHaveCount(0);
  await expect(page.locator(MP_RASTER)).toHaveCount(0);
  await expect(page.locator(MP_STRIP)).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.locator(MP_RASTER)).toHaveCount(0);
  await expect(page.locator(MP_STRIP)).toHaveCount(0);
});

// --- toetssteen 7: inhaalronde en koude start -----------------------------------

for (const [project, rol, tijd, maanden] of [[DESKTOP, 'admin', KRUIST, ['2026-10', '2026-11']], [IPHONE, 'chauffeur', BINNEN, ['2026-10']]] as Array<[string, MpRol, Date, string[]]>) {
  test(`Maandplanning (${rol}, ${maanden.length === 2 ? 'venster over een maandgrens' : 'venster in één maand'}): een koude start vraagt elke maand één keer; een inhaalronde met het scherm open ververst stil, zonder skelet`, async ({ page, context }, info) => {
    alleenIn(info, project);
    await page.clock.install({ time: tijd });
    await seed(page, { user: MP_GEBRUIKER[rol], view: 'bezetting' });
    const poort = await maandPoort(page, rol === 'chauffeur', tijd);
    await page.goto('/maandplanning');
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    await toontVersie(page, info, 1, tijd);
    // Ruim na de start (de eerste aansluiting doet geen volledige ronde): niets meer.
    await page.waitForTimeout(3000);
    expect([...poort.gets].sort(), 'koude start').toEqual([...maanden].sort());

    poort.versie = 2;
    await volgMpSkelet(page);
    const voor = poort.gets.length;
    await inhaalronde(page, context);
    // Meteen: de verversing van useZelfLadend bij "verbinding terug" (de
    // hoofdmaand, zoals op de basis). Na het salvo-venster (1,2 s): de stille
    // verversing van de inhaalronde, de hoofdmaand en de maand achter de
    // vensterrand als het venster een maandgrens kruist.
    await expect.poll(() => poort.gets.length - voor, { timeout: 10_000 }).toBe(1 + maanden.length);
    await page.waitForTimeout(2500);
    const erbij = poort.gets.slice(voor);
    info.annotations.push({ type: 'verzoeken na de inhaalronde', description: erbij.join(', ') });
    expect(erbij[0]).toBe('2026-10');
    expect(erbij.slice(1).sort()).toEqual([...maanden].sort());
    await toontVersie(page, info, 2, tijd);
    expect(await mpSkeletGezien(page), 'geen skelet').toBe(false);
  });
}

// --- toetssteen 8: de regel in de kop ------------------------------------------

/** De kop van het scherm (PageHeader), met titel en acties. */
const mpKop = (page: Page) => page.locator('main header').filter({ has: page.getByRole('heading', { level: 1, name: 'Maandplanning' }) });
/** Waar zoekveld en knoppen van de kop staan (afgerond op een halve pixel). */
const kopPlaatsen = (page: Page) => page.evaluate(() => {
  const kop = document.querySelector('main h1')!.closest('header')!;
  const vak = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.x * 2) / 2, Math.round(r.y * 2) / 2, Math.round(r.width * 2) / 2];
  };
  const knop = (naam: string) => [...kop.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === naam) ?? null;
  return {
    zoek: vak(kop.querySelector('input[type="search"]')),
    vorige: vak(knop('Vorige 2 weken')),
    volgende: vak(knop('Volgende 2 weken')),
    vandaag: vak(knop('Vandaag')),
    menu: vak(knop('Meer acties')),
  };
});

for (const [project, breedte, thema] of [
  [IPHONE, 360, 'light'], [IPHONE, 360, 'dark'], [IPHONE, 390, 'light'], [IPHONE, 390, 'dark'], [IPHONE, 700, 'light'],
  [DESKTOP, 768, 'light'], [DESKTOP, 1024, 'light'], [DESKTOP, 1280, 'light'], [DESKTOP, 1440, 'dark'],
] as Array<[string, number, 'light' | 'dark']>) {
  // Vanaf 1280 px op de rij, links van zoekveld en vensterknoppen; daaronder
  // op een eigen regel onder de knoppen (op 1024 px paste ze niet op de rij
  // en zakten Vandaag en het menu naar een tweede rij, gemeten 23-11).
  const opDeRij = breedte >= 1280;
  test(`Maandplanning, de regel in de kop op ${breedte} px (${thema}): duwt geen knop van zijn plek${opDeRij ? ', links van zoekveld en vensterknoppen' : ', op een eigen regel'}`, async ({ page }, info) => {
    alleenIn(info, project);
    const rol: MpRol = telefoon(info) ? 'planner' : 'admin';
    const poort = await startMp(page, rol, { thema });
    await page.setViewportSize({ width: breedte, height: telefoon(info) ? 844 : 900 });
    poort.houd = true;
    const voor = poort.gets.length;
    await mpNaar(page, info, 'Maandplanning');
    await expect.poll(() => poort.gets.length - voor).toBeGreaterThanOrEqual(1);
    await expect(mpSkelet(page).first()).toBeVisible();
    await expect(regel(page)).toHaveCount(0);
    await wachtOpAnimaties(page);
    const zonder = await kopPlaatsen(page);
    mpLaatLos(poort);
    await expect(regel(page)).toHaveText(/^Bijgewerkt om \d\d:\d\d$/);
    await wachtOpAnimaties(page);
    const met = await kopPlaatsen(page);
    info.annotations.push({ type: `kop op ${breedte} px`, description: `zonder regel ${JSON.stringify(zonder)} · met regel ${JSON.stringify(met)}` });
    expect(met, 'geen knop schoof').toEqual(zonder);
    const r = (await regel(page).boundingBox())!;
    if (opDeRij) {
      const vorige = (await mpKop(page).getByRole('button', { name: 'Vorige 2 weken' }).boundingBox())!;
      const zoek = (await mpKop(page).getByRole('searchbox').boundingBox())!;
      expect(r.x + r.width, 'links van het zoekveld').toBeLessThanOrEqual(zoek.x);
      expect(r.x + r.width, 'links van de vensterknoppen').toBeLessThanOrEqual(vorige.x);
      expect(r.y + r.height / 2, 'op dezelfde rij').toBeGreaterThan(vorige.y);
      expect(r.y + r.height / 2, 'op dezelfde rij').toBeLessThan(vorige.y + vorige.height);
    } else {
      const vandaag = (await mpKop(page).getByRole('button', { name: 'Vandaag', exact: true }).boundingBox())!;
      expect(r.y, 'op een eigen regel onder de knoppen').toBeGreaterThanOrEqual(vandaag.y + vandaag.height - 1);
      // Binnen het scherm, geen horizontale overloop.
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(breedte);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    }
  });
}
