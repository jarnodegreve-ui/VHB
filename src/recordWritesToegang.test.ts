// @vitest-environment node
/**
 * Deactiveren via de gedeelde schrijfkern (api/_lib/recordWrites.ts): élke
 * overgang isActive true → false, dus ook via PUT /api/users/:id en de
 * collectie-POST, trekt toestellen en push-abonnementen in, net als "Uit
 * dienst". Voorheen deed alleen /api/users/:id/uitdienst dat (controle-ronde
 * 16-09, bevinding 2). storage/push worden gemockt: we testen de kern, niet
 * Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => ({
  revokeAllDevices: vi.fn(async (_id: string) => 2),
  deletePush: vi.fn(async (_id: string) => 1),
  logActivity: vi.fn(async () => undefined),
  saveUsersData: vi.fn(async () => ({ createdAccounts: [] })),
  meldToestelWijziging: vi.fn(),
}));

vi.mock('../api/db.js', () => ({ db: null, supabase: null, supabaseAdmin: null }));
vi.mock('../api/email.js', () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock('../api/push.js', () => ({
  sendPushToUsers: vi.fn(),
  deletePushSubscriptionsForUser: (id: string) => mem.deletePush(id),
}));
vi.mock('../api/userCache.js', () => ({ invalidateUsersCache: vi.fn() }));
// Toestel-cache (ronde 3): intrekken moet de cache wissen + de epoch verhogen.
vi.mock('../api/_lib/deviceCache.js', () => ({ meldToestelWijziging: () => mem.meldToestelWijziging() }));
vi.mock('../api/storage.js', () => ({
  deleteAllDocumentsForUser: vi.fn(async () => 0),
  diffDiversionChanges: vi.fn(),
  diffUpdateChanges: vi.fn(),
  diffUserChanges: (prev: any[], next: any[]) => ({ added: [], removed: [], changed: [] }),
  getUsersData: vi.fn(async () => []),
  isMissingTableError: (err: unknown) => (err as { code?: string })?.code === '42P01',
  kopieerOnthaalDocumentenNaar: vi.fn(async () => 0),
  logActivity: (...args: unknown[]) => mem.logActivity(...(args as [])),
  revokeAllDevices: (id: string) => mem.revokeAllDevices(id),
  saveDiversionsData: vi.fn(),
  saveUpdatesData: vi.fn(),
  saveUsersData: () => mem.saveUsersData(),
  summarizeDiversionChanges: vi.fn(),
  summarizeUpdateChanges: vi.fn(),
  summarizeUserChanges: vi.fn(() => ''),
}));

const { verwerkUsersOpslag, gedeactiveerdeIds, trekToegangIn } = await import('../api/_lib/recordWrites.js');

const gebruiker = (id: string, isActive = true) =>
  ({ id, name: `Gebruiker ${id}`, role: 'chauffeur', employeeId: `VHB-${id}`, email: `${id}@vhb.be`, isActive } as any);
const req = { appUser: { id: 'admin' } } as any;

beforeEach(() => {
  mem.revokeAllDevices.mockClear();
  mem.deletePush.mockClear();
  mem.logActivity.mockClear();
  mem.meldToestelWijziging.mockClear();
});

describe('gedeactiveerdeIds', () => {
  it('geeft alleen de overgang actief → inactief', () => {
    const vorig = [gebruiker('1'), gebruiker('2'), gebruiker('3', false)];
    const nieuw = [gebruiker('1', false), gebruiker('2'), gebruiker('3', false)];
    expect(gedeactiveerdeIds(vorig, nieuw)).toEqual(['1']);
  });

  it('heractiveren of verwijderen telt niet als deactiveren', () => {
    const vorig = [gebruiker('1'), gebruiker('2', false)];
    expect(gedeactiveerdeIds(vorig, [gebruiker('2')])).toEqual([]);
  });
});

describe('verwerkUsersOpslag, deactiveren via PUT/collectie', () => {
  it('trekt toestellen en push in bij isActive true → false en logt het', async () => {
    const vorig = [gebruiker('a'), gebruiker('b')];
    const resultaat = await verwerkUsersOpslag(req, vorig, [gebruiker('a', false), gebruiker('b')], { samenvatting: false });
    expect(mem.revokeAllDevices).toHaveBeenCalledTimes(1);
    expect(mem.revokeAllDevices).toHaveBeenCalledWith('a');
    // Zonder dit bleef een net ingetrokken toestel tot 30 s 'approved' in de gate-cache.
    expect(mem.meldToestelWijziging).toHaveBeenCalledTimes(1);
    expect(mem.deletePush).toHaveBeenCalledWith('a');
    expect(resultaat.ingetrokken).toEqual({ a: { toestellen: 2, push: 1, fouten: [] } });
    const titels = mem.logActivity.mock.calls.map((c: any[]) => c[2]);
    expect(titels).toContain('Toegang ingetrokken');
  });

  it('laat een gewone wijziging (naam, rol) met rust', async () => {
    const vorig = [gebruiker('a')];
    const resultaat = await verwerkUsersOpslag(req, vorig, [{ ...gebruiker('a'), name: 'Anders' }], { samenvatting: false });
    expect(mem.revokeAllDevices).not.toHaveBeenCalled();
    expect(mem.deletePush).not.toHaveBeenCalled();
    expect(resultaat.ingetrokken).toEqual({});
  });

  it('heractiveren (false → true) trekt niets in', async () => {
    const vorig = [gebruiker('a', false)];
    await verwerkUsersOpslag(req, vorig, [gebruiker('a', true)], { samenvatting: false });
    expect(mem.revokeAllDevices).not.toHaveBeenCalled();
  });
});

describe('trekToegangIn', () => {
  it('is best-effort: een ontbrekende toestel-tabel is geen fout, een andere fout wel', async () => {
    mem.revokeAllDevices.mockRejectedValueOnce({ code: '42P01' });
    expect(await trekToegangIn('x')).toEqual({ toestellen: 0, push: 1, fouten: [] });
    mem.revokeAllDevices.mockRejectedValueOnce(new Error('kapot'));
    mem.deletePush.mockRejectedValueOnce(new Error('kapot'));
    expect(await trekToegangIn('x')).toEqual({ toestellen: 0, push: 0, fouten: ['toestellen', 'push'] });
  });
});
