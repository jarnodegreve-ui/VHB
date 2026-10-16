// @vitest-environment node
import { api, mem } from './harnas';
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Dagtypekalender (11-10): lezen voor de staf, schrijven voor de admin; de
 * kalender wint nooit van de code in de planningsmatrix (een verschil is een
 * opmerking), en het verlofmaximum per dag reist mee in de verloflimieten.
 */
const dagen = [
  { datum: '2026-10-13', typedag: '22', maxVerlof: 2 },
  { datum: '2026-10-14', typedag: '33', maxVerlof: 7 },
  { datum: '2026-10-18', typedag: '28', maxVerlof: 0 },
];

describe('dagtypekalender', () => {
  beforeEach(() => {
    mem.dagtypeKalender = [];
    mem.planningMatrix = [
      { id: 'm1', source_date: '2026-10-13', day_type: '', assignments: { 'Chauffeur A': 'vrij' }, raw_row: '' },
      // De matrix zegt schooldag waar de kalender vakantie zegt: de matrix gaat voor.
      { id: 'm2', source_date: '2026-10-14', day_type: '23', assignments: { 'Chauffeur A': 'vrij' }, raw_row: '' },
    ];
    mem.coverageExpectations = {};
    mem.services = [];
  });

  it('alleen de staf leest, alleen de admin schrijft', async () => {
    expect((await api('GET', '/api/dagtypekalender', { token: 'tok-a' })).status).toBe(403);
    expect((await api('PUT', '/api/dagtypekalender', { token: 'tok-planner', body: { dagen } })).status).toBe(403);
    const leeg = await api('GET', '/api/dagtypekalender', { token: 'tok-planner' });
    expect(leeg.status).toBe(200);
    expect(leeg.json).toEqual({ dagen: [], afwijkingen: [], samenvatting: { aantal: 0, eerste: null, laatste: null, perRegime: [] } });
  });

  it('de admin leest het CSV in; daarna toont de staf de dagen, de samenvatting en de afwijkingen met de matrix', async () => {
    const put = await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({ aantal: 3, nieuw: 3, gewijzigd: 0, samenvatting: { aantal: 3, eerste: '2026-10-13', laatste: '2026-10-18' } });
    expect(mem.activity.at(-1)).toMatchObject({ domain: 'planning', action: 'Dagtypekalender bijgewerkt' });

    const res = await api('GET', '/api/dagtypekalender?van=2026-10-01&tot=2026-10-31', { token: 'tok-planner' });
    expect(res.json.dagen.map((d: any) => `${d.datum} ${d.typedag} ${d.maxVerlof} ${d.bron}`)).toEqual(['2026-10-13 22 2 csv', '2026-10-14 33 7 csv', '2026-10-18 28 0 csv']);
    expect(res.json.afwijkingen).toEqual([{ datum: '2026-10-14', matrix: '23', kalender: '33' }]);
    expect(res.json.samenvatting.perRegime).toEqual([{ regime: 'school', aantal: 1 }, { regime: 'vakantie', aantal: 1 }, { regime: 'feestdag', aantal: 1 }]);

    // Opnieuw inlezen met één wijziging: gewijzigd telt, de rest blijft.
    const weer = await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen: [{ datum: '2026-10-14', typedag: '23', maxVerlof: 2 }] } });
    expect(weer.json).toMatchObject({ aantal: 1, nieuw: 0, gewijzigd: 1, samenvatting: { aantal: 3 } });
  });

  it('twee keer dezelfde datum in één bestand: de eerste telt, de databank krijgt één rij', async () => {
    const res = await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen: [{ datum: '2026-10-13', typedag: '22', maxVerlof: 2 }, { datum: '2026-10-13', typedag: '33', maxVerlof: 7 }] } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ aantal: 1, nieuw: 1 });
    expect(mem.dagtypeKalender.map((d: any) => `${d.datum} ${d.typedag}`)).toEqual(['2026-10-13 22']);
  });

  it('weigert onbekende codes en lege lijsten met een veldfout', async () => {
    expect((await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen: [{ datum: '2026-10-13', typedag: '99', maxVerlof: 2 }] } })).status).toBe(400);
    expect((await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen: [] } })).status).toBe(400);
  });

  it('het maandbord neemt het dagtype uit de kalender voor een dag zonder matrixcode, en de matrixcode waar die er is', async () => {
    await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    const bord = await api('GET', '/api/month-planning?month=2026-10', { token: 'tok-planner' });
    expect(bord.status).toBe(200);
    expect(bord.json.dagtypes['2026-10-13']).toMatchObject({ code: '22', periode: 'schooldag' });
    expect(bord.json.dagtypes['2026-10-14']).toMatchObject({ code: '23' });
  });

  it('de admin past één dag met de hand aan: bron hand, een logregel met wat veranderde, en de staf ziet hem zo terug', async () => {
    await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    expect((await api('PATCH', '/api/dagtypekalender/2026-10-13', { token: 'tok-planner', body: { typedag: '33', maxVerlof: 7 } })).status).toBe(403);
    expect((await api('PATCH', '/api/dagtypekalender/2026-02-30', { token: 'tok-admin', body: { typedag: '33', maxVerlof: 7 } })).status).toBe(400);
    expect((await api('PATCH', '/api/dagtypekalender/2026-10-13', { token: 'tok-admin', body: { typedag: '99', maxVerlof: 7 } })).status).toBe(400);

    const res = await api('PATCH', '/api/dagtypekalender/2026-10-13', { token: 'tok-admin', body: { typedag: '33', maxVerlof: null } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ datum: '2026-10-13', typedag: '33', maxVerlof: null, bron: 'hand' });
    expect(mem.activity.at(-1)).toMatchObject({ domain: 'planning', action: 'Dagtype aangepast' });
    expect(mem.activity.at(-1).message).toBe('13/10/2026: dagtype 22 → 33, max. verlof 2 → zoals de instellingen.');

    // Een dag die nog niet in de kalender stond komt erbij.
    const nieuw = await api('PATCH', '/api/dagtypekalender/2026-10-20', { token: 'tok-admin', body: { typedag: '22', maxVerlof: 3 } });
    expect(nieuw.status).toBe(200);
    expect(mem.activity.at(-1).message).toBe('20/10/2026 toegevoegd: dagtype 22, max. verlof 3.');

    const lijst = await api('GET', '/api/dagtypekalender?van=2026-10-01&tot=2026-10-31', { token: 'tok-planner' });
    expect(lijst.json.dagen.map((d: any) => `${d.datum} ${d.typedag} ${d.maxVerlof} ${d.bron}`)).toEqual([
      '2026-10-13 33 null hand', '2026-10-14 33 7 csv', '2026-10-18 28 0 csv', '2026-10-20 22 3 hand',
    ]);
    // De verloflimiet van die dag valt terug op de instellingen (geen eigen maximum meer).
    const limieten = await api('GET', '/api/verlof/limieten', { token: 'tok-a' });
    expect(limieten.json.perDag).toEqual({ '2026-10-14': 7, '2026-10-18': 0, '2026-10-20': 3 });
  });

  it('GET /api/dagtypes geeft elke rol het dagtype per dag: matrixcode, dan kalender, dan dekking of weekdag', async () => {
    await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    const res = await api('GET', '/api/dagtypes?van=2026-10-12&tot=2026-10-18', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.van).toBe('2026-10-12');
    expect(res.json.tot).toBe('2026-10-18');
    // 12-10: geen matrixcode en niet in de kalender: de dekking (zonder instellingen haar standaardweek, maandag schooldag).
    expect(res.json.dagtypes['2026-10-12']).toEqual({ code: '21', label: 'Maandag schooldag', periode: 'schooldag', bron: 'dekking' });
    // 13-10: de kalender (de matrixrij heeft geen code).
    expect(res.json.dagtypes['2026-10-13']).toEqual({ code: '22', label: 'Dinsdag schooldag', periode: 'schooldag', bron: 'kalender' });
    // 14-10: de matrixcode wint van de kalender.
    expect(res.json.dagtypes['2026-10-14']).toMatchObject({ code: '23', bron: 'excel' });
    // 18-10: feestdag uit de kalender; de periode is "feestdag".
    expect(res.json.dagtypes['2026-10-18']).toEqual({ code: '28', label: 'Feestdag', periode: 'feestdag', bron: 'kalender' });
    expect(Object.keys(res.json.dagtypes)).toHaveLength(7);

    // Zonder parameters: vandaag tot en met zeven dagen verder. Te groot of omgekeerd: 400.
    const standaard = await api('GET', '/api/dagtypes', { token: 'tok-a' });
    expect(standaard.status).toBe(200);
    expect(Object.keys(standaard.json.dagtypes)).toHaveLength(8);
    expect((await api('GET', '/api/dagtypes?van=2026-01-01&tot=2026-06-30', { token: 'tok-a' })).status).toBe(400);
    expect((await api('GET', '/api/dagtypes?van=2026-10-18&tot=2026-10-12', { token: 'tok-a' })).status).toBe(400);
  });

  it('de verloflimieten dragen per dag het maximum uit de kalender, de rest volgt de instellingen', async () => {
    await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    const res = await api('GET', '/api/verlof/limieten', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.perDag).toEqual({ '2026-10-13': 2, '2026-10-14': 7, '2026-10-18': 0 });
    expect(res.json.standaard).toBe(2);
  });

  it('het rapport Verlofbezetting telt met hetzelfde maximum per dag als de verlofkalender (16-10)', async () => {
    await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    mem.leave = [
      { id: 'l-k1', userId: '3', startDate: '2026-10-13', endDate: '2026-10-14', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-09-01T08:00:00Z', decidedAt: '2026-09-02T08:00:00Z' },
    ];
    const periode = 'van=2026-10-12&tot=2026-10-18';
    const rapport = await api('GET', `/api/rapporten/verlofbezetting?${periode}`, { token: 'tok-planner' });
    expect(rapport.status).toBe(200);
    // 14-10 heeft een eigen maximum (7) en 18-10 is volzet (0); de andere dagen volgen de standaard (2).
    // Tot 16-10 las het rapport alleen de instellingen en toonde het daar 2.
    expect(rapport.json.rijen.map((r: any) => [r.datum, r.afwezig, r.limiet])).toEqual([
      ['2026-10-12', 0, 2], ['2026-10-13', 1, 2], ['2026-10-14', 1, 7], ['2026-10-15', 0, 2],
      ['2026-10-16', 0, 2], ['2026-10-17', 0, 2], ['2026-10-18', 0, 0],
    ]);
    const kalender = await api('GET', `/api/leave/bezetting?${periode}`, { token: 'tok-a' });
    expect(kalender.json.dagen).toEqual(rapport.json.rijen.map((r: any) => ({ datum: r.datum, aantal: r.afwezig, limiet: r.limiet })));
  });

  it('na het opslaan van de verloflimieten draagt het antwoord de kalendermaxima nog, zoals GET', async () => {
    await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    const put = await api('PUT', '/api/verlof/limieten', { token: 'tok-admin', body: { standaard: 3, periodes: [] } });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({ standaard: 3, perDag: { '2026-10-13': 2, '2026-10-14': 7, '2026-10-18': 0 } });
    expect(put.json).toEqual((await api('GET', '/api/verlof/limieten', { token: 'tok-a' })).json);
    // In de instellingen zelf komt het maximum per dag niet: dat blijft de kalender.
    expect(mem.appSettings.verlof_limieten).toEqual({ standaard: 3, periodes: [] });
  });
});
