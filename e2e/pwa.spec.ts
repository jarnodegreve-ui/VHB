import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { CHAUFFEUR, SESSION_KEY, apiFixtures, sessieInitScript } from '../scripts/audit-fixtures.mjs';

/**
 * PWA-gedrag mét service worker (golf 4, punt 20). Alleen in het project
 * `pwa` (playwright.config.ts, `serviceWorkers: 'allow'`), los van de smoke:
 * `npm run test:e2e:pwa`, in CI niet-blokkerend.
 *
 * Wat hier wél end-to-end loopt:
 *  1. eerste laad: /sw.js registreert, wordt actief en neemt de controle
 *     (clients.claim); de shell staat in de build-gestempelde app-cache en
 *     GET_VERSION via een MessageChannel antwoordt met die cachenaam;
 *  2. koude offline start: na een tweede laad dóór de SW staan de Mijn-dag-
 *     API's (network-first met cache-fallback, lijst MIJN_DAG_API in
 *     public/sw-ritbladen.js) in de build-onafhankelijke cache
 *     'vhb-ritbladen'; met het netwerk uit toont Mijn dag de gecachte
 *     dienst met het stille offline-label;
 *  2b. bijlagen van omleidingen (29-09, onderaan deze spec): na één opening
 *     met bereik opent de bijlage zonder bereik, ook na een koude start; een
 *     vervangen bijlage toont de nieuwe; een verwijderde bijlage gaat uit de
 *     cache zodra een verse lijst binnen is en blijft staan zolang de lijst
 *     uit de cache komt; na uitloggen is de cache weg; een vervanging met
 *     dezelfde naam en grootte toont de nieuwe (uploadmoment van de server);
 *  2c. persoonlijke documenten (29-09, onderaan): openen in de app zonder
 *     spoor in Cache Storage, localStorage, sessionStorage of IndexedDB, met
 *     no-store opgehaald; zonder bereik de foutstaat, de viewer uit de precache;
 *  3. update-flow: een nieuwe worker (dezelfde sw.js onder een andere
 *     script-URL, want een nieuwe build is hier niet te maken) installeert,
 *     blijft wachten, de app toont de "Vernieuw"-toast, de klik stuurt
 *     SKIP_WAITING, index.html herlaadt op controllerchange en de nieuwe
 *     worker heeft daarna de controle.
 *
 * Wat NIET e2e te testen is (en waarom):
 *  - een échte nieuwe build (andere cache-naam + andere asset-hashes): de
 *    webServer serveert één dist; het opruimen van de vórige app-cache in
 *    activate en het kopiëren van de pdf-chunks uit een oudere cache
 *    (PRECACHE_EXTRA) blijven handmatige PWA-check + src/lib/swRitbladen.test.ts;
 *  - de ritblad-PDF (cross-origin storage-URL, cache-first + cors-fallback):
 *    geen Supabase-storage in e2e; de sleutel-/snoeilogica zit in
 *    swRitbladen.test.ts;
 *  - push/notificationclick: geen push-service in headless Chromium;
 *  - de navigatie-timeout van 3 s op een traag netwerk (NAV_TIMEOUT_MS):
 *    Playwright kan wel offline zetten, maar geen "traag" emuleren zonder
 *    CDP-throttling per target; bewust buiten deze spec gehouden;
 *  - iOS/standalone-gedrag (hervatten uit de app-switcher, registration.update
 *    bij visibilitychange): alleen Chromium heeft SW-ondersteuning in Playwright.
 *
 * Mocking: `context.route`, niet `page.route`. Fetches die de service worker
 * zelf doet horen bij de context, niet bij de pagina; met page.route gingen
 * ze naar de échte preview-server (SPA-fallback = index.html als "JSON").
 * De assertions zijn tolerant over de precieze cache-inhoud: de lijst met
 * gecachte API-paden groeit in een andere golf; we eisen alleen de kern
 * (/api/me en /api/planning) en de zichtbare dienst.
 */

const RITBLADEN_CACHE = 'vhb-ritbladen';

async function seedContext(context: BrowserContext, page: Page, opties: { eenmalig?: boolean } = {}) {
  await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user: CHAUFFEUR, view: 'mijn-dag', thema: 'light', eenmalig: opties.eenmalig === true });
  await context.route('**/api/**', apiFixtures(CHAUFFEUR));
}

/** Wacht tot de SW actief is én deze pagina controleert (clients.claim). */
async function wachtOpControle(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
}

/** GET_VERSION via MessageChannel, zoals src/lib/appVersion.ts het doet. */
const vraagVersie = (page: Page) => page.evaluate(() => new Promise<string | null>((resolve) => {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return resolve(null);
  const kanaal = new MessageChannel();
  const timer = window.setTimeout(() => resolve(null), 3000);
  kanaal.port1.onmessage = (event) => {
    window.clearTimeout(timer);
    resolve(typeof event.data?.version === 'string' ? event.data.version : null);
  };
  controller.postMessage({ type: 'GET_VERSION' }, [kanaal.port2]);
}));

const gecachtePaden = (page: Page) => page.evaluate(async (naam) => {
  if (!(await caches.has(naam))) return [] as string[];
  const cache = await caches.open(naam);
  return (await cache.keys()).map((r) => new URL(r.url).pathname);
}, RITBLADEN_CACHE);

test.describe('pwa: service worker', () => {
  test('ritbladlink: eerste opening vernieuwt verlopen cache, offline blijft de laatste metadata beschikbaar', async ({ page, context }) => {
    await seedContext(context, page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await wachtOpControle(page);

    const vers = { filename: 'bundel.pdf', url: 'https://storage.test/ritblaadjes/bundel.pdf?token=vers' };
    await context.route('**/api/ritblaadje', (route) => route.fulfill({ json: vers }));
    await page.evaluate(async ({ naam, meta }) => {
      const cache = await caches.open(naam);
      await cache.put('/api/ritblaadje', new Response(JSON.stringify(meta), {
        headers: { 'content-type': 'application/json' },
      }));
    }, { naam: RITBLADEN_CACHE, meta: { ...vers, url: vers.url.replace('token=vers', 'token=verlopen') } });

    // Gewone fetch, zoals de oude Ritbladen-pagina: de SW mag ook zonder
    // expliciete no-store nooit eerst de verlopen link uit de cache geven.
    expect(await page.evaluate(async () => (await fetch('/api/ritblaadje')).json())).toEqual(vers);
    await expect.poll(() => page.evaluate(async (naam) => {
      const cache = await caches.open(naam);
      return (await cache.match('/api/ritblaadje'))?.json();
    }, RITBLADEN_CACHE)).toEqual(vers);

    await context.unroute('**/api/ritblaadje');
    await context.unroute('**/api/**');
    await context.setOffline(true);
    const offline = await page.evaluate(async () => {
      const res = await fetch('/api/ritblaadje', { cache: 'no-store' });
      return { bron: res.headers.get('X-VHB-Bron'), meta: await res.json() };
    });
    expect(offline).toEqual({ bron: 'cache', meta: vers });
  });

  test('eerste laad: SW registreert, neemt de controle en GET_VERSION antwoordt met de gestempelde cachenaam', async ({ page, context }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await seedContext(context, page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    await wachtOpControle(page);
    const scriptURL = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '');
    expect(scriptURL).toMatch(/\/sw\.js$/);

    // Cachenaam is per build gestempeld (vite.config.ts): nooit de placeholder.
    const versie = await vraagVersie(page);
    expect(versie).toMatch(/^vhb-portaal-/);
    expect(versie).not.toContain('__VHB_BUILD_ID__');

    // De shell is bij install voorgecachet in de app-cache met die naam.
    const shellGecachet = await page.evaluate(async (naam) => {
      const cache = await caches.open(naam);
      return Boolean(await cache.match('/'));
    }, versie as string);
    expect(shellGecachet, 'index.html in de app-cache (precacheShell)').toBe(true);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('koude offline start: Mijn dag toont de gecachte dienst met het offline-label', async ({ page, context }) => {
    await seedContext(context, page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await wachtOpControle(page);

    // Tweede laad: nu lopen de GET's door de SW en vult network-first de
    // ritbladen-cache met de Mijn-dag-API's.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('2101').first()).toBeVisible();
    await expect.poll(() => gecachtePaden(page), { timeout: 10_000, message: 'kern van de Mijn-dag-API in vhb-ritbladen' })
      .toEqual(expect.arrayContaining(['/api/me', '/api/planning']));

    // Netwerk weg. Twee dingen tegelijk, want Playwright vervult routes vóór
    // de netwerkemulatie (een gerouteerde /api/me "slaagt" ook offline):
    //  - alle /api/** op abort: de network-first-fetch van de SW faalt en
    //    valt terug op vhb-ritbladen; de HEAD /api/health van useOnline
    //    faalt ook, dus het label komt ongeacht navigator.onLine;
    //  - setOffline voor navigator.onLine + de navigatie zelf (die komt dan
    //    uit de shell-cache van de SW).
    await context.unroute('**/api/**');
    await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('2101').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Offline · (gegevens van \d{2}:\d{2}|opgeslagen gegevens)/)).toBeVisible();

    await context.setOffline(false);
  });

  test('update-flow: nieuwe worker → "Vernieuw"-toast → SKIP_WAITING → herlaad op de nieuwe worker', async ({ page, context }) => {
    await seedContext(context, page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await wachtOpControle(page);
    // App opnieuw mounten mét controller: pas dan biedt App.tsx een
    // wachtende worker aan (zonder controller is het "eerste installatie").
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    // Nieuwe versie simuleren: dezelfde sw.js onder een andere script-URL is
    // voor de browser een nieuwe worker; die installeert en blijft wachten
    // (geen skipWaiting in install).
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js?versie=e2e-nieuw', { updateViaCache: 'none' }).then(() => undefined));
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL ?? null), { timeout: 15_000 })
      .toContain('versie=e2e-nieuw');
    await expect(page.getByText('Er staat een nieuwe versie van het portaal klaar.')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Vernieuw', exact: true }).click();
    // SKIP_WAITING → activate → controllerchange → index.html herlaadt één
    // keer. Poll met vangnet: tijdens de herlaad is er even geen context.
    await expect.poll(async () => {
      try { return await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''); } catch { return ''; }
    }, { timeout: 20_000, message: 'nieuwe worker heeft de controle' }).toContain('versie=e2e-nieuw');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    expect(await vraagVersie(page)).toMatch(/^vhb-portaal-/);
  });
});

/**
 * Bijlagen van omleidingen en updates (controle-ronde 29-09, nr. 2). De PDF
 * komt van een andere origin, zoals de opslag in productie; de viewer in de
 * app bewaart hem in 'vhb-bijlagen-v1' (src/lib/bijlageCache.ts) en de service
 * worker ruimt op zodra een verse lijst binnenkomt (public/sw-bijlagen.js).
 */
const BIJLAGEN_CACHE = 'vhb-bijlagen-v1';
const OPSLAG = 'https://opslag.test';
const PLAN_PAD = '/storage/v1/object/sign/diversions/d1-1.pdf';
const PLAN = 'Omleidingsplan lijn 58.pdf';
const OMLEIDING = 'Werken Markt Zottegem';

async function maakPdf(kop: string, paginas: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i++) pdf.addPage([595, 842]).drawText(`${kop}, blad ${i}`, { x: 40, y: 780, size: 18, font });
  return Buffer.from(await pdf.save());
}

type Bijlage = { slot: number; filename: string; sizeBytes: number; url: string; uploadedAt?: string };
type BijlagenStaat = {
  /** Wat de server nu in de lijst zet; leeg = de bijlage is verwijderd. */
  bijlagen: Bijlage[];
  /** Wat de opslag nu op het pad van de bijlage heeft hangen. */
  pdf: Buffer;
  /** Aantal keren dat de opslag het bestand leverde. */
  downloads: number;
};

/**
 * Sessie, API en opslag; `staat` bepaalt wat server en opslag teruggeven.
 *
 * De chunks gaan zonder `Vary` naar de browser. De preview-server (vite
 * preview) zet `Vary: Origin` op elk bestand, en de service worker zoekt met
 * `caches.match(req)`, dat die kop volgt: een chunk die de warmup met een
 * prefetch in de cache zette (zonder Origin) past dan niet op de latere
 * import van dezelfde chunk (met Origin). Welke van de twee eerst komt is een
 * race, en zonder bereik viel de koude start daardoor de ene keer wel en de
 * andere keer niet om, los van de bijlagen. Bestaand gedrag van sw.js, hier
 * niet gewijzigd; deze tests halen alleen de kop van de testserver weg.
 */
async function seedBijlagen(context: BrowserContext, page: Page, staat: BijlagenStaat, opties: { eenmalig?: boolean } = {}) {
  await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user: CHAUFFEUR, view: 'omleidingen', thema: 'light', eenmalig: opties.eenmalig === true });
  await context.route('**/assets/**', async (route) => {
    try {
      const antwoord = await route.fetch();
      const headers = { ...antwoord.headers() };
      delete headers.vary;
      await route.fulfill({ response: antwoord, headers });
    } catch {
      // Zonder bereik (of de test is klaar): gewoon laten mislukken.
      await route.abort('internetdisconnected').catch(() => undefined);
    }
  });
  await context.route('**/api/**', apiFixtures(CHAUFFEUR, (pad: string) => (pad.endsWith('/api/diversions')
    ? [{ id: 'd1', line: '58', location: 'Zottegem', title: OMLEIDING, description: 'Omleiding via de ring.', startDate: '2026-01-01', endDate: '2099-12-31', _rev: 'r1', ...(staat.bijlagen.length ? { bijlagen: staat.bijlagen } : {}) }]
    : undefined)));
  await context.route(`${OPSLAG}/**`, (route) => {
    staat.downloads += 1;
    return route.fulfill({ contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: staat.pdf });
  });
}

const planBijlage = (sizeBytes: number, token: string): Bijlage => ({ slot: 1, filename: PLAN, sizeBytes, url: `${OPSLAG}${PLAN_PAD}?token=${token}` });

/**
 * Eerste laad (SW neemt de controle), dan de omleiding openen door de SW.
 * Met een herlaad erbij, zoals de koude start van Mijn dag hierboven: wat de
 * eerste laad ophaalde vóór de SW de controle had, kan de browser bij een
 * gewone navigatie uit zijn eigen geheugen hergebruiken, en dan ziet de SW
 * die chunks nooit. Een herlaad stuurt alles langs de SW.
 */
async function openOmleiding(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await wachtOpControle(page);
  await page.goto('/omleidingen/d1');
  const detail = page.getByRole('dialog', { name: OMLEIDING, exact: true });
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(detail).toBeVisible({ timeout: 15_000 });
  return detail;
}

/** De bijlage openen en wachten tot pdfjs de eerste pagina getekend heeft. */
async function openBijlage(page: Page) {
  await page.getByRole('dialog', { name: OMLEIDING, exact: true }).getByRole('button', { name: PLAN, exact: true }).click();
  const laag = page.getByRole('dialog', { name: PLAN, exact: true });
  const canvas = laag.getByRole('img', { name: `Pagina 1 van ${PLAN}`, exact: true });
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.getContext('2d')!.getImageData(10, 10, 1, 1).data[3]), { timeout: 20_000 }).toBe(255);
  return laag;
}

/**
 * De viewer sluiten met zijn terugknop. De laag ruimt haar history-entry
 * daarna zelf op met een terugstap (src/lib/lagen.ts); pas als die geland is
 * mag de test herladen, anders breekt de ene navigatie de andere af.
 */
async function sluitViewer(page: Page) {
  const laag = page.getByRole('dialog', { name: PLAN, exact: true });
  const entry = await page.evaluate(() => history.state?.vhbLaagNr ?? null);
  await laag.getByRole('button', { name: 'Terug', exact: true }).click();
  await expect(laag).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => history.state?.vhbLaagNr ?? null)).not.toBe(entry);
}

/** Wat er in de bijlagen-cache staat: pad (zonder token) en versie per bestand. */
const bewaardeBijlagen = (page: Page) => page.evaluate(async (naam) => {
  if (!(await caches.has(naam))) return null;
  const cache = await caches.open(naam);
  const uit: Array<{ sleutel: string; versie: string | null; soort: string | null }> = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    uit.push({ sleutel: req.url, versie: res?.headers.get('X-VHB-Bijlage-Versie') ?? null, soort: res?.headers.get('X-VHB-Bijlage-Soort') ?? null });
  }
  return uit;
}, BIJLAGEN_CACHE);

const geenNetwerk = (route: Route) => route.abort('internetdisconnected');

/**
 * Netwerk weg: API en opslag falen, de navigatie komt uit de shell-cache.
 * De afbrekende routes komen BOVENOP de bestaande (de laatst geregistreerde
 * wint) in plaats van ze eerst weg te halen: in het gat daartussen zou een
 * lopende poll bij de echte preview-server uitkomen, die op elk pad de shell
 * teruggeeft.
 */
async function zonderBereik(context: BrowserContext) {
  await context.route('**/api/**', geenNetwerk);
  await context.route(`${OPSLAG}/**`, geenNetwerk);
  await context.route('**/assets/**', geenNetwerk);
  await context.setOffline(true);
}

/** Weer bereik: de afbrekende routes weg, de fixtures eronder gelden weer. */
async function metBereik(context: BrowserContext) {
  await context.setOffline(false);
  await context.unroute('**/api/**', geenNetwerk);
  await context.unroute(`${OPSLAG}/**`, geenNetwerk);
  await context.unroute('**/assets/**', geenNetwerk);
}

test.describe('pwa: bijlagen van omleidingen', () => {
  // Elke test installeert de service worker (met de pdf-chunks in de
  // precache), tekent een PDF en herlaadt een of twee keer: ruimer dan de
  // standaard 30 s, anders valt hij op een drukke runner om op de klok.
  test.describe.configure({ timeout: 90_000 });

  test('na één keer openen met bereik opent de bijlage zonder bereik, ook na een koude start', async ({ page, context }) => {
    // De preview-server kent /_vercel/speed-insights/script.js niet en geeft
    // er de shell voor terug; dat script struikelt dan over de eerste "<".
    // Geen fout van de app, en elke andere fout telt wel.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => { if (err.message !== "Unexpected token '<'") pageErrors.push(err.message); });
    const staat: BijlagenStaat = { bijlagen: [planBijlage(182_000, 'vandaag')], pdf: await maakPdf('Omleidingsplan', 2), downloads: 0 };
    await seedBijlagen(context, page, staat);
    await openOmleiding(page);

    const laag = await openBijlage(page);
    await expect(laag.getByText('2 pagina’s')).toBeVisible();
    // Met bereik geen aanduiding: die is er alleen zonder bereik, zoals bij het ritblad.
    await expect(laag.getByText(/opgeslagen exemplaar/)).toHaveCount(0);
    // Bewaard op het pad, zonder het token uit de link.
    await expect.poll(() => bewaardeBijlagen(page)).toEqual([{ sleutel: `${OPSLAG}${PLAN_PAD}`, soort: 'omleiding', versie: `${encodeURIComponent(PLAN)}|182000|` }]);
    expect(staat.downloads).toBe(1);
    await sluitViewer(page);

    // Koude start zonder bereik: shell, lijst en viewer uit de caches van de
    // service worker, de PDF uit de bijlagen-cache.
    await zonderBereik(context);
    await page.reload();
    await expect(page.getByRole('dialog', { name: OMLEIDING, exact: true })).toBeVisible({ timeout: 20_000 });
    const offline = await openBijlage(page);
    await expect(offline.getByText('2 pagina’s · opgeslagen exemplaar')).toBeVisible({ timeout: 10_000 });
    await expect(offline.getByRole('heading', { name: 'Bijlage kon niet geladen worden' })).toHaveCount(0);
    expect(staat.downloads).toBe(1);

    await metBereik(context);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('een vervangen bijlage toont de nieuwe, nooit het vorige bestand', async ({ page, context }) => {
    const staat: BijlagenStaat = { bijlagen: [planBijlage(182_000, 'eerste')], pdf: await maakPdf('Omleidingsplan versie 1', 1), downloads: 0 };
    await seedBijlagen(context, page, staat);
    await openOmleiding(page);
    const eerste = await openBijlage(page);
    await expect(eerste.getByText('1 pagina', { exact: true })).toBeVisible();
    await expect.poll(async () => (await bewaardeBijlagen(page))?.[0]?.versie).toBe(`${encodeURIComponent(PLAN)}|182000|`);

    await sluitViewer(page);

    // De planner vervangt het plan: zelfde plaats (dus zelfde pad in de
    // opslag) en zelfde naam, ander bestand. Alleen de grootte verraadt het.
    staat.bijlagen = [planBijlage(207_500, 'tweede')];
    staat.pdf = await maakPdf('Omleidingsplan versie 2', 3);
    await page.reload();
    await expect(page.getByRole('dialog', { name: OMLEIDING, exact: true })).toBeVisible({ timeout: 15_000 });
    // De verse lijst is binnen: de service worker gooit het oude bestand weg.
    await expect.poll(() => bewaardeBijlagen(page), { timeout: 10_000 }).toEqual([]);

    const tweede = await openBijlage(page);
    await expect(tweede.getByText('3 pagina’s')).toBeVisible();
    await expect.poll(() => bewaardeBijlagen(page)).toEqual([{ sleutel: `${OPSLAG}${PLAN_PAD}`, soort: 'omleiding', versie: `${encodeURIComponent(PLAN)}|207500|` }]);
    expect(staat.downloads).toBe(2);
    await sluitViewer(page);

    // Ook zonder bereik is het daarna de nieuwe.
    await zonderBereik(context);
    await page.reload();
    await expect(page.getByRole('dialog', { name: OMLEIDING, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect((await openBijlage(page)).getByText('3 pagina’s · opgeslagen exemplaar')).toBeVisible({ timeout: 10_000 });
    await metBereik(context);
  });

  test('een verwijderde bijlage gaat uit de cache op een verse lijst, niet op een lijst uit de cache', async ({ page, context }) => {
    const staat: BijlagenStaat = { bijlagen: [planBijlage(182_000, 'a')], pdf: await maakPdf('Omleidingsplan', 1), downloads: 0 };
    await seedBijlagen(context, page, staat);
    await openOmleiding(page);
    await openBijlage(page);
    await sluitViewer(page);
    await expect.poll(async () => (await bewaardeBijlagen(page))?.length).toBe(1);

    // Zonder bereik komt de lijst uit de cache van de service worker en
    // mislukken de ophalingen: de bijlage blijft op het toestel staan.
    await zonderBereik(context);
    await page.reload();
    await expect(page.getByRole('dialog', { name: OMLEIDING, exact: true })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(await bewaardeBijlagen(page)).toHaveLength(1);

    // Weer bereik, en de planner heeft de bijlage intussen verwijderd.
    staat.bijlagen = [];
    await metBereik(context);
    await page.reload();
    await expect(page.getByRole('dialog', { name: OMLEIDING, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => bewaardeBijlagen(page), { timeout: 10_000 }).toEqual([]);
  });

  test('na uitloggen is de bijlagen-cache weg', async ({ page, context }) => {
    const staat: BijlagenStaat = { bijlagen: [planBijlage(182_000, 'a')], pdf: await maakPdf('Omleidingsplan', 1), downloads: 0 };
    // De sessie één keer: afmelden herlaadt de pagina (zie de afmeld-tests onderaan).
    await seedBijlagen(context, page, staat, { eenmalig: true });
    const detail = await openOmleiding(page);
    await openBijlage(page);
    await sluitViewer(page);
    await expect.poll(async () => (await bewaardeBijlagen(page))?.length).toBe(1);
    await detail.getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(detail).toHaveCount(0);

    await page.getByRole('button', { name: 'Accountmenu' }).click();
    await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
    await expect(page.getByRole('button', { name: /Inloggen|Aanmelden/ }).first()).toBeVisible({ timeout: 15_000 });
    // Niets van de vorige gebruiker blijft achter: de cache zelf is weg, net
    // als die met de API-antwoorden. Alleen de schil van de build staat er nog.
    await expect.poll(() => bewaardeBijlagen(page)).toBeNull();
    const over = await page.evaluate(() => caches.keys());
    expect(over.length).toBeGreaterThan(0);
    expect(over.filter((naam) => !naam.startsWith('vhb-portaal-'))).toEqual([]);
  });
});

/**
 * Uploadmoment (29-09): de server zet `uploadedAt` bij elke bijlage. Een
 * vervanging met exact dezelfde naam en grootte is daardoor voor de cache op
 * het toestel een ander bestand, en een verse lijst zonder vervanging laat
 * de bewaarde bijlage staan.
 */
test.describe('pwa: uploadmoment van een bijlage', () => {
  test.describe.configure({ timeout: 90_000 });

  test('een vervanging met dezelfde naam en grootte toont de nieuwe; zonder vervanging blijft de bijlage bewaard', async ({ page, context }) => {
    const VROEG = '2026-09-29T08:00:00.000Z';
    const LAAT = '2026-09-29T09:30:00.000Z';
    const staat: BijlagenStaat = { bijlagen: [{ ...planBijlage(182_000, 'eerste'), uploadedAt: VROEG }], pdf: await maakPdf('Omleidingsplan versie 1', 1), downloads: 0 };
    await seedBijlagen(context, page, staat);
    await openOmleiding(page);
    const eerste = await openBijlage(page);
    await expect(eerste.getByText('1 pagina', { exact: true })).toBeVisible();
    // Bewaard met het uploadmoment in de versie.
    await expect.poll(() => bewaardeBijlagen(page)).toEqual([{ sleutel: `${OPSLAG}${PLAN_PAD}`, soort: 'omleiding', versie: `${encodeURIComponent(PLAN)}|182000|${encodeURIComponent(VROEG)}` }]);
    await sluitViewer(page);

    // Een verse lijst met een nieuw token maar hetzelfde bestand: de bijlage blijft op het toestel.
    staat.bijlagen = [{ ...planBijlage(182_000, 'tweede'), uploadedAt: VROEG }];
    await page.reload();
    await expect(page.getByRole('dialog', { name: OMLEIDING, exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    expect(await bewaardeBijlagen(page)).toHaveLength(1);

    // De planner vervangt het plan: zelfde plaats, zelfde naam, zelfde grootte.
    // Alleen het uploadmoment van de server verraadt het.
    staat.bijlagen = [{ ...planBijlage(182_000, 'derde'), uploadedAt: LAAT }];
    staat.pdf = await maakPdf('Omleidingsplan versie 2', 3);
    await page.reload();
    await expect(page.getByRole('dialog', { name: OMLEIDING, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => bewaardeBijlagen(page), { timeout: 10_000 }).toEqual([]);
    const tweede = await openBijlage(page);
    await expect(tweede.getByText('3 pagina’s')).toBeVisible();
    await expect.poll(() => bewaardeBijlagen(page)).toEqual([{ sleutel: `${OPSLAG}${PLAN_PAD}`, soort: 'omleiding', versie: `${encodeURIComponent(PLAN)}|182000|${encodeURIComponent(LAAT)}` }]);
    expect(staat.downloads).toBe(2);
  });
});

/**
 * Persoonlijke documenten (29-09): een PDF opent in de app, maar er blijft
 * niets op het toestel. Hier mét service worker: Cache Storage vóór en na,
 * de inhoud van de bijlagen-cache, localStorage, sessionStorage en IndexedDB,
 * en hoe de viewer de PDF ophaalt (no-store). De link komt van de opslag-
 * origin, zoals in productie.
 */
const DOC_PAD = '/storage/v1/object/sign/user-documents/42/3f2a-loonbrief.pdf';
const DOC_URL = `${OPSLAG}${DOC_PAD}?token=doc`;
const LOONBRIEF = 'Loonbrief september.pdf';
/** Wat van het document nergens op het toestel mag opduiken. */
const DOC_SPOREN = ['user-documents', '3f2a-loonbrief', LOONBRIEF];

type DocumentStaat = BijlagenStaat & {
  loonbrief: Buffer;
  documentAanvragen: Array<{ url: string; headers: Record<string, string> }>;
  bevestigd: string[];
};

/** Sessie, API en opslag, met naast de omleiding ook de documenten van de chauffeur. */
async function seedDocumenten(context: BrowserContext, page: Page, staat: DocumentStaat) {
  await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user: CHAUFFEUR, view: 'omleidingen', thema: 'light' });
  // Elke fetch van de pagina met zijn cache-modus: zo is te zien hoe de viewer de PDF haalt.
  await page.addInitScript(() => {
    const venster = window as unknown as { __vhbFetches: Array<{ url: string; cache: string }> };
    venster.__vhbFetches = [];
    const echt = window.fetch.bind(window);
    window.fetch = (invoer: RequestInfo | URL, init?: RequestInit) => {
      const url = invoer instanceof Request ? invoer.url : String(invoer);
      venster.__vhbFetches.push({ url, cache: init?.cache ?? (invoer instanceof Request ? invoer.cache : 'default') });
      return echt(invoer, init);
    };
  });
  // Zelfde reden als in seedBijlagen: de chunks zonder `Vary`.
  await context.route('**/assets/**', async (route) => {
    try {
      const antwoord = await route.fetch();
      const headers = { ...antwoord.headers() };
      delete headers.vary;
      await route.fulfill({ response: antwoord, headers });
    } catch {
      await route.abort('internetdisconnected').catch(() => undefined);
    }
  });
  await context.route('**/api/**', apiFixtures(CHAUFFEUR, (pad: string, request: { method: () => string }) => {
    if (pad.endsWith('/api/diversions')) {
      return [{ id: 'd1', line: '58', location: 'Zottegem', title: OMLEIDING, description: 'Omleiding via de ring.', startDate: '2026-01-01', endDate: '2099-12-31', _rev: 'r1', ...(staat.bijlagen.length ? { bijlagen: staat.bijlagen } : {}) }];
    }
    if (pad.endsWith('/api/documents') && request.method() === 'GET') {
      return [{ id: 'd-loon', userId: '42', filename: LOONBRIEF, category: 'Loonbrief', sizeBytes: staat.loonbrief.length, uploadedAt: '2026-09-25T08:00:00Z', uploadedBy: 'Admin', url: DOC_URL, openedAt: null }];
    }
    if (pad.endsWith('/opened') && request.method() === 'POST') {
      staat.bevestigd.push(pad);
      return {};
    }
    return undefined;
  }));
  await context.route(`${OPSLAG}/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/user-documents/')) {
      staat.documentAanvragen.push({ url, headers: route.request().headers() });
      // Zoals de opslag: met een Cache-Control-kop die de browser zou mogen volgen.
      return route.fulfill({ contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' }, body: staat.loonbrief });
    }
    staat.downloads += 1;
    return route.fulfill({ contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: staat.pdf });
  });
}

/** Namen van de caches in Cache Storage, gesorteerd. */
const cacheNamen = (page: Page) => page.evaluate(async () => (await caches.keys()).sort());
/** Namen van de IndexedDB-databanken, gesorteerd. */
const idbNamen = (page: Page) => page.evaluate(async () => (typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name ?? '').sort() : []));
/** Waar op het toestel iets van het document staat: Cache Storage (elke cache),
 *  localStorage, sessionStorage en de namen in IndexedDB. Leeg = nergens. */
const documentSporen = (page: Page) => page.evaluate(async (zoek) => {
  const treffers: string[] = [];
  const bevat = (s: string | null | undefined) => typeof s === 'string' && zoek.some((z) => s.includes(z));
  for (const [naam, opslag] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const) {
    for (let i = 0; i < opslag.length; i++) {
      const sleutel = opslag.key(i) ?? '';
      if (bevat(sleutel) || bevat(opslag.getItem(sleutel))) treffers.push(`${naam}: ${sleutel}`);
    }
  }
  const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
  for (const db of dbs) if (bevat(db.name)) treffers.push(`IndexedDB: ${db.name}`);
  for (const naam of await caches.keys()) {
    for (const verzoek of await (await caches.open(naam)).keys()) if (bevat(verzoek.url)) treffers.push(`${naam}: ${verzoek.url}`);
  }
  return treffers;
}, DOC_SPOREN);

const documentKnop = (page: Page) => page.getByRole('button', { name: `Open ${LOONBRIEF}`, exact: true });
const documentLaag = (page: Page) => page.getByRole('dialog', { name: LOONBRIEF, exact: true });

test.describe('pwa: persoonlijke documenten, niets op het toestel', () => {
  test.describe.configure({ timeout: 90_000 });

  test('opent in de app; daarna staat er niets nieuws in Cache Storage en de viewer haalde met no-store', async ({ page, context }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => { if (err.message !== "Unexpected token '<'") pageErrors.push(err.message); });
    const staat: DocumentStaat = {
      bijlagen: [planBijlage(182_000, 'vandaag')], pdf: await maakPdf('Omleidingsplan', 1), downloads: 0,
      loonbrief: await maakPdf('Loonbrief', 2), documentAanvragen: [], bevestigd: [],
    };
    await seedDocumenten(context, page, staat);
    // Eerst een bijlage van een omleiding: zo bestaat de bijlagen-cache en is
    // te zien dat een persoonlijk document er niets aan verandert.
    await openOmleiding(page);
    await openBijlage(page);
    await sluitViewer(page);
    await expect.poll(async () => (await bewaardeBijlagen(page))?.length).toBe(1);

    await page.goto('/documenten');
    await expect(documentKnop(page)).toBeVisible({ timeout: 15_000 });
    const namenVoor = await cacheNamen(page);
    const bijlagenVoor = await bewaardeBijlagen(page);
    const idbVoor = await idbNamen(page);
    expect(namenVoor).toContain(BIJLAGEN_CACHE);

    await documentKnop(page).click();
    const laag = documentLaag(page);
    const canvas = laag.getByRole('img', { name: `Pagina 1 van ${LOONBRIEF}`, exact: true });
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.getContext('2d')!.getImageData(10, 10, 1, 1).data[3]), { timeout: 20_000 }).toBe(255);
    await expect(laag.getByText('2 pagina’s')).toBeVisible();
    await expect.poll(() => staat.bevestigd).toEqual(['/api/documents/d-loon/opened']);
    await laag.getByRole('button', { name: 'Terug', exact: true }).click();
    await expect(laag).toHaveCount(0);
    // Wat nog op de achtergrond zou lopen, krijgt de tijd.
    await page.waitForTimeout(1500);

    // Niets nieuws in Cache Storage: dezelfde caches, en de bijlagen-cache ongewijzigd.
    expect(await cacheNamen(page)).toEqual(namenVoor);
    expect(await bewaardeBijlagen(page)).toEqual(bijlagenVoor);
    expect(await idbNamen(page)).toEqual(idbVoor);
    // Nergens op het toestel een spoor van het document.
    expect(await documentSporen(page)).toEqual([]);
    // Eén aanvraag naar de opslag, door de pagina zelf en met no-store; de
    // service worker heeft ze niet beantwoord (anders stond ze niet in dit log).
    const docFetches = await page.evaluate(() => (window as unknown as { __vhbFetches: Array<{ url: string; cache: string }> }).__vhbFetches.filter((f) => f.url.includes('/user-documents/')));
    expect(docFetches).toEqual([{ url: DOC_URL, cache: 'no-store' }]);
    expect(staat.documentAanvragen.map((a) => a.url)).toEqual([DOC_URL]);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('zonder bereik: de viewer komt uit de precache en zegt waarom het document niet opent; niets opgehaald', async ({ page, context }) => {
    const staat: DocumentStaat = {
      bijlagen: [], pdf: await maakPdf('Omleidingsplan', 1), downloads: 0,
      loonbrief: await maakPdf('Loonbrief', 1), documentAanvragen: [], bevestigd: [],
    };
    await seedDocumenten(context, page, staat);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await wachtOpControle(page);
    // Alles door de service worker, zoals bij de bijlagen hierboven.
    await page.goto('/documenten');
    await expect(documentKnop(page)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(documentKnop(page)).toBeVisible({ timeout: 15_000 });

    // Het bereik valt weg terwijl de lijst er staat; de viewer is in deze
    // sessie nog nooit geopend.
    await zonderBereik(context);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await documentKnop(page).click();
    const laag = documentLaag(page);
    await expect(laag.getByRole('heading', { name: 'Document kon niet geladen worden' })).toBeVisible({ timeout: 15_000 });
    await expect(laag.getByText(/Persoonlijke documenten openen alleen met bereik: ze worden niet op dit toestel bewaard\./)).toBeVisible();
    await expect(laag.getByRole('button', { name: 'Extern openen', exact: true })).toBeDisabled();
    expect(staat.documentAanvragen).toEqual([]);
    expect(staat.bevestigd).toEqual([]);
    expect(await documentSporen(page)).toEqual([]);
    await metBereik(context);
  });
});

/**
 * Filmnummers zonder bereik (01-10). Het scherm is er voor onderweg, maar zit
 * in geen warmup: zonder de precache (PRECACHE_EXTRA_MODULE in vite.config.ts)
 * opende het zonder bereik alleen als het in deze versie al eens mét bereik
 * geopend was, en de mislukte import eindigde in de herlaad van lazyRetry, die
 * zonder bereik de hele app wegnam (tegenlezing 01-10). De lijst zelf staat op
 * het toestel door de stille ophaling na de start (warmFilmnummers).
 */
test.describe('pwa: filmnummers zonder bereik', () => {
  test.describe.configure({ timeout: 90_000 });

  test('het scherm opent uit de precache met de lijst van de stille ophaling, ook als het nog nooit geopend is', async ({ page, context }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await seedContext(context, page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await wachtOpControle(page);

    // De service worker zette het scherm bij zijn installatie klaar, en de
    // app haalde de lijst na de start stil op. Het scherm zelf is nooit geopend.
    await expect.poll(() => page.evaluate(async () => {
      for (const naam of await caches.keys()) {
        const sleutels = await (await caches.open(naam)).keys();
        if (sleutels.some((r) => /\/assets\/FilmnummersView-/.test(r.url))) return true;
      }
      return false;
    }), { timeout: 20_000, message: 'het scherm Filmnummers in de precache' }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('vhb-filmnummers') !== null), { timeout: 30_000, message: 'de lijst op het toestel (stille ophaling na de start)' }).toBe(true);

    await zonderBereik(context);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const inhoud = page.locator('#hoofdinhoud');
    await inhoud.getByRole('button', { name: 'Filmnummers', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Filmnummers' })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/filmnummers$/);
    const bestemmingen = page.getByRole('list', { name: 'Bestemmingen' }).getByRole('listitem');
    await expect(bestemmingen).toHaveCount(13);
    // Geen bereik is hier geen fout: de lijst staat er, met het stille label.
    await expect(inhoud.getByText('Offline', { exact: true })).toBeVisible();
    await expect(inhoud.getByRole('alert')).toHaveCount(0);

    // Bereik terug: de lijst ververst stil en er verschijnt geen foutkaart.
    await metBereik(context);
    await expect(inhoud.getByText('Offline', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect(inhoud.getByRole('alert')).toHaveCount(0);
    await expect(bestemmingen).toHaveCount(13);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

/**
 * Afmelden op een gedeeld toestel (beveiligingsscan 01-10), het deel dat een
 * service worker nodig heeft. De rest (herlaad, laat antwoord in de state,
 * uitnodiging, wachtwoordherstel) staat in e2e/uitloggen.spec.ts.
 *
 *  - de service worker bewaart API-antwoorden op URL, zonder gebruiker in de
 *    sleutel: afmelden wist die cache, en een antwoord dat pas daarna
 *    binnenkomt gaat er niet meer in (bericht 'wis-prive', public/sw.js);
 *  - de schil blijft staan: afmelden zonder bereik herlaadt naar het
 *    inlogscherm uit de schil-cache, geen foutpagina van de browser;
 *  - wie zich aanmeldt terwijl /api/me het netwerk niet haalt, start nooit
 *    met het profiel van de vorige gebruiker uit de cache, ook niet na een
 *    afmelding op een toestel dat nog geen auth-id bewaard had;
 *  - een toestel van vóór deze regel (caches gevuld, geen auth-id bewaard)
 *    opent Mijn dag zonder bereik uit de cache zoals altijd, en verliest
 *    niets.
 */
test.describe('pwa: afmelden op een gedeeld toestel', () => {
  test.describe.configure({ timeout: 90_000 });

  const meldAf = async (page: Page) => {
    await page.getByRole('button', { name: 'Accountmenu' }).click();
    await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
  };
  const loginKnop = (page: Page) => page.getByRole('button', { name: 'Inloggen' });
  const merk = (page: Page) => page.evaluate(() => { (window as unknown as { __zelfdePagina?: boolean }).__zelfdePagina = true; });
  const gemerkt = (page: Page) => page.evaluate(() => (window as unknown as { __zelfdePagina?: boolean }).__zelfdePagina === true);

  /** Aangemeld, de service worker heeft de controle en de Mijn-dag-API staat in de cache. */
  async function startMetCache(context: BrowserContext, page: Page) {
    await seedContext(context, page, { eenmalig: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await wachtOpControle(page);
    await page.reload();
    await expect(page.getByText('2101').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => gecachtePaden(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(['/api/me', '/api/planning']));
  }

  test('afmelden zonder bereik: het inlogscherm komt uit de schil, de privé-cache is weg', async ({ page, context }) => {
    await startMetCache(context, page);
    await merk(page);
    // Het accountmenu laadt bij aanwijzer of focus zijn overlays voor, onder
    // meer de agenda-export via lazyRetry. Staat die chunk niet in de cache,
    // dan mislukt dat zonder bereik en herlaadt lazyRetry de pagina 0,8 s
    // later, na eerst de schil te wissen (bestaand gedrag, los van het
    // afmelden). Hier staat hij er al, zoals op een toestel na de warmup; zo
    // hangt de test niet af van wie die 0,8 s wint.
    await page.getByRole('button', { name: 'Accountmenu' }).focus();
    await expect.poll(() => page.evaluate(async () => {
      for (const naam of await caches.keys()) {
        const sleutels = await (await caches.open(naam)).keys();
        if (sleutels.some((r) => /\/assets\/roosterIcs-/.test(r.url))) return true;
      }
      return false;
    }), { timeout: 20_000, message: 'de agenda-export in de cache van de service worker' }).toBe(true);

    await context.route('**/api/**', geenNetwerk);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await meldAf(page);

    await expect(loginKnop(page)).toBeVisible({ timeout: 20_000 });
    expect(await gemerkt(page), 'de pagina is herladen, uit de schil-cache').toBe(false);
    const over = await page.evaluate(() => caches.keys());
    expect(over.filter((naam) => !naam.startsWith('vhb-portaal-'))).toEqual([]);
    expect(over.length).toBeGreaterThan(0);
    await context.setOffline(false);
  });

  test('een antwoord dat na de afmelding binnenkomt, vult de privé-cache niet opnieuw', async ({ page, context }) => {
    await startMetCache(context, page);
    // Een traag verzoek van de vorige gebruiker: het antwoord wacht tot na de afmelding.
    const LAAT = '/api/meldingen?laat=1';
    let laatLos!: () => void;
    const wacht = new Promise<void>((los) => { laatLos = los; });
    let onderweg = false;
    await context.route('**/api/meldingen?laat=1', async (route) => {
      onderweg = true;
      await wacht;
      await route.fulfill({ json: { meldingen: [{ id: 'a1', titel: 'Van de vorige gebruiker' }], ongelezen: 1 } });
    });
    await page.evaluate((url) => {
      (window as unknown as { __laat?: Promise<number> }).__laat = fetch(url).then((r) => r.status, () => -1);
    }, LAAT);
    await expect.poll(() => onderweg).toBe(true);

    // De pagina meldt de afmelding aan de service worker (src/lib/afmelden.ts).
    await page.evaluate(() => navigator.serviceWorker.controller!.postMessage({ type: 'wis-prive' }));
    await expect.poll(() => page.evaluate((naam) => caches.has(naam), RITBLADEN_CACHE)).toBe(false);

    laatLos();
    expect(await page.evaluate(() => (window as unknown as { __laat: Promise<number> }).__laat)).toBe(200);
    // Een verzoek van ná de afmelding wordt wel bewaard; staat dat er, dan is
    // de schrijfbeurt van het late antwoord ook voorbij (of overgeslagen).
    expect(await page.evaluate(async () => (await fetch('/api/updates?na=1')).status)).toBe(200);
    const sleutels = () => page.evaluate(async (naam) => {
      if (!(await caches.has(naam))) return [] as string[];
      return (await (await caches.open(naam)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
    }, RITBLADEN_CACHE);
    await expect.poll(sleutels, { timeout: 10_000 }).toContain('/api/updates?na=1');
    await page.waitForTimeout(300);
    expect(await sleutels()).not.toContain(LAAT);
  });

  test('een andere gebruiker zonder bereik op /api/me start niet met het profiel van de vorige uit de cache', async ({ page, context }) => {
    await startMetCache(context, page);
    const profielVanA = await page.evaluate(async (naam) => (await (await caches.open(naam)).match('/api/me'))!.text(), RITBLADEN_CACHE);
    expect(JSON.parse(profielVanA).name).toBe(CHAUFFEUR.name);

    // De sessie in de opslag is nu van iemand anders (aangemeld in een ander
    // tabblad, of net aangemeld en de pagina herlaadt), en het netwerk valt
    // weg. Het profiel van de vorige staat (weer) in de cache: /api/me zet
    // het er vlak voor zijn mislukking in, zoals een laat antwoord dat deed.
    await page.evaluate((key) => {
      const sessie = JSON.parse(window.localStorage.getItem(key)!);
      window.localStorage.setItem(key, JSON.stringify({ ...sessie, access_token: 'tok-b', user: { ...sessie.user, id: 'auth-b', email: 'alex@vhb.be' } }));
    }, SESSION_KEY);
    let profielGevraagd = 0;
    await context.route('**/api/**', geenNetwerk);
    await context.route('**/api/me', async (route) => {
      profielGevraagd += 1;
      await page.evaluate(async ({ naam, body }) => {
        await (await caches.open(naam)).put('/api/me', new Response(body, { headers: { 'content-type': 'application/json' } }));
      }, { naam: RITBLADEN_CACHE, body: profielVanA }).catch(() => undefined);
      await route.abort('internetdisconnected');
    });
    await context.setOffline(true);
    await page.reload();

    // Geen app van de vorige gebruiker: het profiel uit de cache telt niet,
    // de start blijft op het laadscherm staan (met de weg naar "vernieuw de
    // pagina"), zoals bij elke start waarvan het profiel niet te halen is.
    await expect.poll(() => profielGevraagd, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(page.getByText(/Dit duurt langer dan normaal/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(page.getByText('2101')).toHaveCount(0);
    await expect(page.getByText(CHAUFFEUR.name)).toHaveCount(0);
    // En zijn rooster is uit de cache: dat ging weg vóór het profiel werd gevraagd.
    expect(await gecachtePaden(page)).not.toContain('/api/planning');
    await context.setOffline(false);
  });

  /** Het toestel zoals main het achterliet: caches gevuld, het profiel-id van
   *  de vorige gebruiker in het oude kenmerk, nog geen auth-id bewaard. */
  const alsVoorDezeRegel = (page: Page) => page.evaluate((profielId) => {
    window.localStorage.removeItem('vhb-last-auth-id');
    window.localStorage.setItem('vhb-last-user-id', profielId);
  }, CHAUFFEUR.id);
  const bewaardAuthId = (page: Page) => page.evaluate(() => window.localStorage.getItem('vhb-last-auth-id'));

  test('toestel van vóór deze regel: koude start zonder bereik opent Mijn dag uit de cache, en niets wordt gewist', async ({ page, context }) => {
    await startMetCache(context, page);
    expect(await bewaardAuthId(page), 'een profiel van de server bewaart het auth-id').toBe('auth-e2e');
    await alsVoorDezeRegel(page);
    // Een merkteken in de privé-cache: staat het er straks nog, dan is er niet gewist.
    await page.evaluate(async (naam) => { await (await caches.open(naam)).put('/api/e2e-merkteken', new Response('x')); }, RITBLADEN_CACHE);

    // De eerste start op de nieuwe versie valt in een dode zone.
    await context.route('**/api/**', geenNetwerk);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('2101').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Offline · (gegevens van \d{2}:\d{2}|opgeslagen gegevens)/)).toBeVisible();
    expect(await gecachtePaden(page)).toEqual(expect.arrayContaining(['/api/me', '/api/planning', '/api/e2e-merkteken']));
    // Een profiel uit de cache bewijst niet wie dit is: nog geen auth-id.
    expect(await bewaardAuthId(page)).toBeNull();

    // Weer bereik: het profiel komt van de server, het auth-id wordt bewaard
    // en de caches van dezelfde gebruiker blijven.
    await context.setOffline(false);
    await context.unroute('**/api/**', geenNetwerk);
    await page.reload();
    await expect(page.getByText('2101').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => bewaardAuthId(page), { timeout: 10_000 }).toBe('auth-e2e');
    expect(await gecachtePaden(page)).toContain('/api/e2e-merkteken');
  });

  test('afmelden op een toestel zonder bewaard id: daarna start niemand met het profiel van de vorige uit de cache', async ({ page, context }) => {
    await startMetCache(context, page);
    const profielVanA = await page.evaluate(async (naam) => (await (await caches.open(naam)).match('/api/me'))!.text(), RITBLADEN_CACHE);
    await alsVoorDezeRegel(page);

    await meldAf(page);
    await expect(loginKnop(page)).toBeVisible({ timeout: 20_000 });
    // De afmelding laat het toestel niet op "geen id bewaard" staan.
    expect(await bewaardAuthId(page)).toBe('-');

    // Iemand anders heeft een sessie, /api/me haalt het netwerk niet, en het
    // profiel van de vorige staat (weer) in de cache.
    await page.evaluate((key) => {
      const straks = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(key, JSON.stringify({ access_token: 'tok-b', refresh_token: 'r-b', token_type: 'bearer', expires_in: 3600, expires_at: straks, user: { id: 'auth-b', email: 'alex@vhb.be', aud: 'authenticated' } }));
    }, SESSION_KEY);
    let profielGevraagd = 0;
    await context.route('**/api/**', geenNetwerk);
    await context.route('**/api/me', async (route) => {
      profielGevraagd += 1;
      await page.evaluate(async ({ naam, body }) => {
        await (await caches.open(naam)).put('/api/me', new Response(body, { headers: { 'content-type': 'application/json' } }));
      }, { naam: RITBLADEN_CACHE, body: profielVanA }).catch(() => undefined);
      await route.abort('internetdisconnected');
    });
    await context.setOffline(true);
    await page.reload();

    await expect.poll(() => profielGevraagd, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(page.getByText(/Dit duurt langer dan normaal/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(page.getByText(CHAUFFEUR.name)).toHaveCount(0);
    await context.setOffline(false);
  });
});
