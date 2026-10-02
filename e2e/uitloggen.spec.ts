import { test, expect, type Page, type Route } from '@playwright/test';
import { apiFixtures, CHAUFFEUR, SESSION_KEY, USERS, dayOffset, sessieInitScript } from '../scripts/audit-fixtures.mjs';
import { logIn } from './deeplinkHulp';

/**
 * Afmelden op een gedeeld toestel (beveiligingsscan 01-10): wie zich na een
 * ander aanmeldt, ziet niets van de vorige. Eén afronding voor de knop, de
 * gedwongen uitlog en de sessie die Supabase zelf beëindigt (App.tsx,
 * `rondAfmeldingAf`): state en toasts weg, de privé-caches weg, en de pagina
 * herladen zodra er een profiel geladen was.
 *
 * Twee gebruikers, elk met een eigen auth-id en token; de API-mock kiest de
 * gegevens op het token in de Authorization-kop, zoals de server. Aanmelden
 * gaat via het echte formulier (geen sessie vooraf in localStorage): een
 * init-script zou de sessie na de herlaad opnieuw zetten.
 *
 * Zonder service worker (die is hier geblokkeerd); de cache van de service
 * worker zelf, het profiel uit die cache en afmelden zonder bereik staan in
 * e2e/pwa.spec.ts.
 */

type Wie = 'a' | 'b';
const A = CHAUFFEUR;
const B = USERS[2] as typeof CHAUFFEUR;
const GEBRUIKER = { a: A, b: B };
const NOTITIE_A = 'Notitie alleen voor de eerste chauffeur';
const MELDINGEN_A = {
  ongelezen: 2,
  meldingen: [
    { id: 'a1', titel: 'Verlof goedgekeurd', tekst: 'Betaald verlof, beslist door Planning.', soort: 'verlof', doel: 'verlof', createdAt: new Date().toISOString() },
    { id: 'a2', titel: 'Rooster bijgewerkt', tekst: 'Je rooster is gewijzigd.', soort: 'planning', doel: 'rooster', createdAt: new Date().toISOString() },
  ],
};

const sessie = (wie: Wie) => ({
  access_token: `tok-${wie}`,
  refresh_token: `ververs-${wie}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: `auth-${wie}`, email: GEBRUIKER[wie].email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
});

type Staat = {
  /** Wie de volgende aanmelding oplevert. */
  volgende: Wie;
  /** Houd de meldingen en de notities van A vast tot `laatLos`. */
  houdVast: boolean;
  wachtend: Array<() => void>;
  /** Aantal keren dat het document geladen is (1 = nooit herladen). */
  geladen: number;
};

const wieVan = (route: Route): Wie => (route.request().headers().authorization === 'Bearer tok-b' ? 'b' : 'a');

async function zetOp(page: Page, begin: Partial<Staat> = {}): Promise<Staat> {
  const staat: Staat = { volgende: 'a', houdVast: false, wachtend: [], geladen: 0, ...begin };
  page.on('load', () => { staat.geladen += 1; });

  await page.route('**/auth/v1/token**', (route) => route.fulfill({ json: sessie(staat.volgende) }));
  await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/auth/v1/user**', (route) => route.fulfill({ json: sessie(wieVan(route)).user }));

  const eigen = (wie: Wie) => (pad: string) => {
    if (pad.endsWith('/api/auth/session')) return GEBRUIKER[wie];
    if (pad.endsWith('/api/meldingen')) return wie === 'a' ? MELDINGEN_A : { meldingen: [], ongelezen: 0 };
    if (pad.endsWith('/api/planning-notes')) return wie === 'a' ? [{ date: dayOffset(0), note: NOTITIE_A }] : [];
    return undefined;
  };
  const fixtures = { a: apiFixtures(A, eigen('a')), b: apiFixtures(B, eigen('b')) };
  await page.route('**/api/**', async (route) => {
    const wie = wieVan(route);
    const pad = new URL(route.request().url()).pathname;
    if (wie === 'a' && staat.houdVast && route.request().method() === 'GET' && (pad === '/api/meldingen' || pad === '/api/planning-notes')) {
      await new Promise<void>((los) => staat.wachtend.push(los));
    }
    // Na een herlaad bestaat het verzoek niet meer: het antwoord kan dan nergens heen.
    await fixtures[wie](route).catch(() => undefined);
  });
  return staat;
}

const laatLos = (staat: Staat) => {
  staat.houdVast = false;
  for (const los of staat.wachtend.splice(0)) los();
};

const meldAf = async (page: Page) => {
  await page.getByRole('button', { name: 'Accountmenu' }).click();
  await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
};

const loginKnop = (page: Page) => page.getByRole('button', { name: 'Inloggen' });
/** De bel in de topbar (het menu-item "Meldingen" in de zijbalk heet net zo). */
const bel = (page: Page, naam: string | RegExp) => page.locator('button[aria-haspopup="menu"]').and(page.getByRole('button', { name: naam, exact: true }));

/** De kop van het dashboard: "Goedemorgen, <voornaam>". */
const begroeting = (page: Page, wie: { name: string }) => page.getByRole('heading', { level: 1, name: new RegExp(`, ${wie.name.split(' ')[0]}$`) });

/** Een merkteken op het document: weg = de pagina is herladen. */
const merk = (page: Page) => page.evaluate(() => { (window as unknown as { __zelfdePagina?: boolean }).__zelfdePagina = true; });
const gemerkt = (page: Page) => page.evaluate(() => (window as unknown as { __zelfdePagina?: boolean }).__zelfdePagina === true);

test.describe('afmelden op een gedeeld toestel', () => {
  test('afmelden herlaadt de pagina; een laat antwoord van de eerste gebruiker komt niet bij de tweede', async ({ page }) => {
    // A meldt aan; zijn meldingen en notities zijn nog onderweg als hij afmeldt.
    const staat = await zetOp(page, { houdVast: true });
    await page.goto('/');
    await logIn(page);
    await expect(page.getByRole('button', { name: 'Accountmenu' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => staat.wachtend.length, { message: 'meldingen en notities van A zijn onderweg' }).toBeGreaterThanOrEqual(2);
    await merk(page);

    staat.volgende = 'b';
    await meldAf(page);
    await expect(loginKnop(page)).toBeVisible({ timeout: 15_000 });
    expect(await gemerkt(page), 'de pagina is herladen').toBe(false);

    // B meldt aan in de herladen pagina en ziet zijn eigen, lege stand.
    await logIn(page);
    await expect(bel(page, 'Meldingen')).toBeVisible({ timeout: 15_000 });
    await expect(begroeting(page, B)).toBeVisible();

    // Nu pas komen de antwoorden voor A binnen.
    laatLos(staat);
    await page.waitForTimeout(1000);
    await expect(bel(page, /Meldingen \(\d+ ongelezen\)/)).toHaveCount(0);
    await expect(bel(page, 'Meldingen')).toBeVisible();
    await expect(page.getByText(NOTITIE_A)).toHaveCount(0);
    await expect(begroeting(page, B)).toBeVisible();
    await expect(begroeting(page, A)).toHaveCount(0);
    // Eén herlaad, geen tweede: aanmelden als B herlaadt niets.
    expect(staat.geladen).toBe(2);
  });

  test('A ziet zijn eigen meldingen en notitie, B na hem niets daarvan', async ({ page }) => {
    const staat = await zetOp(page);
    await page.goto('/');
    await logIn(page);
    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(NOTITIE_A).first()).toBeVisible();

    staat.volgende = 'b';
    await meldAf(page);
    await expect(loginKnop(page)).toBeVisible({ timeout: 15_000 });
    await logIn(page);
    await expect(bel(page, 'Meldingen')).toBeVisible({ timeout: 15_000 });
    await expect(bel(page, /ongelezen/)).toHaveCount(0);
    await expect(page.getByText(NOTITIE_A)).toHaveCount(0);
  });

  test('de sessie eindigt elders: privé-caches weg, de schil blijft, en de pagina herlaadt naar het inlogscherm', async ({ page }) => {
    const staat = await zetOp(page);
    await page.goto('/');
    await logIn(page);
    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
    await merk(page);
    await page.evaluate(async () => {
      const zet = async (naam: string, sleutel: string) => (await caches.open(naam)).put(sleutel, new Response('{}', { headers: { 'content-type': 'application/json' } }));
      await zet('vhb-ritbladen', '/api/me');
      await zet('vhb-bijlagen-v1', 'https://opslag.test/plan.pdf');
      await zet('vhb-portaal-e2e', '/');
    });

    // Een ander tabblad meldde af: de sessie is uit de opslag en Supabase
    // kondigt SIGNED_OUT af op zijn kanaal. Geen 401, geen klik op de knop.
    await page.evaluate((sleutel) => {
      window.localStorage.removeItem(sleutel);
      new BroadcastChannel(sleutel).postMessage({ event: 'SIGNED_OUT', session: null });
    }, SESSION_KEY);

    await expect(loginKnop(page)).toBeVisible({ timeout: 15_000 });
    expect(await gemerkt(page), 'de pagina is herladen').toBe(false);
    expect(await page.evaluate(() => caches.keys())).toEqual(['vhb-portaal-e2e']);
    // Niet zelf afgemeld: het inlogscherm zegt waarom je hier staat.
    await expect(page.getByText(/sessie is verlopen omdat je een tijdje weg was/i)).toBeVisible();
    expect(staat.geladen).toBe(2);
  });

  test('gedwongen uitlog midden in de app: de uitleg staat na de herlaad op het inlogscherm', async ({ page }) => {
    const staat = await zetOp(page);
    await page.goto('/');
    await logIn(page);
    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
    await merk(page);

    // De sessie is op: elke call geeft 401 en verversen lukt niet. Een tik
    // op een melding stuurt een POST, die loopt daar als eerste tegenaan.
    await page.route('**/api/**', (route) => route.fulfill({ status: 401, json: { error: 'Sessie verlopen' } }));
    await page.route('**/auth/v1/token**', (route) => route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid Refresh Token' } }));
    await bel(page, 'Meldingen (2 ongelezen)').click();
    // Het paneel haalt bij het openen zelf al op; staat het er nog, dan de tik.
    await page.getByRole('menu', { name: 'Meldingen' }).getByRole('menuitem', { name: /Verlof goedgekeurd/ }).click({ timeout: 3000 }).catch(() => undefined);

    await expect(page.getByText(/sessie is verlopen omdat je een tijdje weg was/i)).toBeVisible({ timeout: 15_000 });
    await expect(loginKnop(page)).toBeVisible();
    expect(await gemerkt(page), 'de pagina is herladen').toBe(false);
    expect(staat.geladen).toBe(2);
    // Geen stapel rode meldingen van de calls die mee strandden.
    await expect(page.getByText(/Kon .* niet laden/)).toHaveCount(0);
  });

  test('gedeeld toestel: na een half uur zonder activiteit staat de uitleg na de herlaad op het inlogscherm', async ({ page }) => {
    const staat = await zetOp(page);
    await page.addInitScript(() => window.localStorage.setItem('vhb-gedeeld-toestel', '1'));
    await page.clock.install();
    await page.goto('/');
    await logIn(page);
    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
    await merk(page);

    await page.clock.fastForward('31:00');
    await expect(page.getByText(/Automatisch afgemeld: dit is een gedeeld toestel/)).toBeVisible({ timeout: 15_000 });
    await expect(loginKnop(page)).toBeVisible();
    expect(await gemerkt(page), 'de pagina is herladen').toBe(false);
    expect(staat.geladen).toBe(2);
  });

  test('verlopen token en de aanmeldserver onbereikbaar: afmelden haalt de sessie toch uit de opslag', async ({ page }) => {
    const staat = await zetOp(page);
    await page.clock.install();
    await page.goto('/');
    await logIn(page);
    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
    await merk(page);

    // Het token is verlopen en verversen lukt niet (geen verbinding met de
    // aanmeldserver): signOut kan de sessie dan niet lezen en laat ze staan.
    await page.evaluate((key) => {
      const sessie = JSON.parse(window.localStorage.getItem(key)!);
      window.localStorage.setItem(key, JSON.stringify({ ...sessie, expires_at: Math.floor(Date.now() / 1000) - 60 }));
    }, SESSION_KEY);
    const geenAuth = (route: Route) => route.abort('connectionfailed');
    await page.route('**/auth/v1/**', geenAuth);

    await meldAf(page);
    // Supabase probeert het verversen een halve minuut opnieuw, met oplopende
    // pauzes: de klok vooruit tot het inlogscherm er staat.
    await expect(async () => {
      await page.clock.fastForward(35_000);
      await expect(loginKnop(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 40_000 });
    expect(await gemerkt(page), 'de pagina is herladen').toBe(false);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY), 'geen sessie meer in de opslag').toBeNull();

    // De aanmeldserver is terug: herladen brengt de vorige gebruiker niet terug.
    await page.unroute('**/auth/v1/**', geenAuth);
    await page.reload();
    await expect(loginKnop(page)).toBeVisible({ timeout: 15_000 });
    await page.clock.fastForward(5_000);
    await expect(loginKnop(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accountmenu' })).toHaveCount(0);
    void staat;
  });

  test('afmelden zonder bereik en zonder service worker: het inlogscherm komt op zijn plaats, geen foutpagina, en niets van A voor wie daarna aanmeldt', async ({ page, context }) => {
    const staat = await zetOp(page);
    await page.goto('/');
    await logIn(page);
    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
    await merk(page);
    // Een toast met een actie die een bestand van A vasthoudt (de terugval
    // van een download in de geïnstalleerde app blijft twintig seconden staan).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('vhb-toast', {
      detail: { message: '"back-up van A.json" is klaar.', tone: 'info', action: { label: 'Bewaren', run: () => {} }, opties: { duurMs: 20_000 } },
    })));
    await expect(page.getByText('"back-up van A.json" is klaar.')).toBeVisible();

    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page.waitForTimeout(300);
    staat.volgende = 'b';
    await meldAf(page);
    await expect(loginKnop(page)).toBeVisible({ timeout: 15_000 });
    // Herladen zou hier op de foutpagina van de browser eindigen.
    expect(await gemerkt(page), 'niet herladen').toBe(true);
    expect(staat.geladen).toBe(1);
    await expect(page.getByText(NOTITIE_A)).toHaveCount(0);

    // Het bereik is terug en B meldt aan, in dezelfde pagina: de toast van A
    // is weg, en B krijgt zijn eigen, lege stand.
    await context.setOffline(false);
    await logIn(page);
    await expect(begroeting(page, B)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('"back-up van A.json" is klaar.')).toHaveCount(0);
    await expect(page.getByText(NOTITIE_A)).toHaveCount(0);
    await expect(bel(page, /ongelezen/)).toHaveCount(0);
    expect(await gemerkt(page), 'niet herladen').toBe(true);
  });
});

test.describe('geen herlaad waar het niet hoort', () => {
  test('koude start zonder sessie: het inlogscherm, één keer geladen', async ({ page }) => {
    const staat = await zetOp(page);
    await page.goto('/');
    await expect(loginKnop(page)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    expect(staat.geladen).toBe(1);
    await expect(loginKnop(page)).toBeVisible();
  });

  test('start met een verlopen sessie: gedwongen uitlog zonder herlaad, ook als de sessie telkens terugkomt', async ({ page }) => {
    // Het init-script zet de sessie bij elke laadbeurt opnieuw: zou de
    // gedwongen uitlog hier herladen, dan liep dit eindeloos rond.
    let geladen = 0;
    page.on('load', () => { geladen += 1; });
    await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user: A, view: '', thema: '' });
    await page.route('**/api/**', (route) => route.fulfill({ status: 401, json: { error: 'Sessie verlopen' } }));
    await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 401, json: { error: 'invalid refresh token' } }));
    await page.goto('/');
    await expect(page.getByText(/sessie is verlopen omdat je een tijdje weg was/i)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    expect(geladen).toBe(1);
    await expect(loginKnop(page)).toBeVisible();
  });

  test('uitnodiging: afmelden en meteen aanmelden zonder herlaad ertussen', async ({ page }) => {
    const staat = await zetOp(page);
    await page.route('**/auth/v1/verify**', (route) => route.fulfill({ json: sessie('a') }));
    await page.route('**/api/uitnodiging/openen', (route) => route.fulfill({ json: { naam: A.name, email: A.email, tokenHash: 'hash-e2e' } }));
    await page.route('**/api/uitnodiging/afronden', (route) => route.fulfill({ json: { success: true } }));

    await page.goto('/#uitnodiging=42.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await expect(page.getByRole('heading', { name: `Welkom, ${A.name}` })).toBeVisible({ timeout: 15_000 });
    await merk(page);
    await page.getByLabel('Kies een wachtwoord').fill('een-goed-wachtwoord');
    await page.getByRole('button', { name: /Wachtwoord opslaan/ }).click();

    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
    expect(await gemerkt(page), 'niet herladen').toBe(true);
    expect(staat.geladen).toBe(1);
  });

  test('wachtwoordherstel: na het opslaan blijft de bevestiging staan en kan je meteen aanmelden', async ({ page }) => {
    const staat = await zetOp(page);
    // Supabase haalt bij een herstellink eerst de gebruiker op en kondigt
    // PASSWORD_RECOVERY daarna één keer af. Met een antwoord in nul
    // milliseconden (alleen in een mock) kan dat vóór de app luistert, en dan
    // opent de link de app in plaats van het herstelscherm; een echte
    // auth-server doet er altijd langer over.
    await page.route('**/auth/v1/user**', async (route) => {
      if (route.request().method() === 'GET') await new Promise((klaar) => setTimeout(klaar, 400));
      await route.fulfill({ json: sessie('a').user }).catch(() => undefined);
    });
    // De herstellink uit de mail: Supabase leest de sessie uit de hash.
    await page.goto('/#access_token=tok-a&refresh_token=ververs-a&expires_in=3600&token_type=bearer&type=recovery');
    await expect(page.getByRole('heading', { name: 'Nieuw wachtwoord' })).toBeVisible({ timeout: 15_000 });
    await merk(page);
    // Het profiel van deze sessie is intussen geladen: zonder de uitzondering
    // voor het herstelscherm zou de afmelding hieronder de pagina herladen.
    await page.waitForTimeout(1000);

    await page.getByLabel('Nieuw wachtwoord').fill('een-goed-wachtwoord');
    await page.getByRole('button', { name: 'Wachtwoord opslaan' }).click();
    await expect(page.getByText('Wachtwoord bijgewerkt. Log opnieuw in met je nieuwe wachtwoord.')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(await gemerkt(page), 'niet herladen').toBe(true);
    expect(staat.geladen).toBe(1);

    await logIn(page);
    await expect(bel(page, 'Meldingen (2 ongelezen)')).toBeVisible({ timeout: 15_000 });
  });
});
