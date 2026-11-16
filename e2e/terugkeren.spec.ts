import { test, expect, type Page, type Request, type Route, type TestInfo } from '@playwright/test';
import { ADMIN, gaIntern, seed, wachtOpAnimaties, type Extra } from './helpers';
import { apiFixtures, dayOffset } from '../scripts/audit-fixtures.mjs';
import { logIn } from './deeplinkHulp';

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
