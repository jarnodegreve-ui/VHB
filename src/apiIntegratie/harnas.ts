/**
 * Integratietests voor de Express-API — het vangnet voor precies de klasse
 * bugs die de reviews vonden (autorisatie-diffs, PII-scoping, bulk-wipes).
 * Supabase wordt gemockt op twee lagen:
 *  - db.js: auth.getUser → vaste token→gebruiker-mapping
 *  - storage.js: data-functies → in-memory store (mem); de pure diff/
 *    summarize-helpers blijven de échte implementatie.
 * De handlers zelf (api/index.ts en de domeinroutes in api/_lib) draaien dus integraal.
 */
import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';

// Dynamisch geladen ná de env-set hieronder (statische imports worden
// gehoist en zouden rateLimit.ts met de default-limiet laden vóór
// RATE_LIMIT_MAX gezet is — dezelfde reden waarom de app dynamisch importeert).
let resetAllRateLimiters: () => void;
export let invalidateUsersCache: () => void;
export let invalidateOnderhoudCache: () => void;

// Vóór de import van de app: voorkom dat index.ts zelf op poort 3000 gaat
// luisteren of Vite-middleware start.
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
process.env.CRON_SECRET = 'test-cron-secret';
// Lagere limiet zodat de 429-test snel triggert; per test resetten we de
// telstand in beforeEach, dus geen overloop tussen testen.
process.env.RATE_LIMIT_MAX = '50';
process.env.RATE_LIMIT_ANON_MAX = '50';
// OCPI: token + publieke basis zodat de gehoste endpoints testbaar zijn.
process.env.OCPI_TOKEN_A = 'test-token-a';
process.env.OCPI_PUBLIC_BASE_URL = 'https://test.example';

const mem = vi.hoisted(() => ({
  users: [] as any[],
  leave: [] as any[],
  swaps: [] as any[],
  services: [] as any[],
  // Dienstregelingversies (08-10): leeg = geen versies, dan is services de hele lijst.
  dienstregelingen: [] as any[],
  updates: [] as any[],
  diversions: [] as any[],
  planning: [] as any[],
  // Ruwe planning-matrix (chauffeur × datum met codes) — bron voor de
  // 'vrij/bv/tk/ta'-check bij een ruil zonder tegenprestatie.
  planningMatrix: [] as any[],
  // Sleutels in Supabase Storage ('<bucket>/<pad>'), voor de bijlage-routes.
  opslag: new Set<string>(),
  // Laatst gewijzigd per sleutel, voor de uitgestelde opruiming; zonder
  // ingang is een bestand oud (ruim voorbij de marge).
  opslagTijd: new Map<string, string>(),
  // true = de bestaanscontrole in Storage mislukt (storing).
  opslagFaalt: false,
  // true = het log van een omleiding of update is niet te lezen, resp. de
  // gerichte lezing "bestaat dit record?" mislukt.
  logLezingFaalt: false,
  recordLezingFaalt: false,
  // true = Storage antwoordt niet meer bij het oplijsten van een bucket.
  opslagHangt: false,
  // Wat de nachtcron in welke volgorde deed: heartbeats en de eerste
  // aanroep van de opruiming.
  cronVolgorde: [] as string[],
  // Verzendlog van de mails (mail_log), nieuwste eerst.
  mailLog: [] as any[],
  // Volgorde van schrijven naar het verzendlog en versturen (nr. 5).
  mailLogVerloop: [] as string[],
  mailLogStuk: false,
  // Hartslagen van de crons (logCronHeartbeat), in volgorde.
  hartslagen: [] as Array<{ naam: string; details: string }>,
  importHistory: [] as any[],
  snapshots: {} as Record<string, any>,
  historiekFaalt: false,
  planningCodes: [] as any[],
  coverageExpectations: {} as Record<string, unknown>,
  activity: [] as any[],
  // Retourwaarde van getLatestAuthEventAt — stuurt de per-dag-dedup van het
  // 'Actief'-event bij action:'resume'.
  lastAuthEventAt: null as string | null,
  // updateUserSessionMeta-schrijfacties (lastLogin/activeSessions).
  sessionMetaWrites: [] as any[],
  // Aanwezigheidssessies (public.user_presence, 2026-09-18).
  presence: [] as any[],
  // Elke aanroep van noteerAanwezigheid vanuit de auth-middleware.
  presenceSchrijf: [] as Array<{ userId: string; rol: string | null; locatie: unknown }>,
  // false = de migratie is nog niet gedraaid; getAanwezigheid gooit dan een
  // missing-table-fout, precies zoals PostgREST dat doet.
  presenceTabel: true,
  // De maand waarmee elke getPlanningMatrixRows-lezing begrensd werd
  // (null = volledige matrix). Bewijst dat maand-gebonden routes niet
  // stilletjes de hele historiek ophalen.
  matrixMaandFilters: [] as Array<string | null>,
  // De maand waarmee elke getPlanningData-lezing begrensd werd (null = geen
  // maandfilter). Bewijst dat het advies en de beschikbaarheid alleen de
  // maanden van hun venster ophalen, en bij een weigering niets.
  planningMaandFilters: [] as Array<string | null>,
  // Filters waarmee getLeaveData/getSwapsData aangeroepen werden: bewijst dat
  // niet-staf in de query filtert i.p.v. de hele tabel te lezen.
  leaveFilters: [] as any[],
  swapFilters: [] as any[],
  // Aantal lezingen van het dienstoverzicht en de planningscodes: bewijst dat
  // een route ze één keer leest, niet per ruil in een lus.
  servicesLezingen: 0,
  codesLezingen: 0,
  // true = de lezing faalt (databasefout), zoals de echte lezers dan gooien.
  servicesFaalt: false,
  codesFaalt: false,
  // Id-filters waarmee getSwapVerloopRegels aangeroepen werd (null = alles),
  // en een schakelaar om de logquery te laten mislukken.
  verloopFilters: [] as Array<string[] | null>,
  verloopFaalt: false,
  clientErrors: [] as any[],
  // app_settings (key → jsonb): toestel-gate en onderhoudsmodus.
  appSettings: {} as Record<string, unknown>,
  // Status per foutgroep (client_error_status); `clientErrorStatusTabel=false`
  // simuleert een niet-gedraaide migratie (probe → null / 42P01).
  clientErrorStatus: [] as any[],
  clientErrorStatusTabel: true,
  emailsSent: [] as Array<{ to: string[]; subject: string; context?: string; text?: string; attachments?: Array<{ filename: string; content: unknown; contentType?: string }> }>,
  storedBackups: [] as Array<{ filename: string; size: number }>,
  // De laatst opgeslagen back-up, zoals de restore-proef hem uit de bucket leest.
  laatsteBackup: null as { filename: string; body: string } | null,
  pushSubscriptions: [] as any[],
  pushesSent: [] as Array<{ userIds: string[]; payload: any }>,
  documents: [] as any[],
  ritblaadje: null as any,
  devices: [] as any[],
  planningNotes: [] as any[],
  userExpiries: [] as any[],
  // Meldingencentrum: wat sendPushToUsers per ontvanger bewaart.
  meldingen: [] as any[],
  // Adres dat in Supabase Auth al bij een ánder account hoort: de
  // saveUsersData-mock gooit dan dezelfde EmailInGebruikError als de echte
  // (de Auth-kant zelf zit in src/storageAuthSync.test.ts).
  authEmailBezet: null as string | null,
  // Loon-tabellen voor de mini-PostgREST in de db.js-mock: loonStorage draait
  // hier integraal (inclusief de paginering voorbij de 1000-rijen-cap).
  loonRijen: {
    loon_codes: [] as any[],
    loon_medewerkers: [] as any[],
    dag_afsluitingen: [] as any[],
    dag_prestaties: [] as any[],
  } as Record<string, any[]>,
  loonVolgnummer: 0,
  // planning_version-teller voor de heropbouw-vangrail: null = niet te lezen
  // (controle overgeslagen); een lijst = de opeenvolgende lezingen, de laatste
  // waarde blijft gelden. Zo simuleert een test een import of ruil-doorvoer
  // die tijdens het rekenen van de heropbouw schrijft. 'loopt' = elke lezing
  // een andere stand (er wordt onafgebroken geschreven).
  planningVersies: null as number[] | 'loopt' | null,
  planningVersieTeller: 0,
  // true = replace_planning faalt (databasefout midden in de heropbouw).
  planningVervangenFaalt: false,
  // Gelijktijdige beslissingen over een ruil (01-10). De haak loopt één keer,
  // vlak vóór de voorwaardelijke statuswissel van een ruil: het venster tussen
  // de lezing van de handler (en zijn planning-doorvoer) en zijn schrijfactie.
  // Een test laat daar een tweede, echt verzoek landen.
  voorSwapStatusWissel: null as null | ((swapId: string) => Promise<void> | void),
  // Hoeveel voorwaardelijke statuswissels er liepen, en met welke verwachte
  // status: bewijst dat een ongewijzigd record niet geschreven wordt.
  swapStatusWissels: [] as Array<{ id: string; verwacht: string; naar: string; geraakt: boolean }>,
  // 'terugdraaien' / 'doorvoeren' = die verplaatsing in de planning faalt
  // (databasefout), zoals de echte functies dan gooien.
  planningVerplaatsenFaalt: null as null | 'terugdraaien' | 'doorvoeren',
  // Zelfde haak vóór de insert van een nieuwe ruil, en het aantal keren dat
  // een ruilroute in de planning keek of een wissel er al staat
  // (swapToestandInPlanning): een chauffeur doet dat nooit.
  voorSwapToevoegen: null as null | (() => Promise<void> | void),
  planningToestandLezingen: 0,
  // true = de gerichte lezing van een ruil (getSwapsByIds) faalt.
  swapHerlezingFaalt: false,
  // Service-role-client voor de routes die Supabase Auth beheren; null =
  // niet geconfigureerd (standaard). Een test zet hier een attrap.
  supabaseAdmin: null as any,
  // true = saveUsersData kan een nieuw profiel niet aan zijn Auth-account
  // koppelen (koppelAuthIdStil mislukt): geen authId in createdAccounts.
  koppelMislukt: false,
}));

vi.mock('../../api/db.js', () => {
  const tokenToEmail: Record<string, string> = {
    'tok-admin': 'admin@vhb.be',
    'tok-planner': 'planner@vhb.be',
    'tok-a': 'a@vhb.be',
    'tok-b': 'b@vhb.be',
    'tok-tech': 'tech@vhb.be',
    // Zelfde accounts, maar met een aal2-claim (na twee-stapsverificatie).
    'tok-planner-2fa': 'planner@vhb.be',
    'tok-admin-2fa': 'admin@vhb.be',
  };
  return {
    supabase: {
      auth: {
        // Lokale JWT-verificatie (verifieerToken): bekende tokens → claims;
        // 'tok-storing'/'tok-auth-500' geven geen uitspraak (→ fallback
        // getUser, die de 503-scheiding simuleert); onbekend → 401 zonder
        // roundtrip; 'tok-verlopen' = AuthInvalidJwtError.
        getClaims: async (token: string) => {
          if (token === 'tok-storing' || token === 'tok-auth-500') return { data: null, error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } };
          if (token === 'tok-verlopen') return { data: null, error: { name: 'AuthInvalidJwtError', message: 'JWT has expired', status: 400 } };
          // JWT-vormig token (header.payload.sig): claims uit de payload zelf,
          // zodat tests met een echte session_id-claim kunnen werken.
          if (token.split('.').length === 3) {
            try {
              const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
              if (claims?.email) return { data: { claims: { aal: 'aal1', ...claims } }, error: null };
            } catch { /* val door naar de vaste mapping */ }
          }
          const email = tokenToEmail[token];
          const basis = token.replace(/-2fa$/, '');
          return email
            ? { data: { claims: { sub: `auth-${basis}`, email, aal: token.endsWith('-2fa') ? 'aal2' : 'aal1' } }, error: null }
            : { data: null, error: { name: 'AuthInvalidJwtError', message: 'invalid JWT', status: 401 } };
        },
        getUser: async (token: string) => {
          // Simulatie-tokens voor de 401-vs-503-scheiding in de middleware.
          if (token === 'tok-storing') return { data: { user: null }, error: { message: 'fetch failed', status: 0 } };
          if (token === 'tok-auth-500') return { data: { user: null }, error: { message: 'internal', status: 500 } };
          const email = tokenToEmail[token];
          return email
            ? { data: { user: { id: `auth-${token}`, email } }, error: null }
            : { data: { user: null }, error: { message: 'Ongeldige sessie', status: 401 } };
        },
      },
    },
    // Getter: een test kan mem.supabaseAdmin zetten (wachtwoord resetten).
    get supabaseAdmin() { return mem.supabaseAdmin; },
    db: { from: loonFrom },
  };
});

// Mini-PostgREST voor de vier loon-tabellen: genoeg querybuilder om
// api/_lib/loonStorage.ts integraal te laten draaien. Leesantwoorden zijn,
// net als bij echte PostgREST, gecapt op 1000 rijen per response; alleen
// wie met .range() pagineert krijgt dus alles terug.
const POSTGREST_CAP = 1000;
const LOON_UPSERT_SLEUTEL: Record<string, string> = { loon_codes: 'code', loon_medewerkers: 'user_id' };
function loonFrom(tabel: string) {
  if (!(tabel in mem.loonRijen)) throw new Error(`mock-db: onbekende tabel ${tabel}`);
  const vergelijk = (a: any, b: any) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : a < b ? -1 : 1);
  const q: any = {
    _op: 'select',
    _filters: [] as Array<(r: any) => boolean>,
    _orders: [] as Array<{ col: string; asc: boolean }>,
    _range: null as null | [number, number],
    _limit: null as null | number,
    _rows: null as any[] | null,
    _patch: null as any,
    _wilCount: false,
    _single: 0 as 0 | 1 | 2,
    select() { return q; },
    insert(rows: any) { q._op = 'insert'; q._rows = Array.isArray(rows) ? rows : [rows]; return q; },
    upsert(rows: any) { q._op = 'upsert'; q._rows = Array.isArray(rows) ? rows : [rows]; return q; },
    update(patch: any) { q._op = 'update'; q._patch = patch; return q; },
    delete(opts?: any) { q._op = 'delete'; q._wilCount = Boolean(opts?.count); return q; },
    eq(col: string, val: any) { q._filters.push((r: any) => String(r[col]) === String(val)); return q; },
    gte(col: string, val: any) { q._filters.push((r: any) => r[col] >= val); return q; },
    lte(col: string, val: any) { q._filters.push((r: any) => r[col] <= val); return q; },
    order(col: string, opts?: { ascending?: boolean }) { q._orders.push({ col, asc: opts?.ascending !== false }); return q; },
    range(van: number, tot: number) { q._range = [van, tot]; return q; },
    limit(n: number) { q._limit = n; return q; },
    maybeSingle() { q._single = 1; return q; },
    single() { q._single = 2; return q; },
    then(resolve: any, reject: any) { return q._run().then(resolve, reject); },
    async _run() {
      const alle = mem.loonRijen[tabel];
      const raak = (r: any) => q._filters.every((f: any) => f(r));
      const antwoord = (rijen: any[], extra: Record<string, unknown> = {}) => {
        if (q._single === 2) return rijen.length === 1 ? { data: rijen[0], error: null, ...extra } : { data: null, error: { code: 'PGRST116', message: `verwachtte 1 rij, kreeg ${rijen.length}` }, ...extra };
        if (q._single === 1) return { data: rijen[0] ?? null, error: null, ...extra };
        return { data: rijen, error: null, ...extra };
      };
      if (q._op === 'select') {
        let rijen = alle.filter(raak);
        if (q._orders.length) {
          rijen = [...rijen].sort((a, b) => {
            for (const o of q._orders) { const c = vergelijk(a[o.col], b[o.col]) * (o.asc ? 1 : -1); if (c !== 0) return c; }
            return 0;
          });
        }
        if (q._range) rijen = rijen.slice(q._range[0], q._range[1] + 1);
        if (q._limit !== null) rijen = rijen.slice(0, q._limit);
        return antwoord(rijen.slice(0, POSTGREST_CAP));
      }
      if (q._op === 'insert') {
        const nieuw = q._rows.map((r: any) => {
          if (tabel === 'dag_afsluitingen' && alle.some((b: any) => b.datum === r.datum)) return null;
          return { id: `lr-${++mem.loonVolgnummer}`, geopend_op: tabel === 'dag_afsluitingen' ? new Date().toISOString() : undefined, ...r };
        });
        if (nieuw.includes(null)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        alle.push(...nieuw);
        return antwoord(nieuw);
      }
      if (q._op === 'upsert') {
        const sleutel = LOON_UPSERT_SLEUTEL[tabel];
        const uit: any[] = [];
        for (const r of q._rows) {
          const idx = alle.findIndex((b: any) => String(b[sleutel]) === String(r[sleutel]));
          if (idx >= 0) { alle[idx] = { ...alle[idx], ...r }; uit.push(alle[idx]); }
          else { const rij = { ...r }; alle.push(rij); uit.push(rij); }
        }
        return antwoord(uit);
      }
      if (q._op === 'update') {
        const uit: any[] = [];
        for (const r of alle) if (raak(r)) { Object.assign(r, q._patch); uit.push(r); }
        return antwoord(uit);
      }
      // delete
      const blijft = alle.filter((r: any) => !raak(r));
      const weg = alle.length - blijft.length;
      mem.loonRijen[tabel] = blijft;
      return { data: null, error: null, count: q._wilCount ? weg : null };
    },
  };
  return q;
}

vi.mock('../../api/push.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getVapidPublicKey: () => 'test-public-key',
  savePushSubscription: async (record: any) => { mem.pushSubscriptions.push(record); },
  deletePushSubscription: async (endpoint: string) => {
    mem.pushSubscriptions = mem.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
  },
  deletePushSubscriptionForUser: async (endpoint: string, userId: string) => {
    mem.pushSubscriptions = mem.pushSubscriptions.filter((s) => !(s.endpoint === endpoint && String(s.userId) === String(userId)));
  },
  deletePushSubscriptionsForUser: async (userId: string) => {
    const voor = mem.pushSubscriptions.length;
    mem.pushSubscriptions = mem.pushSubscriptions.filter((s) => String(s.userId) !== String(userId));
    return voor - mem.pushSubscriptions.length;
  },
  sendPushToUsers: async (userIds: string[], payload: any) => {
    if (userIds.length === 0) return;
    mem.pushesSent.push({ userIds, payload });
    // Zelfde bijwerking als de echte functie (api/push.ts → bewaarMeldingen):
    // één rij per unieke ontvanger, soort/doel uit de payload of de url.
    const { meldingUitPayload } = await import('../../api/_lib/meldingen.js');
    const rij = meldingUitPayload(payload);
    for (const userId of new Set(userIds.map(String))) {
      mem.meldingen.push({ id: `m-${mem.meldingen.length + 1}`, userId, ...rij, createdAt: new Date(Date.UTC(2026, 6, 1, 8, mem.meldingen.length)).toISOString(), gelezenOp: null });
    }
  },
  getUsersMetPush: async () => [...new Set(mem.pushSubscriptions.map((s: any) => String(s.userId)))],
}));

vi.mock('../../api/email.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sendLeaveDecisionEmail: vi.fn(async () => ({ ok: true, mocked: true })),
  sendEmail: vi.fn(async (opts: any) => {
    mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context, text: opts.text, attachments: opts.attachments });
    mem.mailLogVerloop.push(`mail:${opts.to.join(',')}`);
    return { ok: true, mocked: true };
  }),
  sendWelcomeEmail: vi.fn(async (ctx: any) => {
    // text = de link in de mail, zodat een test de uitnodigingscode kan lezen.
    mem.emailsSent.push({ to: [ctx.to], subject: 'Welkom op het VHB Portaal, stel je wachtwoord in', context: `welcome:${ctx.to}`, text: ctx.actionLink ?? undefined });
    return { ok: true, mocked: true };
  }),
}));

vi.mock('../../api/storage.js', async (importOriginal) => {
  const orig = await importOriginal<any>();
  // Dienstregelingversies op de mem-store, met dezelfde regels als de echte
  // opslag (shared/dienstregeling.ts): een dienst zonder versie telt als de
  // oudste, zonder versies is mem.services de hele lijst.
  const dr = await import('../../shared/dienstregeling');
  const dt = await import('../../shared/dagtype');
  // De dagtypekalender uit de dekkingsconfig van de mem-store (10-10).
  const kalenderMock = () => dt.kalenderUitDekking(mem.coverageExpectations ?? {});
  const vandaagMock = () => new Date().toISOString().slice(0, 10);
  const versiesGesorteerd = () => [...mem.dienstregelingen].sort((a: any, b: any) => String(a.geldigVanaf).localeCompare(String(b.geldigVanaf)));
  const oudsteId = () => dr.oudsteVersie(mem.dienstregelingen as any[])?.id ?? null;
  const kiesVersieMock = (keuze: { versieId?: string; datum?: string } = {}) => {
    if (mem.dienstregelingen.length === 0) return null;
    if (keuze.versieId) {
      const v = mem.dienstregelingen.find((x: any) => x.id === keuze.versieId);
      if (!v) throw new orig.DienstregelingOnbekend(keuze.versieId);
      return v;
    }
    return dr.versieVoorDatum(mem.dienstregelingen as any[], keuze.datum ?? vandaagMock());
  };
  const servicesVanVersie = (versieId: string) => mem.services.filter((s: any) => dr.hoortBijVersie(s, versieId, oudsteId()));
  const servicesPerVersieMock = async () => {
    if (mem.servicesFaalt) throw new Error('services: connection failure');
    const versies = versiesGesorteerd().map((v: any) => ({ ...v, services: servicesVanVersie(v.id) }));
    if (versies.length === 0) return { versies: [], services: mem.services };
    const huidig = dr.versieVoorDatum(versies, vandaagMock());
    return { versies, services: huidig?.services ?? [] };
  };
  const replaceById = (current: any[], incoming: any[], idsToDelete: string[] = []) => {
    const byId = new Map(current.map((r: any) => [String(r.id), r]));
    for (const r of incoming) byId.set(String(r.id), r);
    for (const id of idsToDelete) byId.delete(String(id));
    return [...byId.values()];
  };
  return {
    ...orig,
    getMailLog: async (limit = 200) => mem.mailLog.slice(0, limit),
    logMail: async (regel: any) => { mem.mailLog.unshift({ id: `m-${mem.mailLog.length + 1}`, verzondenOp: new Date().toISOString(), ...regel }); },
    // Een reeks schrijft haar regel vooraf als "niet afgerond" en werkt hem
    // na afloop bij (nr. 5). `mailLogStuk` = de tabel is er niet of schrijven
    // mislukt: dan komt er geen id terug en logt de reeks achteraf.
    startMailLog: async (regel: any) => {
      if (mem.mailLogStuk) return null;
      const id = `m-${mem.mailLog.length + 1}`;
      mem.mailLog.unshift({ id, verzondenOp: new Date().toISOString(), soort: regel.soort, aantal: regel.aantal, gelukt: false, fout: 'onderbroken: de verzending is niet afgerond, mogelijk is een deel vertrokken', door: regel.door ?? 'Systeem' });
      mem.mailLogVerloop.push(`start:${regel.soort}`);
      return id;
    },
    rondMailLogAf: async (id: string, uitkomst: any) => {
      const rij = mem.mailLog.find((r: any) => r.id === id);
      if (!rij) return false;
      rij.gelukt = uitkomst.gelukt;
      rij.fout = uitkomst.fout ?? null;
      mem.mailLogVerloop.push(`klaar:${rij.soort}`);
      return true;
    },
    getAppSetting: async (key: string) => mem.appSettings[key] ?? null,
    setAppSetting: async (key: string, value: unknown) => { mem.appSettings[key] = value; },
    getUsersData: async () => mem.users,
    getRecentLogins: async () => [],
    koppelAuthId: async (userId: string, authId: string) => { const u = mem.users.find((x: any) => String(x.id) === String(userId)); if (u) u.authId = authId; },
    getPlanningNotes: async (o: any) => mem.planningNotes.filter((n: any) => (!o.driverId || n.driverId === o.driverId) && n.date >= o.fromIso && n.date <= o.toIso),
    upsertPlanningNote: async (driverId: string, date: string, note: string) => { mem.planningNotes = mem.planningNotes.filter((n: any) => !(n.driverId === driverId && n.date === date)); mem.planningNotes.push({ driverId, date, note }); },
    getUserExpiries: async () => mem.userExpiries,
    saveUserExpiry: async (rec: any) => {
      mem.userExpiries = mem.userExpiries.filter((e: any) => !(e.userId === rec.userId && e.soort === rec.soort));
      mem.userExpiries.push({ ...rec, updatedAt: null });
    },
    deleteUserExpiry: async (userId: string, soort: string) => {
      mem.userExpiries = mem.userExpiries.filter((e: any) => !(e.userId === userId && e.soort === soort));
    },
    // Meldingencentrum (public.meldingen) — zelfde contract als de echte
    // functies, tegen mem.meldingen; gescoped op user_id zoals de DB-query.
    getMeldingen: async (userId: string, max = 100) =>
      mem.meldingen.filter((m: any) => m.userId === String(userId)).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)).slice(0, max)
        .map(({ userId: _u, ...rest }: any) => ({ ...rest, tekst: rest.tekst ?? undefined, doel: rest.doel ?? undefined, gelezenOp: rest.gelezenOp ?? undefined })),
    telOngelezenMeldingen: async (userId: string) => mem.meldingen.filter((m: any) => m.userId === String(userId) && !m.gelezenOp).length,
    verwijderMeldingen: async (userId: string, ids: string[]) => {
      const voor = mem.meldingen.length;
      mem.meldingen = mem.meldingen.filter((m: any) => !(m.userId === String(userId) && ids.includes(m.id)));
      return voor - mem.meldingen.length;
    },
    markeerMeldingenGelezen: async (userId: string, ids?: string[]) => {
      let n = 0;
      for (const m of mem.meldingen) {
        if (m.userId !== String(userId) || m.gelezenOp) continue;
        if (ids && ids.length > 0 && !ids.includes(m.id)) continue;
        m.gelezenOp = '2026-07-02T08:00:00.000Z';
        n++;
      }
      return n;
    },
    updateUserDashboardVoorkeuren: async (userId: string, voorkeuren: any) => {
      const u = mem.users.find((x: any) => String(x.id) === String(userId));
      if (u) u.dashboardVoorkeuren = voorkeuren;
    },
    deletePlanningNote: async (driverId: string, date: string) => { mem.planningNotes = mem.planningNotes.filter((n: any) => !(n.driverId === driverId && n.date === date)); },
    saveUsersData: async (data: any[]) => {
      const bezet = mem.authEmailBezet && data.find((u: any) => String(u.email || '').toLowerCase() === mem.authEmailBezet);
      if (bezet) throw new orig.EmailInGebruikError(bezet.email);
      // Zelfde contract als de echte functie: nieuwe e-mailadressen = nieuw
      // Auth-account → welkomstmail-kandidaat, met profiel- en Auth-id, en het
      // profiel meteen gekoppeld aan dat account (koppelAuthIdStil).
      const beforeEmails = new Set(mem.users.map((u: any) => String(u.email || '').toLowerCase()).filter(Boolean));
      const nieuw = new Set(data.filter((u: any) => u.email && !beforeEmails.has(String(u.email).toLowerCase())));
      const createdAccounts = [...nieuw].map((u: any) => ({ email: u.email, name: u.name, userId: String(u.id), ...(mem.koppelMislukt ? {} : { authId: `auth-nieuw-${u.id}` }) }));
      mem.users = data.map((u: any) => (nieuw.has(u) && !mem.koppelMislukt ? { ...u, authId: `auth-nieuw-${u.id}` } : u));
      return { createdAccounts };
    },
    // Zelfde contract als de echte: optioneel gefilterd op één gebruiker
    // (GET /api/leave voor niet-staf filtert in de query).
    getLeaveData: async (filters?: { userId?: string }) => {
      mem.leaveFilters.push(filters ?? null);
      return filters?.userId ? mem.leave.filter((l: any) => String(l.userId) === String(filters.userId)) : mem.leave;
    },
    saveLeaveData: async (data: any[], idsToDelete: string[] = []) => {
      mem.leave = replaceById(mem.leave, data, idsToDelete);
    },
    getSwapsData: async (filters?: { betrokkenUserId?: string }) => {
      mem.swapFilters.push(filters ?? null);
      const id = filters?.betrokkenUserId;
      return id ? mem.swaps.filter((s: any) => String(s.requesterId) === String(id) || String(s.targetDriverId ?? '') === String(id)) : mem.swaps;
    },
    // Zoals de echte: een upsert van `data`, daarna de verwijderingen; met
    // alleenPending gaat een rij alleen weg als ze nog 'pending' is.
    saveSwapsData: async (data: any[], idsToDelete: string[] = [], opties: { alleenPending?: boolean } = {}) => {
      const weg = opties.alleenPending
        ? idsToDelete.filter((id) => mem.swaps.find((s: any) => String(s.id) === String(id))?.status === 'pending')
        : idsToDelete;
      mem.swaps = replaceById(mem.swaps, data, weg);
    },
    // Zoals de echte: `update ... where id = ? and status = ?`. De rij wordt
    // alleen geschreven als ze nog de verwachte status heeft; anders raakt de
    // schrijfactie niets en komt er false terug. target_seen_at schrijft dit
    // pad nooit: de opgeslagen waarde blijft. Een nieuwe array per
    // schrijfactie, zodat de momentopname van een lopende handler blijft wat
    // ze was.
    schrijfSwapAlsStatus: async (swap: any, verwachteStatus: string) => {
      const haak = mem.voorSwapStatusWissel;
      if (haak) {
        mem.voorSwapStatusWissel = null;
        await haak(String(swap.id));
      }
      const rij = mem.swaps.find((s: any) => String(s.id) === String(swap.id));
      const geraakt = !!rij && String(rij.status) === String(verwachteStatus);
      mem.swapStatusWissels.push({ id: String(swap.id), verwacht: String(verwachteStatus), naar: String(swap.status), geraakt });
      if (!geraakt) return false;
      const { targetSeenAt: _nooit, ...velden } = swap;
      mem.swaps = mem.swaps.map((s: any) => (s === rij ? { ...velden, ...(rij.targetSeenAt ? { targetSeenAt: rij.targetSeenAt } : {}) } : s));
      return true;
    },
    // Zoals de echte: een insert. Een id dat al bestaat is een unieke-sleutel-
    // fout (23505), geen overschrijving.
    voegSwapsToe: async (swaps: any[]) => {
      if (swaps.length === 0) return;
      const haak = mem.voorSwapToevoegen;
      if (haak) {
        mem.voorSwapToevoegen = null;
        await haak();
      }
      if (swaps.some((n: any) => mem.swaps.some((s: any) => String(s.id) === String(n.id)))) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "swaps_pkey"'), { code: '23505' });
      }
      mem.swaps = [...mem.swaps, ...swaps];
    },
    getSwapsByIds: async (ids: string[]) => {
      if (mem.swapHerlezingFaalt) throw new Error('swaps: connection failure');
      return mem.swaps.filter((s: any) => ids.map(String).includes(String(s.id)));
    },
    markSwapTargetSeen: async (id: string, seenAtIso: string) => {
      const sw = mem.swaps.find((s: any) => String(s.id) === String(id));
      if (sw) sw.targetSeenAt = seenAtIso;
    },
    swapToestandInPlanning: async (swap: any) => {
      mem.planningToestandLezingen += 1;
      if (!swap.shiftDate || !swap.shiftLine || !swap.targetDriverId) return 'onbekend';
      const chauffeurs = new Set(mem.planning.filter((r: any) => r.date === swap.shiftDate && String(r.line) === String(swap.shiftLine)).map((r: any) => String(r.driverId)));
      if (chauffeurs.has(String(swap.requesterId))) return 'niet_doorgevoerd';
      if (!chauffeurs.has(String(swap.targetDriverId))) return 'onbekend';
      const hasReturn = swap.swapType !== 'overname' && swap.returnDate && swap.returnCode && String(swap.returnCode).toLowerCase() !== 'vrij';
      if (!hasReturn) return 'doorgevoerd';
      return mem.planning.some((r: any) => r.date === swap.returnDate && String(r.line) === String(swap.returnCode) && String(r.driverId) === String(swap.requesterId)) ? 'doorgevoerd' : 'onbekend';
    },
    getShiftById: async (id: string) =>
      mem.planning.find((s: any) => String(s.id) === String(id)) ?? null,
    getShiftsOnDate: async (date: string) =>
      mem.planning.filter((s: any) => String(s.date) === String(date)),
    // Planning-doorvoer: zelfde semantiek als de echte DB-functies, maar op
    // mem.planning — zodat de integratietests het effect van approve/cancel
    // op de planning kunnen asserten.
    // `benen` (01-10): alleen die benen, een overgeslagen been telt als 0
    // verplaatste rijen, zoals de echte.
    applySwapToPlanning: async (swap: any, benen?: { aangeboden: boolean; terug: boolean }) => {
      if (!swap.shiftDate || !swap.shiftLine || !swap.targetDriverId) return null;
      if (mem.planningVerplaatsenFaalt === 'doorvoeren') throw new Error('planning: connection failure');
      const move = (date: string, line: string, from: string, to: string) => {
        let n = 0;
        for (const row of mem.planning) {
          if (row.date === date && String(row.line) === String(line) && String(row.driverId) === String(from)) { row.driverId = String(to); n++; }
        }
        return n;
      };
      const offeredMoved = benen && !benen.aangeboden ? 0 : move(swap.shiftDate, swap.shiftLine, swap.requesterId, swap.targetDriverId);
      const hasReturn = swap.swapType !== 'overname' && swap.returnDate && swap.returnCode && String(swap.returnCode).toLowerCase() !== 'vrij';
      const returnMoved = hasReturn ? (benen && !benen.terug ? 0 : move(swap.returnDate, swap.returnCode, swap.targetDriverId, swap.requesterId)) : null;
      return { offeredMoved, returnMoved };
    },
    revertSwapFromPlanning: async (swap: any, benen?: { aangeboden: boolean; terug: boolean }) => {
      if (!swap.shiftDate || !swap.shiftLine || !swap.targetDriverId) return null;
      if (mem.planningVerplaatsenFaalt === 'terugdraaien') throw new Error('planning: connection failure');
      const move = (date: string, line: string, from: string, to: string) => {
        let n = 0;
        for (const row of mem.planning) {
          if (row.date === date && String(row.line) === String(line) && String(row.driverId) === String(from)) { row.driverId = String(to); n++; }
        }
        return n;
      };
      const offeredMoved = benen && !benen.aangeboden ? 0 : move(swap.shiftDate, swap.shiftLine, swap.targetDriverId, swap.requesterId);
      const hasReturn = swap.swapType !== 'overname' && swap.returnDate && swap.returnCode && String(swap.returnCode).toLowerCase() !== 'vrij';
      const returnMoved = hasReturn ? (benen && !benen.terug ? 0 : move(swap.returnDate, swap.returnCode, swap.requesterId, swap.targetDriverId)) : null;
      return { offeredMoved, returnMoved };
    },
    // Horizon: matrix wint, anders de opgebouwde planning (zoals de echte).
    getPlanningHorizon: async () => {
      const uitMatrix = mem.planningMatrix.map((r: any) => String(r.source_date ?? '')).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
      if (uitMatrix) return uitMatrix;
      return mem.planning.map((r: any) => String(r.date ?? '')).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() ?? null;
    },
    getPlanningData: async (f?: { driverId?: string; monthIso?: string }) => {
      mem.planningMaandFilters.push(f?.monthIso ?? null);
      return mem.planning.filter((s: any) =>
        (!f?.driverId || String(s.driverId) === String(f.driverId)) &&
        (!f?.monthIso || String(s.date ?? '').startsWith(`${f.monthIso}-`)));
    },
    getServicesData: async (keuze: { versieId?: string; datum?: string; alleVersies?: boolean } = {}) => {
      mem.servicesLezingen += 1;
      if (mem.servicesFaalt) throw new Error('services: connection failure');
      if (keuze.alleVersies) return mem.services;
      const versie = kiesVersieMock(keuze);
      return versie ? servicesVanVersie(versie.id) : mem.services;
    },
    getServicesAlle: async () => mem.services,
    getServicesPerVersie: servicesPerVersieMock,
    getDienstregelingen: async () => versiesGesorteerd(),
    saveServicesData: async (rauw: any[], keuze: { versieId?: string; datum?: string; alleVersies?: boolean } = {}) => {
      // Zoals toPublicService: de afwijkingen per dagtype genormaliseerd bewaren (10-10).
      const data = rauw.map((s: any) => ({ ...s, varianten: dt.variantenSchoon(s.varianten) }));
      const versie = keuze.alleVersies ? null : kiesVersieMock(keuze);
      if (!versie) { mem.services = data; return; }
      const rest = mem.services.filter((s: any) => !dr.hoortBijVersie(s, versie.id, oudsteId()));
      mem.services = [...rest, ...data.map((s: any) => ({ ...s, dienstregelingId: versie.id }))];
    },
    createDienstregeling: async (invoer: any) => {
      const versie = { id: `dr-${mem.dienstregelingen.length + 1}`, naam: invoer.naam ?? null, geldigVanaf: invoer.geldigVanaf, opmerking: invoer.opmerking ?? null, createdAt: new Date().toISOString(), createdBy: invoer.createdBy ?? null };
      mem.dienstregelingen.push(versie);
      if (invoer.kopieVanId) {
        const bron = servicesVanVersie(invoer.kopieVanId);
        mem.services = [...mem.services, ...bron.map((s: any, i: number) => ({ ...s, id: `${versie.id}-${i + 1}`, dienstregelingId: versie.id }))];
      }
      return versie;
    },
    updateDienstregeling: async (id: string, patch: any) => {
      const v = mem.dienstregelingen.find((x: any) => x.id === id);
      if (!v) return null;
      if (patch.naam !== undefined) v.naam = patch.naam;
      if (patch.opmerking !== undefined) v.opmerking = patch.opmerking;
      if (patch.geldigVanaf !== undefined) v.geldigVanaf = patch.geldigVanaf;
      return { ...v };
    },
    deleteDienstregeling: async (id: string) => {
      const was = mem.dienstregelingen.length;
      mem.dienstregelingen = mem.dienstregelingen.filter((x: any) => x.id !== id);
      mem.services = mem.services.filter((s: any) => s.dienstregelingId !== id);
      return mem.dienstregelingen.length < was;
    },
    herstelDienstregelingen: async (versies: any[]) => { mem.dienstregelingen = [...versies]; return versies.length; },
    getUpdatesData: async () => mem.updates,
    // Zoals de echte: een upsert noemt alleen de eigen kolommen, dus
    // `bijlagen` van een bestaande rij blijft staan en een meegestuurde lijst
    // wordt nooit geschreven (ook niet bij een nieuwe rij). Rijen die niet in
    // de payload zitten verdwijnen.
    saveUpdatesData: async (data: any[]) => {
      const bestaand = new Map(mem.updates.map((u: any) => [String(u.id), u]));
      mem.updates = (Array.isArray(data) ? data : []).map((u: any) => {
        const oud = bestaand.get(String(u.id));
        const { bijlagen: _vanClient, ...rij } = u;
        return oud?.bijlagen ? { ...rij, bijlagen: oud.bijlagen } : rij;
      });
    },
    // Storage voor de bijlagen: mem.opslag houdt de sleutels bij, zodat een
    // test kan zien dat een bestand echt weg is.
    uploadUpdateBijlage: async (updateId: string, slot: number) => {
      mem.opslag.add(`update-bijlagen/${updateId}-${slot}.pdf`);
    },
    verwijderUpdateBijlage: async (updateId: string, slot: number) => {
      mem.opslag.delete(`update-bijlagen/${updateId}-${slot}.pdf`);
    },
    ondertekenUpdateBijlage: async (updateId: string, slot: number) =>
      mem.opslag.has(`update-bijlagen/${updateId}-${slot}.pdf`) ? `https://opslag.test/${updateId}-${slot}.pdf?sig=test` : undefined,
    zetUpdateBijlagen: async (updateId: string, bijlagen: any[]) => {
      const u = mem.updates.find((x: any) => String(x.id) === String(updateId));
      if (!u) return;
      // De kolom wordt null bij een lege lijst; toPublicUpdate laat het veld
      // dan weg, dus zo ziet de client het ook hier.
      if (bijlagen.length > 0) u.bijlagen = bijlagen;
      else delete u.bijlagen;
    },
    // Wat er echt in Storage hangt (herstel na "Ongedaan maken"): de grootte
    // komt uit Storage, niet van de client, net als het uploadmoment (het
    // tijdstip dat Storage bijhoudt, hier `mem.opslagTijd`; zonder ingang
    // geeft Storage er geen en blijft het veld weg).
    bestaandeUpdateBijlagen: async (updateId: string) => {
      if (mem.opslagFaalt) throw new Error('storage onbereikbaar');
      return [1, 2].filter((slot) => mem.opslag.has(`update-bijlagen/${updateId}-${slot}.pdf`)).map((slot) => {
        const tijd = mem.opslagTijd.get(`update-bijlagen/${updateId}-${slot}.pdf`);
        return { slot, sizeBytes: 1000 + slot, ...(tijd ? { uploadedAt: tijd } : {}) };
      });
    },
    bestaandeDiversionBijlagen: async (id: string) => {
      if (mem.opslagFaalt) throw new Error('storage onbereikbaar');
      return {
        slots: [1, 2, 3, 4, 5].filter((slot) => mem.opslag.has(`diversions/${id}-${slot}.pdf`)).map((slot) => {
          const tijd = mem.opslagTijd.get(`diversions/${id}-${slot}.pdf`);
          return { slot, sizeBytes: 1000 + slot, ...(tijd ? { uploadedAt: tijd } : {}) };
        }),
        oudeSleutel: mem.opslag.has(`diversions/${id}.pdf`),
      };
    },
    // Uitgestelde opruiming (api/_lib/bijlagenOpruim.ts): de bucket oplijsten
    // en bestanden weghalen. Het log en de gerichte lezing staan hieronder.
    lijstBijlageBestanden: async (bucket: string) => {
      mem.cronVolgorde.push(`opruiming: ${bucket}`);
      if (mem.opslagHangt) return new Promise<never>(() => {});
      return [...mem.opslag]
        .filter((k) => k.startsWith(`${bucket}/`))
        .map((k) => ({ naam: k.slice(bucket.length + 1), gewijzigdOp: mem.opslagTijd.get(k) ?? '2026-01-01T00:00:00Z' }));
    },
    // De heartbeat van een cron: hier alleen onthouden wat er wanneer kwam.
    // Eén opname voor de mail-tests (mem.hartslagen) en de nachtcron
    // (mem.cronVolgorde, mem.activity).
    logCronHeartbeat: async (naam: string, details: string) => {
      mem.hartslagen.push({ naam, details });
      mem.cronVolgorde.push(`heartbeat: ${naam}`);
      mem.activity.push({ domain: 'system', action: `Cron geslaagd: ${naam}`, message: details, gelogdOp: new Date().toISOString() });
    },
    verwijderBijlageBestanden: async (bucket: string, paden: string[]) => {
      for (const pad of paden) mem.opslag.delete(`${bucket}/${pad}`);
    },
    // Zoals de echte: de logregels van deze id's, nieuwste eerst.
    logregelsVanEntiteiten: async (type: string, ids: string[]) => {
      if (mem.logLezingFaalt) throw new Error('log onbereikbaar');
      return mem.activity
        .filter((a) => a.entityType === type && ids.includes(String(a.entityId)))
        .map((a) => ({ entityId: String(a.entityId), action: String(a.action), createdAt: String(a.gelogdOp) }))
        .reverse();
    },
    // Zoals de echte: gerichte lezing op id, gooit bij een storing.
    bestaandeRecordIds: async (tabel: 'diversions' | 'updates', ids: string[]) => {
      if (mem.recordLezingFaalt) throw new Error('database onbereikbaar');
      const rijen: any[] = tabel === 'diversions' ? mem.diversions : mem.updates;
      return new Set(rijen.map((r) => String(r.id)).filter((id) => ids.includes(id)));
    },
    getDiversionsData: async () => mem.diversions,
    // Zoals de echte: een upsert noemt `bijlagen` niet (de route draagt de
    // lijst zelf mee). De bestanden van een verwijderde omleiding blijven
    // staan tot de nachtcron ze opruimt (29-09).
    saveDiversionsData: async (data: any[]) => {
      mem.diversions = data;
    },
    uploadDiversionBijlage: async (id: string, slot: number) => {
      mem.opslag.add(`diversions/${id}-${slot}.pdf`);
    },
    verwijderDiversionBijlage: async (id: string, slot: number, opts?: { legacy?: boolean }) => {
      mem.opslag.delete(`diversions/${id}-${slot}.pdf`);
      if (opts?.legacy) mem.opslag.delete(`diversions/${id}.pdf`);
    },
    downloadDiversionBijlage: async (id: string, slot: number, legacy = false) =>
      mem.opslag.has(`diversions/${legacy ? `${id}.pdf` : `${id}-${slot}.pdf`}`) ? Buffer.from('%PDF-1.4 test') : null,
    verwijderDiversionLegacyBijlage: async (id: string) => {
      mem.opslag.delete(`diversions/${id}.pdf`);
    },
    verplaatsDiversionLegacyBijlage: async (id: string) => {
      if (!mem.opslag.has(`diversions/${id}.pdf`)) throw new Error('Object not found');
      mem.opslag.delete(`diversions/${id}.pdf`);
      mem.opslag.add(`diversions/${id}-1.pdf`);
    },
    ondertekenDiversionBijlage: async (id: string, slot: number, legacy = false) => {
      const pad = legacy ? `${id}.pdf` : `${id}-${slot}.pdf`;
      return mem.opslag.has(`diversions/${pad}`) ? `https://opslag.test/diversions/${pad}?sig=test` : undefined;
    },
    zetDiversionBijlagen: async (id: string, bijlagen: any[]) => {
      const d = mem.diversions.find((x: any) => String(x.id) === String(id));
      if (!d) return;
      if (bijlagen.length > 0) d.bijlagen = bijlagen;
      else delete d.bijlagen;
      // De oude marker gaat mee op null (zoals de echte update-query).
      delete d.pdfUrl;
    },
    getPlanningCodesData: async () => {
      mem.codesLezingen += 1;
      if (mem.codesFaalt) throw new Error('planning_codes: connection failure');
      return mem.planningCodes;
    },
    savePlanningCodesData: async (data: any[]) => { mem.planningCodes = data; },
    logActivity: async (_req: any, domain: string, action: string, message: string, entity?: { type?: string; id?: string }) => {
      // actorName/actorRole/gelogdOp: wie de regel schreef, zoals de echte
      // logActivity dat uit req.appUser haalt (bron van het ruilverloop).
      mem.activity.push({ domain, action, message, entityType: entity?.type, entityId: entity?.id, actorName: _req?.appUser?.name, actorRole: _req?.appUser?.role, gelogdOp: new Date().toISOString() });
    },
    // Zelfde contract als de echte: logregels van ruilen per ruil-id, oudste
    // eerst; zonder id's = alle ruilen (staf). De filters bewaren we, zodat
    // een test kan aantonen dat een chauffeur alleen zijn eigen ruilen opvraagt.
    getSwapVerloopRegels: async (ids?: string[]) => {
      mem.verloopFilters.push(ids ?? null);
      if (mem.verloopFaalt) throw new Error('activity_log onbereikbaar');
      const uit: Record<string, any[]> = {};
      for (const a of mem.activity) {
        if (a.entityType !== 'swap' || !a.entityId) continue;
        if (ids && !ids.includes(String(a.entityId))) continue;
        (uit[String(a.entityId)] ??= []).push({ createdAt: a.gelogdOp ?? a.createdAt, action: a.action, actorRole: a.actorRole ?? null, actorName: a.actorName ?? null, details: a.message ?? a.details ?? '' });
      }
      return uit;
    },
    getActivityLog: async (opts?: { sinceIso?: string | null; max?: number; metRuilBekeken?: boolean }) => {
    // Mock respecteert de opts — anders kan de #249-regressie ("UI beloofde
    // 30 dagen, server gaf 100") ongemerkt terugkomen terwijl alles groen blijft.
    // Zelfde filter als de echte: "Dienstruil bekeken" is een waarneming en
    // hoort niet in het auditspoor, tenzij de back-up er expliciet om vraagt.
    let rows = mem.activity;
    if (!opts?.metRuilBekeken) rows = rows.filter((a: any) => a.action !== 'Dienstruil bekeken');
    if (opts?.sinceIso) rows = rows.filter((a) => a.createdAt >= opts.sinceIso!);
    if (opts?.max !== undefined) rows = rows.slice(0, opts.max);
    return rows;
  },
    getLoginActivity: async () => mem.activity.filter((a: any) => a.action === 'Aangemeld' || a.action === 'Actief'),
    getLatestAuthEventAt: async () => mem.lastAuthEventAt,
    // Weekcijfers in de digest (25-09): uitgevoerde wissels uit het
    // activiteitenlog; de mock heeft geen activity_log-tabel.
    getSwapExecutions: async () => [],
    getAanwezigheid: async (sinceIso: string) => {
      if (!mem.presenceTabel) {
        const err: any = new Error('relation "public.user_presence" does not exist');
        err.code = '42P01';
        throw err;
      }
      return mem.presence
        .filter((r: any) => String(r.last_seen_at) >= sinceIso)
        .map((r: any) => ({
          userId: String(r.user_id), rol: r.role ?? null, van: String(r.started_at), tot: String(r.last_seen_at),
          // Zoals select('*'): de plaatssleutels bestaan alleen mét de migratie
          // 2026-09-20_user_presence_locatie.sql.
          land: r.land ?? null, regio: r.regio ?? null, stad: r.stad ?? null, locatieBekend: 'land' in r,
        }));
    },
    noteerAanwezigheid: async (userId: string, rol: string | null, opties?: { locatie?: unknown }) => {
      mem.presenceSchrijf.push({ userId, rol, locatie: opties?.locatie ?? null });
    },
    updateUserSessionMeta: async (id: string, f: any) => { mem.sessionMetaWrites.push({ id, ...f }); },
    bumpActiveSessions: async () => {},
    getPlanningMatrixRows: async (opts?: { month?: string; van?: string; tot?: string }) => {
      const maand = String(opts?.month ?? '');
      const isoDag = (v?: string) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const venster = isoDag(opts?.van) && isoDag(opts?.tot) ? `${opts!.van}..${opts!.tot}` : null;
      mem.matrixMaandFilters.push(maand || venster || null);
      // Spiegelt de .gte/.lte op source_date in api/storage.ts, zodat een
      // route die de maand vergeet hier evenveel rijen ziet als in productie.
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(maand)) return mem.planningMatrix.filter((r: any) => String(r.source_date ?? '').startsWith(`${maand}-`));
      if (venster) return mem.planningMatrix.filter((r: any) => String(r.source_date ?? '') >= opts!.van! && String(r.source_date ?? '') <= opts!.tot!);
      return mem.planningMatrix;
    },
    getPlanningMatrixGrenzen: async () => {
      const dagen = mem.planningMatrix.map((r: any) => String(r.source_date ?? '')).filter(Boolean).sort();
      return { eerste: dagen[0] ?? null, laatste: dagen[dagen.length - 1] ?? null };
    },
    // Sinds de golden import-keten-suite (01-09) draait hier de ÉCHTE
    // opbouw-kern (bouwPlanningUitMatrix, pure functie) op de mem-store —
    // een mini-mock verstopte precies de keten-bugs die deze tests moeten
    // vangen (segmenten, absences, unknown codes, naam-botsingen).
    buildPlanningFromMatrix: async (inputRows?: any[]) => {
      const perVersie = await servicesPerVersieMock();
      return orig.bouwPlanningUitMatrix({
        rows: inputRows ?? mem.planningMatrix,
        users: mem.users,
        services: perVersie.services,
        versies: perVersie.versies,
        planningCodes: mem.planningCodes,
        kalender: kalenderMock(),
      });
    },
    replacePlanningData: async (shifts: any[]) => {
      if (mem.planningVervangenFaalt) throw new Error('replace_planning: connection failure');
      mem.planning = shifts;
    },
    getPlanningVersion: async () => {
      if (mem.planningVersies === 'loopt') return ++mem.planningVersieTeller;
      if (!mem.planningVersies || mem.planningVersies.length === 0) return null;
      return mem.planningVersies.length > 1 ? mem.planningVersies.shift()! : mem.planningVersies[0];
    },
    replacePlanningAndMatrix: async (rows: any[], shifts: any[]) => { mem.planningMatrix = rows; mem.planning = shifts; },
    // Herstelpunt-keten (import → historiek + snapshot → restore), in-memory.
    savePlanningMatrixHistoryEntry: async (entry: any) => {
      if (mem.historiekFaalt) return false;
      mem.importHistory.unshift(entry);
      return true;
    },
    getPlanningMatrixHistory: async () => mem.importHistory,
    storeImportSnapshot: async (snapshot: any) => {
      const path = `snapshots/snap-${Object.keys(mem.snapshots).length + 1}.json`;
      mem.snapshots[path] = JSON.parse(JSON.stringify(snapshot));
      return path;
    },
    getImportSnapshot: async (path: string) => mem.snapshots[path] ?? null,
    restorePlanningAndMatrixSnapshot: async (snapshot: any) => {
      mem.planningMatrix = snapshot.matrixRows;
      mem.planning = snapshot.planning;
    },
    saveMatrixRowAssignments: async (rowId: string, assignments: Record<string, string>) => {
      mem.planningMatrix = mem.planningMatrix.map((r: any) => (String(r.id) === String(rowId) ? { ...r, assignments } : r));
    },
    insertPlanningRows: async (rows: any[]) => { mem.planning = [...mem.planning, ...rows]; },
    getServiceSegments: (service: any, dagtype?: string | null) => {
      // Zelfde dagtype-keuze als de echte (shared/dagtype.ts); bewust alleen deel 1, zoals vanouds.
      const t = dt.tijdenOpDag(service, dagtype);
      const segs = [];
      if (t.startTime && t.endTime) segs.push({ startTime: t.startTime, endTime: t.endTime, segment: 1, loopnr: String(t.loopnr ?? '') });
      return segs;
    },
    laadDagtypeKalender: async () => kalenderMock(),
    getCoverageExpectations: async () => mem.coverageExpectations ?? {},
    saveCoverageExpectations: async (map: any) => { mem.coverageExpectations = map; },
    listUserDocuments: async (userId?: string) =>
      userId ? mem.documents.filter((d: any) => String(d.userId) === String(userId)) : mem.documents,
    getUserDocument: async (id: string) => mem.documents.find((d: any) => String(d.id) === String(id)) ?? null,
    insertUserDocument: async (doc: any) => { const rec = { id: `doc-${mem.documents.length + 1}`, uploadedAt: '2026-07-01T00:00:00Z', ...doc }; mem.documents.push(rec); return rec; },
    deleteUserDocument: async (id: string) => { mem.documents = mem.documents.filter((d: any) => String(d.id) !== String(id)); },
    markUserDocumentOpened: async (id: string, userId: string) => {
      const doc = mem.documents.find((d: any) => String(d.id) === String(id) && String(d.userId) === String(userId));
      if (doc && !doc.openedAt) doc.openedAt = '2026-07-30T12:00:00Z';
    },
    getRitblaadjeMeta: async () => mem.ritblaadje ?? null,
    // Toestel-whitelist: zelfde contract als de echte helpers, tegen mem.devices.
    getDevice: async (userId: string, deviceToken: string) => {
      // Speciale tokens simuleren DB-fouten voor de fail-open/closed-tests.
      if (deviceToken === 'dev-missingtable') throw { code: '42P01', message: 'relation "user_devices" does not exist' };
      if (deviceToken === 'dev-dberror') throw { code: '08006', message: 'connection failure' };
      return mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken) ?? null;
    },
    listDevicesForUser: async (userId: string) =>
      mem.devices.filter((d: any) => String(d.userId) === String(userId)),
    registerDevice: async (userId: string, deviceToken: string, name: string, autoApprove: boolean, _bekend?: unknown, sessionId?: string | null) => {
      const existing = mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken);
      if (existing) {
        existing.lastSeenAt = '2026-07-18T12:00:00Z';
        if (sessionId) existing.sessionId = sessionId;
        return { device: existing, created: false };
      }
      const device = {
        userId: String(userId), deviceToken, name,
        status: autoApprove ? 'approved' : 'pending',
        createdAt: '2026-07-18T12:00:00Z', lastSeenAt: '2026-07-18T12:00:00Z',
        approvedAt: autoApprove ? '2026-07-18T12:00:00Z' : null, approvedBy: autoApprove ? 'auto' : null,
        sessionId: sessionId ?? null,
      };
      mem.devices.push(device);
      return { device, created: true };
    },
    listAllDevices: async () => mem.devices,
    listRevokedSessionIds: async () =>
      mem.devices.filter((d: any) => d.status === 'revoked' && d.sessionId).map((d: any) => String(d.sessionId)),
    setDeviceStatus: async (userId: string, deviceToken: string, status: string) => {
      const device = mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken);
      if (device) device.status = status;
    },
    renameDevice: async (userId: string, deviceToken: string, name: string) => {
      const device = mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken);
      if (device) device.name = name;
    },
    deleteDevice: async (userId: string, deviceToken: string) => {
      mem.devices = mem.devices.filter((d: any) => !(String(d.userId) === String(userId) && d.deviceToken === deviceToken));
    },
    revokeAllDevices: async (userId: string) => {
      let n = 0;
      for (const d of mem.devices) {
        if (String(d.userId) === String(userId) && d.status !== 'revoked') { d.status = 'revoked'; n++; }
      }
      return n;
    },
    deleteAllDocumentsForUser: async (userId: string) => {
      const n = mem.documents.filter((d: any) => String(d.userId) === String(userId)).length;
      mem.documents = mem.documents.filter((d: any) => String(d.userId) !== String(userId));
      return n;
    },
    logClientError: async (entry: any) => { mem.clientErrors.push({ id: mem.clientErrors.length + 1, createdAt: new Date().toISOString(), ...entry }); },
    // Zoals de echte functie: nieuwste eerst (created_at desc).
    getClientErrors: async () => [...mem.clientErrors].reverse(),
    getClientErrorStatuses: async () =>
      mem.clientErrorStatusTabel ? new Map(mem.clientErrorStatus.map((s: any) => [s.fingerprint, s])) : null,
    setClientErrorStatus: async (record: any) => {
      if (!mem.clientErrorStatusTabel) throw { code: '42P01', message: 'relation "client_error_status" does not exist' };
      mem.clientErrorStatus = [...mem.clientErrorStatus.filter((s: any) => s.fingerprint !== record.fingerprint), record];
    },
    getClientErrorsSince: async (sinceIso: string) =>
      mem.clientErrors.filter((e) => String(e.createdAt) >= sinceIso),
    storeBackup: async (filename: string, body: string) => {
      mem.storedBackups.push({ filename, size: body.length });
      mem.laatsteBackup = { filename, body };
      return { removedOld: 0 };
    },
    getLatestBackup: async () => mem.laatsteBackup,
    restoreFromBackup: async (collections: any) => {
      const summary: Record<string, number> = {};
      for (const key of ['users', 'planning', 'dienstregelingen', 'services', 'diversions', 'updates', 'leave', 'swaps', 'planningCodes']) {
        if (Array.isArray(collections[key])) {
          (mem as any)[key] = collections[key];
          summary[key] = collections[key].length;
        }
      }
      return summary;
    },
  };
});

export let baseUrl = '';
let server: ReturnType<typeof import('express')['application']['listen']> | any;

// Vaste klok (J, 24-09): de fixtures spelen in juni/juli 2026 en de server
// weigert sindsdien een ruil voor een gereden dienst op de Brusselse klok.
// De suite draait daarom op een vast moment vóór die fixtures; alleen Date
// wordt nagebootst, geen timers. Een test die zelf `zetNu` gebruikt zet de
// klok gewoon opnieuw.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-06-15T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

beforeAll(async () => {
  const app = (await import('../../api/index')).default;
  resetAllRateLimiters = (await import('../../api/rateLimit')).resetAllRateLimiters;
  invalidateUsersCache = (await import('../../api/userCache')).invalidateUsersCache;
  invalidateOnderhoudCache = (await import('../../api/_lib/onderhoud')).invalidateOnderhoudCache;
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  // De testserver sluit zelf nooit een verbinding die stilligt (02-10).
  // Standaard doet Node dat 6 s na het laatste antwoord (keepAliveTimeout 5 s
  // plus 1 s buffer), met een timer. Server en fetch delen hier één event
  // loop: rekent een test synchroon over dat moment heen (de werkmap van 4 MB
  // in de gzip-regressiebewaker, op een CI-runner 5 tot 9 s bouwen en parsen),
  // dan loopt die timer pas af na het rekenwerk. fetch heeft de POST dan al op
  // de oude verbinding gezet, de server sluit die zonder de POST te lezen en
  // de test faalt met "fetch failed, read ECONNRESET": 8 van de 39 CI-runs op
  // Node 22.23.3. Met 0 sluit alleen de client nog een stille verbinding, en
  // die weet dat zelf: het volgende verzoek krijgt gewoon een nieuwe.
  server.keepAliveTimeout = 0;
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/** De klok een seconde verder: in het echt staan twee handelingen nooit op
 *  dezelfde milliseconde in het log, onder de vaste testklok wel. */
export const tik = (ms = 1000) => vi.setSystemTime(new Date(Date.now() + ms));

/** De vaste testklok als ISO: het uploadmoment dat de server sinds 29-09 bij
 *  elke geüploade bijlage zet (`uploadedAt`), zolang de test de klok niet
 *  verzet. Oudere elementen zonder dat veld blijven overal geldig. */
export const KLOK_ISO = '2026-06-15T10:00:00.000Z';

const COLLECTIE_PADEN = new Set(['/api/planning', '/api/planning-codes', '/api/users', '/api/diversions', '/api/services', '/api/updates', '/api/swaps', '/api/leave']);
export const api = async (
  method: string,
  path: string,
  // device: toestel-token voor de whitelist-gate. Default 'dev-ok' (in
  // beforeEach goedgekeurd voor beide chauffeurs) zodat bestaande tests
  // ongemoeid blijven; expliciet null = header weglaten.
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; device?: string | null; revisie?: null } = {},
) => {
  const auth = {
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.device === null ? {} : { 'X-Device-Token': opts.device ?? 'dev-ok' }),
  };
  // Collectie-POSTs vereisen sinds 06-09 een basisrevisie (X-Collection-
  // Revision). Zoals de echte client: eerst de lijst laden, de revisie uit de
  // responsheader meesturen. Tests die de header zelf zetten (of expliciet
  // weglaten met revisie: null) blijven de baas.
  let revisie: Record<string, string> = {};
  if (method === 'POST' && COLLECTIE_PADEN.has(path) && opts.revisie !== null && !opts.headers?.['x-collection-revision']) {
    const vers = await fetch(`${baseUrl}${path}`, { headers: auth });
    const rev = vers.headers.get('x-collection-revision');
    await vers.arrayBuffer().catch(() => undefined);
    if (vers.ok && rev) revisie = { 'x-collection-revision': rev };
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...auth,
      ...revisie,
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
};

beforeEach(() => {
  // Telstand van de rate-limiter en de auth-cache per test wissen: anders
  // bloedt verbruik over tussen tests (en kan een onschuldige test 429 of
  // stale users zien).
  resetAllRateLimiters();
  invalidateUsersCache();
  invalidateOnderhoudCache();
  mem.supabaseAdmin = null;
  mem.koppelMislukt = false;
  mem.appSettings = {};
  mem.opslag.clear();
  mem.opslagTijd.clear();
  mem.opslagFaalt = false;
  mem.logLezingFaalt = false;
  mem.recordLezingFaalt = false;
  mem.opslagHangt = false;
  mem.cronVolgorde = [];
  mem.users = [
    { id: '1', name: 'Annelies Admin', email: 'admin@vhb.be', role: 'admin', isActive: true },
    { id: '2', name: 'Pieter Planner', email: 'planner@vhb.be', role: 'planner', isActive: true },
    { id: '3', name: 'Chauffeur A', email: 'a@vhb.be', role: 'chauffeur', isActive: true },
    { id: '4', name: 'Chauffeur B', email: 'b@vhb.be', role: 'chauffeur', isActive: true },
  ];
  mem.leave = [
    { id: 'l-a1', userId: '3', startDate: '2026-07-01', endDate: '2026-07-03', type: 'betaald_verlof', status: 'pending', comment: 'rust', createdAt: '2026-06-01T08:00:00Z' },
    { id: 'l-a2', userId: '3', startDate: '2026-08-10', endDate: '2026-08-12', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-05-01T08:00:00Z', decidedAt: '2026-05-02T08:00:00Z' },
    { id: 'l-b1', userId: '4', startDate: '2026-07-05', endDate: '2026-07-06', type: 'klein_verlet', status: 'pending', comment: 'privé', createdAt: '2026-06-02T08:00:00Z' },
  ];
  mem.swaps = [
    { id: 's-1', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    { id: 's-2', shiftId: 'sh-b', requesterId: '4', targetDriverId: '2', status: 'pending', reason: '', createdAt: '2026-06-01T09:00:00Z', returnDate: '2026-07-03', returnCode: '12' },
  ];
  mem.planning = [
    { id: 'sh-a', driverId: '3', date: '2026-07-01', line: '12' },
    { id: 'sh-b', driverId: '4', date: '2026-07-02', line: '14' },
    { id: 'sh-c', driverId: '3', date: '2026-07-08', line: '12' }, // vrije dienst van chauffeur 3 (geen open ruil)
  ];
  // 2026-07-08: chauffeur 3 rijdt dienst 12, chauffeur 4 staat op bv → een
  // overname (ruil zonder tegenprestatie) naar chauffeur 4 mag die dag.
  mem.planningMatrix = [
    { id: 'm-1', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'bv' }, raw_row: '' },
    { id: 'm-2', source_date: '2026-07-01', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
  ];
  // Eén versie die op de testklok (2026-06-15) geldt: de stand na de migratie van 08-10.
  mem.dienstregelingen = [
    { id: 'dr-sep', naam: null, geldigVanaf: '2026-01-01', opmerking: null, createdAt: '2026-01-01T00:00:00Z', createdBy: null },
  ];
  mem.services = [
    { id: 'd1', serviceNumber: '10', startTime: '06:00', endTime: '14:00' },
    { id: 'd2', serviceNumber: '11', startTime: '07:00', endTime: '15:00' },
    { id: 'd3', serviceNumber: '12', startTime: '08:00', endTime: '16:00' },
    { id: 'd4', serviceNumber: '13', startTime: '09:00', endTime: '17:00' },
    { id: 'd5', serviceNumber: '14', startTime: '10:00', endTime: '18:00' },
    { id: 'd6', serviceNumber: '15', startTime: '11:00', endTime: '19:00' },
  ];
  mem.updates = Array.from({ length: 6 }, (_, i) => ({
    id: `u${i + 1}`, date: '2026-06-01', title: `Update ${i + 1}`, category: 'algemeen', content: '...',
  }));
  mem.diversions = [];
  mem.planningCodes = [];
  mem.coverageExpectations = {};
  mem.activity = [];
  mem.lastAuthEventAt = null;
  mem.sessionMetaWrites = [];
  mem.presence = [];
  mem.presenceSchrijf = [];
  mem.presenceTabel = true;
  mem.matrixMaandFilters = [];
  mem.planningMaandFilters = [];
  mem.leaveFilters = [];
  mem.swapFilters = [];
  mem.servicesLezingen = 0;
  mem.codesLezingen = 0;
  mem.servicesFaalt = false;
  mem.codesFaalt = false;
  mem.verloopFilters = [];
  mem.verloopFaalt = false;
  mem.clientErrors = [];
  mem.clientErrorStatus = [];
  mem.clientErrorStatusTabel = true;
  mem.emailsSent = [];
  mem.storedBackups = [];
  mem.laatsteBackup = null;
  mem.pushSubscriptions = [];
  mem.pushesSent = [];
  mem.importHistory = [];
  mem.snapshots = {};
  mem.historiekFaalt = false;
  mem.documents = [];
  mem.ritblaadje = null;
  // Beide chauffeurs hebben één goedgekeurd toestel ('dev-ok' — de default
  // van de api()-helper), zodat de whitelist-gate bestaande tests niet raakt.
  mem.planningNotes = [];
  mem.userExpiries = [];
  mem.meldingen = [];
  mem.authEmailBezet = null;
  mem.loonRijen = { loon_codes: [], loon_medewerkers: [], dag_afsluitingen: [], dag_prestaties: [] };
  mem.loonVolgnummer = 0;
  mem.planningVersies = null;
  mem.planningVersieTeller = 0;
  mem.planningVervangenFaalt = false;
  mem.voorSwapStatusWissel = null;
  mem.swapStatusWissels = [];
  mem.planningVerplaatsenFaalt = null;
  mem.voorSwapToevoegen = null;
  mem.planningToestandLezingen = 0;
  mem.swapHerlezingFaalt = false;
  mem.devices = [
    { userId: '3', deviceToken: 'dev-ok', name: 'iPhone · app', status: 'approved', createdAt: '2026-07-01T00:00:00Z', lastSeenAt: '2026-07-01T00:00:00Z', approvedAt: '2026-07-01T00:00:00Z', approvedBy: 'auto' },
    { userId: '4', deviceToken: 'dev-ok', name: 'Android · app', status: 'approved', createdAt: '2026-07-01T00:00:00Z', lastSeenAt: '2026-07-01T00:00:00Z', approvedAt: '2026-07-01T00:00:00Z', approvedBy: 'auto' },
  ];
});

// Apart geëxporteerd: vitest weigert `export const` op een vi.hoisted-waarde.
export { mem };
