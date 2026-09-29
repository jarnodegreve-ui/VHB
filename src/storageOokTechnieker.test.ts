// @vitest-environment node
/**
 * "Ook technieker" in de opslag (28-09): de kolom users.ooktechnieker komt
 * met een migratie die Jarno met de hand draait. Ontbreekt de kolom, dan
 * geeft élke gebruikers-save een duidelijke fout met het .sql-bestand en
 * wordt er niets geschreven. Tot de controle van 29-09 ging een gewone save
 * dan stil opnieuw zonder de kolom; die terugval is weg, want de migratie
 * staat op productie en staging. Supabase is hier een in-memory users-tabel
 * die PGRST204 geeft zolang de kolom "ontbreekt".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingUser } from '../api/types';

const mem = vi.hoisted(() => ({
  rijen: [] as any[],
  kolomOntbreekt: false,
  // Een andere fout van de database op de upsert (null = geen).
  upsertFout: null as { code: string; message: string } | null,
  upserts: [] as any[][],
}));

vi.mock('../api/db.js', () => {
  const tabel = () => {
    const b: any = {
      select: () => b,
      order: () => b,
      range: async (from: number, to: number) => ({ data: mem.rijen.slice(from, to + 1), error: null }),
      delete: () => ({ in: async () => ({ error: null }) }),
      upsert: async (rijen: any[]) => {
        if (mem.upsertFout) return { error: mem.upsertFout };
        if (mem.kolomOntbreekt && rijen.some((r) => 'ooktechnieker' in r)) {
          return { error: { code: 'PGRST204', message: "Could not find the 'ooktechnieker' column of 'users' in the schema cache" } };
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
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  };
  return { supabase: client, supabaseAdmin, db: supabaseAdmin };
});

const { saveUsersData, getUsersData, MigratieOntbreektError } = await import('../api/storage.js');

const invoer = (extra: Record<string, Partial<IncomingUser>> = {}): IncomingUser[] => ([
  { id: '1', name: 'Annelies Admin', role: 'admin', employeeId: 'VHB-1', isActive: true },
  { id: '2', name: 'Chris Chauffeur', role: 'chauffeur', employeeId: 'VHB-2', isActive: true },
  { id: '3', name: 'Tom Technieker', role: 'technieker', employeeId: 'VHB-3', isActive: true },
] satisfies IncomingUser[]).map((u) => ({ ...u, ...(extra[u.id] ?? {}) }));

beforeEach(() => {
  mem.kolomOntbreekt = false;
  mem.upsertFout = null;
  mem.upserts = [];
  mem.rijen = invoer().map((u) => ({ id: u.id, name: u.name, role: u.role, employeeid: u.employeeId, isactive: true, activesessions: 0 }));
});

describe('saveUsersData: kolom ooktechnieker', () => {
  it('met de kolom: de chauffeur krijgt hem, elke andere rij draagt false (ook een technieker die hem meestuurt)', async () => {
    await saveUsersData(invoer({ '2': { ookTechnieker: true }, '3': { ookTechnieker: true } }));
    expect(mem.rijen.map((r) => [r.id, r.ooktechnieker])).toEqual([['1', false], ['2', true], ['3', false]]);
    // En terug naar de app: alleen de chauffeur heeft hem.
    const users = await getUsersData();
    expect(users.filter((u) => u.ookTechnieker).map((u) => u.id)).toEqual(['2']);
    expect(users.find((u) => u.id === '1')).not.toHaveProperty('ookTechnieker');
  });

  it('zonder de kolom (migratie niet gedraaid): ook een gewone save geeft de fout met het .sql-bestand, geen stille tweede poging', async () => {
    mem.kolomOntbreekt = true;
    const voor = JSON.stringify(mem.rijen);
    const poging = saveUsersData(invoer({ '2': { phone: '0470 11 22 33' } }));
    await expect(poging).rejects.toBeInstanceOf(MigratieOntbreektError);
    await expect(saveUsersData(invoer({ '2': { phone: '0470 11 22 33' } }))).rejects.toThrow(
      'De kolom users.ooktechnieker bestaat nog niet: draai supabase/2026-09-28_users_ook_technieker.sql in de SQL Editor.',
    );
    // Niets half geschreven: geen enkele upsert kwam door, de rijen zijn ongewijzigd.
    expect(mem.upserts).toEqual([]);
    expect(JSON.stringify(mem.rijen)).toBe(voor);
  });

  it('een andere ontbrekende kolom krijgt niet het etiket van ooktechnieker: de fout van de database gaat ongewijzigd door', async () => {
    mem.upsertFout = { code: 'PGRST204', message: "Could not find the 'startdate' column of 'users' in the schema cache" };
    const poging = saveUsersData(invoer({ '2': { phone: '0470 11 22 33' } }));
    await expect(poging).rejects.toMatchObject({ code: 'PGRST204' });
    await expect(saveUsersData(invoer())).rejects.not.toBeInstanceOf(MigratieOntbreektError);
    expect(mem.upserts).toEqual([]);
  });

  it('zonder de kolom en met de schakelaar aan: een fout met het .sql-bestand, en niets geschreven', async () => {
    mem.kolomOntbreekt = true;
    const poging = saveUsersData(invoer({ '2': { ookTechnieker: true } }));
    await expect(poging).rejects.toBeInstanceOf(MigratieOntbreektError);
    await expect(saveUsersData(invoer({ '2': { ookTechnieker: true } }))).rejects.toThrow(/2026-09-28_users_ook_technieker\.sql/);
    expect(mem.upserts).toEqual([]);
  });
});
