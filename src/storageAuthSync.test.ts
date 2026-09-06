// @vitest-environment node
/**
 * Auth-kant van saveUsersData (api/storage.ts): het koppelen van profielen
 * aan Supabase-Auth-accounts bij e-mailwijzigingen en nieuwe profielen.
 * Supabase wordt hier volledig gemockt: een in-memory users-tabel met de
 * paar query-builder-ketens die saveUsersData gebruikt, en een Auth-admin
 * met listUsers/createUser/updateUserById.
 *
 * Aanleiding (controle 05-09, nr. 29): een e-mailwijziging koppelde een
 * profiel stil aan een reeds bestaand, vreemd Auth-account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => ({
  rijen: [] as any[],
  authUsers: [] as Array<{ id: string; email: string }>,
  createUser: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('../api/db.js', () => {
  const tabel = () => {
    const b: any = {
      select: () => b,
      order: () => b,
      range: async (from: number, to: number) => ({ data: mem.rijen.slice(from, to + 1), error: null }),
      delete: () => ({ in: async (_kolom: string, ids: string[]) => { mem.rijen = mem.rijen.filter((r) => !ids.includes(String(r.id))); return { error: null }; } }),
      upsert: async (rijen: any[]) => {
        for (const rij of rijen) {
          const i = mem.rijen.findIndex((r) => String(r.id) === String(rij.id));
          if (i >= 0) mem.rijen[i] = { ...mem.rijen[i], ...rij }; else mem.rijen.push({ ...rij });
        }
        return { error: null };
      },
      update: (patch: any) => ({ eq: async (_kolom: string, id: string) => {
        const rij = mem.rijen.find((r) => String(r.id) === String(id));
        if (rij) Object.assign(rij, patch);
        return { error: null };
      } }),
    };
    return b;
  };
  const client = { from: (_naam: string) => tabel() };
  const supabaseAdmin = {
    ...client,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: mem.authUsers }, error: null }),
        createUser: async (opts: any) => {
          const user = { id: `auth-${opts.email}`, email: opts.email };
          mem.createUser(opts);
          mem.authUsers.push(user);
          return { data: { user }, error: null };
        },
        updateUserById: async (id: string, patch: any) => {
          mem.updateUserById(id, patch);
          const user = mem.authUsers.find((u) => u.id === id)!;
          if (patch.email) user.email = patch.email;
          return { data: { user }, error: null };
        },
      },
    },
  };
  return { supabase: client, supabaseAdmin, db: supabaseAdmin };
});

const { saveUsersData, EmailInGebruikError } = await import('../api/storage.js');

const rij = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Gebruiker ${id}`, role: 'chauffeur', employeeid: `VHB-${id}`, email, isactive: true, activesessions: 0, ...extra,
});
const invoer = () => mem.rijen.map((r) => ({ id: r.id, name: r.name, role: r.role, employeeId: r.employeeid, email: r.email, isActive: r.isactive }));

beforeEach(() => {
  mem.createUser.mockReset();
  mem.updateUserById.mockReset();
  mem.rijen = [
    rij('1', 'admin@vhb.be', { role: 'admin', authid: 'auth-admin' }),
    rij('2', 'a@vhb.be', { authid: 'auth-a' }),
  ];
  mem.authUsers = [
    { id: 'auth-admin', email: 'admin@vhb.be' },
    { id: 'auth-a', email: 'a@vhb.be' },
    { id: 'auth-b', email: 'b@vhb.be' }, // vreemd account zonder profiel op dat adres
    { id: 'auth-c', email: 'c@vhb.be' },
    { id: 'auth-wees', email: 'wees@vhb.be' }, // verweesd: geen enkel profiel gekoppeld
  ];
});

describe('saveUsersData — Auth-koppeling bij e-mailwijzigingen', () => {
  it('weigert een adreswissel naar een adres waar al een ánder Auth-account op staat, vóór enige write', async () => {
    const data = invoer().map((u) => (u.id === '2' ? { ...u, email: 'b@vhb.be' } : u));
    await expect(saveUsersData(data)).rejects.toBeInstanceOf(EmailInGebruikError);
    await expect(saveUsersData(data)).rejects.toThrow(/al in gebruik bij een ander account/);
    // Niets geschreven: tabel én Auth onaangeroerd.
    expect(mem.rijen.find((r) => r.id === '2')).toMatchObject({ email: 'a@vhb.be', authid: 'auth-a' });
    expect(mem.updateUserById).not.toHaveBeenCalled();
  });

  it('weigert een nieuw profiel op een adres waarvan het Auth-account al aan een ander profiel gekoppeld is', async () => {
    // Profiel 3 logt in met auth-c, dat in Auth intussen c@ heet terwijl de
    // tabel nog x@ zegt: c@vhb.be staat dus nergens in de users-tabel (de
    // tabel-check in de routes ziet niets), maar het account is wél bezet.
    mem.rijen.push(rij('3', 'x@vhb.be', { authid: 'auth-c' }));
    const data = [...invoer(), { id: '9', name: 'Nieuw', role: 'chauffeur', employeeId: 'VHB-9', email: 'c@vhb.be', isActive: true }];
    await expect(saveUsersData(data)).rejects.toBeInstanceOf(EmailInGebruikError);
    expect(mem.rijen.map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('koppelt een nieuw profiel wél aan een verweesd Auth-account (niemand anders gebruikt het)', async () => {
    const data = [...invoer(), { id: '9', name: 'Nieuw', role: 'chauffeur', employeeId: 'VHB-9', email: 'wees@vhb.be', isActive: true }];
    await expect(saveUsersData(data)).resolves.toEqual({ createdAccounts: [] });
    expect(mem.createUser).not.toHaveBeenCalled();
    expect(mem.rijen.find((r) => r.id === '9')).toMatchObject({ email: 'wees@vhb.be', authid: 'auth-wees' });
  });

  it('gewone adreswissel (nieuw adres nog vrij in Auth) werkt zoals voorheen: eigen account krijgt het nieuwe adres', async () => {
    const data = invoer().map((u) => (u.id === '2' ? { ...u, email: 'nieuw@vhb.be' } : u));
    await expect(saveUsersData(data)).resolves.toEqual({ createdAccounts: [] });
    expect(mem.updateUserById).toHaveBeenCalledWith('auth-a', expect.objectContaining({ email: 'nieuw@vhb.be' }));
    expect(mem.rijen.find((r) => r.id === '2')).toMatchObject({ email: 'nieuw@vhb.be', authid: 'auth-a' });
    expect(mem.createUser).not.toHaveBeenCalled();
  });

  it('profiel zonder authid: het account op het oude adres geldt als het eigen account', async () => {
    mem.rijen.find((r) => r.id === '2')!.authid = null;
    const data = invoer().map((u) => (u.id === '2' ? { ...u, email: 'nieuw@vhb.be' } : u));
    await expect(saveUsersData(data)).resolves.toEqual({ createdAccounts: [] });
    expect(mem.updateUserById).toHaveBeenCalledWith('auth-a', expect.objectContaining({ email: 'nieuw@vhb.be' }));
    // …en een wissel naar een vreemd adres blijft ook dan geweigerd.
    mem.updateUserById.mockClear();
    await expect(saveUsersData(invoer().map((u) => (u.id === '2' ? { ...u, email: 'b@vhb.be' } : u)))).rejects.toBeInstanceOf(EmailInGebruikError);
    expect(mem.updateUserById).not.toHaveBeenCalled();
  });

  it('een nieuw adres zonder Auth-account maakt gewoon een account aan (welkomstmail-kandidaat)', async () => {
    const data = [...invoer(), { id: '9', name: 'Nieuw', role: 'chauffeur', employeeId: 'VHB-9', email: 'vers@vhb.be', isActive: true }];
    await expect(saveUsersData(data)).resolves.toEqual({ createdAccounts: [{ email: 'vers@vhb.be', name: 'Nieuw' }] });
    expect(mem.createUser).toHaveBeenCalledTimes(1);
  });
});
