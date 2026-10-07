// @vitest-environment node
import {
  api,
  invalidateOnderhoudCache,
  invalidateUsersCache,
  KLOK_ISO,
  mem,
} from './harnas';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('dienstruil: autorisatieregels', () => {
  it('weigert force-approve (pending → approved) door een planner, staat het toe voor admin', async () => {
    const approve = (rows: any[]) => rows.map((s) => (s.id === 's-1' ? { ...s, status: 'approved', decidedAt: '2026-06-12T09:00:00Z' } : s));
    const planner = await api('POST', '/api/swaps', { token: 'tok-planner', body: approve(mem.swaps) });
    expect(planner.status).toBe(403);

    const admin = await api('POST', '/api/swaps', { token: 'tok-admin', body: approve(mem.swaps) });
    expect(admin.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('approved');
  });

  it('dicht het bypass-gat: nieuw record met status approved wordt geweigerd (403)', async () => {
    const bypass = [...mem.swaps, { ...mem.swaps[0], id: 's-nieuw', status: 'approved' }];
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: bypass });
    expect(res.status).toBe(403);
  });

  it('weigert een ruil met andermans dienst als aanbod (403)', async () => {
    const own = mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3');
    const metAndermansShift = [...own, {
      id: 's-x', shiftId: 'sh-b', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-05', returnCode: 'VRIJ',
    }];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: metAndermansShift });
    expect(res.status).toBe(403);
  });

  it('laat de aangezochte collega accepteren maar niets anders wijzigen', async () => {
    const scoped = mem.swaps.filter((s) => s.requesterId === '4' || s.targetDriverId === '4');
    const accepteer = scoped.map((s) => (s.id === 's-1' ? { ...s, status: 'accepted' } : s));
    const ok = await api('POST', '/api/swaps', { token: 'tok-b', body: accepteer });
    expect(ok.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('accepted');
  });

  it('weigert accepteren mét gewijzigde ruilvoorwaarden (403)', async () => {
    const scoped = mem.swaps.filter((s) => s.requesterId === '4' || s.targetDriverId === '4');
    const sjoemel = scoped.map((s) => (s.id === 's-1' ? { ...s, status: 'accepted', returnCode: '99' } : s));
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: sjoemel });
    expect(res.status).toBe(403);
  });

  it('exclusiviteit geldt per volledige dienst, ook over de delen van een gesplitste dienst (409)', async () => {
    // Dienst 12 van 2026-07-01 staat als twee rijen in de planning (ochtend +
    // namiddag). Op het eerste deel loopt al een verzoek (s-1); een tweede
    // verzoek op het ándere deel hoort geweigerd te worden, want de doorvoer
    // verplaatst altijd de hele dienst (Jarno 18-09).
    mem.planning = [
      { id: 'sh-a', driverId: '3', date: '2026-07-01', line: '12' },
      { id: 'sh-a2', driverId: '3', date: '2026-07-01', line: '12' },
    ];
    mem.swaps = [{ id: 's-1', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' }];
    const tweedeDeel = [...mem.swaps, {
      id: 's-deel2', shiftId: 'sh-a2', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-03', returnCode: 'VRIJ',
    }];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: tweedeDeel });
    expect(res.status).toBe(409);
    expect(mem.swaps).toHaveLength(1);
  });

  it('een dienst zonder lopend verzoek blijft gewoon aanvraagbaar', async () => {
    mem.planning = [
      { id: 'sh-a', driverId: '3', date: '2026-07-01', line: '12' },
      { id: 'sh-c', driverId: '3', date: '2026-07-08', line: '13' },
    ];
    mem.swaps = [{ id: 's-1', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' }];
    const andereDienst = [...mem.swaps, {
      id: 's-nieuw', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-09', returnCode: 'VRIJ',
    }];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: andereDienst });
    expect(res.status).toBe(200);
    expect(mem.swaps.map((s: any) => s.id)).toContain('s-nieuw');
  });

  it('weigert een overgang uit een afgehandelde status, rejected → approved via POST (409)', async () => {
    mem.swaps = [{ id: 's-r', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'rejected', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' }];
    const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s) => ({ ...s, status: 'approved' })) });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-r')?.status).toBe('rejected');
  });

  it('halve doorvoer (planning al gewisseld, status nog accepted): goedkeuren slaagt alsnog i.p.v. 409 (controle-ronde 27-08, nr. 8)', async () => {
    // De eerdere poging verplaatste sh-a al naar collega 4, maar het opslaan van de status mislukte.
    mem.planning = [{ id: 'sh-a', driverId: '4', date: '2026-07-08', line: '12' }];
    mem.swaps = [{ id: 's-h', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' }];
    const res = await api('PATCH', '/api/swaps/s-h', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-h')?.status).toBe('approved');
    expect(mem.planning[0].driverId).toBe('4'); // niets dubbel verplaatst
  });

  it('halve doorvoer: afwijzen draait de wissel terug naar de aanvrager (controle-ronde 27-08, nr. 8)', async () => {
    mem.planning = [{ id: 'sh-a', driverId: '4', date: '2026-07-08', line: '12' }];
    mem.swaps = [{ id: 's-h', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' }];
    const res = await api('PATCH', '/api/swaps/s-h', { token: 'tok-admin', body: { status: 'rejected', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-h')?.status).toBe('rejected');
    expect(mem.planning[0].driverId).toBe('3');
  });

  it('gewone goedkeuring blijft de checks doen: dienst intussen naar een derde → 409', async () => {
    mem.planning = [{ id: 'sh-a', driverId: '9', date: '2026-07-08', line: '12' }];
    mem.swaps = [{ id: 's-h', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' }];
    const res = await api('PATCH', '/api/swaps/s-h', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-h')?.status).toBe('accepted');
  });

  it('weigert een overgang uit een afgehandelde status, rejected → approved via PATCH (409)', async () => {
    mem.swaps = [{ id: 's-r', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'rejected', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' }];
    // ifStatus is sinds de verbeterronde verplicht; de state-machine-check
    // (afgehandeld = eindstation) vuurt daarná alsnog.
    const res = await api('PATCH', '/api/swaps/s-r', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'rejected' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-r')?.status).toBe('rejected');
  });
});

// Scan 01-10, punt 4 (Jarno: "aanpassen naar enkel admin"). Een planner kon
// een ruil van 'pending' of 'accepted' rechtstreeks op 'completed' zetten. De
// controles en de doorvoer liepen alleen bij 'approved', dus zeiden het bord en
// de loonadministratie daarna dat de collega reed terwijl de rijen in de
// planning nog op de aanvrager stonden. Nu: een planner handelt alleen af wat
// goedgekeurd is; een admin mag een open ruil rechtstreeks afhandelen, en dat
// is dan een echte goedkeuring gevolgd door de afhandeling.
describe('dienstruil: rechtstreeks afhandelen kan alleen een admin, en dan als echte goedkeuring (01-10)', () => {
  const DAG = '2026-07-08';
  // A (3) geeft dienst 12 van 08/07 (sh-c) aan B (4), die dag op bv.
  const zaai = (status: string, extra: Record<string, unknown> = {}) => {
    mem.swaps = [{
      id: 's-d', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status, reason: '',
      createdAt: '2026-06-12T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '12', ...extra,
    }];
  };
  const handelAf = (weg: 'PATCH' | 'POST', token: string) => {
    const nu = mem.swaps.find((s: any) => s.id === 's-d')!;
    return weg === 'PATCH'
      ? api('PATCH', '/api/swaps/s-d', { token, body: { status: 'completed', ifStatus: nu.status } })
      : api('POST', '/api/swaps', { token, body: mem.swaps.map((s: any) => (s.id === 's-d' ? { ...s, status: 'completed' } : s)) });
  };
  const ruil = () => mem.swaps.find((s: any) => s.id === 's-d')!;
  const eigenaar = () => mem.planning.find((p: any) => p.id === 'sh-c')?.driverId;
  const acties = () => mem.activity.filter((a: any) => a.entityId === 's-d').map((a: any) => a.action);

  for (const weg of ['PATCH', 'POST'] as const) {
    for (const van of ['pending', 'accepted']) {
      it(`${weg}: een planner kan een ruil op '${van}' niet afhandelen (403), er wijzigt niets`, async () => {
        zaai(van);
        const res = await handelAf(weg, 'tok-planner');
        expect(res.status).toBe(403);
        expect(String(res.json?.error)).toBe('Niet toegestaan: een ruil die nog niet goedgekeurd is kan alleen een admin rechtstreeks afhandelen. Keur de ruil eerst goed.');
        expect(ruil().status).toBe(van);
        expect(eigenaar()).toBe('3');
        expect(acties()).toEqual([]);
        expect(mem.pushesSent).toEqual([]);
      });

      it(`${weg}: een admin handelt een ruil op '${van}' rechtstreeks af: controles, doorvoer, beslismoment, log en melding van een goedkeuring`, async () => {
        zaai(van);
        const res = await handelAf(weg, 'tok-admin');
        expect(res.status).toBe(200);
        expect(ruil().status).toBe('completed');
        // De wissel staat in de planning en heeft een beslismoment: zo spelen
        // bord, cel-waarheid en heropbouw hem af.
        expect(eigenaar()).toBe('4');
        expect(ruil().decidedAt).toBe(KLOK_ISO);
        // Twee logregels: de goedkeuring (met de doorvoer) en de afhandeling.
        expect(acties()).toEqual(['Dienstruil goedgekeurd', 'Dienstruil voltooid']);
        const [goedgekeurd, voltooid] = mem.activity.filter((a: any) => a.entityId === 's-d');
        expect(goedgekeurd.message).toContain(`(${van} → approved)`);
        expect(goedgekeurd.message).toContain('dienst 12 op 08/07/2026: 1 rij(en) doorgevoerd');
        expect(voltooid.message).toContain('(approved → completed)');
        expect(voltooid.message).not.toContain('doorgevoerd');
        // De melding van een goedkeuring naar beide chauffeurs, geen tweede voor de afhandeling.
        expect(mem.pushesSent.map((p) => [p.payload.title, [...p.userIds].sort()])).toEqual([['Dienstruil goedgekeurd', ['3', '4']]]);
        expect(mem.pushesSent[0].payload.body).toContain(`${van} → approved`);
      });
    }

    it(`${weg}: een planner handelt een goedgekeurde ruil gewoon af, zonder nieuwe doorvoer of nieuw beslismoment`, async () => {
      zaai('approved', { decidedAt: '2026-06-13T08:00:00Z' });
      mem.planning = mem.planning.map((p: any) => (p.id === 'sh-c' ? { ...p, driverId: '4' } : p));
      const res = await handelAf(weg, 'tok-planner');
      expect(res.status).toBe(200);
      expect(ruil().status).toBe('completed');
      expect(ruil().decidedAt).toBe('2026-06-13T08:00:00Z');
      expect(eigenaar()).toBe('4');
      expect(acties()).toEqual(['Dienstruil voltooid']);
      expect(mem.pushesSent).toEqual([]);
    });

    // Elke controle van een goedkeuring houdt ook het rechtstreeks afhandelen
    // tegen: er wordt niets verplaatst en de status blijft staan.
    const CONTROLES: Array<{ naam: string; zet: () => void; tekst: string }> = [
      {
        naam: 'de dienst is niet meer van de aanvrager',
        zet: () => { mem.planning = mem.planning.map((p: any) => (p.id === 'sh-c' ? { ...p, driverId: '9' } : p)); },
        tekst: 'niet meer op naam van de aanvrager',
      },
      {
        naam: 'de collega is intussen ziek gemeld',
        zet: () => { mem.leave.push({ id: 'l-ziek', userId: '4', startDate: DAG, endDate: DAG, type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-06-14T08:00:00Z' }); },
        tekst: 'ziek gemeld',
      },
      {
        naam: 'de collega kreeg intussen zelf een dienst',
        zet: () => { mem.planning.push({ id: 'sh-extra', driverId: '4', date: DAG, line: '15' }); },
        tekst: 'dubbele inplanning',
      },
    ];
    for (const controle of CONTROLES) {
      it(`${weg}: rechtstreeks afhandelen door een admin wordt geweigerd als ${controle.naam} (409)`, async () => {
        zaai('accepted');
        controle.zet();
        const voor = JSON.stringify(mem.planning);
        const res = await handelAf(weg, 'tok-admin');
        expect(res.status).toBe(409);
        expect(String(res.json?.error)).toContain(controle.tekst);
        expect(ruil().status).toBe('accepted');
        expect(ruil().decidedAt).toBeUndefined();
        expect(JSON.stringify(mem.planning)).toBe(voor);
        expect(acties()).toEqual([]);
      });
    }
  }

  it('PATCH: het antwoord draagt het verloop van beide stappen', async () => {
    zaai('accepted');
    const res = await handelAf('PATCH', 'tok-admin');
    expect(res.status).toBe(200);
    expect(res.json.swap.verloop.map((s: any) => s.soort)).toEqual(['goedgekeurd', 'afgehandeld']);
    expect(res.json.swap.verloop[0].van).toBe('accepted');
  });

  it('na rechtstreeks afhandelen houdt een heropbouw de dienst bij de collega', async () => {
    zaai('pending');
    mem.planningCodes = [{ code: 'bv', category: 'absence', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: true }];
    mem.planningMatrix = [{ id: 'm-1', source_date: DAG, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'bv' }, raw_row: '' }];
    expect((await handelAf('PATCH', 'tok-admin')).status).toBe(200);
    const res = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const rijen = mem.planning.filter((p: any) => p.date === DAG && String(p.line) === '12');
    expect(rijen.length).toBeGreaterThan(0);
    for (const rij of rijen) expect(rij.driverId).toBe('4');
  });

  // De laatste weg naar 'completed' zonder doorvoer (tweede lezing 01-10): een
  // admin kon via de lijst een NIEUW record meteen als 'approved' aanmaken. Dat
  // werd opgeslagen zonder verplaatsing, en een planner kon het daarna
  // afhandelen. Een nieuw record start nu altijd als 'pending', voor elke rol,
  // met dezelfde 403 en dezelfde zin als die voor niet-admins al gold.
  describe("lijst: een nieuw record start altijd als 'pending'", () => {
    const nieuw = (status: string) => ({ id: 's-nieuw', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status, reason: '', createdAt: '2026-06-12T08:00:00Z', swapType: 'overname' });

    for (const [rol, token] of [['admin', 'tok-admin'], ['planner', 'tok-planner'], ['chauffeur', 'tok-a']] as const) {
      for (const status of ['accepted', 'approved', 'rejected', 'cancelled', 'completed']) {
        it(`${rol}: nieuw record als '${status}' wordt geweigerd (403), er wordt niets opgeslagen of verplaatst`, async () => {
          mem.swaps = [];
          const res = await api('POST', '/api/swaps', { token, body: [nieuw(status)] });
          expect(res.status).toBe(403);
          expect(String(res.json?.error)).toBe("Niet toegestaan: nieuwe wisselverzoeken starten als 'pending'.");
          expect(mem.swaps).toEqual([]);
          expect(eigenaar()).toBe('3');
          expect(mem.activity.filter((a: any) => a.entityId === 's-nieuw')).toEqual([]);
        });
      }
    }

    it('de keten is dicht: wat een admin niet als approved kan aanmaken, kan een planner niet afhandelen', async () => {
      mem.swaps = [];
      expect((await api('POST', '/api/swaps', { token: 'tok-admin', body: [nieuw('approved')] })).status).toBe(403);
      const af = await api('PATCH', '/api/swaps/s-nieuw', { token: 'tok-planner', body: { status: 'completed', ifStatus: 'approved' } });
      expect(af.status).toBe(404);
      expect(eigenaar()).toBe('3');
    });

    it("een admin maakt een aanvraag gewoon aan als 'pending'", async () => {
      mem.swaps = [];
      const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: [nieuw('pending')] });
      expect(res.status).toBe(200);
      expect(mem.swaps.map((x: any) => [x.id, x.status])).toEqual([['s-nieuw', 'pending']]);
      expect(mem.activity.filter((a: any) => a.entityId === 's-nieuw').map((a: any) => a.action)).toEqual(['Dienstruil aangevraagd']);
    });
  });

  // 1-op-1 (tweede lezing 01-10): rechtstreeks afhandelen verplaatst beide
  // benen, net als een goedkeuring.
  for (const weg of ['PATCH', 'POST'] as const) {
    it(`${weg}: een admin handelt een 1-op-1 rechtstreeks af: beide benen verhuizen, beslismoment en twee logregels`, async () => {
      zaai('accepted', { swapType: 'ruil', returnDate: '2026-07-02', returnCode: '14' });
      const res = await handelAf(weg, 'tok-admin');
      expect(res.status).toBe(200);
      expect(ruil().status).toBe('completed');
      expect(ruil().decidedAt).toBe(KLOK_ISO);
      // Dienst 12 van 08/07 naar B, dienst 14 van 02/07 naar A.
      expect(eigenaar()).toBe('4');
      expect(mem.planning.find((p: any) => p.id === 'sh-b')?.driverId).toBe('3');
      expect(acties()).toEqual(['Dienstruil goedgekeurd', 'Dienstruil voltooid']);
      const [goedgekeurd, voltooid] = mem.activity.filter((a: any) => a.entityId === 's-d');
      expect(goedgekeurd.message).toContain('(accepted → approved)');
      expect(goedgekeurd.message).toContain('dienst 12 op 08/07/2026: 1 rij(en) doorgevoerd; terugruil 14 op 02/07/2026: 1 rij(en) doorgevoerd');
      expect(voltooid.message).toContain('(approved → completed)');
      expect(mem.pushesSent.map((p) => [p.payload.title, [...p.userIds].sort()])).toEqual([['Dienstruil goedgekeurd', ['3', '4']]]);
    });
  }

  it('de halve doorvoer blijft herkend: stond de wissel al in de rijen, dan handelt de admin af zonder tweede verplaatsing', async () => {
    zaai('accepted');
    mem.planning = mem.planning.map((p: any) => (p.id === 'sh-c' ? { ...p, driverId: '4' } : p));
    const res = await handelAf('PATCH', 'tok-admin');
    expect(res.status).toBe(200);
    expect(ruil().status).toBe('completed');
    expect(eigenaar()).toBe('4');
    expect(mem.activity.find((a: any) => a.action === 'Dienstruil goedgekeurd')?.message).toContain('wissel stond al in de planning');
  });
});

describe('dienstruil zonder tegenprestatie (overname)', () => {
  // Chauffeur 3 biedt sh-c aan (2026-07-08); chauffeur 4 staat die dag op 'bv'.
  const overname = (extra: Record<string, unknown> = {}) => ({
    id: 's-over', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
    reason: '', createdAt: '2026-06-12T08:00:00Z', swapType: 'overname', ...extra,
  });
  const eigenPayload = (nieuw: unknown) => [
    ...mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3'),
    nieuw,
  ];

  it('staat een overname toe als de collega die dag op bv staat', async () => {
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(200);
    const opgeslagen = mem.swaps.find((s) => s.id === 's-over');
    expect(opgeslagen?.swapType).toBe('overname');
    // Geen tegenprestatie: return-velden blijven leeg.
    expect(opgeslagen?.returnDate ?? null).toBeNull();
    expect(opgeslagen?.returnCode ?? null).toBeNull();
  });

  it('weigert een overname als de collega die dag een dienst rijdt (409)', async () => {
    // sh-a valt op 2026-07-01; chauffeur 4 staat dan in de matrix op dienst 14.
    mem.swaps = [];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [overname({ shiftId: 'sh-a' })] });
    expect(res.status).toBe(409);
    expect(mem.swaps).toHaveLength(0);
  });

  it('weigert een overname als de collega ziek is (409)', async () => {
    mem.planningMatrix = [
      { id: 'm-1', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'ziek' }, raw_row: '' },
    ];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-over')).toBeUndefined();
  });

  it('weigert een overname als er voor die dag niets in de planning-matrix staat (409)', async () => {
    mem.planningMatrix = [];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(409);
  });

  it('weigert een overname als de collega tóch een dienst in de planning heeft (409)', async () => {
    // Matrix zegt 'bv', maar er staat een handmatig toegevoegde dienst.
    mem.planning = [...mem.planning, { id: 'sh-extra', driverId: '4', date: '2026-07-08', code: '15' }];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(409);
  });

  it('geldt ook voor een planner, niet enkel voor chauffeurs (409)', async () => {
    mem.planningMatrix = [];
    mem.swaps = [];
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [overname()] });
    expect(res.status).toBe(409);
  });

  it('vraagt bij een gewone ruil nog steeds een tegenprestatie (400)', async () => {
    const res = await api('POST', '/api/swaps', {
      token: 'tok-a',
      body: eigenPayload(overname({ id: 's-zonder', swapType: 'ruil' })),
    });
    expect(res.status).toBe(400);
  });

  it('behoudt het type als de collega accepteert, ook zonder swapType in de payload', async () => {
    mem.swaps = [{
      id: 's-over', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', swapType: 'overname',
    }];
    const { swapType: _weg, ...zonderType } = mem.swaps[0] as any;
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [{ ...zonderType, status: 'accepted' }] });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-over')?.status).toBe('accepted');
    expect(mem.swaps.find((s) => s.id === 's-over')?.swapType).toBe('overname');
  });

  it('geeft via /api/availability?takeover=1 wie er die dag mag overnemen', async () => {
    const res = await api('GET', '/api/availability?from=2026-07-08&to=2026-07-08&takeover=1', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.days[0].takeover).toEqual({ '4': 'bv' });
  });

  it('laat de takeover-lijst en de redenen weg zonder de expliciete vlag', async () => {
    const res = await api('GET', '/api/availability?from=2026-07-08&to=2026-07-08', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.days[0].takeover).toBeUndefined();
    expect(res.json.days[0].reden).toBeUndefined();
  });

  it('geeft met takeover=1 per niet-beschikbare collega de reden: de bordcode met omschrijving, of het portaalverlof (ziekte wint)', async () => {
    // Chauffeur B staat die dag op OPL (bord) zonder portaalverlof; A rijdt.
    mem.planningMatrix = [{ id: 'm-1', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'opl' }, raw_row: '' }];
    mem.planningCodes = [{ code: 'OPL', category: 'training', description: 'Opleiding' }];
    const lees = async () => (await api('GET', '/api/availability?from=2026-07-08&to=2026-07-08&takeover=1', { token: 'tok-a' })).json.days[0];
    const bord = await lees();
    expect(bord.free).toEqual([]);
    expect(bord.takeover).toEqual({});
    expect(bord.reden).toEqual({ '4': 'Opleiding' });
    // Goedgekeurd portaalverlof gaat voor op het bord.
    mem.leave = [...mem.leave, { id: 'l-b8', userId: '4', startDate: '2026-07-08', endDate: '2026-07-08', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-06-01T08:00:00Z' }];
    expect((await lees()).reden).toEqual({ '4': 'Verlof' });
    // Ziekte wint bij overlap, zoals op het bord.
    mem.leave = [...mem.leave, { id: 'l-b9', userId: '4', startDate: '2026-07-08', endDate: '2026-07-08', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-06-01T08:00:00Z' }];
    const ziek = await lees();
    expect(ziek.reden).toEqual({ '4': 'Ziek' });
    // Wie rijdt (A) staat er niet in; wie vrij is evenmin.
    mem.planningMatrix = [{ id: 'm-1', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'bv' }, raw_row: '' }];
    mem.leave = mem.leave.filter((l) => l.id !== 'l-b8' && l.id !== 'l-b9');
    const vrij = await lees();
    expect(vrij.takeover).toEqual({ '4': 'bv' });
    expect(vrij.reden).toEqual({});
  });
});

describe('planning-doorvoer van goedgekeurde ruilen', () => {
  // s-1 (bestaand record) mét dienst-info, alsof de backfill-migratie liep:
  // sh-a = dienst 12 op 2026-07-01 van chauffeur 3, tegenprestatie = vrij.
  const seedShiftInfo = () => {
    mem.swaps = mem.swaps.map((s) => (s.id === 's-1' ? { ...s, shiftDate: '2026-07-01', shiftLine: '12' } : s));
  };

  it('verhuist de dienst naar de collega bij goedkeuring (vrije-dag-tegenprestatie)', async () => {
    seedShiftInfo();
    const accept = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(accept.status).toBe(200);
    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    // sh-a hoort nu bij chauffeur 4; er is geen terugdienst (returnCode VRIJ).
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('4');
    expect(mem.planning.find((p: any) => p.id === 'sh-b')?.driverId).toBe('4');
  });

  it('verhuist bij een 1-op-1 ruil ook de terugdienst naar de aanvrager', async () => {
    // Chauffeur 3 geeft sh-c (dienst 12, 08/07) aan 4 en neemt diens dienst 14 (02/07).
    mem.swaps = [];
    const nieuw = {
      id: 's-ruil', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-20T08:00:00Z', returnDate: '2026-07-02', returnCode: '14',
    };
    const post = await api('POST', '/api/swaps', { token: 'tok-a', body: [nieuw] });
    expect(post.status).toBe(200);
    // Server vulde de dienst-info zelf in (niet client-trusted).
    const opgeslagen = mem.swaps.find((s: any) => s.id === 's-ruil');
    expect(opgeslagen?.shiftDate).toBe('2026-07-08');
    expect(opgeslagen?.shiftLine).toBe('12');

    await api('PATCH', '/api/swaps/s-ruil', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    const approve = await api('PATCH', '/api/swaps/s-ruil', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    expect(mem.planning.find((p: any) => p.id === 'sh-c')?.driverId).toBe('4');
    expect(mem.planning.find((p: any) => p.id === 'sh-b')?.driverId).toBe('3');
  });

  it('draait de wissel terug wanneer een goedgekeurde ruil geannuleerd wordt', async () => {
    seedShiftInfo();
    await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('4');

    const cancel = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'cancelled', ifStatus: 'approved' } });
    expect(cancel.status).toBe(200);
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('3');
  });

  it('laat een aanvraag zonder dienst-info gewoon goedkeuren (legacy) zonder planning-wijziging', async () => {
    // s-1 zonder shiftDate/shiftLine — van vóór de migratie én de rij is herbouwd.
    await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('3');
    // De activity-log waarschuwt dat handmatig bijwerken nodig is.
    expect(mem.activity.some((a: any) => String(a.message).includes('NIET automatisch bijgewerkt'))).toBe(true);
  });

  it('past goedgekeurde ruilen opnieuw toe bij planning-heropbouw (sync-from-matrix)', async () => {
    // Matrix voor 08/07: chauffeur 3 rijdt 12, chauffeur 4 vrij — maar er is
    // een goedgekeurde overname van die dienst naar chauffeur 4.
    mem.planningMatrix = [
      { id: 'm-r', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.planningCodes = [
      { code: 'vrij', category: 'absence', description: 'Geen dienst', countsAsShift: false, isPaidAbsence: false, isDayOff: true },
    ];
    mem.swaps = [{
      id: 's-app', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: '', createdAt: '2026-06-20T08:00:00Z', decidedAt: '2026-06-21T08:00:00Z',
      swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12',
    }];
    const res = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const rebuilt = mem.planning.filter((p: any) => p.date === '2026-07-08' && String(p.line) === '12');
    expect(rebuilt.length).toBeGreaterThan(0);
    for (const row of rebuilt) expect(row.driverId).toBe('4');
  });

  it('heropbouw pusht alléén naar chauffeurs van wie het rooster wijzigde', async () => {
    // Uitgangssituatie: chauffeur 3 heeft dienst 12 op 08/07 (sh-c uit de
    // fixture, 08:00-16:00 volgens dienst d3). De matrix bevestigt exact
    // diezelfde toestand voor 3, maar geeft chauffeur 4 een nieuwe dienst 11.
    mem.planning = [
      { id: 'sh-c', driverId: '3', date: '2026-07-08', line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    mem.planningMatrix = [
      { id: 'm-p', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
    ];
    mem.swaps = [];
    const res = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const push = mem.pushesSent.find((pz) => pz.payload.title === 'Rooster bijgewerkt');
    // Chauffeur 4 kreeg een nieuwe dienst → push; chauffeur 3 bleef gelijk → stil.
    expect(push?.userIds).toEqual(['4']);
    expect(res.json.notifiedDrivers).toBe(1);
  });
});

describe('dienstruil intrekken via PATCH (#250)', () => {
  it('de aanvrager mag een eigen open ruil intrekken (ook vanuit accepted)', async () => {
    mem.swaps = [{ id: 's-w', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-07-01T08:00:00Z', returnDate: '2026-08-02', returnCode: 'VRIJ' }];
    const res = await api('PATCH', '/api/swaps/s-w', { token: 'tok-a', body: { status: 'cancelled', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-w')?.status).toBe('cancelled');
  });

  it('een ándere chauffeur (ook de aangezochte) mag níet intrekken (403)', async () => {
    mem.swaps = [{ id: 's-w2', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-07-01T08:00:00Z', returnDate: '2026-08-02', returnCode: 'VRIJ' }];
    const res = await api('PATCH', '/api/swaps/s-w2', { token: 'tok-b', body: { status: 'cancelled', ifStatus: 'pending' } });
    expect(res.status).toBe(403);
    expect(mem.swaps.find((s) => s.id === 's-w2')?.status).toBe('pending');
  });
});

describe('dienstruil, dóórgeef-ketting en stale goedkeuring', () => {
  it('laat een via een ruil verkregen dienst opnieuw ruilen (geen 409 op een afgehandelde ruil)', async () => {
    // s-1 is goedgekeurd én doorgevoerd: sh-a staat nu op naam van chauffeur 4.
    // Vóór de fix blokkeerde die afgehandelde ruil elk nieuw verzoek voor
    // dezelfde shiftId, waardoor de nieuwe eigenaar vastzat.
    mem.swaps = [
      { id: 's-1', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-01T08:00:00Z', decidedAt: '2026-06-02T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const nieuw = {
      id: 's-door', shiftId: 'sh-a', requesterId: '4', targetDriverId: '3', status: 'pending',
      reason: '', createdAt: '2026-06-13T08:00:00Z', returnDate: '2026-07-08', returnCode: '12',
    };
    // Chauffeur-payload = eigen betrokken ruilen + de nieuwe (weglaten leest
    // de server als een intrekking).
    const own = mem.swaps.filter((s: any) => s.requesterId === '4' || s.targetDriverId === '4');
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-door')).toBeTruthy();
  });

  it('weigert een goedkeuring als de dienst niet meer van de aanvrager is (409)', async () => {
    mem.swaps = [
      { id: 'x-stale', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const res = await api('PATCH', '/api/swaps/x-stale', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s: any) => s.id === 'x-stale')?.status).toBe('accepted');
  });

  // Regel Jarno: een dienst mag meerdere keren na elkaar geruild worden. De
  // heropbouw-replay sorteert op decidedAt; "Afhandelen" (approved →
  // completed) schreef daar het afhandelmoment over, zodat de eerste schakel
  // van een ketting achteraan in de replay belandde en de dienst terugviel
  // op de tussenpersoon.
  describe('ketting A → B → C overleeft afhandelen + heropbouw', () => {
    const DAG = '2026-07-08';
    const zaaiKetting = () => {
      mem.users.push({ id: '5', name: 'Chauffeur C', email: 'c@vhb.be', role: 'chauffeur', isActive: true });
      invalidateUsersCache();
      // Matrix (Excel) kent de ruilen niet: dienst 12 staat er nog bij A.
      mem.planningMatrix = [
        { id: 'm-k', source_date: DAG, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij', 'Chauffeur C': 'vrij' }, raw_row: '' },
      ];
      mem.planningCodes = [
        { code: 'vrij', category: 'absence', description: 'Geen dienst', countsAsShift: false, isPaidAbsence: false, isDayOff: true },
      ];
      // Beide schakels goedgekeurd en doorgevoerd: dienst 12 staat bij C.
      mem.planning = [{ id: 'sh-c', driverId: '5', date: DAG, line: '12' }];
      mem.swaps = [
        { id: 'k-1', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-06-20T08:00:00', decidedAt: '2026-06-21T08:00:00', shiftDate: DAG, shiftLine: '12' },
        { id: 'k-2', shiftId: 'sh-c', requesterId: '4', targetDriverId: '5', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-06-22T08:00:00', decidedAt: '2026-06-23T08:00:00', shiftDate: DAG, shiftLine: '12' },
      ];
    };
    const eigenaarNaHeropbouw = async () => {
      const res = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-planner' });
      expect(res.status).toBe(200);
      const rijen = mem.planning.filter((p: any) => p.date === DAG && String(p.line) === '12');
      expect(rijen.length).toBeGreaterThan(0);
      return [...new Set(rijen.map((p: any) => String(p.driverId)))];
    };

    it('controle: zonder afhandelen komt de dienst na een heropbouw bij C uit', async () => {
      zaaiKetting();
      expect(await eigenaarNaHeropbouw()).toEqual(['5']);
    });

    it('eerste schakel afhandelen verlegt haar beslismoment niet, de dienst blijft bij C', async () => {
      zaaiKetting();
      const af = await api('PATCH', '/api/swaps/k-1', { token: 'tok-planner', body: { status: 'completed', ifStatus: 'approved' } });
      expect(af.status).toBe(200);
      expect(af.json.swap.status).toBe('completed');
      expect(await eigenaarNaHeropbouw()).toEqual(['5']);
      // Het beslismoment is dat van de goedkeuring, niet dat van het afhandelen.
      expect(af.json.swap.decidedAt).toBe('2026-06-21T08:00:00');
      expect(mem.swaps.find((s: any) => s.id === 'k-1')?.decidedAt).toBe('2026-06-21T08:00:00');
    });

    it('beide schakels afhandelen in omgekeerde volgorde verandert de uitkomst niet', async () => {
      zaaiKetting();
      for (const id of ['k-2', 'k-1']) {
        const af = await api('PATCH', `/api/swaps/${id}`, { token: 'tok-planner', body: { status: 'completed', ifStatus: 'approved' } });
        expect(af.status).toBe(200);
      }
      expect(await eigenaarNaHeropbouw()).toEqual(['5']);
    });
  });
});

describe('maandplanning, goedgekeurde dienstruilen zichtbaar (bevinding Jarno 06-08)', () => {
  // Een goedgekeurde ruil verhuist de dienst in de planning-tabel, maar het
  // maandrooster leest de matrix — zonder overlay bleef de oude eigenaar
  // daar op zijn dienst staan.
  beforeEach(() => {
    mem.planningMatrix = [
      { id: 'm-r1', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
      { id: 'm-r2', source_date: '2026-07-16', day_type: 'week', assignments: { 'Chauffeur B': '11' }, raw_row: '' },
    ];
    mem.swaps = [];
    mem.leave = [];
  });

  it('een goedgekeurde overname verhuist de dienst-cel naar de collega', async () => {
    mem.swaps = [
      { id: 'r-1', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: '12', kind: 'service' });
    // De gever komt vrij te staan, gemerkt als weggeruild (Jarno 17-09).
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'vrij', swapAway: true, swapTo: 'Chauffeur B' });
  });

  it('een 1-op-1 ruil wisselt óók de terugruil-dag', async () => {
    mem.swaps = [
      { id: 'r-2', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'ruil', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12', returnDate: '2026-07-16', returnCode: '11' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: '12', kind: 'service' });
    expect(res.json.cells['3']['2026-07-16']).toMatchObject({ code: '11', kind: 'service' });
    expect(res.json.cells['4']['2026-07-16']).toMatchObject({ code: 'vrij', swapAway: true, swapTo: 'Chauffeur A' });
  });

  it('geen dubbele doorvoer als de Excel de ruil al verwerkt heeft', async () => {
    // De planner importeerde een nieuwe Excel mét de ruil erin: de cel staat
    // al bij de collega. De overlay mag hem dan niet terug-wisselen.
    mem.planningMatrix = [
      { id: 'm-r3', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur B': '12' }, raw_row: '' },
    ];
    mem.swaps = [
      { id: 'r-3', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: '12', kind: 'service' });
    expect(res.json.cells['3']?.['2026-07-15']).toBeUndefined();
  });

  it('een latere ziekmelding wint van de geruilde dienst', async () => {
    mem.planningCodes = [{ id: 'pc-ziek', code: 'ziek', description: 'Ziek', category: 'absence' }];
    mem.swaps = [
      { id: 'r-4', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
    ];
    mem.leave = [
      { id: 'l-r', userId: '4', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-14T06:00:00Z', decidedAt: '2026-07-14T06:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence' });
  });
});

describe('dienstruil, afwezigheids-check in beide richtingen', () => {
  it('weigert een nieuwe ruil als de AANVRAGER ziek is op de terugruil-dag (409)', async () => {
    // Chauffeur 4 biedt sh-b aan en zou op 08/07 dienst 12 van chauffeur 3
    // terugrijden — maar is die dag zelf ziek gemeld. De oude check keek
    // alleen naar de collega op de dienstdag.
    mem.swaps = [];
    mem.leave = [
      { id: 'l-req', userId: '4', startDate: '2026-07-08', endDate: '2026-07-08', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-07T06:00:00Z', decidedAt: '2026-07-07T06:00:00Z' },
    ];
    const nieuw = {
      id: 's-richting', shiftId: 'sh-b', requesterId: '4', targetDriverId: '3', status: 'pending',
      reason: '', createdAt: '2026-06-13T08:00:00Z', returnDate: '2026-07-08', returnCode: '12',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [nieuw] });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s: any) => s.id === 's-richting')).toBeUndefined();
  });

  it('weigert goedkeuren als de collega ná het accepteren ziek gemeld is (409)', async () => {
    mem.swaps = [
      { id: 's-zk', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.leave = [
      { id: 'l-na', userId: '4', startDate: '2026-07-01', endDate: '2026-07-01', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-06-20T06:00:00Z', decidedAt: '2026-06-20T06:00:00Z' },
    ];
    const res = await api('PATCH', '/api/swaps/s-zk', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s: any) => s.id === 's-zk')?.status).toBe('accepted');
    // De planning is niet halverwege gewisseld.
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('3');
  });
});

describe('dienstruil, terugdraaien, bevriezen en tegenprestatie-validatie', () => {
  it('approved → rejected draait de planning terug (niet alleen cancelled)', async () => {
    // sh-a is via s-x doorgevoerd naar chauffeur 4; de planner wijst hem daarna
    // alsnog af. Vóór de fix bleef de dienst bij 4 staan en zette de replay hem
    // bij de volgende import stilletjes terug.
    mem.swaps = [
      { id: 's-x', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-01T08:00:00Z', decidedAt: '2026-06-02T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const res = await api('PATCH', '/api/swaps/s-x', { token: 'tok-admin', body: { status: 'rejected', ifStatus: 'approved' } });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('3');
  });

  it('completed laat de wissel juist staan', async () => {
    mem.swaps = [
      { id: 's-y', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-01T08:00:00Z', decidedAt: '2026-06-02T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const res = await api('PATCH', '/api/swaps/s-y', { token: 'tok-admin', body: { status: 'completed', ifStatus: 'approved' } });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('4');
  });

  it('een planner kan de voorwaarden van een geaccepteerde ruil niet herschrijven', async () => {
    mem.swaps = [
      { id: 's-acc', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: '14' },
    ];
    // Planner probeert in één keer de tegenprestatie én de collega te wijzigen
    // en de ruil goed te keuren.
    const res = await api('POST', '/api/swaps', {
      token: 'tok-planner',
      body: [{ ...mem.swaps[0], targetDriverId: '2', returnDate: '2026-07-08', returnCode: '12', status: 'approved' }],
    });
    expect(res.status).toBe(200);
    const saved = mem.swaps.find((s: any) => s.id === 's-acc');
    expect(saved?.status).toBe('approved');
    // Alleen de status is meegegaan; de voorwaarden zijn bevroren.
    expect(saved?.targetDriverId).toBe('4');
    expect(saved?.returnDate).toBe('2026-07-02');
    expect(saved?.returnCode).toBe('14');
  });

  it('weigert een tegenprestatie die niet in de planning van de collega staat', async () => {
    const own = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    const verzonnen = {
      id: 's-fake', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-14T08:00:00Z', returnDate: '2026-07-02', returnCode: '99',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, verzonnen] });
    expect(res.status).toBe(400);
    expect(mem.swaps.find((s: any) => s.id === 's-fake')).toBeFalsy();
  });

  it('weigert een samengestelde dienstcode als tegenprestatie met uitleg', async () => {
    const own = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    const samengesteld = {
      id: 's-multi', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-14T09:00:00Z', returnDate: '2026-07-02', returnCode: '14/12',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, samengesteld] });
    expect(res.status).toBe(400);
    expect(String(res.json?.error)).toContain('meerdere diensten');
  });

  it('laat een geldige tegenprestatie gewoon door', async () => {
    const own = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    // sh-b: chauffeur 4 rijdt dienst 14 op 2026-07-02.
    const geldig = {
      id: 's-ok', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-14T10:00:00Z', returnDate: '2026-07-02', returnCode: '14',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, geldig] });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-ok')).toBeTruthy();
  });
});

// Scan 01-10, punt 1. 'rejected' is twee dingen: de planner die afwijst, en de
// aangezochte collega die op Weigeren tikt. Het herstel van een halve doorvoer
// ("staat de dienst al bij de collega, zet ze dan terug") keek alleen naar de
// planning, niet naar wie besliste. Had de planner de collega intussen zelf op
// de dienst gezet via de Excel, dan schoof de weigering van die collega de
// dienst stil terug naar de aanvrager, tegen de Excel in.
describe('dienstruil: een weigering of afwijzing zet de planning niet terug tegen de Excel in (01-10)', () => {
  const DAG = '2026-07-08';
  const TERUGDAG = '2026-07-02';
  // A (3) vraagt B (4) om dienst 12 van 08/07 over te nemen.
  const overname = (extra: Record<string, unknown> = {}) => ({
    id: 's-o', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '',
    createdAt: '2026-06-12T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '12', ...extra,
  });
  // 1-op-1: dienst 12 van 08/07 naar B, dienst 14 van 02/07 naar A.
  const ruil = (extra: Record<string, unknown> = {}) => ({
    id: 's-r', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '',
    createdAt: '2026-06-12T08:00:00Z', swapType: 'ruil', shiftDate: DAG, shiftLine: '12', returnDate: TERUGDAG, returnCode: '14', ...extra,
  });
  const matrixRij = (dag: string, a: string, b: string) => ({ id: `m-${dag}`, source_date: dag, day_type: 'week', assignments: { 'Chauffeur A': a, 'Chauffeur B': b }, raw_row: '' });
  /** De planner verwerkte de overname al in de Excel: matrix en rijen geven
   *  dienst 12 aan B. De rij draagt het id dat de opbouw haar dan geeft. */
  const excelGeeftDienstAanCollega = () => {
    mem.planningMatrix = [matrixRij(DAG, 'vrij', '12')];
    mem.planning = [{ id: `${DAG}-4-12-1`, driverId: '4', date: DAG, line: '12' }];
  };
  const rijdt = (dag: string, line: string) => [...new Set(mem.planning.filter((p: any) => p.date === dag && String(p.line) === line).map((p: any) => String(p.driverId)))];
  const logVan = (id: string, actie: string) => mem.activity.filter((a: any) => a.entityId === id && a.action === actie);

  describe('de aangezochte collega weigert', () => {
    it('PATCH: de dienst die de Excel hem al gaf blijft bij hem, de planning wordt niet gelezen', async () => {
      excelGeeftDienstAanCollega();
      mem.swaps = [overname()];
      const res = await api('PATCH', '/api/swaps/s-o', { token: 'tok-b', body: { status: 'rejected', ifStatus: 'pending' } });
      expect(res.status).toBe(200);
      expect(mem.swaps[0].status).toBe('rejected');
      expect(rijdt(DAG, '12')).toEqual(['4']);
      expect(mem.planningToestandLezingen).toBe(0);
      expect(logVan('s-o', 'Dienstruil afgewezen')[0].message).not.toMatch(/teruggedraaid/);
    });

    it('lijst (POST): idem', async () => {
      excelGeeftDienstAanCollega();
      mem.swaps = [overname()];
      const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [{ ...overname(), status: 'rejected' }] });
      expect(res.status).toBe(200);
      expect(mem.swaps[0].status).toBe('rejected');
      expect(rijdt(DAG, '12')).toEqual(['4']);
      expect(mem.planningToestandLezingen).toBe(0);
      expect(logVan('s-o', 'Dienstruil afgewezen')[0].message).not.toMatch(/teruggedraaid/);
    });

    it('ook als de Excel de dienst nog bij de aanvrager toont (kruisende ruil, halve doorvoer): een chauffeur verplaatst niets', async () => {
      // Matrix uit de fixture: A rijdt 12, B staat op bv. De rijen zeggen B.
      mem.planning = [{ id: 'sh-c', driverId: '4', date: DAG, line: '12' }];
      for (const weg of ['PATCH', 'POST'] as const) {
        mem.swaps = [overname()];
        const res = weg === 'PATCH'
          ? await api('PATCH', '/api/swaps/s-o', { token: 'tok-b', body: { status: 'rejected', ifStatus: 'pending' } })
          : await api('POST', '/api/swaps', { token: 'tok-b', body: [{ ...overname(), status: 'rejected' }] });
        expect(res.status).toBe(200);
        expect(mem.swaps[0].status).toBe('rejected');
        expect(rijdt(DAG, '12')).toEqual(['4']);
      }
      expect(mem.planningToestandLezingen).toBe(0);
    });

    it('1-op-1 met beide benen al gewisseld: geen van beide gaat terug', async () => {
      mem.planning = [
        { id: 'sh-c', driverId: '4', date: DAG, line: '12' },
        { id: 'sh-b', driverId: '3', date: TERUGDAG, line: '14' },
      ];
      mem.swaps = [ruil({ status: 'pending' })];
      const res = await api('PATCH', '/api/swaps/s-r', { token: 'tok-b', body: { status: 'rejected', ifStatus: 'pending' } });
      expect(res.status).toBe(200);
      expect(rijdt(DAG, '12')).toEqual(['4']);
      expect(rijdt(TERUGDAG, '14')).toEqual(['3']);
    });

    it('de aanvrager die intrekt raakt de planning evenmin', async () => {
      excelGeeftDienstAanCollega();
      mem.swaps = [overname({ status: 'accepted' })];
      const res = await api('PATCH', '/api/swaps/s-o', { token: 'tok-a', body: { status: 'cancelled', ifStatus: 'accepted' } });
      expect(res.status).toBe(200);
      expect(rijdt(DAG, '12')).toEqual(['4']);
      expect(mem.planningToestandLezingen).toBe(0);
    });
  });

  // De planner die afwijst mag een halve doorvoer nog steeds terugzetten, maar
  // niet wat de Excel (of een andere doorgevoerde ruil) zelf al zo toont. Het
  // bord onderscheidt de twee, been per been.
  describe('de planner wijst af', () => {
    const wijsAf = (weg: 'PATCH' | 'POST', swap: any) => (weg === 'PATCH'
      ? api('PATCH', `/api/swaps/${swap.id}`, { token: 'tok-planner', body: { status: 'rejected', ifStatus: swap.status } })
      : api('POST', '/api/swaps', { token: 'tok-planner', body: mem.swaps.map((s: any) => (s.id === swap.id ? { ...s, status: 'rejected' } : s)) }));

    for (const weg of ['PATCH', 'POST'] as const) {
      it(`${weg}: wat de Excel al aan de collega gaf, gaat niet terug, en het log zegt waarom`, async () => {
        excelGeeftDienstAanCollega();
        const swap = overname({ status: 'accepted' });
        mem.swaps = [swap];
        const res = await wijsAf(weg, swap);
        expect(res.status).toBe(200);
        expect(mem.swaps[0].status).toBe('rejected');
        expect(rijdt(DAG, '12')).toEqual(['4']);
        expect(logVan('s-o', 'Dienstruil afgewezen')[0].message).toContain('Planning niet teruggedraaid');
      });

      it(`${weg}: een halve doorvoer (de Excel toont de dienst nog bij de aanvrager) gaat wel terug`, async () => {
        // Matrix uit de fixture: A rijdt 12, B staat op bv.
        mem.planning = [{ id: 'sh-c', driverId: '4', date: DAG, line: '12' }];
        const swap = overname({ status: 'accepted' });
        mem.swaps = [swap];
        const res = await wijsAf(weg, swap);
        expect(res.status).toBe(200);
        expect(rijdt(DAG, '12')).toEqual(['3']);
        expect(logVan('s-o', 'Dienstruil afgewezen')[0].message).toContain('1 rij(en) teruggedraaid');
      });

      it(`${weg}: een andere doorgevoerde ruil zette de dienst bij de collega, die gaat niet terug`, async () => {
        // De Excel kent geen van beide ruilen; het bord legt de goedgekeurde erover.
        mem.planningMatrix = [matrixRij(DAG, '12', 'vrij')];
        mem.planning = [{ id: 'sh-c', driverId: '4', date: DAG, line: '12' }];
        const swap = overname({ status: 'accepted' });
        mem.swaps = [
          swap,
          { id: 's-eerder', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-10T08:00:00Z', decidedAt: '2026-06-11T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '12' },
        ];
        const res = await wijsAf(weg, swap);
        expect(res.status).toBe(200);
        expect(rijdt(DAG, '12')).toEqual(['4']);
      });

      it(`${weg}: 1-op-1, de Excel toont alleen de aangeboden dienst al bij de collega: alleen de terugdienst gaat terug`, async () => {
        mem.planningMatrix = [matrixRij(DAG, 'vrij', '12'), matrixRij(TERUGDAG, 'vrij', '14')];
        mem.planning = [
          { id: `${DAG}-4-12-1`, driverId: '4', date: DAG, line: '12' },
          { id: 'sh-b', driverId: '3', date: TERUGDAG, line: '14' },
        ];
        const swap = ruil();
        mem.swaps = [swap];
        const res = await wijsAf(weg, swap);
        expect(res.status).toBe(200);
        expect(rijdt(DAG, '12')).toEqual(['4']);
        expect(rijdt(TERUGDAG, '14')).toEqual(['4']);
        const regel = logVan('s-r', 'Dienstruil afgewezen')[0].message;
        expect(regel).toContain('terugruil 14 op 02/07/2026: 1 rij(en) teruggedraaid');
        expect(regel).toContain('Niet teruggedraaid: dienst 12 op 08/07/2026');
      });

      it(`${weg}: 1-op-1, de Excel toont alleen de terugdienst al bij de aanvrager: alleen de aangeboden dienst gaat terug`, async () => {
        mem.planningMatrix = [matrixRij(DAG, '12', 'vrij'), matrixRij(TERUGDAG, '14', 'vrij')];
        mem.planning = [
          { id: 'sh-c', driverId: '4', date: DAG, line: '12' },
          { id: `${TERUGDAG}-3-14-1`, driverId: '3', date: TERUGDAG, line: '14' },
        ];
        const swap = ruil();
        mem.swaps = [swap];
        const res = await wijsAf(weg, swap);
        expect(res.status).toBe(200);
        expect(rijdt(DAG, '12')).toEqual(['3']);
        expect(rijdt(TERUGDAG, '14')).toEqual(['3']);
      });

      it(`${weg}: 1-op-1 die de Excel helemaal al toont: niets gaat terug`, async () => {
        mem.planningMatrix = [matrixRij(DAG, 'vrij', '12'), matrixRij(TERUGDAG, '14', 'vrij')];
        mem.planning = [
          { id: `${DAG}-4-12-1`, driverId: '4', date: DAG, line: '12' },
          { id: `${TERUGDAG}-3-14-1`, driverId: '3', date: TERUGDAG, line: '14' },
        ];
        const swap = ruil();
        mem.swaps = [swap];
        const res = await wijsAf(weg, swap);
        expect(res.status).toBe(200);
        expect(rijdt(DAG, '12')).toEqual(['4']);
        expect(rijdt(TERUGDAG, '14')).toEqual(['3']);
      });
    }

    it('een goedgekeurde ruil afwijzen draait altijd terug, wat de Excel ook toont', async () => {
      excelGeeftDienstAanCollega();
      const swap = overname({ status: 'approved', decidedAt: '2026-06-13T08:00:00Z' });
      mem.swaps = [swap];
      const res = await wijsAf('PATCH', swap);
      expect(res.status).toBe(200);
      expect(rijdt(DAG, '12')).toEqual(['3']);
    });

    it('lijst: meer dan één afwijzing leest dienstoverzicht en planningscodes samen één keer', async () => {
      excelGeeftDienstAanCollega();
      mem.planning.push({ id: `2026-07-01-4-12-1`, driverId: '4', date: '2026-07-01', line: '12' });
      mem.planningMatrix.push(matrixRij('2026-07-01', 'vrij', '12'));
      mem.swaps = [
        overname({ status: 'accepted' }),
        overname({ id: 's-o2', shiftId: 'sh-a', status: 'accepted', shiftDate: '2026-07-01' }),
      ];
      mem.servicesLezingen = 0;
      mem.codesLezingen = 0;
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: mem.swaps.map((s: any) => ({ ...s, status: 'rejected' })) });
      expect(res.status).toBe(200);
      expect(mem.swaps.map((s: any) => s.status)).toEqual(['rejected', 'rejected']);
      expect(rijdt(DAG, '12')).toEqual(['4']);
      expect(rijdt('2026-07-01', '12')).toEqual(['4']);
      expect(mem.servicesLezingen).toBe(1);
      expect(mem.codesLezingen).toBe(1);
    });
  });
});

describe('handmatige dienstwissel, gates uit de controle-ronde', () => {
  const wissel = (body: Record<string, unknown>, token = 'tok-admin') =>
    api('POST', '/api/admin/shift-swap', { token, body: { reason: 'Ziekte', ...body } });

  it('weigert de wissel als de dienst de TEGENPRESTATIE van een open ruil is', async () => {
    // s-2: chauffeur 4 biedt sh-b aan en vraagt dienst 12 op 03/07 terug.
    // Zet die terugruil-dienst in de planning op naam van chauffeur 3.
    mem.planning.push({ id: 'sh-terug', driverId: '3', date: '2026-07-03', line: '12' });
    const res = await wissel({ date: '2026-07-03', line: '12', fromDriverId: '3', toDriverId: '2' });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('ruilaanvraag');
    // Niets verplaatst.
    expect(mem.planning.find((r: any) => r.id === 'sh-terug')?.driverId).toBe('3');
  });

  it('weigert zonder returnLine als de nieuwe chauffeur die dag al rijdt (dubbele inplanning)', async () => {
    mem.planning.push({ id: 'sh-x1', driverId: '3', date: '2026-07-21', line: '12' }, { id: 'sh-x2', driverId: '4', date: '2026-07-21', line: '14' });
    const res = await wissel({ date: '2026-07-21', line: '12', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('dubbele inplanning');
    expect(mem.planning.find((r: any) => r.id === 'sh-x1')?.driverId).toBe('3');
  });

  it('wisselt 1-op-1 tussen twee ingeplande chauffeurs met returnLine (Jarno 14-09)', async () => {
    mem.planning.push({ id: 'sh-y1', driverId: '3', date: '2026-07-22', line: '12' }, { id: 'sh-y2', driverId: '4', date: '2026-07-22', line: 'R14' });
    // De maandplanning-cel stuurt de rúwe schrijfwijze van de terugdienst mee.
    const res = await wissel({ date: '2026-07-22', line: '12', fromDriverId: '3', toDriverId: '4', returnLine: 'r14' });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-y1')?.driverId).toBe('4');
    expect(mem.planning.find((r: any) => r.id === 'sh-y2')?.driverId).toBe('3');
    const swap = mem.swaps.find((s: any) => s.shiftDate === '2026-07-22');
    expect(swap).toMatchObject({ status: 'approved', swapType: 'ruil', shiftLine: '12', returnDate: '2026-07-22', returnCode: 'R14' });
  });

  it('weigert de 1-op-1-wissel als de terugdienst niet (meer) bij de nieuwe chauffeur staat, en verplaatst niets', async () => {
    mem.planning.push({ id: 'sh-z1', driverId: '3', date: '2026-07-23', line: '12' });
    const res = await wissel({ date: '2026-07-23', line: '12', fromDriverId: '3', toDriverId: '4', returnLine: '99' });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('geen dienst 99');
    expect(mem.planning.find((r: any) => r.id === 'sh-z1')?.driverId).toBe('3');
    expect(mem.swaps.find((s: any) => s.shiftDate === '2026-07-23')).toBeUndefined();
  });

  it('matcht de dienstcode genormaliseerd (rauwe matrixcode vs. canoniek nummer)', async () => {
    mem.planning.push({ id: 'sh-r12', driverId: '3', date: '2026-07-20', line: 'r12' });
    // De maandplanning-cel stuurt de rúwe schrijfwijze mee.
    const res = await wissel({ date: '2026-07-20', line: 'R12', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-r12')?.driverId).toBe('4');
    // De swap bewaart de canonieke schrijfwijze, zodat de replay hem terugvindt.
    expect(mem.swaps.find((s: any) => s.shiftDate === '2026-07-20')?.shiftLine).toBe('r12');
  });
});

describe('handmatige dienstwissel, code-diensten (schoolrit, bureau, garage)', () => {
  // Melding Jarno 28-09: EEK6 overzetten strandde op "de planning is intussen
  // gewijzigd". Een EEK-rit is een planningscode, geen dienst uit het
  // dienstoverzicht: de opbouw maakt er geen planning-rijen voor, dus de
  // eigendomscheck op `planning` vond nooit iets. Voor zulke diensten is het
  // bord (matrix + ruilen + afwezigheden) de waarheid.
  const DAG = '2026-07-24';
  const wissel = (body: Record<string, unknown>) =>
    api('POST', '/api/admin/shift-swap', { token: 'tok-admin', body: { date: DAG, reason: 'Ziekte', ...body } });
  const bord = async () => (await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' })).json.cells;
  const matrix = (assignments: Record<string, string>) => {
    mem.planningMatrix = [{ id: 'm-eek', source_date: DAG, day_type: 'week', assignments, raw_row: '' }];
  };

  beforeEach(() => {
    mem.planningCodes = [
      { code: 'eek5', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'eek6', category: 'service', description: 'Schoolrit', countsAsShift: true },
      { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true },
      { code: 'ziek', category: 'absence', description: 'Ziek', isDayOff: true },
    ];
    mem.swaps = [];
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij' });
  });

  it('zet een schoolrit over naar een vrije collega, zonder rijen in de planning', async () => {
    const planningVoor = JSON.stringify(mem.planning);
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(200);
    expect(mem.swaps).toHaveLength(1);
    expect(mem.swaps[0]).toMatchObject({ status: 'approved', swapType: 'overname', shiftDate: DAG, shiftLine: 'EEK6', requesterId: '3', targetDriverId: '4' });
    expect(String(mem.swaps[0].shiftId)).toBeTruthy();
    // Er valt niets te verplaatsen, en dat is geen waarschuwing.
    expect(JSON.stringify(mem.planning)).toBe(planningVoor);
    expect(String(res.json.carry)).toContain('op het bord doorgevoerd');
    expect(String(res.json.carry)).not.toContain('LET OP');
    // Het bord toont de wissel: de rit bij de collega, de gever vrij.
    const cells = await bord();
    expect(cells['4'][DAG]).toMatchObject({ code: 'EEK6', kind: 'service', swapManual: true });
    expect(cells['3'][DAG]).toMatchObject({ code: 'vrij', swapAway: true });
    expect(mem.pushesSent.length).toBeGreaterThan(0);
  });

  it('vindt de rit ook onder een ziekmelding', async () => {
    mem.leave = [{ id: 'l-ziek', userId: '3', startDate: DAG, endDate: DAG, type: 'ziekte', status: 'approved', comment: '', createdAt: `${DAG}T05:00:00Z`, decidedAt: `${DAG}T05:00:00Z` }];
    expect((await bord())['3'][DAG]).toMatchObject({ code: 'ziek', hiddenService: 'EEK6' });
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(200);
    const cells = await bord();
    expect(cells['4'][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
    expect(cells['3'][DAG]).toMatchObject({ code: 'ziek' });
    expect(cells['3'][DAG].hiddenService).toBeUndefined();
  });

  it('weigert als de rit op het bord niet (meer) bij de gever staat', async () => {
    matrix({ 'Chauffeur A': 'vrij', 'Chauffeur B': 'EEK6' });
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('staat niet (meer) op naam van Chauffeur A');
    expect(mem.swaps).toHaveLength(0);
  });

  it('weigert een tweede keer: na de wissel staat de rit niet meer bij de gever', async () => {
    expect((await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4' })).status).toBe(200);
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(409);
    expect(mem.swaps).toHaveLength(1);
  });

  it('blijft weigeren voor een code die geen dienst is, en voor een onbekende dienst', async () => {
    matrix({ 'Chauffeur A': 'ziek', 'Chauffeur B': 'vrij' });
    expect((await wissel({ line: 'ziek', fromDriverId: '3', toDriverId: '4' })).status).toBe(409);
    expect((await wissel({ line: '99', fromDriverId: '3', toDriverId: '4' })).status).toBe(409);
    expect(mem.swaps).toHaveLength(0);
  });

  it('weigert een dubbele inplanning: de collega rijdt die dag al een dienst', async () => {
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': '14' });
    mem.planning.push({ id: 'sh-eek-b', driverId: '4', date: DAG, line: '14' });
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('dubbele inplanning');
    expect(mem.swaps).toHaveLength(0);
  });

  it('weigert een collega die niet op het bord staat', async () => {
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '2' });
    expect(res.status).toBe(400);
    expect(String(res.json?.error)).toContain('staat niet op het bord');
    expect(mem.swaps).toHaveLength(0);
  });

  it('wisselt 1-op-1: schoolrit tegen een dienst uit het dienstoverzicht', async () => {
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': '14' });
    mem.planning.push({ id: 'sh-eek-b', driverId: '4', date: DAG, line: '14' });
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4', returnLine: '14' });
    expect(res.status).toBe(200);
    expect(mem.swaps[0]).toMatchObject({ swapType: 'ruil', shiftLine: 'EEK6', returnDate: DAG, returnCode: '14' });
    // De dienst met rijen verhuist in de planning, de schoolrit op het bord.
    expect(mem.planning.find((r: any) => r.id === 'sh-eek-b')?.driverId).toBe('3');
    const cells = await bord();
    expect(cells['4'][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
    expect(cells['3'][DAG]).toMatchObject({ code: '14', kind: 'service' });
  });

  it('wisselt 1-op-1: dienst uit het dienstoverzicht tegen een schoolrit', async () => {
    matrix({ 'Chauffeur A': '12', 'Chauffeur B': 'EEK5' });
    mem.planning.push({ id: 'sh-eek-a', driverId: '3', date: DAG, line: '12' });
    const res = await wissel({ line: '12', fromDriverId: '3', toDriverId: '4', returnLine: 'eek5' });
    expect(res.status).toBe(200);
    // De swap bewaart de schrijfwijze van het bord.
    expect(mem.swaps[0]).toMatchObject({ swapType: 'ruil', shiftLine: '12', returnCode: 'EEK5' });
    expect(mem.planning.find((r: any) => r.id === 'sh-eek-a')?.driverId).toBe('4');
    expect(String(res.json.carry)).not.toContain('LET OP');
    const cells = await bord();
    expect(cells['4'][DAG]).toMatchObject({ code: '12', kind: 'service' });
    expect(cells['3'][DAG]).toMatchObject({ code: 'EEK5', kind: 'service' });
  });

  it('wisselt 1-op-1 tussen twee schoolritten', async () => {
    matrix({ 'Chauffeur A': 'EEK6', 'Chauffeur B': 'EEK5' });
    const res = await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4', returnLine: 'EEK5' });
    expect(res.status).toBe(200);
    const cells = await bord();
    expect(cells['4'][DAG]).toMatchObject({ code: 'EEK6' });
    expect(cells['3'][DAG]).toMatchObject({ code: 'EEK5' });
  });

  it('weigert de 1-op-1 als de schoolrit van de collega niet (meer) op het bord staat', async () => {
    matrix({ 'Chauffeur A': '12', 'Chauffeur B': 'vrij' });
    mem.planning.push({ id: 'sh-eek-a', driverId: '3', date: DAG, line: '12' });
    const res = await wissel({ line: '12', fromDriverId: '3', toDriverId: '4', returnLine: 'EEK5' });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('geen dienst EEK5');
    expect(mem.planning.find((r: any) => r.id === 'sh-eek-a')?.driverId).toBe('3');
    expect(mem.swaps).toHaveLength(0);
  });

  it('terugdraaien zet het bord terug, zonder waarschuwing in het log', async () => {
    expect((await wissel({ line: 'EEK6', fromDriverId: '3', toDriverId: '4' })).status).toBe(200);
    const id = String(mem.swaps[0].id);
    const res = await api('PATCH', `/api/swaps/${id}`, { token: 'tok-admin', body: { status: 'cancelled', ifStatus: 'approved' } });
    expect(res.status).toBe(200);
    const logregel = mem.activity.map((a: any) => String(a.message)).find((m: string) => m.includes('teruggedraaid'));
    expect(logregel).toContain('op het bord teruggedraaid');
    expect(logregel).not.toContain('LET OP');
    const cells = await bord();
    expect(cells['3'][DAG]).toMatchObject({ code: 'EEK6', kind: 'service' });
    expect(cells['3'][DAG].swapId).toBeUndefined();
    expect(cells['4'][DAG]).toMatchObject({ code: 'vrij' });
  });

  // Tot de controle van 29-09 stond hier "de gewone wissel leest het bord
  // niet", met `matrixMaandFilters` op lengte 0. Die toets kwam mee met #654
  // (40971be) en bewaakte twee dingen: de gewone wissel betaalt geen extra
  // leeswerk voor de code-diensten, en haar gedrag blijft door #654
  // onaangeroerd. Ze ging over kosten en over afbakening, niet over
  // correctheid: het bord overslaan was nooit nodig om juist te wisselen.
  //
  // Juist dat overslaan was het gat: de ontvanger werd alleen tegen zijn
  // planning-rijen getoetst, en een schoolrit heeft er geen. Hij kreeg er dus
  // stil een dienst bij. De gewone wissel leest het bord nu wél, bewust. Wat
  // deze toets voortaan bewaakt is dat het bij één keer blijft en klein:
  //  - het bord één keer, en alleen de matrixrij van die ene dag;
  //  - in dezelfde beweging als de planning-rijen, niet erna;
  //  - het verlof en de ruilen die het bord leest, dienen ook voor de
  //    afwezigheidscontrole en de open ruilaanvragen: geen dubbele lezing.
  //  - het dienstoverzicht en de planningscodes elk één keer.
  // Netto leest een gewone wissel drie dingen meer dan vroeger (de matrixrij
  // van de dag, het dienstoverzicht en de planningscodes) en één ding minder
  // (de gebruikers een tweede keer).
  it('de gewone wissel leest het bord één keer, en alleen die dag', async () => {
    mem.planning.push({ id: 'sh-gewoon', driverId: '3', date: DAG, line: '12' });
    mem.matrixMaandFilters = [];
    mem.leaveFilters = [];
    mem.swapFilters = [];
    mem.servicesLezingen = 0;
    mem.codesLezingen = 0;
    const res = await wissel({ line: '12', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-gewoon')?.driverId).toBe('4');
    // Het dienstoverzicht en de planningscodes elk één keer.
    expect({ diensten: mem.servicesLezingen, codes: mem.codesLezingen }).toEqual({ diensten: 1, codes: 1 });
    // Eén lezing van de matrix, begrensd tot de dag van de wissel.
    expect(mem.matrixMaandFilters).toEqual([`${DAG}..${DAG}`]);
    // Het verlof één keer (bord én afwezigheidscontrole samen).
    expect(mem.leaveFilters).toHaveLength(1);
    // De ruilen twee keer, zoals vóór de controle: één keer voor de wissel
    // zelf (nu via het bord), één keer voor de revisie in het antwoord.
    expect(mem.swapFilters).toHaveLength(2);
  });
});

describe('dienstruil, dubbele inplanning bij goedkeuren', () => {
  it('weigert goedkeuring als de collega intussen zelf een dienst heeft die dag', async () => {
    // s-1: chauffeur 3 biedt sh-a (01/07, dienst 12) aan chauffeur 4, tegen een
    // vrije dag. Chauffeur 4 krijgt intussen zelf een dienst op 01/07.
    mem.swaps = mem.swaps.map((s: any) => (s.id === 's-1' ? { ...s, shiftDate: '2026-07-01', shiftLine: '12' } : s));
    mem.planning.push({ id: 'sh-nieuw', driverId: '4', date: '2026-07-01', line: '15' });
    const accept = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(accept.status).toBe(200);
    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(409);
    expect(String(approve.json?.error)).toContain('dubbele inplanning');
    // De dienst is niet verhuisd.
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('3');
  });

  it('laat een 1-op-1 ruil op dezelfde dag gewoon door (terugruil telt niet mee)', async () => {
    // Chauffeur 3 (dienst 12) en chauffeur 4 (dienst 14) ruilen op 01/07.
    mem.planning = [
      { id: 'sh-a', driverId: '3', date: '2026-07-01', line: '12' },
      { id: 'sh-x', driverId: '4', date: '2026-07-01', line: '14' },
    ];
    mem.swaps = [
      { id: 's-zelfde-dag', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-01', returnCode: '14' },
    ];
    const res = await api('PATCH', '/api/swaps/s-zelfde-dag', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('4');
    expect(mem.planning.find((r: any) => r.id === 'sh-x')?.driverId).toBe('3');
  });
});

describe('dienstruil, concurrency-vangnet bij goedkeuren', () => {
  it('weigert goedkeuring als de doorvoer nul rijen verplaatst (planning intussen gewijzigd)', async () => {
    // Geaccepteerde ruil, maar de dienst is intussen (bv. door een admin-
    // wissel) al naar iemand anders verplaatst: apply raakt 0 rijen.
    mem.planning = [{ id: 'sh-a', driverId: '9', date: '2026-07-01', line: '12' }];
    mem.swaps = [{
      id: 's-race', shiftId: 'sh-weg', requesterId: '3', targetDriverId: '4', status: 'accepted',
      reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', swapType: 'overname',
    }];
    const res = await api('PATCH', '/api/swaps/s-race', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('intussen gewijzigd');
    // Niet half goedgekeurd: status bleef accepted.
    expect(mem.swaps.find((s: any) => s.id === 's-race')?.status).toBe('accepted');
  });
});

// Tweede lezing 01-10. Bij een 1-op-1 weigerde de doorvoer terecht (409) als de
// aangeboden dienst geen rij verplaatste, maar de terugdienst was dan al naar
// de aanvrager verhuisd en bleef daar: status nog 'accepted', geen logregel,
// en afwijzen draaide niets terug omdat de planning als "onbekend" las. De
// doorvoer loopt nu been per been en raakt de terugdienst niet aan als de
// aangeboden dienst niet verhuisde.
describe('dienstruil: een geweigerde doorvoer laat de terugdienst waar ze stond (01-10)', () => {
  const DAG = '2026-07-08';
  const TERUGDAG = '2026-07-02';
  // A (3) ruilt dienst 12 van 08/07 tegen dienst 14 van B (4) op 02/07. De rij
  // van dienst 12 is intussen aan een derde chauffeur gegeven: een nieuwe rij
  // met een nieuw id (zo doet de opbouw dat), dus de controle op de rij-id
  // ziet niets en het vangnet bij de doorvoer moet het opvangen.
  beforeEach(() => {
    mem.planning = [
      { id: `${DAG}-9-12-1`, driverId: '9', date: DAG, line: '12' },
      { id: 'sh-b', driverId: '4', date: TERUGDAG, line: '14' },
    ];
    mem.swaps = [{
      id: 's-half', shiftId: 'sh-weg', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '',
      createdAt: '2026-06-12T08:00:00Z', swapType: 'ruil', shiftDate: DAG, shiftLine: '12', returnDate: TERUGDAG, returnCode: '14',
    }];
  });
  const beslis = (weg: 'PATCH' | 'POST', token: string, status: string) => (weg === 'PATCH'
    ? api('PATCH', '/api/swaps/s-half', { token, body: { status, ifStatus: 'accepted' } })
    : api('POST', '/api/swaps', { token, body: mem.swaps.map((s: any) => ({ ...s, status })) }));

  for (const weg of ['PATCH', 'POST'] as const) {
    for (const [wie, token, status] of [['de planner keurt goed', 'tok-planner', 'approved'], ['de admin handelt rechtstreeks af', 'tok-admin', 'completed']] as const) {
      it(`${weg}, ${wie}: 409 en elke rij in de planning staat precies zoals ervoor`, async () => {
        const voor = JSON.stringify(mem.planning);
        const res = await beslis(weg, token, status);
        expect(res.status).toBe(409);
        expect(String(res.json?.error)).toBe('De planning is intussen gewijzigd, de dienst staat niet meer op naam van de aanvrager. Vernieuw de pagina en beoordeel opnieuw.');
        expect(JSON.stringify(mem.planning)).toBe(voor);
        expect(mem.swaps[0].status).toBe('accepted');
        expect(mem.swaps[0].decidedAt).toBeUndefined();
        expect(mem.activity.filter((a: any) => a.entityId === 's-half')).toEqual([]);
        expect(mem.pushesSent).toEqual([]);
        // Een tweede poging geeft hetzelfde eerlijke antwoord, geen "herstel".
        const opnieuw = await beslis(weg, token, status);
        expect(opnieuw.status).toBe(409);
        expect(JSON.stringify(mem.planning)).toBe(voor);
        expect(mem.swaps[0].status).toBe('accepted');
      });
    }
  }

  it('afwijzen na de geweigerde doorvoer: de ruil gaat dicht en de planning is nog altijd onaangeroerd', async () => {
    const voor = JSON.stringify(mem.planning);
    expect((await beslis('PATCH', 'tok-planner', 'approved')).status).toBe(409);
    const af = await beslis('PATCH', 'tok-planner', 'rejected');
    expect(af.status).toBe(200);
    expect(mem.swaps[0].status).toBe('rejected');
    expect(JSON.stringify(mem.planning)).toBe(voor);
  });

  it('het gewone geval blijft: staat de aangeboden dienst bij de aanvrager, dan verhuizen beide benen', async () => {
    mem.planning[0] = { id: 'sh-weg', driverId: '3', date: DAG, line: '12' };
    const res = await beslis('PATCH', 'tok-planner', 'approved');
    expect(res.status).toBe(200);
    expect(mem.planning.map((p: any) => p.driverId)).toEqual(['4', '3']);
    expect(mem.activity.find((a: any) => a.entityId === 's-half')?.message).toContain('dienst 12 op 08/07/2026: 1 rij(en) doorgevoerd; terugruil 14 op 02/07/2026: 1 rij(en) doorgevoerd');
  });

  it('de terugdienst die de planning niet (meer) kent blijft een waarschuwing in het log, geen weigering', async () => {
    mem.planning = [{ id: 'sh-weg', driverId: '3', date: DAG, line: '12' }];
    const res = await beslis('PATCH', 'tok-planner', 'approved');
    expect(res.status).toBe(200);
    expect(mem.planning[0].driverId).toBe('4');
    expect(mem.activity.find((a: any) => a.entityId === 's-half')?.message).toContain('LET OP: terugruil 14 op 02/07/2026 niet gevonden');
  });
});

// Scan 01-10, punt 11 (Jarno: "belangrijk"). Beide ruilroutes controleerden op
// een momentopname, verplaatsten (bij goedkeuren) de planning en schreven dan
// de hele rij met een onvoorwaardelijke upsert. Twee verzoeken die elkaar
// kruisten konden eindigen op 'cancelled' met een verplaatste dienst, of op
// 'completed' met een teruggedraaide planning: een eindstatus, niet te
// herstellen vanuit het scherm.
//
// Hier landt het tweede verzoek echt in het venster van het eerste: de haak
// `mem.voorSwapStatusWissel` loopt vlak vóór de voorwaardelijke schrijfactie
// van het eerste verzoek, dus ná zijn lezing, zijn controles en zijn
// planning-doorvoer. Beide verzoeken gaan door de echte handlers.
describe('dienstruil: twee beslissingen op hetzelfde moment overschrijven elkaar niet (01-10)', () => {
  const DAG = '2026-07-08';
  const TERUGDAG = '2026-07-02';
  // A (3) geeft dienst 12 van 08/07 (sh-c) aan B (4), die dag op bv.
  const overname = (status: string, extra: Record<string, unknown> = {}) => ({
    id: 's-c', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status, reason: '',
    createdAt: '2026-06-12T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '12', ...extra,
  });
  const ruil = () => mem.swaps.find((s: any) => s.id === 's-c')!;
  const eigenaar = (id = 'sh-c') => mem.planning.find((p: any) => p.id === id)?.driverId;
  const acties = (id = 's-c') => mem.activity.filter((a: any) => a.entityId === id).map((a: any) => a.action);
  const patch = (token: string, status: string, ifStatus: string, id = 's-c') =>
    api('PATCH', `/api/swaps/${id}`, { token, body: { status, ifStatus } });
  /** Laat `tweede` landen in het venster van het eerstvolgende verzoek. */
  const inHetVenster = (tweede: () => Promise<{ status: number; json: any }>) => {
    const uit: { res?: { status: number; json: any } } = {};
    mem.voorSwapStatusWissel = async () => { uit.res = await tweede(); };
    return uit;
  };
  const naarB = () => { mem.planning = mem.planning.map((p: any) => (p.id === 'sh-c' ? { ...p, driverId: '4' } : p)); };

  describe('de aanvrager trekt in terwijl de planner goedkeurt', () => {
    it('de intrekking landt eerst: de planner krijgt 409, de dienst staat weer bij de aanvrager', async () => {
      mem.swaps = [overname('accepted')];
      const tweede = inHetVenster(() => patch('tok-a', 'cancelled', 'accepted'));
      const res = await patch('tok-planner', 'approved', 'accepted');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('cancelled');
      expect(String(res.json.error)).toBe("Deze ruil is intussen al 'cancelled', de lijst is ververst.");
      expect(ruil().status).toBe('cancelled');
      expect(eigenaar()).toBe('3');
      // De verliezer logt en meldt niets: er is niets goedgekeurd.
      expect(acties()).toEqual(['Dienstruil geannuleerd']);
      expect(mem.pushesSent.map((p) => p.payload.title)).toEqual(['Dienstruil geannuleerd']);
    });

    it('de goedkeuring landt eerst: de aanvrager krijgt 409, de dienst staat bij de collega', async () => {
      mem.swaps = [overname('accepted')];
      const tweede = inHetVenster(() => patch('tok-planner', 'approved', 'accepted'));
      const res = await patch('tok-a', 'cancelled', 'accepted');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('approved');
      expect(ruil().status).toBe('approved');
      expect(eigenaar()).toBe('4');
      expect(acties()).toEqual(['Dienstruil goedgekeurd']);
    });

    it('1-op-1: beide benen die de planner verplaatste gaan terug', async () => {
      mem.swaps = [overname('accepted', { swapType: 'ruil', returnDate: TERUGDAG, returnCode: '14' })];
      const tweede = inHetVenster(() => patch('tok-a', 'cancelled', 'accepted'));
      const res = await patch('tok-planner', 'approved', 'accepted');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(ruil().status).toBe('cancelled');
      expect(eigenaar('sh-c')).toBe('3');
      expect(eigenaar('sh-b')).toBe('4');
    });

    it('de aanvrager trekt in via de lijst (verwijderen): de planner krijgt 404, de dienst staat weer bij de aanvrager', async () => {
      mem.swaps = [overname('pending')];
      const tweede = inHetVenster(() => api('POST', '/api/swaps', { token: 'tok-a', body: [] }));
      const res = await patch('tok-admin', 'approved', 'pending');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(404);
      expect(mem.swaps).toEqual([]);
      expect(eigenaar()).toBe('3');
    });
  });

  describe('de collega weigert terwijl een admin zonder zijn antwoord goedkeurt', () => {
    it('de weigering landt eerst: de admin krijgt 409, de dienst staat weer bij de aanvrager', async () => {
      mem.swaps = [overname('pending')];
      const tweede = inHetVenster(() => patch('tok-b', 'rejected', 'pending'));
      const res = await patch('tok-admin', 'approved', 'pending');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('rejected');
      expect(ruil().status).toBe('rejected');
      expect(eigenaar()).toBe('3');
      expect(acties()).toEqual(['Dienstruil afgewezen']);
    });

    it('de goedkeuring landt eerst: de collega krijgt 409 en zijn weigering zet niets terug', async () => {
      mem.swaps = [overname('pending')];
      const tweede = inHetVenster(() => patch('tok-admin', 'approved', 'pending'));
      const res = await patch('tok-b', 'rejected', 'pending');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('approved');
      expect(ruil().status).toBe('approved');
      expect(eigenaar()).toBe('4');
    });

    it('zelfde kruising met de rechtstreekse afhandeling van een admin', async () => {
      mem.swaps = [overname('pending')];
      const tweede = inHetVenster(() => patch('tok-b', 'rejected', 'pending'));
      const res = await patch('tok-admin', 'completed', 'pending');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(ruil().status).toBe('rejected');
      expect(eigenaar()).toBe('3');
      expect(acties()).toEqual(['Dienstruil afgewezen']);
    });
  });

  describe('afhandelen terwijl een ander annuleert', () => {
    const goedgekeurd = () => { mem.swaps = [overname('approved', { decidedAt: '2026-06-13T08:00:00Z' })]; naarB(); };

    it('de afhandeling landt eerst: de annulering krijgt 409 en wat ze terugdraaide staat weer bij de collega', async () => {
      goedgekeurd();
      const tweede = inHetVenster(() => patch('tok-admin', 'completed', 'approved'));
      const res = await patch('tok-planner', 'cancelled', 'approved');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('completed');
      expect(ruil().status).toBe('completed');
      expect(ruil().decidedAt).toBe('2026-06-13T08:00:00Z');
      expect(eigenaar()).toBe('4');
      expect(acties()).toEqual(['Dienstruil voltooid']);
    });

    it('de annulering landt eerst: de afhandeling krijgt 409, de dienst staat weer bij de aanvrager', async () => {
      goedgekeurd();
      const tweede = inHetVenster(() => patch('tok-planner', 'cancelled', 'approved'));
      const res = await patch('tok-admin', 'completed', 'approved');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('cancelled');
      expect(ruil().status).toBe('cancelled');
      expect(eigenaar()).toBe('3');
      expect(acties()).toEqual(['Dienstruil geannuleerd']);
    });

    it('twee annuleringen tegelijk: één wint, de dienst gaat één keer terug', async () => {
      goedgekeurd();
      const tweede = inHetVenster(() => patch('tok-admin', 'cancelled', 'approved'));
      const res = await patch('tok-planner', 'cancelled', 'approved');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(ruil().status).toBe('cancelled');
      expect(eigenaar()).toBe('3');
      expect(acties()).toEqual(['Dienstruil geannuleerd']);
    });
  });

  describe('de planning volgt de werkelijke status, niet de verliezer', () => {
    it('twee goedkeuringen tegelijk: de tweede herkent de doorvoer van de eerste, de verliezer laat ze staan', async () => {
      // De admin leest de rijen ná de doorvoer van de planner, ziet de wissel
      // al staan en schrijft 'approved'. De planner verliest daarna, maar zijn
      // verplaatsing is precies wat bij 'approved' hoort.
      mem.swaps = [overname('accepted')];
      const tweede = inHetVenster(() => patch('tok-admin', 'approved', 'accepted'));
      const res = await patch('tok-planner', 'approved', 'accepted');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('approved');
      expect(ruil().status).toBe('approved');
      expect(eigenaar()).toBe('4');
      expect(acties()).toEqual(['Dienstruil goedgekeurd']);
    });

    it('de planner wijst af terwijl een goedkeuring loopt: wie ook wint, status en planning kloppen', async () => {
      // De afwijzing ziet de rijen al bij de collega (de lopende goedkeuring),
      // het bord niet: ze draait terug en schrijft 'rejected'. De goedkeuring
      // verliest en vindt niets meer om terug te zetten.
      mem.swaps = [overname('accepted')];
      const tweede = inHetVenster(() => patch('tok-planner', 'rejected', 'accepted'));
      const res = await patch('tok-admin', 'approved', 'accepted');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(ruil().status).toBe('rejected');
      expect(eigenaar()).toBe('3');
    });

    it('de afwijzing van een halve doorvoer verliest van een goedkeuring: de dienst staat bij de collega', async () => {
      // De rijen staan al bij de collega (halve doorvoer). De planner wijst af
      // en zet ze terug; in zijn venster keurt de admin goed, mét doorvoer.
      mem.swaps = [overname('accepted')];
      naarB();
      const tweede = inHetVenster(() => patch('tok-admin', 'approved', 'accepted'));
      const res = await patch('tok-planner', 'rejected', 'accepted');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('approved');
      expect(ruil().status).toBe('approved');
      expect(eigenaar()).toBe('4');
      expect(acties()).toEqual(['Dienstruil goedgekeurd']);
    });

    it('de bevestiging van de nieuwe rijder die tijdens het afhandelen binnenkomt blijft staan', async () => {
      mem.swaps = [overname('approved', { decidedAt: '2026-06-13T08:00:00Z' })];
      naarB();
      const tweede = inHetVenster(() => api('POST', '/api/swaps/s-c/gezien', { token: 'tok-b' }));
      const res = await patch('tok-planner', 'completed', 'approved');
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(200);
      expect(ruil().status).toBe('completed');
      expect(ruil().targetSeenAt).toBeTruthy();
    });
  });

  describe('het rechtzetten zelf mislukt', () => {
    it('gaat nooit stil voorbij: logregel, serverlog en een melding die zegt wat na te kijken', async () => {
      const fout = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        mem.swaps = [overname('accepted')];
        const tweede = inHetVenster(async () => {
          const uit = await patch('tok-a', 'cancelled', 'accepted');
          mem.planningVerplaatsenFaalt = 'terugdraaien';
          return uit;
        });
        const res = await patch('tok-planner', 'approved', 'accepted');
        expect(tweede.res?.status).toBe(200);
        expect(res.status).toBe(409);
        expect(String(res.json.error)).toBe('Deze ruil is intussen door iemand anders beslist, en de planning kon daarna niet rechtgezet worden. Controleer dienst 12 op 08/07/2026 in de planning en zet ze zo nodig handmatig recht.');
        expect(String(res.json.error).length).toBeLessThan(240);
        // De rij is niet overschreven; de planning staat (aantoonbaar) nog scheef.
        expect(ruil().status).toBe('cancelled');
        expect(eigenaar()).toBe('4');
        const regel = mem.activity.find((a: any) => a.action === 'Planning niet rechtgezet na dienstruil');
        expect(regel?.entityId).toBe('s-c');
        expect(regel?.message).toContain('Controleer de planning van die dag handmatig');
        expect(fout.mock.calls.some((c) => String(c[0]).includes('LET OP, dienstruil s-c'))).toBe(true);
        expect(acties()).not.toContain('Dienstruil goedgekeurd');
      } finally {
        fout.mockRestore();
      }
    });
  });

  describe('het rechtzetten mislukt op een andere plek', () => {
    const NIET_RECHTGEZET = 'Deze ruil is intussen door iemand anders beslist, en de planning kon daarna niet rechtgezet worden. Controleer dienst 12 op 08/07/2026 in de planning en zet ze zo nodig handmatig recht.';
    const stil = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

    it('de werkelijke status is niet te lezen nadat de planning al verplaatst was: dezelfde luide melding', async () => {
      const fout = stil();
      try {
        mem.swaps = [overname('accepted')];
        const tweede = inHetVenster(async () => {
          const uit = await patch('tok-a', 'cancelled', 'accepted');
          mem.swapHerlezingFaalt = true;
          return uit;
        });
        const res = await patch('tok-planner', 'approved', 'accepted');
        expect(tweede.res?.status).toBe(200);
        expect(res.status).toBe(409);
        expect(String(res.json.error)).toBe(NIET_RECHTGEZET);
        expect(ruil().status).toBe('cancelled');
        expect(mem.activity.some((a: any) => a.action === 'Planning niet rechtgezet na dienstruil' && a.entityId === 's-c')).toBe(true);
        expect(fout.mock.calls.some((c) => String(c[0]).includes('LET OP, dienstruil s-c'))).toBe(true);
      } finally {
        fout.mockRestore();
      }
    });

    it('een annulering verliest van een afhandeling en kan de dienst niet opnieuw doorvoeren: luide melding', async () => {
      const fout = stil();
      try {
        mem.swaps = [overname('approved', { decidedAt: '2026-06-13T08:00:00Z' })];
        naarB();
        const tweede = inHetVenster(async () => {
          const uit = await patch('tok-admin', 'completed', 'approved');
          mem.planningVerplaatsenFaalt = 'doorvoeren';
          return uit;
        });
        const res = await patch('tok-planner', 'cancelled', 'approved');
        expect(tweede.res?.status).toBe(200);
        expect(res.status).toBe(409);
        expect(String(res.json.error)).toBe(NIET_RECHTGEZET);
        expect(ruil().status).toBe('completed');
        const regel = mem.activity.find((a: any) => a.action === 'Planning niet rechtgezet na dienstruil');
        expect(regel?.message).toContain('teruggedraaid kon niet rechtgezet worden');
        expect(acties()).not.toContain('Dienstruil geannuleerd');
      } finally {
        fout.mockRestore();
      }
    });

    it('alleen de herlezing mislukt en er was niets verplaatst (de collega weigert): 409 zonder alarm over de planning', async () => {
      const fout = stil();
      try {
        mem.swaps = [overname('pending')];
        const tweede = inHetVenster(async () => {
          const uit = await patch('tok-admin', 'approved', 'pending');
          mem.swapHerlezingFaalt = true;
          return uit;
        });
        const res = await patch('tok-b', 'rejected', 'pending');
        expect(tweede.res?.status).toBe(200);
        expect(res.status).toBe(409);
        expect(String(res.json.error)).toBe('Deze ruil is intussen door iemand anders gewijzigd, de lijst is ververst.');
        expect(ruil().status).toBe('approved');
        expect(eigenaar()).toBe('4');
        expect(mem.activity.some((a: any) => a.action === 'Planning niet rechtgezet na dienstruil')).toBe(false);
      } finally {
        fout.mockRestore();
      }
    });
  });

  describe('de lijstroute (POST /api/swaps)', () => {
    it('goedkeuren via de lijst terwijl de aanvrager intrekt: 409, de dienst staat weer bij de aanvrager', async () => {
      mem.swaps = [overname('accepted')];
      const tweede = inHetVenster(() => patch('tok-a', 'cancelled', 'accepted'));
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [{ ...overname('accepted'), status: 'approved' }] });
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('cancelled');
      expect(ruil().status).toBe('cancelled');
      expect(eigenaar()).toBe('3');
      expect(acties()).toEqual(['Dienstruil geannuleerd']);
    });

    it('de collega antwoordt via de lijst terwijl een admin goedkeurt: zijn antwoord overschrijft de goedkeuring niet', async () => {
      mem.swaps = [overname('pending')];
      const tweede = inHetVenster(() => patch('tok-admin', 'approved', 'pending'));
      const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [{ ...overname('pending'), status: 'rejected' }] });
      expect(tweede.res?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(ruil().status).toBe('approved');
      expect(eigenaar()).toBe('4');
    });

    it('twee goedkeuringen in één lijst, de tweede verliest: de eerste is volledig geschreven en gelogd, het antwoord is geen succes', async () => {
      mem.planning.push({ id: 'sh-d', driverId: '3', date: '2026-07-09', line: '13' });
      mem.planningMatrix.push({ id: 'm-9', source_date: '2026-07-09', day_type: 'week', assignments: { 'Chauffeur A': '13', 'Chauffeur B': 'bv' }, raw_row: '' });
      mem.swaps = [
        overname('accepted', { id: 's-een' }),
        overname('accepted', { id: 's-twee', shiftId: 'sh-d', shiftDate: '2026-07-09', shiftLine: '13' }),
      ];
      const body = mem.swaps.map((s: any) => ({ ...s, status: 'approved' }));
      // De aanvrager trekt de TWEEDE ruil in, in het venster van diens schrijfactie.
      let tweede: { status: number } | undefined;
      const haak = async (id: string) => {
        if (id !== 's-twee') { mem.voorSwapStatusWissel = haak; return; }
        tweede = await patch('tok-a', 'cancelled', 'accepted', 's-twee');
      };
      mem.voorSwapStatusWissel = haak;
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body });
      expect(tweede?.status).toBe(200);
      expect(res.status).toBe(409);
      expect(res.json.success).toBeUndefined();
      // De eerste: status, planning en log horen bij elkaar.
      expect(mem.swaps.find((s: any) => s.id === 's-een')?.status).toBe('approved');
      expect(eigenaar('sh-c')).toBe('4');
      expect(acties('s-een')).toEqual(['Dienstruil goedgekeurd']);
      // De tweede: ingetrokken, en wat de lijst al verplaatste staat terug.
      expect(mem.swaps.find((s: any) => s.id === 's-twee')?.status).toBe('cancelled');
      expect(eigenaar('sh-d')).toBe('3');
      expect(acties('s-twee')).toEqual(['Dienstruil geannuleerd']);
    });

    // Twee keer hetzelfde id in één lijst (tweede lezing 01-10): de tweede
    // wissel draagt dezelfde verwachte status als de eerste, verliest dus van
    // de eerste, en de planning volgt de status die er echt staat.
    it('zelfde id twee keer, eerst annuleren dan goedkeuren: 409, geannuleerd en beide benen terug bij hun eigenaar', async () => {
      const swap = overname('accepted', { swapType: 'ruil', returnDate: TERUGDAG, returnCode: '14' });
      mem.swaps = [swap];
      const voor = JSON.stringify(mem.planning);
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [{ ...swap, status: 'cancelled' }, { ...swap, status: 'approved' }] });
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('cancelled');
      expect(res.json.success).toBeUndefined();
      expect(mem.swaps).toHaveLength(1);
      expect(ruil().status).toBe('cancelled');
      expect(JSON.stringify(mem.planning)).toBe(voor);
      expect(acties()).toEqual(['Dienstruil geannuleerd']);
      expect(mem.swapStatusWissels.map((w) => [w.naar, w.verwacht, w.geraakt])).toEqual([['cancelled', 'accepted', true], ['approved', 'accepted', false]]);
    });

    it('zelfde id twee keer, eerst goedkeuren dan annuleren: 409, goedgekeurd en beide benen verhuisd', async () => {
      const swap = overname('accepted', { swapType: 'ruil', returnDate: TERUGDAG, returnCode: '14' });
      mem.swaps = [swap];
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [{ ...swap, status: 'approved' }, { ...swap, status: 'cancelled' }] });
      expect(res.status).toBe(409);
      expect(res.json.currentStatus).toBe('approved');
      expect(mem.swaps).toHaveLength(1);
      expect(ruil().status).toBe('approved');
      expect(eigenaar('sh-c')).toBe('4');
      expect(eigenaar('sh-b')).toBe('3');
      expect(acties()).toEqual(['Dienstruil goedgekeurd']);
      expect(mem.swapStatusWissels.map((w) => [w.naar, w.verwacht, w.geraakt])).toEqual([['approved', 'accepted', true], ['cancelled', 'accepted', false]]);
    });

    it('een record waarvan de status niet wisselt wordt niet geschreven: een echo overschrijft niets', async () => {
      // De planner dient een nieuwe aanvraag in met een lijst waarin s-c een
      // verouderde inhoud draagt. Vroeger ging s-c mee in de upsert (een ruil
      // op 'pending' is nog niet bevroren) en was de opgeslagen rij overschreven.
      mem.swaps = [overname('pending', { reason: 'zoals opgeslagen' })];
      const nieuw = { id: 's-nieuw', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-06-14T08:00:00Z', returnDate: '2026-07-02', returnCode: '14' };
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [{ ...overname('pending'), reason: 'verouderde echo' }, nieuw] });
      expect(res.status).toBe(200);
      expect(mem.swapStatusWissels).toEqual([]);
      expect(ruil().reason).toBe('zoals opgeslagen');
      expect(mem.swaps.map((s: any) => s.id)).toEqual(['s-c', 's-nieuw']);
    });

    it('elke statuswissel draagt de status die de handler las als voorwaarde', async () => {
      mem.swaps = [overname('accepted')];
      const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [{ ...overname('accepted'), status: 'approved' }] });
      expect(res.status).toBe(200);
      expect(mem.swapStatusWissels).toEqual([{ id: 's-c', verwacht: 'accepted', naar: 'approved', geraakt: true }]);
    });

    it('een nieuwe aanvraag is een insert: bestaat het id intussen al, dan 409 en geen overschrijving', async () => {
      mem.swaps = [];
      const nieuw = { id: 's-dubbel', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: 'tweede', createdAt: '2026-06-14T08:00:00Z', returnDate: '2026-07-02', returnCode: '14' };
      // Dezelfde aanvraag kwam net via een ander verzoek binnen.
      mem.voorSwapToevoegen = () => { mem.swaps = [{ ...nieuw, reason: 'eerste', shiftDate: '2026-07-01', shiftLine: '12' }]; };
      const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [nieuw] });
      expect(res.status).toBe(409);
      expect(mem.swaps).toHaveLength(1);
      expect(mem.swaps[0].reason).toBe('eerste');
      expect(mem.activity.filter((a: any) => a.action === 'Dienstruil aangevraagd')).toEqual([]);
    });
  });

  it('PATCH schrijft met de gelezen status als voorwaarde, en alleen die ene rij', async () => {
    mem.swaps = [overname('accepted'), overname('pending', { id: 's-ander' })];
    const res = await patch('tok-planner', 'approved', 'accepted');
    expect(res.status).toBe(200);
    expect(mem.swapStatusWissels).toEqual([{ id: 's-c', verwacht: 'accepted', naar: 'approved', geraakt: true }]);
    expect(mem.swaps.find((s: any) => s.id === 's-ander')?.status).toBe('pending');
  });
});

describe('dienstruil, verwijderen laat een auditspoor na', () => {
  it('logt een verwijderde ruil in het activiteitenlog', async () => {
    const voor = mem.activity.length;
    // Planner schrijft de volledige lijst terug zónder s-1 (= verwijdering).
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: mem.swaps.filter((s: any) => s.id !== 's-1') });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-1')).toBeFalsy();
    const nieuw = mem.activity.slice(voor);
    expect(nieuw.some((a: any) => String(a.action) === 'Dienstruil verwijderd' && String(a.entityId) === 's-1')).toBe(true);
  });
});

describe('gezien-bevestiging op een doorgevoerde wissel', () => {
  beforeEach(() => {
    mem.swaps = [
      { id: 's-app', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-07-01T08:00:00Z', decidedAt: '2026-07-02T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
      { id: 's-pend', shiftId: 'sh-b', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-07-01T09:00:00Z' },
    ];
  });

  it('alleen de ontvangende chauffeur mag bevestigen (403 voor anderen)', async () => {
    // Aanvrager (chauffeur 3) is niet de ontvanger.
    const res = await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-a' });
    expect(res.status).toBe(403);
    expect(mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt).toBeUndefined();
  });

  it('weigert een nog niet doorgevoerde wissel (409)', async () => {
    const res = await api('POST', '/api/swaps/s-pend/gezien', { token: 'tok-b' });
    expect(res.status).toBe(409);
  });

  it('zet target_seen_at, logt de activiteit en is idempotent', async () => {
    const res = await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    expect(res.status).toBe(200);
    const eerste = mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt;
    expect(typeof eerste).toBe('string');
    expect(mem.activity.some((a: any) => a.action === 'Dienstwissel bevestigd')).toBe(true);
    // Tweede keer bevestigen overschrijft de timestamp niet.
    const opnieuw = await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    expect(opnieuw.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt).toBe(eerste);
  });

  it('de array-route wist een bestaande bevestiging niet', async () => {
    await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    const eerste = mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt;
    // Chauffeur 4 stuurt zijn eigen lijst terug zónder targetSeenAt (en zelfs
    // met een vervalste waarde op de pending) — de server negeert dat veld.
    const eigen = mem.swaps
      .filter((s: any) => s.requesterId === '4' || s.targetDriverId === '4')
      .map((s: any) => ({ ...s, targetSeenAt: s.id === 's-pend' ? '2020-01-01T00:00:00Z' : undefined }));
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: eigen });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt).toBe(eerste);
    expect(mem.swaps.find((s: any) => s.id === 's-pend')?.targetSeenAt ?? undefined).toBeUndefined();
  });

  it('een nieuwe aanvraag met de snake_case-alias target_seen_at start onbevestigd (audit 07-09, #4)', async () => {
    // saveSwapsData haalt records door toPublicSwap, die voor targetSeenAt
    // terugvalt op target_seen_at. De handler zette targetSeenAt wel op de
    // opgeslagen waarde (nieuw = undefined), maar liet de alias in de spread
    // staan; via de echte mapper werd die alsnog de Gezien-bevestiging. De
    // mock bewaart wat de handler aanlevert, dus de alias mag er niet in zitten.
    const eigen = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    const nieuw = { id: 's-alias', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-07-01T10:00:00Z', swapType: 'overname', target_seen_at: '2020-01-01T00:00:00Z' };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...eigen, nieuw] });
    expect(res.status).toBe(200);
    const opgeslagen = mem.swaps.find((s: any) => s.id === 's-alias');
    expect(opgeslagen).toBeTruthy();
    expect(opgeslagen?.targetSeenAt ?? undefined).toBeUndefined();
    expect('target_seen_at' in opgeslagen).toBe(false);
  });

  it('GET /api/swaps geeft targetSeenAt terug', async () => {
    await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    const res = await api('GET', '/api/swaps', { token: 'tok-planner' });
    expect(res.json.find((s: any) => s.id === 's-app')?.targetSeenAt).toBeTruthy();
  });
});

describe('aanvraag bekeken door de collega (POST /api/swaps/:id/bekeken)', () => {
  const bekekenRegels = () => mem.activity.filter((a: any) => a.action === 'Dienstruil bekeken');
  beforeEach(() => {
    mem.users.push({ id: '5', name: 'Toon Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true });
    // Een technieker valt onder dezelfde toestel-gate als een chauffeur.
    mem.devices.push({ userId: '5', deviceToken: 'dev-ok', name: 'Windows-pc · browser', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    invalidateUsersCache();
    mem.swaps = [
      // A (3) vraagt B (4): nog onbeantwoord. Dienst sh-a uit de gedeelde
      // planning-fixture (chauffeur 3, 01/07, dienst 12), zodat goedkeuren kan.
      { id: 's-pend', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-10-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' },
      // Dezelfde twee, al geaccepteerd en al doorgevoerd.
      { id: 's-acc', shiftId: 'sh-b', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-10-01T09:00:00Z' },
      { id: 's-app', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-10-01T10:00:00Z', decidedAt: '2026-10-02T08:00:00Z' },
      // De ruil van iemand anders: de technieker (5) vraagt B (4).
      { id: 's-tech', shiftId: 'sh-d', requesterId: '5', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-10-01T11:00:00Z' },
    ];
    mem.activity = [];
  });

  it('de aangezochte collega + pending = één logregel op de ruil, met zijn rol', async () => {
    const res = await api('POST', '/api/swaps/s-pend/bekeken', { token: 'tok-b' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, nieuw: true });
    expect(bekekenRegels()).toHaveLength(1);
    expect(bekekenRegels()[0]).toMatchObject({ domain: 'swaps', entityType: 'swap', entityId: 's-pend', actorName: 'Chauffeur B', actorRole: 'chauffeur' });
    // dd/mm/jjjj in de logtekst, geen rauwe ISO-datum.
    expect(bekekenRegels()[0].message).toBe('Chauffeur B bekeek de aanvraag voor dienst 12 op 01/07/2026.');
    // De lezing is op de aanroeper gescoped, niet de hele tabel.
    expect(mem.swapFilters).toContainEqual({ betrokkenUserId: '4' });
  });

  it('idempotent: een tweede aanroep (ander toestel, nieuwe sessie) schrijft geen tweede regel', async () => {
    await api('POST', '/api/swaps/s-pend/bekeken', { token: 'tok-b' });
    const opnieuw = await api('POST', '/api/swaps/s-pend/bekeken', { token: 'tok-b' });
    expect(opnieuw.status).toBe(200);
    expect(opnieuw.json).toEqual({ success: true, nieuw: false });
    expect(bekekenRegels()).toHaveLength(1);
  });

  it('aanvrager, derde en staf worden geweigerd (403) zonder schrijfactie', async () => {
    for (const token of ['tok-a', 'tok-tech', 'tok-planner', 'tok-admin']) {
      const res = await api('POST', '/api/swaps/s-pend/bekeken', { token });
      expect(res.status, token).toBe(403);
    }
    // Ook een onbestaande ruil: zelfde antwoord, dus geen lek over wat bestaat.
    expect((await api('POST', '/api/swaps/bestaat-niet/bekeken', { token: 'tok-b' })).status).toBe(403);
    expect(mem.activity).toEqual([]);
  });

  it('niet-pending wordt geweigerd (409) zonder schrijfactie', async () => {
    for (const id of ['s-acc', 's-app']) {
      const res = await api('POST', `/api/swaps/${id}/bekeken`, { token: 'tok-b' });
      expect(res.status, id).toBe(409);
    }
    expect(mem.activity).toEqual([]);
  });

  it('onderhoudsmodus met schrijfblok: 503, geen logregel', async () => {
    mem.appSettings.onderhoud = { actief: true, tekst: 'Even geduld.', schrijfblok: true };
    invalidateOnderhoudCache();
    const res = await api('POST', '/api/swaps/s-pend/bekeken', { token: 'tok-b' });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe('onderhoud');
    expect(mem.activity).toEqual([]);
  });

  it('het verloop draagt de stap naar de aanvrager en naar staf, en alleen bij díe ruil', async () => {
    await api('POST', '/api/swaps/s-pend/bekeken', { token: 'tok-b' });
    const aanvrager = await api('GET', '/api/swaps', { token: 'tok-a' });
    const stap = aanvrager.json.find((s: any) => s.id === 's-pend').verloop.find((st: any) => st.soort === 'bekeken');
    expect(stap).toEqual({ soort: 'bekeken', op: expect.any(String), door: 'collega' });
    // Privacy: een chauffeur ziet alleen zijn eigen ruilen. De technieker zit
    // niet in s-pend en krijgt die ruil, met haar verloop, dus niet te zien.
    const derde = await api('GET', '/api/swaps', { token: 'tok-tech' });
    expect(derde.json.map((s: any) => s.id)).toEqual(['s-tech']);
    expect(JSON.stringify(derde.json)).not.toContain('bekeken');
    const staf = await api('GET', '/api/swaps', { token: 'tok-planner' });
    expect(staf.json.find((s: any) => s.id === 's-pend').verloop.map((st: any) => st.soort)).toContain('bekeken');
    expect(staf.json.find((s: any) => s.id === 's-tech').verloop).toEqual([]);
  });

  it('raakt de ruil zelf niet: geen decidedAt, geen targetSeenAt, status blijft pending', async () => {
    const voor = JSON.stringify(mem.swaps);
    await api('POST', '/api/swaps/s-pend/bekeken', { token: 'tok-b' });
    expect(JSON.stringify(mem.swaps)).toBe(voor);
  });

  it('een admin keurt daarna nog altijd rechtstreeks goed, zonder het antwoord af te wachten', async () => {
    await api('POST', '/api/swaps/s-pend/bekeken', { token: 'tok-b' });
    const res = await api('PATCH', '/api/swaps/s-pend', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'pending' } });
    expect(res.status).toBe(200);
    expect(res.json.swap.status).toBe('approved');
    expect(res.json.swap.verloop.map((st: any) => st.soort)).toEqual(['bekeken', 'goedgekeurd']);
  });

  it('geen ruis in het auditspoor van Activiteit; de back-up bewaart de regel wel', async () => {
    const nu = new Date().toISOString();
    mem.activity = [
      { id: 'act-bekeken', createdAt: nu, actorName: 'Chauffeur B', actorRole: 'chauffeur', category: 'swaps', action: 'Dienstruil bekeken', details: '', entityType: 'swap', entityId: 's-pend' },
      { id: 'act-akkoord', createdAt: nu, actorName: 'Chauffeur B', actorRole: 'chauffeur', category: 'swaps', action: 'Dienstruil geaccepteerd', details: '', entityType: 'swap', entityId: 's-acc' },
    ];
    const scherm = await api('GET', '/api/activity', { token: 'tok-admin' });
    expect(scherm.json.map((a: any) => a.id)).toEqual(['act-akkoord']);
    const backup = await api('GET', '/api/backup', { token: 'tok-admin' });
    expect(backup.status).toBe(200);
    expect(JSON.stringify(backup.json)).toContain('act-bekeken');
  });

  it('telt niet mee als uitgevoerde wissel (weekoverzicht en weekrapport)', async () => {
    const { SWAP_UITVOERING_ACTIES } = await import('../../api/helpers');
    expect(SWAP_UITVOERING_ACTIES).not.toContain('Dienstruil bekeken');
  });
});

// Wissels uit de geschiedenis wissen (Jarno 09-09, om testwissels op te
// ruimen): staf laat de rij weg uit de payload. Afgewezen/ingetrokken mag,
// doorgevoerd niet (die zit in de heropbouw-replay).
describe('dienstruil: afgehandelde wissels wissen', () => {
  it('admin wist een afgewezen wissel van een ander, met auditspoor', async () => {
    mem.swaps.push({ id: 's-test', requesterId: '4', shiftId: 'sh-x', targetDriverId: '3', status: 'rejected', createdAt: '2026-09-01T08:00:00Z' });
    invalidateUsersCache();
    const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.filter((s: any) => s.id !== 's-test') });
    expect(res.status).toBe(200);
    expect(mem.swaps.some((s: any) => s.id === 's-test')).toBe(false);
    expect(mem.activity.some((a: any) => a.action === 'Dienstruil verwijderd' && a.entityId === 's-test')).toBe(true);
  });

  it('een planner kan een doorgevoerde wissel niet wissen (403); een admin bewust wel', async () => {
    mem.swaps.push({ id: 's-klaar', requesterId: '4', shiftId: 'sh-y', targetDriverId: '3', status: 'completed', createdAt: '2026-09-01T08:00:00Z' });
    const planner = await api('POST', '/api/swaps', { token: 'tok-planner', body: mem.swaps.filter((s: any) => s.id !== 's-klaar') });
    expect(planner.status).toBe(403);
    expect(mem.swaps.some((s: any) => s.id === 's-klaar')).toBe(true);
    // De UI biedt dit ook een admin niet aan (de wisknop staat alleen bij
    // afgewezen/ingetrokken), maar de server laat het een admin toe.
    const admin = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.filter((s: any) => s.id !== 's-klaar') });
    expect(admin.status).toBe(200);
    expect(mem.swaps.some((s: any) => s.id === 's-klaar')).toBe(false);
  });

  it('een chauffeur die andermans afgewezen wissel weglaat, wist hem niet', async () => {
    mem.swaps.push({ id: 's-ander', requesterId: '4', shiftId: 'sh-z', targetDriverId: '2', status: 'rejected', createdAt: '2026-09-01T08:00:00Z' });
    // Chauffeur A stuurt alles waar hij zelf bij betrokken is ongewijzigd
    // door en laat de rij van B weg: die is voor hem geen intrekking.
    const eigen = mem.swaps.filter((s: any) => String(s.requesterId) === '3' || String(s.targetDriverId) === '3');
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigen });
    expect(res.status).toBe(200);
    expect(mem.swaps.some((s: any) => s.id === 's-ander')).toBe(true);
  });
});

// --- Rusttijd bij een dienstruil (shared/ruilRust.ts, 22-09) ---
describe('rusttijd bij een dienstruil (GET /api/swaps › rust)', () => {
  // Chauffeur 3 geeft zijn vroege dienst van 07/10 aan chauffeur 4, die de
  // avond ervoor laat rijdt: 23:50 → 05:30 = 5u40 rust.
  const zaai = (status = 'pending') => {
    mem.swaps = [{ id: 's-rust', shiftId: 'r-a', requesterId: '3', targetDriverId: '4', status, reason: '', createdAt: '2026-10-01T08:00:00Z', shiftDate: '2026-10-07', shiftLine: '2101', returnDate: '2026-10-09', returnCode: '2230' }];
    mem.planning = [
      { id: 'r-a', driverId: '3', date: '2026-10-07', line: '2101', startTime: '05:30', endTime: '13:45' },
      { id: 'r-b', driverId: '4', date: '2026-10-06', line: '2240', startTime: '15:40', endTime: '23:50' },
      { id: 'r-c', driverId: '4', date: '2026-10-09', line: '2230', startTime: '15:00', endTime: '23:00' },
      { id: 'r-d', driverId: '3', date: '2026-10-10', line: '2105', startTime: '10:00', endTime: '18:00' },
    ];
  };

  it('de planner ziet de rust van beide chauffeurs, met de waarschuwing waar ze te kort is', async () => {
    zaai();
    const res = await api('GET', '/api/swaps', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const rust = res.json.find((s: any) => s.id === 's-rust').rust;
    expect(rust).toEqual([
      { wie: 'collega', datum: '2026-10-07', dienst: '2101', rustVoor: 340, rustNa: null, teKort: true },
      // 23:00 → 10:00 = 11u
      { wie: 'aanvrager', datum: '2026-10-09', dienst: '2230', rustVoor: null, rustNa: 660, teKort: false },
    ]);
  });

  it('een chauffeur ziet alleen de regel over zichzelf, niet de uren van zijn collega', async () => {
    zaai();
    const vanB = (await api('GET', '/api/swaps', { token: 'tok-b' })).json.find((s: any) => s.id === 's-rust');
    expect(vanB.rust.map((r: any) => r.wie)).toEqual(['collega']);
    const vanA = (await api('GET', '/api/swaps', { token: 'tok-a' })).json.find((s: any) => s.id === 's-rust');
    expect(vanA.rust.map((r: any) => r.wie)).toEqual(['aanvrager']);
  });

  it('een afgesloten ruil wordt niet meer nagerekend', async () => {
    zaai('approved');
    const res = await api('GET', '/api/swaps', { token: 'tok-planner' });
    expect(res.json.find((s: any) => s.id === 's-rust').rust).toBeUndefined();
  });

  it('`rust` is nooit invoer: een client die het terugstuurt verandert er niets mee', async () => {
    zaai();
    const lijst = (await api('GET', '/api/swaps', { token: 'tok-planner' })).json;
    const vervalst = lijst.map((s: any) => ({ ...s, rust: [{ wie: 'collega', datum: '2026-10-07', dienst: '2101', rustVoor: 999, rustNa: 999, teKort: false }] }));
    const post = await api('POST', '/api/swaps', { token: 'tok-planner', body: vervalst });
    expect(post.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-rust').rust).toBeUndefined();
    const opnieuw = (await api('GET', '/api/swaps', { token: 'tok-planner' })).json.find((s: any) => s.id === 's-rust');
    expect(opnieuw.rust[0].rustVoor).toBe(340);
  });
});
