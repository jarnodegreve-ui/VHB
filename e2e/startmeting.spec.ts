import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { ADMIN, CHAUFFEUR, SESSION_KEY, apiFixtures, sessieInitScript } from '../scripts/audit-fixtures.mjs';

/**
 * Startmeting (ronde 6, punt 21a): elke gewone warme start meet zijn fasen
 * (js, sessie, profiel, gegevens, beeld) en bewaart ze in één sleutel; de
 * meting reist mee met de aanwezigheidsping van de vólgende start. Wat iemand
 * ziet, verandert niet. Bewezen wordt: geen extra verzoek en de nieuwe meting
 * blijft staan (1), de fasen zeggen wat er gebeurde (2), `beeld` is de inhoud
 * en niet het skelet (3), niets bij een onderbroken start (4), geen
 * persoonsgegevens (5) en de meting breekt nooit een start (6).
 *
 * Projecten: iPhone 13 (chromium) alles, met tik; iPhone 13 (webkit) 1, 2 en
 * 6 (localStorage, performance en animatieframes in de engine van de iPhone);
 * Desktop (chromium) 1 en 2 voor een admin op de cockpit.
 */

const SLEUTEL = 'vhb-startmeting';
const FASEN = ['js', 'sessie', 'profiel', 'gegevens', 'beeld'] as const;
type Meting = Partial<Record<(typeof FASEN)[number], number>> & Record<string, unknown>;
type Bewaard = { t: number; m: Meting };
type Wie = { user: typeof CHAUFFEUR | typeof ADMIN; view: string; pad: string; kop: RegExp };

const DAGKOP = /^(Maandag|Dinsdag|Woensdag|Donderdag|Vrijdag|Zaterdag|Zondag) \d/;
const CHAUFFEUR_MIJN_DAG: Wie = { user: CHAUFFEUR, view: 'mijn-dag', pad: '/mijn-dag', kop: DAGKOP };
const ADMIN_COCKPIT: Wie = { user: ADMIN, view: 'dashboard', pad: '/', kop: /, Jarno$/ };

const desktop = (info: TestInfo) => info.project.name === 'Desktop (chromium)';
const iphoneChromium = (info: TestInfo) => info.project.name === 'iPhone 13 (chromium)';
/** De warme start van dit project: admin op de cockpit op desktop, anders de chauffeur op Mijn dag. */
const wieVoor = (info: TestInfo): Wie => (desktop(info) ? ADMIN_COCKPIT : CHAUFFEUR_MIJN_DAG);

const wacht = (ms: number) => new Promise((klaar) => setTimeout(klaar, ms));

type Verzoek = { start: number; tijd: number; methode: string; pad: string; body: string | null };

/**
 * Sessie, fixtures en een logboek van elk verzoek per start (start = de hoeveelste
 * laadbeurt van het tabblad, geteld bij elke navigatie van het hoofdframe, dus
 * nooit een laat verzoek van de vorige pagina bij de volgende). Het init-script
 * houdt ook de bodies van `navigator.sendBeacon` bij en noteert met een
 * MutationObserver wanneer de kop van de inhoud in de DOM komt.
 */
async function opzet(page: Page, wie: Wie, extra?: (pad: string) => unknown) {
  await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user: wie.user, view: wie.view, thema: '' });
  await page.addInitScript((kopBron: string) => {
    const kop = new RegExp(kopBron);
    const w = window as unknown as { __bakens: Promise<string>[]; __kopTijd?: number };
    w.__bakens = [];
    const origineel = navigator.sendBeacon?.bind(navigator);
    if (origineel) {
      navigator.sendBeacon = (url, data) => {
        w.__bakens.push(data instanceof Blob ? data.text() : Promise.resolve(String(data ?? '')));
        return origineel(url, data);
      };
    }
    new MutationObserver(() => {
      if (w.__kopTijd !== undefined) return;
      for (const h of Array.from(document.querySelectorAll('h1'))) {
        if (kop.test((h.textContent ?? '').trim())) { w.__kopTijd = performance.now(); return; }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, wie.kop.source);
  await page.route('**/api/**', apiFixtures(wie.user, extra));
  const log = { verzoeken: [] as Verzoek[], start: 0 };
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) log.start += 1; });
  page.on('request', (r) => {
    log.verzoeken.push({ start: log.start, tijd: Date.now(), methode: r.method(), pad: new URL(r.url()).pathname, body: r.postData() });
  });
  return log;
}

const leesMeting = (page: Page): Promise<Bewaard | null> => page.evaluate((k) => {
  const ruw = window.localStorage.getItem(k);
  return ruw ? JSON.parse(ruw) : null;
}, SLEUTEL);

/** Wacht tot er een nieuwe meting staat (een andere dan `vorige`), met beeld. */
async function nieuweMeting(page: Page, vorige: Bewaard | null, metBeeld = true): Promise<Bewaard> {
  let gevonden: Bewaard | null = null;
  await expect.poll(async () => {
    gevonden = await leesMeting(page);
    return !!gevonden && gevonden.t !== vorige?.t && (!metBeeld || typeof gevonden.m.beeld === 'number');
  }, { timeout: 15_000, message: 'een nieuwe startmeting staat op het toestel' }).toBe(true);
  return gevonden!;
}

/** js ≤ sessie ≤ profiel ≤ gegevens ≤ beeld, allemaal gehele getallen. */
function inVolgorde(m: Meting) {
  const waarden = FASEN.map((f) => m[f]);
  for (const w of waarden) expect(Number.isInteger(w), `fase ${JSON.stringify(m)}`).toBe(true);
  for (let i = 1; i < waarden.length; i++) expect(waarden[i]!, `${FASEN[i - 1]} ≤ ${FASEN[i]}`).toBeGreaterThanOrEqual(waarden[i - 1]!);
}

const bakens = (page: Page): Promise<string[]> =>
  page.evaluate(() => Promise.all((window as unknown as { __bakens: Promise<string>[] }).__bakens));

/** Precies dit pad, met of zonder querystring (de planning van een chauffeur draagt `?driverId=`). */
const opPad = (pad: string) => (url: URL) => url.pathname === pad;

/** Houd elk GET-verzoek naar `pad` minstens `ms` tegen. */
const vertraag = (page: Page, pad: string, ms: number) =>
  page.route(opPad(pad), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await wacht(ms);
    return route.fallback().catch(() => undefined);
  });

const isResumePing = (v: Verzoek) => v.methode === 'POST' && v.pad === '/api/auth/session';

/** Ruis van de e2e-omgeving die ook op main in de console staat: de previewserver
 *  heeft geen Vercel-script en geen realtime-server. Al de rest telt als fout. */
const OMGEVINGSRUIS = [
  /^Failed to load resource: .* @ \S*\/_vercel\/speed-insights\/script\.js$/,
  /^WebSocket connection to '\S*\/realtime\/v1\/websocket\?/,
];

/** Paginafouten en console-fouten van deze pagina, voor "een gewone start zonder fout". */
function vangFouten(page: Page): string[] {
  const fouten: string[] = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  page.on('console', (m) => {
    const regel = `${m.text()} @ ${m.location().url}`;
    if (m.type() === 'error' && !OMGEVINGSRUIS.some((ruis) => ruis.test(regel))) fouten.push(regel);
  });
  return fouten;
}

test.describe('startmeting', () => {
  test('toetssteen 1: twee warme starten vragen dezelfde verzoeken, alleen de resume-ping draagt de meting, en de nieuwe meting blijft staan', async ({ page }, info) => {
    const wie = wieVoor(info);
    const log = await opzet(page, wie);

    // Start 1 zet wat een toestel na zijn eerste start onthoudt (de rolhint,
    // het auth-id): daarna wissen we zijn meting, zodat start 2 een warme
    // start zonder bewaarde meting is en start 3 er een mét.
    await page.goto(wie.pad);
    const m1 = await nieuweMeting(page, null);
    await page.evaluate((k) => window.localStorage.removeItem(k), SLEUTEL);

    const vastOp: Record<number, number> = {};
    const baken: Record<number, string[]> = {};
    await page.reload();
    const m2 = await nieuweMeting(page, m1);
    // Wat bij de start hoort, vertrekt vóór het beeld of meteen erna; de
    // warmup (LCP + 2 s) valt buiten dit venster.
    await page.waitForTimeout(600);
    vastOp[2] = Date.now();
    baken[2] = await bakens(page);

    await page.reload();
    const m3 = await nieuweMeting(page, m2);
    await page.waitForTimeout(600);
    vastOp[3] = Date.now();
    baken[3] = await bakens(page);

    const vanStart = (n: number) => log.verzoeken.filter((v) => v.start === n && v.tijd <= vastOp[n]);
    // Methode en pad van alles wat naar de API of de aanmelddienst gaat,
    // gesorteerd. Een foutrapport (`prestatie` bij een trage LCP) hangt van de
    // timing af en telt hier niet; zijn body wordt hieronder wel doorzocht.
    const serververzoeken = (n: number) => vanStart(n)
      .filter((v) => /^\/(api|auth\/v1)\//.test(v.pad) && v.pad !== '/api/client-errors')
      .map((v) => `${v.methode} ${v.pad}`)
      .sort();
    expect(serververzoeken(2).length).toBeGreaterThan(5);
    expect(serververzoeken(3)).toEqual(serververzoeken(2));

    // De resume-ping: één per start; de eerste zonder meting, de tweede met
    // precies de meting van de start ervoor.
    const ping2 = vanStart(2).filter(isResumePing);
    const ping3 = vanStart(3).filter(isResumePing);
    expect(ping2).toHaveLength(1);
    expect(ping3).toHaveLength(1);
    expect(JSON.parse(ping2[0].body!)).toEqual({ action: 'resume' });
    expect(JSON.parse(ping3[0].body!)).toEqual({ action: 'resume', start: m2.m });

    // Alle andere bodies zijn bij beide starten dezelfde, en geen enkel ander
    // verzoek (ook geen baken) draagt een meting.
    const bodies = (n: number) => vanStart(n)
      .filter((v) => v.body !== null && !isResumePing(v) && v.pad !== '/api/client-errors')
      .map((v) => `${v.methode} ${v.pad} ${v.body}`)
      .sort();
    expect(bodies(3)).toEqual(bodies(2));
    for (const v of log.verzoeken.filter((x) => !isResumePing(x))) {
      expect(v.body ?? '', `${v.methode} ${v.pad}`).not.toMatch(/"gegevens":|"beeld":/);
    }
    for (const b of [...baken[2], ...baken[3]]) expect(b).not.toMatch(/"gegevens":|"beeld":/);
    inVolgorde(m3.m);

    // De resume-ping 2 s trager, de poort niet: als het 2xx vertrekt, staat
    // de meting van díe start al op het toestel (bewaard bij het beeld), en
    // na het antwoord blijft ze staan; alleen de verstuurde zou weg mogen.
    let opMomentVanAntwoord: Bewaard | null = null;
    await page.route(opPad('/api/auth/session'), async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await wacht(2000);
      await expect.poll(async () => (await leesMeting(page))?.t !== m3.t, { timeout: 10_000 }).toBe(true);
      opMomentVanAntwoord = await leesMeting(page);
      return route.fallback();
    });
    const antwoord = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/session', { timeout: 20_000 });
    await page.reload();
    const res = await antwoord;
    expect(res.ok()).toBe(true);
    expect(JSON.parse(res.request().postData()!)).toEqual({ action: 'resume', start: m3.m });
    // De pagina verwerkt het antwoord in haar eigen `.then`: een tik later lezen.
    await page.evaluate(() => new Promise((klaar) => setTimeout(klaar, 100)));
    const na = await leesMeting(page);
    expect(opMomentVanAntwoord, 'de nieuwe meting stond er al toen het antwoord kwam').not.toBeNull();
    expect(na).toEqual(opMomentVanAntwoord);
    expect(na!.t).not.toBe(m3.t);
    expect(typeof na!.m.beeld).toBe('number');
    inVolgorde(na!.m);
  });

  test('toetssteen 2: /api/me 800 ms trager geeft profiel − sessie ≥ 800', async ({ page }, info) => {
    const wie = wieVoor(info);
    await opzet(page, wie);
    await vertraag(page, '/api/me', 820);
    await page.goto(wie.pad);
    const { m } = await nieuweMeting(page, null);
    inVolgorde(m);
    expect(m.profiel! - m.sessie!).toBeGreaterThanOrEqual(800);
    expect(m).toMatchObject({ rol: wie.user.role, scherm: wie.view, bron: 'vers', weergave: 'browser', toestel: desktop(info) ? 'desktop' : 'ios' });
    expect(m.release, 'lokaal en in e2e geen release').toBeUndefined();
  });

  test('toetssteen 2: /api/planning 1500 ms trager geeft gegevens − profiel ≥ 1500 en beeld ≥ gegevens', async ({ page }, info) => {
    const wie = wieVoor(info);
    await opzet(page, wie);
    await vertraag(page, '/api/planning', 1520);
    await page.goto(wie.pad);
    const { m } = await nieuweMeting(page, null);
    inVolgorde(m);
    expect(m.gegevens! - m.profiel!).toBeGreaterThanOrEqual(1500);
    expect(m.beeld!).toBeGreaterThanOrEqual(m.gegevens!);
  });

  test('toetssteen 3: beeld is de inhoud, niet het skelet', async ({ page }, info) => {
    test.skip(!iphoneChromium(info), 'alle toetsstenen in iPhone 13 (chromium)');
    await opzet(page, CHAUFFEUR_MIJN_DAG);
    let gevraagd = false;
    await page.route(opPad('/api/planning'), async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      gevraagd = true;
      await wacht(1520);
      return route.fallback();
    });
    await page.goto('/mijn-dag');
    await expect.poll(() => gevraagd).toBe(true);
    // Zolang alleen het skelet staat: geen kop van de inhoud en geen meting.
    await expect(page.getByRole('status', { name: 'Mijn dag wordt geladen' })).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.getByRole('status', { name: 'Mijn dag wordt geladen' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __kopTijd?: number }).__kopTijd)).toBeUndefined();
    expect(await leesMeting(page)).toBeNull();

    const { m } = await nieuweMeting(page, null);
    const kopTijd = await page.evaluate(() => (window as unknown as { __kopTijd?: number }).__kopTijd);
    expect(kopTijd, 'de kop van de inhoud kwam in de DOM').toBeDefined();
    expect(m.beeld!).toBeGreaterThanOrEqual(Math.floor(kopTijd!));
    expect(m.beeld!).toBeGreaterThanOrEqual(m.gegevens!);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAGKOP);
  });

  test.describe('toetssteen 4: een onderbroken start bewaart niets', () => {
    test.beforeEach(({}, info) => { test.skip(!iphoneChromium(info), 'alle toetsstenen in iPhone 13 (chromium)'); });

    /** De kop staat, en ook een seconde later is er geen meting. */
    const geenMeting = async (page: Page, kop: RegExp) => {
      await expect(page.getByRole('heading', { level: 1, name: kop })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      expect(await leesMeting(page)).toBeNull();
    };

    test('/api/planning geeft een 500: de poort ging niet dicht', async ({ page }) => {
      await opzet(page, CHAUFFEUR_MIJN_DAG);
      await page.route(opPad('/api/planning'), (route) => (route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'storing' }) })
        : route.fallback()));
      await page.goto('/mijn-dag');
      await geenMeting(page, DAGKOP);
    });

    test('toestel-wachtscherm: ook na "Opnieuw controleren" geen meting', async ({ page }) => {
      let goedgekeurd = false;
      const wacht403 = { status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Dit toestel wacht op goedkeuring door de planning.', code: 'device_pending' }) };
      // Op het rooster: daar wordt een meting meteen bij `gegevens` bewaard, dus
      // zonder de onderbreking stond er hier binnen de seconde een (op Mijn dag
      // staat de kop na het wachtscherm al vóór `gegevens` en kwam ze pas na 10 s).
      await opzet(page, { ...CHAUFFEUR_MIJN_DAG, view: 'rooster' }, (p) => (p.endsWith('/api/devices/register') && !goedgekeurd ? { status: 'pending' } : undefined));
      await page.route(opPad('/api/me'), (route) => (goedgekeurd ? route.fallback() : route.fulfill(wacht403)));
      await page.goto('/rooster');
      await expect(page.getByRole('heading', { name: 'Toestel wacht op goedkeuring' })).toBeVisible();
      goedgekeurd = true;
      await page.getByRole('button', { name: 'Opnieuw controleren' }).tap();
      await geenMeting(page, /^Rooster$/);
    });

    test('codescherm (tweede stap): ook na de code geen meting', async ({ page }) => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const token = (aal: 'aal1' | 'aal2') => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'auth-e2e', aud: 'authenticated', role: 'authenticated', aal, amr: [{ method: 'password', timestamp: 1 }], exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;
      const factor = { id: 'f1', factor_type: 'totp', friendly_name: 'Telefoon', status: 'verified', created_at: '2026-09-07T10:00:00Z', updated_at: '2026-09-07T10:00:00Z' };
      const gebruiker = { id: 'auth-e2e', email: ADMIN.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, factors: [factor] };
      const sessie = (aal: 'aal1' | 'aal2') => ({ access_token: token(aal), refresh_token: `ververs-${aal}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: gebruiker });
      const staat = { niveau: 'aal1' as 'aal1' | 'aal2' };
      // Warme start: de aal1-sessie staat al op het toestel.
      await page.addInitScript(({ key, waarde }) => { window.localStorage.setItem(key, waarde); }, { key: SESSION_KEY, waarde: JSON.stringify(sessie('aal1')) });
      await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
      await page.route('**/auth/v1/user**', (route) => route.fulfill({ json: gebruiker }));
      await page.route('**/auth/v1/factors/f1/challenge**', (route) => route.fulfill({ json: { id: 'c1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 } }));
      await page.route('**/auth/v1/factors/f1/verify**', (route) => { staat.niveau = 'aal2'; return route.fulfill({ json: sessie('aal2') }); });
      const beveiliging = () => ({ mfaVerplicht: true, aal: staat.niveau });
      await page.route('**/api/**', apiFixtures(ADMIN, (p: string) => (
        p.endsWith('/api/auth/session') ? { ...ADMIN, beveiliging: beveiliging() }
          : p.endsWith('/api/me') ? { ...ADMIN, toestel: { status: 'approved', gateActief: false }, beveiliging: beveiliging() }
            : undefined)));
      await page.goto('/');
      const code = page.getByLabel('Code uit je authenticator-app');
      await expect(code).toBeVisible({ timeout: 15_000 });
      await code.fill('123456');
      await page.getByRole('button', { name: 'Bevestigen' }).tap();
      await geenMeting(page, /, Jarno$/);
    });

    test('inlogformulier: een bewaarde sessie die niet meer geldt, dan aanmelden', async ({ page }) => {
      let aangemeld = false;
      const sessie = () => ({ access_token: 'e2e-vers', refresh_token: 'e2e-vers', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'auth-e2e', email: CHAUFFEUR.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } });
      await opzet(page, CHAUFFEUR_MIJN_DAG, (p) => (p.endsWith('/api/auth/session') ? CHAUFFEUR : undefined));
      // Tot de aanmelding: het profiel weigert de bewaarde sessie en verversen lukt niet.
      await page.route(opPad('/api/me'), (route) => (aangemeld ? route.fallback() : route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sessie verlopen' }) })));
      await page.route('**/auth/v1/**', (route) => {
        const url = route.request().url();
        if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' });
        if (url.includes('grant_type=password')) { aangemeld = true; return route.fulfill({ json: sessie() }); }
        if (url.includes('/user')) return route.fulfill({ json: sessie().user });
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant' }) });
      });
      await page.goto('/mijn-dag');
      await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible({ timeout: 15_000 });
      await page.getByPlaceholder('naam@bedrijf.be').fill(CHAUFFEUR.email);
      await page.getByLabel(/wachtwoord/i).first().fill('geheim-geheim');
      await page.getByRole('button', { name: 'Inloggen' }).tap();
      await geenMeting(page, /, Test$/);
    });
  });

  test('toetssteen 5: geen naam, id, e-mail, adres of user agent in de meting', async ({ page }, info) => {
    test.skip(!iphoneChromium(info), 'alle toetsstenen in iPhone 13 (chromium)');
    const opvallend = { ...CHAUFFEUR, id: '7771234', name: 'Zebulon Opvallendnaam', email: 'zebulon@opvallend.be', employeeId: 'VHB-7771234', phone: '0499 77 12 34' };
    const log = await opzet(page, { ...CHAUFFEUR_MIJN_DAG, user: opvallend });
    await page.goto('/mijn-dag?zoek=geheim');
    const eerste = await nieuweMeting(page, null);
    await page.reload();
    await nieuweMeting(page, eerste);
    const tekst = await page.evaluate((k) => window.localStorage.getItem(k), SLEUTEL);
    const ping = log.verzoeken.filter(isResumePing).map((v) => v.body ?? '').join('\n');
    expect(ping).toContain('"start"');
    for (const bron of [tekst!, ping]) {
      expect(bron).not.toMatch(/Zebulon|Opvallendnaam|7771234|opvallend|0499|auth-e2e|localhost|http|geheim|Mozilla|iPhone|AppleWebKit/i);
    }
  });

  test('toetssteen 6: localStorage die gooit breekt de start niet', async ({ page }, info) => {
    test.skip(desktop(info), 'mobiel: iPhone 13 (chromium) en (webkit)');
    await opzet(page, CHAUFFEUR_MIJN_DAG);
    await page.addInitScript((k) => {
      const zet = Storage.prototype.setItem;
      const lees = Storage.prototype.getItem;
      Storage.prototype.setItem = function (sleutel: string, waarde: string) {
        if (sleutel === k) throw new DOMException('vol', 'QuotaExceededError');
        return zet.call(this, sleutel, waarde);
      };
      Storage.prototype.getItem = function (sleutel: string) {
        if (sleutel === k) throw new DOMException('geweigerd', 'SecurityError');
        return lees.call(this, sleutel);
      };
    }, SLEUTEL);
    const fouten = vangFouten(page);
    await page.goto('/mijn-dag');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAGKOP, { timeout: 15_000 });
    await page.waitForTimeout(800);
    await expect(page.getByText(/niet laden|Er ging iets mis/)).toHaveCount(0);
    expect(fouten).toEqual([]);
  });

  test('toetssteen 6: een geknoeide sleutel (diep genest, tijd in de toekomst) breekt de start niet en herstelt zich', async ({ page }, info) => {
    test.skip(desktop(info), 'mobiel: iPhone 13 (chromium) en (webkit)');
    const log = await opzet(page, CHAUFFEUR_MIJN_DAG);
    // Met de hand of door vreemde code gezet: geen pad van de app schrijft dit.
    // Alleen bij de eerste laadbeurt, zodat de test ook het herstel ziet.
    await page.addInitScript((k) => {
      if (sessionStorage.getItem('__gezaaid')) return;
      sessionStorage.setItem('__gezaaid', '1');
      const diep = 200_000;
      localStorage.setItem(k, `{"t":${Date.now() + 365 * 864e5},"m":${'['.repeat(diep)}${']'.repeat(diep)}}`);
    }, SLEUTEL);
    const fouten = vangFouten(page);
    await page.goto('/mijn-dag');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAGKOP, { timeout: 15_000 });
    await expect(page.getByText(/niet laden|Er ging iets mis/)).toHaveCount(0);
    // De ping vertrok, zonder de geknoeide waarde.
    await expect.poll(() => log.verzoeken.filter(isResumePing).length, { timeout: 10_000 }).toBe(1);
    expect(JSON.parse(log.verzoeken.find(isResumePing)!.body!)).toEqual({ action: 'resume' });
    // De eigen meting van deze start overschrijft de sleutel (alleen de lengte
    // lezen: de geknoeide waarde is 400 kB).
    await expect.poll(() => page.evaluate((k) => {
      const n = localStorage.getItem(k)?.length ?? 0;
      return n > 0 && n < 2000;
    }, SLEUTEL), { timeout: 15_000, message: 'een gewone meting staat in de plaats van de geknoeide' }).toBe(true);
    const herstel = await leesMeting(page);
    expect(typeof herstel?.m.beeld).toBe('number');
    inVolgorde(herstel!.m);
    expect(fouten).toEqual([]);
  });
});
