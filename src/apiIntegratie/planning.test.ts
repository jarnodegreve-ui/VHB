// @vitest-environment node
import {
  api,
  baseUrl,
  invalidateUsersCache,
  mem,
} from './harnas';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { PLATFORM_GRENS_BYTES, matrixVerzoek, pakBestandIn } from '../lib/bestandInpakken';

describe('beschikbaarheid, wie geen staf is krijgt geen dag van vóór de maandag van deze week (Jarno 02-10)', () => {
  // Zelfde terugblikregel als de Maandplanning: /api/availability gaf elke
  // ingelogde gebruiker per dag wie reed en met welke dienst, ook voor een
  // periode die al lang voorbij is. De wizard van de dienstruil vraagt alleen
  // vandaag en later; een kale fetch op een oude periode mag niets teruggeven.
  // Vrijdag 02/10/2026, 11:00 in Brussel: de grens is maandag 28/09.
  const GRENS = '2026-09-28';
  const NIET_STAF = [
    ['chauffeur', 'tok-a'],
    ['technieker', 'tok-tech'],
    ['chauffeur met "Ook technieker"', 'tok-b'],
  ] as const;
  const STAF = [['planner', 'tok-planner'], ['admin', 'tok-admin']] as const;
  const bereik = (from: string, to: string, token: string, extra = '') =>
    api('GET', `/api/availability?from=${from}&to=${to}${extra}`, { token });
  const dagenVan = (res: { json: any }) => res.json.days.map((d: any) => d.date);
  const reeks = (van: string, aantal: number) => Array.from({ length: aantal }, (_, i) => {
    const d = new Date(`${van}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    mem.users = [
      ...mem.users.map((u: any) => (u.id === '4' ? { ...u, ookTechnieker: true } : u)),
      { id: '5', name: 'Toon Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true },
    ];
    // Een technieker valt onder dezelfde toestel-gate als een chauffeur.
    mem.devices.push({ userId: '5', deviceToken: 'dev-ok', name: 'Windows-pc · browser', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    invalidateUsersCache();
    mem.planning = [
      { id: 'v-1', driverId: '3', date: '2026-09-14', line: '12' },
      { id: 'v-2', driverId: '4', date: '2026-09-27', line: '14' },
      { id: 'v-3', driverId: '3', date: '2026-09-28', line: '12' },
      { id: 'v-4', driverId: '4', date: '2026-10-01', line: '14' },
      { id: 'v-5', driverId: '3', date: '2026-10-05', line: '12' },
    ];
    // 14/09: B staat op bv (een overname kon die dag); 05/10 ook.
    mem.planningMatrix = [
      { id: 'm-oud', source_date: '2026-09-14', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'bv' }, raw_row: '' },
      { id: 'm-nieuw', source_date: '2026-10-05', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'bv' }, raw_row: '' },
    ];
    // Verlof van vóór de grens: ook wie afwezig was hoort bij het verleden.
    mem.leave = [
      { id: 'l-oud', userId: '4', startDate: '2026-09-21', endDate: '2026-09-22', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-09-01T08:00:00Z', decidedAt: '2026-09-02T08:00:00Z' },
    ];
    mem.swaps = [];
  });

  for (const [wie, token] of NIET_STAF) {
    it(`${wie}: een bereik dat helemaal voorbij is geeft dezelfde vorm zonder dagen, geen fout, en laadt niets`, async () => {
      const res = await bereik('2026-09-01', '2026-09-27', token);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ from: '2026-09-01', to: '2026-09-27', drivers: [], days: [], zichtbaarVanaf: GRENS });
      // Ook de dag vlak vóór de grens, en met de overname-vlag erbij.
      const zondag = await bereik('2026-09-27', '2026-09-27', token, '&takeover=1');
      expect(zondag.status).toBe(200);
      expect(zondag.json.days).toEqual([]);
      const oud = await bereik('2026-09-14', '2026-09-14', token, '&takeover=1');
      expect(oud.json.days).toEqual([]);
      // Geen planning en geen matrix opgehaald voor een antwoord zonder dagen.
      expect(mem.planningMaandFilters).toEqual([]);
      expect(mem.matrixMaandFilters).toEqual([]);
    });

    it(`${wie}: een bereik over de grens begint op de maandag van deze week`, async () => {
      const res = await bereik('2026-09-14', '2026-10-05', token, '&takeover=1');
      expect(res.status).toBe(200);
      expect(dagenVan(res)).toEqual(reeks(GRENS, 8));
      expect(res.json.zichtbaarVanaf).toBe(GRENS);
      // Niets van vóór de grens: geen dag, geen dienst, geen verlof, geen overname.
      const dagen = JSON.stringify(res.json.days);
      for (const oud of ['2026-09-14', '2026-09-21', '2026-09-22', '2026-09-27']) expect(dagen).not.toContain(oud);
      expect(res.json.days.every((d: any) => d.leave.length === 0)).toBe(true);
      // De dagen erna zijn volledig, zoals voorheen.
      expect(res.json.days[0]).toMatchObject({ date: GRENS, working: ['3'], lines: { '3': '12' } });
      expect(res.json.days[7]).toMatchObject({ date: '2026-10-05', working: ['3'], lines: { '3': '12' }, takeover: { '4': 'bv' } });
      expect(res.json.drivers.map((d: any) => d.id)).toEqual(['3', '4']);
      // De planning van september wordt nog gelezen (28/09 tot 30/09 hoort erbij),
      // maar alleen de rijen vanaf de grens komen in het antwoord.
      expect([...mem.planningMaandFilters].sort()).toEqual(['2026-09', '2026-10']);
    });

    it(`${wie}: de lopende week blijft volledig, ook de dagen die al voorbij zijn, en de toekomst ook`, async () => {
      const week = await bereik(GRENS, '2026-10-04', token);
      expect(dagenVan(week)).toEqual(reeks(GRENS, 7));
      // Donderdag 01/10 is voorbij maar hoort bij de lopende week.
      expect(week.json.days[3]).toMatchObject({ date: '2026-10-01', working: ['4'], lines: { '4': '14' } });
      // Wat de wizard echt vraagt: vandaag tot en met 56 dagen verder.
      const wizard = await bereik('2026-10-02', '2026-11-27', token);
      expect(wizard.status).toBe(200);
      expect(dagenVan(wizard)).toEqual(reeks('2026-10-02', 57));
      expect(wizard.json.days[3]).toMatchObject({ date: '2026-10-05', working: ['3'], lines: { '3': '12' }, free: ['4'] });
    });
  }

  for (const [wie, token] of STAF) {
    it(`${wie} ziet alles zoals voorheen, zonder grens in het antwoord`, async () => {
      const voor = await bereik('2026-09-01', '2026-09-27', token);
      expect(voor.status).toBe(200);
      expect(dagenVan(voor)).toEqual(reeks('2026-09-01', 27));
      expect(Object.keys(voor.json).sort()).toEqual(['days', 'drivers', 'from', 'to']);
      expect(voor.json.days[13]).toMatchObject({ date: '2026-09-14', working: ['3'], lines: { '3': '12' } });
      expect(voor.json.days[20]).toMatchObject({ date: '2026-09-21', leave: ['4'] });
      expect(voor.json.days[26]).toMatchObject({ date: '2026-09-27', working: ['4'], lines: { '4': '14' } });

      const over = await bereik('2026-09-14', '2026-10-05', token, '&takeover=1');
      expect(dagenVan(over)).toEqual(reeks('2026-09-14', 22));
      expect(over.json.days[0]).toMatchObject({ date: '2026-09-14', working: ['3'], takeover: { '4': 'bv' } });
      expect(over.json).not.toHaveProperty('zichtbaarVanaf');

      const na = await bereik('2026-10-05', '2026-10-06', token);
      expect(dagenVan(na)).toEqual(['2026-10-05', '2026-10-06']);
    });
  }

  it('de week wisselt om middernacht in Brussel: zondagavond telt de voorbije week nog, maandag 00:30 niet meer', async () => {
    // Zondag 04/10, 23:30 in Brussel.
    vi.setSystemTime(new Date('2026-10-04T21:30:00Z'));
    const zondag = await bereik('2026-09-25', '2026-10-06', 'tok-a');
    expect(zondag.json.zichtbaarVanaf).toBe(GRENS);
    expect(dagenVan(zondag)).toEqual(reeks(GRENS, 9));
    // Maandag 05/10, 00:30 in Brussel; de klok van de server (UTC) staat nog op zondag.
    vi.setSystemTime(new Date('2026-10-04T22:30:00Z'));
    const maandag = await bereik('2026-09-25', '2026-10-06', 'tok-a');
    expect(maandag.json.zichtbaarVanaf).toBe('2026-10-05');
    expect(dagenVan(maandag)).toEqual(['2026-10-05', '2026-10-06']);
    expect(JSON.stringify(maandag.json.days)).not.toContain('2026-10-01');
    // De week die net voorbij is geeft nu niets meer.
    expect((await bereik(GRENS, '2026-10-04', 'tok-a')).json.days).toEqual([]);
  });

  it('de grens van 120 dagen en de datumcontrole gelden vóór de knip, voor iedereen', async () => {
    for (const token of ['tok-a', 'tok-planner']) {
      const teBreed = await bereik('2026-06-01', '2026-10-05', token);
      expect(teBreed.status).toBe(400);
      expect(teBreed.json.error).toContain('maximaal 120 dagen');
      expect((await bereik('2026-10-05', '2026-10-01', token)).status).toBe(400);
    }
    expect(mem.planningMaandFilters).toEqual([]);
  });
});

describe('planning automatisch bijwerken na het dienstoverzicht', () => {
  const WACHTRIJ = 'rooster_melding_wachtrij';
  const CRON = { headers: { Authorization: 'Bearer test-cron-secret' } };
  const metDienst12 = (patch: Record<string, unknown>) =>
    mem.services.map((s: any) => (s.serviceNumber === '12' ? { ...s, ...patch } : s));
  const automatischLog = () => mem.activity.filter((a: any) => String(a.action).startsWith('Planning automatisch') || String(a.action).startsWith('Planning niet automatisch'));
  const roosterPushes = () => mem.pushesSent.filter((p: any) => p.payload.title === 'Rooster bijgewerkt');
  /** Wachtrij oud genoeg maken zonder de klok te verzetten: de cron kijkt naar `laatsteWijziging`. */
  const maakWachtrijRijp = () => {
    const w: any = mem.appSettings[WACHTRIJ];
    mem.appSettings[WACHTRIJ] = { ...w, laatsteWijziging: new Date(Date.now() - 11 * 60 * 1000).toISOString() };
  };

  // Uitgangspunt van elke test: een planning die klopt met matrix en
  // dienstoverzicht (zoals in productie na een import of heropbouw).
  // 01/07: A rijdt 12, B rijdt 14. 08/07: A rijdt 12, B heeft bv.
  beforeEach(async () => {
    mem.planningCodes = [
      { code: 'bv', category: 'absence', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false },
      { code: 'vrij', category: 'absence', description: 'Geen dienst', countsAsShift: false, isPaidAbsence: false, isDayOff: true },
    ];
    mem.swaps = [];
    const opbouw = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-admin' });
    expect(opbouw.status).toBe(200);
    mem.activity = [];
    mem.pushesSent = [];
    mem.meldingen = [];
    mem.appSettings = {};
  });

  it('de knop met ?droog=1 schrijft niets en geeft per chauffeur de dagen die zouden veranderen (09-10)', async () => {
    // Dienst 12 (chauffeur A, 01/07 en 08/07) krijgt een andere starttijd in
    // het dienstoverzicht; de planning is nog niet bijgewerkt.
    mem.services = metDienst12({ startTime: '08:45' });
    const voor = JSON.stringify(mem.planning);
    const res = await api('POST', '/api/planning/sync-from-matrix?droog=1', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json.droog).toBe(true);
    expect(res.json.plan.totaal).toEqual({ chauffeurs: 1, dagen: 2, erbij: 0, weg: 0, gewijzigd: 2 });
    expect(res.json.plan.chauffeurs).toHaveLength(1);
    expect(res.json.plan.chauffeurs[0]).toMatchObject({ id: '3', naam: 'Chauffeur A' });
    expect(res.json.plan.chauffeurs[0].dagen.map((d: any) => d.dag)).toEqual(['2026-07-01', '2026-07-08']);
    expect(res.json.plan.chauffeurs[0].dagen[0].was[0]).toContain('dienst 12');
    expect(res.json.plan.chauffeurs[0].dagen[0].wordt[0]).toContain('08:45');
    expect(res.json.plan.diensten).toBeGreaterThan(0);
    // Niets geschreven, gelogd of gemeld.
    expect(JSON.stringify(mem.planning)).toBe(voor);
    expect(mem.activity.filter((a: any) => a.action === 'Planning opnieuw opgebouwd')).toEqual([]);
    expect(roosterPushes()).toHaveLength(0);
    // Na de echte heropbouw is er niets meer te doen.
    expect((await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-admin' })).status).toBe(200);
    const leeg = await api('POST', '/api/planning/sync-from-matrix?droog=1', { token: 'tok-admin' });
    expect(leeg.json.plan.totaal.chauffeurs).toBe(0);
    expect(leeg.json.plan.chauffeurs).toEqual([]);
  });

  it('(a) een gewijzigde dienst herbouwt de planning, logt de automatische bron en stelt de melding uit', async () => {
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30', endTime: '16:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.planning).toMatchObject({ status: 'bijgewerkt', gewijzigdeChauffeurs: 1, meldingUitgesteld: true, meldingNaMinuten: 10 });
    const dienst12 = mem.planning.filter((p: any) => String(p.line) === '12');
    expect(dienst12).toHaveLength(2);
    for (const rij of dienst12) expect(rij).toMatchObject({ driverId: '3', startTime: '08:30', endTime: '16:30' });
    // Dienst 14 van chauffeur B is niet aangeraakt.
    expect(mem.planning.find((p: any) => String(p.line) === '14')).toMatchObject({ driverId: '4', startTime: '10:00', endTime: '18:00' });
    // Het logboek noemt de bron; de handmatige knop heeft een andere actie.
    const log = automatischLog();
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe('Planning automatisch bijgewerkt');
    expect(log[0].message).toContain('wijziging in het dienstoverzicht');
    expect(mem.activity.some((a: any) => a.action === 'Planning opnieuw opgebouwd')).toBe(false);
    // Nog geen push: chauffeur A staat in de wachtrij.
    expect(roosterPushes()).toHaveLength(0);
    expect(Object.keys((mem.appSettings[WACHTRIJ] as any).basis)).toEqual(['3']);
  });

  it('(b) een save zonder inhoudelijk verschil bouwt niets op', async () => {
    const voor = mem.planning;
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: mem.services.map((s: any) => ({ ...s })) });
    expect(res.status).toBe(200);
    expect(res.json.planning).toEqual({ status: 'niet-nodig' });
    expect(mem.planning).toBe(voor);
    expect(automatischLog()).toHaveLength(0);
    expect(mem.appSettings[WACHTRIJ]).toBeUndefined();
  });

  it('(b) verse ids bij een Excel-import van identieke diensten tellen niet als wijziging', async () => {
    const voor = mem.planning;
    const res = await api('POST', '/api/services', {
      token: 'tok-admin', headers: { 'x-bulk-replace': '1' },
      body: mem.services.map((s: any, i: number) => ({ ...s, id: `vers-${i}` })),
    });
    expect(res.status).toBe(200);
    expect(res.json.planning).toEqual({ status: 'niet-nodig' });
    expect(mem.planning).toBe(voor);
  });

  it('(b) een gewijzigde dienst die niemand rijdt schrijft de planning niet opnieuw weg', async () => {
    const voor = mem.planning;
    const res = await api('POST', '/api/services', {
      token: 'tok-planner',
      body: mem.services.map((s: any) => (s.serviceNumber === '10' ? { ...s, startTime: '05:45' } : s)),
    });
    expect(res.status).toBe(200);
    expect(res.json.planning).toEqual({ status: 'ongewijzigd' });
    expect(mem.planning).toBe(voor);
    expect(roosterPushes()).toHaveLength(0);
  });

  it('(c) een geblokkeerde heropbouw laat de save slagen en meldt de blokkade', async () => {
    mem.planningMatrix = [...mem.planningMatrix, { id: 'm-x', source_date: '2026-07-09', day_type: 'week', assignments: { 'Chauffeur A': 'XYZ' }, raw_row: '' }];
    const voor = mem.planning;
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    // De diensten zijn wél opgeslagen…
    expect(mem.services.find((s: any) => s.serviceNumber === '12').startTime).toBe('08:30');
    // …de planning niet, en het antwoord zegt waarom en waarheen.
    expect(res.json.planning).toMatchObject({ status: 'geblokkeerd', reden: 'onbekende-codes', unknownCodes: ['XYZ'] });
    expect(res.json.planning.melding).toContain('XYZ');
    expect(res.json.planning.melding).toContain('Beheer planning');
    expect(mem.planning).toBe(voor);
    expect(automatischLog().map((a: any) => a.action)).toEqual(['Planning niet automatisch bijgewerkt']);
    expect(roosterPushes()).toHaveLength(0);
  });

  it('(c) weigert automatisch te herverdelen: een dienst die de heropbouw zou laten verdwijnen blokkeert', async () => {
    // Testdienst die niet in de matrix staat (System Debug): de knop zou hem
    // wissen, de automatische weg blijft eraf.
    mem.planning = [...mem.planning, { id: 'test-1', driverId: '4', date: '2026-07-09', line: '15', startTime: '11:00', endTime: '19:00' }];
    const voor = mem.planning;
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.planning).toMatchObject({ status: 'geblokkeerd', reden: 'toewijzing' });
    expect(res.json.planning.melding).toContain('09/07/2026 dienst 15');
    expect(mem.planning).toBe(voor);
  });

  it('(c) vult een gewiste planning niet stil opnieuw', async () => {
    mem.planning = [];
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.planning).toMatchObject({ status: 'overgeslagen', reden: 'lege-planning' });
    expect(mem.planning).toEqual([]);
  });

  it('(c) zonder matrix valt er niets bij te werken, en dat is geen fout', async () => {
    mem.planningMatrix = [];
    const voor = mem.planning;
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.planning).toMatchObject({ status: 'overgeslagen', reden: 'geen-matrix' });
    expect(mem.planning).toBe(voor);
    expect(automatischLog()).toHaveLength(0);
  });

  it('(c) een databasefout in de heropbouw laat de save niet mislukken', async () => {
    mem.planningVervangenFaalt = true;
    const voor = mem.planning;
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(mem.services.find((s: any) => s.serviceNumber === '12').startTime).toBe('08:30');
    expect(res.json.planning.status).toBe('mislukt');
    expect(res.json.planning.melding).toContain('Beheer planning');
    expect(mem.planning).toBe(voor);
    expect(automatischLog().map((a: any) => a.action)).toEqual(['Planning niet automatisch bijgewerkt']);
  });

  it('(d) een goedgekeurde en een afgehandelde ruil overleven de automatische heropbouw', async () => {
    // Overname 08/07 (goedgekeurd): dienst 12 van A naar B. Handmatige wissel
    // 01/07 (afgehandeld): dienst 14 van B naar A. Eerst opbouwen mét de
    // ruilen, zodat de planning de wissels al bevat zoals na een goedkeuring.
    mem.planningMatrix = mem.planningMatrix.map((r: any) => (r.id === 'm-1' ? { ...r, assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' } } : r));
    mem.swaps = [
      { id: 's-goed', shiftId: 'x', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-20T08:00:00', decidedAt: '2026-06-21T08:00:00', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' },
      { id: 's-klaar', shiftId: 'y', requesterId: '4', targetDriverId: '3', status: 'completed', reason: '', createdAt: '2026-06-22T08:00:00', decidedAt: '2026-06-23T08:00:00', swapType: 'overname', shiftDate: '2026-07-01', shiftLine: '14' },
    ];
    await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-admin' });
    mem.pushesSent = [];
    mem.appSettings = {};
    expect(mem.planning.find((p: any) => p.date === '2026-07-08' && String(p.line) === '12').driverId).toBe('4');

    const res = await api('POST', '/api/services', {
      token: 'tok-planner',
      body: mem.services.map((s: any) => (s.serviceNumber === '12' ? { ...s, startTime: '08:30' } : s.serviceNumber === '14' ? { ...s, endTime: '18:30' } : s)),
    });
    expect(res.status).toBe(200);
    expect(res.json.planning.status).toBe('bijgewerkt');
    // Nieuwe tijden, en de gewisselde diensten staan nog bij de overnemer.
    expect(mem.planning.find((p: any) => p.date === '2026-07-08' && String(p.line) === '12')).toMatchObject({ driverId: '4', startTime: '08:30' });
    expect(mem.planning.find((p: any) => p.date === '2026-07-01' && String(p.line) === '14')).toMatchObject({ driverId: '3', endTime: '18:30' });
    expect(mem.planning.find((p: any) => p.date === '2026-07-01' && String(p.line) === '12')).toMatchObject({ driverId: '3', startTime: '08:30' });
  });

  it('geen salvo: drie saves na elkaar geven na de rust één melding per chauffeur', async () => {
    for (const startTime of ['08:10', '08:20', '08:30']) {
      const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime }) });
      expect(res.json.planning.status).toBe('bijgewerkt');
    }
    expect(roosterPushes()).toHaveLength(0);
    // Te vroeg: de cron wacht.
    const vroeg = await api('GET', '/api/cron/rooster-meldingen', CRON);
    expect(vroeg.json).toMatchObject({ status: 'wacht', ontvangers: 0 });
    expect(roosterPushes()).toHaveLength(0);

    maakWachtrijRijp();
    const rijp = await api('GET', '/api/cron/rooster-meldingen', CRON);
    expect(rijp.json).toMatchObject({ status: 'verstuurd', ontvangers: 1 });
    expect(roosterPushes()).toHaveLength(1);
    expect(roosterPushes()[0].userIds).toEqual(['3']);
    expect(roosterPushes()[0].payload.body).toBe('Je rooster is gewijzigd, bekijk je diensten.');
    // Wachtrij leeg: een volgende beurt verstuurt niets meer.
    const daarna = await api('GET', '/api/cron/rooster-meldingen', CRON);
    expect(daarna.json).toMatchObject({ status: 'leeg' });
    expect(roosterPushes()).toHaveLength(1);
  });

  it('geen salvo: wie na een vergissing weer zijn oude rooster heeft, krijgt geen melding', async () => {
    await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '09:00' }) });
    await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:00' }) });
    maakWachtrijRijp();
    const res = await api('GET', '/api/cron/rooster-meldingen', CRON);
    expect(res.json).toMatchObject({ status: 'verstuurd', ontvangers: 0 });
    expect(roosterPushes()).toHaveLength(0);
  });

  it('de cron is afgeschermd met het cron-geheim', async () => {
    expect((await api('GET', '/api/cron/rooster-meldingen')).status).toBe(401);
    expect((await api('GET', '/api/cron/rooster-meldingen', { token: 'tok-admin' })).status).toBe(401);
  });

  it('de handmatige knop neemt de wachtrij mee: meteen één melding, daarna niets meer van de cron', async () => {
    await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(roosterPushes()).toHaveLength(0);
    // De knop zelf wijzigt niets meer (de planning is al actueel), maar
    // chauffeur A wacht nog op zijn melding.
    const knop = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-admin' });
    expect(knop.status).toBe(200);
    expect(knop.json.notifiedDrivers).toBe(1);
    expect(roosterPushes().map((p: any) => p.userIds)).toEqual([['3']]);
    expect(mem.activity.some((a: any) => a.action === 'Planning opnieuw opgebouwd')).toBe(true);
    const cron = await api('GET', '/api/cron/rooster-meldingen', CRON);
    expect(cron.json).toMatchObject({ status: 'leeg' });
    expect(roosterPushes()).toHaveLength(1);
  });

  it('schreef iemand anders tijdens het rekenen in de planning, dan rekent de heropbouw één keer opnieuw', async () => {
    // Lezingen: poging 1 vóór = 7, vlak voor het schrijven = 8 (import of
    // ruil kwam ertussen) → opnieuw; poging 2 vóór = 8, daarna = 8 → schrijven.
    mem.planningVersies = [7, 8, 8];
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.planning.status).toBe('bijgewerkt');
    expect(mem.planning.filter((p: any) => String(p.line) === '12').every((p: any) => p.startTime === '08:30')).toBe(true);
  });

  it('blijft de planning wijzigen tijdens het rekenen, dan schrijft de heropbouw niet en slaagt de save toch', async () => {
    mem.planningVersies = 'loopt';
    const voor = mem.planning;
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: metDienst12({ startTime: '08:30' }) });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.planning.status).toBe('bezet');
    expect(res.json.planning.melding).toContain('Beheer planning');
    expect(mem.planning).toBe(voor);
    // Dezelfde toestand op de knop: 409, niets geschreven.
    const knop = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-admin' });
    expect(knop.status).toBe(409);
    expect(mem.planning).toBe(voor);
  });
});

describe('delta-endpoints (PATCH per record, anti-race)', () => {
  it('laat de planner een verlofaanvraag goedkeuren via PATCH', async () => {
    const res = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(res.status).toBe(200);
    expect(res.json.leave.status).toBe('approved');
    expect(res.json.leave.decidedAt).toBeTruthy();
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('approved');
    // De aanvrager kreeg e-mail-equivalent push.
    expect(mem.pushesSent.find((p) => p.payload.title === 'Verlof goedgekeurd')?.userIds).toEqual(['3']);
  });

  it('bewaart de reden bij een afwijzing via PATCH: op het record, in het log, in de mail en de push', async () => {
    const { sendLeaveDecisionEmail } = await import('../../api/email.js');
    vi.mocked(sendLeaveDecisionEmail).mockClear();
    const res = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'rejected', ifStatus: 'pending', reden: "  Die week zijn er al te veel collega's vrij.  " } });
    expect(res.status).toBe(200);
    const reden = "Die week zijn er al te veel collega's vrij.";
    expect(res.json.leave.beslisReden).toBe(reden);
    expect(mem.leave.find((l) => l.id === 'l-a1')?.beslisReden).toBe(reden);
    expect(mem.activity.find((a: any) => a.action === 'Verlof afgewezen' && a.entityId === 'l-a1')?.message).toContain(`Reden: ${reden}`);
    expect(vi.mocked(sendLeaveDecisionEmail).mock.calls[0]?.[0]).toMatchObject({ action: 'rejected', reden });
    expect(mem.pushesSent.find((p) => p.payload.title === 'Verlof afgewezen')?.payload.body).toContain(`Reden: ${reden}`);
  });

  it('negeert de reden bij een goedkeuring en weigert een te lange of niet-tekstuele reden (400)', async () => {
    const goed = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending', reden: 'hoort er niet bij' } });
    expect(goed.status).toBe(200);
    expect(goed.json.leave.beslisReden).toBeUndefined();
    expect(mem.activity.find((a: any) => a.action === 'Verlof goedgekeurd' && a.entityId === 'l-a1')?.message).not.toContain('Reden');

    const teLang = await api('PATCH', '/api/leave/l-b1', { token: 'tok-planner', body: { status: 'rejected', ifStatus: 'pending', reden: 'x'.repeat(501) } });
    expect(teLang.status).toBe(400);
    const geenTekst = await api('PATCH', '/api/leave/l-b1', { token: 'tok-planner', body: { status: 'rejected', ifStatus: 'pending', reden: { tekst: 'nee' } } });
    expect(geenTekst.status).toBe(400);
    expect(mem.leave.find((l) => l.id === 'l-b1')?.status).toBe('pending');
  });

  it('detecteert een race: tweede beslisser krijgt 409 en de eerste beslissing blijft staan', async () => {
    const eerste = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(eerste.status).toBe(200);
    const tweede = await api('PATCH', '/api/leave/l-a1', { token: 'tok-admin', body: { status: 'rejected', ifStatus: 'pending' } });
    expect(tweede.status).toBe(409);
    expect(tweede.json.currentStatus).toBe('approved');
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('approved');
  });

  it('weigert een leave-PATCH zonder ifStatus (400), spiegel van de swaps-guard', async () => {
    const res = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved' } });
    expect(res.status).toBe(400);
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('pending');
  });

  it('weigert een overgang uit een afgehandelde leave-status, rejected → approved (409)', async () => {
    mem.leave = [{ id: 'l-r', userId: '3', startDate: '2026-08-10', endDate: '2026-08-12', type: 'betaald_verlof', status: 'rejected', createdAt: '2026-07-01T08:00:00Z', decidedAt: '2026-07-02T08:00:00Z' }];
    const res = await api('PATCH', '/api/leave/l-r', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'rejected' } });
    expect(res.status).toBe(409);
    expect(mem.leave.find((l) => l.id === 'l-r')?.status).toBe('rejected');
  });

  it('geeft 404 voor een intussen ingetrokken aanvraag en 403 voor chauffeurs', async () => {
    const weg = await api('PATCH', '/api/leave/bestaat-niet', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(weg.status).toBe(404);
    const chauffeur = await api('PATCH', '/api/leave/l-a1', { token: 'tok-a', body: { status: 'approved', ifStatus: 'pending' } });
    expect(chauffeur.status).toBe(403);
  });

  it('laat de aangezochte collega accepteren via PATCH (zonder decidedAt) en de planner daarna goedkeuren', async () => {
    const accept = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(accept.status).toBe(200);
    expect(accept.json.swap.status).toBe('accepted');
    expect(accept.json.swap.decidedAt).toBeFalsy();

    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    expect(approve.json.swap.decidedAt).toBeTruthy();
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('approved');
  });

  it('handhaaft de force-approve-regel ook op het delta-pad', async () => {
    const planner = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(planner.status).toBe(403);
    const admin = await api('PATCH', '/api/swaps/s-1', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'pending' } });
    expect(admin.status).toBe(200);
  });

  it('weigert een PATCH zonder ifStatus (400), anders geldt stil last-write-wins', async () => {
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved' } });
    expect(res.status).toBe(400);
  });

  it('weigert een chauffeur die niet de aangezochte collega is (403)', async () => {
    // Chauffeur A is requester van s-1, niet target — accepteren mag niet.
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-a', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(res.status).toBe(403);
  });

  it('laat geen enkele stafrol "accepted" schrijven, instemming is niet te vervalsen', async () => {
    // De force-approve-regel blokkeerde alleen pending → approved in één stap.
    // Via pending → accepted → approved was instemming alsnog te faken, mét
    // een push "<collega> accepteerde de ruil" naar de aanvrager als bewijs.
    const planner = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(planner.status).toBe(403);

    // Ook een admin niet: die heeft de directe pending → approved-weg al.
    const admin = await api('PATCH', '/api/swaps/s-1', { token: 'tok-admin', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(admin.status).toBe(403);

    // De ruil staat dus nog steeds op pending — stap 2 kan niet volgen.
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('pending');
  });

  it('blokkeert de twee-staps-vervalsing ook op het array-pad (POST)', async () => {
    const scoped = mem.swaps.map((s) => (s.id === 's-1' ? { ...s, status: 'accepted' } : s));
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: scoped });
    expect(res.status).toBe(403);
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('pending');
  });
});

describe('optimistic concurrency (revisie-tokens, anti-overschrijf)', () => {
  const REV = 'x-collection-revision';

  it('GET /api/services geeft een revisie-header', async () => {
    const res = await api('GET', '/api/services', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.headers.get(REV)).toBeTruthy();
  });

  it('dezelfde data geeft een stabiele revisie (geen vals conflict)', async () => {
    const a = await api('GET', '/api/services', { token: 'tok-planner' });
    const b = await api('GET', '/api/services', { token: 'tok-admin' });
    expect(a.headers.get(REV)).toBe(b.headers.get(REV));
  });

  it('POST met de juiste base-revisie slaagt en geeft een nieuwe revisie terug', async () => {
    const get = await api('GET', '/api/services', { token: 'tok-planner' });
    const rev = get.headers.get(REV)!;
    const edited = mem.services.map((s, i) => (i === 0 ? { ...s, startTime: '05:30' } : s));
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: edited, headers: { [REV]: rev } });
    expect(res.status).toBe(200);
    const newRev = res.headers.get(REV);
    expect(newRev).toBeTruthy();
    expect(newRev).not.toBe(rev); // inhoud veranderde → andere revisie
    expect(mem.services[0].startTime).toBe('05:30');
  });

  it('POST met een verouderde base-revisie geeft 409 en slaat niets op', async () => {
    const edited = mem.services.map((s, i) => (i === 0 ? { ...s, startTime: '05:30' } : s));
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: edited, headers: { [REV]: 'verouderd-token' } });
    expect(res.status).toBe(409);
    expect(res.json.conflict).toBe('revision');
    expect(mem.services[0].startTime).toBe('06:00');
  });

  it('POST zonder revisie-header wordt geweigerd met 428 en slaat niets op (controle-ronde 05-09, punt 8)', async () => {
    const edited = mem.services.map((s, i) => (i === 0 ? { ...s, startTime: '05:30' } : s));
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: edited, revisie: null });
    expect(res.status).toBe(428);
    expect(res.json.conflict).toBe('revision-missing');
    expect(mem.services[0].startTime).toBe('06:00');
  });

  it('chauffeur-payloads (swaps/leave, delta-gereconstrueerd) hebben geen revisie nodig', async () => {
    const own = mem.leave.filter((l: any) => String(l.userId) === '3');
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: own, revisie: null });
    expect(res.status).toBe(200);
  });

  it('twee-beheerders-race: de tweede save overschrijft de eerste niet (409)', async () => {
    const a = await api('GET', '/api/services', { token: 'tok-admin' });
    const revA = a.headers.get(REV)!;
    // Beheerder B laadt vers en slaat op.
    const b = await api('GET', '/api/services', { token: 'tok-planner' });
    const editedB = mem.services.map((s, i) => (i === 0 ? { ...s, serviceNumber: 'B' } : s));
    const bSave = await api('POST', '/api/services', { token: 'tok-planner', body: editedB, headers: { [REV]: b.headers.get(REV)! } });
    expect(bSave.status).toBe(200);
    // Beheerder A slaat op met de inmiddels verouderde revisie → geweigerd.
    const editedA = mem.services.map((s, i) => (i === 0 ? { ...s, serviceNumber: 'A' } : s));
    const aSave = await api('POST', '/api/services', { token: 'tok-admin', body: editedA, headers: { [REV]: revA } });
    expect(aSave.status).toBe(409);
    expect(mem.services[0].serviceNumber).toBe('B'); // B's wijziging blijft staan
  });

  it('bulk-replace-import omzeilt de revisie-check', async () => {
    const res = await api('POST', '/api/services', {
      token: 'tok-admin',
      body: mem.services.slice(0, 2),
      headers: { [REV]: 'maakt-niet-uit', 'x-bulk-replace': '1' },
    });
    expect(res.status).toBe(200);
  });

  it('gebruikers: een login (lastLogin/activeSessions) verandert de revisie niet, geen valse 409 (controle-ronde 27-08)', async () => {
    const get = await api('GET', '/api/users', { token: 'tok-admin' });
    expect(get.status).toBe(200);
    const rev = get.headers.get(REV)!;
    expect(rev).toBeTruthy();
    // Iemand logt in: sessie-velden muteren server-side, buiten gebruikersbeheer om.
    mem.users = mem.users.map((u: any, i: number) => (i === 0 ? { ...u, lastLogin: '2026-08-27T21:00:00.000Z', activeSessions: (u.activeSessions ?? 0) + 1 } : u));
    const again = await api('GET', '/api/users', { token: 'tok-admin' });
    expect(again.headers.get(REV)).toBe(rev);
    // De admin-save met de "oude" revisie mag gewoon door.
    const edited = mem.users.map((u: any, i: number) => (i === 0 ? { ...u, phone: '0470 00 00 00' } : u));
    const save = await api('POST', '/api/users', { token: 'tok-admin', body: edited, headers: { [REV]: rev } });
    expect(save.status).toBe(200);
    expect(mem.users[0].phone).toBe('0470 00 00 00');
    // Een échte wijziging door een ander (naam) blijft wél een conflict.
    mem.users = mem.users.map((u: any, i: number) => (i === 1 ? { ...u, name: `${u.name} (gewijzigd)` } : u));
    const stale = await api('POST', '/api/users', { token: 'tok-admin', body: edited, headers: { [REV]: rev } });
    expect(stale.status).toBe(409);
  });

  it('handhaaft de revisie ook op updates en planningscodes', async () => {
    const upd = await api('POST', '/api/updates', { token: 'tok-planner', body: mem.updates, headers: { [REV]: 'oud' } });
    expect(upd.status).toBe(409);
    mem.planningCodes = [{ code: 'V', description: 'Verlof', category: 'absence' }];
    const pc = await api('POST', '/api/planning-codes', { token: 'tok-planner', body: [], headers: { [REV]: 'oud' } });
    expect(pc.status).toBe(409);
  });
});

describe('planning-horizon (x-planning-tot)', () => {
  it('GET /api/planning geeft de laatste dag van de matrix mee, ook aan een chauffeur', async () => {
    mem.planningMatrix = [
      { source_date: '2026-08-05', naam: 'A', code: '2101' },
      { source_date: '2026-11-08', naam: 'A', code: '2101' },
    ];
    const res = await api('GET', '/api/planning', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-planning-tot')).toBe('2026-11-08');
  });

  it('zonder matrix valt hij terug op de laatste opgebouwde dienst', async () => {
    mem.planningMatrix = [];
    const res = await api('GET', '/api/planning', { token: 'tok-a' });
    expect(res.status).toBe(200);
    const laatste = mem.planning.map((r: any) => String(r.date ?? '')).sort().pop();
    expect(res.headers.get('x-planning-tot')).toBe(laatste);
  });
});

// Beveiligingsscan 01-10: deze route schreef de rijen ongezien weg, en een
// tijd als "Infinity:00" liet daarna de agenda-feed van die chauffeur hangen.
// De regel zelf (alle vormen) staat in src/planningTijden.test.ts.
describe('handmatige planning-save: tijden (POST /api/planning)', () => {
  const nieuweRij = (over: Record<string, unknown> = {}) => ({ id: 'sh-nieuw', driverId: '3', date: '2026-07-09', line: '4103', startTime: '05:11', endTime: '13:11', ...over });
  let bewaard: any[] | null = null;
  const spionnen: Array<{ mockRestore: () => void }> = [];
  beforeEach(async () => {
    bewaard = null;
    // De mock kent geen planning-tabel; hier vangen we alleen op wat de route
    // zou wegschrijven.
    const storage = await import('../../api/storage.js');
    spionnen.push(vi.spyOn(storage, 'savePlanningData').mockImplementation(async (data: any) => { bewaard = data; }));
  });
  afterEach(() => { for (const spion of spionnen.splice(0)) spion.mockRestore(); });

  it.each([
    ['tok-admin', 'endTime', 'Infinity:00'],
    ['tok-planner', 'startTime', '1e300:00'],
    ['tok-admin', 'startTime', '99999999:00'],
    ['tok-planner', 'endTime', '48:00'],
    ['tok-admin', 'endTime', 800],
  ])('%s: een nieuwe rij met %s = %s wordt geweigerd (400), er wordt niets geschreven', async (token, veld, tijd) => {
    const res = await api('POST', '/api/planning', { token, body: [...mem.planning, nieuweRij({ [veld]: tijd })] });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Ongeldige tijd in de planning bij dienst 4103: gebruik uu:mm, van 00:00 tot en met 47:59.');
    expect(bewaard).toBeNull();
    expect(mem.activity.some((a: any) => a.action === 'Planning opgeslagen')).toBe(false);
  });

  it('geldige tijden (ook busvak-notatie tot 47:59) en rijen zonder tijden gaan door', async () => {
    const body = [...mem.planning, nieuweRij(), nieuweRij({ id: 'sh-nacht', startTime: '15:41', endTime: '26:16' }), nieuweRij({ id: 'sh-laat', startTime: '24:00', endTime: '47:59' }), nieuweRij({ id: 'sh-leeg', startTime: '', endTime: '' })];
    const res = await api('POST', '/api/planning', { token: 'tok-admin', body });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, count: body.length });
    expect(bewaard).toEqual(body);
  });

  it('wat de debugpagina doet (de hele lijst met één testdienst erbij) blijft werken, ook met een oude rij die al zo opgeslagen staat', async () => {
    mem.planning = [...mem.planning, { id: 'sh-oud', driverId: '4', date: '2026-07-03', line: '14', startTime: '08:00:00', endTime: '16:00:00' }];
    const body = [...mem.planning, nieuweRij({ id: 'test-shift-1' })];
    const res = await api('POST', '/api/planning', { token: 'tok-admin', body });
    expect(res.status).toBe(200);
    expect(bewaard).toEqual(body);
    // Dezelfde oude rij met een andere foute tijd is een wijziging: geweigerd.
    const gewijzigd = await api('POST', '/api/planning', { token: 'tok-admin', body: body.map((r: any) => (r.id === 'sh-oud' ? { ...r, endTime: '99:00' } : r)) });
    expect(gewijzigd.status).toBe(400);
  });

  it('de lege lijst blijft de wis-actie van de admin, zonder tijdcontrole', async () => {
    const storage = await import('../../api/storage.js');
    const wis = vi.spyOn(storage, 'clearPlanningData').mockImplementation(async () => undefined as never);
    spionnen.push(wis);
    const res = await api('POST', '/api/planning', { token: 'tok-admin', body: [] });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, count: 0 });
    expect(wis).toHaveBeenCalledTimes(1);
  });
});

describe('dienstnotities (planning_notes)', () => {
  it('planner plaatst een notitie; de chauffeur ziet alleen zijn eigen', async () => {
    const put = await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '2026-08-05', note: 'Neem bus 412' } });
    expect(put.status).toBe(200);
    await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '4', date: '2026-08-05', note: 'Ander bericht' } });
    const eigen = await api('GET', '/api/planning-notes?from=2026-08-01&to=2026-08-31', { token: 'tok-a' });
    expect(eigen.status).toBe(200);
    expect(eigen.json).toEqual([{ driverId: '3', date: '2026-08-05', note: 'Neem bus 412' }]);
    const alles = await api('GET', '/api/planning-notes?from=2026-08-01&to=2026-08-31', { token: 'tok-planner' });
    expect(alles.json).toHaveLength(2);
  });

  it('chauffeurs mogen niet schrijven (403) en een lege notitie verwijdert', async () => {
    const put = await api('PUT', '/api/planning-notes', { token: 'tok-a', body: { driverId: '3', date: '2026-08-05', note: 'x' } });
    expect(put.status).toBe(403);
    await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '2026-08-06', note: 'weg straks' } });
    const del = await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '2026-08-06', note: '  ' } });
    expect(del.status).toBe(200);
    expect(mem.planningNotes).toHaveLength(0);
  });

  it('valideert de datum-shape (400)', async () => {
    const res = await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '05/08/2026', note: 'x' } });
    expect(res.status).toBe(400);
  });
});

describe('maandplanning, afwezigheidscodes zijn voor iedereen zichtbaar', () => {
  // BEWUSTE KEUZE (Jarno, 01-08-2026): het maandrooster toont dezelfde codes
  // als de fysieke planning in het chauffeurslokaal, ziekte incluis. Er is kort
  // een maskering voor chauffeurs geweest (#290) die er op verzoek weer uit is.
  // Deze test legt de keuze vast, zodat een volgende opruimronde hem niet
  // ongemerkt terugdraait — en zodat je het bewust doet als je hem wél wil.
  beforeEach(() => {
    mem.planningCodes = [
      { id: 'pc-ziek', code: 'ziek', description: 'Ziek', category: 'absence' },
      { id: 'pc-bv', code: 'bv', description: 'Betaald Verlof', category: 'leave' },
    ];
    mem.planningMatrix = [
      { id: 'm-z', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': 'ziek', 'Chauffeur B': 'ziek' }, raw_row: '' },
      { id: 'm-v', source_date: '2026-07-16', day_type: 'week', assignments: { 'Chauffeur B': 'bv' }, raw_row: '' },
    ];
  });

  it('leest alleen de matrixrijen van de gevraagde maand', async () => {
    // De matrix groeit met elke ET-import en dekte op 18-09 al vier maanden;
    // berekenCelWaarheid gooide alles buiten de maand tóch weg, maar pas ná
    // het transport uit Supabase. Zonder deze test glijdt die grens er bij
    // een refactor zo weer uit en wordt het maandbord traag met de leeftijd
    // van het portaal.
    mem.planningMatrix = [
      ...mem.planningMatrix,
      { id: 'm-aug', source_date: '2026-08-03', day_type: 'week', assignments: { 'Chauffeur A': 'ziek' }, raw_row: '' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(mem.matrixMaandFilters).toContain('2026-07');
    expect(mem.matrixMaandFilters).not.toContain(null);
    // En de augustusdag zit niet in het antwoord.
    expect(res.json.dates).toEqual(['2026-07-15', '2026-07-16']);
  });

  it('draagt de grenzen van de geïmporteerde planning mee, zodat het bord niet verder bladert dan de import', async () => {
    // Jarno 18-09: je kon in de maandplanning voorbij de laatste geïmporteerde
    // dag scrollen; het bord stond dan leeg alsof er niemand ingepland was.
    mem.planningMatrix = [
      ...mem.planningMatrix,
      { id: 'm-nov', source_date: '2026-11-08', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.geimporteerd).toEqual({ eerste: '2026-07-15', laatste: '2026-11-08' });
  });

  it('een chauffeur ziet de code van een collega ongewijzigd', async () => {
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence', label: 'Ziek' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence', label: 'Ziek' });
    expect(res.json.cells['4']['2026-07-16']).toMatchObject({ code: 'bv', kind: 'leave' });
  });

  it('planner en admin zien hetzelfde', async () => {
    for (const token of ['tok-planner', 'tok-admin']) {
      const res = await api('GET', '/api/month-planning?month=2026-07', { token });
      expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', label: 'Ziek' });
      expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'ziek', label: 'Ziek' });
    }
  });
});

describe('maandplanning, wie geen staf is kijkt niet verder terug dan de maandag van deze week (Jarno 02-10)', () => {
  // Een chauffeur ziet de lopende week (ook de dagen die al voorbij zijn) en
  // wat daarna komt, niet wat collega's vroeger reden. De server knipt, het
  // scherm alleen volgt: een kale fetch op een oude maand mag niets teruggeven.
  // Vrijdag 02/10/2026, 11:00 in Brussel: de grens is maandag 28/09, dus de
  // week loopt over de maandgrens en september is de maand die ervoor begint
  // en erna eindigt.
  const DAGEN = ['2026-08-31', '2026-09-14', '2026-09-27', '2026-09-28', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-12', '2026-11-03'];
  const NIET_STAF = [
    ['chauffeur', 'tok-a'],
    ['technieker', 'tok-tech'],
    ['chauffeur met "Ook technieker"', 'tok-b'],
  ] as const;
  const STAF = [['planner', 'tok-planner'], ['admin', 'tok-admin']] as const;
  const maand = (m: string, token: string) => api('GET', `/api/month-planning?month=${m}`, { token });
  const dagenIn = (m: string) => DAGEN.filter((d) => d.startsWith(m));

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    mem.users = [
      ...mem.users.map((u: any) => (u.id === '4' ? { ...u, ookTechnieker: true } : u)),
      { id: '5', name: 'Toon Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true },
    ];
    // Een technieker valt onder dezelfde toestel-gate als een chauffeur.
    mem.devices.push({ userId: '5', deviceToken: 'dev-ok', name: 'Windows-pc · browser', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    invalidateUsersCache();
    mem.planningMatrix = DAGEN.map((dag, i) => ({
      id: `m-${i}`, source_date: dag, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '',
    }));
    // Een doorgevoerde ruil en een ziekte van vóór de grens: ook die sporen
    // (wie nam over, wie was ziek) horen bij het verleden.
    mem.swaps = [{
      id: 's-oud', shiftId: 'sh-oud', requesterId: '3', targetDriverId: '4', status: 'approved', reason: 'Ruil',
      createdAt: '2026-09-10T08:00:00Z', decidedAt: '2026-09-11T08:00:00Z', shiftDate: '2026-09-14', shiftLine: '12', swapType: 'overname',
    }];
    mem.leave = [
      { id: 'l-oud', userId: '4', startDate: '2026-09-27', endDate: '2026-09-27', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-09-27T05:00:00Z', decidedAt: '2026-09-27T05:00:00Z' },
    ];
    mem.planningCodes = [{ id: 'pc-ziek', code: 'ziek', description: 'Ziek', category: 'absence' }];
  });

  for (const [wie, token] of NIET_STAF) {
    it(`${wie}: een maand die helemaal voorbij is geeft dezelfde vorm zonder dagen of cellen, geen fout`, async () => {
      const res = await maand('2026-08', token);
      expect(res.status).toBe(200);
      expect(res.json.month).toBe('2026-08');
      expect(res.json.dates).toEqual([]);
      expect(res.json.cells).toEqual({});
      expect(res.json.zichtbaarVanaf).toBe('2026-09-28');
      // De lijst chauffeurs zegt niets over wie wanneer reed en blijft.
      expect(res.json.drivers.map((d: any) => d.id)).toEqual(['3', '4']);
    });

    it(`${wie}: de maand waarin de grens valt begint op de maandag van deze week`, async () => {
      const res = await maand('2026-09', token);
      expect(res.status).toBe(200);
      expect(res.json.dates).toEqual(['2026-09-28', '2026-09-30']);
      for (const id of ['3', '4']) expect(Object.keys(res.json.cells[id]).sort()).toEqual(['2026-09-28', '2026-09-30']);
      // Niets van vóór de grens in het hele antwoord: geen dag, geen cel,
      // geen spoor van de ruil van 14/09 of de ziekte van 27/09.
      const alles = JSON.stringify(res.json);
      for (const oud of ['2026-09-14', '2026-09-27', 's-oud', 'ziek']) expect(alles).not.toContain(oud);
    });

    it(`${wie}: de lopende week blijft volledig, ook de dagen die al voorbij zijn, en de toekomst ook`, async () => {
      const okt = await maand('2026-10', token);
      // Donderdag 01/10 is voorbij maar hoort bij de lopende week.
      expect(okt.json.dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-12']);
      expect(okt.json.cells['4']['2026-10-01']).toMatchObject({ code: '14', kind: 'service' });
      const nov = await maand('2026-11', token);
      expect(nov.json.dates).toEqual(['2026-11-03']);
      expect(nov.json.cells['3']['2026-11-03']).toMatchObject({ code: '12' });
      expect(nov.json.zichtbaarVanaf).toBe('2026-09-28');
    });

    it(`${wie}: het begin van de import ligt op de grens, zodat het bord daar stopt met bladeren`, async () => {
      for (const m of ['2026-08', '2026-09', '2026-10']) {
        expect((await maand(m, token)).json.geimporteerd).toEqual({ eerste: '2026-09-28', laatste: '2026-11-03' });
      }
    });
  }

  for (const [wie, token] of STAF) {
    it(`${wie} ziet alles zoals voorheen, zonder grens in het antwoord`, async () => {
      for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
        const res = await maand(m, token);
        expect(res.status).toBe(200);
        expect(res.json.dates).toEqual(dagenIn(m));
        expect(res.json).not.toHaveProperty('zichtbaarVanaf');
        expect(res.json.geimporteerd).toEqual({ eerste: '2026-08-31', laatste: '2026-11-03' });
        expect(Object.keys(res.json).sort()).toEqual(['cells', 'dates', 'drivers', 'geimporteerd', 'month']);
      }
      const sep = await maand('2026-09', token);
      // De ruil van 14/09 en de ziekte van 27/09 staan er voor staf gewoon in.
      expect(sep.json.cells['4']['2026-09-14']).toMatchObject({ code: '12', swapId: 's-oud', swapFrom: 'Chauffeur A' });
      expect(sep.json.cells['4']['2026-09-27']).toMatchObject({ code: 'ziek', hiddenService: '14' });
    });
  }

  it('de week wisselt om middernacht in Brussel: zondagavond telt de voorbije week nog, maandag 00:30 niet meer', async () => {
    // Zondag 04/10, 23:30 in Brussel.
    vi.setSystemTime(new Date('2026-10-04T21:30:00Z'));
    const zondag = await maand('2026-10', 'tok-a');
    expect(zondag.json.zichtbaarVanaf).toBe('2026-09-28');
    expect(zondag.json.dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-12']);
    // Maandag 05/10, 00:30 in Brussel; de klok van de server (UTC) staat nog op zondag.
    vi.setSystemTime(new Date('2026-10-04T22:30:00Z'));
    const maandag = await maand('2026-10', 'tok-a');
    expect(maandag.json.zichtbaarVanaf).toBe('2026-10-05');
    expect(maandag.json.dates).toEqual(['2026-10-12']);
    expect(maandag.json.geimporteerd.eerste).toBe('2026-10-05');
    expect(JSON.stringify(maandag.json.cells)).not.toContain('2026-10-02');
    // September is nu helemaal voorbij.
    expect((await maand('2026-09', 'tok-a')).json).toMatchObject({ dates: [], cells: {} });
  });

  it('de twee staf-formaten blijven dicht voor wie geen staf is', async () => {
    for (const [, token] of NIET_STAF) {
      for (const formaat of ['summary', 'xlsx']) {
        const res = await api('GET', `/api/month-planning?month=2026-09&format=${formaat}`, { token });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.json)).not.toContain('2026-09');
      }
    }
  });
});

describe('dubbele inplanning met een code-dienst: het bord is de waarheid (controle 29-09)', () => {
  // Een schoolrit (EEK6) heeft geen rijen in `planning`. De conflictcontroles
  // op de ONTVANGER lazen alleen die rijen, of de rauwe matrixcel: wie de rit
  // via een wissel kreeg (matrix toont nog 'vrij') of ze in de matrix had
  // staan, kreeg er stil een tweede dienst bij, en het bord schoof de
  // schoolrit door naar wie de dienst afgaf. Nu telt wat de ontvanger die dag
  // volgens het bord rijdt: matrixcel met de ruilen en wissels erover.
  const DAG = '2026-07-24';
  const A = '3';
  const B = '4';
  const C = '5';
  const wissel = (body: Record<string, unknown>) =>
    api('POST', '/api/admin/shift-swap', { token: 'tok-admin', body: { date: DAG, reason: 'Ziekte', ...body } });
  const bord = async () => (await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' })).json.cells;
  const matrix = (assignments: Record<string, string>) => {
    mem.planningMatrix = [{ id: 'm-dubbel', source_date: DAG, day_type: 'week', assignments, raw_row: '' }];
  };
  const ziek = (userId: string) => {
    mem.leave = [{ id: `l-ziek-${userId}`, userId, startDate: DAG, endDate: DAG, type: 'ziekte', status: 'approved', comment: '', createdAt: `${DAG}T05:00:00Z`, decidedAt: `${DAG}T05:00:00Z` }];
  };
  /** A geeft de schoolrit aan B, via de handmatige wissel van #654. */
  const geefSchoolritAanB = async () => {
    expect((await wissel({ line: 'EEK6', fromDriverId: A, toDriverId: B })).status).toBe(200);
  };

  beforeEach(() => {
    mem.users = [...mem.users, { id: C, name: 'Chauffeur C', email: 'c@vhb.be', role: 'chauffeur', isActive: true }];
    mem.planningCodes = [
      { code: 'eek5', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'eek6', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true },
      { code: 'ziek', category: 'absence', description: 'Ziek', isDayOff: true },
    ];
    mem.swaps = [];
    mem.leave = [];
    // A rijdt de schoolrit, B is vrij, C rijdt de gewone dienst 14.
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij', 'Chauffeur C': '14' });
    mem.planning = [{ id: 'sh-c14', driverId: C, date: DAG, line: '14', startTime: '10:00', endTime: '18:00' }];
  });

  describe('de vier situaties uit de controle', () => {
    it('na de wissel EEK6 van A naar B: A vrij (weggeruild), B rijdt EEK6, C rijdt 14', async () => {
      await geefSchoolritAanB();
      const cells = await bord();
      expect(cells[A][DAG]).toMatchObject({ code: 'vrij', swapAway: true });
      expect(cells[B][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: '14', kind: 'service' });
    });

    it('daarna 14 van de zieke C naar B: geweigerd, de schoolrit blijft bij B', async () => {
      await geefSchoolritAanB();
      ziek(C);
      const planningVoor = JSON.stringify(mem.planning);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      // Vóór de controle: 200, en het bord toonde B op 14 en de schoolrit
      // als verborgen dienst onder de zieke C.
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B rijdt op 24/07/2026 al dienst EEK6, deze wissel zou een dubbele inplanning geven. Zet die dienst eerst weg, kies iemand anders, of wissel de twee diensten 1-op-1.');
      expect(JSON.stringify(mem.planning)).toBe(planningVoor);
      expect(mem.swaps).toHaveLength(1);
      const cells = await bord();
      expect(cells[A][DAG]).toMatchObject({ code: 'vrij', swapAway: true });
      expect(cells[B][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: 'ziek', hiddenService: '14' });
    });

    it('variant dienst toewijzen: de onbemande 14 naar B, geweigerd, de matrixcel van B blijft staan', async () => {
      // Dienst 14 staat op niemand; B staat in de matrix op vrij maar rijdt
      // door de wissel de schoolrit.
      matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij', 'Chauffeur C': 'vrij' });
      mem.planning = [];
      await geefSchoolritAanB();
      const res = await api('POST', '/api/planning/assign-service', { token: 'tok-planner', body: { date: DAG, serviceNumber: '14', driverId: B } });
      // Vóór de controle: 200, de cel van B werd 14, en het bord toonde A op
      // 14 en B op EEK6.
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B rijdt op 24/07/2026 al dienst EEK6, dubbele inplanning kan niet.');
      expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('vrij');
      expect(mem.planning).toHaveLength(0);
      const cells = await bord();
      expect(cells[A][DAG]).toMatchObject({ code: 'vrij', swapAway: true });
      expect(cells[B][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
    });

    it('B had EEK6 al in de matrix, zonder eerdere wissel: 14 van de zieke C naar B wordt geweigerd', async () => {
      // Dit gat is ouder dan #654: er is geen wissel aan te pas gekomen.
      matrix({ 'Chauffeur A': 'vrij', 'Chauffeur B': 'EEK6', 'Chauffeur C': '14' });
      ziek(C);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      // Vóór de controle: 200, B op 14 en de schoolrit onder de zieke C.
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('al dienst EEK6');
      expect(String(res.json?.error)).toContain('dubbele inplanning');
      expect(mem.swaps).toHaveLength(0);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
      const cells = await bord();
      expect(cells[B][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: 'ziek', hiddenService: '14' });
    });
  });

  describe('handmatige wissel (POST /api/admin/shift-swap)', () => {
    it('weigert ook een schoolrit naar iemand die al een schoolrit rijdt', async () => {
      matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'EEK5', 'Chauffeur C': '14' });
      const res = await wissel({ line: 'EEK6', fromDriverId: A, toDriverId: B });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('al dienst EEK5');
      expect(mem.swaps).toHaveLength(0);
    });

    it('afwezigheid eerst: een zieke ontvanger met een schoolrit eronder krijgt de afwezigheidsmelding', async () => {
      // Zoals vóór de controle, en zoals goedkeuren en toewijzen het doen: de
      // planner leest waarom B niet kan, niet welke dienst hij moet wegzetten.
      matrix({ 'Chauffeur A': 'vrij', 'Chauffeur B': 'EEK6', 'Chauffeur C': '14' });
      ziek(B);
      expect((await bord())[B][DAG]).toMatchObject({ code: 'ziek', hiddenService: 'EEK6' });
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B is ziek gemeld op 24/07/2026, deze ruil kan niet doorgaan.');
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
      expect(mem.swaps).toHaveLength(0);
    });

    it('afwezigheid eerst, ook met verlof: de schoolrit die B via een wissel kreeg verandert de melding niet', async () => {
      await geefSchoolritAanB();
      mem.leave = [{ id: 'l-bv-b', userId: B, startDate: DAG, endDate: DAG, type: 'betaald_verlof', status: 'approved', comment: '', createdAt: `${DAG}T05:00:00Z`, decidedAt: `${DAG}T05:00:00Z` }];
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B is met verlof op 24/07/2026, deze ruil kan niet doorgaan.');
      expect(mem.swaps).toHaveLength(1);
    });

    it('de rijen in de planning blijven vóór de afwezigheid gaan, zoals altijd', async () => {
      // Bestaand gedrag: een zieke ontvanger met een dienst in de planning
      // krijgt de melding over die dienst.
      mem.planning.push({ id: 'sh-b12', driverId: B, date: DAG, line: '12' });
      ziek(B);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('Chauffeur B rijdt op 24/07/2026 al dienst 12');
    });

    it('1-op-1, afwezigheid eerst: een zieke gever met een schoolrit eronder krijgt de afwezigheidsmelding', async () => {
      // C is ziek, rijdt 14 (rijen) en draagt op het bord nog een schoolrit.
      matrix({ 'Chauffeur A': 'vrij', 'Chauffeur B': '12', 'Chauffeur C': 'EEK6' });
      mem.planning = [
        { id: 'sh-c14', driverId: C, date: DAG, line: '14' },
        { id: 'sh-b12', driverId: B, date: DAG, line: '12' },
      ];
      ziek(C);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B, returnLine: '12' });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur C is ziek gemeld op 24/07/2026, deze ruil kan niet doorgaan.');
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
    });

    it('het gewone geval blijft werken: 14 van C naar wie vrij is', async () => {
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(B);
      const cells = await bord();
      expect(cells[B][DAG]).toMatchObject({ code: '14', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: 'vrij', swapAway: true });
    });

    it('wie zijn schoolrit afgaf is vrij en kan een dienst krijgen, ook al toont de matrix de rit nog', async () => {
      await geefSchoolritAanB();
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: A });
      expect(res.status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(A);
      const cells = await bord();
      expect(cells[A][DAG]).toMatchObject({ code: '14', kind: 'service' });
      expect(cells[B][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: 'vrij', swapAway: true });
    });

    it('1-op-1 blijft mogelijk: 14 van C tegen de schoolrit die B via een wissel kreeg', async () => {
      await geefSchoolritAanB();
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B, returnLine: 'EEK6' });
      expect(res.status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(B);
      const cells = await bord();
      expect(cells[B][DAG]).toMatchObject({ code: '14', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
      expect(cells[A][DAG]).toMatchObject({ code: 'vrij', swapAway: true });
    });

    it('1-op-1: de gever die volgens het bord nog een schoolrit rijdt, krijgt er geen terugdienst bij', async () => {
      // C rijdt 14 (rijen) en kreeg daarbovenop de schoolrit van A: een
      // dubbele inplanning van vóór de controle. B rijdt 12.
      matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': '12', 'Chauffeur C': 'vrij' });
      mem.planning = [
        { id: 'sh-c14', driverId: C, date: DAG, line: '14' },
        { id: 'sh-b12', driverId: B, date: DAG, line: '12' },
      ];
      mem.swaps = [{ id: 's-oud', shiftId: `${DAG}-3-EEK6-bord`, requesterId: A, targetDriverId: C, status: 'approved', swapType: 'overname', shiftDate: DAG, shiftLine: 'EEK6', createdAt: '2026-07-20T08:00:00Z', decidedAt: '2026-07-20T08:00:00Z', reason: 'Handmatige wissel door Annelies Admin, test' }];
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B, returnLine: '12' });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('Chauffeur C rijdt op 24/07/2026 ook dienst EEK6');
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
      expect(mem.swaps).toHaveLength(1);
    });
  });

  describe('ruil goedkeuren (PATCH /api/swaps/:id en POST /api/swaps)', () => {
    // C biedt zijn dienst 14 aan B aan (overname), B accepteerde al.
    const aanvraag = (extra: Record<string, unknown> = {}) => ({
      id: 's-goed', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '',
      createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14', ...extra,
    });
    const keurGoed = () => api('PATCH', '/api/swaps/s-goed', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });

    it('weigert als de collega intussen via een wissel een schoolrit kreeg', async () => {
      await geefSchoolritAanB();
      mem.swaps = [...mem.swaps, aanvraag()];
      const res = await keurGoed();
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B rijdt op 24/07/2026 al dienst EEK6, deze ruil zou een dubbele inplanning geven. Zet die dienst eerst weg.');
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
      expect(mem.swaps.find((s: any) => s.id === 's-goed')?.status).toBe('accepted');
    });

    it('weigert als de collega de schoolrit in de matrix heeft staan', async () => {
      matrix({ 'Chauffeur A': 'vrij', 'Chauffeur B': 'EEK6', 'Chauffeur C': '14' });
      mem.swaps = [aanvraag()];
      const res = await keurGoed();
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('al dienst EEK6');
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
    });

    it('weigert ook langs de lijst-route (POST /api/swaps)', async () => {
      await geefSchoolritAanB();
      mem.swaps = [...mem.swaps, aanvraag()];
      const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s: any) => (s.id === 's-goed' ? { ...s, status: 'approved' } : s)) });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('al dienst EEK6');
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
      expect(mem.swaps.find((s: any) => s.id === 's-goed')?.status).toBe('accepted');
    });

    it('het gewone geval blijft werken: de collega is vrij', async () => {
      mem.swaps = [aanvraag()];
      const res = await keurGoed();
      expect(res.status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(B);
    });

    it('wie zijn schoolrit afgaf kan een dienst overnemen', async () => {
      await geefSchoolritAanB();
      mem.swaps = [...mem.swaps, aanvraag({ targetDriverId: A })];
      const res = await keurGoed();
      expect(res.status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(A);
    });

    it('een 1-op-1 op dezelfde dag tegen de schoolrit van de collega is geen dubbele inplanning', async () => {
      // De terugruil telt niet mee, ook niet als ze alleen op het bord leeft.
      // Zo'n aanvraag indienen kan vandaag niet (de tegenprestatie moet rijen
      // in de planning hebben); de toets bewaakt de uitzondering zelf, zodat
      // de bordcontrole nooit strenger is dan de rijencontrole.
      matrix({ 'Chauffeur A': 'vrij', 'Chauffeur B': 'EEK6', 'Chauffeur C': '14' });
      mem.swaps = [aanvraag({ swapType: 'ruil', returnDate: DAG, returnCode: 'EEK6' })];
      const res = await keurGoed();
      expect(res.status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(B);
      const cells = await bord();
      expect(cells[B][DAG]).toMatchObject({ code: '14', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
    });
  });

  describe('lezingen buiten de lus', () => {
    // Het dienstoverzicht en de planningscodes zijn voor elke dag dezelfde:
    // een route die meerdere ruilen in één keer behandelt leest ze één keer.
    const DAG2 = '2026-07-25';
    const tel = () => ({ diensten: mem.servicesLezingen, codes: mem.codesLezingen, matrix: mem.matrixMaandFilters });
    const nulstand = () => { mem.servicesLezingen = 0; mem.codesLezingen = 0; mem.matrixMaandFilters = []; };

    beforeEach(() => {
      mem.planningMatrix = [
        { id: 'm-dag1', source_date: DAG, day_type: 'week', assignments: { 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij', 'Chauffeur C': '14' }, raw_row: '' },
        { id: 'm-dag2', source_date: DAG2, day_type: 'week', assignments: { 'Chauffeur A': 'vrij', 'Chauffeur B': 'vrij', 'Chauffeur C': '15' }, raw_row: '' },
      ];
      mem.planning = [
        { id: 'sh-c14', driverId: C, date: DAG, line: '14', startTime: '10:00', endTime: '18:00' },
        { id: 'sh-c15', driverId: C, date: DAG2, line: '15', startTime: '11:00', endTime: '19:00' },
      ];
    });

    it('twee ruilen in één keer goedkeuren: dienstoverzicht en codes één keer, per dag één matrixrij', async () => {
      mem.swaps = [
        { id: 's-een', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14' },
        { id: 's-twee', shiftId: 'sh-c15', requesterId: C, targetDriverId: A, status: 'accepted', reason: '', createdAt: '2026-07-20T09:00:00Z', swapType: 'overname', shiftDate: DAG2, shiftLine: '15' },
      ];
      nulstand();
      const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s: any) => ({ ...s, status: 'approved' })) });
      expect(res.status).toBe(200);
      expect(tel()).toEqual({ diensten: 1, codes: 1, matrix: [`${DAG}..${DAG}`, `${DAG2}..${DAG2}`] });
      // De uitkomst per ruil is dezelfde als één voor één.
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(B);
      expect(mem.planning.find((r: any) => r.id === 'sh-c15')?.driverId).toBe(A);
      expect(mem.swaps.map((s: any) => s.status)).toEqual(['approved', 'approved']);
    });

    it('twee ruilen in één keer: de tweede strandt nog altijd op de schoolrit van de collega', async () => {
      // De eerste is in orde, de tweede gaat naar A, die de schoolrit rijdt.
      mem.planningMatrix[1].assignments = { 'Chauffeur A': 'EEK5', 'Chauffeur B': 'vrij', 'Chauffeur C': '15' };
      mem.swaps = [
        { id: 's-een', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14' },
        { id: 's-twee', shiftId: 'sh-c15', requesterId: C, targetDriverId: A, status: 'accepted', reason: '', createdAt: '2026-07-20T09:00:00Z', swapType: 'overname', shiftDate: DAG2, shiftLine: '15' },
      ];
      const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s: any) => ({ ...s, status: 'approved' })) });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur A rijdt op 25/07/2026 al dienst EEK5, deze ruil zou een dubbele inplanning geven. Zet die dienst eerst weg.');
      // De controles lopen vóór de doorvoer: er is niets verplaatst.
      expect(mem.planning.map((r: any) => r.driverId)).toEqual([C, C]);
      expect(mem.swaps.map((s: any) => s.status)).toEqual(['accepted', 'accepted']);
    });

    it('een lijst zonder goedkeuring leest het bord niet', async () => {
      mem.swaps = [
        { id: 's-een', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14' },
      ];
      nulstand();
      const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s: any) => ({ ...s, status: 'rejected' })) });
      expect(res.status).toBe(200);
      expect(tel()).toEqual({ diensten: 0, codes: 0, matrix: [] });
    });

    it('één ruil goedkeuren via PATCH: dienstoverzicht en codes één keer', async () => {
      mem.swaps = [
        { id: 's-een', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14' },
      ];
      nulstand();
      const res = await api('PATCH', '/api/swaps/s-een', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
      expect(res.status).toBe(200);
      expect(tel()).toEqual({ diensten: 1, codes: 1, matrix: [`${DAG}..${DAG}`] });
    });

    it('twee overnames in één keer aanvragen: dienstoverzicht en codes één keer', async () => {
      const nieuw = (id: string, shiftId: string, targetDriverId: string) => ({
        id, shiftId, requesterId: C, targetDriverId, status: 'pending', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname',
      });
      nulstand();
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [nieuw('s-o1', 'sh-c14', B), nieuw('s-o2', 'sh-c15', A)] });
      expect(res.status).toBe(200);
      expect(tel()).toEqual({ diensten: 1, codes: 1, matrix: [`${DAG}..${DAG}`, `${DAG2}..${DAG2}`] });
      expect(mem.swaps.map((s: any) => [s.id, s.status, s.shiftDate])).toEqual([['s-o1', 'pending', DAG], ['s-o2', 'pending', DAG2]]);
    });

    it('twee overnames in één keer: de tweede strandt nog altijd op de schoolrit van de collega', async () => {
      const nieuw = (id: string, shiftId: string, targetDriverId: string) => ({
        id, shiftId, requesterId: C, targetDriverId, status: 'pending', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname',
      });
      // Op de eerste dag rijdt A de schoolrit.
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [nieuw('s-o1', 'sh-c15', B), nieuw('s-o2', 'sh-c14', A)] });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain("Chauffeur A staat op 24/07/2026 ingepland als 'EEK6'");
      expect(mem.swaps).toHaveLength(0);
    });
  });

  describe('overname aanvragen (POST /api/swaps, nieuwe aanvraag)', () => {
    // A (tok-a) rijdt hier de gewone dienst 12 en biedt die aan; C rijdt de
    // schoolrit.
    const overname = (targetDriverId: string) => ({
      id: 's-over-bord', shiftId: 'sh-a12', requesterId: A, targetDriverId, status: 'pending',
      reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname',
    });
    const vraagAan = (targetDriverId: string) =>
      api('POST', '/api/swaps', { token: 'tok-a', body: [...mem.swaps.filter((s: any) => s.requesterId === A || s.targetDriverId === A), overname(targetDriverId)] });

    beforeEach(() => {
      matrix({ 'Chauffeur A': '12', 'Chauffeur B': 'vrij', 'Chauffeur C': 'EEK6' });
      mem.planning = [{ id: 'sh-a12', driverId: A, date: DAG, line: '12', startTime: '08:00', endTime: '16:00' }];
    });

    it('weigert als de collega via een wissel een schoolrit kreeg', async () => {
      expect((await wissel({ line: 'EEK6', fromDriverId: C, toDriverId: B })).status).toBe(200);
      const res = await vraagAan(B);
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe("Chauffeur B staat op 24/07/2026 ingepland als 'EEK6'. Ruilen zonder tegenprestatie kan alleen als de collega die dag vrij/bv/tk/ta staat.");
      expect(mem.swaps.find((s: any) => s.id === 's-over-bord')).toBeUndefined();
    });

    it('weigert als de collega de schoolrit in de matrix heeft staan (bestaand gedrag)', async () => {
      const res = await vraagAan(C);
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain("ingepland als 'EEK6'");
      expect(mem.swaps.find((s: any) => s.id === 's-over-bord')).toBeUndefined();
    });

    it('het gewone geval blijft werken: de collega staat op vrij', async () => {
      const res = await vraagAan(B);
      expect(res.status).toBe(200);
      expect(mem.swaps.find((s: any) => s.id === 's-over-bord')).toMatchObject({ status: 'pending', swapType: 'overname', shiftDate: DAG, shiftLine: '12' });
    });

    it('de collega heeft die dag al een rij met hetzelfde dienstnummer: geweigerd, zoals altijd', async () => {
      // Bij het INDIENEN telt elke rij van de collega op die dag, ook een met
      // het nummer van de aangeboden dienst: er is nog niets doorgevoerd, dus
      // van een herhaalde doorvoer is geen sprake (tegenlezing 29-09, punt 4).
      mem.planning = [...mem.planning, { id: 'sh-b12', driverId: B, date: DAG, line: '12', startTime: '17:00', endTime: '21:00' }];
      const res = await vraagAan(B);
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B heeft op 24/07/2026 toch een dienst in de planning staan, ruilen zonder tegenprestatie kan dan niet.');
      expect(mem.swaps.find((s: any) => s.id === 's-over-bord')).toBeUndefined();
    });

    it('bij goedkeuren blijft de uitzondering gelden: de aangeboden dienst staat al bij de collega', async () => {
      // Halve doorvoer van een deel van een gesplitste dienst: één rij staat
      // al op naam van de collega. Dat is geen dubbele inplanning.
      mem.planning = [
        { id: 'sh-a12', driverId: A, date: DAG, line: '12', startTime: '08:00', endTime: '12:00' },
        { id: 'sh-a12b', driverId: B, date: DAG, line: '12', startTime: '14:00', endTime: '18:00' },
      ];
      mem.swaps = [{ id: 's-half-deel', shiftId: 'sh-a12', requesterId: A, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '12' }];
      const res = await api('PATCH', '/api/swaps/s-half-deel', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
      expect(res.status).toBe(200);
      expect(mem.planning.map((r: any) => r.driverId)).toEqual([B, B]);
    });

    it('wie zijn schoolrit afgaf mag een dienst overnemen, zoals de takeover-lijst hem toont', async () => {
      expect((await wissel({ line: 'EEK6', fromDriverId: C, toDriverId: B })).status).toBe(200);
      const lijst = await api('GET', `/api/availability?from=${DAG}&to=${DAG}&takeover=1`, { token: 'tok-a' });
      expect(lijst.json.days[0].takeover).toEqual({ [C]: 'vrij' });
      const res = await vraagAan(C);
      expect(res.status).toBe(200);
      expect(mem.swaps.find((s: any) => s.id === 's-over-bord')).toMatchObject({ status: 'pending', targetDriverId: C });
    });
  });

  describe('dienst toewijzen (POST /api/planning/assign-service)', () => {
    const wijsToe = (driverId: string, token = 'tok-planner') =>
      api('POST', '/api/planning/assign-service', { token, body: { date: DAG, serviceNumber: '15', driverId } });

    it('weigert wie via een wissel een schoolrit kreeg, ook voor een planner', async () => {
      await geefSchoolritAanB();
      const res = await wijsToe(B);
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('al dienst EEK6');
      expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('vrij');
      expect(mem.planning.some((r: any) => r.line === '15')).toBe(false);
    });

    it('weigert wie de schoolrit in de matrix heeft staan (bestaand gedrag, zelfde melding)', async () => {
      const res = await wijsToe(A);
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe("Chauffeur A staat op 2026-07-24 al op 'EEK6' in de planning, die cel kan niet stil overschreven worden.");
      expect(mem.planningMatrix[0].assignments['Chauffeur A']).toBe('EEK6');
    });

    it('het gewone geval blijft werken: wie vrij is krijgt de dienst, in matrix en planning', async () => {
      await geefSchoolritAanB();
      matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij', 'Chauffeur C': 'vrij' });
      mem.planning = [];
      const res = await wijsToe(C);
      expect(res.status).toBe(200);
      expect(mem.planningMatrix[0].assignments['Chauffeur C']).toBe('15');
      expect(mem.planning.find((r: any) => r.line === '15')).toMatchObject({ driverId: C, date: DAG });
      // De eerdere wissel van de schoolrit blijft op het bord staan.
      const cells = await bord();
      expect(cells[B][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
      expect(cells[C][DAG]).toMatchObject({ code: '15', kind: 'service' });
    });

    it('de cel van wie zijn schoolrit afgaf wordt niet overschreven: de wissel hangt eraan', async () => {
      // Het bord toont A vrij, maar zijn matrixcel draagt de schoolrit waar de
      // wissel naar B op steunt. Overschrijven zou de rit van het bord halen.
      await geefSchoolritAanB();
      const res = await wijsToe(A);
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain("al op 'EEK6'");
      expect(mem.planningMatrix[0].assignments['Chauffeur A']).toBe('EEK6');
      expect((await bord())[B][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
    });
  });

  describe('beschikbaarheid en advies lezen het bord', () => {
    const beschikbaar = async () => (await api('GET', `/api/availability?from=${DAG}&to=${DAG}&takeover=1`, { token: 'tok-a' })).json.days[0];
    const advies = async () => (await api('GET', `/api/coverage-advisor?date=${DAG}&code=15`, { token: 'tok-planner' })).json;

    it('zonder wissel: wie de schoolrit in de matrix heeft is niet vrij (bestaand gedrag)', async () => {
      const dag = await beschikbaar();
      expect(dag.free).toEqual([B]);
      expect(dag.working).toEqual([C]);
      expect(dag.takeover).toEqual({ [B]: 'vrij' });
      expect((await advies()).kandidaten.map((k: any) => k.name)).toEqual(['Chauffeur B']);
    });

    it('na de wissel: wie de schoolrit kreeg is niet meer vrij, wie ze afgaf wel', async () => {
      await geefSchoolritAanB();
      const dag = await beschikbaar();
      expect(dag.free).toEqual([A]);
      expect(dag.working).toEqual([C]);
      expect(dag.takeover).toEqual({ [A]: 'vrij' });
      expect((await advies()).kandidaten.map((k: any) => k.name)).toEqual(['Chauffeur A']);
    });

    it('het batch-advies (herverdelen) stelt wie de schoolrit kreeg niet voor', async () => {
      await geefSchoolritAanB();
      const res = await api('POST', '/api/coverage-advisor/batch', { token: 'tok-planner', body: { items: [{ date: DAG, code: '15' }] } });
      expect(res.status).toBe(200);
      const tekst = JSON.stringify(res.json);
      expect(tekst).toContain('Chauffeur A');
      expect(tekst).not.toContain('Chauffeur B');
    });

    it('na terugdraaien van de wissel staat alles weer zoals de matrix zegt', async () => {
      await geefSchoolritAanB();
      const id = String(mem.swaps[0].id);
      expect((await api('PATCH', `/api/swaps/${id}`, { token: 'tok-admin', body: { status: 'cancelled', ifStatus: 'approved' } })).status).toBe(200);
      const dag = await beschikbaar();
      expect(dag.free).toEqual([B]);
      expect(dag.takeover).toEqual({ [B]: 'vrij' });
    });

    it('ook een gewone dienst: wie hem afgaf is vrij, al toont de matrix zijn nummer nog', async () => {
      expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
      const dag = await beschikbaar();
      expect(dag.free).toEqual([C]);
      expect(dag.working).toEqual([B]);
      expect(dag.lines).toEqual({ [B]: '14' });
    });
  });
});

describe('dubbele inplanning: gewone gevallen die blijven doorgaan (tegenlezing 29-09)', () => {
  // De tegenlezer mat deze gevallen vóór en na de controle van 29-09, telkens
  // 200. Ze liggen hier vast, zodat een strengere regel ze niet stil omver
  // duwt. Elk geval slaagt ook op de code van vóór de invariant.
  const DAG = '2026-07-24';
  const A = '3';
  const B = '4';
  const C = '5';
  const D = '6';
  const wissel = (body: Record<string, unknown>) =>
    api('POST', '/api/admin/shift-swap', { token: 'tok-admin', body: { date: DAG, reason: 'Ziekte', ...body } });
  const bord = async () => (await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' })).json.cells;
  const matrix = (assignments: unknown) => {
    mem.planningMatrix = [{ id: 'm-gewoon', source_date: DAG, day_type: 'week', assignments, raw_row: '' }];
  };
  const rij = (id: string, driverId: string, line: string, date = DAG) => ({ id, driverId, date, line, startTime: '10:00', endTime: '18:00' });
  const eigenaar = (id: string) => mem.planning.find((r: any) => r.id === id)?.driverId;

  beforeEach(() => {
    mem.users = [
      ...mem.users,
      { id: C, name: 'Chauffeur C', email: 'c@vhb.be', role: 'chauffeur', isActive: true },
      { id: D, name: 'Chauffeur D', email: 'd@vhb.be', role: 'chauffeur', isActive: true },
    ];
    mem.planningCodes = [
      { code: 'eek5', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'eek6', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true },
      { code: 'ziek', category: 'absence', description: 'Ziek', isDayOff: true },
    ];
    mem.swaps = [];
    mem.leave = [];
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij', 'Chauffeur C': '14', 'Chauffeur D': 'vrij' });
    mem.planning = [rij('sh-c14', C, '14')];
  });

  it('1-op-1 met twee code-diensten', async () => {
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'EEK5' });
    expect((await wissel({ line: 'EEK6', fromDriverId: A, toDriverId: B, returnLine: 'EEK5' })).status).toBe(200);
    const cells = await bord();
    expect([cells[A][DAG].code, cells[B][DAG].code]).toEqual(['EEK5', 'EEK6']);
  });

  it('1-op-1 gemengd: schoolrit tegen een dienst met rijen', async () => {
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur C': '14' });
    expect((await wissel({ line: 'EEK6', fromDriverId: A, toDriverId: C, returnLine: '14' })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(A);
  });

  it('1-op-1 gemengd: dienst met rijen tegen een schoolrit', async () => {
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur C': '14' });
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: A, returnLine: 'EEK6' })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(A);
    expect((await bord())[C][DAG].code).toBe('EEK6');
  });

  it('gesplitste dienst in drie delen: heen en terug', async () => {
    mem.planning = [rij('d1', C, '14'), { ...rij('d2', C, '14'), startTime: '12:00' }, { ...rij('d3', C, '14'), startTime: '16:00' }];
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(mem.planning.map((r: any) => r.driverId)).toEqual([B, B, B]);
    expect((await wissel({ line: '14', fromDriverId: B, toDriverId: C })).status).toBe(200);
    expect(mem.planning.map((r: any) => r.driverId)).toEqual([C, C, C]);
  });

  it('wissel annuleren en opnieuw doen', async () => {
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    const id = String(mem.swaps[0].id);
    expect((await api('PATCH', `/api/swaps/${id}`, { token: 'tok-admin', body: { status: 'cancelled', ifStatus: 'approved' } })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(C);
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('code-dienst heen en weer, daarna een dienst naar de eerste ontvanger', async () => {
    expect((await wissel({ line: 'EEK6', fromDriverId: A, toDriverId: B })).status).toBe(200);
    expect((await wissel({ line: 'EEK6', fromDriverId: B, toDriverId: A })).status).toBe(200);
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    const cells = await bord();
    expect([cells[A][DAG].code, cells[B][DAG].code]).toEqual(['EEK6', '14']);
  });

  it('ketting B naar D naar C, met een dienst met rijen', async () => {
    mem.planning = [rij('sh-b14', B, '14')];
    matrix({ 'Chauffeur B': '14', 'Chauffeur C': 'vrij', 'Chauffeur D': 'vrij' });
    expect((await wissel({ line: '14', fromDriverId: B, toDriverId: D })).status).toBe(200);
    expect((await wissel({ line: '14', fromDriverId: D, toDriverId: C })).status).toBe(200);
    expect(eigenaar('sh-b14')).toBe(C);
  });

  it('ketting B naar D naar C, met een schoolrit', async () => {
    matrix({ 'Chauffeur B': 'EEK6', 'Chauffeur C': 'vrij', 'Chauffeur D': 'vrij' });
    mem.planning = [];
    expect((await wissel({ line: 'EEK6', fromDriverId: B, toDriverId: D })).status).toBe(200);
    expect((await wissel({ line: 'EEK6', fromDriverId: D, toDriverId: C })).status).toBe(200);
    expect((await bord())[C][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
  });

  it('halve doorvoer goedkeuren: de planning is al gewisseld, de status nog niet', async () => {
    mem.planning = [rij('sh-c14', B, '14')];
    mem.swaps = [{ id: 's-half', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14' }];
    const res = await api('PATCH', '/api/swaps/s-half', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('dag zonder matrixrij', async () => {
    mem.planningMatrix = [];
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('lege planningscodes: vrij en bv blijven vrij', async () => {
    mem.planningCodes = [];
    matrix({ 'Chauffeur A': 'vrij', 'Chauffeur B': 'bv', 'Chauffeur C': '14' });
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('ontvanger niet in de matrix', async () => {
    matrix({ 'Chauffeur C': '14' });
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('ontvanger is planner', async () => {
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: '2' })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe('2');
  });

  it.each([['null', null], ['een tekst', 'kapot'], ['een lijst', ['14']]])('matrixrij met kapotte assignments (%s)', async (_naam, assignments) => {
    matrix(assignments);
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('oude ruilen zonder dienst-info in de lijst', async () => {
    mem.swaps = [
      { id: 's-oud-1', shiftId: 'sh-weg', requesterId: A, targetDriverId: B, status: 'approved', reason: '', createdAt: '2026-05-01T08:00:00Z', decidedAt: '2026-05-02T08:00:00Z' },
      { id: 's-oud-2', shiftId: 'sh-weg-2', requesterId: B, targetDriverId: C, status: 'completed', reason: '', createdAt: '2026-05-01T08:00:00Z', decidedAt: '2026-05-03T08:00:00Z', returnDate: DAG, returnCode: 'VRIJ' },
    ];
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('een oude ruil zonder dienst-info goedkeuren', async () => {
    mem.swaps = [{ id: 's-oud', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-05-01T08:00:00Z', returnDate: '2026-07-25', returnCode: '12' }];
    const res = await api('PATCH', '/api/swaps/s-oud', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
  });

  it('code die ook in het dienstoverzicht staat: het dienstoverzicht wint, geen code-dienst', async () => {
    mem.planningCodes = [...mem.planningCodes, { code: '13', category: 'service', description: 'Dienst 13', countsAsShift: true }];
    matrix({ 'Chauffeur B': '13', 'Chauffeur C': '14' });
    expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });

  it('1-op-1 over twee dagen goedkeuren, zonder dubbele inplanning', async () => {
    const DAG2 = '2026-07-25';
    mem.planningMatrix = [
      { id: 'm-d1', source_date: DAG, day_type: 'week', assignments: { 'Chauffeur B': 'vrij', 'Chauffeur C': '14' }, raw_row: '' },
      { id: 'm-d2', source_date: DAG2, day_type: 'week', assignments: { 'Chauffeur B': '12', 'Chauffeur C': 'vrij' }, raw_row: '' },
    ];
    mem.planning = [rij('sh-c14', C, '14'), rij('sh-b12', B, '12', DAG2)];
    mem.swaps = [{ id: 's-twee-dagen', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'ruil', shiftDate: DAG, shiftLine: '14', returnDate: DAG2, returnCode: '12' }];
    const res = await api('PATCH', '/api/swaps/s-twee-dagen', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect([eigenaar('sh-c14'), eigenaar('sh-b12')]).toEqual([B, C]);
  });

  it('1-op-1 op dezelfde dag goedkeuren', async () => {
    matrix({ 'Chauffeur B': '12', 'Chauffeur C': '14' });
    mem.planning = [rij('sh-c14', C, '14'), rij('sh-b12', B, '12')];
    mem.swaps = [{ id: 's-zelfde', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'ruil', shiftDate: DAG, shiftLine: '14', returnDate: DAG, returnCode: '12' }];
    const res = await api('PATCH', '/api/swaps/s-zelfde', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect([eigenaar('sh-c14'), eigenaar('sh-b12')]).toEqual([B, C]);
  });

  it('een admin keurt rechtstreeks goed, zonder akkoord van de collega', async () => {
    mem.swaps = [{ id: 's-direct', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'pending', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14' }];
    const res = await api('PATCH', '/api/swaps/s-direct', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'pending' } });
    expect(res.status).toBe(200);
    expect(eigenaar('sh-c14')).toBe(B);
  });
});

describe('de invariant: geen chauffeur met twee diensten op één dag (Jarno 29-09)', () => {
  // Eén regel voor elk schrijfpad (api/_lib/dubbeleInplanning.ts): wie door
  // de bewerking een dienst krijgt, mag die dag geen andere dienst hebben,
  // behalve wat hij in dezelfde beweging afgeeft. Drie varianten die tot
  // 29-09 doorgingen, elk door de echte routes.
  const DAG = '2026-07-24';
  const DAG2 = '2026-07-25';
  const A = '3';
  const B = '4';
  const C = '5';
  const D = '6';
  const wissel = (body: Record<string, unknown>) =>
    api('POST', '/api/admin/shift-swap', { token: 'tok-admin', body: { date: DAG, reason: 'Ziekte', ...body } });
  const keurGoed = (id: string, ifStatus = 'accepted') =>
    api('PATCH', `/api/swaps/${id}`, { token: 'tok-admin', body: { status: 'approved', ifStatus } });
  const keurGoedViaLijst = (id: string) =>
    api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s: any) => (s.id === id ? { ...s, status: 'approved' } : s)) });
  const wijsToe = (driverId: string, serviceNumber = '15', date = DAG) =>
    api('POST', '/api/planning/assign-service', { token: 'tok-planner', body: { date, serviceNumber, driverId } });
  const dag = (id: string, date: string, assignments: unknown) => ({ id, source_date: date, day_type: 'week', assignments, raw_row: '' });
  const rij = (id: string, driverId: string, line: string, date = DAG, tijd: [string, string] = ['10:00', '18:00']) =>
    ({ id, driverId, date, line, startTime: tijd[0], endTime: tijd[1] });
  const ziek = (userId: string, date = DAG) => {
    mem.leave = [{ id: `l-ziek-${userId}`, userId, startDate: date, endDate: date, type: 'ziekte', status: 'approved', comment: '', createdAt: `${date}T05:00:00Z`, decidedAt: `${date}T05:00:00Z` }];
  };
  /** Momentopname van alles wat een geweigerde bewerking niet mag raken. */
  const stand = () => JSON.stringify({ planning: mem.planning, swaps: mem.swaps, matrix: mem.planningMatrix, log: mem.activity.length, pushes: mem.pushesSent.length });

  beforeEach(() => {
    mem.users = [
      ...mem.users,
      { id: C, name: 'Chauffeur C', email: 'c@vhb.be', role: 'chauffeur', isActive: true },
      { id: D, name: 'Chauffeur D', email: 'd@vhb.be', role: 'chauffeur', isActive: true },
    ];
    mem.planningCodes = [
      { code: 'eek5', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'eek6', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true },
      { code: 'ziek', category: 'absence', description: 'Ziek', isDayOff: true },
    ];
    mem.swaps = [];
    mem.leave = [];
    mem.planningMatrix = [
      dag('m-d1', DAG, { 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij', 'Chauffeur C': '14', 'Chauffeur D': 'vrij' }),
      dag('m-d2', DAG2, { 'Chauffeur A': 'vrij', 'Chauffeur B': '12', 'Chauffeur C': 'vrij', 'Chauffeur D': 'vrij' }),
    ];
    mem.planning = [rij('sh-c14', C, '14'), rij('sh-b12', B, '12', DAG2)];
  });

  describe('variant 1: de aanvrager op de terugdag', () => {
    // C geeft dienst 14 op dag 1 aan B en krijgt dienst 12 van B op dag 2.
    const ruil = (extra: Record<string, unknown> = {}) => ({
      id: 's-terug', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '',
      createdAt: '2026-07-20T08:00:00Z', swapType: 'ruil', shiftDate: DAG, shiftLine: '14', returnDate: DAG2, returnCode: '12', ...extra,
    });
    const metSchoolritOpTerugdag = () => {
      mem.planningMatrix[1] = dag('m-d2', DAG2, { 'Chauffeur A': 'vrij', 'Chauffeur B': '12', 'Chauffeur C': 'EEK5', 'Chauffeur D': 'vrij' });
    };
    const nietsVerplaatst = () => {
      expect(mem.planning.map((r: any) => [r.id, r.driverId])).toEqual([['sh-c14', C], ['sh-b12', B]]);
      expect(mem.swaps.find((s: any) => s.id === 's-terug')?.status).toBe('accepted');
    };

    it('de aanvrager rijdt op de terugdag een schoolrit: goedkeuren wordt geweigerd', async () => {
      metSchoolritOpTerugdag();
      mem.swaps = [ruil()];
      const voor = stand();
      const res = await keurGoed('s-terug');
      // Vóór de invariant: 200, C reed op dag 2 de schoolrit én dienst 12, en
      // het bord schoof de schoolrit door naar B.
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur C rijdt op 25/07/2026 al dienst EEK5, deze ruil zou een dubbele inplanning geven. Zet die dienst eerst weg.');
      expect(stand()).toBe(voor);
      nietsVerplaatst();
    });

    it('de aanvrager rijdt op de terugdag een gewone dienst met rijen: geweigerd', async () => {
      mem.planning.push(rij('sh-c13', C, '13', DAG2));
      mem.swaps = [ruil()];
      const voor = stand();
      const res = await keurGoed('s-terug');
      // Vóór de invariant: 200, C eindigde met dienst 13 én dienst 12 op dag 2.
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur C rijdt op 25/07/2026 al dienst 13, deze ruil zou een dubbele inplanning geven. Zet die dienst eerst weg.');
      expect(stand()).toBe(voor);
    });

    it('de aanvrager kreeg de schoolrit op de terugdag via een wissel: geweigerd', async () => {
      mem.planningMatrix[1] = dag('m-d2', DAG2, { 'Chauffeur A': 'EEK5', 'Chauffeur B': '12', 'Chauffeur C': 'vrij', 'Chauffeur D': 'vrij' });
      expect((await wissel({ date: DAG2, line: 'EEK5', fromDriverId: A, toDriverId: C })).status).toBe(200);
      mem.swaps = [...mem.swaps, ruil()];
      const res = await keurGoed('s-terug');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('Chauffeur C rijdt op 25/07/2026 al dienst EEK5');
      nietsVerplaatst();
    });

    it('ook langs de lijst-route (POST /api/swaps)', async () => {
      metSchoolritOpTerugdag();
      mem.swaps = [ruil()];
      const res = await keurGoedViaLijst('s-terug');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('Chauffeur C rijdt op 25/07/2026 al dienst EEK5');
      nietsVerplaatst();
    });

    it('een admin die rechtstreeks goedkeurt krijgt dezelfde weigering', async () => {
      metSchoolritOpTerugdag();
      mem.swaps = [ruil({ status: 'pending' })];
      const res = await keurGoed('s-terug', 'pending');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('al dienst EEK5');
      expect(mem.swaps[0].status).toBe('pending');
    });

    it('1-op-1 op dezelfde dag: de aanvrager met een tweede dienst die dag wordt geweigerd', async () => {
      mem.planning = [rij('sh-c14', C, '14'), rij('sh-c15', C, '15', DAG, ['19:00', '22:00']), rij('sh-b12', B, '12')];
      mem.swaps = [ruil({ returnDate: DAG })];
      const res = await keurGoed('s-terug');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain('Chauffeur C rijdt op 24/07/2026 al dienst 15');
      expect(mem.planning.map((r: any) => r.driverId)).toEqual([C, C, B]);
    });

    it('handmatige 1-op-1: de ontvanger met een tweede dienst die dag wordt geweigerd', async () => {
      // B rijdt 12 én 15 op dag 1 en ruilt 12 tegen de 14 van C: hij zou met
      // 14 én 15 eindigen. De regel geldt voor elke chauffeur die iets krijgt.
      mem.planning = [rij('sh-c14', C, '14'), rij('sh-b12', B, '12'), rij('sh-b15', B, '15', DAG, ['19:00', '22:00'])];
      const voor = stand();
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B, returnLine: '12' });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B rijdt op 24/07/2026 ook dienst 15, deze wissel zou een dubbele inplanning geven. Zet die dienst eerst weg.');
      expect(stand()).toBe(voor);
    });

    it('handmatige 1-op-1 op dezelfde dag blijft werken zonder tweede dienst', async () => {
      mem.planning = [rij('sh-c14', C, '14'), rij('sh-b12', B, '12')];
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B, returnLine: '12' });
      expect(res.status).toBe(200);
      expect(mem.planning.map((r: any) => r.driverId)).toEqual([B, C]);
    });

    it('de afwezigheid komt eerst: een zieke aanvrager met een schoolrit op de terugdag', async () => {
      metSchoolritOpTerugdag();
      ziek(C, DAG2);
      mem.swaps = [ruil()];
      const res = await keurGoed('s-terug');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur C is ziek gemeld op 25/07/2026, deze ruil kan niet doorgaan.');
    });

    it('het gewone geval: de aanvrager is op de terugdag vrij', async () => {
      mem.swaps = [ruil()];
      const res = await keurGoed('s-terug');
      expect(res.status).toBe(200);
      expect(mem.planning.map((r: any) => [r.id, r.driverId])).toEqual([['sh-c14', B], ['sh-b12', C]]);
    });

    it('het gewone geval via de lijst-route, met één extra lezing voor de terugdag', async () => {
      mem.swaps = [ruil()];
      mem.servicesLezingen = 0; mem.codesLezingen = 0; mem.matrixMaandFilters = [];
      const res = await keurGoedViaLijst('s-terug');
      expect(res.status).toBe(200);
      expect(mem.planning.map((r: any) => [r.id, r.driverId])).toEqual([['sh-c14', B], ['sh-b12', C]]);
      // Dienstoverzicht en codes één keer; de matrix één rij per dag.
      expect({ diensten: mem.servicesLezingen, codes: mem.codesLezingen, matrix: [...mem.matrixMaandFilters].sort() })
        .toEqual({ diensten: 1, codes: 1, matrix: [`${DAG}..${DAG}`, `${DAG2}..${DAG2}`] });
    });

    it('herhaald goedkeuren na een halve doorvoer blijft slagen', async () => {
      // De planning is al gewisseld, de status bleef hangen.
      mem.planning = [rij('sh-c14', B, '14'), rij('sh-b12', C, '12', DAG2)];
      mem.swaps = [ruil()];
      expect((await keurGoed('s-terug')).status).toBe(200);
    });

    it('een tegenprestatie "vrij" toetst de aanvrager niet', async () => {
      metSchoolritOpTerugdag();
      mem.swaps = [ruil({ returnCode: 'vrij' })];
      expect((await keurGoed('s-terug')).status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(B);
    });

    it('rusttijd blijft een waarschuwing: te weinig rust houdt de goedkeuring niet tegen', async () => {
      // B rijdt de avond vóór dag 1 tot 02:30 en krijgt op dag 1 een dienst om 10:00.
      mem.planning.push(rij('sh-b-laat', B, '15', '2026-07-23', ['17:00', '26:30']));
      mem.swaps = [ruil({ swapType: 'overname', returnDate: undefined, returnCode: undefined })];
      const lijst = await api('GET', '/api/swaps', { token: 'tok-planner' });
      expect(JSON.stringify(lijst.json.find((s: any) => s.id === 's-terug')?.rust ?? [])).toContain('"teKort":true');
      expect((await keurGoed('s-terug')).status).toBe(200);
    });
  });

  describe('variant 2: een code op het bord die het portaal niet kent', () => {
    const metCode = (code: string) => {
      mem.planningMatrix[0] = dag('m-d1', DAG, { 'Chauffeur A': 'EEK6', 'Chauffeur B': code, 'Chauffeur C': '14', 'Chauffeur D': 'vrij' });
    };
    const onbekend = (naam: string, datum: string, code: string) =>
      `${naam} staat op ${datum} op '${code}', en die code staat niet in het dienstoverzicht of de planningscodes. Voeg ze toe in Planningscodes en probeer opnieuw.`;
    const overname = (extra: Record<string, unknown> = {}) => ({
      id: 's-onb', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '',
      createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14', ...extra,
    });

    it('handmatige wissel naar wie op een onbekende code staat: geweigerd, met de code in de melding', async () => {
      metCode('FD');
      const voor = stand();
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      // Vóór de invariant: 200, en de code verdween van het bord.
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe(onbekend('Chauffeur B', '24/07/2026', 'FD'));
      expect(stand()).toBe(voor);
    });

    it.each(['eek 6', 'EEK-6', 'EEK6/2', 'EEK99'])('een schrijfwijze die het portaal nergens herkent (%s) is een onbekende code', async (code) => {
      // De import, de heropbouw en het bord zien deze schrijfwijzen ook niet
      // als EEK6: de normalisatie is bewust niet verruimd.
      metCode(code);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe(onbekend('Chauffeur B', '24/07/2026', code));
      expect(mem.swaps).toHaveLength(0);
    });

    it.each(['Eek6', ' EEK6 ', 'eek6'])('een schrijfwijze die het portaal wél herkent (%s) is de schoolrit', async (code) => {
      metCode(code);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain(`Chauffeur B rijdt op 24/07/2026 al dienst ${code.trim()}`);
    });

    it.each(['', ' ', '-', '...', '?', 'vrij', 'VRIJ', 'bv', 'TK', 'ta'])('een lege cel, leestekens of een overname-code (%j) is nooit bezet', async (code) => {
      // Ook zonder planningscodes: vrij, bv, tk en ta hoeven er niet in te staan.
      mem.planningCodes = mem.planningCodes.filter((c: any) => c.category === 'service');
      metCode(code);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(200);
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(B);
    });

    it('een code die in Planningscodes staat, welke categorie ook, is bekend', async () => {
      mem.planningCodes = [...mem.planningCodes, { code: 'fd', category: 'unknown', description: 'Feestdag' }];
      metCode('FD');
      expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    });

    it('de melding wijst de weg: na toevoegen in Planningscodes gaat dezelfde wissel door', async () => {
      metCode('FD');
      expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(409);
      mem.planningCodes = [...mem.planningCodes, { code: 'fd', category: 'absence', description: 'Feestdag', isDayOff: true }];
      expect((await wissel({ line: '14', fromDriverId: C, toDriverId: B })).status).toBe(200);
    });

    it('1-op-1: de gever die op een onbekende code staat krijgt er geen terugdienst bij', async () => {
      // C rijdt 14 (rijen) maar zijn cel toont een code die het portaal niet kent.
      mem.planningMatrix[0] = dag('m-d1', DAG, { 'Chauffeur B': '12', 'Chauffeur C': 'FD' });
      mem.planning = [rij('sh-c14', C, '14'), rij('sh-b12', B, '12')];
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B, returnLine: '12' });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe(onbekend('Chauffeur C', '24/07/2026', 'FD'));
      expect(mem.planning.map((r: any) => r.driverId)).toEqual([C, B]);
    });

    it('de afwezigheid komt eerst, ook bij een onbekende code', async () => {
      metCode('FD');
      ziek(B);
      const res = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe('Chauffeur B is ziek gemeld op 24/07/2026, deze ruil kan niet doorgaan.');
    });

    it('ruil goedkeuren (PATCH): de collega staat op een onbekende code', async () => {
      metCode('FD');
      mem.swaps = [overname()];
      const voor = stand();
      const res = await keurGoed('s-onb');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe(onbekend('Chauffeur B', '24/07/2026', 'FD'));
      expect(stand()).toBe(voor);
    });

    it('ruil goedkeuren (lijst): de collega staat op een onbekende code', async () => {
      metCode('FD');
      mem.swaps = [overname()];
      const res = await keurGoedViaLijst('s-onb');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe(onbekend('Chauffeur B', '24/07/2026', 'FD'));
      expect(mem.planning.find((r: any) => r.id === 'sh-c14')?.driverId).toBe(C);
    });

    it('ruil goedkeuren: de aanvrager staat op de terugdag op een onbekende code', async () => {
      mem.planningMatrix[1] = dag('m-d2', DAG2, { 'Chauffeur B': '12', 'Chauffeur C': 'FD' });
      mem.swaps = [overname({ swapType: 'ruil', returnDate: DAG2, returnCode: '12' })];
      const res = await keurGoed('s-onb');
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toBe(onbekend('Chauffeur C', '25/07/2026', 'FD'));
    });

    it('overname aanvragen weigerde een onbekende code al, met haar eigen melding (bestaand gedrag)', async () => {
      metCode('FD');
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [{ id: 's-nieuw', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'pending', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname' }] });
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain("Chauffeur B staat op 24/07/2026 ingepland als 'FD'");
      expect(mem.swaps).toHaveLength(0);
    });

    it('dienst toewijzen weigerde een onbekende code al, met haar eigen melding (bestaand gedrag)', async () => {
      metCode('FD');
      const res = await wijsToe(B);
      expect(res.status).toBe(409);
      expect(String(res.json?.error)).toContain("Chauffeur B staat op 2026-07-24 al op 'FD' in de planning");
      expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('FD');
    });
  });

  describe('variant 2, gemeten gevallen (tegenlezing 29-09)', () => {
    // Wat de tegenlezer mat, zwart op wit: welke cellen bij de ontvanger van
    // 200 naar 409 gingen en welke 200 bleven. De regel zelf is niet gewijzigd.
    // Of de matrix op productie zulke codes bevat, is niet nagekeken.
    const metCode = (code: string) => {
      mem.planningMatrix[0] = dag('m-d1', DAG, { 'Chauffeur A': 'EEK6', 'Chauffeur B': code, 'Chauffeur C': '14', 'Chauffeur D': 'vrij' });
    };
    const overname = () => ({ id: 's-gemeten', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '14' });
    /** De twee paden die de tegenlezer mat: handmatige wissel en goedkeuren. */
    const beide = async () => {
      mem.swaps = [overname()];
      const goedkeuren = await keurGoed('s-gemeten');
      mem.swaps = [];
      mem.planning = [rij('sh-c14', C, '14'), rij('sh-b12', B, '12', DAG2)];
      const handmatig = await wissel({ line: '14', fromDriverId: C, toDriverId: B });
      return { goedkeuren, handmatig };
    };
    const verwacht = (r: { goedkeuren: any; handmatig: any }, status: number, inMelding?: string) => {
      expect([r.handmatig.status, r.goedkeuren.status]).toEqual([status, status]);
      if (inMelding) for (const res of [r.handmatig, r.goedkeuren]) expect(String(res.json?.error)).toContain(inMelding);
    };

    describe('met de planningscodes eek5, eek6, vrij, ziek en opl', () => {
      beforeEach(() => {
        mem.planningCodes = [
          { code: 'eek5', category: 'service', description: 'Schoolrit', countsAsShift: true },
          { code: 'eek6', category: 'service', description: 'Schoolrit', countsAsShift: true },
          { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true },
          { code: 'ziek', category: 'absence', description: 'Ziek', isDayOff: true },
          { code: 'opl', category: 'training', description: 'Opleiding' },
        ];
      });

      it.each(['kv', 'fd', 'rec', 'R', 'X', '99', 'v', 'bv/2', 'eek 6', 'EEK-6', 'EEK6/2', 'naar garage brengen'])(
        "wordt geweigerd: de collega staat op '%s', een code die het portaal niet kent", async (code) => {
          metCode(code);
          verwacht(await beide(), 409, `Chauffeur B staat op 24/07/2026 op '${code}', en die code staat niet in het dienstoverzicht of de planningscodes.`);
        });

      it.each(['EEK6', 'eek5'])("wordt geweigerd: de collega rijdt de schoolrit '%s'", async (code) => {
        metCode(code);
        verwacht(await beide(), 409, `Chauffeur B rijdt op 24/07/2026 al dienst ${code}`);
      });

      it.each(['vrij', 'bv', 'tk', 'ta', '', '-', '/', 'opl', 'ziek', '13'])("blijft doorgaan: de collega staat op '%s'", async (code) => {
        // vrij/bv/tk/ta en een lege cel zijn nooit bezet. 'opl' en 'ziek'
        // staan in Planningscodes en zijn dus bekend: de handmatige wissel en
        // het goedkeuren toetsten een afwezigheidscode in de matrix nooit
        // (alleen de afwezigheid uit het portaal), en doen dat nog altijd niet.
        // '13' staat in het dienstoverzicht; zonder rijen is het geen conflict.
        metCode(code);
        verwacht(await beide(), 200);
      });
    });

    // Controle 29-09, 1c: een lege lijst is geen bewijs dat een code onbekend
    // is. Het blijft een weigering (409, er wordt niets geschreven), maar de
    // melding zegt wat er echt aan de hand is in plaats van "voeg de code toe
    // in Planningscodes". Een 409 en geen 503: de app toont de tekst van een
    // 409, en maakt van een 503 "het portaal is even in onderhoud".
    const leegMelding = (wat: string, plek: string) =>
      `${wat}, dus het portaal kan niet nagaan of Chauffeur B op 24/07/2026 al een dienst rijdt. Er is niets gewijzigd. Kijk ${plek} na en probeer opnieuw.`;
    const nietVoegToe = (r: { goedkeuren: any; handmatig: any }) => {
      for (const res of [r.handmatig, r.goedkeuren]) expect(String(res.json?.error)).not.toContain('Voeg ze');
    };

    describe('met een lege planningscodes-tabel', () => {
      beforeEach(() => { mem.planningCodes = []; });

      it.each(['opl', 'ziek', 'kv', 'fd', 'EEK6'])("wordt geweigerd met de melding dat de planningscodes leeg terugkwamen: '%s'", async (code) => {
        metCode(code);
        const r = await beide();
        verwacht(r, 409, leegMelding('De planningscodes kwamen leeg terug', 'Planningscodes'));
        nietVoegToe(r);
      });

      it.each(['vrij', 'bv', 'tk', 'ta', '', '13'])("blijft doorgaan: '%s'", async (code) => {
        metCode(code);
        verwacht(await beide(), 200);
      });

      it('elk schrijfpad weigert en schrijft niets; overname aanvragen en toewijzen houden hun eigen melding', async () => {
        metCode('kv');
        const leeg = leegMelding('De planningscodes kwamen leeg terug', 'Planningscodes');
        const nieuw = { id: 's-nieuw-leeg', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'pending', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname' };
        const paden: Array<[string, any[], () => Promise<any>, string]> = [
          ['handmatige wissel', [], () => wissel({ line: '14', fromDriverId: C, toDriverId: B }), leeg],
          ['goedkeuren via PATCH', [overname()], () => keurGoed('s-gemeten'), leeg],
          ['goedkeuren via de lijst', [overname()], () => keurGoedViaLijst('s-gemeten'), leeg],
          // Deze twee weigerden een cel die geen overname-code is altijd al,
          // vóór de regel tegen dubbele inplanning, met hun eigen melding.
          ['overname aanvragen', [], () => api('POST', '/api/swaps', { token: 'tok-planner', body: [nieuw] }), "Chauffeur B staat op 24/07/2026 ingepland als 'kv'."],
          ['dienst toewijzen', [], () => wijsToe(B), "Chauffeur B staat op 2026-07-24 al op 'kv' in de planning, die cel kan niet stil overschreven worden."],
        ];
        for (const [naam, ruilen, doe, melding] of paden) {
          mem.swaps = ruilen;
          const voor = stand();
          const res = await doe();
          expect([naam, res.status]).toEqual([naam, 409]);
          expect(String(res.json?.error), naam).toContain(melding);
          expect(stand(), naam).toBe(voor);
        }
      });

      it('dienst toewijzen aan wie een schoolrit via een wissel kreeg: de melding over de lege lijst', async () => {
        // In de matrix staat B op vrij, op het bord rijdt hij EEK6 (van A).
        // Zonder planningscodes is EEK6 niet te beoordelen: vóór 1c zei de
        // melding "voeg de code toe in Planningscodes".
        mem.planningCodes = [
          { code: 'eek6', category: 'service', description: 'Schoolrit', countsAsShift: true },
          { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true },
        ];
        expect((await wissel({ line: 'EEK6', fromDriverId: A, toDriverId: B })).status).toBe(200);
        mem.planningCodes = [];
        const voor = stand();
        const res = await wijsToe(B);
        expect(res.status).toBe(409);
        expect(String(res.json?.error)).toBe(leegMelding('De planningscodes kwamen leeg terug', 'Planningscodes'));
        expect(stand()).toBe(voor);
      });
    });

    describe('met een leeg dienstoverzicht', () => {
      beforeEach(() => { mem.services = []; });

      it('wordt geweigerd met de melding dat het dienstoverzicht leeg terugkwam', async () => {
        metCode('13');
        const r = await beide();
        verwacht(r, 409, leegMelding('Het dienstoverzicht kwam leeg terug', 'het Dienstoverzicht'));
        nietVoegToe(r);
      });

      it('blijft doorgaan: de collega staat op vrij', async () => {
        metCode('vrij');
        verwacht(await beide(), 200);
      });
    });

    describe('met beide lijsten leeg', () => {
      beforeEach(() => { mem.services = []; mem.planningCodes = []; });

      it('wordt geweigerd met de melding dat beide leeg terugkwamen', async () => {
        metCode('kv');
        const r = await beide();
        verwacht(r, 409, leegMelding('Het dienstoverzicht en de planningscodes kwamen leeg terug', 'beide lijsten'));
        nietVoegToe(r);
      });

      it.each(['vrij', 'bv', ''])("blijft doorgaan: '%s'", async (code) => {
        metCode(code);
        verwacht(await beide(), 200);
      });
    });

    describe('de lezing van de planningscodes of het dienstoverzicht faalt', () => {
      // De echte lezers gooien bij een databasefout (api/storage.ts:
      // getPlanningCodesData en paginatedFetch). Dat wordt een 500, geen
      // "alles is onbekend": er wordt niets geweigerd met een misleidende
      // melding over een onbekende code, en er wordt niets geschreven.
      const nieuw = () => ({ id: 's-nieuw-fout', shiftId: 'sh-c14', requesterId: C, targetDriverId: B, status: 'pending', reason: '', createdAt: '2026-07-20T08:00:00Z', swapType: 'overname' });
      // Per pad: de ruilen die er vooraf staan, en de bewerking.
      const paden = (): Array<[string, any[], () => Promise<any>]> => [
        ['handmatige wissel', [], () => wissel({ line: '14', fromDriverId: C, toDriverId: B })],
        ['goedkeuren via PATCH', [overname()], () => keurGoed('s-gemeten')],
        ['goedkeuren via de lijst', [overname()], () => keurGoedViaLijst('s-gemeten')],
        ['overname aanvragen', [], () => api('POST', '/api/swaps', { token: 'tok-planner', body: [nieuw()] })],
        ['dienst toewijzen', [], () => wijsToe(B)],
      ];

      it.each(['codesFaalt', 'servicesFaalt'] as const)('%s: elk schrijfpad geeft 500 en schrijft niets', async (welke) => {
        for (const [naam, ruilen, doe] of paden()) {
          mem.swaps = ruilen;
          const voor = JSON.stringify({ planning: mem.planning, swaps: mem.swaps, matrix: mem.planningMatrix });
          mem[welke] = true;
          const res = await doe();
          mem[welke] = false;
          expect([naam, res.status]).toEqual([naam, 500]);
          expect(String(res.json?.error), naam).not.toContain('niet in het dienstoverzicht of de planningscodes');
          expect(JSON.stringify({ planning: mem.planning, swaps: mem.swaps, matrix: mem.planningMatrix }), naam).toBe(voor);
        }
      });
    });
  });
});

describe('planning-import, periode-selectie', () => {
  // De planner maakt de Excel maanden vooruit, maar alleen het vaststaande
  // deel mag het portaal in: een meegegeven periode filtert de rijen vóór
  // opbouw én vervanging, alsof de rest niet in het bestand stond.
  const buildTweeMaandenXlsx = async () => {
    const XLSX = await import('xlsx');
    const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur B', 'aantal'],
      [serial('2030-09-01'), 'W', '12', '', 1],
      [serial('2030-10-01'), 'W', '', '14', 1],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };

  it('preview met periode filtert tot de gekozen dagen en meldt het volledige bestandsbereik', async () => {
    mem.leave = [];
    const res = await api('POST', '/api/planning-matrix/preview', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-09-01', tot: '2030-09-30' } },
    });
    expect(res.status).toBe(200);
    expect(res.json.importedDays).toBe(1);
    expect(res.json.startDate).toBe('2030-09-01');
    expect(res.json.endDate).toBe('2030-09-01');
    expect(res.json.fileStartDate).toBe('2030-09-01');
    expect(res.json.fileEndDate).toBe('2030-10-01');
  });

  it('import met periode schrijft alleen de geselecteerde dagen weg', async () => {
    mem.leave = [];
    mem.swaps = [];
    const res = await api('POST', '/api/planning-matrix/import', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-09-01', tot: '2030-09-30' } },
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.importedDays).toBe(1);
    // De oktober-rij uit het bestand is genegeerd: matrix én planning bevatten
    // alleen september.
    expect(mem.planningMatrix.map((r: any) => r.source_date)).toEqual(['2030-09-01']);
    expect(mem.planning.every((r: any) => r.date === '2030-09-01')).toBe(true);
  });

  it('weigert een periode zonder dagen, met het bestandsbereik in de melding', async () => {
    const res = await api('POST', '/api/planning-matrix/preview', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-11-01', tot: '2030-11-30' } },
    });
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toContain('Geen dagen binnen de gekozen periode');
    expect(String(res.json.error)).toContain('01/09/2030');
    expect(String(res.json.error)).toContain('01/10/2030');
  });

  it('weigert een periode met begindatum na einddatum', async () => {
    const res = await api('POST', '/api/planning-matrix/import', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-10-01', tot: '2030-09-01' } },
    });
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toContain('begindatum ligt na de einddatum');
  });
});

describe('planning-import, ingepakt met gzip (413 van het platform, 29-09)', () => {
  // 29-09: Jarno kon de nieuwe planning niet meer uploaden. Het bestand (.xls,
  // ±3,5 MB en groeiend) ging als base64 in JSON en werd 4/3 groter: boven de
  // 4,5 MB request body die een Vercel-functie aanneemt, dus een 413 van het
  // platform nog vóór de route draaide. De client pakt nu in met gzip
  // (src/lib/bestandInpakken.ts), de server pakt uit met een grens per soort
  // (api/_lib/matrixUpload.ts). Alle werkmappen hier zijn synthetisch.
  const MIB = 1024 * 1024;
  const CHAUFFEURS = Array.from({ length: 24 }, (_, i) => `Testchauffeur ${String(i + 1).padStart(2, '0')}`);
  const CODES = ['2101', '2102', '2103', 'V', ''];
  const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
  const dag = (n: number) => new Date(Date.UTC(2030, 8, 1 + n)).toISOString().slice(0, 10);
  const RAAD = 'Bewaar een kopie met alleen het tabblad “praktijk” en probeer het opnieuw.';

  const zaai = () => {
    mem.users.push(...CHAUFFEURS.map((name, i) => ({ id: String(100 + i), name, email: `tc${i}@vhb.be`, role: 'chauffeur', isActive: true })));
    mem.services = [
      { id: 'g1', serviceNumber: '2101', startTime: '06:15', endTime: '09:05', startTime2: '12:10', endTime2: '14:30', startTime3: '16:00', endTime3: '18:45', loopnr: '4500', loopnr2: '4611', loopnr3: '4702' },
      { id: 'g2', serviceNumber: '2102', startTime: '07:00', endTime: '10:00', startTime2: '15:00', endTime2: '19:00', loopnr: '4510', loopnr2: '4620' },
      { id: 'g3', serviceNumber: '2103', startTime: '05:30', endTime: '13:30', loopnr: '4520' },
    ];
    mem.planningCodes = [{ code: 'V', category: 'leave', description: 'Verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false }];
    mem.leave = [];
    mem.swaps = [];
    leegNaImport();
  };
  /** Wat een import schrijft, terug naar leeg (voor een tweede import in dezelfde test). */
  const leegNaImport = () => {
    mem.planning = [];
    mem.planningMatrix = [];
    mem.importHistory = [];
    mem.snapshots = {};
  };

  /** Een werkmap zoals die van de planning: "praktijk" (datum, dagtype, een
   *  kolom per chauffeur, "aantal") plus vulbladen die de import niet leest.
   *  Pseudo-willekeurig maar vast, en slechter comprimeerbaar dan de echte
   *  (±3,6× tegen 6× voor de werkmap van 19-08). */
  const werkmap = async (o: { dagen: number; vulbladen: number; rijen: number; soort: 'biff8' | 'xlsx' }) => {
    const XLSX = await import('xlsx');
    let x = 20260929;
    const kans = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x / 2 ** 32; };
    const kies = <T,>(lijst: T[]) => lijst[Math.floor(kans() * lijst.length)];
    const praktijk: unknown[][] = [['datum', 'dagtype', ...CHAUFFEURS, 'aantal']];
    for (let d = 0; d < o.dagen; d++) {
      const codes = CHAUFFEURS.map(() => kies(CODES));
      praktijk.push([serial(dag(d)), 'schooldag', ...codes, codes.filter((c) => /^\d/.test(c)).length]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(praktijk), 'praktijk');
    for (let s = 1; s <= o.vulbladen; s++) {
      const blad: unknown[][] = [Array.from({ length: 20 }, (_, c) => `kolom ${c + 1}`)];
      for (let r = 0; r < o.rijen; r++) {
        blad.push(Array.from({ length: 20 }, (_, c) => (c % 3 === 0 ? kies(CODES) : Math.round(kans() * 100000) / 100)));
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(blad), `vulblad ${s}`);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: o.soort }) as Buffer;
  };
  const KLEIN = { dagen: 60, vulbladen: 2, rijen: 300 } as const;

  /** De ruwe body naar de route sturen, byte voor byte wat de client bouwde. */
  const stuur = async (pad: string, body: string) => {
    const res = await fetch(`${baseUrl}${pad}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-planner', 'X-Device-Token': 'dev-ok' },
      body,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  /** Zoals de browser het verstuurt: dezelfde hulp, dezelfde body. */
  const alsClient = async (bestand: Buffer, extra?: Record<string, unknown>) => matrixVerzoek(await pakBestandIn(new Blob([bestand])), extra);
  const gzipVeld = (bestand: Buffer) => JSON.stringify({ xlsxGzipBase64: gzipSync(bestand).toString('base64') });
  /** Een bestand dat met de handtekening van een soort begint en verder leeg is. */
  const metKop = (bytes: number, kop: number[]) => { const b = Buffer.alloc(bytes); Buffer.from(kop).copy(b); return b; };
  const XLS_KOP = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

  it('het voorbeeld is met gzip exact hetzelfde als met de oude base64-vorm, voor een .xls en een .xlsx', async () => {
    zaai();
    for (const soort of ['biff8', 'xlsx'] as const) {
      const bestand = await werkmap({ ...KLEIN, soort });
      const periode = { van: dag(5), tot: dag(40) };
      const oud = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: bestand.toString('base64'), periode } });
      const nieuw = await stuur('/api/planning-matrix/preview', await alsClient(bestand, { periode }));
      expect(oud.status, soort).toBe(200);
      expect(nieuw.status, soort).toBe(200);
      expect(nieuw.json, soort).toEqual(oud.json);
      expect(nieuw.json, soort).toMatchObject({ importedDays: 36, startDate: dag(5), endDate: dag(40), fileStartDate: dag(0), fileEndDate: dag(59), unknownCodes: [], unmatchedDrivers: [] });
    }
  });

  it('de import met gzip schrijft hetzelfde als met base64: matrix, planning, historiek en herstelpunt', async () => {
    zaai();
    const bestand = await werkmap({ ...KLEIN, soort: 'biff8' });
    const extra = { filename: 'Dienstregeling test.xls', periode: { van: dag(0), tot: dag(29) } };
    const stand = () => JSON.parse(JSON.stringify({ matrix: mem.planningMatrix, planning: mem.planning, historiek: mem.importHistory, snapshots: mem.snapshots }));

    mem.planningMatrix = [{ id: 'm-oud', source_date: dag(0), day_type: 'W', assignments: { 'Testchauffeur 01': '2103' }, raw_row: '' }];
    const oud = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: bestand.toString('base64'), ...extra } });
    expect(oud.status).toBe(200);
    const naOud = stand();

    leegNaImport();
    mem.planningMatrix = [{ id: 'm-oud', source_date: dag(0), day_type: 'W', assignments: { 'Testchauffeur 01': '2103' }, raw_row: '' }];
    const nieuw = await stuur('/api/planning-matrix/import', await alsClient(bestand, extra));
    expect(nieuw.status).toBe(200);
    expect(nieuw.json).toEqual(oud.json);
    expect(stand()).toEqual(naOud);
    expect(naOud.matrix).toHaveLength(30);
    expect(naOud.historiek[0]).toMatchObject({ filename: 'Dienstregeling test.xls', importedDays: 30, periodStart: dag(0), periodEnd: dag(29) });
  });

  it('regressiebewaker: een .xls van meer dan 4 MB gaat als verzoek ruim onder de 4,5 MB en de server haalt er dezelfde rijen uit', async () => {
    zaai();
    // Boven het breekpunt van 29-09 (±3,37 MB): als base64 zou dit verzoek
    // het platform nooit halen.
    const bestand = await werkmap({ dagen: 123, vulbladen: 8, rijen: 1500, soort: 'biff8' });
    expect(bestand.length).toBeGreaterThanOrEqual(4 * MIB);
    expect(bestand.subarray(0, 4).toString('hex')).toBe('d0cf11e0');
    expect(JSON.stringify({ xlsxBase64: bestand.toString('base64') }).length).toBeGreaterThan(PLATFORM_GRENS_BYTES);

    // Het verzoek zoals de client het bouwt (matrixVerzoek gooit boven de
    // eigen grens, dus dat hij iets teruggeeft is al de controle vooraf).
    const ingepakt = await pakBestandIn(new Blob([bestand]));
    expect(ingepakt.gzip).toBe(true);
    const body = matrixVerzoek(ingepakt, { filename: 'Dienstregeling test.xls' });
    const bytes = new TextEncoder().encode(body).length;
    expect(bytes).toBeLessThan(PLATFORM_GRENS_BYTES);
    expect(bytes).toBeLessThan(bestand.length / 2);

    // De server leest er exact de rijen uit die het bestand zelf geeft.
    const { parsePlanningMatrixXlsxMetWaarschuwingen } = await import('../../api/_lib/matrixXlsx');
    const { rows } = await parsePlanningMatrixXlsxMetWaarschuwingen(bestand);
    expect(rows).toHaveLength(123);

    const voorbeeld = await stuur('/api/planning-matrix/preview', body);
    expect(voorbeeld.status).toBe(200);
    expect(voorbeeld.json).toMatchObject({
      importedDays: 123,
      detectedDrivers: Object.keys(rows[0].assignments).length,
      startDate: dag(0),
      endDate: dag(122),
      unknownCodes: [],
      unmatchedDrivers: [],
    });

    const imp = await stuur('/api/planning-matrix/import', body);
    expect(imp.status).toBe(200);
    expect(imp.json).toMatchObject({ success: true, importedDays: 123 });
    expect(mem.planningMatrix).toEqual(rows);
    expect(mem.importHistory[0]).toMatchObject({ filename: 'Dienstregeling test.xls', importedDays: 123 });
    // Tijdslimiet 60 s, niet de standaard 5 s: de werkmap van 4,4 MB bouwen en
    // drie keer lezen (hier, in het voorbeeld, in de import) duurt ±2 s op een
    // laptop en 7 tot 12 s op een CI-runner (62 runs, 29-09 tot 02-10). 60 s
    // is vijf keer de traagste daarvan.
  }, 60_000);

  it('een gzip-bom (klein ingepakt, groot uitgepakt) geeft een 413 met leesbare melding, en de server draait door', async () => {
    zaai();
    const bom = metKop(64 * MIB, XLS_KOP);
    const ingepakt = gzipSync(bom);
    expect(ingepakt.length).toBeLessThan(MIB);

    const res = await stuur('/api/planning-matrix/preview', JSON.stringify({ xlsxGzipBase64: ingepakt.toString('base64') }));
    expect(res.status).toBe(413);
    expect(res.json.error).toBe(`Het Excel-bestand is 64 MB, de grens voor een .xls is 15 MB. ${RAAD}`);
    expect((await stuur('/api/planning-matrix/import', JSON.stringify({ xlsxGzipBase64: ingepakt.toString('base64') }))).status).toBe(413);

    // Een staart die liegt (ISIZE 1000): de rem op het uitpakken houdt hem tegen.
    const liegt = Buffer.from(ingepakt);
    liegt.writeUInt32LE(1000, liegt.length - 4);
    const res2 = await stuur('/api/planning-matrix/preview', JSON.stringify({ xlsxGzipBase64: liegt.toString('base64') }));
    expect(res2.status).toBe(413);
    expect(res2.json.error).toBe(`Het Excel-bestand is meer dan 15 MB, de grens voor een .xls is 15 MB. ${RAAD}`);

    // Geen crash: het volgende verzoek werkt gewoon.
    const daarna = await stuur('/api/planning-matrix/preview', await alsClient(await werkmap({ ...KLEIN, soort: 'biff8' })));
    expect(daarna.status).toBe(200);
    expect(daarna.json.importedDays).toBe(60);
  });

  it('een .xls boven 15 MB en een .xlsx boven 5 MB geven elk een 413 met hun eigen grens', async () => {
    const xls = await stuur('/api/planning-matrix/preview', gzipVeld(metKop(15 * MIB + 1, XLS_KOP)));
    expect(xls.status).toBe(413);
    expect(xls.json.error).toBe(`Het Excel-bestand is 15,1 MB, de grens voor een .xls is 15 MB. ${RAAD}`);

    const xlsx = await stuur('/api/planning-matrix/preview', gzipVeld(metKop(5 * MIB + 1, [0x50, 0x4b, 0x03, 0x04])));
    expect(xlsx.status).toBe(413);
    expect(xlsx.json.error).toBe(`Het Excel-bestand is 5,1 MB, de grens voor een .xlsx is 5 MB. ${RAAD}`);
  });

  it('een onbekend formaat gaat zoals vroeger naar de parser (400 van de parser), een beschadigde gzip geeft een nette 400', async () => {
    // Geen .xls en geen .xlsx: zoals vóór 29-09 beslist de parser (hier: geen
    // tabblad "praktijk"), in beide vormen met dezelfde melding.
    const tekst = Buffer.from('datum;dagtype;Testchauffeur 01;aantal\n01/09/2030;W;2101;1\n');
    for (const body of [gzipVeld(tekst), JSON.stringify({ xlsxBase64: tekst.toString('base64') })]) {
      const res = await stuur('/api/planning-matrix/preview', body);
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/^Tabblad "praktijk" niet gevonden/);
    }
    // Groter dan de grens van vóór 29-09 (5 MB): 413 met die grens.
    const grootTekst = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41);
    const teGrootTekst = await stuur('/api/planning-matrix/preview', gzipVeld(grootTekst));
    expect(teGrootTekst.status).toBe(413);
    expect(teGrootTekst.json.error).toBe(`Het Excel-bestand is 5,1 MB, de grens is 5 MB. ${RAAD}`);
    const BESCHADIGD = 'Het ingepakte Excel-bestand is beschadigd. Kies het bestand opnieuw.';
    const geenGzip = await stuur('/api/planning-matrix/preview', JSON.stringify({ xlsxGzipBase64: tekst.toString('base64') }));
    expect(geenGzip.status).toBe(400);
    expect(geenGzip.json.error).toBe(BESCHADIGD);
    const afgebroken = gzipSync(await werkmap({ ...KLEIN, soort: 'biff8' })).subarray(0, 5000);
    const halve = await stuur('/api/planning-matrix/import', JSON.stringify({ xlsxGzipBase64: afgebroken.toString('base64') }));
    expect(halve.status).toBe(400);
    expect(halve.json.error).toBe(BESCHADIGD);
  });
});

describe('Excel-terugexport van de maandplanning', () => {
  beforeEach(() => {
    mem.planningMatrix = [
      { id: 'm-1', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
    ];
  });

  it('weigert een chauffeur (403)', async () => {
    const res = await api('GET', '/api/month-planning?month=2026-07&format=xlsx', { token: 'tok-a' });
    expect(res.status).toBe(403);
  });

  it('levert een geldig xlsx-bestand met de actuele cel-waarheid', async () => {
    // Wissel doorgevoerd ná de Excel-import: de export moet de áctuele stand
    // bevatten (dienst 12 bij chauffeur B), niet de originele upload.
    mem.swaps = [{
      id: 's-x', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: '', createdAt: '2026-07-01T08:00:00Z', decidedAt: '2026-07-02T08:00:00Z',
      shiftDate: '2026-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const raw = await fetch(`${baseUrl}/api/month-planning?month=2026-07&format=xlsx`, {
      headers: { Authorization: 'Bearer tok-planner', 'X-Device-Token': 'dev-ok' },
    });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toContain('spreadsheetml');
    expect(raw.headers.get('content-disposition')).toContain('planning-2026-07.xlsx');
    const XLSX = await import('xlsx');
    const wb = XLSX.read(Buffer.from(await raw.arrayBuffer()), { type: 'buffer' });
    const ws = wb.Sheets['praktijk'];
    expect(ws).toBeTruthy();
    const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, raw: true });
    const header = (rows[0] as any[]).map((h: any) => String(h).toLowerCase());
    expect(header).toContain('chauffeur a');
    expect(header).toContain('chauffeur b');
    // Kolom A is een Excel-serial (zelfde formaat als de praktijk-tab-upload).
    const serial = Math.round((Date.parse('2026-07-15T00:00:00Z') - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const dag = rows.find((r: any[]) => Number(r[0]) === serial) as any[];
    expect(dag).toBeTruthy();
    const colB = header.indexOf('chauffeur b');
    const colA = header.indexOf('chauffeur a');
    expect(String(dag[colB])).toBe('12');
    // Chauffeur A gaf de dienst weg (overname) → geen dienstcode meer.
    expect(String(dag[colA] ?? '')).not.toBe('12');
  });
});

describe('verbeterronde 20-08, import-signalen & planning-aanwezigheid', () => {
  const bouwXlsx = async (aoa: unknown[][]) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };
  const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);

  it('preview waarschuwt voor kolommen ná "aantal" en vergelijkt chauffeurs met de planning vlak vóór de periode', async () => {
    // Bestaande matrix (juli 2030, binnen het 60-dagen-venster) heeft
    // Chauffeur A + B; dit bestand (2030-08) heeft alleen A + een nieuwe C,
    // plus een kolom áchter aantal — precies het patroon waarmee Luc Cherlet
    // op 20-08 geruisloos verdween.
    mem.planningMatrix = [
      { id: 'm-jul', source_date: '2030-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
    ];
    const base64 = await bouwXlsx([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur C', 'aantal', 'Vergeten Chauffeur'],
      [serial('2030-08-03'), 'W', '12', '14', 2, '15'],
    ]);
    const res = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(res.status).toBe(200);
    expect(res.json.parserWaarschuwingen).toHaveLength(1);
    expect(res.json.parserWaarschuwingen[0]).toContain('Vergeten Chauffeur');
    expect(res.json.chauffeursVerdwenen).toEqual([{ naam: 'Chauffeur B', laatste: '2030-07-08' }]);
    expect(res.json.chauffeursNieuw).toEqual(['Chauffeur C']);
  });

  it('chauffeurs-vergelijking: oude planning buiten het venster telt niet mee; dekt het bestand alles, dan vergelijkt hij met de oude versie van de periode zelf', async () => {
    const base64 = await bouwXlsx([
      ['datum', 'dagtype', 'Chauffeur A', 'aantal'],
      [serial('2030-08-03'), 'W', '12', 1],
    ]);
    // Alleen jaren-oude rijen (ver buiten het 60-dagen-venster): geen ruis
    // over allang vertrokken collega's.
    mem.planningMatrix = [
      { id: 'm-oud', source_date: '2026-07-01', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
    ];
    const stil = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(stil.json.chauffeursVerdwenen).toEqual([]);
    expect(stil.json.chauffeursNieuw).toEqual([]);

    // Zelfde bestand, maar nu bestaat er een oude versie van exact deze
    // periode mét Chauffeur B: de fallback vergelijkt daarmee.
    mem.planningMatrix = [
      { id: 'm-zelfde', source_date: '2030-08-03', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
    ];
    const fallback = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(fallback.json.chauffeursVerdwenen).toEqual([{ naam: 'Chauffeur B', laatste: '2030-08-03' }]);
  });

  it('preview meldt Excel-"ziek" zonder geregistreerde ziekteperiode, en zwijgt mét', async () => {
    const base64 = await bouwXlsx([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur B', 'aantal'],
      [serial('2030-08-03'), 'W', 'ziek', '14', 1],
    ]);
    const zonder = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(zonder.status).toBe(200);
    expect(zonder.json.ziekTeRegistreren).toEqual([{ userId: '3', naam: 'Chauffeur A', van: '2030-08-03', tot: '2030-08-03', dagen: 1, actief: true, ambigu: false }]);

    mem.leave = [
      { id: 'l-z', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-30T06:00:00Z', decidedAt: '2030-07-30T06:00:00Z' },
    ];
    const met = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(met.json.ziekTeRegistreren).toEqual([]);
  });

  it('GET /api/coverage-expectation-check vindt structurele afwijkingen (en is staf-only)', async () => {
    mem.planningMatrix = [
      { id: 'm-a', source_date: '2030-09-01', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': '2515' }, raw_row: '' },
      { id: 'm-b', source_date: '2030-09-02', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': '2515' }, raw_row: '' },
    ];
    mem.coverageExpectations = { school: ['2101', '2114'] };
    const res = await api('GET', '/api/coverage-expectation-check?from=2030-09-01&to=2030-09-30', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.afwijkingen).toEqual([
      { dayType: 'school', dagen: 2, nooitGereden: ['2114'], nietVerwacht: [{ code: '2515', dagen: 2 }] },
    ]);
    const verboden = await api('GET', '/api/coverage-expectation-check?from=2030-09-01&to=2030-09-30', { token: 'tok-a' });
    expect(verboden.status).toBe(403);
  });

  it('GET /api/ziekte-zonder-registratie kijkt alleen vooruit', async () => {
    mem.planningMatrix = [
      { id: 'm-verleden', source_date: '2020-01-01', day_type: '', assignments: { 'Chauffeur A': 'ziek' }, raw_row: '' },
      { id: 'm-toekomst', source_date: '2030-09-01', day_type: '', assignments: { 'Chauffeur A': 'ziek' }, raw_row: '' },
    ];
    const res = await api('GET', '/api/ziekte-zonder-registratie', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.reeksen).toEqual([{ userId: '3', naam: 'Chauffeur A', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: true, ambigu: false }]);
  });

  it('GET /api/planning-presence geeft per gematchte chauffeur de laatste datum in de matrix', async () => {
    const res = await api('GET', '/api/planning-presence', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.van).toBe('2026-07-01');
    expect(res.json.tot).toBe('2026-07-08');
    const perUser = Object.fromEntries(res.json.perUser.map((p: { userId: string; laatste: string }) => [p.userId, p.laatste]));
    // Ook een afwezigheidscel (bv) telt als "komt voor in de planning".
    expect(perUser['3']).toBe('2026-07-08');
    expect(perUser['4']).toBe('2026-07-08');
  });
});

describe('import-keten, golden end-to-end (echte praktijk-structuur)', () => {
  // Grotere richting 01-09: de keten-bugs die Jarno echt raakten zaten
  // allemaal NÁ de parser (valse kolom-waarschuwingen op het tellingen-blok,
  // een verdwenen terugruil-been bij herimport, wegvallende chauffeurs) —
  // deze suite laat een structuurgetrouwe praktijk-tab door de échte
  // import-route lopen (parser → matrix → planning → ruil-replay) en
  // controleert het eindresultaat, niet de tussenstappen.
  const CHAUFFEURS = ['Testman Aa', 'Testman Ab', 'Testman Ac', 'Testman Ad', 'Testman Ae', 'Testman Af'];
  const DAGEN = ['2030-09-01', '2030-09-02', '2030-09-03', '2030-09-04', '2030-09-05'];
  // Expliciet codeplan (dag × chauffeur): dienstcodes met 3/2/1 tijdblokken,
  // 'V' = verlofcode (absence), '' = vrije dag (lege cel).
  const CODES: string[][] = [
    ['2101', '2102', '2103', 'V',    '',     '2103'],
    ['2102', '2101', 'V',    '2103', '2103', ''    ],
    ['2103', '',     '2101', '2102', 'V',    '2103'],
    ['V',    '2103', '2102', '2101', '2103', ''    ],
    ['2101', '2103', '',     'V',    '2102', '2103'],
  ];
  const SEGMENTEN: Record<string, number> = { 2101: 3, 2102: 2, 2103: 1 };
  const verwachteShifts = CODES.flat().reduce((n, c) => n + (SEGMENTEN[c] ?? 0), 0);
  const verwachteAbsences = CODES.flat().filter((c) => c === 'V').length;

  const seedKeten = () => {
    mem.users.push(...CHAUFFEURS.map((name, i) => ({ id: String(10 + i), name, email: `t${i}@vhb.be`, role: 'chauffeur', isActive: true })));
    mem.services = [
      { id: 'g1', serviceNumber: '2101', startTime: '06:15', endTime: '09:05', startTime2: '12:10', endTime2: '14:30', startTime3: '16:00', endTime3: '18:45', loopnr: '4500', loopnr2: '4611', loopnr3: '4702' },
      { id: 'g2', serviceNumber: '2102', startTime: '07:00', endTime: '10:00', startTime2: '15:00', endTime2: '19:00', loopnr: '4510', loopnr2: '4620' },
      { id: 'g3', serviceNumber: '2103', startTime: '05:30', endTime: '13:30', loopnr: '4520' },
    ];
    mem.planningCodes = [
      { code: 'V', category: 'leave', description: 'Verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false },
    ];
    mem.leave = [];
    mem.swaps = [];
    mem.planning = [];
    mem.planningMatrix = [];
  };

  /** Structuurgetrouwe praktijk-tab: chauffeurs vóór "aantal", daarna het
   *  tellingen-blok dat elke naam nóg drie keer als kopje herhaalt (de bron
   *  van de 114 valse waarschuwingen op 25-08). */
  const goldenXlsxBase64 = async (opts: { extraKolomNaAantal?: string } = {}) => {
    const XLSX = await import('xlsx');
    const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const herhaald = opts.extraKolomNaAantal ? [...CHAUFFEURS, opts.extraKolomNaAantal] : CHAUFFEURS;
    const header = ['datum', 'dagtype', ...CHAUFFEURS, 'aantal', ...herhaald, 'uur', ...herhaald, '', ...herhaald];
    const rows: unknown[][] = [header];
    DAGEN.forEach((iso, dag) => {
      const codes = CODES[dag];
      const aantal = codes.filter((c) => /^\d+$/.test(c)).length;
      const tellingen = herhaald.map((_, i) => (codes[i] ? 1 : 0));
      rows.push([serial(iso), 'W', ...codes, aantal, ...tellingen, '', ...tellingen, '', ...tellingen]);
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };

  const importeer = async (base64: string) =>
    api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: base64, filename: 'golden.xlsx' } });

  it('bouwt de volledige planning uit de golden Excel: segmenten, afwezigheden, historiek, herstelpunt', async () => {
    seedKeten();
    const res = await importeer(await goldenXlsxBase64());
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      success: true,
      importedDays: 5,
      generatedShifts: verwachteShifts,
      skippedAbsences: verwachteAbsences,
      unknownCodes: [],
      unmatchedDrivers: [],
      servicesWithoutSegments: [],
      startDate: '2030-09-01',
      endDate: '2030-09-05',
    });
    // Het tellingen-blok ná "aantal" geeft géén valse waarschuwingen
    // (regressie 25-08: 114 × "kolom ná aantal" op de chauffeurskopjes).
    expect(res.json.parserWaarschuwingen ?? []).toEqual([]);

    // Matrix: 5 dagen, alleen de niet-lege codes per dag.
    expect(mem.planningMatrix).toHaveLength(5);
    expect(mem.planningMatrix[0].assignments).toEqual({
      'Testman Aa': '2101', 'Testman Ab': '2102', 'Testman Ac': '2103', 'Testman Ad': 'V', 'Testman Af': '2103',
    });

    // Planning: exact één rij per tijdblok. De gesplitste dienst 2101 van
    // Testman Aa op 01-09 = drie rijen met de juiste tijden én loopnummers.
    expect(mem.planning).toHaveLength(verwachteShifts);
    const aaDag1 = mem.planning
      .filter((r: any) => r.driverId === '10' && r.date === '2030-09-01')
      .sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
    expect(aaDag1.map((r: any) => [r.line, r.startTime, r.endTime, r.loopnr])).toEqual([
      ['2101', '06:15', '09:05', '4500'],
      ['2101', '12:10', '14:30', '4611'],
      ['2101', '16:00', '18:45', '4702'],
    ]);
    // De verlofcode levert géén planning-rij op (Testman Ad op 01-09).
    expect(mem.planning.some((r: any) => r.driverId === '13' && r.date === '2030-09-01')).toBe(false);

    // Historiek + herstelpunt: één entry met werkend snapshot-pad.
    expect(mem.importHistory).toHaveLength(1);
    expect(mem.importHistory[0]).toMatchObject({ importedDays: 5, generatedShifts: verwachteShifts, filename: 'golden.xlsx' });
    expect(mem.importHistory[0].snapshotPath).toBeTruthy();
    expect(mem.snapshots[mem.importHistory[0].snapshotPath]).toBeTruthy();
  });

  it('waarschuwt over een échte chauffeurskolom ná "aantal" (maar blokkeert niet)', async () => {
    seedKeten();
    // 'Testman Nieuw' bestaat als gebruiker maar staat alléén ná "aantal" —
    // vóór de waarschuwing (#386) viel zo'n chauffeur geruisloos uit de import.
    mem.users.push({ id: '20', name: 'Testman Nieuw', email: 'nieuw@vhb.be', role: 'chauffeur', isActive: true });
    const res = await importeer(await goldenXlsxBase64({ extraKolomNaAantal: 'Testman Nieuw' }));
    expect(res.status).toBe(200);
    const waarschuwingen: string[] = res.json.parserWaarschuwingen ?? [];
    expect(waarschuwingen.length).toBeGreaterThan(0);
    // …en élke waarschuwing gaat over de echte nieuwe kolom: de herhaalde
    // kopjes van de bestaande chauffeurs in het tellingen-blok blijven stil
    // (regressie 25-08: 114 valse meldingen).
    expect(waarschuwingen.every((w) => w.includes('Testman Nieuw') && w.includes('aantal'))).toBe(true);
  });

  it('herimport voert een goedgekeurde 1-op-1-ruil opnieuw door, beide benen', async () => {
    seedKeten();
    await importeer(await goldenXlsxBase64());
    // Aa (10) geeft zijn 2101 van 01-09 aan Ab (11) en neemt Ab's 2102 die
    // dag terug. De Excel weet hier niets van — de replay moet het doen.
    mem.swaps.push({
      id: 'gs-1', shiftId: 'x', requesterId: '10', targetDriverId: '11', status: 'approved',
      reason: '', createdAt: '2030-08-20T08:00:00Z', decidedAt: '2030-08-21T08:00:00Z',
      shiftDate: '2030-09-01', shiftLine: '2101', returnDate: '2030-09-01', returnCode: '2102',
    });
    const res = await importeer(await goldenXlsxBase64());
    expect(res.status).toBe(200);
    // Heen: alle DRIE de segmenten van 2101/01-09 staan op Ab…
    const heen = mem.planning.filter((r: any) => r.date === '2030-09-01' && r.line === '2101');
    expect(heen).toHaveLength(3);
    expect(heen.every((r: any) => r.driverId === '11')).toBe(true);
    // …en terug: beide segmenten van 2102/01-09 op Aa (regressie: het
    // terugruil-been verdween bij herimport — controle-ronde 27-08, nr. 8).
    const terug = mem.planning.filter((r: any) => r.date === '2030-09-01' && r.line === '2102');
    expect(terug).toHaveLength(2);
    expect(terug.every((r: any) => r.driverId === '10')).toBe(true);
    // De rest van de dag is onaangeraakt.
    expect(mem.planning.filter((r: any) => r.date === '2030-09-01' && r.line === '2103').every((r: any) => ['12', '15'].includes(r.driverId))).toBe(true);
  });

  it('herimport met verlof dat intussen is goedgekeurd blokkeert met het juiste onderscheid', async () => {
    seedKeten();
    await importeer(await goldenXlsxBase64());
    // Ná de eerste import keurt de planner verlof goed voor Testman Ab op
    // 02-09 — een conflict dat wél in de Excel zit (Ab staat daar op 2101).
    mem.leave = [
      { id: 'gl-1', userId: '11', startDate: '2030-09-02', endDate: '2030-09-02', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2030-08-25T08:00:00Z', decidedAt: '2030-08-26T08:00:00Z' },
    ];
    const res = await importeer(await goldenXlsxBase64());
    expect(res.status).toBe(400);
    expect(res.json.blocked).toBe(true);
    expect(res.json.matrixVerlofConflicts).toHaveLength(1);
    expect(res.json.matrixVerlofConflicts[0]).toMatchObject({ driverName: 'Testman Ab', date: '2030-09-02', serviceNumber: '2101' });
    expect(res.json.ruilVerlofConflicts).toHaveLength(0);
    // De bestaande planning is NIET vervangen door de geweigerde import.
    expect(mem.planning).toHaveLength(verwachteShifts);
  });
});

describe('per-record API (PUT / POST one / DELETE), gebruikers, omleidingen, updates', () => {
  const REV = 'x-record-revision';
  const COLL = 'x-collection-revision';
  const revVan = async (pad: string, token: string, id: string): Promise<string> => {
    const res = await api('GET', pad, { token });
    expect(res.status).toBe(200);
    const rec = res.json.find((r: any) => String(r.id) === id);
    expect(rec?._rev).toBeTruthy();
    return rec._rev as string;
  };

  describe('gebruikers', () => {
    it('GET /api/users geeft per record een stabiele _rev die niet meebeweegt met een login', async () => {
      const a = await revVan('/api/users', 'tok-admin', '3');
      mem.users = mem.users.map((u: any) => (u.id === '3' ? { ...u, lastLogin: '2026-09-03T08:00:00Z', activeSessions: 1 } : u));
      expect(await revVan('/api/users', 'tok-admin', '3')).toBe(a);
      mem.users = mem.users.map((u: any) => (u.id === '3' ? { ...u, phone: '0470 11 22 33' } : u));
      expect(await revVan('/api/users', 'tok-admin', '3')).not.toBe(a);
    });

    it('PUT /api/users/:id met de juiste revisie slaat op, logt per gebruiker en geeft het canonieke record + nieuwe _rev terug', async () => {
      const rev = await revVan('/api/users', 'tok-admin', '3');
      const res = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], phone: '0470 99 88 77' }, headers: { [REV]: rev } });
      expect(res.status).toBe(200);
      expect(res.json.user.phone).toBe('0470 99 88 77');
      expect(res.json.user._rev).toBeTruthy();
      expect(res.json.user._rev).not.toBe(rev);
      expect(res.headers.get(COLL)).toBeTruthy();
      expect(mem.users.find((u: any) => u.id === '3')?.phone).toBe('0470 99 88 77');
      expect(mem.users).toHaveLength(4);
      expect(mem.activity.find((a) => a.action === 'Gebruiker gewijzigd' && a.entityId === '3')).toBeTruthy();
      // Geen collectie-samenvatting ("N gebruikers verwerkt") bij een per-record-save.
      expect(mem.activity.find((a) => a.action === 'Gebruikers opgeslagen')).toBeFalsy();
    });

    it('PUT met een verouderde revisie geeft 409 mét het actuele record en wijzigt niets', async () => {
      const rev = await revVan('/api/users', 'tok-admin', '3');
      // Collega wijzigt intussen de naam.
      mem.users = mem.users.map((u: any) => (u.id === '3' ? { ...u, name: 'Chauffeur A (collega)' } : u));
      const res = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], phone: '0470 00 00 00' }, headers: { [REV]: rev } });
      expect(res.status).toBe(409);
      expect(res.json.conflict).toBe('record');
      expect(res.json.record.name).toBe('Chauffeur A (collega)');
      expect(res.json.record._rev).toBeTruthy();
      expect(mem.users.find((u: any) => u.id === '3')?.phone).toBeUndefined();
    });

    it('PUT zonder revisie-header → 400; onbekend id → 404; planner → 403', async () => {
      const zonder = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2] } });
      expect(zonder.status).toBe(400);
      const weg = await api('PUT', '/api/users/bestaat-niet', { token: 'tok-admin', body: { name: 'X' }, headers: { [REV]: 'x' } });
      expect(weg.status).toBe(404);
      const planner = await api('PUT', '/api/users/3', { token: 'tok-planner', body: { ...mem.users[2] }, headers: { [REV]: 'x' } });
      expect(planner.status).toBe(403);
    });

    it('PUT handhaaft het wachtwoordminimum en de laatste-admin-regel', async () => {
      const rev3 = await revVan('/api/users', 'tok-admin', '3');
      const kort = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], password: 'kort' }, headers: { [REV]: rev3 } });
      expect(kort.status).toBe(400);
      const rev1 = await revVan('/api/users', 'tok-admin', '1');
      const degradeer = await api('PUT', '/api/users/1', { token: 'tok-admin', body: { ...mem.users[0], role: 'chauffeur' }, headers: { [REV]: rev1 } });
      expect(degradeer.status).toBe(400);
      expect(mem.users.find((u: any) => u.id === '1')?.role).toBe('admin');
    });

    it('POST /api/users/one maakt één gebruiker aan (201) en stuurt de welkomstmail', async () => {
      const res = await api('POST', '/api/users/one', { token: 'tok-admin', body: { id: 'n-1', name: 'Nieuwe Collega', role: 'chauffeur', employeeId: 'VHB-9', email: 'nieuw@vhb.be', password: 'tijdelijk-wachtwoord' } });
      expect(res.status).toBe(201);
      expect(res.json.user.id).toBe('n-1');
      expect(res.json.user._rev).toBeTruthy();
      expect(mem.users).toHaveLength(5);
      expect(mem.emailsSent.find((m) => m.context === 'welcome:nieuw@vhb.be')).toBeTruthy();
      expect(mem.activity.find((a) => a.action === 'Gebruiker toegevoegd' && a.entityId === 'n-1')).toBeTruthy();
      // Zelfde id nog eens → 409, en een bezet e-mailadres → 409.
      expect((await api('POST', '/api/users/one', { token: 'tok-admin', body: { id: 'n-1', name: 'Dubbel' } })).status).toBe(409);
      expect((await api('POST', '/api/users/one', { token: 'tok-admin', body: { name: 'Dubbel', email: 'A@vhb.be' } })).status).toBe(409);
    });

    it('e-mailadres dat in Auth al bij een ánder account hoort → 409 (conflict: email), niets herkoppeld (controle 05-09, nr. 29)', async () => {
      mem.authEmailBezet = 'vreemd@vhb.be';
      const rev = await revVan('/api/users', 'tok-admin', '3');
      const put = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], email: 'Vreemd@vhb.be' }, headers: { [REV]: rev } });
      expect(put.status).toBe(409);
      expect(put.json.conflict).toBe('email');
      expect(put.json.error).toMatch(/al in gebruik bij een ander account/);
      expect(mem.users[2].email).toBe('a@vhb.be');
      const post = await api('POST', '/api/users/one', { token: 'tok-admin', body: { name: 'Nieuw', role: 'chauffeur', email: 'vreemd@vhb.be' } });
      expect(post.status).toBe(409);
      expect(post.json.conflict).toBe('email');
      expect(mem.users).toHaveLength(4);
      // Collectie-POST: zelfde 409 i.p.v. een 500.
      const bulk = await api('POST', '/api/users', { token: 'tok-admin', body: mem.users.map((u: any) => (u.id === '4' ? { ...u, email: 'vreemd@vhb.be' } : u)) });
      expect(bulk.status).toBe(409);
      expect(bulk.json.conflict).toBe('email');
    });

    it('POST /api/users/one weigert een kort wachtwoord (400) en een lijst (400)', async () => {
      expect((await api('POST', '/api/users/one', { token: 'tok-admin', body: { name: 'X', email: 'x@vhb.be', password: 'kort' } })).status).toBe(400);
      expect((await api('POST', '/api/users/one', { token: 'tok-admin', body: [{ name: 'X' }] })).status).toBe(400);
    });

    it('DELETE /api/users/:id verwijdert de gebruiker en ruimt zijn documenten op', async () => {
      mem.documents = [
        { id: 'd1', userId: '3', filename: 'a.pdf', storagePath: '3/a', uploadedAt: '2026-07-01T00:00:00Z' },
        { id: 'd2', userId: '4', filename: 'b.pdf', storagePath: '4/b', uploadedAt: '2026-07-01T00:00:00Z' },
      ];
      const rev = await revVan('/api/users', 'tok-admin', '3');
      const res = await api('DELETE', '/api/users/3', { token: 'tok-admin', headers: { [REV]: rev } });
      expect(res.status).toBe(200);
      expect(mem.users.map((u: any) => u.id)).toEqual(['1', '2', '4']);
      expect(mem.documents.map((d: any) => d.id)).toEqual(['d2']);
      expect(mem.activity.find((a) => a.action === 'Gebruiker verwijderd' && a.entityId === '3')).toBeTruthy();
      expect(mem.activity.find((a) => a.action === 'Documenten opgeruimd' && a.entityId === '3')).toBeTruthy();
    });

    it('DELETE: jezelf → 403 (ook met juiste revisie), verouderde revisie → 409, niets verwijderd', async () => {
      const revZelf = await revVan('/api/users', 'tok-admin', '1');
      expect((await api('DELETE', '/api/users/1', { token: 'tok-admin', headers: { [REV]: revZelf } })).status).toBe(403);
      const stale = await api('DELETE', '/api/users/3', { token: 'tok-admin', headers: { [REV]: 'oud' } });
      expect(stale.status).toBe(409);
      expect(stale.json.record.id).toBe('3');
      expect(mem.users).toHaveLength(4);
      // (De laatste-admin-regel op DELETE deelt laatsteAdminVerdwijnt met PUT — daar getest.)
    });
  });

  describe('omleidingen', () => {
    beforeEach(() => {
      mem.diversions = [
        { id: 'o-1', line: '12', title: 'Werken N70', description: 'Omrijden via …', startDate: '2026-07-01', endDate: '2026-07-31' },
        { id: 'o-2', line: '14', title: 'Kermis', description: 'Centrum afgesloten', startDate: '2026-08-01' },
      ];
    });

    it('GET geeft _rev per omleiding; POST one (201) logt en geeft het record terug', async () => {
      expect(await revVan('/api/diversions', 'tok-planner', 'o-1')).toBeTruthy();
      const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: { line: '1', title: 'Nieuwe omleiding', description: 'x', startDate: '2026-09-10' } });
      expect(res.status).toBe(201);
      expect(res.json.diversion.title).toBe('Nieuwe omleiding');
      expect(res.json.diversion.id).toBeTruthy();
      expect(res.json.diversion._rev).toBeTruthy();
      expect(mem.diversions).toHaveLength(3);
      expect(mem.activity.find((a) => a.action === 'Omleiding toegevoegd')).toBeTruthy();
      expect(mem.activity.find((a) => a.action === 'Omleidingen opgeslagen')).toBeFalsy();
    });

    it('POST one pusht "Nieuwe omleiding" naar de actieve chauffeurs (niet naar staf), soort omleiding, naar /omleidingen/<id>', async () => {
      mem.users = [...mem.users, { id: '9', name: 'Gepauzeerde Chauffeur', email: 'pauze@vhb.be', role: 'chauffeur', isActive: false }];
      const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: { line: '12', title: 'Werken Stationsstraat', description: 'x', startDate: '2026-09-10', endDate: '2026-09-20' } });
      expect(res.status).toBe(201);
      const pushes = mem.pushesSent.filter((p) => p.payload.title === 'Nieuwe omleiding');
      expect(pushes).toHaveLength(1);
      expect(pushes[0].userIds.sort()).toEqual(['3', '4']); // de twee actieve chauffeurs, geen admin, planner of gepauzeerd account
      expect(pushes[0].payload.soort).toBe('omleiding');
      // Titel, lijn en periode in dd/mm/jjjj, nooit ISO.
      expect(pushes[0].payload.body).toBe('Werken Stationsstraat (lijn 12), 10/09/2026 t/m 20/09/2026');
      expect(pushes[0].payload.url).toBe(`/omleidingen/${encodeURIComponent(res.json.diversion.id)}`);
    });

    it('een nieuwe omleiding via de lijst-POST pusht ook; wijzigen en verwijderen pushen niet', async () => {
      const nieuw = { id: 'o-3', line: 'Alle', title: 'Wegenwerken ring', description: 'x', startDate: '2026-10-01' };
      const bulk = await api('POST', '/api/diversions', { token: 'tok-admin', body: [...mem.diversions, nieuw] });
      expect(bulk.status).toBe(200);
      const push = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe omleiding');
      expect(push?.userIds.sort()).toEqual(['3', '4']);
      expect(push?.payload.body).toBe('Wegenwerken ring (alle lijnen), 01/10/2026');
      expect(push?.payload.url).toBe('/omleidingen/o-3');

      mem.pushesSent = [];
      const rev = await revVan('/api/diversions', 'tok-planner', 'o-1');
      const put = await api('PUT', '/api/diversions/o-1', { token: 'tok-planner', body: { ...mem.diversions[0], endDate: '2026-08-15' }, headers: { [REV]: rev } });
      expect(put.status).toBe(200);
      expect(mem.pushesSent).toEqual([]);

      const revWeg = await revVan('/api/diversions', 'tok-planner', 'o-2');
      expect((await api('DELETE', '/api/diversions/o-2', { token: 'tok-planner', headers: { [REV]: revWeg } })).status).toBe(200);
      expect(mem.pushesSent).toEqual([]);
    });

    it('herstel na "Ongedaan maken" (X-Herstel: 1) logt "hersteld" en pusht niet', async () => {
      const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', headers: { 'X-Herstel': '1' }, body: { id: 'o-2', line: '14', title: 'Kermis', description: 'Centrum afgesloten', startDate: '2026-08-01' } });
      // o-2 bestaat nog: eerst weg, dan terug.
      expect(res.status).toBe(409);
      const rev = await revVan('/api/diversions', 'tok-planner', 'o-2');
      expect((await api('DELETE', '/api/diversions/o-2', { token: 'tok-planner', headers: { [REV]: rev } })).status).toBe(200);
      const terug = await api('POST', '/api/diversions/one', { token: 'tok-planner', headers: { 'X-Herstel': '1' }, body: { id: 'o-2', line: '14', title: 'Kermis', description: 'Centrum afgesloten', startDate: '2026-08-01' } });
      expect(terug.status).toBe(201);
      expect(mem.activity.find((a) => a.action === 'Omleiding hersteld' && a.entityId === 'o-2')).toBeTruthy();
      expect(mem.pushesSent.filter((p) => p.payload.title === 'Nieuwe omleiding')).toEqual([]);
    });

    it('bijlagen komen uit Storage, nooit van de client: een meegestuurde lijst of oude pdfUrl wordt genegeerd bij POST one, PUT, bulk én GET (controle 05-09, nr. 28)', async () => {
      const nep = [{ slot: 1, filename: 'nep.pdf' }];
      const extern = 'https://kwaad.example/nep.pdf';
      const post = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: { line: '1', title: 'Met lijst', description: 'x', startDate: '2026-09-10', bijlagen: nep, pdfUrl: extern } });
      expect(post.status).toBe(201);
      expect(post.json.diversion.bijlagen).toBeUndefined();
      expect(post.json.diversion.pdfUrl).toBeUndefined();
      const nieuw = mem.diversions.find((d: any) => d.id === post.json.diversion.id);
      expect(nieuw.bijlagen).toBeUndefined();
      expect(nieuw.pdfUrl).toBeUndefined();

      // Wat er écht hangt blijft, wat de client meestuurt telt niet.
      mem.opslag.add('diversions/o-1-2.pdf');
      mem.diversions[0].bijlagen = [{ slot: 2, filename: 'echt.pdf', sizeBytes: 10 }];
      const rev = await revVan('/api/diversions', 'tok-planner', 'o-1');
      const put = await api('PUT', '/api/diversions/o-1', { token: 'tok-planner', body: { ...mem.diversions[0], bijlagen: nep, pdfUrl: extern }, headers: { [REV]: rev } });
      expect(put.status).toBe(200);
      expect(put.json.diversion.bijlagen).toEqual([{ slot: 2, filename: 'echt.pdf', sizeBytes: 10, url: 'https://opslag.test/diversions/o-1-2.pdf?sig=test' }]);
      expect(mem.diversions.find((d: any) => d.id === 'o-1').bijlagen).toEqual([{ slot: 2, filename: 'echt.pdf', sizeBytes: 10 }]);

      const bulk = await api('POST', '/api/diversions', { token: 'tok-planner', body: mem.diversions.map((d: any) => ({ ...d, bijlagen: nep, pdfUrl: extern })) });
      expect(bulk.status).toBe(200);
      expect(mem.diversions.find((d: any) => d.id === 'o-1').bijlagen).toEqual([{ slot: 2, filename: 'echt.pdf', sizeBytes: 10 }]);
      expect(mem.diversions.filter((d: any) => d.id !== 'o-1').every((d: any) => d.bijlagen === undefined && d.pdfUrl === undefined)).toBe(true);

      // Een oude rij met een rauwe marker maar zonder bestand: niets, en de
      // marker zelf verlaat de server nooit.
      mem.diversions[1].pdfUrl = 'https://oud.example/publiek.pdf';
      const get = await api('GET', '/api/diversions', { token: 'tok-a' });
      expect(get.status).toBe(200);
      const o2 = get.json.find((d: any) => d.id === 'o-2');
      expect(o2.pdfUrl).toBeUndefined();
      expect(o2.bijlagen).toBeUndefined();
    });

    it('POST one valideert titel en datums (400) en weigert chauffeurs (403)', async () => {
      expect((await api('POST', '/api/diversions/one', { token: 'tok-planner', body: { line: '1', title: '', startDate: '2026-09-10' } })).status).toBe(400);
      expect((await api('POST', '/api/diversions/one', { token: 'tok-planner', body: { line: '1', title: 'X', startDate: '10/09/2026' } })).status).toBe(400);
      expect((await api('POST', '/api/diversions/one', { token: 'tok-a', body: { line: '1', title: 'X', startDate: '2026-09-10' } })).status).toBe(403);
    });

    it('PUT met juiste revisie slaat op; verouderde revisie → 409 met actueel record', async () => {
      const rev = await revVan('/api/diversions', 'tok-planner', 'o-1');
      const ok = await api('PUT', '/api/diversions/o-1', { token: 'tok-planner', body: { ...mem.diversions[0], endDate: '2026-08-15' }, headers: { [REV]: rev } });
      expect(ok.status).toBe(200);
      expect(ok.json.diversion.endDate).toBe('2026-08-15');
      expect(ok.json.diversion._rev).not.toBe(rev);
      expect(mem.diversions.find((d: any) => d.id === 'o-1')?.endDate).toBe('2026-08-15');
      expect(mem.activity.find((a) => a.action === 'Omleiding gewijzigd' && a.entityId === 'o-1')).toBeTruthy();
      // De oude revisie is nu verouderd.
      const stale = await api('PUT', '/api/diversions/o-1', { token: 'tok-admin', body: { ...mem.diversions[0], endDate: '2026-08-20' }, headers: { [REV]: rev } });
      expect(stale.status).toBe(409);
      expect(stale.json.conflict).toBe('record');
      expect(stale.json.record.endDate).toBe('2026-08-15');
      expect(mem.diversions.find((d: any) => d.id === 'o-1')?.endDate).toBe('2026-08-15');
    });

    it('DELETE verwijdert met juiste revisie; zonder header 400, onbekend 404', async () => {
      const rev = await revVan('/api/diversions', 'tok-planner', 'o-2');
      expect((await api('DELETE', '/api/diversions/o-2', { token: 'tok-planner' })).status).toBe(400);
      expect((await api('DELETE', '/api/diversions/o-9', { token: 'tok-planner', headers: { [REV]: 'x' } })).status).toBe(404);
      const res = await api('DELETE', '/api/diversions/o-2', { token: 'tok-planner', headers: { [REV]: rev } });
      expect(res.status).toBe(200);
      expect(res.headers.get(COLL)).toBeTruthy();
      expect(mem.diversions.map((d: any) => d.id)).toEqual(['o-1']);
      expect(mem.activity.find((a) => a.action === 'Omleiding verwijderd' && a.entityId === 'o-2')).toBeTruthy();
    });
  });

  describe('updates', () => {
    it('POST one publiceert bovenaan (201), logt en pusht naar actieve chauffeurs', async () => {
      const res = await api('POST', '/api/updates/one', { token: 'tok-planner', body: { date: '2026-09-03', title: 'Nieuwe regeling', content: 'Vanaf maandag …', isUrgent: false } });
      expect(res.status).toBe(201);
      expect(res.json.update.title).toBe('Nieuwe regeling');
      expect(res.json.update._rev).toBeTruthy();
      expect(mem.updates).toHaveLength(7);
      expect(mem.updates[0].title).toBe('Nieuwe regeling');
      expect(mem.activity.find((a) => a.action === 'Update toegevoegd')).toBeTruthy();
      const push = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe update');
      expect(push?.userIds.sort()).toEqual(['3', '4']);
      // Naar het bericht zelf (golf 3, punt 13): /updates/<id>, niet het scherm.
      expect(push?.payload.url).toBe(`/updates/${encodeURIComponent(res.json.update.id)}`);
    });

    it('POST one valideert titel/inhoud (400) en weigert chauffeurs (403)', async () => {
      expect((await api('POST', '/api/updates/one', { token: 'tok-planner', body: { title: 'X', content: '' } })).status).toBe(400);
      expect((await api('POST', '/api/updates/one', { token: 'tok-a', body: { title: 'X', content: 'y' } })).status).toBe(403);
    });

    it('PUT met juiste revisie slaat op; twee-planners-race → de tweede krijgt 409', async () => {
      const rev = await revVan('/api/updates', 'tok-planner', 'u1');
      const revAdmin = await revVan('/api/updates', 'tok-admin', 'u1');
      expect(revAdmin).toBe(rev);
      const eerste = await api('PUT', '/api/updates/u1', { token: 'tok-planner', body: { ...mem.updates[0], title: 'Update 1 (planner)' }, headers: { [REV]: rev } });
      expect(eerste.status).toBe(200);
      expect(eerste.json.update.title).toBe('Update 1 (planner)');
      const tweede = await api('PUT', '/api/updates/u1', { token: 'tok-admin', body: { ...mem.updates[0], title: 'Update 1 (admin)' }, headers: { [REV]: revAdmin } });
      expect(tweede.status).toBe(409);
      expect(tweede.json.record.title).toBe('Update 1 (planner)');
      expect(mem.updates.find((u: any) => u.id === 'u1')?.title).toBe('Update 1 (planner)');
      expect(mem.activity.filter((a) => a.action === 'Update gewijzigd' && a.entityId === 'u1')).toHaveLength(1);
    });

    it('DELETE verwijdert één update en laat de rest staan', async () => {
      const rev = await revVan('/api/updates', 'tok-planner', 'u3');
      const res = await api('DELETE', '/api/updates/u3', { token: 'tok-planner', headers: { [REV]: rev } });
      expect(res.status).toBe(200);
      expect(mem.updates.map((u: any) => u.id)).toEqual(['u1', 'u2', 'u4', 'u5', 'u6']);
      expect(mem.activity.find((a) => a.action === 'Update verwijderd' && a.entityId === 'u3')).toBeTruthy();
      expect((await api('DELETE', '/api/updates/u3', { token: 'tok-planner', headers: { [REV]: rev } })).status).toBe(404);
    });
  });
});
