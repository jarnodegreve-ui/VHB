// @vitest-environment node
/**
 * "Ook technieker" in de opslag (28-09): de kolom users.ooktechnieker komt
 * met een migratie die Jarno met de hand draait. Tot dan moet élke
 * gebruikers-save blijven werken (saveUsersData schrijft de hele lijst in één
 * upsert), en wie de schakelaar toch aanzet krijgt een duidelijke fout in
 * plaats van een stil verlies. Supabase is hier een in-memory users-tabel die
 * PGRST204 geeft zolang de kolom "ontbreekt".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingUser } from '../api/types';

const mem = vi.hoisted(() => ({
  rijen: [] as any[],
  kolomOntbreekt: false,
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

  it('zonder de kolom (migratie niet gedraaid): elke gewone save blijft werken, zonder de kolom', async () => {
    mem.kolomOntbreekt = true;
    await expect(saveUsersData(invoer({ '2': { phone: '0470 11 22 33' } }))).resolves.toEqual({ createdAccounts: [] });
    expect(mem.rijen.find((r) => r.id === '2')?.phone).toBe('0470 11 22 33');
    expect(mem.upserts.flat().some((r) => 'ooktechnieker' in r)).toBe(false);
  });

  it('zonder de kolom en met de schakelaar aan: een fout met het .sql-bestand, en niets geschreven', async () => {
    mem.kolomOntbreekt = true;
    const poging = saveUsersData(invoer({ '2': { ookTechnieker: true } }));
    await expect(poging).rejects.toBeInstanceOf(MigratieOntbreektError);
    await expect(saveUsersData(invoer({ '2': { ookTechnieker: true } }))).rejects.toThrow(/2026-09-28_users_ook_technieker\.sql/);
    expect(mem.upserts).toEqual([]);
  });
});
