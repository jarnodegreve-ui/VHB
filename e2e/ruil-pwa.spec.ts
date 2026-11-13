import { test, expect, type Page, type Request } from '@playwright/test';
import { CHAUFFEUR, SESSION_KEY, apiFixtures, sessieInitScript } from '../scripts/audit-fixtures.mjs';

/**
 * Dienstruil mét service worker (ronde 6, punt 12, tegenlezing 12-11). Draait
 * alleen in het project `pwa` (de bestandsnaam eindigt op pwa.spec.ts, zie
 * playwright.config.ts): de andere projecten blokkeren de service worker, dus
 * dit pad is daar niet te zien.
 *
 * De uren van een dienst van een collega komen van het maandbord
 * (/api/month-planning?month=). Dat antwoord staat in de offline-cache van de
 * service worker (OFFLINE_API in public/sw-ritbladen.js): mislukt het verzoek,
 * dan geeft de worker het bord van een vorige keer terug, met status 200 en
 * `X-VHB-Bron: cache`. Dat is geen antwoord van de server: Dienstruil toont
 * dan geen uren (de opdracht: "mislukt het … geen uren, nooit een uur raden").
 */

const ALEX_ID = '43';
const UREN = /\d{2}:\d{2}–\d{2}:\d{2}/;

/** Dag `dag` van de volgende maand: altijd in de toekomst en in één kalendermaand. */
const dagVolgendeMaand = (dag: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, dag).toLocaleDateString('sv-SE');
};

async function wachtOpControle(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
}

test('zonder bereik: het bord uit de cache van de service worker geeft geen uren, ook niet als het netwerk terugkomt', async ({ page, context }) => {
  // De preview-server kent /_vercel/speed-insights/script.js niet en geeft er
  // de shell voor terug; dat script struikelt dan over de eerste "<" (zoals in
  // e2e/pwa.spec.ts). Geen fout van de app, en elke andere fout telt wel.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => { if (err.message !== "Unexpected token '<'") pageErrors.push(err.message); });
  const dag = dagVolgendeMaand(5);
  const maand = dag.slice(0, 7);
  const voorstel = {
    id: 'pwa-v1', shiftId: 'x1', requesterId: ALEX_ID, targetDriverId: CHAUFFEUR.id, status: 'pending', reason: '',
    createdAt: new Date().toISOString(), shiftDate: dag, shiftLine: '2323', returnDate: dagVolgendeMaand(12), returnCode: 'vrij',
  };
  const bordMet = (segmenten: string[]) => ({
    month: maand, dates: [], drivers: [],
    cells: { [ALEX_ID]: { [dag]: { code: '2323', kind: 'service', label: 'Dienst 2323', segments: segmenten } } },
  });
  // De server: eerst het bord van vorige week, later gewijzigde uren.
  let bord = bordMet(['06:45–10:00']);
  let bordFaalt = false;
  const bordVerzoeken: string[] = [];

  await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user: CHAUFFEUR, view: 'dienstruil', thema: 'light', eenmalig: false });
  // context.route: ook wat de service worker zelf ophaalt komt hier langs (zie e2e/pwa.spec.ts).
  await context.route('**/api/**', apiFixtures(CHAUFFEUR, (p: string, request: Request) => {
    if (p.endsWith('/api/swaps') && request.method() === 'GET') return [voorstel];
    if (p.endsWith('/api/planning')) return [];
    if (p.endsWith('/api/availability')) return { days: [] };
    if (p.endsWith('/api/month-planning')) return bord;
    return undefined;
  }));
  // Later geregistreerd, dus eerst aan de beurt: telt de pogingen en laat ze
  // desgewenst mislukken zoals een haperend netwerk.
  await context.route('**/api/month-planning**', (route) => {
    bordVerzoeken.push(new URL(route.request().url()).searchParams.get('month') ?? '');
    return bordFaalt ? route.abort('internetdisconnected') : route.fallback();
  });

  const kaart = page.locator('[data-record="pwa-v1"]');
  await page.goto('/dienstruil');
  await expect(kaart).toBeVisible({ timeout: 15_000 });
  await wachtOpControle(page);

  // Tweede opening, nu door de service worker: het bord komt vers van de
  // server, staat in beeld en belandt in de offline-cache.
  await page.reload();
  await expect(kaart).toContainText('06:45–10:00');
  await expect.poll(() => page.evaluate(async (m) => {
    const cache = await caches.open('vhb-ritbladen');
    return (await cache.keys()).some((r) => r.url.includes('/api/month-planning') && r.url.includes(`month=${m}`));
  }, maand)).toBe(true);

  // Intussen wijzigen de uren op de server, maar het verzoek mislukt: de
  // worker antwoordt met het bord van vorige keer, met status 200.
  bord = bordMet(['07:30–11:00']);
  bordFaalt = true;
  const voor = bordVerzoeken.length;
  const uitCache = page.waitForResponse((r) => r.url().includes('/api/month-planning'));
  await page.reload();
  const antwoord = await uitCache;
  expect(antwoord.status()).toBe(200);
  expect(antwoord.headers()['x-vhb-bron']).toBe('cache');
  await expect(kaart).toBeVisible();
  expect(bordVerzoeken.length).toBeGreaterThan(voor);
  await page.waitForTimeout(500);

  // Geen uur van het oude bord (en geen geraden uur), geen fout, en de ruil
  // blijft te beantwoorden zoals vandaag.
  await expect(kaart).toContainText('Dienst 2323');
  await expect(kaart).not.toContainText(UREN);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(kaart.getByRole('button', { name: 'Accepteren' })).toBeEnabled();

  // Het netwerk komt terug: dit bezoek wordt die maand niet opnieuw gevraagd
  // (hoogstens één verzoek per maand per bezoek), dus er komt ook geen oud of
  // nieuw uur alsnog binnen. Een volgende opening vraagt het bord opnieuw.
  bordFaalt = false;
  const naMislukking = bordVerzoeken.length;
  await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
  await expect(page.getByText('Stap 1 van 3')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Stap 1 van 3')).toBeHidden();
  await page.waitForTimeout(500);
  expect(bordVerzoeken.length).toBe(naMislukking);
  await expect(kaart).not.toContainText(UREN);

  await page.reload();
  await expect(kaart).toContainText('07:30–11:00');
  await expect(kaart).not.toContainText('06:45');
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
