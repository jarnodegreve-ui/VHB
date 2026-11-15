import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, USERS, seed, type Fixture } from './helpers';

/**
 * De gedeelde klok (src/lib/nu.ts, ronde 6, punt 21c). De rekenregels van de
 * klok zelf staan in src/lib/nu.test.ts; hier wat iemand ziet:
 *
 *  1. Terug in de app (de PWA hing uren in de app-switcher): het nu-label, de
 *     dag en de dienst kloppen meteen, zonder op de volgende minuuttik te
 *     wachten. De klok van de pagina staat daarbij stil (`pauseAt`), zodat
 *     alleen de gebeurtenis van de terugkeer het scherm kan bijwerken.
 *  2. Een scherm dat na lange tijd opnieuw opent, toont nooit eerst de dag of
 *     de dienst van het vorige bezoek, ook niet één hertekening lang (een
 *     MutationObserver legt elke tekst vast, ook de oude waarde).
 *
 * Vaste dagen in plaats van "vandaag": de testdata staat los van de wandklok.
 */
const D = '2027-03-09'; // dinsdag
const D1 = '2027-03-10'; // woensdag
const om = (dag: string, uur: number, minuut: number, seconde = 0) => new Date(`${dag}T${String(uur).padStart(2, '0')}:${String(minuut).padStart(2, '0')}:${String(seconde).padStart(2, '0')}`);

const ALEX = (USERS as Array<{ id: string; name: string }>).find((u) => u.id === '43')!;

type Dienst = { id: string; date: string; startTime: string; endTime: string; line: string; busNumber: string; loopnr?: string; driverId: string };
const dienst = (id: string, date: string, startTime: string, endTime: string, line: string): Dienst => ({ id, date, startTime, endTime, line, busNumber: '', loopnr: '4500', driverId: (CHAUFFEUR as { id: string }).id });

type Terugkeer = 'visibilitychange' | 'pageshow' | 'focus';

/** Sessie, vaste testdata en een aanmeldserver die een verlopen token ververst:
 *  na een tijdsprong van uren is het token verlopen, en zonder dit antwoord
 *  eindigt de test op het inlogscherm in plaats van op de klok. */
async function open(page: Page, opties: { user: Fixture; view: string; nu: Date; planning?: Dienst[]; verlof?: unknown[]; bord?: (maand: string) => unknown }) {
  const fouten: string[] = [];
  // De e2e blokkeert de service worker: `register()` geeft dan niets terug, en
  // de update-check in index.html (op visibilitychange en focus) valt daarover.
  // Dat is de testopzet, niet de klok; in het echt is er een registratie.
  page.on('pageerror', (err) => { if (!/reading 'update'|registration\.update/.test(err.message)) fouten.push(err.message); });
  await page.clock.install({ time: opties.nu });
  const user = opties.user as { email: string };
  const authUser = { id: 'auth-e2e', email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
  await page.route('**/auth/v1/token**', (route) => route.fulfill({ json: { access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, user: authUser } }));
  await page.route('**/auth/v1/user**', (route) => route.fulfill({ json: authUser }));
  await seed(page, {
    user: opties.user,
    view: opties.view,
    thema: 'light',
    extra: (pad, request) => {
      if (opties.bord && pad.endsWith('/api/month-planning')) return opties.bord(new URL(request.url()).searchParams.get('month') ?? '');
      if (pad.endsWith('/api/planning')) return opties.planning ?? [];
      if (pad.endsWith('/api/leave')) return opties.verlof ?? [];
      if (pad.endsWith('/api/swaps')) return [];
      if (pad.endsWith('/api/diversions')) return [];
      if (pad.includes('/api/coverage-gaps')) return { days: [] };
      return undefined;
    },
  });
  return { fouten };
}

/**
 * De klok van de pagina stilzetten: vanaf hier loopt er geen enkele timer meer.
 * `pauseAt` zet eerst stil en schuift dan door naar het doel; lag dat doel op
 * een trage runner intussen in het verleden, dan staat de klok al stil en lukt
 * de tweede poging.
 */
const zetStil = (page: Page) => expect(async () => {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 2000));
}).toPass();

/**
 * De gebeurtenis van een terugkeer, en in dezelfde beurt (één taak later,
 * zonder dat er een timer kon lopen) lezen wat er staat.
 */
async function terugkeer<S extends Record<string, string>>(page: Page, soort: Terugkeer, lees: S): Promise<Record<keyof S, string | null>> {
  return page.evaluate(async ({ soort, lees }) => {
    (soort === 'visibilitychange' ? document : window).dispatchEvent(new Event(soort));
    await new Promise<void>((klaar) => {
      const kanaal = new MessageChannel();
      kanaal.port1.onmessage = () => klaar();
      kanaal.port2.postMessage(null);
    });
    return Object.fromEntries(Object.entries(lees).map(([naam, selector]) => [naam, document.querySelector(selector)?.textContent ?? null]));
  }, { soort, lees }) as Promise<Record<keyof S, string | null>>;
}

/**
 * Het tabblad verbergen of weer tonen zoals de browser het meldt: de stand én
 * de gebeurtenis. Verborgen houdt de klok geen timer aan; zichtbaar leest ze
 * opnieuw en lijnt ze de tik opnieuw uit.
 */
const zetZichtbaarheid = (page: Page, stand: 'hidden' | 'visible') => page.evaluate((stand) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => stand });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => stand === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, stand);

/** Het uur van de pagina zoals het portaal het toont (zelfde opmaak als formatSyncedTime). */
const paginaUur = (page: Page) => page.evaluate(() => new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }));

const KOP = '#hoofdinhoud header';
const NU_LABEL = '[data-rol="wijzer-label"]';
/** De regel onder de groet op het dashboard en de cockpit: dag en uur. */
const DAG_EN_UUR = '#hoofdinhoud h1 + p';

/** Wat de MutationObserver volgt: de kop van een scherm (dag, dienst) en de dagkiezer van Vandaag. */
const GEVOLGD = 'header, [role="group"][aria-label="Dag kiezen"]';

/**
 * Legt vanaf nu elke tekst vast die in een gevolgd blok staat, komt of stond:
 * ook de oude waarde van een gewijzigde tekst en de inhoud van wat verdween.
 * Alleen lezen na de navigatie bewijst niets, want een tweede hertekening kan
 * de oude tijd dan al vervangen hebben.
 */
async function volg(page: Page) {
  await page.evaluate((gevolgd) => {
    const log: string[] = [];
    (window as unknown as { __klokLog: string[] }).__klokLog = log;
    const wortel = document.getElementById('hoofdinhoud')!;
    const inGevolgd = (n: Node | null) => !!(n instanceof Element ? n : n?.parentElement)?.closest(gevolgd);
    const noteer = (n: Node, ouder: Node) => {
      // Een tekst of element binnen een gevolgd blok.
      if (inGevolgd(ouder)) log.push(n.textContent ?? '');
      // Een gevolgd blok zelf, of een heel scherm met zulke blokken erin.
      if (n instanceof Element) {
        for (const blok of [...(n.matches(gevolgd) ? [n] : []), ...n.querySelectorAll(gevolgd)]) log.push(blok.textContent ?? '');
      }
    };
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') {
          if (!r.target.isConnected || inGevolgd(r.target)) log.push(r.oldValue ?? '', r.target.textContent ?? '');
          continue;
        }
        r.addedNodes.forEach((n) => noteer(n, r.target));
        r.removedNodes.forEach((n) => noteer(n, r.target));
      }
      wortel.querySelectorAll(gevolgd).forEach((blok) => log.push(blok.textContent ?? ''));
    }).observe(wortel, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  }, GEVOLGD);
}
const gevolgd = (page: Page) => page.evaluate(() => (window as unknown as { __klokLog: string[] }).__klokLog);

test.describe('terug in de app: Mijn dag en het dashboard van de chauffeur', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, 'de schermen van de chauffeur, op de telefoon');
  });

  test('Mijn dag: het nu-label en "nog" kloppen meteen bij de terugkeer, zonder op de minuut te wachten', async ({ page }) => {
    const { fouten } = await open(page, { user: CHAUFFEUR, view: 'mijn-dag', nu: om(D, 10, 0, 5), planning: [dienst('k1', D, '08:00', '16:00', '2101')] });
    await page.goto('/mijn-dag');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dinsdag 9 maart', { timeout: 15_000 });
    await expect(page.locator(NU_LABEL)).toHaveCount(1);
    await zetStil(page);
    await expect(page.locator(NU_LABEL)).toHaveText(await paginaUur(page));

    // Vier uur en een half later, zonder dat er een timer liep.
    await page.clock.setSystemTime(om(D, 14, 37, 10));
    const na = await terugkeer(page, 'visibilitychange', { label: NU_LABEL, tijdlijn: '[aria-label="Tijdlijn van de dienst"]' });
    expect(na.label).toBe('14:37');
    expect(na.tijdlijn).toContain('nog 1u 23min');
    await expect(page.getByRole('img', { name: /nu 14:37/ })).toBeVisible();

    await page.clock.resume();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dinsdag 9 maart');
    await expect(page.locator(NU_LABEL)).toHaveText('14:37');
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('Mijn dag: terug na middernacht staan de nieuwe dag en haar dienst er meteen', async ({ page }) => {
    const { fouten } = await open(page, {
      user: CHAUFFEUR, view: 'mijn-dag', nu: om(D, 22, 30, 5),
      planning: [dienst('k1', D, '15:00', '23:00', '2101'), dienst('k2', D1, '05:00', '13:00', '2607')],
    });
    await page.goto('/mijn-dag');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dinsdag 9 maart', { timeout: 15_000 });
    await expect(page.locator(KOP)).toContainText('2101');
    await zetStil(page);

    // 06:00 de dag erna: de dienst van gisteren is al uren gedaan.
    await page.clock.setSystemTime(om(D1, 6, 0, 10));
    const na = await terugkeer(page, 'pageshow', { h1: '#hoofdinhoud h1', kop: KOP, label: NU_LABEL });
    expect(na.h1).toBe('Woensdag 10 maart');
    expect(na.kop).toContain('2607');
    expect(na.kop).not.toContain('2101');
    expect(na.kop).not.toContain('dienst van gisteren');
    expect(na.label).toBe('06:00');
    // Mijn week begint op de nieuwe dag.
    await expect(page.getByRole('region', { name: 'Mijn week' }).getByRole('listitem').first()).toHaveAccessibleName(/dienst 2607, 05:00 tot 13:00$/);

    await page.clock.resume();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Woensdag 10 maart');
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('Mijn dag: de nachtregel blijft gelden, een dienst van gisteren die nog loopt blijft de dag', async ({ page }) => {
    const { fouten } = await open(page, {
      user: CHAUFFEUR, view: 'mijn-dag', nu: om(D, 23, 50, 5),
      planning: [dienst('k1', D, '18:00', '26:16', '2607'), dienst('k2', D1, '15:00', '23:00', '2101')],
    });
    await page.goto('/mijn-dag');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dinsdag 9 maart', { timeout: 15_000 });
    await zetStil(page);

    await page.clock.setSystemTime(om(D1, 0, 30, 10));
    const na = await terugkeer(page, 'visibilitychange', { h1: '#hoofdinhoud h1', kop: KOP, label: NU_LABEL });
    expect(na.h1).toBe('Dinsdag 9 maart');
    expect(na.kop).toContain('Nog bezig · dienst van gisteren');
    expect(na.kop).toContain('2607');
    expect(na.label).toBe('00:30');

    await page.clock.resume();
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('dashboard: de dag, het uur en de dienst van vandaag zijn meteen die van de nieuwe dag', async ({ page }) => {
    const { fouten } = await open(page, {
      user: CHAUFFEUR, view: 'dashboard', nu: om(D, 22, 30, 5),
      planning: [dienst('k1', D, '15:00', '23:00', '2101'), dienst('k2', D1, '05:00', '13:00', '2607')],
    });
    await page.goto('/dashboard');
    await expect(page.locator(DAG_EN_UUR)).toContainText('dinsdag 9 maart', { timeout: 15_000 });
    await expect(page.locator(NU_LABEL)).toHaveCount(1);
    await zetStil(page);
    await expect(page.locator(DAG_EN_UUR)).toHaveText(`dinsdag 9 maart · ${await paginaUur(page)}`);

    await page.clock.setSystemTime(om(D1, 6, 0, 10));
    const na = await terugkeer(page, 'focus', { dag: DAG_EN_UUR, label: NU_LABEL });
    expect(na.dag).toBe('woensdag 10 maart · 06:00');
    expect(na.label).toBe('06:00');
    await expect(page.getByRole('img', { name: /^Dienst van 05:00 tot 13:00, nu 06:00/ })).toBeVisible();

    await page.clock.resume();
    await expect(page.locator(DAG_EN_UUR)).toHaveText('woensdag 10 maart · 06:00');
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('Mijn dag opnieuw geopend na middernacht toont nooit de dag of de dienst van gisteren', async ({ page }) => {
    const { fouten } = await open(page, {
      user: CHAUFFEUR, view: 'mijn-dag', nu: om(D, 22, 30, 5),
      planning: [dienst('k1', D, '15:00', '23:00', '2101'), dienst('k2', D1, '05:00', '13:00', '2607')],
    });
    await page.goto('/mijn-dag');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dinsdag 9 maart', { timeout: 15_000 });
    await expect(page.locator(KOP)).toContainText('2101');

    // Naar het rooster: geen enkel scherm luistert nog naar de klok.
    const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
    await dock.getByRole('button', { name: 'Rooster', exact: true }).tap();
    await expect(page).toHaveURL(/\/rooster$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Rooster' })).toBeVisible();

    await page.clock.setSystemTime(om(D1, 6, 0, 10));
    await volg(page);
    await dock.getByRole('button', { name: 'Mijn dag', exact: true }).tap();
    await expect(page).toHaveURL(/\/mijn-dag$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Woensdag 10 maart');
    await expect(page.locator(KOP)).toContainText('2607');

    const log = await gevolgd(page);
    expect(log.some((t) => t.includes('Woensdag 10 maart') && t.includes('2607')), 'de waarnemer zag de kop van Mijn dag komen').toBe(true);
    expect(log.filter((t) => /dinsdag 9 maart|2101|dienst van gisteren/i.test(t)), 'nooit de dag of de dienst van gisteren, ook niet één hertekening lang').toEqual([]);
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });
});

test('Vandaag: terug na middernacht is de dag meteen de nieuwe, ook in de weekstrook', async ({ page }) => {
  const { fouten } = await open(page, { user: ADMIN, view: 'vandaag', nu: om(D, 22, 30, 5) });
  await page.goto('/vandaag');
  await expect(page.locator(KOP)).toContainText('Dinsdag 9 maart', { timeout: 15_000 });
  const strook = page.getByRole('group', { name: 'Dag kiezen' }).getByRole('button');
  await expect(strook.first()).toHaveAccessibleName(/^Vandaag, di 9 maart: /);
  await zetStil(page);

  await page.clock.setSystemTime(om(D1, 6, 0, 10));
  const na = await terugkeer(page, 'visibilitychange', { kop: KOP, strook: '[role="group"][aria-label="Dag kiezen"]' });
  expect(na.kop).toContain('Woensdag 10 maart');
  expect(na.kop).not.toContain('Dinsdag 9 maart');
  expect(na.strook).toMatch(/^wo 10/);
  await expect(strook.first()).toHaveAccessibleName(/^Vandaag, wo 10 maart: /);
  await expect(strook.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(strook).toHaveCount(7);

  await page.clock.resume();
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
  await expect(page.locator(KOP)).toContainText('Woensdag 10 maart');
  expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
});

test.describe('de staf op desktop, met de muis', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'cockpit, Overzicht en de zijbalk: desktop');
  });

  test('cockpit: de dag en het uur in de kop zijn meteen bijgewerkt', async ({ page }) => {
    const { fouten } = await open(page, { user: ADMIN, view: 'dashboard', nu: om(D, 22, 30, 5) });
    await page.goto('/dashboard');
    await expect(page.locator(DAG_EN_UUR)).toContainText('dinsdag 9 maart', { timeout: 15_000 });
    await zetStil(page);
    await expect(page.locator(DAG_EN_UUR)).toHaveText(`dinsdag 9 maart · ${await paginaUur(page)}`);

    await page.clock.setSystemTime(om(D1, 6, 0, 10));
    const na = await terugkeer(page, 'pageshow', { dag: DAG_EN_UUR });
    expect(na.dag).toBe('woensdag 10 maart · 06:00');

    await page.clock.resume();
    await expect(page.locator(DAG_EN_UUR)).toHaveText('woensdag 10 maart · 06:00');
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('cockpit: mislukt het maandbord op het ogenblik van de terugkeer, dan staat de afwezige er bij de volgende minuuttik', async ({ page }) => {
    // De laptop klapt 's morgens open en het netwerk is er de eerste seconde
    // nog niet: het maandbord van de nieuwe dag wordt nu meteen gevraagd (de
    // klok meldt de dag bij de terugkeer) en dat verzoek mislukt, ook de ene
    // herkansing van apiFetch. Zonder een nieuwe poging bleef de tegel de
    // rest van de dag op "0 · iedereen inzetbaar" staan.
    const cel = { code: 'bv', kind: 'leave', label: 'Betaald verlof', segments: [] };
    const bord = (maand: string) => ({ month: maand, dates: [D, D1], drivers: [{ id: 'mx1', name: 'Matrix Afwezige' }], cells: { mx1: { [D]: cel, [D1]: cel } } });
    const { fouten } = await open(page, { user: ADMIN, view: 'dashboard', nu: om(D, 22, 30, 5), bord });
    const verzoeken: string[] = [];
    let bereik = true;
    await page.route('**/api/month-planning**', async (route) => {
      verzoeken.push(bereik ? 'door' : 'afgebroken');
      if (bereik) await route.fallback();
      else await route.abort('internetdisconnected');
    });
    await page.goto('/dashboard');
    const tegel = page.getByRole('button', { name: /^Vandaag afwezig/ });
    await expect(tegel).toContainText('0 ziek · 1 verlof', { timeout: 15_000 });
    await zetStil(page);

    // De nacht: het tabblad is verborgen, de klok van de pagina staat stil.
    await zetZichtbaarheid(page, 'hidden');
    await page.clock.setSystemTime(om(D1, 6, 0, 10));
    const bijTerugkeer = verzoeken.length;
    bereik = false;
    await zetZichtbaarheid(page, 'visible');
    await expect(page.locator(DAG_EN_UUR)).toHaveText('woensdag 10 maart · 06:00');
    // Het verzoek van de terugkeer en, 600 ms later, de herkansing van apiFetch.
    // Die wachttijd begint pas als de pagina de afbreking zag, en dat is later
    // dan het ogenblik waarop de proef het verzoek noteert: de klok schuift
    // daarom door tot de herkansing er is (ver onder de 50 s tot de tik van 06:01).
    await expect.poll(() => verzoeken.slice(bijTerugkeer)).toEqual(['afgebroken']);
    await expect(async () => {
      await page.clock.runFor(700);
      await expect.poll(() => verzoeken.slice(bijTerugkeer), { timeout: 1000 }).toEqual(['afgebroken', 'afgebroken']);
    }).toPass({ timeout: 10_000 });
    await expect(tegel).toContainText('iedereen inzetbaar');

    // Het netwerk is terug. De volgende minuuttik (06:01) probeert opnieuw.
    bereik = true;
    await page.clock.runFor(60_000);
    await expect(tegel).toContainText('0 ziek · 1 verlof');
    await expect(page.locator(DAG_EN_UUR)).toHaveText('woensdag 10 maart · 06:01');
    expect(verzoeken.slice(bijTerugkeer)).toEqual(['afgebroken', 'afgebroken', 'door']);

    // Gelukt is gelukt: de minuten daarna vraagt de cockpit het bord niet opnieuw.
    await page.clock.runFor(3 * 60_000);
    await expect(page.locator(DAG_EN_UUR)).toHaveText('woensdag 10 maart · 06:04');
    expect(verzoeken.slice(bijTerugkeer)).toEqual(['afgebroken', 'afgebroken', 'door']);
    await expect(tegel).toContainText('0 ziek · 1 verlof');

    await page.clock.resume();
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('Overzicht: "12 min geleden" is na drie uur weg meteen "3 u geleden"', async ({ page }) => {
    const nu = om(D, 10, 0, 5);
    const aanvraag = { id: 'kv1', userId: ALEX.id, startDate: '2027-03-22', endDate: '2027-03-24', type: 'betaald_verlof', status: 'pending', createdAt: new Date(nu.getTime() - 12 * 60_000 - 5000).toISOString() };
    const { fouten } = await open(page, { user: ADMIN, view: 'werkvoorraad', nu, verlof: [aanvraag] });
    await page.goto('/overzicht');
    const rij = page.getByRole('row', { name: new RegExp(`Verlofaanvraag · ${ALEX.name}`) });
    await expect(rij).toContainText('12 min geleden', { timeout: 15_000 });
    await zetStil(page);

    await page.clock.setSystemTime(om(D, 13, 10, 30));
    // In dezelfde beurt gelezen: de focus haalt ook gegevens bij, en een
    // hertekening dáárdoor (een netwerkantwoord later) telt hier niet als bewijs.
    const na = await terugkeer(page, 'focus', { rijen: '#hoofdinhoud tbody' });
    expect(na.rijen).toContain(`Verlofaanvraag · ${ALEX.name}`);
    expect(na.rijen).toContain('3 u geleden');
    expect(na.rijen).not.toContain('12 min geleden');
    await expect(rij).toContainText('3 u geleden');

    await page.clock.resume();
    await expect(rij).toContainText('3 u geleden');
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('Vandaag opnieuw geopend een dag later toont nooit de dag van gisteren', async ({ page }) => {
    const { fouten } = await open(page, { user: ADMIN, view: 'vandaag', nu: om(D, 10, 0, 5) });
    await page.goto('/vandaag');
    await expect(page.locator(KOP)).toContainText('Dinsdag 9 maart', { timeout: 15_000 });

    const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
    await zijbalk.getByRole('button', { name: 'Contacten', exact: true }).click();
    await expect(page).toHaveURL(/\/contacten$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Contacten' })).toBeVisible();

    await page.clock.setSystemTime(om(D1, 10, 0, 5));
    await volg(page);
    await zijbalk.getByRole('button', { name: 'Vandaag', exact: true }).click();
    await expect(page).toHaveURL(/\/vandaag$/);
    await expect(page.locator(KOP)).toContainText('Woensdag 10 maart');
    await expect(page.getByRole('group', { name: 'Dag kiezen' }).getByRole('button').first()).toHaveAccessibleName(/^Vandaag, wo 10 maart: /);

    const log = await gevolgd(page);
    expect(log.some((t) => t.includes('Woensdag 10 maart')), 'de waarnemer zag de kop van Vandaag komen').toBe(true);
    expect(log.some((t) => /^wo 10/.test(t)), 'en de weekstrook').toBe(true);
    expect(log.filter((t) => /dinsdag 9 maart|^di 9(?!\d)/i.test(t)), 'nooit de dag van gisteren, ook niet één hertekening lang').toEqual([]);
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });
});
