// @vitest-environment node
/**
 * De grens van de planning (Jarno 22-11): de laatste matrixdag met minstens
 * één dienst. Drie lagen:
 *  1. de beslissing (api/_lib/planningGrens.ts) op een neplezer: snelle weg,
 *     staart in stukken, terugval met waarschuwing, fouten;
 *  2. geen tweede indeling: dezelfde uitkomst als het bord (berekenCelWaarheid)
 *     op de planning die de échte opbouw maakt, en dezelfde code-diensttoets
 *     als api/_lib/codeDienst.ts;
 *  3. de opslagfuncties op een nepclient: welke lezingen vertrekken er, met
 *     welke kolommen en grenzen. Zelfde nepclient als storageVerwijderStukken.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Stap = [string, ...unknown[]];
const nep = vi.hoisted(() => ({
  lezingen: [] as Array<Array<[string, ...unknown[]]>>,
  antwoord: null as null | ((query: Array<[string, ...unknown[]]>) => unknown),
}));

vi.mock('../api/_lib/db.js', () => {
  const keten = (query: Stap[]): any => new Proxy({}, {
    get: (_t, naam: string) => {
      if (naam === 'then') return (ok: (v: unknown) => void) => ok(nep.antwoord?.(query) ?? { data: [], error: null, count: 0 });
      return (...args: unknown[]) => { query.push([naam, ...args]); return keten(query); };
    },
  });
  return { db: { from: (tabel: string) => { const q: Stap[] = [['from', tabel]]; nep.lezingen.push(q); return keten(q); } }, supabase: null, supabaseAdmin: null };
});

const { getPlanningHorizon, getPlanningMatrixGrenzen, savePlanningCodesData, bouwPlanningUitMatrix } = await import('../api/_lib/storage.js');
const { bepaalPlanningGrens, dienstCodeTokens, draagtCodeDienst, horizonUitGrens, STAART_STUK, STAART_MAX_STUKKEN } = await import('../api/_lib/planningGrens.js');
const { maakCodeDienstToets } = await import('../api/_lib/codeDienst.js');
const { berekenCelWaarheid } = await import('../api/_lib/celWaarheid.js');

type Rij = { source_date: string; assignments: Record<string, string> };
const rij = (dag: string, assignments: Record<string, string> = {}): Rij => ({ source_date: dag, assignments });
const dagNa = (basis: string, n: number) => {
  const [j, m, d] = basis.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
};
const CODES = [
  { code: 'bv', category: 'leave' }, { code: 'ziek', category: 'absence' }, { code: 'vrij', category: 'absence' },
  { code: 'tk', category: 'absence' }, { code: 'ta', category: 'absence' }, { code: 'opl', category: 'training' },
  { code: 'eek1', category: 'service' }, { code: 'bur', category: 'service' }, { code: 'raar', category: 'unknown' },
];

/** Neplezer op een matrix en een laatste planningdag, die telt wat er gelezen wordt. */
const lezerOp = (matrix: Rij[], planning: unknown, over: Record<string, unknown> = {}) => {
  const gelezen = { staart: [] as Array<[string | null, number, number]>, codes: 0, waarschuwingen: [] as string[] };
  const lezer = {
    matrixLaatste: async () => matrix.map((r) => r.source_date).sort().pop() ?? null,
    planningLaatste: async () => planning,
    staart: async (na: string | null, vanaf: number, aantal: number) => {
      gelezen.staart.push([na, vanaf, aantal]);
      return matrix.filter((r) => !na || r.source_date > na).sort((a, b) => b.source_date.localeCompare(a.source_date)).slice(vanaf, vanaf + aantal);
    },
    dienstCodes: async () => { gelezen.codes += 1; return dienstCodeTokens(CODES); },
    waarschuw: (tekst: string) => { gelezen.waarschuwingen.push(tekst); },
    ...over,
  };
  return { lezer: lezer as Parameters<typeof bepaalPlanningGrens>[0], gelezen };
};

describe('bepaalPlanningGrens', () => {
  it('gewone toestand: op de laatste matrixdag staat een dienst, geen staart en geen codes gelezen', async () => {
    const { lezer, gelezen } = lezerOp([rij('2027-01-02', { A: '2101' }), rij('2027-01-03', { A: '2101' })], '2027-01-03');
    expect(await bepaalPlanningGrens(lezer)).toEqual({ matrix: '2027-01-03', planning: '2027-01-03', laatste: '2027-01-03' });
    expect(gelezen).toEqual({ staart: [], codes: 0, waarschuwingen: [] });
  });

  it('planning tot 03/01, lege matrixrijen tot 31/01: de grens is 03/01, in één staartlezing', async () => {
    const leeg = Array.from({ length: 28 }, (_, i) => rij(dagNa('2027-01-03', i + 1), i % 2 ? {} : { A: '', B: '  ' }));
    const { lezer, gelezen } = lezerOp([rij('2027-01-03', { A: '2101' }), ...leeg], '2027-01-03');
    expect(await bepaalPlanningGrens(lezer)).toEqual({ matrix: '2027-01-31', planning: '2027-01-03', laatste: '2027-01-03' });
    expect(gelezen.staart).toEqual([['2027-01-03', 0, STAART_STUK]]);
    expect(gelezen.waarschuwingen).toEqual([]);
  });

  it('alleen afwezigheid, leestekens of onbekende rommel in de staart: de grens blijft de laatste planningdag', async () => {
    const { lezer } = lezerOp([
      rij('2027-01-03', { A: '2101' }), rij('2027-01-04', { A: 'BV', B: 'Ziek' }), rij('2027-01-05', { A: 'vrij', B: 'tk', C: 'TA' }),
      rij('2027-01-06', { A: 'OPL' }), rij('2027-01-07', { A: '-', B: '?', C: '...' }), rij('2027-01-08', { A: 'raar', B: 'xyz', C: '9999' }),
    ], '2027-01-03');
    expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-03');
  });

  it('een code-dienst in de staart is de grens, hoe hij ook geschreven staat; de laatste telt', async () => {
    const { lezer } = lezerOp([
      rij('2027-01-03', { A: '2101' }), rij('2027-01-05', { A: 'bv', B: ' EEK1 ' }), rij('2027-01-09', { A: 'Bur' }), rij('2027-01-10', { A: 'bv' }),
    ], '2027-01-03');
    expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-09');
  });

  it('de staart leest door in stukken en stopt bij de eerste code-dienst', async () => {
    const staart = Array.from({ length: 50 }, (_, i) => rij(dagNa('2027-01-03', i + 1), i === 4 ? { A: 'eek1' } : { A: 'bv' }));
    const { lezer, gelezen } = lezerOp([rij('2027-01-03', { A: '2101' }), ...staart], '2027-01-03');
    // De code-dienst staat op dag 5 van 50: pas in het tweede stuk (de laatste dag komt eerst).
    expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-08');
    expect(gelezen.staart).toEqual([['2027-01-03', 0, STAART_STUK], ['2027-01-03', STAART_STUK, STAART_STUK]]);
    expect(gelezen.codes).toBe(1);
  });

  it('een staart van precies één stuk vraagt een tweede lezing om zeker te zijn dat er niets meer komt', async () => {
    const staart = Array.from({ length: STAART_STUK }, (_, i) => rij(dagNa('2027-01-03', i + 1)));
    const { lezer, gelezen } = lezerOp([rij('2027-01-03', { A: '2101' }), ...staart], '2027-01-03');
    expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-03');
    expect(gelezen.staart).toHaveLength(2);
  });

  it('een staart langer dan het maximum: de grens van vroeger, met een waarschuwing', async () => {
    const max = STAART_STUK * STAART_MAX_STUKKEN;
    const staart = Array.from({ length: max + 1 }, (_, i) => rij(dagNa('2027-01-03', i + 1)));
    const { lezer, gelezen } = lezerOp([rij('2027-01-03', { A: '2101' }), ...staart], '2027-01-03');
    expect((await bepaalPlanningGrens(lezer)).laatste).toBe(dagNa('2027-01-03', max + 1));
    expect(gelezen.staart).toHaveLength(STAART_MAX_STUKKEN);
    expect(gelezen.waarschuwingen).toHaveLength(1);
    expect(gelezen.waarschuwingen[0]).toContain(`meer dan ${max} matrixdagen`);
  });

  it('geen matrix: geen grens, de horizon is de laatste opgebouwde dienst (of niets)', async () => {
    const met = await bepaalPlanningGrens(lezerOp([], '2026-12-20').lezer);
    expect(met).toEqual({ matrix: null, planning: '2026-12-20', laatste: null });
    expect(horizonUitGrens(met)).toBe('2026-12-20');
    const zonder = await bepaalPlanningGrens(lezerOp([], null).lezer);
    expect(zonder).toEqual({ matrix: null, planning: null, laatste: null });
    expect(horizonUitGrens(zonder)).toBeNull();
  });

  it('matrix zonder opgebouwde planning: alleen een code-dienst kan de grens zijn, anders geen grens', async () => {
    const met = lezerOp([rij('2027-01-04', { A: 'bv' }), rij('2027-01-05', { A: 'eek1' }), rij('2027-01-06', {})], null);
    expect(await bepaalPlanningGrens(met.lezer)).toEqual({ matrix: '2027-01-06', planning: null, laatste: '2027-01-05' });
    expect(met.gelezen.staart).toEqual([[null, 0, STAART_STUK]]);
    const zonder = await bepaalPlanningGrens(lezerOp([rij('2027-01-04', { A: 'bv' }), rij('2027-01-05', {})], null).lezer);
    expect(zonder.laatste).toBeNull();
    expect(horizonUitGrens(zonder)).toBeNull();
  });

  it('planning die voorbij de matrix loopt: de grens blijft de laatste matrixrij', async () => {
    const { lezer, gelezen } = lezerOp([rij('2027-01-03', { A: '2101' })], '2027-02-01');
    expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-03');
    expect(gelezen.staart).toEqual([]);
  });

  it('een planningdatum die geen dag is: niet op filteren, de grens van vroeger met een waarschuwing', async () => {
    for (const rommel of ['2027-02-30', 'morgen', '03/01/2027']) {
      const { lezer, gelezen } = lezerOp([rij('2027-01-03', { A: '2101' }), rij('2027-01-04')], rommel);
      expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-04');
      expect(gelezen.staart).toEqual([]);
      expect(gelezen.waarschuwingen).toHaveLength(1);
    }
  });

  it('een tijdstempel als datum telt als zijn dag', async () => {
    const { lezer } = lezerOp([rij('2027-01-03', { A: '2101' }), rij('2027-01-04')], '2027-01-03T00:00:00+00:00');
    expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-03');
  });

  it('databasefouten: de matrix gooit; planning, staart of codes onleesbaar geven de grens van vroeger', async () => {
    const matrix = [rij('2027-01-03', { A: '2101' }), rij('2027-01-04')];
    const stuk = async () => { throw new Error('verbinding weg'); };
    await expect(bepaalPlanningGrens(lezerOp(matrix, '2027-01-03', { matrixLaatste: stuk }).lezer)).rejects.toThrow('verbinding weg');
    // Geen matrix én geen planning te lezen: de aanroeper beslist (zoals vroeger: de fout).
    await expect(bepaalPlanningGrens(lezerOp([], null, { planningLaatste: stuk }).lezer)).rejects.toThrow('verbinding weg');
    for (const over of [{ planningLaatste: stuk }, { staart: stuk }, { dienstCodes: stuk }]) {
      const { lezer, gelezen } = lezerOp(matrix, '2027-01-03', over);
      expect((await bepaalPlanningGrens(lezer)).laatste).toBe('2027-01-04');
      expect(gelezen.waarschuwingen).toHaveLength(1);
      expect(gelezen.waarschuwingen[0]).toContain('[planning-grens]');
    }
  });

  it('een rij in een onverwachte vorm telt niet en breekt niets', async () => {
    const tokens = dienstCodeTokens(CODES);
    for (const vreemd of [null, undefined, 'eek1', ['eek1'], 7]) expect(draagtCodeDienst(vreemd, tokens)).toBe(false);
    expect(draagtCodeDienst({ A: null, B: 5, C: 'eek1' }, tokens)).toBe(true);
  });
});

describe('geen tweede indeling', () => {
  it('de code-diensttoets is die van api/_lib/codeDienst.ts', () => {
    const tokens = dienstCodeTokens(CODES);
    const toets = maakCodeDienstToets([], CODES as Array<{ code: string; category?: string }>);
    for (const code of ['eek1', 'EEK1', ' Eek 1', 'bur', 'BUR.', 'bv', 'ziek', 'vrij', 'tk', 'ta', 'opl', 'raar', 'xyz', '2101', '', '-', '?']) {
      expect([code, draagtCodeDienst({ A: code }, tokens)]).toEqual([code, toets(code)]);
    }
  });

  it('op de planning van de échte opbouw geeft de grens de laatste dag waarop het bord een dienst toont', async () => {
    const users = [
      { id: '1', name: 'Jan Janssen', role: 'chauffeur', isActive: true },
      { id: '2', name: 'Piet Pieters', role: 'chauffeur', isActive: true },
    ];
    const services = [
      { id: 'd1', serviceNumber: '2101', startTime: '05:00', endTime: '13:00' },
      { id: 'd2', serviceNumber: '2102', startTime: '13:00', endTime: '21:00' },
    ];
    const codes = [
      { code: 'bv', category: 'leave', description: 'Betaald verlof' }, { code: 'ziek', category: 'absence', description: 'Ziek' },
      { code: 'vrij', category: 'absence', description: 'Vrij' }, { code: 'eek1', category: 'service', description: 'Schoolrit' },
    ];
    const DAGEN = Array.from({ length: 12 }, (_, i) => dagNa('2027-01-01', i));
    // Elke staart: wat er op de dagen na 03/01 staat, en waar het bord zijn laatste dienst toont.
    const gevallen: Array<[string, (dag: string, i: number) => Record<string, string>]> = [
      ['leeg', () => ({})],
      ['lege cellen', () => ({ 'Jan Janssen': '', 'Piet Pieters': ' ' })],
      ['afwezigheid', (_d, i) => ({ 'Jan Janssen': i % 2 ? 'bv' : 'vrij', 'Piet Pieters': 'ziek' })],
      ['onbekende code', () => ({ 'Jan Janssen': 'xyz', 'Piet Pieters': '?' })],
      ['schoolrit op dag 7', (_d, i): Record<string, string> => (i === 6 ? { 'Jan Janssen': 'bv', 'Piet Pieters': 'EEK1' } : { 'Jan Janssen': 'bv' })],
      ['dienst op dag 9', (_d, i): Record<string, string> => (i === 8 ? { 'Piet Pieters': '2102' } : {})],
      ['dienst tot het einde', () => ({ 'Jan Janssen': '2101' })],
    ];
    for (const [naam, staart] of gevallen) {
      const rows = DAGEN.map((dag, i) => ({
        id: `m-${dag}`, source_date: dag, day_type: 'week', raw_row: '',
        assignments: i < 3 ? { 'Jan Janssen': '2101', 'Piet Pieters': i === 1 ? 'vrij' : '2102' } : staart(dag, i),
      }));
      const { shifts } = bouwPlanningUitMatrix({ rows: rows as any[], users: users as any[], services: services as any[], planningCodes: codes as any[] });
      // De maat: het bord (dezelfde cellen als de Maandplanning), zonder ruilen of verlof.
      const { cells } = berekenCelWaarheid('2027-01', { rows, users, services, codes, leave: [], swaps: [] });
      const metDienst = Object.values(cells).flatMap((perDag) => Object.entries(perDag).filter(([, cel]) => cel.kind === 'service').map(([dag]) => dag)).sort();
      const grens = await bepaalPlanningGrens({
        matrixLaatste: async () => DAGEN[DAGEN.length - 1],
        planningLaatste: async () => shifts.map((s: any) => String(s.date)).sort().pop() ?? null,
        staart: async (na, vanaf, aantal) => rows.filter((r) => !na || r.source_date > na).sort((a, b) => b.source_date.localeCompare(a.source_date)).slice(vanaf, vanaf + aantal),
        dienstCodes: async () => dienstCodeTokens(codes),
        waarschuw: () => { throw new Error('geen waarschuwing verwacht'); },
      });
      expect([naam, grens.laatste]).toEqual([naam, metDienst[metDienst.length - 1]]);
    }
  });
});

describe('de opslagfuncties: welke lezingen vertrekken er', () => {
  const tabel = (q: Stap[]) => String(q[0][1]);
  const stap = (q: Stap[], naam: string) => q.find(([n]) => n === naam);
  /** Antwoorden op de vier soorten lezingen; de staart en de codes tellen mee. */
  const zetStand = (stand: { matrix: string | null; eerste?: string | null; planning: string | null; staart?: Rij[]; codes?: Array<{ code: string; category: string }>; fout?: (q: Stap[]) => boolean }) => {
    nep.antwoord = (q) => {
      if (stand.fout?.(q)) return { data: null, error: { message: 'verbinding weg' } };
      if (tabel(q) === 'planning_codes') return { data: stand.codes ?? [], error: null };
      if (tabel(q) === 'planning') return { data: stand.planning ? [{ date: stand.planning }] : [], error: null };
      if (stap(q, 'range')) {
        const [, van, tot] = stap(q, 'range') as [string, number, number];
        return { data: (stand.staart ?? []).slice(van, tot + 1), error: null };
      }
      const oplopend = (stap(q, 'order')?.[2] as { ascending: boolean }).ascending;
      const dag = oplopend ? stand.eerste ?? stand.matrix : stand.matrix;
      return { data: dag ? [{ source_date: dag }] : [], error: null };
    };
  };
  const staartLezingen = () => nep.lezingen.filter((q) => tabel(q) === 'planning_matrix_rows' && stap(q, 'range'));

  beforeEach(async () => {
    nep.antwoord = null;
    // Wist de onthouden dienstcodes (de save zelf schrijft hier niets).
    await savePlanningCodesData([]);
    nep.lezingen = [];
    vi.restoreAllMocks();
  });

  it('gewone toestand: twee lezingen van één rij, geen staart, geen planningscodes', async () => {
    zetStand({ matrix: '2027-01-03', planning: '2027-01-03' });
    expect(await getPlanningHorizon()).toBe('2027-01-03');
    expect(nep.lezingen.map((q) => [tabel(q), stap(q, 'select')?.[1], stap(q, 'limit')?.[1]])).toEqual([
      ['planning_matrix_rows', 'source_date', 1],
      ['planning', 'date', 1],
    ]);
    // Een planningrij zonder datum (de kolom laat null toe) mag niet vooraan komen.
    expect(nep.lezingen.map((q) => stap(q, 'order')?.[2])).toEqual([{ ascending: false, nullsFirst: false }, { ascending: false, nullsFirst: false }]);
  });

  it('matrix loopt verder dan de planning: één staartlezing met alleen datum en cellen, na de laatste planningdag', async () => {
    const staart = [rij('2027-01-05', { A: 'bv' }), rij('2027-01-04', {})];
    zetStand({ matrix: '2027-01-05', planning: '2027-01-03', staart, codes: [{ code: 'eek1', category: 'service' }] });
    expect(await getPlanningHorizon()).toBe('2027-01-03');
    const [lezing, ...rest] = staartLezingen();
    expect(rest).toEqual([]);
    expect(stap(lezing, 'select')?.[1]).toBe('source_date,assignments');
    expect(stap(lezing, 'gt')).toEqual(['gt', 'source_date', '2027-01-03']);
    expect(stap(lezing, 'range')).toEqual(['range', 0, STAART_STUK - 1]);
    expect(lezing.filter(([n]) => n === 'order')).toEqual([['order', 'source_date', { ascending: false }], ['order', 'id', { ascending: false }]]);
    const codes = nep.lezingen.filter((q) => tabel(q) === 'planning_codes');
    expect(codes).toHaveLength(1);
    expect(stap(codes[0], 'select')?.[1]).toBe('code,category');
    expect(stap(codes[0], 'eq')).toEqual(['eq', 'category', 'service']);
  });

  it('de planningscodes worden kort onthouden en na een save opnieuw gelezen', async () => {
    zetStand({ matrix: '2027-01-05', planning: '2027-01-03', staart: [rij('2027-01-05', { A: 'eek1' })], codes: [] });
    expect(await getPlanningHorizon()).toBe('2027-01-03');
    expect(await getPlanningHorizon()).toBe('2027-01-03');
    expect(nep.lezingen.filter((q) => tabel(q) === 'planning_codes' && stap(q, 'eq'))).toHaveLength(1);
    // De planner maakt van EEK1 een dienstcode: de volgende vraag ziet het meteen.
    await savePlanningCodesData([]);
    nep.lezingen = [];
    zetStand({ matrix: '2027-01-05', planning: '2027-01-03', staart: [rij('2027-01-05', { A: 'eek1' })], codes: [{ code: 'eek1', category: 'service' }] });
    expect(await getPlanningHorizon()).toBe('2027-01-05');
  });

  it('rooster en maandplanning lezen dezelfde dag; `eerste` blijft de eerste matrixrij', async () => {
    const stand = { matrix: '2027-01-31', eerste: '2026-09-01', planning: '2027-01-03', staart: [rij('2027-01-31'), rij('2027-01-30', { A: 'bv' })] };
    zetStand(stand);
    expect(await getPlanningHorizon()).toBe('2027-01-03');
    expect(await getPlanningMatrixGrenzen()).toEqual({ eerste: '2026-09-01', laatste: '2027-01-03' });
  });

  it('geen matrix: de horizon is de laatste opgebouwde dienst, de grenzen zijn leeg', async () => {
    zetStand({ matrix: null, planning: '2026-12-20' });
    expect(await getPlanningHorizon()).toBe('2026-12-20');
    expect(await getPlanningMatrixGrenzen()).toEqual({ eerste: null, laatste: null });
    zetStand({ matrix: null, planning: null });
    expect(await getPlanningHorizon()).toBeNull();
  });

  it('matrix niet leesbaar: de horizon valt terug op de planning, de grenzen gooien (zoals vroeger)', async () => {
    zetStand({ matrix: '2027-01-31', planning: '2027-01-03', fout: (q) => tabel(q) === 'planning_matrix_rows' });
    expect(await getPlanningHorizon()).toBe('2027-01-03');
    await expect(getPlanningMatrixGrenzen()).rejects.toMatchObject({ message: 'verbinding weg' });
  });

  it('planning niet leesbaar: met een matrix de grens van vroeger en een waarschuwing, zonder matrix de fout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    zetStand({ matrix: '2027-01-31', planning: null, fout: (q) => tabel(q) === 'planning' });
    expect(await getPlanningHorizon()).toBe('2027-01-31');
    expect((await getPlanningMatrixGrenzen()).laatste).toBe('2027-01-31');
    expect(warn).toHaveBeenCalledTimes(2);
    zetStand({ matrix: null, planning: null, fout: (q) => tabel(q) === 'planning' });
    await expect(getPlanningHorizon()).rejects.toMatchObject({ message: 'verbinding weg' });
  });

  it('staart of planningscodes niet leesbaar: de grens van vroeger en een waarschuwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    zetStand({ matrix: '2027-01-31', planning: '2027-01-03', fout: (q) => tabel(q) === 'planning_codes' });
    expect(await getPlanningHorizon()).toBe('2027-01-31');
    zetStand({ matrix: '2027-01-31', planning: '2027-01-03', fout: (q) => !!stap(q, 'range') });
    expect(await getPlanningHorizon()).toBe('2027-01-31');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('[planning-grens]');
  });
});
