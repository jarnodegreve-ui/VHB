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

  it('de verloflimieten dragen per dag het maximum uit de kalender, de rest volgt de instellingen', async () => {
    await api('PUT', '/api/dagtypekalender', { token: 'tok-admin', body: { dagen } });
    const res = await api('GET', '/api/verlof/limieten', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.perDag).toEqual({ '2026-10-13': 2, '2026-10-14': 7, '2026-10-18': 0 });
    expect(res.json.standaard).toBe(2);
  });
});
