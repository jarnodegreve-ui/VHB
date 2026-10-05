// @vitest-environment node
import {
  api,
  invalidateUsersCache,
  mem,
} from './harnas';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('filmnummers (01-10)', () => {
  const GEEN = { code: '1', lijn: '', tekst: 'Geen dienst' };
  const BRUGGE = { code: '5000', lijn: '50', tekst: 'Brugge Station' };
  const AALTER = { code: '8714', lijn: '871', tekst: 'Aalter Europalaan' };

  beforeEach(() => {
    // Een technieker valt onder dezelfde toestel-gate als een chauffeur: met een
    // goedgekeurd toestel is een 403 hieronder een oordeel over zijn rol.
    mem.users.push({ id: '5', name: 'Toon Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true });
    mem.devices.push({ userId: '5', deviceToken: 'dev-ok', name: 'Windows-pc · browser', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    invalidateUsersCache();
  });

  it('GET geeft elke rol een lege lijst zolang er niets geïmporteerd is; zonder sessie 401', async () => {
    for (const token of ['tok-a', 'tok-tech', 'tok-planner', 'tok-admin']) {
      const res = await api('GET', '/api/filmnummers', { token });
      expect(res.status, token).toBe(200);
      expect(res.json).toEqual({ items: [], bijgewerktOp: null });
    }
    expect((await api('GET', '/api/filmnummers', { device: null })).status).toBe(401);
  });

  it('admin vervangt de lijst: opgeschoond, elke code één keer, oplopend op nummer, gelogd', async () => {
    const res = await api('PUT', '/api/filmnummers', {
      token: 'tok-admin',
      body: { items: [AALTER, { code: ' 5000 ', lijn: '50', tekst: '  Brugge   Station ' }, { code: '1', tekst: 'Geen dienst' }, { ...BRUGGE, tekst: 'Dubbel' }] },
    });
    expect(res.status).toBe(200);
    expect(res.json.items).toEqual([GEEN, BRUGGE, AALTER]);
    expect(Number.isNaN(Date.parse(res.json.bijgewerktOp))).toBe(false);
    expect(mem.appSettings.filmnummers).toEqual(res.json);
    expect(mem.activity.find((a: any) => a.action === 'Filmnummers bijgewerkt')).toMatchObject({ domain: 'planning', message: '3 filmnummers voor 2 lijnen.' });

    // Een chauffeur leest wat de admin bewaarde.
    expect((await api('GET', '/api/filmnummers', { token: 'tok-a' })).json.items).toEqual([GEEN, BRUGGE, AALTER]);

    // Een tweede import vervangt de hele lijst en noemt de vorige stand.
    const tweede = await api('PUT', '/api/filmnummers', { token: 'tok-admin', body: { items: [GEEN] } });
    expect(tweede.json.items).toEqual([GEEN]);
    expect(mem.activity.filter((a: any) => a.action === 'Filmnummers bijgewerkt').at(-1)?.message).toBe('1 filmnummer, de vorige lijst telde er 3.');
  });

  it('planner, chauffeur en technieker mogen niet schrijven (403)', async () => {
    for (const token of ['tok-planner', 'tok-a', 'tok-tech']) {
      // Lezen mag wel: de 403 komt van de rol, niet van het toestel.
      expect((await api('GET', '/api/filmnummers', { token })).status, token).toBe(200);
      expect((await api('PUT', '/api/filmnummers', { token, body: { items: [GEEN] } })).status, token).toBe(403);
    }
    expect(mem.appSettings.filmnummers).toBeUndefined();
  });

  it('ongeldige invoer geeft 400 met de rij erbij en bewaart niets, ook geen lege lijst', async () => {
    const letters = await api('PUT', '/api/filmnummers', { token: 'tok-admin', body: { items: [GEEN, { code: '58A', lijn: '50', tekst: 'Brugge' }] } });
    expect(letters.status).toBe(400);
    expect(letters.json.details).toBe('Rij 2 (Brugge): code: Een filmnummer bestaat uit 1 tot 6 cijfers');
    expect((await api('PUT', '/api/filmnummers', { token: 'tok-admin', body: { items: [] } })).status).toBe(400);
    expect((await api('PUT', '/api/filmnummers', { token: 'tok-admin', body: { items: [{ code: '5', lijn: '', tekst: '  ' }] } })).status).toBe(400);
    expect((await api('PUT', '/api/filmnummers', { token: 'tok-admin', body: [GEEN] })).status).toBe(400);
    expect((await api('PUT', '/api/filmnummers', { token: 'tok-admin', body: {} })).status).toBe(400);
    expect(mem.appSettings.filmnummers).toBeUndefined();
    expect(mem.activity.some((a: any) => a.action === 'Filmnummers bijgewerkt')).toBe(false);
  });

  it('een leesfout is een 500, geen lege lijst: het toestel houdt dan zijn kopie', async () => {
    mem.appSettings = new Proxy({}, { get() { throw new Error('database weg'); } });
    const res = await api('GET', '/api/filmnummers', { token: 'tok-a' });
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: 'De filmnummers konden niet laden.' });
  });

  it('een beschadigde waarde in de database leest als de geldige rijen, niet als fout', async () => {
    mem.appSettings.filmnummers = { items: [BRUGGE, { code: 'kapot' }, null], bijgewerktOp: 'onzin' };
    const res = await api('GET', '/api/filmnummers', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ items: [BRUGGE], bijgewerktOp: null });
  });

  it('staat er iets dat geen lijst met filmnummers is, dan is dat een leesfout en geen lege lijst; een nieuwe import herstelt het', async () => {
    // Een lege lijst zou op elk toestel de kopie wissen; de PUT bewaart er nooit een.
    for (const kapot of [[], 'tekst', 42, { items: 'nee' }, { items: [] }, { items: [{ code: 'kapot' }, null] }]) {
      mem.appSettings.filmnummers = kapot;
      const res = await api('GET', '/api/filmnummers', { token: 'tok-a' });
      expect(res.status, JSON.stringify(kapot)).toBe(500);
      expect(res.json).toEqual({ error: 'De filmnummers konden niet laden.' });
    }
    const herstel = await api('PUT', '/api/filmnummers', { token: 'tok-admin', body: { items: [GEEN, BRUGGE] } });
    expect(herstel.status).toBe(200);
    expect((await api('GET', '/api/filmnummers', { token: 'tok-a' })).json.items).toEqual([GEEN, BRUGGE]);
    // De vorige waarde was onleesbaar: het logboek noemt dan geen vorige stand.
    expect(mem.activity.filter((a: any) => a.action === 'Filmnummers bijgewerkt').at(-1)?.message).toBe('2 filmnummers voor 1 lijn.');
  });
});
describe('Loon: dagafsluiting en Easypay-export', () => {
  const LOON_CODE = (code: string, extra: Record<string, unknown> = {}) => ({
    code, code_weergave: code, omschrijving: `Dienst ${code}`, dienst_type: 'lijn', in_export: true,
    easypay_activiteit: 'LIJN', easypay_type_prest: 40140, tik1: '06:00', tik2: '14:00', bron: 'handmatig', ...extra,
  });
  const zetLoonBasis = () => {
    mem.appSettings['loon'] = { easypayLidnr: 4321 };
    // Alle codes uit de planningsmatrix van juli (12, 14, bv) zijn bekend,
    // zodat alleen het te testen punt de export kan blokkeren.
    mem.loonRijen.loon_codes = [LOON_CODE('12'), LOON_CODE('14'), LOON_CODE('bv', { in_export: false })];
    mem.loonRijen.loon_medewerkers = [
      { user_id: '3', easypay_nr: 100, in_export: true },
      { user_id: '4', easypay_nr: 101, in_export: true },
    ];
  };

  it('haalt een periode met meer dan 1000 prestaties volledig op (paginering voorbij de PostgREST-cap)', async () => {
    zetLoonBasis();
    // 1205 rijen op één dag: de mock-db kapt net als PostgREST op 1000 rijen
    // per antwoord, dus zonder paginering zou de maandtelling op 1000 blijven
    // steken.
    mem.loonRijen.dag_afsluitingen = [{ id: 'da-1', datum: '2026-07-02', status: 'afgesloten', geopend_op: '2026-08-01T06:00:00Z', geopend_door: '2', afgesloten_op: '2026-08-01T07:00:00Z', afgesloten_door: '2' }];
    mem.loonRijen.dag_prestaties = Array.from({ length: 1205 }, (_, i) => ({
      id: `p-${i + 1}`, datum: '2026-07-02', user_id: '3', volgnr: i + 1, planning_code: '9999', gereden_code: '9999',
      overmin: 1, overmin_nacht: 0, overmin_extra: 0, onv_premie: false,
    }));

    const maand = await api('GET', '/api/dagafsluiting?maand=2026-07', { token: 'tok-planner' });
    expect(maand.status).toBe(200);
    const dag = maand.json.dagen.find((d: any) => d.datum === '2026-07-02');
    expect(dag.rijen).toBe(1205);
    expect(dag.overmin).toBe(1205);
  });

  it('geeft ook boven de 1000 looncodes de volledige lijst terug', async () => {
    mem.loonRijen.loon_codes = Array.from({ length: 1150 }, (_, i) => LOON_CODE(`c${String(i).padStart(4, '0')}`));
    const res = await api('GET', '/api/loon/codes', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.length).toBe(1150);
  });

  it('blokkeert de export op een planningdag die nooit geopend is, tot die is afgesloten', async () => {
    // Deze test redeneert over de echte kalender (vandaag/gisteren), niet over de vaste juni-klok.
    vi.useRealTimers();
    zetLoonBasis();
    // De planningsmatrix (beforeEach) heeft inhoud op 01-07 en 08-07. Alleen
    // 01-07 wordt geopend en afgesloten; 08-07 blijft ongeopend en moet de
    // export blokkeren, ook al zijn alle geopende dagen netjes afgesloten.
    const open1 = await api('POST', '/api/dagafsluiting/2026-07-01/openen', { token: 'tok-planner' });
    expect(open1.status).toBe(201);
    const sluit1 = await api('POST', '/api/dagafsluiting/2026-07-01/afsluiten', { token: 'tok-planner' });
    expect(sluit1.status).toBe(200);

    const controle = await api('GET', '/api/loon/export/controle?maand=2026-07', { token: 'tok-planner' });
    expect(controle.status).toBe(200);
    expect(controle.json.openDagen).toEqual([]);
    expect(controle.json.issues).toEqual([]);
    expect(controle.json.nietGeopendeDagen).toEqual(['2026-07-08']);
    expect(controle.json.blokkerend).toBe(true);

    const geweigerd = await api('GET', '/api/loon/export?maand=2026-07', { token: 'tok-planner' });
    expect(geweigerd.status).toBe(409);
    expect(geweigerd.json.nietGeopendeDagen).toEqual(['2026-07-08']);

    // Na openen en afsluiten van 08-07 is de export vrij.
    expect((await api('POST', '/api/dagafsluiting/2026-07-08/openen', { token: 'tok-planner' })).status).toBe(201);
    expect((await api('POST', '/api/dagafsluiting/2026-07-08/afsluiten', { token: 'tok-planner' })).status).toBe(200);
    const na = await api('GET', '/api/loon/export/controle?maand=2026-07', { token: 'tok-planner' });
    expect(na.json.nietGeopendeDagen).toEqual([]);
    expect(na.json.blokkerend).toBe(false);
    const download = await api('GET', '/api/loon/export?maand=2026-07&format=json', { token: 'tok-planner' });
    expect(download.status).toBe(200);
    expect(download.json.rijen.length).toBeGreaterThan(0);
  });
});

describe('Dagadministratie: tot en met vandaag (Europe/Brussels), Jarno 23-09', () => {
  const FOUT = 'Dagadministratie kan enkel tot en met vandaag worden aangepast.';
  const zetNu = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
  afterEach(() => { vi.useRealTimers(); });

  it('verleden en vandaag openen en afsluiten; morgen geweigerd zonder iets te bewaren', async () => {
    zetNu('2026-09-23T10:00:00Z');
    expect((await api('POST', '/api/dagafsluiting/2026-07-01/openen', { token: 'tok-planner' })).status).toBe(201);
    expect((await api('POST', '/api/dagafsluiting/2026-07-01/afsluiten', { token: 'tok-planner' })).status).toBe(200);
    // Historische correctie: heropenen blijft kunnen.
    expect((await api('POST', '/api/dagafsluiting/2026-07-01/heropenen', { token: 'tok-planner', body: { reden: 'Overminuten vergeten' } })).status).toBe(200);
    expect((await api('POST', '/api/dagafsluiting/2026-09-23/openen', { token: 'tok-planner' })).status).toBe(201);

    const voor = mem.loonRijen.dag_afsluitingen.length;
    const morgen = await api('POST', '/api/dagafsluiting/2026-09-24/openen', { token: 'tok-planner' });
    expect(morgen.status).toBe(400);
    expect(morgen.json.error).toBe(FOUT);
    expect(mem.loonRijen.dag_afsluitingen.length).toBe(voor);
  });

  it('elke schrijfactie op een toekomstige dag wordt geweigerd, ook een directe request', async () => {
    zetNu('2026-09-23T10:00:00Z');
    const dag = '2026-10-01';
    const reacties = await Promise.all([
      api('PUT', `/api/dagafsluiting/${dag}/rijen/p1`, { token: 'tok-planner', body: { overmin: 30 } }),
      api('POST', `/api/dagafsluiting/${dag}/rijen`, { token: 'tok-planner', body: { userId: '3', geredenCode: '12' } }),
      api('DELETE', `/api/dagafsluiting/${dag}/rijen/p1`, { token: 'tok-planner' }),
      api('POST', `/api/dagafsluiting/${dag}/planning-overnemen`, { token: 'tok-planner' }),
      api('POST', `/api/dagafsluiting/${dag}/afsluiten`, { token: 'tok-planner' }),
      api('POST', `/api/dagafsluiting/${dag}/heropenen`, { token: 'tok-planner', body: { reden: 'x' } }),
    ]);
    for (const r of reacties) {
      expect(r.status).toBe(400);
      expect(r.json.error).toBe(FOUT);
    }
    // Lezen blijft kunnen.
    expect((await api('GET', `/api/dagafsluiting/${dag}`, { token: 'tok-planner' })).status).not.toBe(400);
  });

  it('de grens is de Brusselse kalenderdag, niet de UTC-dag', async () => {
    // 23/09 22:30 UTC = 24/09 00:30 in Brussel: 24/09 is "vandaag", 25/09 niet.
    zetNu('2026-09-23T22:30:00Z');
    expect((await api('POST', '/api/dagafsluiting/2026-09-24/openen', { token: 'tok-planner' })).status).toBe(201);
    expect((await api('POST', '/api/dagafsluiting/2026-09-25/openen', { token: 'tok-planner' })).status).toBe(400);
    // 23/09 21:30 UTC = 23/09 23:30 in Brussel: 24/09 is dan nog morgen.
    zetNu('2026-09-23T21:30:00Z');
    expect((await api('POST', '/api/dagafsluiting/2026-09-24/afsluiten', { token: 'tok-planner' })).status).toBe(400);
  });
});

describe('rapporten (GET /api/rapporten/:id)', () => {
  it('zonder sessie 401; chauffeur en technieker 403', async () => {
    mem.users.push({ id: '5', name: 'Tom Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true });
    expect((await api('GET', '/api/rapporten/verlofsaldo?jaar=2026')).status).toBe(401);
    expect((await api('GET', '/api/rapporten/verlofsaldo?jaar=2026', { token: 'tok-a' })).status).toBe(403);
    expect((await api('GET', '/api/rapporten/verlofsaldo?jaar=2026', { token: 'tok-tech' })).status).toBe(403);
  });

  it('een onbekend rapport is 404, ook voor een admin', async () => {
    const res = await api('GET', '/api/rapporten/bestaat-niet?jaar=2026', { token: 'tok-admin' });
    expect(res.status).toBe(404);
    expect(res.json.error).toBe('Dit rapport bestaat niet.');
  });

  it('ongeldige filters: 400 met de fout bij het veld', async () => {
    for (const q of ['', '?jaar=abc', '?jaar=1850', '?jaar=2025&jaar=2026']) {
      const res = await api('GET', `/api/rapporten/verlofsaldo${q}`, { token: 'tok-planner' });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('Ongeldige invoer');
      expect(res.json.veldfouten).toEqual({ jaar: 'Kies een jaar' });
    }
  });

  it('planner en admin: rijen, totalen, bereik en tijdstip', async () => {
    const res = await api('GET', '/api/rapporten/verlofsaldo?jaar=2026', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Chauffeur A: 3 dagen goedgekeurd (10-12/08) en 3 aangevraagd (01-03/07);
    // chauffeur B: alleen een wachtend klein verlet, dat telt pas na goedkeuring.
    expect(res.json.rijen).toEqual([
      { id: '3', naam: 'Chauffeur A', sectie: null, budget: 24, opgenomen: 3, aangevraagd: 3, vrij: 18, kleinVerlet: 0 },
      { id: '4', naam: 'Chauffeur B', sectie: null, budget: 24, opgenomen: 0, aangevraagd: 0, vrij: 24, kleinVerlet: 0 },
    ]);
    expect(res.json.totalen).toEqual({ budget: 48, opgenomen: 3, aangevraagd: 3, vrij: 42, kleinVerlet: 0 });
    expect(res.json.bereik).toEqual({ van: '2026-07-01', tot: '2026-08-12' });
    expect(Number.isNaN(Date.parse(res.json.gegenereerdOp))).toBe(false);
    expect((await api('GET', '/api/rapporten/verlofsaldo?jaar=2026', { token: 'tok-admin' })).status).toBe(200);
  });

  it('medewerkerfilter en de extra vrije dag van de beheerder werken door', async () => {
    mem.appSettings.verlof_feestdagen = { extra: [{ id: 'x1', datum: '2026-08-11', naam: 'Brugdag' }] };
    const res = await api('GET', '/api/rapporten/verlofsaldo?jaar=2026&chauffeur=3', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.rijen).toEqual([
      { id: '3', naam: 'Chauffeur A', sectie: null, budget: 24, opgenomen: 2, aangevraagd: 3, vrij: 19, kleinVerlet: 0 },
    ]);
    expect(res.json.totalen.opgenomen).toBe(2);
  });

  it('een verwijderde gebruiker blijft staan als "Onbekend (<id>)"', async () => {
    const res = await api('GET', '/api/rapporten/verlofsaldo?jaar=2026&chauffeur=999', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.rijen.map((r: any) => r.naam)).toEqual(['Onbekend (999)']);
  });
});
