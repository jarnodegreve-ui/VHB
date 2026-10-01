// @vitest-environment node
/**
 * Replace-saves verwijderen de overtollige rijen in stukken van 100 id's
 * (01-10). Eén `in.(...)` met honderden id's staat in de URL van PostgREST en
 * strandde daar: een herstel uit een back-up dat een mislukte maandimport
 * terugdraait, had ±600 planning-id's te verwijderen, met de upsert al gedaan
 * en de rest van het herstel niet. Zelfde nepclient als storageFilters.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Stap = [string, ...unknown[]];
const stappen = vi.hoisted(() => ({
  lijst: [] as Array<[string, ...unknown[]]>,
  antwoord: null as null | ((query: Array<[string, ...unknown[]]>) => unknown),
}));

vi.mock('../api/db.js', () => {
  const keten = (query: Stap[]): any => new Proxy({}, {
    get: (_t, naam: string) => {
      if (naam === 'then') return (ok: (v: unknown) => void) => ok(stappen.antwoord?.(query) ?? { data: [], error: null, count: 0 });
      return (...args: unknown[]) => { stappen.lijst.push([naam, ...args]); query.push([naam, ...args]); return keten(query); };
    },
  });
  return { db: { from: (tabel: string) => { stappen.lijst.push(['from', tabel]); return keten([['from', tabel]]); } }, supabase: null, supabaseAdmin: null };
});

const { savePlanningData, saveLeaveData, saveServicesData } = await import('../api/storage.js');

const ids = (n: number, voorvoegsel = 'r') => Array.from({ length: n }, (_, i) => `${voorvoegsel}-${i}`);
const verwijderingen = () => stappen.lijst.filter(([n]) => n === 'in').map(([, kolom, waarden]) => [kolom, (waarden as string[]).length]);

beforeEach(() => { stappen.lijst = []; stappen.antwoord = null; });

describe('replace-saves verwijderen in stukken', () => {
  it('planning: 250 overtollige rijen gaan in drie stukken weg, na de upsert', async () => {
    // De bestaande rijen komen uit de select; de back-up houdt er één.
    stappen.antwoord = (query) => (query.some(([n]) => n === 'select')
      ? { data: ids(250).map((id) => ({ id })), error: null, count: 250 }
      : { data: null, error: null });
    await savePlanningData([{ id: 'r-0', driverId: '1', date: '2026-10-01' }]);
    expect(verwijderingen()).toEqual([['id', 100], ['id', 100], ['id', 49]]);
    const volgorde = stappen.lijst.map(([n]) => n);
    expect(volgorde.indexOf('upsert')).toBeLessThan(volgorde.indexOf('in'));
    // Elk stuk is een eigen delete op de tabel, geen id gaat twee keer mee.
    const alle = stappen.lijst.filter(([n]) => n === 'in').flatMap(([, , w]) => w as string[]);
    expect(new Set(alle).size).toBe(249);
    expect(alle).not.toContain('r-0');
    expect(stappen.lijst.filter(([n]) => n === 'delete')).toHaveLength(3);
  });

  it('verlof met alleenPending: de statusvoorwaarde staat op elk stuk', async () => {
    await saveLeaveData([], ids(150, 'l'), { alleenPending: true });
    expect(verwijderingen()).toEqual([['id', 100], ['id', 50]]);
    expect(stappen.lijst.filter((s) => s[0] === 'eq' && s[1] === 'status' && s[2] === 'pending')).toHaveLength(2);
  });

  it('niets te verwijderen: geen delete', async () => {
    stappen.antwoord = (query) => (query.some(([n]) => n === 'select') ? { data: [{ id: 'd1' }], error: null, count: 1 } : { data: null, error: null });
    await saveServicesData([{ id: 'd1', serviceNumber: '10', startTime: '06:00', endTime: '14:00' }]);
    expect(stappen.lijst.some(([n]) => n === 'delete')).toBe(false);
  });

  it('een mislukt stuk stopt de reeks en gooit de fout door', async () => {
    let deletes = 0;
    stappen.antwoord = (query) => {
      if (query.some(([n]) => n === 'select')) return { data: ids(250).map((id) => ({ id })), error: null, count: 250 };
      if (query.some(([n]) => n === 'delete')) return { data: null, error: ++deletes === 2 ? { message: 'URL te lang' } : null };
      return { data: null, error: null };
    };
    await expect(savePlanningData([{ id: 'x' }])).rejects.toMatchObject({ message: 'URL te lang' });
    expect(deletes).toBe(2);
  });
});
