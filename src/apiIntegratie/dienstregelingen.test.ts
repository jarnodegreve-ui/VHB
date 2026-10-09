// @vitest-environment node
import { api, mem } from './harnas';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Dienstregelingversies (fase 1, 08-10): versies met een geldig-vanaf-datum,
 * het dienstoverzicht per versie (/api/services?versie=), en de planning die
 * per dag de juiste versie volgt. De testklok staat op 2026-06-15; de
 * seed heeft één versie (dr-sep, vanaf 2026-01-01) die vandaag geldt.
 */
const lijst = async (token = 'tok-planner') => (await api('GET', '/api/dienstregelingen', { token })).json;
const maak = (body: Record<string, unknown>, token = 'tok-planner') => api('POST', '/api/dienstregelingen', { token, body });

describe('dienstregelingversies: lezen en aanmaken', () => {
  it('is voor planner en admin; een chauffeur krijgt 403', async () => {
    expect((await api('GET', '/api/dienstregelingen', { token: 'tok-a' })).status).toBe(403);
    const res = await api('GET', '/api/dienstregelingen', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.vandaag).toBe('2026-06-15');
    expect(res.json.versies).toEqual([expect.objectContaining({ id: 'dr-sep', status: 'huidig', aantalDiensten: 6, geldigTot: null })]);
  });

  it('maakt een toekomstige versie als kopie van de versie die de dag ervoor geldt (verse ids, zelfde diensten)', async () => {
    const res = await maak({ geldigVanaf: '2026-07-05', naam: 'Zomer' });
    expect(res.status).toBe(201);
    const nieuw = res.json;
    expect(nieuw).toMatchObject({ naam: 'Zomer', geldigVanaf: '2026-07-05' });
    const kopie = (await api('GET', `/api/services?versie=${nieuw.id}`, { token: 'tok-planner' })).json;
    expect(kopie.map((s: any) => s.serviceNumber)).toEqual(['10', '11', '12', '13', '14', '15']);
    expect(kopie.every((s: any) => s.dienstregelingId === nieuw.id)).toBe(true);
    expect(new Set(kopie.map((s: any) => s.id)).size).toBe(6);
    // De huidige lijst (zonder ?versie=) is onaangeroerd.
    const huidig = (await api('GET', '/api/services', { token: 'tok-planner' })).json;
    expect(huidig.map((s: any) => s.id)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    const overzicht = await lijst();
    expect(overzicht.versies.map((v: any) => [v.id, v.status, v.geldigTot])).toEqual([['dr-sep', 'huidig', '2026-07-04'], [nieuw.id, 'toekomstig', null]]);
    expect(mem.activity.some((a: any) => /Dienstregelingversie aangemaakt/.test(a.title ?? a.action ?? ''))).toBe(true);
  });

  it('weigert een datum in het verleden (400 met veldfout), een dubbele datum (409) en een onbekende bron (404)', async () => {
    const verleden = await maak({ geldigVanaf: '2026-06-14' });
    expect(verleden.status).toBe(400);
    expect(verleden.json.veldfouten.geldigVanaf).toMatch(/verleden/);
    expect((await maak({ geldigVanaf: '2026-08-01' })).status).toBe(201);
    expect((await maak({ geldigVanaf: '2026-08-01' })).status).toBe(409);
    expect((await maak({ geldigVanaf: '2026-09-01', kopieVan: 'bestaat-niet' })).status).toBe(404);
    expect((await maak({ geldigVanaf: 'gisteren' })).status).toBe(400);
  });

  it('een onbekende versie op /api/services geeft 404', async () => {
    expect((await api('GET', '/api/services?versie=nope', { token: 'tok-planner' })).status).toBe(404);
  });

  it('aanmaken meldt de actieve chauffeurs vanaf welke dag de nieuwe dienstregeling geldt, tenzij melden uitstaat (09-10)', async () => {
    mem.users = mem.users.map((u: any) => (u.id === '4' ? { ...u, isActive: false } : u));
    mem.pushesSent = [];
    expect((await maak({ geldigVanaf: '2026-11-14', naam: 'November' })).status).toBe(201);
    const push = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe dienstregeling');
    expect(push?.userIds).toEqual(['3']);
    expect(push?.payload).toMatchObject({ soort: 'planning', url: '/?view=dienstoverzicht', body: 'Vanaf 14/11/2026 geldt een nieuwe dienstregeling (November). Bekijk het dienstoverzicht.' });

    mem.pushesSent = [];
    expect((await maak({ geldigVanaf: '2027-01-01', melden: false })).status).toBe(201);
    expect(mem.pushesSent.filter((p) => p.payload.title === 'Nieuwe dienstregeling')).toEqual([]);
  });
});

describe('dienstregelingversies: de planning volgt per dag de juiste versie', () => {
  // Zelfde uitgangspunt als de tests van de automatische heropbouw: een
  // planning die klopt met matrix en dienstoverzicht. 01/07: A rijdt 12
  // (08:00-16:00), B rijdt 14. 08/07: A rijdt 12, B heeft bv.
  beforeEach(async () => {
    mem.planningCodes = [
      { code: 'bv', category: 'absence', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false },
    ];
    mem.swaps = [];
    expect((await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-admin' })).status).toBe(200);
    mem.activity = [];
    mem.pushesSent = [];
    mem.appSettings = {};
  });

  it('een wijziging in een toekomstige versie raakt alleen de dagen vanaf haar datum', async () => {
    const nieuw = (await maak({ geldigVanaf: '2026-07-05' })).json;
    const kopie = (await api('GET', `/api/services?versie=${nieuw.id}`, { token: 'tok-planner' })).json;
    const gewijzigd = kopie.map((s: any) => (s.serviceNumber === '12' ? { ...s, startTime: '09:00', endTime: '17:00', loopnr: '4700' } : s));
    const vers = await fetch(`${(await import('./harnas')).baseUrl}/api/services?versie=${nieuw.id}`, { headers: { Authorization: 'Bearer tok-planner', 'X-Device-Token': 'dev-ok' } });
    const revisie = vers.headers.get('x-collection-revision')!;
    const res = await api('POST', `/api/services?versie=${nieuw.id}`, { token: 'tok-planner', body: gewijzigd, headers: { 'x-collection-revision': revisie } });
    expect(res.status).toBe(200);
    expect(res.json.planning.status).toBe('bijgewerkt');
    const rij = (datum: string) => mem.planning.find((r: any) => r.date === datum && String(r.driverId) === '3');
    expect(rij('2026-07-01')).toMatchObject({ startTime: '08:00', endTime: '16:00' });
    expect(rij('2026-07-08')).toMatchObject({ startTime: '09:00', endTime: '17:00', loopnr: '4700' });
    // De huidige versie is niet veranderd.
    expect(mem.services.find((s: any) => s.id === 'd3')).toMatchObject({ startTime: '08:00' });
  });

  it('een toekomstige versie verwijderen (admin) laat haar dagen terugvallen op de vorige versie', async () => {
    const nieuw = (await maak({ geldigVanaf: '2026-07-05' })).json;
    const kopie = (await api('GET', `/api/services?versie=${nieuw.id}`, { token: 'tok-planner' })).json;
    const vers = await fetch(`${(await import('./harnas')).baseUrl}/api/services?versie=${nieuw.id}`, { headers: { Authorization: 'Bearer tok-planner', 'X-Device-Token': 'dev-ok' } });
    await api('POST', `/api/services?versie=${nieuw.id}`, {
      token: 'tok-planner',
      body: kopie.map((s: any) => (s.serviceNumber === '12' ? { ...s, startTime: '09:00', endTime: '17:00' } : s)),
      headers: { 'x-collection-revision': vers.headers.get('x-collection-revision')! },
    });
    expect(mem.planning.find((r: any) => r.date === '2026-07-08')).toMatchObject({ startTime: '09:00' });

    expect((await api('DELETE', `/api/dienstregelingen/${nieuw.id}`, { token: 'tok-planner' })).status).toBe(403);
    const weg = await api('DELETE', `/api/dienstregelingen/${nieuw.id}`, { token: 'tok-admin' });
    expect(weg.status).toBe(200);
    expect(weg.json.planning.status).toBe('bijgewerkt');
    expect(mem.services.some((s: any) => s.dienstregelingId === nieuw.id)).toBe(false);
    expect(mem.planning.find((r: any) => r.date === '2026-07-08')).toMatchObject({ startTime: '08:00', endTime: '16:00' });
  });

  it('de huidige versie kan niet weg en haar datum niet wijzigen; naam en opmerking wel', async () => {
    expect((await api('DELETE', '/api/dienstregelingen/dr-sep', { token: 'tok-admin' })).status).toBe(409);
    expect((await api('PATCH', '/api/dienstregelingen/dr-sep', { token: 'tok-planner', body: { geldigVanaf: '2026-08-01' } })).status).toBe(409);
    const res = await api('PATCH', '/api/dienstregelingen/dr-sep', { token: 'tok-planner', body: { naam: 'September 2026', opmerking: 'basis' } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ naam: 'September 2026', opmerking: 'basis', geldigVanaf: '2026-01-01', planning: { status: 'niet-nodig' } });
    expect((await api('PATCH', '/api/dienstregelingen/nope', { token: 'tok-planner', body: { naam: 'x' } })).status).toBe(404);
  });

  it('de datum van een toekomstige versie verschuiven bouwt de planning mee', async () => {
    const nieuw = (await maak({ geldigVanaf: '2026-07-20' })).json;
    const kopie = (await api('GET', `/api/services?versie=${nieuw.id}`, { token: 'tok-planner' })).json;
    const vers = await fetch(`${(await import('./harnas')).baseUrl}/api/services?versie=${nieuw.id}`, { headers: { Authorization: 'Bearer tok-planner', 'X-Device-Token': 'dev-ok' } });
    await api('POST', `/api/services?versie=${nieuw.id}`, {
      token: 'tok-planner',
      body: kopie.map((s: any) => (s.serviceNumber === '12' ? { ...s, startTime: '09:00', endTime: '17:00' } : s)),
      headers: { 'x-collection-revision': vers.headers.get('x-collection-revision')! },
    });
    // Nog niets geraakt: 07-08 ligt vóór 07-20.
    expect(mem.planning.find((r: any) => r.date === '2026-07-08')).toMatchObject({ startTime: '08:00' });
    const res = await api('PATCH', `/api/dienstregelingen/${nieuw.id}`, { token: 'tok-planner', body: { geldigVanaf: '2026-07-05' } });
    expect(res.status).toBe(200);
    expect(res.json.planning.status).toBe('bijgewerkt');
    expect(mem.planning.find((r: any) => r.date === '2026-07-08')).toMatchObject({ startTime: '09:00' });
    expect((await api('PATCH', `/api/dienstregelingen/${nieuw.id}`, { token: 'tok-planner', body: { geldigVanaf: '2026-06-01' } })).status).toBe(400);
  });
});

describe('dienstregelingversies: back-up en herstel', () => {
  it('een restore zet de versies én alle diensten (met hun versie) terug', async () => {
    const res = await api('POST', '/api/restore', {
      token: 'tok-admin',
      body: {
        exportedAt: '2026-06-13T02:00:00Z', version: 2,
        collections: {
          users: mem.users,
          dienstregelingen: [{ id: 'dr-sep', naam: null, geldigVanaf: '2026-01-01' }, { id: 'dr-x', naam: 'X', geldigVanaf: '2026-09-01' }],
          services: [{ id: 'd1', serviceNumber: '10', startTime: '06:00', endTime: '14:00', dienstregelingId: 'dr-sep' }, { id: 'x1', serviceNumber: '10', startTime: '07:00', endTime: '15:00', dienstregelingId: 'dr-x' }],
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.summary).toMatchObject({ dienstregelingen: 2, services: 2 });
    expect((await lijst()).versies.map((v: any) => [v.id, v.aantalDiensten])).toEqual([['dr-sep', 1], ['dr-x', 1]]);
  });
});
