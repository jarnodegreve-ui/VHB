// @vitest-environment node
import {
  api,
  invalidateUsersCache,
  mem,
} from './harnas';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('authenticatie & rollen', () => {
  // Sessie-identiteit = Auth-uid (controle-ronde 05-09, security 7): de
  // eerste aanmelding koppelt het profiel; daarna telt het e-mailadres niet
  // meer, zodat een gewijzigd Auth-e-mailadres niemand in andermans profiel brengt.
  it('koppelt bij de eerste aanmelding de Auth-uid aan het profiel', async () => {
    const res = await api('GET', '/api/users', { headers: { Authorization: 'Bearer tok-a' } });
    expect(res.status).toBe(200);
    expect(mem.users.find((u: any) => u.id === '3')?.authId).toBe('auth-tok-a');
    // …en de uid gaat niet naar de client.
    expect(res.json.some((u: any) => 'authId' in u && u.authId !== undefined)).toBe(false);
  });

  it('weigert een token met het e-mailadres van een profiel dat aan een ándere uid gekoppeld is', async () => {
    const chauffeurA = mem.users.find((u: any) => u.id === '3');
    chauffeurA.authId = 'auth-iemand-anders';
    invalidateUsersCache();
    const res = await api('GET', '/api/users', { headers: { Authorization: 'Bearer tok-a' } });
    expect(res.status).toBe(403);
    expect(res.json.error).toContain('andere aanmelding');
    // Het profiel blijft ongewijzigd (geen stille herkoppeling).
    expect(chauffeurA.authId).toBe('auth-iemand-anders');
  });

  it('vindt een gekoppeld profiel op uid, ook als het e-mailadres in Auth intussen anders is', async () => {
    const chauffeurA = mem.users.find((u: any) => u.id === '3');
    chauffeurA.authId = 'auth-tok-a';
    chauffeurA.email = 'nieuw-adres@vhb.be'; // profiel-mail wijkt af van het token-mail
    invalidateUsersCache();
    const res = await api('GET', '/api/users', { headers: { Authorization: 'Bearer tok-a' } });
    expect(res.status).toBe(200);
  });

  it('weigert requests zonder token (401)', async () => {
    const res = await api('GET', '/api/leave');
    expect(res.status).toBe(401);
  });

  it('weigert een ongeldig token (401)', async () => {
    const res = await api('GET', '/api/leave', { token: 'tok-nep' });
    expect(res.status).toBe(401);
  });

  // 23-09: het dienstoverzicht lezen is alleen voor planner en admin (het
  // leesrecht voor elke rol was een overblijfsel, zie communicatieRoutes).
  it('dienstoverzicht lezen: niet ingelogd 401, chauffeur 403, planner en admin 200', async () => {
    const zonder = await api('GET', '/api/services', {});
    expect(zonder.status).toBe(401);
    const chauffeur = await api('GET', '/api/services', { token: 'tok-a' });
    expect(chauffeur.status).toBe(403);
    expect(chauffeur.json).not.toEqual(mem.services);
    for (const token of ['tok-planner', 'tok-admin']) {
      const staf = await api('GET', '/api/services', { token });
      expect(staf.status).toBe(200);
      expect(staf.json).toEqual(mem.services.map((s: any) => expect.objectContaining({ id: s.id, serviceNumber: s.serviceNumber })));
    }
  });

  it('laat een chauffeur het dienstoverzicht niet schrijven', async () => {
    const write = await api('POST', '/api/services', { token: 'tok-a', body: mem.services });
    expect(write.status).toBe(403);
  });

  // 3D (23-09): het samengevoegde Dienstoverzicht is alleen voor planner en
  // admin; de serverregels blijven de echte grens, ook voor de acties die
  // de UI aan een chauffeur of technieker nooit toont.
  it('dienstoverzicht: chauffeur ziet geen wijzigingsgeschiedenis en mag ook met de importvlag niet schrijven', async () => {
    const geschiedenis = await api('GET', '/api/activity/service/1', { token: 'tok-a' });
    expect(geschiedenis.status).toBe(403);
    const bulk = await api('POST', '/api/services', { token: 'tok-a', body: [], headers: { 'x-bulk-replace': '1' } });
    expect(bulk.status).toBe(403);
    expect(mem.services.length).toBeGreaterThan(0);
  });

  it('dienstoverzicht: technieker mag niet lezen, niet schrijven, niet importeren en ziet geen geschiedenis', async () => {
    mem.users.push({ id: '5', name: 'Toon Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true });
    mem.devices.push({ userId: '5', deviceToken: 'dev-ok', name: 'Windows-pc · browser', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    invalidateUsersCache();
    const voor = JSON.stringify(mem.services);
    const lezen = await api('GET', '/api/services', { token: 'tok-tech' });
    expect(lezen.status).toBe(403);
    const write = await api('POST', '/api/services', { token: 'tok-tech', body: mem.services });
    expect(write.status).toBe(403);
    const bulk = await api('POST', '/api/services', { token: 'tok-tech', body: [], headers: { 'x-bulk-replace': '1' } });
    expect(bulk.status).toBe(403);
    const geschiedenis = await api('GET', '/api/activity/service/1', { token: 'tok-tech' });
    expect(geschiedenis.status).toBe(403);
    expect(JSON.stringify(mem.services)).toBe(voor);
  });

  it('weigert een chauffeur op POST /api/planning (403)', async () => {
    const res = await api('POST', '/api/planning', { token: 'tok-a', body: mem.planning });
    expect(res.status).toBe(403);
  });
});

describe('PII-scoping voor chauffeurs', () => {
  it('GET /api/leave geeft een chauffeur alleen eigen verlof', async () => {
    const res = await api('GET', '/api/leave', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.map((l: any) => l.id).sort()).toEqual(['l-a1', 'l-a2']);
  });

  it('GET /api/leave geeft planner alles', async () => {
    const res = await api('GET', '/api/leave', { token: 'tok-planner' });
    expect(res.json).toHaveLength(3);
  });

  it('GET /api/leave en /api/swaps filteren voor niet-staf in de query, staf leest ongefilterd', async () => {
    await api('GET', '/api/leave', { token: 'tok-a' });
    await api('GET', '/api/swaps', { token: 'tok-a' });
    expect(mem.leaveFilters).toEqual([{ userId: '3' }]);
    expect(mem.swapFilters).toEqual([{ betrokkenUserId: '3' }]);
    mem.leaveFilters = []; mem.swapFilters = [];
    await api('GET', '/api/leave', { token: 'tok-planner' });
    await api('GET', '/api/swaps', { token: 'tok-planner' });
    expect(mem.leaveFilters).toEqual([null]);
    expect(mem.swapFilters).toEqual([null]);
  });

  it('GET /api/swaps: ook als aangezochte collega (niet alleen als aanvrager)', async () => {
    const res = await api('GET', '/api/swaps', { token: 'tok-b' });
    // s-1: B is de collega; s-2: B is de aanvrager.
    expect(res.json.map((s: any) => s.id).sort()).toEqual(['s-1', 's-2']);
  });

  // GET /api/leave hierboven geeft een chauffeur bewust enkel eigen verlof;
  // de kalenderkleuring en de limietwaarschuwing rekenen daarom op dit
  // bezetting-endpoint: uitsluitend datum + aantal + limiet, geen personen.
  describe('GET /api/leave/bezetting', () => {
    it('geeft een chauffeur per dag correcte aantallen, zonder namen of persoonsvelden', async () => {
      // Seed: enkel l-a2 (chauffeur 3, goedgekeurd, 10 t/m 12 aug) telt;
      // l-a1 en l-b1 zijn pending en vallen buiten deze periode.
      const res = await api('GET', '/api/leave/bezetting?van=2026-08-09&tot=2026-08-13', { token: 'tok-a' });
      expect(res.status).toBe(200);
      expect(res.json.dagen).toEqual([
        { datum: '2026-08-09', aantal: 0, limiet: 2 },
        { datum: '2026-08-10', aantal: 1, limiet: 2 },
        { datum: '2026-08-11', aantal: 1, limiet: 2 },
        { datum: '2026-08-12', aantal: 1, limiet: 2 },
        { datum: '2026-08-13', aantal: 0, limiet: 2 },
      ]);
      const plat = JSON.stringify(res.json);
      expect(plat).not.toContain('Chauffeur');
      expect(plat).not.toContain('userId');
      expect(plat).not.toContain('betaald_verlof');
    });

    it('telt met de plannerregels: pending, ziekte, technieker en flexi tellen niet mee', async () => {
      mem.users.push(
        { id: '5', name: 'Toon Technieker', email: 'toon@vhb.be', role: 'technieker', isActive: true },
        { id: '6', name: 'Fien Flexi', email: 'fien@vhb.be', role: 'chauffeur', section: 'Flexi', isActive: true },
      );
      invalidateUsersCache();
      mem.leave.push(
        // Telt wél mee: tweede chauffeur, goedgekeurd betaald verlof.
        { id: 'l-x1', userId: '4', startDate: '2026-08-10', endDate: '2026-08-10', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-06-01T08:00:00Z' },
        // Telt niet mee: pending, ziekte, technieker, flexi.
        { id: 'l-x2', userId: '4', startDate: '2026-08-10', endDate: '2026-08-10', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-06-01T08:00:00Z' },
        { id: 'l-x3', userId: '3', startDate: '2026-08-10', endDate: '2026-08-10', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-06-01T08:00:00Z' },
        { id: 'l-x4', userId: '5', startDate: '2026-08-10', endDate: '2026-08-10', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-06-01T08:00:00Z' },
        { id: 'l-x5', userId: '6', startDate: '2026-08-10', endDate: '2026-08-10', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-06-01T08:00:00Z' },
      );
      const res = await api('GET', '/api/leave/bezetting?van=2026-08-10&tot=2026-08-10', { token: 'tok-a' });
      expect(res.status).toBe(200);
      // Chauffeur 3 (l-a2) + chauffeur 4 (l-x1), de rest valt af.
      expect(res.json.dagen).toEqual([{ datum: '2026-08-10', aantal: 2, limiet: 2 }]);
    });

    it('gebruikt de ingestelde verloflimiet per dag', async () => {
      mem.appSettings['verlof_limieten'] = { standaard: 3, periodes: [{ id: 'p-zomer', naam: 'Zomer', van: '2026-08-11', tot: '2026-08-12', max: 5 }] };
      const res = await api('GET', '/api/leave/bezetting?van=2026-08-10&tot=2026-08-11', { token: 'tok-a' });
      expect(res.status).toBe(200);
      expect(res.json.dagen.map((d: any) => d.limiet)).toEqual([3, 5]);
    });

    it('weigert een ongeldige of te lange periode (400)', async () => {
      expect((await api('GET', '/api/leave/bezetting?van=2026-02-31&tot=2026-03-02', { token: 'tok-a' })).status).toBe(400);
      expect((await api('GET', '/api/leave/bezetting?van=2026-03-02&tot=2026-03-01', { token: 'tok-a' })).status).toBe(400);
      expect((await api('GET', '/api/leave/bezetting?van=2026-01-01&tot=2027-06-01', { token: 'tok-a' })).status).toBe(400);
      expect((await api('GET', '/api/leave/bezetting?van=2026-01-01', { token: 'tok-a' })).status).toBe(400);
    });
  });

  it('een chauffeur kan zichzelf NIET ziek melden (403, enkel planner/admin)', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-a', body: { userId: '3', startDate: '2026-09-01' } });
    expect(res.status).toBe(403);
    expect(mem.leave.some((l: any) => l.type === 'ziekte')).toBe(false);
  });

  it('een planner registreert een ziekmelding: direct goedgekeurd ziekte-verlof + push/mail', async () => {
    // Diensten in de ziekteperiode: één gesplitste dienst op 02/09 (twee
    // planning-rijen, zelfde nummer) en een gewone op 03/09 — de mail hoort
    // ze per dag gededupliceerd op te sommen.
    mem.planning.push(
      { id: 'zk-1', driverId: '4', date: '2026-09-02', line: '4407' },
      { id: 'zk-2', driverId: '4', date: '2026-09-02', line: '4407' },
      { id: 'zk-3', driverId: '4', date: '2026-09-03', line: '4408' },
      { id: 'zk-4', driverId: '3', date: '2026-09-02', line: '4409' }, // collega, hoort er níét in
    );
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-02', endDate: '2026-09-03' } });
    expect(res.status).toBe(200);
    expect(res.json.leave).toMatchObject({ userId: '4', type: 'ziekte', status: 'approved', startDate: '2026-09-02', endDate: '2026-09-03' });
    const stored = mem.leave.find((l: any) => l.type === 'ziekte');
    expect(stored?.status).toBe('approved');
    // Push naar de rest van de planning (behalve de melder = planner, id 2)…
    const sickPush = mem.pushesSent.find((p) => p.payload.title === 'Ziekmelding');
    expect(sickPush?.userIds).toEqual(['1']);
    // …maar de mail gaat alleen naar de admins (Jarno 06-10; tot dan alle
    // planner/admin-adressen, verzoek 04-08), PER PERSOON een eigen mail,
    // rechtstreeks in de To-regel. De eerdere BCC-batch werd door Microsoft
    // 365 stilletjes weggefilterd terwijl de directe testmail wél aankwam.
    const sickMails = mem.emailsSent.filter((m) => (m.context ?? '').startsWith('sick:'));
    expect(sickMails.map((m) => m.to)).toEqual([['admin@vhb.be']]);
    // De opengevallen diensten staan in de mail: per dag het nummer, de
    // gesplitste dienst één keer, de dienst van de collega niet.
    const body = sickMails[0]?.text ?? '';
    expect(body).toContain('Openstaande dienst(en)');
    // De toelichting (medisch) gaat bewust niet mee in de mail (mailtranche 25-09).
    expect(body).not.toContain('Toelichting');
    expect(body).toMatch(/wo 2 sep.*, 4407/);
    expect(body).toMatch(/do 3 sep.*, 4408/);
    expect(body).not.toContain('4407 / 4407');
    expect(body).not.toContain('4409');
  });

  it('ziekmelding zonder diensten in de periode zegt dat expliciet in de mail', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-10-05' } });
    expect(res.status).toBe(200);
    const mail = mem.emailsSent.find((m) => (m.context ?? '').startsWith('sick:'));
    expect(mail?.text).toContain('Geen ingeplande diensten in deze periode.');
  });

  it('ziekmelding zonder chauffeur wordt geweigerd (400)', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { startDate: '2026-09-02' } });
    expect(res.status).toBe(400);
  });

  it('ziekmelding over drie maanden somt ook de middelste maand op in de mail', async () => {
    mem.planning.push(
      { id: 'mnd-1', driverId: '4', date: '2026-09-25', line: '4401' },
      { id: 'mnd-2', driverId: '4', date: '2026-10-10', line: '4402' }, // middelste maand
      { id: 'mnd-3', driverId: '4', date: '2026-11-03', line: '4403' },
    );
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-20', endDate: '2026-11-05' } });
    expect(res.status).toBe(200);
    const body = mem.emailsSent.find((m) => (m.context ?? '').startsWith('sick:'))?.text ?? '';
    expect(body).toContain('4401');
    expect(body).toContain('4402');
    expect(body).toContain('4403');
  });

  it('ziekmelding weigert onbestaande kalenderdatums en absurde periodes', async () => {
    const kapot = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-02-31' } });
    expect(kapot.status).toBe(400);
    const eeuwig = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-01', endDate: '9999-12-31' } });
    expect(eeuwig.status).toBe(400);
    expect(mem.leave.some((l: any) => l.type === 'ziekte')).toBe(false);
  });

  it('ziekmelding weigert een tweede melding over een overlappende periode (409)', async () => {
    const eerste = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-02', endDate: '2026-09-05' } });
    expect(eerste.status).toBe(200);
    const tweede = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-04', endDate: '2026-09-08' } });
    expect(tweede.status).toBe(409);
    expect(mem.leave.filter((l: any) => l.type === 'ziekte').length).toBe(1);
  });

  it('ziekmelding kan alleen voor een actieve chauffeur (niet voor een admin)', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '1', startDate: '2026-09-02' } });
    expect(res.status).toBe(400);
    expect(mem.leave.some((l: any) => l.type === 'ziekte')).toBe(false);
  });

  it('ziekmelding herschrijft niet de hele verloftabel (raakt bestaande rijen niet aan)', async () => {
    // Simuleer de race: een collega-beslissing die ná onze snapshot zou
    // vallen. Omdat sick-report alleen zijn eigen record schrijft, blijft
    // elke andere rij exact zoals hij was.
    const voor = JSON.stringify(mem.leave);
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-02' } });
    expect(res.status).toBe(200);
    const na = mem.leave.filter((l: any) => l.type !== 'ziekte');
    expect(JSON.stringify(na)).toBe(voor);
  });

  it('een dienst doorgeven aan een ziek gemelde collega wordt geweigerd (409)', async () => {
    // Chauffeur B ('4') staat in de matrix op bv voor 2026-07-08 (overname
    // normaal toegestaan), maar is intussen via de verlofmodule ziek gemeld.
    mem.leave.push({ id: 'l-zkr', userId: '4', startDate: '2026-07-08', endDate: '2026-07-08', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-07T06:00:00Z', decidedAt: '2026-07-07T06:00:00Z' });
    const eigen = mem.swaps.filter((sw: any) => sw.requesterId === '3' || sw.targetDriverId === '3');
    const nieuw = { id: 's-ziek', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-07-01T08:00:00Z', swapType: 'overname' };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...eigen, nieuw] });
    expect(res.status).toBe(409);
    expect(String(res.json.error)).toContain('ziek');
    expect(mem.swaps.find((sw: any) => sw.id === 's-ziek')).toBeUndefined();
  });

  it('GET /api/swaps geeft een chauffeur alleen ruilen waar die bij betrokken is', async () => {
    const res = await api('GET', '/api/swaps', { token: 'tok-a' });
    expect(res.json.map((s: any) => s.id)).toEqual(['s-1']);
  });

  describe('verloop per persoon (GET /api/swaps › verloop)', () => {
    // Logregels zoals de routes ze schrijven: s-1 (A → B) geweigerd door de
    // planner, s-2 (B → planner) is de ruil van iemand anders.
    const logRegel = (entityId: string, action: string, actorName: string, actorRole: string, message: string, gelogdOp: string) =>
      ({ domain: 'swaps', action, message, entityType: 'swap', entityId, actorName, actorRole, gelogdOp });
    beforeEach(() => {
      mem.swaps = mem.swaps.map((s: any) => (s.id === 's-1' ? { ...s, status: 'rejected', decidedAt: '2026-06-02T10:00:00Z' } : s));
      mem.activity = [
        logRegel('s-1', 'Dienstruil aangevraagd', 'Chauffeur A', 'chauffeur', 'Chauffeur A bood een dienst aan voor ruil.', '2026-06-01T08:00:02Z'),
        logRegel('s-1', 'Dienstruil geaccepteerd', 'Chauffeur B', 'chauffeur', 'Chauffeur A, dienstruil (pending → accepted).', '2026-06-01T12:00:00Z'),
        logRegel('s-1', 'Dienstruil afgewezen', 'Pieter Planner', 'planner', 'Chauffeur A, dienstruil (accepted → rejected).', '2026-06-02T10:00:00Z'),
        logRegel('s-2', 'Dienstruil aangevraagd', 'Chauffeur B', 'chauffeur', 'Chauffeur B bood een dienst aan voor ruil.', '2026-06-01T09:00:02Z'),
      ];
    });

    it('chauffeur: alleen het verloop van zijn eigen ruilen, zonder de naam van de planner', async () => {
      const res = await api('GET', '/api/swaps', { token: 'tok-a' });
      expect(res.status).toBe(200);
      expect(res.json.map((s: any) => s.id)).toEqual(['s-1']);
      expect(res.json[0].verloop).toEqual([
        { soort: 'aangevraagd', op: '2026-06-01T08:00:02Z', door: 'aanvrager' },
        { soort: 'geaccepteerd', op: '2026-06-01T12:00:00Z', door: 'collega', van: 'pending' },
        { soort: 'geweigerd', op: '2026-06-02T10:00:00Z', door: 'planner', van: 'accepted' },
      ]);
      // De logquery vroeg alleen de eigen ruil op, niet die van een ander.
      expect(mem.verloopFilters).toEqual([['s-1']]);
      // Geen stafnaam, geen vrije logtekst, niets van s-2.
      const tekst = JSON.stringify(res.json);
      expect(tekst).not.toContain('Pieter Planner');
      expect(tekst).not.toContain('bood een dienst aan');
      expect(tekst).not.toContain('s-2');
    });

    it('handmatige wissel: de chauffeur leest "door de planner", staf houdt de naam (Jarno 21-09)', async () => {
      const reden = 'Handmatige wissel door Jarno De Greve, Ziekte, vervanging';
      mem.swaps = mem.swaps.map((s: any) => (s.id === 's-1' ? { ...s, status: 'approved', reason: reden } : s));
      for (const token of ['tok-a', 'tok-b']) {
        const res = await api('GET', '/api/swaps', { token });
        const eigen = res.json.find((s: any) => s.id === 's-1');
        // Het voorvoegsel blijft, zodat de client de wissel als handmatig herkent.
        expect(eigen.reason).toBe('Handmatige wissel door de planner, Ziekte, vervanging');
        expect(JSON.stringify(res.json)).not.toContain('Jarno De Greve');
      }
      const staf = await api('GET', '/api/swaps', { token: 'tok-planner' });
      expect(staf.json.find((s: any) => s.id === 's-1').reason).toBe(reden);
      // De opslag is niet aangeraakt: de attributie blijft voor staf en het weekblad.
      expect(mem.swaps.find((s: any) => s.id === 's-1').reason).toBe(reden);
    });

    it('de aangezochte collega ziet hetzelfde verloop, ook zonder stafnaam', async () => {
      const res = await api('GET', '/api/swaps', { token: 'tok-b' });
      const eigen = res.json.find((s: any) => s.id === 's-1');
      expect(eigen.verloop.map((st: any) => st.door)).toEqual(['aanvrager', 'collega', 'planner']);
      expect(JSON.stringify(res.json)).not.toContain('Pieter Planner');
      expect([...mem.verloopFilters[0]!].sort()).toEqual(['s-1', 's-2']);
    });

    it('staf: elk verloop in één logquery, mét wie besliste', async () => {
      const res = await api('GET', '/api/swaps', { token: 'tok-planner' });
      expect(mem.verloopFilters).toEqual([null]);
      const s1 = res.json.find((s: any) => s.id === 's-1');
      expect(s1.verloop.at(-1)).toEqual({ soort: 'geweigerd', op: '2026-06-02T10:00:00Z', door: 'planner', van: 'accepted', naam: 'Pieter Planner' });
      expect(res.json.find((s: any) => s.id === 's-2').verloop).toHaveLength(1);
    });

    it('de collectie-revisie rekent het verloop niet mee: een array-save na de GET geeft geen vals 409', async () => {
      const get = await api('GET', '/api/swaps', { token: 'tok-admin' });
      const revisie = get.headers.get('x-collection-revision');
      expect(revisie).toBeTruthy();
      // De client stuurt de records terug zoals hij ze kreeg, verloop incluis.
      const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: get.json, headers: { 'x-collection-revision': revisie! } });
      expect(res.status).toBe(200);
      expect(mem.swaps.every((s: any) => !('verloop' in s))).toBe(true);
      // Idem voor een chauffeur: zijn gescopede lijst mét verloop terugsturen
      // (zo werkt intrekken en aanvragen) is geen poging tot sjoemelen.
      const eigen = await api('GET', '/api/swaps', { token: 'tok-b' });
      const terug = await api('POST', '/api/swaps', { token: 'tok-b', body: eigen.json });
      expect(terug.status).toBe(200);
      expect(mem.swaps.map((s: any) => s.id).sort()).toEqual(['s-1', 's-2']);
    });

    it('een mislukte logquery breekt de ruilen niet: ze komen zonder verloop terug', async () => {
      mem.verloopFaalt = true;
      const res = await api('GET', '/api/swaps', { token: 'tok-a' });
      expect(res.status).toBe(200);
      expect(res.json.map((s: any) => s.id)).toEqual(['s-1']);
      expect(res.json[0].verloop).toBeUndefined();
    });

    it('PATCH geeft het bijgewerkte verloop mee, en wie weigerde volgt uit de rol van de actor', async () => {
      mem.swaps = mem.swaps.map((s: any) => (s.id === 's-1' ? { ...s, status: 'pending', decidedAt: undefined } : s));
      mem.activity = mem.activity.filter((a: any) => a.action === 'Dienstruil aangevraagd');
      const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'rejected', ifStatus: 'pending' } });
      expect(res.status).toBe(200);
      const stap = res.json.swap.verloop.at(-1);
      expect(stap).toMatchObject({ soort: 'geweigerd', door: 'collega', van: 'pending' });
      expect(stap.naam).toBeUndefined();
    });
  });

  // Beveiligingsscan 01-10: het id van een ruil kiest de aanvrager zelf, en
  // RECORD_ID_RE laat ook namen toe die elk gewoon object al kent. Bij zo'n
  // id gaf `perSwap[id]` een functie terug in plaats van "geen regels": het
  // verloop van álle ruilen viel weg (de fout werd gevangen en de lijst kwam
  // zonder verloop terug). De groepering in de opslag zelf: src/storageRuilVerloop.test.ts.
  describe('een ruil-id dat een objectnaam is (constructor, toString, __proto__)', () => {
    const logRegel = (entityId: string, action: string, actorName: string, actorRole: string, message: string, gelogdOp: string) =>
      ({ domain: 'swaps', action, message, entityType: 'swap', entityId, actorName, actorRole, gelogdOp });
    const vreemd = (id: string) => ({ id, shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-06-10T08:00:00Z', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' });
    beforeEach(() => {
      mem.activity = [
        logRegel('s-1', 'Dienstruil aangevraagd', 'Chauffeur A', 'chauffeur', 'Chauffeur A bood een dienst aan voor ruil.', '2026-06-01T08:00:02Z'),
        logRegel('s-2', 'Dienstruil aangevraagd', 'Chauffeur B', 'chauffeur', 'Chauffeur B bood een dienst aan voor ruil.', '2026-06-01T09:00:02Z'),
      ];
    });

    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])('%s zonder logregels: staf en chauffeur houden het verloop van de andere ruilen', async (id) => {
      mem.swaps = [...mem.swaps, vreemd(id)];
      const staf = await api('GET', '/api/swaps', { token: 'tok-planner' });
      expect(staf.status).toBe(200);
      expect(staf.json.find((s: any) => s.id === 's-1').verloop).toEqual([{ soort: 'aangevraagd', op: '2026-06-01T08:00:02Z', door: 'aanvrager' }]);
      expect(staf.json.find((s: any) => s.id === 's-2').verloop).toHaveLength(1);
      expect(staf.json.find((s: any) => s.id === id).verloop).toEqual([]);
      const chauffeur = await api('GET', '/api/swaps', { token: 'tok-a' });
      expect(chauffeur.status).toBe(200);
      expect(chauffeur.json.find((s: any) => s.id === 's-1').verloop).toHaveLength(1);
      expect(chauffeur.json.find((s: any) => s.id === id).verloop).toEqual([]);
    });

    it.each(['constructor', 'toString', '__proto__'])('%s: de collega kan de aanvraag als bekeken melden (geen 500)', async (id) => {
      mem.swaps = [...mem.swaps, vreemd(id)];
      const res = await api('POST', `/api/swaps/${id}/bekeken`, { token: 'tok-b' });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ success: true, nieuw: true });
      expect(mem.activity.filter((a: any) => a.action === 'Dienstruil bekeken' && a.entityId === id)).toHaveLength(1);
    });
  });
});

describe('eigen toestellen en sessies (/api/me/toestellen)', () => {
  it('toont alleen eigen toestellen, met afgeleide id, platform en "dit toestel"', async () => {
    mem.devices.push({ userId: '3', deviceToken: 'dev-oud', name: 'Mac · browser', status: 'approved', createdAt: '2026-06-01T00:00:00Z', lastSeenAt: '2026-06-02T00:00:00Z', approvedAt: '2026-06-01T00:00:00Z', approvedBy: 'auto' });
    const res = await api('GET', '/api/me/toestellen', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.beschikbaar).toBe(true);
    expect(res.json.toestellen).toHaveLength(2);
    const [dit, ander] = res.json.toestellen;
    expect(dit.ditToestel).toBe(true);
    expect(dit).toMatchObject({ naam: 'iPhone · app', platform: 'iPhone', kanaal: 'app', status: 'approved' });
    expect(ander).toMatchObject({ naam: 'Mac · browser', platform: 'Mac', kanaal: 'browser', ditToestel: false });
    // Het toestel-token zelf lekt niet; de id is een hash.
    expect(JSON.stringify(res.json)).not.toContain('dev-ok');
    expect(ander.id).toMatch(/^[0-9a-f]{16}$/);
    // Chauffeur B ziet zijn eigen toestel, niet dat van A.
    const b = await api('GET', '/api/me/toestellen', { token: 'tok-b' });
    expect(b.json.toestellen.map((t: any) => t.naam)).toEqual(['Android · app']);
  });

  it('trekt één eigen toestel in, maar niet het huidige zonder ?ook-dit=1', async () => {
    mem.devices.push({ userId: '3', deviceToken: 'dev-oud', name: 'Mac · browser', status: 'approved', createdAt: '2026-06-01T00:00:00Z', lastSeenAt: '2026-06-02T00:00:00Z', approvedAt: '2026-06-01T00:00:00Z', approvedBy: 'auto' });
    const lijst = (await api('GET', '/api/me/toestellen', { token: 'tok-a' })).json.toestellen;
    const dit = lijst.find((t: any) => t.ditToestel);
    const ander = lijst.find((t: any) => !t.ditToestel);
    const geweigerd = await api('POST', `/api/me/toestellen/${dit.id}/uitloggen`, { token: 'tok-a' });
    expect(geweigerd.status).toBe(400);
    expect(geweigerd.json.code).toBe('huidig_toestel');
    expect((await api('POST', `/api/me/toestellen/${ander.id}/uitloggen`, { token: 'tok-a' })).status).toBe(200);
    // Zelf uitloggen = rij weg (opnieuw aanmelden kan), geen blokkade meer.
    expect(mem.devices.find((d: any) => d.deviceToken === 'dev-oud')).toBeUndefined();
    // Andermans toestel is onvindbaar (404), ook met een geldig id.
    expect((await api('POST', `/api/me/toestellen/${ander.id}/uitloggen`, { token: 'tok-b' })).status).toBe(404);
    // Met ?ook-dit=1 mag het huidige wél.
    expect((await api('POST', `/api/me/toestellen/${dit.id}/uitloggen?ook-dit=1`, { token: 'tok-a' })).status).toBe(200);
    expect(mem.devices.find((d: any) => d.userId === '3' && d.deviceToken === 'dev-ok')).toBeUndefined();
  });

  it('een zelf uitgelogd toestel kan zich daarna gewoon opnieuw aanmelden', async () => {
    mem.devices.push({ userId: '3', deviceToken: 'dev-oud', name: 'Mac · browser', status: 'approved', createdAt: '2026-06-01T00:00:00Z', lastSeenAt: '2026-06-02T00:00:00Z', approvedAt: '2026-06-01T00:00:00Z', approvedBy: 'auto' });
    const lijst = (await api('GET', '/api/me/toestellen', { token: 'tok-a' })).json.toestellen;
    const ander = lijst.find((t: any) => !t.ditToestel);
    expect((await api('POST', `/api/me/toestellen/${ander.id}/uitloggen`, { token: 'tok-a' })).status).toBe(200);
    const her = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-oud', body: { name: 'Mac · browser' } });
    expect(her.status).toBe(200);
    // Geen blokkade: het toestel bestaat weer (status volgens de gate-regels).
    expect(mem.devices.find((d: any) => d.deviceToken === 'dev-oud')?.status).not.toBe('revoked');
  });

  // Controle-ronde 09-09, nr. 2: de gate herkende een toestel alleen aan de
  // X-Device-Token-header. Wie die wegliet, viel voor staf volledig buiten de
  // gate en werd voor chauffeurs een "onbekend" i.p.v. een ingetrokken
  // toestel. De sessie uit het JWT is niet weg te laten, dus daar hangt de
  // intrekking nu aan.
  describe('intrekking hangt aan de auth-sessie, niet aan de header', () => {
    const jwt = (email: string, sub: string, sessie: string) =>
      `x.${Buffer.from(JSON.stringify({ sub, email, session_id: sessie })).toString('base64')}.y`;

    it('blokkeert een ingetrokken staf-toestel dat de header weglaat', async () => {
      const token = jwt('planner@vhb.be', 'auth-tok-planner', 'sess-planner');
      // Aanmelden legt de sessie vast op de toestelrij.
      expect((await api('POST', '/api/devices/register', { token, device: 'dev-planner', body: { name: 'Mac · browser' } })).status).toBe(200);
      expect(mem.devices.find((d: any) => d.deviceToken === 'dev-planner')?.sessionId).toBe('sess-planner');
      expect((await api('GET', '/api/leave', { token, device: 'dev-planner' })).status).toBe(200);

      // Admin trekt het toestel in.
      expect((await api('POST', '/api/devices/revoke', { token: 'tok-admin', body: { userId: '2', deviceToken: 'dev-planner' } })).status).toBe(200);

      // Mét header: geblokkeerd (dat werkte al).
      expect((await api('GET', '/api/leave', { token, device: 'dev-planner' })).json.code).toBe('device_revoked');
      // Zónder header: vroeger volledige toegang, nu ook geblokkeerd.
      const zonderHeader = await api('GET', '/api/leave', { token, device: null });
      expect(zonderHeader.status).toBe(403);
      expect(zonderHeader.json.code).toBe('device_revoked');
      // En met een willekeurig ander toestel-token evenmin.
      expect((await api('GET', '/api/leave', { token, device: 'dev-verzonnen' })).json.code).toBe('device_revoked');
    });

    it('blokkeert een ingetrokken chauffeurstoestel ook als de goedkeuringsschakelaar uit staat', async () => {
      mem.appSettings.device_gate = { enabled: false };
      const token = jwt('a@vhb.be', 'auth-tok-a', 'sess-chauffeur');
      expect((await api('POST', '/api/devices/register', { token, device: 'dev-tel', body: { name: 'iPhone · app' } })).status).toBe(200);
      expect((await api('POST', '/api/devices/revoke', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-tel' } })).status).toBe(200);
      // Zonder header was dit een "onbekend toestel" en liet de uitgeschakelde
      // schakelaar het door.
      const zonderHeader = await api('GET', '/api/leave', { token, device: null });
      expect(zonderHeader.status).toBe(403);
      expect(zonderHeader.json.code).toBe('device_revoked');
    });

    it('een ingetrokken toestel dat zich opnieuw aanmeldt: ook de nieuwe sessie is meteen geblokkeerd', async () => {
      const eerst = jwt('planner@vhb.be', 'auth-tok-planner', 'sess-oud');
      expect((await api('POST', '/api/devices/register', { token: eerst, device: 'dev-planner', body: { name: 'Mac · browser' } })).status).toBe(200);
      expect((await api('POST', '/api/devices/revoke', { token: 'tok-admin', body: { userId: '2', deviceToken: 'dev-planner' } })).status).toBe(200);
      // Vult de gecachte lijst met alleen de oude sessie.
      expect((await api('GET', '/api/leave', { token: eerst, device: null })).json.code).toBe('device_revoked');
      // Opnieuw aanmelden op hetzelfde (ingetrokken) toestel geeft een nieuwe
      // sessie; de registratie legt die vast en wist de cache, anders was ze
      // tot 30 s bruikbaar door de header weg te laten.
      const opnieuw = jwt('planner@vhb.be', 'auth-tok-planner', 'sess-nieuw');
      const reg = await api('POST', '/api/devices/register', { token: opnieuw, device: 'dev-planner', body: { name: 'Mac · browser' } });
      expect(reg.json.status).toBe('revoked');
      const zonderHeader = await api('GET', '/api/leave', { token: opnieuw, device: null });
      expect(zonderHeader.status).toBe(403);
      expect(zonderHeader.json.code).toBe('device_revoked');
      // Na goedkeuren door de admin mag dezelfde sessie weer door.
      expect((await api('POST', '/api/devices/approve', { token: 'tok-admin', body: { userId: '2', deviceToken: 'dev-planner' } })).status).toBe(200);
      expect((await api('GET', '/api/leave', { token: opnieuw, device: null })).status).toBe(200);
    });

    it('de sessie-id gaat nooit naar de adminbrowser', async () => {
      const token = jwt('planner@vhb.be', 'auth-tok-planner', 'sess-geheim');
      await api('POST', '/api/devices/register', { token, device: 'dev-planner', body: { name: 'Mac · browser' } });
      const lijst = await api('GET', '/api/devices', { token: 'tok-admin' });
      expect(lijst.status).toBe(200);
      expect(JSON.stringify(lijst.json)).not.toContain('sess-geheim');
    });

    it('laat een gewone sessie op een goedgekeurd toestel ongemoeid', async () => {
      const chauffeur = jwt('a@vhb.be', 'auth-tok-a', 'sess-ok');
      expect((await api('POST', '/api/devices/register', { token: chauffeur, device: 'dev-ok', body: { name: 'iPhone · app' } })).status).toBe(200);
      expect((await api('GET', '/api/leave', { token: chauffeur, device: 'dev-ok' })).status).toBe(200);
      // Chauffeur zonder header blijft 'onbekend toestel' zolang de
      // goedkeuringsschakelaar aanstaat, maar niet 'ingetrokken'.
      expect((await api('GET', '/api/leave', { token: chauffeur, device: null })).json.code).toBe('device_unknown');
      // Staf zonder header mag gewoon door: de sessiecontrole voegt alleen een
      // blokkade toe voor ingetrokken toestellen, geen nieuwe lock-out.
      const planner = jwt('planner@vhb.be', 'auth-tok-planner', 'sess-planner-ok');
      expect((await api('POST', '/api/devices/register', { token: planner, device: 'dev-planner-ok', body: { name: 'Mac' } })).status).toBe(200);
      expect((await api('GET', '/api/leave', { token: planner, device: null })).status).toBe(200);
    });
  });

  it('"uitloggen op alle andere toestellen" trekt alles behalve het huidige in', async () => {
    mem.devices.push(
      { userId: '3', deviceToken: 'dev-2', name: 'Mac · browser', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' },
      { userId: '3', deviceToken: 'dev-3', name: 'iPad · app', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
    );
    const res = await api('POST', '/api/me/toestellen/uitloggen-anderen', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.aantal).toBe(2);
    const mijn = mem.devices.filter((d: any) => d.userId === '3');
    expect(mijn.find((d: any) => d.deviceToken === 'dev-ok')?.status).toBe('approved');
    // Zelf uitloggen verwijdert de rijen; alleen het huidige toestel blijft.
    expect(mijn).toHaveLength(1);
    // Andere gebruikers blijven ongemoeid.
    expect(mem.devices.find((d: any) => d.userId === '4')?.status).toBe('approved');
  });
});

describe('concurrency & IDOR (middel-fixes)', () => {
  it('weigert een tweede open ruil voor dezelfde dienst (409)', async () => {
    // sh-a heeft al een open ruil (s-1). Chauffeur 3 biedt sh-a nogmaals aan.
    const own = mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3');
    const dubbel = {
      id: 's-dup', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-09', returnCode: 'VRIJ',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, dubbel] });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-dup')).toBeFalsy();
  });

  it('weigert een tweede goedkeuring voor dezelfde dienst (409, via PATCH)', async () => {
    mem.swaps = [
      { id: 'x1', shiftId: 'sh-z', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
      { id: 'x2', shiftId: 'sh-z', requesterId: '3', targetDriverId: '2', status: 'accepted', reason: '', createdAt: '2026-06-01T09:00:00Z', returnDate: '2026-07-03', returnCode: '12' },
    ];
    const eerste = await api('PATCH', '/api/swaps/x1', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(eerste.status).toBe(200);
    const tweede = await api('PATCH', '/api/swaps/x2', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(tweede.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 'x2')?.status).toBe('accepted');
  });

  it('push-unsubscribe verwijdert niet het abonnement van een ándere gebruiker (geen IDOR)', async () => {
    await api('POST', '/api/push/subscribe', { token: 'tok-a', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/owned-by-3', keys: { p256dh: 'pk', auth: 'au' } } });
    // Gebruiker 4 probeert het endpoint van gebruiker 3 af te melden → geen effect.
    const idor = await api('POST', '/api/push/unsubscribe', { token: 'tok-b', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/owned-by-3' } });
    expect(idor.status).toBe(200);
    expect(mem.pushSubscriptions.some((s) => s.endpoint === 'https://fcm.googleapis.com/fcm/send/owned-by-3')).toBe(true);
    // De eigenaar zelf kan het wél afmelden.
    await api('POST', '/api/push/unsubscribe', { token: 'tok-a', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/owned-by-3' } });
    expect(mem.pushSubscriptions.some((s) => s.endpoint === 'https://fcm.googleapis.com/fcm/send/owned-by-3')).toBe(false);
  });
});

describe('aanwezigheid (wie was wanneer actief)', () => {
  it('GET /api/activity/presence: admin krijgt sessies, planner 403', async () => {
    mem.presence = [
      { id: 'p1', user_id: '3', role: 'chauffeur', started_at: new Date(Date.now() - 3600_000).toISOString(), last_seen_at: new Date().toISOString() },
    ];
    expect((await api('GET', '/api/activity/presence', { token: 'tok-planner' })).status).toBe(403);
    const admin = await api('GET', '/api/activity/presence', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json.days).toBe(14);
    expect(admin.json.sessies).toHaveLength(1);
    // Naam komt uit users (een naamswijziging hoort meteen overal te kloppen),
    // de rol uit de sessierij (een promotie herschrijft de historie niet).
    expect(admin.json.sessies[0]).toMatchObject({ userId: '3', rol: 'chauffeur' });
    expect(typeof admin.json.sessies[0].naam).toBe('string');
  });

  it('laat sessies van verwijderde gebruikers weg in plaats van een lege naam te tonen', async () => {
    mem.presence = [
      { id: 'p1', user_id: 'bestaat-niet', role: 'chauffeur', started_at: new Date().toISOString(), last_seen_at: new Date().toISOString() },
    ];
    const admin = await api('GET', '/api/activity/presence', { token: 'tok-admin' });
    expect(admin.json.sessies).toHaveLength(0);
  });

  it('meldt netjes welke migratie mist in plaats van een 500', async () => {
    mem.presenceTabel = false;
    const admin = await api('GET', '/api/activity/presence', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json.sessies).toEqual([]);
    expect(admin.json.migratie).toContain('user_presence');
  });

  it('geeft de plaats van aanmelden door, zonder een migratiemelding', async () => {
    const nu = new Date().toISOString();
    mem.presence = [
      { id: 'p1', user_id: '3', role: 'chauffeur', started_at: nu, last_seen_at: nu, land: 'FR', regio: 'HDF', stad: 'Lille' },
      { id: 'p2', user_id: '3', role: 'chauffeur', started_at: nu, last_seen_at: nu, land: null, regio: null, stad: null },
    ];
    const admin = await api('GET', '/api/activity/presence', { token: 'tok-admin' });
    expect(admin.json.sessies).toHaveLength(2);
    expect(admin.json.sessies[0]).toMatchObject({ land: 'FR', regio: 'HDF', stad: 'Lille' });
    expect(admin.json.sessies[1]).toMatchObject({ land: null, stad: null });
    expect(admin.json.locatieMigratie).toBeUndefined();
  });

  it('meldt de plaatsmigratie zolang de kolommen ontbreken, en levert de sessies gewoon', async () => {
    const nu = new Date().toISOString();
    mem.presence = [{ id: 'p1', user_id: '3', role: 'chauffeur', started_at: nu, last_seen_at: nu }];
    const admin = await api('GET', '/api/activity/presence', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json.sessies).toHaveLength(1);
    expect(admin.json.sessies[0].land).toBeNull();
    expect(admin.json.locatieMigratie).toContain('2026-09-20_user_presence_locatie.sql');
  });

  it('de auth-middleware geeft de plaats uit de Vercel-headers mee, en nooit een IP-adres', async () => {
    const { vergeetHartslagen } = await import('../../api/_lib/aanwezigheid');
    vergeetHartslagen();
    const res = await api('GET', '/api/me', {
      token: 'tok-a',
      headers: { 'x-vercel-ip-country': 'BE', 'x-vercel-ip-country-region': 'VOV', 'x-vercel-ip-city': 'Sint-Niklaas', 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.7' },
    });
    expect(res.status).toBe(200);
    expect(mem.presenceSchrijf).toHaveLength(1);
    expect(mem.presenceSchrijf[0].locatie).toEqual({ land: 'BE', regio: 'VOV', stad: 'Sint-Niklaas' });
    expect(JSON.stringify(mem.presenceSchrijf)).not.toContain('203.0.113.7');
  });

  it('zonder geo-headers (lokaal, tests) blijft de plaats null en loopt de registratie door', async () => {
    const { vergeetHartslagen } = await import('../../api/_lib/aanwezigheid');
    vergeetHartslagen();
    expect((await api('GET', '/api/me', { token: 'tok-a' })).status).toBe(200);
    expect(mem.presenceSchrijf).toHaveLength(1);
    expect(mem.presenceSchrijf[0].locatie).toBeNull();
  });

});

describe('wachtwoordminimum server-side (controle-ronde 27-08, nr. 32)', () => {
  it('POST /api/users weigert een nieuw account met een wachtwoord korter dan 10 tekens', async () => {
    const nieuw = { id: '77', name: 'Nieuwe Chauffeur', email: 'nieuw@vhb.be', role: 'chauffeur', isActive: true, password: 'kort123' };
    const res = await api('POST', '/api/users', { token: 'tok-admin', body: [...mem.users, nieuw] });
    expect(res.status).toBe(400);
    expect(mem.users.find((u: any) => u.id === '77')).toBeUndefined();
  });
  it('…en accepteert 10 tekens', async () => {
    const nieuw = { id: '78', name: 'Nieuwe Chauffeur', email: 'nieuw2@vhb.be', role: 'chauffeur', isActive: true, password: 'lang-genoeg' };
    const res = await api('POST', '/api/users', { token: 'tok-admin', body: [...mem.users, nieuw] });
    expect(res.status).toBe(200);
  });
});

describe('wachtwoord resetten door beheer (POST /api/admin/users/reset-password)', () => {
  const authAttrap = () => {
    const gezet: Array<{ id: string; password?: string }> = [];
    mem.supabaseAdmin = {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [{ id: 'auth-a', email: 'a@vhb.be' }] }, error: null }),
          updateUserById: async (id: string, velden: { password?: string }) => { gezet.push({ id, password: velden.password }); return { data: {}, error: null }; },
        },
      },
    };
    return gezet;
  };

  it('weigert 9 tekens met een 400 en de fout bij het veld, zonder iets te zetten', async () => {
    const gezet = authAttrap();
    const res = await api('POST', '/api/admin/users/reset-password', { token: 'tok-admin', body: { userId: '3', password: '123456789' } });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Ongeldige invoer');
    expect(res.json.veldfouten).toEqual({ password: 'Gebruik een tijdelijk wachtwoord van minstens 10 tekens' });
    expect(res.json.details).toContain('10 tekens');
    expect(gezet).toEqual([]);
    expect(mem.activity.some((a) => a.action === 'Wachtwoord gereset')).toBe(false);
  });

  it('weigert ook zonder service-role eerst op de invoer (400, niet 500)', async () => {
    const res = await api('POST', '/api/admin/users/reset-password', { token: 'tok-admin', body: { userId: '3', password: 'kort' } });
    expect(res.status).toBe(400);
    expect(res.json.veldfouten.password).toContain('10 tekens');
  });

  it('accepteert 10 tekens en zet het wachtwoord op het gekoppelde Auth-account', async () => {
    const gezet = authAttrap();
    const res = await api('POST', '/api/admin/users/reset-password', { token: 'tok-admin', body: { userId: '3', password: '1234567890' } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true });
    expect(gezet).toEqual([{ id: 'auth-a', password: '1234567890' }]);
    expect(mem.activity.filter((a) => a.action === 'Wachtwoord gereset')).toHaveLength(1);
  });

  it('blijft alleen voor admin (403 voor een planner)', async () => {
    authAttrap();
    expect((await api('POST', '/api/admin/users/reset-password', { token: 'tok-planner', body: { userId: '3', password: '1234567890' } })).status).toBe(403);
  });
});

// Uitnodigen voor het portaal (30-09): een eigen link van zeven dagen per
// persoon (hash in de app_metadata van het Auth-account), en bij het openen
// pas een verse herstel-token. Zie api/_lib/uitnodiging.ts.
describe('uitnodigen voor het portaal', () => {
  type Account = { id: string; email: string; app_metadata: Record<string, unknown> };
  let accounts: Map<string, Account>;
  let links: string[];

  beforeEach(() => {
    mem.mailLog = [];
    // Chauffeurs en planner hebben een aanmelding. De admin gebruikt het
    // portaal al (en krijgt zijn authId bij zijn eerste verzoek); Chauffeur C
    // heeft een adres maar geen gekoppelde aanmelding.
    mem.users = [
      ...mem.users.map((u: any) => (u.id === '1' ? { ...u, lastLogin: '2026-06-10T08:00:00.000Z' } : { ...u, authId: `auth-${u.id}` })),
      { id: '5', name: 'Chauffeur C', email: 'c@vhb.be', role: 'chauffeur', isActive: true },
    ];
    accounts = new Map(['2', '3', '4'].map((id): [string, Account] => {
      const u = mem.users.find((x: any) => x.id === id);
      return [`auth-${id}`, { id: `auth-${id}`, email: u.email, app_metadata: { provider: 'email' } }];
    }));
    links = [];
    mem.supabaseAdmin = {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [...accounts.values()] }, error: null }),
          getUserById: async (id: string) => (accounts.has(id)
            ? { data: { user: accounts.get(id) }, error: null }
            : { data: { user: null }, error: { status: 404, message: 'User not found' } }),
          // Zoals Supabase: app_metadata wordt samengevoegd, null haalt een sleutel weg.
          updateUserById: async (id: string, velden: { app_metadata?: Record<string, unknown> }) => {
            const a = accounts.get(id);
            if (!a) return { data: null, error: { status: 404, message: 'User not found' } };
            for (const [k, v] of Object.entries(velden.app_metadata ?? {})) {
              if (v === null) delete a.app_metadata[k];
              else a.app_metadata[k] = v;
            }
            return { data: { user: a }, error: null };
          },
          generateLink: async (o: { type: string; email: string }) => {
            links.push(`${o.type}:${o.email}`);
            return { data: { properties: { hashed_token: `hash-${links.length}` } }, error: null };
          },
        },
      },
    };
  });

  const codeUitMail = (tekst?: string) => {
    const m = /#uitnodiging=([^\s)"'<>]+)/.exec(tekst ?? '');
    expect(m, 'link met de uitnodigingscode in de mail').toBeTruthy();
    return m![1]!;
  };
  const nodigUit = (ids: string[], extra: Record<string, unknown> = {}) => api('POST', '/api/users/uitnodigen', { token: 'tok-admin', body: { ids, ...extra } });
  const open = (code: unknown) => api('POST', '/api/uitnodiging/openen', { body: { code }, device: null });

  it('droog: voorbeeld en ontvangers, wie niet kan met de reden, en er wordt niets aangemaakt of verstuurd', async () => {
    mem.users.find((u: any) => u.id === '4').lastLogin = '2026-06-01T08:00:00.000Z';
    const res = await nodigUit(['3', '4', '5', '1', 'bestaat-niet'], { droog: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ droog: true, aantal: 1, ontvangers: [{ adres: 'a@vhb.be', naam: 'Chauffeur A' }] });
    expect(res.json.nietUitgenodigd).toEqual([
      { id: '4', naam: 'Chauffeur B', reden: 'al-ingelogd' },
      { id: '5', naam: 'Chauffeur C', reden: 'geen-account' },
      { id: '1', naam: 'Annelies Admin', reden: 'al-ingelogd' },
    ]);
    expect(res.json.html).toContain('Hallo Chauffeur A,');
    expect(res.json.html).toContain('#uitnodiging=voorbeeld');
    expect(mem.emailsSent).toHaveLength(0);
    expect(mem.mailLog).toHaveLength(0);
    expect(accounts.get('auth-3')!.app_metadata.uitnodiging).toBeUndefined();
  });

  it('versturen: een eigen mail met een eigen link, alleen de hash bij het account, verzendlog en logboek', async () => {
    const res = await nodigUit(['3']);
    expect(res.status).toBe(200);
    // `overgeslagen` is de vlag van de reeks ("mailsoort staat uit") en moet
    // false blijven: het scherm leest elke waarheidswaarde als "niets verstuurd".
    expect(res.json).toMatchObject({ droog: false, aantal: 1, gelukt: 1, mislukt: 0, resterend: [], overgeslagen: false, nietUitgenodigd: [] });
    expect(res.json.uitgenodigd).toEqual([{ userId: '3', op: '2026-06-15T10:00:00.000Z', tot: '2026-06-22T10:00:00.000Z' }]);

    expect(mem.emailsSent).toHaveLength(1);
    expect(mem.emailsSent[0]).toMatchObject({ to: ['a@vhb.be'], subject: 'Uitnodiging voor het VHB Portaal, kies je wachtwoord' });
    const code = codeUitMail(mem.emailsSent[0].text);
    expect(code.startsWith('3.')).toBe(true);
    const geheim = code.slice(2);

    const meta = accounts.get('auth-3')!.app_metadata as any;
    expect(meta.provider).toBe('email');
    expect(meta.uitnodiging).toMatchObject({ email: 'a@vhb.be', op: '2026-06-15T10:00:00.000Z', tot: '2026-06-22T10:00:00.000Z' });
    expect(meta.uitnodiging.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(meta)).not.toContain(geheim);

    expect(mem.mailLog).toHaveLength(1);
    expect(mem.mailLog[0]).toMatchObject({ soort: 'uitnodiging', aantal: 1, door: 'Annelies Admin' });
    expect(JSON.stringify(mem.mailLog)).not.toMatch(/@|uitnodiging=/);
    const log = mem.activity.filter((a: any) => a.action === 'Uitnodiging verstuurd');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entityType: 'user', entityId: '3' });
    expect(log[0].message).toContain('Chauffeur A: uitnodiging voor het portaal, link geldig tot 22/06/2026');
    expect(log[0].message).not.toContain(geheim);
  });

  it('openen: met de code uit de mail een verse herstel-token; zonder aanmelding, en pas dan een link bij Supabase', async () => {
    await nodigUit(['3']);
    expect(links).toEqual([]);
    const res = await open(codeUitMail(mem.emailsSent[0].text));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ naam: 'Chauffeur A', email: 'a@vhb.be', tokenHash: 'hash-1' });
    expect(links).toEqual(['recovery:a@vhb.be']);
  });

  it('openen weigert een verkeerd geheim, een onbekend id en rommel, altijd met dezelfde reden en zonder link', async () => {
    await nodigUit(['3']);
    const code = codeUitMail(mem.emailsSent[0].text);
    const verkeerd = `${code.slice(0, -4)}${code.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    for (const c of [verkeerd, code.replace(/^3\./, '4.'), code.replace(/^3\./, '99.'), 'rommel', 42, undefined]) {
      const res = await open(c);
      expect(res.status, String(c)).toBe(410);
      expect(res.json).toMatchObject({ reden: 'ongeldig' });
      expect(res.json.error).toContain('Vraag de planning om een nieuwe');
    }
    expect(links).toEqual([]);
  });

  it('een nieuwe uitnodiging maakt de vorige link ongeldig', async () => {
    await nodigUit(['3']);
    const oud = codeUitMail(mem.emailsSent[0].text);
    await nodigUit(['3']);
    const nieuw = codeUitMail(mem.emailsSent[1].text);
    expect(nieuw).not.toBe(oud);
    expect((await open(oud)).json.reden).toBe('ongeldig');
    expect((await open(nieuw)).status).toBe(200);
  });

  it('werkt niet meer na de eerste aanmelding, na zeven dagen, na een adreswissel of bij een gepauzeerd account', async () => {
    await nodigUit(['3']);
    const code = codeUitMail(mem.emailsSent[0].text);
    const chauffeur = mem.users.find((u: any) => u.id === '3');

    chauffeur.lastLogin = '2026-06-15T11:00:00.000Z';
    expect((await open(code)).json.reden).toBe('gebruikt');
    delete chauffeur.lastLogin;

    chauffeur.isActive = false;
    expect((await open(code)).json.reden).toBe('gepauzeerd');
    chauffeur.isActive = true;

    vi.setSystemTime(new Date('2026-06-22T10:00:01Z'));
    expect((await open(code)).json.reden).toBe('verlopen');
    vi.setSystemTime(new Date('2026-06-22T09:59:00Z'));
    expect((await open(code)).status).toBe(200);

    // De uitnodiging ging naar het oude adres: na een wissel werkt ze niet meer.
    chauffeur.email = 'nieuw@vhb.be';
    accounts.get('auth-3')!.email = 'nieuw@vhb.be';
    expect((await open(code)).json.reden).toBe('ongeldig');
  });

  it('mislukt de mail, dan gaat de link weer weg en komt er geen logregel; `alleen` stuurt daarna alleen naar de rest', async () => {
    const { sendEmail } = await import('../../api/email.js');
    vi.mocked(sendEmail).mockImplementation(async (opts: any) => {
      if (opts.to[0] === 'b@vhb.be') return { ok: false, mocked: false, error: '450 rate limit' };
      mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context, text: opts.text });
      return { ok: true, mocked: false };
    });
    try {
      const res = await nodigUit(['3', '4']);
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ aantal: 2, gelukt: 1, mislukt: 1, resterend: ['b@vhb.be'] });
      expect(res.json.uitgenodigd.map((u: any) => u.userId)).toEqual(['3']);
      expect(accounts.get('auth-3')!.app_metadata.uitnodiging).toBeTruthy();
      expect(accounts.get('auth-4')!.app_metadata.uitnodiging).toBeUndefined();
      expect(accounts.get('auth-4')!.app_metadata.provider).toBe('email');
      expect(mem.activity.filter((a: any) => a.action === 'Uitnodiging verstuurd').map((a: any) => a.entityId)).toEqual(['3']);
    } finally {
      vi.mocked(sendEmail).mockImplementation(async (opts: any) => {
        mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context, text: opts.text, attachments: opts.attachments });
        mem.mailLogVerloop.push(`mail:${opts.to.join(',')}`);
        return { ok: true, mocked: true };
      });
    }
    mem.emailsSent = [];
    const rest = await nodigUit(['3', '4'], { alleen: ['B@vhb.be'] });
    expect(rest.status).toBe(200);
    expect(mem.emailsSent.map((m) => m.to)).toEqual([['b@vhb.be']]);
    expect(accounts.get('auth-4')!.app_metadata.uitnodiging).toBeTruthy();
  });

  it('een nieuw account krijgt in de welkomstmail dezelfde link van zeven dagen', async () => {
    accounts.set('auth-nieuw-n1', { id: 'auth-nieuw-n1', email: 'nieuw@vhb.be', app_metadata: {} });
    const res = await api('POST', '/api/users/one', { token: 'tok-admin', body: { id: 'n1', name: 'Nieuwe Chauffeur', email: 'nieuw@vhb.be', role: 'chauffeur', isActive: true, password: 'lang-genoeg' } });
    expect(res.status).toBe(201);
    const welkom = mem.emailsSent.find((m) => m.context === 'welcome:nieuw@vhb.be');
    const code = codeUitMail(welkom?.text);
    expect(code.startsWith('n1.')).toBe(true);
    expect(accounts.get('auth-nieuw-n1')!.app_metadata.uitnodiging).toMatchObject({ email: 'nieuw@vhb.be', tot: '2026-06-22T10:00:00.000Z' });
    // Geen herstellink van Supabase meer nodig; die komt pas bij het openen.
    expect(links).toEqual([]);
    expect((await open(code)).json).toEqual({ naam: 'Nieuwe Chauffeur', email: 'nieuw@vhb.be', tokenHash: 'hash-1' });
  });

  it('lukt die link niet, dan krijgt het nieuwe account de herstellink van Supabase zoals vroeger', async () => {
    // Geen Auth-account 'auth-nieuw-n2' in de attrap: de uitnodiging faalt.
    const res = await api('POST', '/api/users/one', { token: 'tok-admin', body: { id: 'n2', name: 'Tweede Chauffeur', email: 'tweede@vhb.be', role: 'chauffeur', isActive: true, password: 'lang-genoeg' } });
    expect(res.status).toBe(201);
    expect(links).toEqual(['recovery:tweede@vhb.be']);
    expect(mem.emailsSent.find((m) => m.context === 'welcome:tweede@vhb.be')).toBeTruthy();
  });

  it('afronden na het kiezen van het wachtwoord: daarna geen herstel-token meer, ook zonder aanmelding', async () => {
    await nodigUit(['3']);
    const code = codeUitMail(mem.emailsSent[0].text);
    const afronden = (c: unknown) => api('POST', '/api/uitnodiging/afronden', { body: { code: c }, device: null });

    // Zonder het geheim: niets veranderd.
    const vals = await afronden(code.replace(/.{4}$/, code.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
    expect(vals.status).toBe(410);
    expect((accounts.get('auth-3')!.app_metadata.uitnodiging as any).gebruikt).toBeUndefined();

    expect((await afronden(code)).status).toBe(200);
    expect((accounts.get('auth-3')!.app_metadata.uitnodiging as any).gebruikt).toBe('2026-06-15T10:00:00.000Z');
    // lastLogin blijft leeg (toestel wacht op goedkeuring), toch is de link op.
    expect(mem.users.find((u: any) => u.id === '3').lastLogin).toBeUndefined();
    const res = await open(code);
    expect(res.status).toBe(410);
    expect(res.json).toMatchObject({ reden: 'gebruikt' });
    expect(links).toEqual([]);
  });

  it('mislukt een nieuwe mail, dan werkt de vorige uitnodiging weer', async () => {
    await nodigUit(['4']);
    const vorige = codeUitMail(mem.emailsSent[0].text);
    const { sendEmail } = await import('../../api/email.js');
    vi.mocked(sendEmail).mockImplementation(async () => ({ ok: false, mocked: false, error: '450 rate limit' }));
    try {
      const res = await nodigUit(['4']);
      expect(res.json).toMatchObject({ gelukt: 0, mislukt: 1, resterend: ['b@vhb.be'] });
    } finally {
      vi.mocked(sendEmail).mockImplementation(async (opts: any) => {
        mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context, text: opts.text, attachments: opts.attachments });
        mem.mailLogVerloop.push(`mail:${opts.to.join(',')}`);
        return { ok: true, mocked: true };
      });
    }
    expect((await open(vorige)).status).toBe(200);
  });

  it('kon het nieuwe profiel niet aan zijn account gekoppeld worden, dan de herstellink in de welkomstmail', async () => {
    mem.koppelMislukt = true;
    const res = await api('POST', '/api/users/one', { token: 'tok-admin', body: { id: 'n3', name: 'Derde Chauffeur', email: 'derde@vhb.be', role: 'chauffeur', isActive: true, password: 'lang-genoeg' } });
    expect(res.status).toBe(201);
    expect(links).toEqual(['recovery:derde@vhb.be']);
  });

  it('niemand om uit te nodigen = 400 met de reden, er vertrekt niets', async () => {
    mem.users.find((u: any) => u.id === '3').isActive = false;
    const res = await nodigUit(['3', '5']);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Niemand om uit te nodigen: Chauffeur A (gepauzeerd), Chauffeur C (geen gekoppelde aanmelding).');
    expect(mem.emailsSent).toHaveLength(0);
  });

  it('de lijst per gebruiker: alleen lopende uitnodigingen naar het huidige adres', async () => {
    await nodigUit(['3', '4']);
    mem.users.find((u: any) => u.id === '4').email = 'ander@vhb.be';
    const res = await api('GET', '/api/users/uitnodigingen', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ uitnodigingen: [{ userId: '3', op: '2026-06-15T10:00:00.000Z', tot: '2026-06-22T10:00:00.000Z' }] });
  });

  it('alleen een admin nodigt uit; openen kan zonder aanmelding, maar niet zonder service-role', async () => {
    expect((await api('POST', '/api/users/uitnodigen', { token: 'tok-planner', body: { ids: ['3'] } })).status).toBe(403);
    expect((await api('GET', '/api/users/uitnodigingen', { token: 'tok-planner' })).status).toBe(403);
    expect((await api('POST', '/api/users/uitnodigen', { body: { ids: ['3'] }, device: null })).status).toBe(401);
    expect((await nodigUit([])).status).toBe(400);
    mem.supabaseAdmin = null;
    expect((await open('3.AAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(503);
    expect((await nodigUit(['3'])).status).toBe(503);
  });
});

describe('toestel-whitelist', () => {
  it('blokkeert een chauffeur zonder toestel-header (403 device_unknown)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: null });
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('device_unknown');
  });

  it('blokkeert een chauffeur met een onbekend toestel-token (403 device_unknown)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-vreemd' });
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('device_unknown');
  });

  it('blokkeert een pending en een geblokkeerd toestel met de juiste code', async () => {
    mem.devices.push(
      { userId: '3', deviceToken: 'dev-pending', name: 'x', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
      { userId: '3', deviceToken: 'dev-revoked', name: 'x', status: 'revoked', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
    );
    const pending = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-pending' });
    expect(pending.status).toBe(403);
    expect(pending.json?.code).toBe('device_pending');
    const revoked = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-revoked' });
    expect(revoked.status).toBe(403);
    expect(revoked.json?.code).toBe('device_revoked');
  });

  it('raakt planner en admin niet, ook zonder toestel-header', async () => {
    expect((await api('GET', '/api/updates', { token: 'tok-admin', device: null })).status).toBe(200);
    expect((await api('GET', '/api/updates', { token: 'tok-planner', device: null })).status).toBe(200);
  });

  it('eerste toestel van een chauffeur wordt automatisch goedgekeurd, het tweede wacht (+ push naar admin)', async () => {
    mem.devices = []; // schone lei: chauffeur zonder toestellen
    const eerste = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-1', body: { name: 'iPhone · app' } });
    expect(eerste.status).toBe(200);
    expect(eerste.json?.status).toBe('approved');

    const tweede = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-2', body: { name: 'Tweede toestel' } });
    expect(tweede.status).toBe(200);
    expect(tweede.json?.status).toBe('pending');
    // Admin (id '1') krijgt een push over het wachtende toestel.
    expect(mem.pushesSent.some((p) => p.userIds.includes('1') && /goedkeuring/i.test(p.payload?.title ?? ''))).toBe(true);
  });

  it('de register-route blijft bereikbaar vanaf een pending toestel (exempt in de gate)', async () => {
    mem.devices = [
      { userId: '3', deviceToken: 'dev-p', name: 'x', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
    ];
    const res = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-p', body: { name: 'x' } });
    expect(res.status).toBe(200);
    expect(res.json?.status).toBe('pending'); // her-registratie promoveert NIET
  });

  it('na goedkeuring door de admin werkt het toestel', async () => {
    mem.devices.push({ userId: '3', deviceToken: 'dev-nieuw', name: 'x', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });
    expect((await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-nieuw' })).status).toBe(403);
    const approve = await api('POST', '/api/devices/approve', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-nieuw' } });
    expect(approve.status).toBe(200);
    expect((await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-nieuw' })).status).toBe(200);
  });

  it('toestellenlijst en beheer-acties zijn admin-only', async () => {
    expect((await api('GET', '/api/devices', { token: 'tok-planner' })).status).toBe(403);
    expect((await api('GET', '/api/devices', { token: 'tok-a' })).status).toBe(403);
    expect((await api('GET', '/api/devices', { token: 'tok-admin' })).status).toBe(200);
  });

  it('een overlang toestel-token wordt behandeld als onbekend toestel (403, geen 500/fail-open)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'x'.repeat(500) });
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('device_unknown');
  });

  it('fail-CLOSED bij een echte DB-fout in de gate (503)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-dberror' });
    expect(res.status).toBe(503);
    expect(res.json?.code).toBe('device_check_failed');
  });

  it('fail-OPEN alleen wanneer de user_devices-tabel ontbreekt (migratie niet gedraaid)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-missingtable' });
    expect(res.status).toBe(200);
  });

  it('het laatste toestel van een gebruiker kan niet geschrapt worden (heropent auto-approve)', async () => {
    mem.devices = [
      { userId: '3', deviceToken: 'dev-enige', name: 'x', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' },
    ];
    const res = await api('POST', '/api/devices/delete', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-enige' } });
    expect(res.status).toBe(400);
    expect(res.json?.code).toBe('last_device');
    // Met een tweede toestel erbij mag schrappen wél.
    mem.devices.push({ userId: '3', deviceToken: 'dev-tweede', name: 'y', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });
    expect((await api('POST', '/api/devices/delete', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-tweede' } })).status).toBe(200);
  });

  it('een toestelnaam met regeleinden wordt gesaniteerd (anti-injectie in de admin-push)', async () => {
    mem.devices = [];
    await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-naam', body: { name: 'iPhone\n\nGoedkeuren aub!!!' } });
    const stored = mem.devices.find((d: any) => d.deviceToken === 'dev-naam');
    expect(stored?.name).toBe('iPhone Goedkeuren aub!!!');
    expect(stored?.name).not.toContain('\n');
  });

  it('de admin kan het toestel waarop die nu werkt niet blokkeren of schrappen (lockout-guard)', async () => {
    mem.devices.push({ userId: '1', deviceToken: 'dev-admin', name: 'Mac', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    const revoke = await api('POST', '/api/devices/revoke', { token: 'tok-admin', device: 'dev-admin', body: { userId: '1', deviceToken: 'dev-admin' } });
    expect(revoke.status).toBe(400);
    const del = await api('POST', '/api/devices/delete', { token: 'tok-admin', device: 'dev-admin', body: { userId: '1', deviceToken: 'dev-admin' } });
    expect(del.status).toBe(400);
    // Een ánder toestel blokkeren mag wel.
    mem.devices.push({ userId: '3', deviceToken: 'dev-x', name: 'x', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    expect((await api('POST', '/api/devices/revoke', { token: 'tok-admin', device: 'dev-admin', body: { userId: '3', deviceToken: 'dev-x' } })).status).toBe(200);
  });

  // Toestel-cache in de gate (ronde 3): elke schrijfactie via de API moet
  // meteen gelden, ook al is het toestel net nog als 'approved' gecacht.
  it('blokkeren werkt meteen door, ook wanneer de gate het toestel net gecacht heeft', async () => {
    expect((await api('GET', '/api/updates', { token: 'tok-a' })).status).toBe(200); // vult de cache met approved
    expect((await api('POST', '/api/devices/revoke', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-ok' } })).status).toBe(200);
    const na = await api('GET', '/api/updates', { token: 'tok-a' });
    expect(na.status).toBe(403);
    expect(na.json?.code).toBe('device_revoked');
    // Ook het PII-luik op het exempt-pad volgt meteen.
    const sessie = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } });
    expect(sessie.json?.email).toBeUndefined();
  });

  it('goedkeuren en registreren werken meteen door na een gecachte weigering', async () => {
    // Onbekend toestel: "geen rij" wordt gecacht.
    expect((await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-cache' })).json?.code).toBe('device_unknown');
    expect((await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-cache', body: { name: 'iPad' } })).json?.status).toBe('pending');
    expect((await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-cache' })).json?.code).toBe('device_pending');
    expect((await api('POST', '/api/devices/approve', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-cache' } })).status).toBe(200);
    expect((await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-cache' })).status).toBe(200);
  });

  it('uit dienst zetten trekt gecachte toestellen meteen in', async () => {
    expect((await api('GET', '/api/updates', { token: 'tok-a' })).status).toBe(200);
    const { trekToegangIn } = await import('../../api/_lib/recordWrites');
    await trekToegangIn('3');
    expect((await api('GET', '/api/updates', { token: 'tok-a' })).json?.code).toBe('device_revoked');
  });

  it('elk /api-antwoord draagt Server-Timing, ook een 401 en de health-ping', async () => {
    for (const res of [
      await api('GET', '/api/me', { token: 'tok-a' }),
      await api('GET', '/api/me', {}),
      await api('GET', '/api/health', {}),
    ]) {
      expect(res.headers.get('server-timing')).toMatch(/^app;dur=\d+$/);
    }
  });

  it('/api/me hergebruikt het toestel van de gate', async () => {
    const me = await api('GET', '/api/me', { token: 'tok-a' });
    expect(me.status).toBe(200);
    expect(me.json?.toestel?.status).toBe('approved');
  });
});

describe('auth-storing ≠ uitloggen (middleware 401 vs 503)', () => {
  it('een onbereikbare auth-dienst geeft 503, geen 401, de client logt anders alle toestellen tegelijk uit', async () => {
    const res = await api('GET', '/api/planning', { token: 'tok-storing' });
    expect(res.status).toBe(503);
    expect(res.json?.code).toBe('auth_unavailable');
  });

  it('een 5xx uit de auth-dienst geeft eveneens 503', async () => {
    const res = await api('GET', '/api/planning', { token: 'tok-auth-500' });
    expect(res.status).toBe(503);
  });

  it('een écht ongeldig token blijft 401', async () => {
    const res = await api('GET', '/api/planning', { token: 'tok-bestaat-niet' });
    expect(res.status).toBe(401);
  });
});

describe('authenticate, lokale JWT-verificatie met getUser-fallback (controle-ronde 27-08, nr. 55)', () => {
  it('geldig token → 200 via getClaims (geen roundtrip nodig)', async () => {
    expect((await api('GET', '/api/me', { token: 'tok-a' })).status).toBe(200);
  });
  it('verlopen/ongeldig token → 401', async () => {
    expect((await api('GET', '/api/me', { token: 'tok-verlopen' })).status).toBe(401);
    expect((await api('GET', '/api/me', { token: 'tok-onbekend' })).status).toBe(401);
  });
  it('auth-dienst onbereikbaar → 503 (client houdt zijn sessie)', async () => {
    const res = await api('GET', '/api/me', { token: 'tok-storing' });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe('auth_unavailable');
    expect((await api('GET', '/api/me', { token: 'tok-auth-500' })).status).toBe(503);
  });
});

describe('eigen voorkeuren (PATCH /api/me/voorkeuren)', () => {
  it('slaat de dashboardindeling op en /api/me geeft ze terug; de gebruikerslijst niet', async () => {
    const res = await api('PATCH', '/api/me/voorkeuren', { token: 'tok-a', body: { dashboard: { verborgen: ['deze-maand'], volgorde: ['volgende-dienst', 'vandaag'] } } });
    expect(res.status).toBe(200);
    expect(res.json.dashboardVoorkeuren).toEqual({ verborgen: ['deze-maand'], volgorde: ['volgende-dienst', 'vandaag'] });
    const me = await api('GET', '/api/me', { token: 'tok-a' });
    expect(me.json.dashboardVoorkeuren).toEqual({ verborgen: ['deze-maand'], volgorde: ['volgende-dienst', 'vandaag'] });
    // Persoonlijke UI-staat reist niet mee in de lijst (ook niet voor admin).
    const lijst = await api('GET', '/api/users', { token: 'tok-admin' });
    expect(lijst.json.some((u: any) => 'dashboardVoorkeuren' in u)).toBe(false);
  });

  it("bewaart de gezien-tijdstippen van de nieuw-badges naast de tegels (deelwijziging)", async () => {
    await api('PATCH', '/api/me/voorkeuren', { token: 'tok-a', body: { dashboard: { verborgen: ['deze-maand'] } } });
    const res = await api('PATCH', '/api/me/voorkeuren', { token: 'tok-a', body: { dashboard: { documentenGezienOp: '2026-09-15T10:00:00.000Z', verlofGezienOp: '2026-09-15T11:00:00.000Z' } } });
    expect(res.status).toBe(200);
    // Deelwijziging: de tegel-sleutels blijven staan.
    expect(res.json.dashboardVoorkeuren).toMatchObject({ verborgen: ['deze-maand'], documentenGezienOp: '2026-09-15T10:00:00.000Z', verlofGezienOp: '2026-09-15T11:00:00.000Z' });
    const fout = await api('PATCH', '/api/me/voorkeuren', { token: 'tok-a', body: { dashboard: { documentenGezienOp: 'gisteren' } } });
    expect(fout.status).toBe(400);
  });

  it('weigert een ongeldige body (400) en raakt alleen het eigen profiel', async () => {
    const fout = await api('PATCH', '/api/me/voorkeuren', { token: 'tok-a', body: { dashboard: { verborgen: 'x' } } });
    expect(fout.status).toBe(400);
    const fout2 = await api('PATCH', '/api/me/voorkeuren', { token: 'tok-a', body: { dashboard: { verborgen: ['Niet Geldig!'], volgorde: [] } } });
    expect(fout2.status).toBe(400);
    await api('PATCH', '/api/me/voorkeuren', { token: 'tok-b', body: { dashboard: { verborgen: [], volgorde: ['vandaag'] } } });
    expect(mem.users.find((u: any) => u.id === '3').dashboardVoorkeuren).toBeUndefined();
    expect(mem.users.find((u: any) => u.id === '4').dashboardVoorkeuren).toEqual({ verborgen: [], volgorde: ['vandaag'] });
  });
});

describe('twee-stapsverificatie voor staf (MFA_STAF=aan, verbeterronde 07-09 nr. 8)', () => {
  const vorige = process.env.MFA_STAF;
  beforeEach(() => { process.env.MFA_STAF = 'aan'; });
  afterEach(() => { if (vorige === undefined) delete process.env.MFA_STAF; else process.env.MFA_STAF = vorige; });

  it('weigert staf op aal1 met 403 mfa_required, behalve op de exempt-paden', async () => {
    const res = await api('GET', '/api/users', { token: 'tok-planner' });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('mfa_required');
    // Profiel en beveiligingsoverzicht blijven bereikbaar: die zijn nodig
    // om de code te kunnen invoeren of in te schrijven.
    expect((await api('GET', '/api/me', { token: 'tok-planner' })).status).toBe(200);
    const bev = await api('GET', '/api/me/beveiliging', { token: 'tok-planner' });
    expect(bev.status).toBe(200);
    expect(bev.json).toMatchObject({ staf: true, mfaVerplicht: true, aal: 'aal1' });
  });

  it('laat staf op aal2 door en chauffeurs altijd', async () => {
    expect((await api('GET', '/api/users', { token: 'tok-planner-2fa' })).status).toBe(200);
    expect((await api('GET', '/api/users', { token: 'tok-admin-2fa' })).status).toBe(200);
    const chauffeur = await api('GET', '/api/me/beveiliging', { token: 'tok-a' });
    expect(chauffeur.status).toBe(200);
    expect(chauffeur.json).toMatchObject({ staf: false, mfaVerplicht: false });
    expect((await api('GET', '/api/leave', { token: 'tok-a' })).status).toBe(200);
  });

  it('de sessiestart zegt staf meteen of de code nog moet komen (niets laden vóór aal2, 07-10)', async () => {
    const aal1 = await api('POST', '/api/auth/session', { token: 'tok-planner', body: { action: 'start' } });
    expect(aal1.status).toBe(200);
    expect(aal1.json.beveiliging).toEqual({ mfaVerplicht: true, aal: 'aal1' });
    const aal2 = await api('POST', '/api/auth/session', { token: 'tok-planner-2fa', body: { action: 'start' } });
    expect(aal2.status).toBe(200);
    expect(aal2.json.beveiliging).toEqual({ mfaVerplicht: true, aal: 'aal2' });
    // Een chauffeur heeft geen tweede stap en krijgt het veld niet.
    const chauffeur = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(chauffeur.status).toBe(200);
    expect(chauffeur.json.beveiliging).toBeUndefined();
  });

  it('zonder MFA_STAF=aan is aal1 voor staf gewoon toegestaan', async () => {
    process.env.MFA_STAF = 'uit';
    expect((await api('GET', '/api/users', { token: 'tok-planner' })).status).toBe(200);
    const bev = await api('GET', '/api/me/beveiliging', { token: 'tok-planner' });
    expect(bev.json.mfaVerplicht).toBe(false);
  });
});

// Beveiligingsscan 01-10, keuze 3: met MFA_STAF uit (de standaard) eist de
// API geen aal2. Een sessie die alleen het wachtwoord van een admin doorliep
// kon zo de factor van datzelfde account wissen, en dan was de tweede stap
// niets meer waard voor wie het wachtwoord had gestolen.
describe('eigen twee-stapsverificatie resetten vraagt een bevestigde sessie (scan 01-10, keuze 3)', () => {
  const vorige = process.env.MFA_STAF;
  beforeEach(() => { delete process.env.MFA_STAF; });
  afterEach(() => { if (vorige === undefined) delete process.env.MFA_STAF; else process.env.MFA_STAF = vorige; });

  const mfaAttrap = () => {
    const gewist: Array<{ id: string; userId: string }> = [];
    const gelezen: string[] = [];
    mem.supabaseAdmin = {
      auth: {
        admin: {
          mfa: {
            listFactors: async ({ userId }: { userId: string }) => { gelezen.push(userId); return { data: { factors: [{ id: `f-${userId}` }] }, error: null }; },
            deleteFactor: async (arg: { id: string; userId: string }) => { gewist.push(arg); return { data: {}, error: null }; },
          },
        },
      },
    };
    // De aanmelding achter elk stafaccount (zoals de koppeling bij het inloggen ze zet).
    mem.users = mem.users.map((u: any) => (u.id === '1' ? { ...u, authId: 'auth-tok-admin' } : u.id === '2' ? { ...u, authId: 'auth-tok-planner' } : u));
    return { gewist, gelezen };
  };
  const gelogd = () => mem.activity.filter((a) => a.action === 'Twee-stapsverificatie gereset');

  it('admin met alleen het wachtwoord (aal1) kan de eigen factor niet wissen: 403, niets gelezen of gewist', async () => {
    const { gewist, gelezen } = mfaAttrap();
    const res = await api('POST', '/api/admin/users/1/mfa-reset', { token: 'tok-admin' });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('Je eigen twee-stapsverificatie resetten kan alleen na bevestiging met de code. Meld je aan met de code uit je authenticator-app en probeer het dan opnieuw.');
    // Geen mfa_required: dat stuurt de app naar het codescherm, en dit is een
    // gewone weigering van één actie.
    expect(res.json.code).toBeUndefined();
    expect(gelezen).toEqual([]);
    expect(gewist).toEqual([]);
    expect(gelogd()).toHaveLength(0);
  });

  it('de weigering komt als leesbare melding in beeld, zonder "geen rechten" erachter', async () => {
    mfaAttrap();
    const res = await api('POST', '/api/admin/users/1/mfa-reset', { token: 'tok-admin' });
    // Zoals de client: apiFetch gooit bij een 403 een fout met de servertekst
    // en de status, het scherm Gebruikers geeft die aan schrijffout.
    const { schrijffout } = await import('../lib/fouten');
    expect(schrijffout('Twee-stapsverificatie resetten', Object.assign(new Error(res.json.error), { status: 403 }))).toBe(
      'Twee-stapsverificatie resetten is mislukt. Je eigen twee-stapsverificatie resetten kan alleen na bevestiging met de code. Meld je aan met de code uit je authenticator-app en probeer het dan opnieuw.',
    );
  });

  it('dezelfde admin met een bevestigde sessie (aal2) kan de eigen factor wel resetten', async () => {
    const { gewist, gelezen } = mfaAttrap();
    const res = await api('POST', '/api/admin/users/1/mfa-reset', { token: 'tok-admin-2fa' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, verwijderd: 1 });
    expect(gelezen).toEqual(['auth-tok-admin']);
    expect(gewist).toEqual([{ id: 'f-auth-tok-admin', userId: 'auth-tok-admin' }]);
    expect(gelogd()).toHaveLength(1);
  });

  it('een collega resetten blijft werken vanuit een aal1-sessie', async () => {
    const { gewist } = mfaAttrap();
    const res = await api('POST', '/api/admin/users/2/mfa-reset', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(gewist).toEqual([{ id: 'f-auth-tok-planner', userId: 'auth-tok-planner' }]);
    expect(gelogd()).toHaveLength(1);
  });

  it('een ander portaalaccount met de aanmelding van de admin zelf telt ook als eigen account', async () => {
    const { gewist, gelezen } = mfaAttrap();
    // Twee records op dezelfde aanmelding hoort niet te bestaan, maar de
    // factoren hangen aan de aanmelding: via record 2 zou de admin anders
    // alsnog de eigen factor wissen.
    mem.users = mem.users.map((u: any) => (u.id === '2' ? { ...u, authId: 'auth-tok-admin' } : u));
    const res = await api('POST', '/api/admin/users/2/mfa-reset', { token: 'tok-admin' });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatch(/^Je eigen twee-stapsverificatie resetten kan alleen na bevestiging met de code\./);
    expect(gelezen).toEqual([]);
    expect(gewist).toEqual([]);
  });
});

describe('uit dienst in één handeling (POST /api/users/:id/uitdienst)', () => {
  it('deactiveert, trekt alle toestellen in, wist de push-abonnementen en logt één regel', async () => {
    mem.devices.push({ userId: '3', deviceToken: 'dev-2', name: 'iPad', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });
    mem.pushSubscriptions.push({ userId: '3', endpoint: 'https://push.example/a', p256dh: 'k', auth: 'a' }, { userId: '4', endpoint: 'https://push.example/b', p256dh: 'k', auth: 'a' });
    const res = await api('POST', '/api/users/3/uitdienst', { token: 'tok-admin', body: { reden: 'Einde contract' } });
    expect(res.status).toBe(200);
    expect(res.json.samenvatting).toEqual({ toestellen: 2, push: 1, sessies: 'gebannen' });
    expect(res.json.user.isActive).toBe(false);
    expect(res.json.user._rev).toBeTruthy();
    expect(res.json.stappen.every((s: any) => s.ok)).toBe(true);
    expect(mem.users.find((u: any) => u.id === '3').isActive).toBe(false);
    expect(mem.devices.filter((d: any) => d.userId === '3').every((d: any) => d.status === 'revoked')).toBe(true);
    // Alleen de abonnementen van chauffeur 3 weg, die van 4 blijven.
    expect(mem.pushSubscriptions.map((s: any) => s.userId)).toEqual(['4']);
    const regel = mem.activity.find((a) => a.action === 'Uit dienst');
    expect(regel?.entityId).toBe('3');
    expect(regel?.message).toBe('Chauffeur A: account gedeactiveerd, 2 toestellen ingetrokken, 1 push-abonnement gewist. Reden: Einde contract.');
    // Het gedeactiveerde account kan de API niet meer gebruiken.
    expect((await api('GET', '/api/updates', { token: 'tok-a' })).status).toBe(403);
  });

  it('is idempotent: nogmaals op een al inactieve gebruiker geeft 200 met nullen', async () => {
    mem.pushSubscriptions.push({ userId: '3', endpoint: 'https://push.example/a', p256dh: 'k', auth: 'a' });
    expect((await api('POST', '/api/users/3/uitdienst', { token: 'tok-admin' })).json.samenvatting).toEqual({ toestellen: 1, push: 1, sessies: 'gebannen' });
    const weer = await api('POST', '/api/users/3/uitdienst', { token: 'tok-admin' });
    expect(weer.status).toBe(200);
    expect(weer.json.samenvatting).toEqual({ toestellen: 0, push: 0, sessies: 'gebannen' });
    expect(weer.json.stappen.find((s: any) => s.stap === 'deactiveren')?.detail).toMatch(/al gedeactiveerd/);
    expect(mem.activity.filter((a) => a.action === 'Uit dienst')).toHaveLength(2);
  });

  it('een tweede poging (Opnieuw proberen na een verloren antwoord) verandert niets meer: zelfde eindtoestand, alleen een eerlijke auditregel', async () => {
    mem.devices.push({ userId: '3', deviceToken: 'dev-3', name: 'iPhone', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });
    const eerste = await api('POST', '/api/users/3/uitdienst', { token: 'tok-admin', body: { reden: 'Einde contract' } });
    expect(eerste.status).toBe(200);
    const naEerste = {
      user: JSON.stringify(mem.users.find((u: any) => u.id === '3')),
      devices: JSON.stringify(mem.devices),
      push: JSON.stringify(mem.pushSubscriptions),
      andereActiviteit: mem.activity.filter((a) => a.action !== 'Uit dienst').length,
      meldingen: mem.meldingen.length,
    };
    const tweede = await api('POST', '/api/users/3/uitdienst', { token: 'tok-admin', body: { reden: 'Einde contract' } });
    expect(tweede.status).toBe(200);
    expect(tweede.json.user.isActive).toBe(false);
    expect(tweede.json.stappen.every((s: any) => s.ok)).toBe(true);
    expect(tweede.json.samenvatting).toEqual({ toestellen: 0, push: 0, sessies: 'gebannen' });
    // Gebruiker, toestellen en push-abonnementen ongewijzigd; geen andere logregels (geen tweede deactivering).
    expect(JSON.stringify(mem.users.find((u: any) => u.id === '3'))).toBe(naEerste.user);
    expect(JSON.stringify(mem.devices)).toBe(naEerste.devices);
    expect(JSON.stringify(mem.pushSubscriptions)).toBe(naEerste.push);
    expect(mem.activity.filter((a) => a.action !== 'Uit dienst')).toHaveLength(naEerste.andereActiviteit);
    expect(mem.meldingen).toHaveLength(naEerste.meldingen);
    const regels = mem.activity.filter((a) => a.action === 'Uit dienst');
    expect(regels).toHaveLength(2);
    expect(regels.map((r) => r.message).find((m) => m.includes('was al gedeactiveerd'))).toBe('Chauffeur A: account was al gedeactiveerd, 0 toestellen ingetrokken, 0 push-abonnementen gewist. Reden: Einde contract.');
  });

  it('weigert een planner (403), jezelf (400) en een onbekende (404)', async () => {
    expect((await api('POST', '/api/users/3/uitdienst', { token: 'tok-planner' })).status).toBe(403);
    expect((await api('POST', '/api/users/1/uitdienst', { token: 'tok-admin' })).status).toBe(400);
    expect((await api('POST', '/api/users/bestaat-niet/uitdienst', { token: 'tok-admin' })).status).toBe(404);
    expect(mem.users.every((u: any) => u.isActive !== false)).toBe(true);
    expect(mem.activity.some((a) => a.action === 'Uit dienst')).toBe(false);
  });

  it('beschermt de laatste actieve admin (400), ook als de eigen rol intussen gewijzigd is', async () => {
    // Auth-cache warm met Annelies als admin; daarna wisselt een andere
    // sessie de rollen: Pieter wordt de enige actieve admin. Zonder de
    // countAdmins-vangrail zou Annelies (cache: admin) hem nu uit dienst
    // kunnen zetten en bleef er geen admin over.
    // Twee keer: de eerste aanmelding koppelt de authId en leegt de cache.
    await api('GET', '/api/users', { token: 'tok-admin' });
    expect((await api('GET', '/api/users', { token: 'tok-admin' })).status).toBe(200);
    mem.users = mem.users.map((u: any) => (u.id === '1' ? { ...u, role: 'planner' } : u.id === '2' ? { ...u, role: 'admin' } : u));
    const res = await api('POST', '/api/users/2/uitdienst', { token: 'tok-admin' });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/minstens 1 actieve admin/);
    expect(mem.users.find((u: any) => u.id === '2').isActive).toBe(true);
  });
});

// Rol "technieker" (Jarno 09-09): eigen verlof en meldingen, maar géén
// diensten, niet inplanbaar, en vooral: GEEN plannerrechten. Dat laatste was
// het risico — de code gebruikte op veel plekken `role !== 'chauffeur'` als
// synoniem voor "dus staf".
describe('rol technieker', () => {
  // Alleen in dit blok: de gedeelde fixture houdt 4 gebruikers, en tests die
  // gebruikers tellen mogen daar niet op stuklopen.
  beforeEach(() => {
    mem.users.push({ id: '5', name: 'Tom Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true });
    // Een technieker valt onder dezelfde toestel-gate als een chauffeur, dus
    // hij heeft net als zij een goedgekeurd toestel nodig.
    mem.devices.push({ userId: '5', deviceToken: 'dev-ok', name: 'Windows-pc · browser', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    invalidateUsersCache();
  });

  it('krijgt geen stafrechten op verlof: ziet alleen eigen verlof en mag niet beslissen', async () => {
    const lijst = await api('GET', '/api/leave', { token: 'tok-tech' });
    expect(lijst.status).toBe(200);
    // Alleen eigen rijen (er zijn er geen), zeker niet die van de chauffeurs.
    expect(lijst.json.every((l: any) => String(l.userId) === '5')).toBe(true);
    expect(lijst.json.length).toBeLessThan(mem.leave.length);
    // Beslissen blijft planner/admin.
    const beslis = await api('PATCH', '/api/leave/l-a1', { token: 'tok-tech', body: { status: 'approved', ifStatus: 'pending' } });
    expect(beslis.status).toBe(403);
  });

  it('mag wel eigen verlof aanvragen, en dat gaat als wachtende aanvraag naar de planning', async () => {
    const nieuw = { id: 'l-tech', userId: '5', startDate: '2026-10-05', endDate: '2026-10-06', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-09-09T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-tech', body: [nieuw] });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l: any) => l.id === 'l-tech')?.status).toBe('pending');
    // Zelfde behandeling als een chauffeur: de planning krijgt een seintje.
    expect(mem.pushesSent.some((p) => p.payload.title === 'Nieuwe verlofaanvraag')).toBe(true);
  });

  it('kan niet voor een ander schrijven en niet als gezaghebbende payload opslaan', async () => {
    const vanCollega = { id: 'l-fraude', userId: '3', startDate: '2026-10-05', endDate: '2026-10-06', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-09-09T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-tech', body: [vanCollega] });
    expect(res.status).toBe(403);
    expect(mem.leave.find((l: any) => l.id === 'l-fraude')).toBeUndefined();
    // En het weglaten van bestaande rijen verwijdert niets (geen staf-payload).
    const bestaandeIds = mem.leave.map((l: any) => l.id).sort();
    await api('POST', '/api/leave', { token: 'tok-tech', body: [] });
    expect(mem.leave.map((l: any) => l.id).sort()).toEqual(bestaandeIds);
  });

  it('ziet geen ruilen van anderen en geen staf-only overzichten', async () => {
    const ruilen = await api('GET', '/api/swaps', { token: 'tok-tech' });
    expect(ruilen.status).toBe(200);
    expect(ruilen.json).toEqual([]);
    const maand = await api('GET', '/api/month-planning?month=2026-09&format=summary', { token: 'tok-tech' });
    expect(maand.status).toBe(403);
  });

  it('kan niet ziek gemeld worden: dat is voor rijdend personeel', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '5', startDate: '2026-09-02' } });
    expect(res.status).toBe(400);
    expect(mem.leave.some((l: any) => l.type === 'ziekte' && String(l.userId) === '5')).toBe(false);
  });

  it('valt onder de toestel-gate, net als een chauffeur', async () => {
    mem.devices.push({ userId: '5', deviceToken: 'dev-tech', name: 'Windows-pc', status: 'revoked', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });
    const res = await api('GET', '/api/leave', { token: 'tok-tech', device: 'dev-tech' });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('device_revoked');
  });
});

// "Ook technieker" (Jarno 28-09): een chauffeur die ook in de garage werkt.
// Alleen een admin zet de schakelaar, de chauffeur zelf niet, en hij geeft
// geen stafrechten. De techniekroutes zelf: src/techniekToegangRoutes.test.ts.
describe('Ook technieker', () => {
  const REV = 'x-record-revision';
  const revVan = async (id: string): Promise<string> => {
    const res = await api('GET', '/api/users', { token: 'tok-admin' });
    return res.json.find((r: any) => String(r.id) === id)?._rev as string;
  };
  const zetSchakelaar = () => {
    mem.users = mem.users.map((u: any) => (u.id === '3' ? { ...u, ookTechnieker: true } : u));
    invalidateUsersCache();
  };

  it('een admin zet de schakelaar bij een chauffeur, en het activiteitenlog zegt het', async () => {
    const res = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], ookTechnieker: true }, headers: { [REV]: await revVan('3') } });
    expect(res.status).toBe(200);
    expect(res.json.user.ookTechnieker).toBe(true);
    const regel = mem.activity.find((a) => a.action === 'Gebruiker gewijzigd' && a.entityId === '3');
    expect(regel?.message).toContain('ook technieker: uit→aan');
  });

  it('verlofbudget per jaar (09-10): een admin bewaart een afwijkend jaar, het komt terug en het log noemt het; een ongeldig jaar is een 400', async () => {
    const res = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], verlofBudget: 20, verlofBudgetten: { '2027': 18 } }, headers: { [REV]: await revVan('3') } });
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ verlofBudget: 20, verlofBudgetten: { '2027': 18 } });
    const lijst = await api('GET', '/api/users', { token: 'tok-admin' });
    expect(lijst.json.find((u: any) => String(u.id) === '3').verlofBudgetten).toEqual({ '2027': 18 });
    const regel = mem.activity.find((a) => a.action === 'Gebruiker gewijzigd' && a.entityId === '3');
    expect(regel?.message).toContain('verlofbudget per jaar: geen→2027: 18');

    const fout = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], verlofBudgetten: { '27': 18 } }, headers: { [REV]: await revVan('3') } });
    expect(fout.status).toBe(400);
    const negatief = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], verlofBudgetten: { '2027': -1 } }, headers: { [REV]: await revVan('3') } });
    expect(negatief.status).toBe(400);
  });

  it('de chauffeur kan hem niet zelf aanzetten', async () => {
    const put = await api('PUT', '/api/users/3', { token: 'tok-a', body: { ...mem.users[2], ookTechnieker: true }, headers: { [REV]: 'x' } });
    expect(put.status).toBe(403);
    const lijst = await api('POST', '/api/users', { token: 'tok-a', body: mem.users.map((u: any) => (u.id === '3' ? { ...u, ookTechnieker: true } : u)) });
    expect(lijst.status).toBe(403);
    expect(mem.users.find((u: any) => u.id === '3')?.ookTechnieker).toBeUndefined();
  });

  it('/api/me geeft hem mee; een collega-chauffeur ziet hem niet, de planner wel', async () => {
    zetSchakelaar();
    const me = await api('GET', '/api/me', { token: 'tok-a' });
    expect(me.status).toBe(200);
    expect(me.json.ookTechnieker).toBe(true);
    const collega = await api('GET', '/api/users', { token: 'tok-b' });
    expect(collega.json.find((u: any) => u.id === '3')).not.toHaveProperty('ookTechnieker');
    const planner = await api('GET', '/api/users', { token: 'tok-planner' });
    expect(planner.json.find((u: any) => u.id === '3')?.ookTechnieker).toBe(true);
  });

  it('geeft geen stafrechten: het loonscherm Dagadministratie, verlof beslissen en de maandplanning blijven dicht', async () => {
    zetSchakelaar();
    expect((await api('GET', '/api/dagafsluiting/2026-09-27', { token: 'tok-a' })).status).toBe(403);
    expect((await api('PATCH', '/api/leave/l-b1', { token: 'tok-a', body: { status: 'approved', ifStatus: 'pending' } })).status).toBe(403);
    expect((await api('GET', '/api/month-planning?month=2026-09&format=summary', { token: 'tok-a' })).status).toBe(403);
  });
});

describe('/api/me draagt het toestel-oordeel en, voor staf, de beveiligingsstatus (punt 19, 15-09)', () => {
  it('chauffeur op een goedgekeurd toestel: profiel + toestel.approved, geen beveiliging', async () => {
    const res = await api('GET', '/api/me', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe('3');
    expect(res.json.toestel).toMatchObject({ status: 'approved' });
    expect(typeof res.json.toestel.gateActief).toBe('boolean');
    expect(res.json.beveiliging).toBeUndefined();
  });

  it('staf: beveiliging { mfaVerplicht, aal } zit in het profiel (geen aparte roundtrip nodig)', async () => {
    const res = await api('GET', '/api/me', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json.beveiliging).toEqual({ mfaVerplicht: false, aal: 'aal1' });
    // Staf zonder toestelrij: het oordeel is 'onbekend', de gate laat staf door.
    expect(res.json.toestel.status).toBe('onbekend');
  });

  it('de toestel-gate op /api/me is ongewijzigd: wachtend en geblokkeerd blijven 403 met code', async () => {
    mem.devices.push(
      { userId: '3', deviceToken: 'dev-pending', name: 'x', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
      { userId: '3', deviceToken: 'dev-revoked', name: 'x', status: 'revoked', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
    );
    const pending = await api('GET', '/api/me', { token: 'tok-a', device: 'dev-pending' });
    expect(pending.status).toBe(403);
    expect(pending.json?.code).toBe('device_pending');
    const revoked = await api('GET', '/api/me', { token: 'tok-a', device: 'dev-revoked' });
    expect(revoked.status).toBe(403);
    expect(revoked.json?.code).toBe('device_revoked');
    const onbekend = await api('GET', '/api/me', { token: 'tok-a', device: 'dev-vreemd' });
    expect(onbekend.status).toBe(403);
    expect(onbekend.json?.code).toBe('device_unknown');
  });
});

// Tranche 3B, eis B (Jarno 23-09): pauzeren/activeren en de 2FA-reset staan
// sinds 3B.1 ook in het rijmenu op de telefoon. De server beslist: exact de
// requests die de UI stuurt (snelle knop = PUT /api/users/:id met het hele
// record en isActive omgedraaid + X-Record-Revision; bulkbalk = POST
// /api/users met de hele lijst + X-Collection-Revision; 2FA = POST
// /api/admin/users/:id/mfa-reset) weigeren een planner en een chauffeur
// (403) en een anonieme aanroep (401), zonder iets te wijzigen.
describe('gebruikers pauzeren/activeren en 2FA-reset: alleen admin (tranche 3B)', () => {
  const REC = 'x-record-revision';
  const COLL = 'x-collection-revision';
  const recRev = async (id: string) => (await api('GET', '/api/users', { token: 'tok-admin' })).json.find((u: any) => String(u.id) === id)._rev as string;
  const collRev = async () => (await api('GET', '/api/users', { token: 'tok-admin' })).headers.get(COLL)!;
  const actief = (id: string) => mem.users.find((u: any) => String(u.id) === id)?.isActive;

  describe('snelle knop (PUT /api/users/:id)', () => {
    it.each([['planner', 'tok-planner'], ['chauffeur', 'tok-a']])('een %s kan niet pauzeren: 403, gebruiker blijft actief', async (_rol, token) => {
      const rev = await recRev('4');
      const res = await api('PUT', '/api/users/4', { token, body: { ...mem.users[3], isActive: false }, headers: { [REC]: rev } });
      expect(res.status).toBe(403);
      expect(actief('4')).toBe(true);
      expect(mem.activity.some((a) => a.entityId === '4')).toBe(false);
    });

    it.each([['planner', 'tok-planner'], ['chauffeur', 'tok-a']])('een %s kan niet activeren: 403, gebruiker blijft gepauzeerd', async (_rol, token) => {
      mem.users = mem.users.map((u: any) => (u.id === '4' ? { ...u, isActive: false } : u));
      const rev = await recRev('4');
      const res = await api('PUT', '/api/users/4', { token, body: { ...mem.users[3], isActive: true }, headers: { [REC]: rev } });
      expect(res.status).toBe(403);
      expect(actief('4')).toBe(false);
    });

    it('zonder aanmelding: 401, niets gewijzigd', async () => {
      const rev = await recRev('4');
      const res = await api('PUT', '/api/users/4', { body: { ...mem.users[3], isActive: false }, headers: { [REC]: rev } });
      expect(res.status).toBe(401);
      expect(actief('4')).toBe(true);
    });

    it('een admin pauzeert en activeert weer', async () => {
      const pauze = await api('PUT', '/api/users/4', { token: 'tok-admin', body: { ...mem.users[3], isActive: false }, headers: { [REC]: await recRev('4') } });
      expect(pauze.status).toBe(200);
      expect(actief('4')).toBe(false);
      const terug = await api('PUT', '/api/users/4', { token: 'tok-admin', body: { ...mem.users[3], isActive: true }, headers: { [REC]: await recRev('4') } });
      expect(terug.status).toBe(200);
      expect(actief('4')).toBe(true);
    });
  });

  describe('bulkbalk (POST /api/users met de hele lijst)', () => {
    it.each([['planner', 'tok-planner'], ['chauffeur', 'tok-a']])('een %s kan niet in bulk pauzeren: 403, iedereen blijft actief', async (_rol, token) => {
      const rev = await collRev();
      const res = await api('POST', '/api/users', { token, body: mem.users.map((u: any) => (u.role === 'chauffeur' ? { ...u, isActive: false } : u)), headers: { [COLL]: rev } });
      expect(res.status).toBe(403);
      // (De aanmelding zelf koppelt wel de authId van de chauffeur; dat is geen wijziging door de aanvraag.)
      expect(mem.users.map((u: any) => u.isActive)).toEqual([true, true, true, true]);
      expect(mem.users).toHaveLength(4);
    });

    it('zonder aanmelding: 401', async () => {
      const res = await api('POST', '/api/users', { body: mem.users.map((u: any) => ({ ...u, isActive: false })), headers: { [COLL]: await collRev() } });
      expect(res.status).toBe(401);
      expect(mem.users.every((u: any) => u.isActive)).toBe(true);
    });

    it('een admin pauzeert in bulk', async () => {
      const res = await api('POST', '/api/users', { token: 'tok-admin', body: mem.users.map((u: any) => (u.role === 'chauffeur' ? { ...u, isActive: false } : u)), headers: { [COLL]: await collRev() } });
      expect(res.status).toBe(200);
      expect([actief('3'), actief('4')]).toEqual([false, false]);
    });
  });

  describe('twee-stapsverificatie resetten (POST /api/admin/users/:id/mfa-reset)', () => {
    const mfaAttrap = () => {
      const gewist: string[] = [];
      const gelezen: string[] = [];
      mem.supabaseAdmin = {
        auth: {
          admin: {
            mfa: {
              listFactors: async ({ userId }: { userId: string }) => { gelezen.push(userId); return { data: { factors: [{ id: 'f-1' }] }, error: null }; },
              deleteFactor: async ({ id }: { id: string }) => { gewist.push(id); return { data: {}, error: null }; },
            },
          },
        },
      };
      mem.users = mem.users.map((u: any) => (u.id === '2' ? { ...u, authId: 'auth-tok-planner' } : u));
      return { gewist, gelezen };
    };

    it.each([['planner', 'tok-planner'], ['chauffeur', 'tok-a']])('een %s krijgt 403 en er wordt geen factor gelezen of gewist', async (_rol, token) => {
      const { gewist, gelezen } = mfaAttrap();
      for (const doel of ['1', '2']) {
        expect((await api('POST', `/api/admin/users/${doel}/mfa-reset`, { token })).status).toBe(403);
      }
      expect(gelezen).toEqual([]);
      expect(gewist).toEqual([]);
      expect(mem.activity.some((a) => a.action === 'Twee-stapsverificatie gereset')).toBe(false);
    });

    it('zonder aanmelding: 401, niets gewist', async () => {
      const { gewist } = mfaAttrap();
      expect((await api('POST', '/api/admin/users/2/mfa-reset', {})).status).toBe(401);
      expect(gewist).toEqual([]);
    });

    it('een admin reset de factoren van een planner en het wordt gelogd', async () => {
      const { gewist, gelezen } = mfaAttrap();
      const res = await api('POST', '/api/admin/users/2/mfa-reset', { token: 'tok-admin' });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ success: true, verwijderd: 1 });
      expect(gelezen).toEqual(['auth-tok-planner']);
      expect(gewist).toEqual(['f-1']);
      expect(mem.activity.filter((a) => a.action === 'Twee-stapsverificatie gereset')).toHaveLength(1);
    });
  });
});
