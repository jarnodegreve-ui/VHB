import { test, expect, type BrowserContext, type Page } from '@playwright/test';
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

async function seedContext(context: BrowserContext, page: Page) {
  await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user: CHAUFFEUR, view: 'mijn-dag', thema: 'light' });
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
