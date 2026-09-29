// @vitest-environment node
/**
 * De plaats van een omleiding in de opslag (controle 29-09): de kolom
 * diversions.location komt uit supabase/2026-09-10_diversions_location.sql.
 * Ontbrak ze, dan ging de save stil opnieuw zonder de kolom en werd "Plaats"
 * wekenlang niet bewaard. Die terugval is weg: een ontbrekende kolom geeft nu
 * een duidelijke fout met het .sql-bestand, en er wordt niets geschreven of
 * verwijderd. Supabase is hier een in-memory diversions-tabel die PGRST204
 * geeft zolang de kolom "ontbreekt".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => ({
  rijen: [] as any[],
  kolomOntbreekt: false,
  // Een andere fout van de database op de upsert (null = geen).
  upsertFout: null as { code: string; message: string } | null,
  upserts: [] as any[][],
  verwijderd: [] as string[][],
  opslagVerwijderd: [] as string[][],
}));

vi.mock('../api/db.js', () => {
  const tabel = () => {
    const b: any = {
      select: () => b,
      order: () => b,
      range: async (from: number, to: number) => ({ data: mem.rijen.slice(from, to + 1), error: null }),
      delete: () => ({
        in: async (_kolom: string, ids: string[]) => {
          mem.verwijderd.push(ids);
          mem.rijen = mem.rijen.filter((r) => !ids.includes(String(r.id)));
          return { error: null };
        },
      }),
      upsert: async (rijen: any[]) => {
        if (mem.upsertFout) return { error: mem.upsertFout };
        if (mem.kolomOntbreekt && rijen.some((r) => 'location' in r)) {
          return { error: { code: 'PGRST204', message: "Could not find the 'location' column of 'diversions' in the schema cache" } };
        }
        mem.upserts.push(rijen);
        for (const rij of rijen) {
          const i = mem.rijen.findIndex((r) => String(r.id) === String(rij.id));
          if (i >= 0) mem.rijen[i] = { ...mem.rijen[i], ...rij }; else mem.rijen.push({ ...rij });
        }
        return { error: null };
      },
    };
    return b;
  };
  const client = { from: () => tabel() };
  const supabaseAdmin = {
    ...client,
    storage: { from: () => ({ remove: async (paden: string[]) => { mem.opslagVerwijderd.push(paden); return { error: null }; } }) },
  };
  return { supabase: client, supabaseAdmin, db: supabaseAdmin };
});

const { saveDiversionsData, getDiversionsData, MigratieOntbreektError } = await import('../api/storage.js');

const MELDING = 'De kolom diversions.location bestaat nog niet: draai supabase/2026-09-10_diversions_location.sql in de SQL Editor.';

const invoer = () => ([
  { id: 'o-1', line: '284', location: 'Eeklo, Markt', title: 'Werken N9', description: 'Omrijden via de ring', startDate: '2026-10-01', endDate: '2026-10-31' },
  { id: 'o-2', line: '12', title: 'Kermis', description: 'Centrum afgesloten', startDate: '2026-10-05' },
]);

beforeEach(() => {
  mem.kolomOntbreekt = false;
  mem.upsertFout = null;
  mem.upserts = [];
  mem.verwijderd = [];
  mem.opslagVerwijderd = [];
  mem.rijen = [
    { id: 'o-1', line: '284', location: null, title: 'Werken N9', description: 'Omrijden via de ring', startDate: '2026-10-01', endDate: '2026-10-31', pdfUrl: null },
    { id: 'o-oud', line: '7', location: null, title: 'Oude omleiding', description: 'Voorbij', startDate: '2026-01-01', endDate: '2026-01-31', pdfUrl: null },
  ];
});

describe('saveDiversionsData: kolom location', () => {
  it('met de kolom: de plaats wordt bewaard en komt terug', async () => {
    await saveDiversionsData(invoer());
    expect(mem.rijen.find((r) => r.id === 'o-1')?.location).toBe('Eeklo, Markt');
    expect(mem.rijen.find((r) => r.id === 'o-2')?.location).toBeNull();
    const terug = await getDiversionsData();
    expect(terug.find((d: any) => d.id === 'o-1')?.location).toBe('Eeklo, Markt');
    // De omleiding die niet meer in de lijst staat is pas ná de upsert verwijderd.
    expect(mem.verwijderd).toEqual([['o-oud']]);
  });

  it('zonder de kolom (migratie niet gedraaid): een fout met het .sql-bestand, geen stille tweede poging zonder de plaats', async () => {
    mem.kolomOntbreekt = true;
    const voor = JSON.stringify(mem.rijen);
    const poging = saveDiversionsData(invoer());
    await expect(poging).rejects.toBeInstanceOf(MigratieOntbreektError);
    await expect(saveDiversionsData(invoer())).rejects.toThrow(MELDING);
    // Niets half geschreven: geen upsert kwam door, niets is verwijderd (rij
    // noch PDF), de tabel is ongewijzigd.
    expect(mem.upserts).toEqual([]);
    expect(mem.verwijderd).toEqual([]);
    expect(mem.opslagVerwijderd).toEqual([]);
    expect(JSON.stringify(mem.rijen)).toBe(voor);
  });

  it('zonder de kolom en zonder ingevulde plaats: dezelfde fout, want elke rij draagt de kolom', async () => {
    mem.kolomOntbreekt = true;
    await expect(saveDiversionsData(invoer().map(({ location: _l, ...rest }) => rest))).rejects.toThrow(MELDING);
    expect(mem.upserts).toEqual([]);
  });

  it('een andere ontbrekende kolom krijgt niet het etiket van location: de fout van de database gaat ongewijzigd door', async () => {
    mem.upsertFout = { code: 'PGRST204', message: "Could not find the 'pdfUrl' column of 'diversions' in the schema cache" };
    const poging = saveDiversionsData(invoer());
    await expect(poging).rejects.toMatchObject({ code: 'PGRST204' });
    await expect(saveDiversionsData(invoer())).rejects.not.toBeInstanceOf(MigratieOntbreektError);
    expect(mem.upserts).toEqual([]);
    expect(mem.verwijderd).toEqual([]);
  });
});
