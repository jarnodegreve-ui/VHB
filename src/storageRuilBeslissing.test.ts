// @vitest-environment node
/**
 * De voorwaardelijke schrijfacties van 01-10 (twee beslissingen op hetzelfde
 * moment overschrijven elkaar niet), op de échte opslagfuncties: welke query
 * er naar PostgREST gaat. De integratietests (src/apiIntegration.test.ts)
 * bootsen deze functies na; hier staat dat de nabootsing klopt met wat de
 * echte functie vraagt. Zelfde nepclient als storageVerwijderStukken.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Stap = [string, ...unknown[]];
const stappen = vi.hoisted(() => ({
  /** Elke query apart, in volgorde: de stappen van `from` tot het antwoord. */
  queries: [] as Array<Array<[string, ...unknown[]]>>,
  antwoord: null as null | ((query: Array<[string, ...unknown[]]>) => unknown),
}));

vi.mock('../api/db.js', () => {
  const keten = (query: Stap[]): any => new Proxy({}, {
    get: (_t, naam: string) => {
      if (naam === 'then') return (ok: (v: unknown) => void) => ok(stappen.antwoord?.(query) ?? { data: [], error: null, count: 0 });
      return (...args: unknown[]) => { query.push([naam, ...args]); return keten(query); };
    },
  });
  return {
    db: { from: (tabel: string) => { const query: Stap[] = [['from', tabel]]; stappen.queries.push(query); return keten(query); } },
    supabase: null,
    supabaseAdmin: null,
  };
});

const { schrijfSwapAlsStatus, voegSwapsToe, applySwapToPlanning, revertSwapFromPlanning } = await import('../api/storage.js');
const { patchDefect } = await import('../api/_lib/techniekStorage.js');

const RUIL = {
  id: 's-1', shiftId: 'sh-1', requesterId: '3', targetDriverId: '4', status: 'approved', createdAt: '2026-06-01T08:00:00Z',
  decidedAt: '2026-06-15T10:00:00.000Z', reason: 'reden', swapType: 'ruil' as const, shiftDate: '2026-07-08', shiftLine: '12',
  returnDate: '2026-07-02', returnCode: '14', targetSeenAt: '2026-06-16T08:00:00Z',
};
const filters = (query: Stap[]) => query.filter(([n]) => n === 'eq').map(([, kolom, waarde]) => [kolom, waarde]);
const stap = (query: Stap[], naam: string) => query.find(([n]) => n === naam);

beforeEach(() => { stappen.queries = []; stappen.antwoord = null; });

describe('schrijfSwapAlsStatus: de statuswissel van een ruil is een compare-and-set', () => {
  it('een update op id én op de verwachte status, nooit een upsert', async () => {
    stappen.antwoord = () => ({ data: [{ id: 's-1' }], error: null });
    expect(await schrijfSwapAlsStatus(RUIL, 'accepted')).toBe(true);
    expect(stappen.queries).toHaveLength(1);
    const [query] = stappen.queries;
    expect(query[0]).toEqual(['from', 'swaps']);
    expect(query.some(([n]) => n === 'upsert' || n === 'insert')).toBe(false);
    expect(filters(query)).toEqual([['id', 's-1'], ['status', 'accepted']]);
    // De nieuwe status en het beslismoment gaan mee; de sleutel zelf niet.
    const [, rij] = stap(query, 'update') as [string, Record<string, unknown>];
    expect(rij).toMatchObject({ status: 'approved', decidedat: '2026-06-15T10:00:00.000Z', requesterid: '3', targetdriverid: '4', shift_date: '2026-07-08', shift_line: '12', return_date: '2026-07-02', return_code: '14' });
    expect(rij).not.toHaveProperty('id');
    // Zonder de geraakte rijen terug te vragen is "niets geraakt" niet te zien.
    expect(stap(query, 'select')).toEqual(['select', 'id']);
  });

  it('geen rij geraakt (iemand anders besliste intussen, of de ruil is weg): false', async () => {
    stappen.antwoord = () => ({ data: [], error: null });
    expect(await schrijfSwapAlsStatus(RUIL, 'accepted')).toBe(false);
    stappen.antwoord = () => ({ data: null, error: null });
    expect(await schrijfSwapAlsStatus(RUIL, 'accepted')).toBe(false);
  });

  it('schrijft target_seen_at nooit: de bevestiging van de nieuwe rijder is van een ander pad', async () => {
    stappen.antwoord = () => ({ data: [{ id: 's-1' }], error: null });
    await schrijfSwapAlsStatus({ ...RUIL, targetSeenAt: undefined }, 'approved');
    const [, rij] = stap(stappen.queries[0], 'update') as [string, Record<string, unknown>];
    expect(rij).not.toHaveProperty('target_seen_at');
  });

  it('een databasefout wordt gegooid, niet als "verloren" gelezen', async () => {
    stappen.antwoord = () => ({ data: null, error: { message: 'connection failure' } });
    await expect(schrijfSwapAlsStatus(RUIL, 'accepted')).rejects.toMatchObject({ message: 'connection failure' });
  });
});

describe('voegSwapsToe: een nieuwe ruil is een insert', () => {
  it('insert, geen upsert, en niets bij een lege lijst', async () => {
    await voegSwapsToe([]);
    expect(stappen.queries).toEqual([]);
    stappen.antwoord = () => ({ data: null, error: null });
    await voegSwapsToe([{ ...RUIL, id: 's-nieuw', status: 'pending', decidedAt: undefined, targetSeenAt: undefined }]);
    const [query] = stappen.queries;
    expect(query[0]).toEqual(['from', 'swaps']);
    expect(query.some(([n]) => n === 'upsert')).toBe(false);
    const [, rijen] = stap(query, 'insert') as [string, Array<Record<string, unknown>>];
    expect(rijen).toHaveLength(1);
    expect(rijen[0]).toMatchObject({ id: 's-nieuw', status: 'pending', decidedat: null });
  });

  it('een id dat al bestaat gooit de fout van de database door (23505)', async () => {
    stappen.antwoord = () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    await expect(voegSwapsToe([{ ...RUIL, id: 's-dubbel' }])).rejects.toMatchObject({ code: '23505' });
  });
});

describe('doorvoeren en terugdraaien per been', () => {
  /** [dag, dienst, van, naar] per verplaatsing, uit de query's op planning. */
  const verplaatsingen = () => stappen.queries.map((query) => {
    const f = Object.fromEntries(filters(query));
    const [, patch] = stap(query, 'update') as [string, { driverId: string }];
    return [f.date, f.line, f.driverId, patch.driverId];
  });
  beforeEach(() => { stappen.antwoord = () => ({ data: [{ id: 'rij' }], error: null }); });

  it('zonder benen: beide, zoals altijd', async () => {
    expect(await applySwapToPlanning(RUIL)).toEqual({ offeredMoved: 1, returnMoved: 1 });
    expect(verplaatsingen()).toEqual([['2026-07-08', '12', '3', '4'], ['2026-07-02', '14', '4', '3']]);
    stappen.queries = [];
    expect(await revertSwapFromPlanning(RUIL)).toEqual({ offeredMoved: 1, returnMoved: 1 });
    expect(verplaatsingen()).toEqual([['2026-07-08', '12', '4', '3'], ['2026-07-02', '14', '3', '4']]);
  });

  it('alleen de aangeboden dienst: de terugdienst wordt niet aangeraakt en telt als 0', async () => {
    expect(await revertSwapFromPlanning(RUIL, { aangeboden: true, terug: false })).toEqual({ offeredMoved: 1, returnMoved: 0 });
    expect(verplaatsingen()).toEqual([['2026-07-08', '12', '4', '3']]);
    stappen.queries = [];
    expect(await applySwapToPlanning(RUIL, { aangeboden: true, terug: false })).toEqual({ offeredMoved: 1, returnMoved: 0 });
    expect(verplaatsingen()).toEqual([['2026-07-08', '12', '3', '4']]);
  });

  it('alleen de terugdienst: de aangeboden dienst wordt niet aangeraakt en telt als 0', async () => {
    expect(await revertSwapFromPlanning(RUIL, { aangeboden: false, terug: true })).toEqual({ offeredMoved: 0, returnMoved: 1 });
    expect(verplaatsingen()).toEqual([['2026-07-02', '14', '3', '4']]);
    stappen.queries = [];
    expect(await applySwapToPlanning(RUIL, { aangeboden: false, terug: true })).toEqual({ offeredMoved: 0, returnMoved: 1 });
    expect(verplaatsingen()).toEqual([['2026-07-02', '14', '4', '3']]);
  });

  it('een overname heeft geen terugdienst, wat de benen ook zeggen', async () => {
    const overname = { ...RUIL, swapType: 'overname' as const, returnDate: undefined, returnCode: undefined };
    expect(await revertSwapFromPlanning(overname, { aangeboden: true, terug: true })).toEqual({ offeredMoved: 1, returnMoved: null });
    expect(verplaatsingen()).toEqual([['2026-07-08', '12', '4', '3']]);
  });
});

describe('patchDefect: de annulering van een chauffeur is voorwaardelijk', () => {
  const RIJ = { id: 'd1', vehicle_id: 'v1', gemeld_op: '2026-09-28T08:00:00Z', gemeld_door: '10', werktype: 'T', omschrijving: 'Deur klemt', status: 'geannuleerd', vehicles: { busnr: '013 023', kort_nr: 23 } };

  it('met een voorwaarde: de status en de melder staan in dezelfde query als de wijziging', async () => {
    stappen.antwoord = () => ({ data: RIJ, error: null });
    const uit = await patchDefect('d1', { status: 'geannuleerd' }, { status: 'open', gemeldDoor: '10' });
    expect(uit?.status).toBe('geannuleerd');
    expect(stappen.queries).toHaveLength(1);
    const [query] = stappen.queries;
    expect(query[0]).toEqual(['from', 'vehicle_defects']);
    expect(stap(query, 'update')).toEqual(['update', { status: 'geannuleerd' }]);
    expect(filters(query)).toEqual([['id', 'd1'], ['status', 'open'], ['gemeld_door', '10']]);
  });

  it('geen rij geraakt: null, zodat de route 409 of 404 kan antwoorden', async () => {
    stappen.antwoord = () => ({ data: null, error: null });
    expect(await patchDefect('d1', { status: 'geannuleerd' }, { status: 'open', gemeldDoor: '10' })).toBeNull();
  });

  it('zonder voorwaarde (technieker, staf): alleen op id, zoals voorheen', async () => {
    stappen.antwoord = () => ({ data: { ...RIJ, status: 'uitgevoerd' }, error: null });
    await patchDefect('d1', { status: 'uitgevoerd', uitgevoerdDoor: '12' });
    expect(filters(stappen.queries[0])).toEqual([['id', 'd1']]);
  });
});
