// @vitest-environment node
/**
 * De query-filters van getSwapsData/getLeaveData (ronde 3): niet-staf leest
 * niet langer de hele tabel. Hier alleen de vorm van de query; dat de routes
 * het filter meegeven (en het JS-vangnet behouden) zit in apiIntegration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Stap = [string, ...unknown[]];
// `antwoord` (optioneel, per test): krijgt de stappen van één query en mag een
// eigen resultaat teruggeven, bv. een "kolom bestaat niet"-fout.
const stappen = vi.hoisted(() => ({
  lijst: [] as Array<[string, ...unknown[]]>,
  antwoord: null as null | ((query: Array<[string, ...unknown[]]>) => unknown),
}));

vi.mock('../api/db.js', () => {
  const keten = (query: Stap[]): any => new Proxy({}, {
    get: (_t, naam: string) => {
      if (naam === 'then') return (ok: (v: unknown) => void) => ok(stappen.antwoord?.(query) ?? { data: [], error: null, count: 0 });
      // Momentopname van objectargumenten: storage past een patch soms achteraf
      // aan (session_id weghalen voor de tweede poging).
      return (...ruw: unknown[]) => {
        const args = ruw.map((a) => (a !== null && typeof a === 'object' && !Array.isArray(a) ? { ...(a as object) } : a));
        stappen.lijst.push([naam, ...args]); query.push([naam, ...args]); return keten(query);
      };
    },
  });
  return { db: { from: (tabel: string) => { stappen.lijst.push(['from', tabel]); return keten([['from', tabel]]); } }, supabase: null, supabaseAdmin: null };
});

const { getSwapsData, getLeaveData, registerDevice, listDevicesForUser, listRevokedSessionIds } = await import('../api/storage.js');

beforeEach(() => { stappen.lijst = []; stappen.antwoord = null; });

describe('getSwapsData', () => {
  it('zonder filter: hele tabel, geen or()', async () => {
    await getSwapsData();
    expect(stappen.lijst.some(([n]) => n === 'or')).toBe(false);
  });

  it('betrokkenUserId: aanvrager OF collega, lowercase kolommen, waarde tussen aanhalingstekens', async () => {
    await getSwapsData({ betrokkenUserId: '3' });
    expect(stappen.lijst).toContainEqual(['or', 'requesterid.eq."3",targetdriverid.eq."3"']);
    expect(stappen.lijst).toContainEqual(['order', 'id', { ascending: true }]);
  });

  it('escapet tekens die de or-syntaxis zouden breken', async () => {
    await getSwapsData({ betrokkenUserId: 'a,b)"c\\d' });
    expect(stappen.lijst).toContainEqual(['or', 'requesterid.eq."a,b)\\"c\\\\d",targetdriverid.eq."a,b)\\"c\\\\d"']);
  });
});

describe('getLeaveData', () => {
  it('userId filtert op de lowercase kolom userid', async () => {
    await getLeaveData({ userId: '3' });
    expect(stappen.lijst).toContainEqual(['eq', 'userid', '3']);
  });

  it('zonder filter geen eq()', async () => {
    await getLeaveData();
    expect(stappen.lijst.some(([n]) => n === 'eq')).toBe(false);
  });
});

describe('toestelregistratie met minder DB-trips', () => {
  const rij = { userId: '3', deviceToken: 'tok', name: 'iPhone', status: 'approved' as const, createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null, sessionId: null };

  it('listDevicesForUser leest alleen de rijen van die gebruiker', async () => {
    await listDevicesForUser('3');
    expect(stappen.lijst[0]).toEqual(['from', 'user_devices']);
    expect(stappen.lijst).toContainEqual(['eq', 'user_id', '3']);
  });

  it('een al bekende rij meegeven: alleen de last_seen-update, geen lezing vooraf, status blijft', async () => {
    const uit = await registerDevice('3', 'tok', 'iPhone', true, { ...rij, status: 'revoked' });
    expect(uit).toEqual({ device: { ...rij, status: 'revoked' }, created: false });
    expect(stappen.lijst.filter(([n]) => n === 'from')).toHaveLength(1);
    expect(stappen.lijst.some(([n]) => n === 'update')).toBe(true);
    expect(stappen.lijst.some(([n]) => n === 'select' || n === 'insert')).toBe(false);
  });

  it('bekend = null (nieuw toestel): insert zonder lezing vooraf', async () => {
    await registerDevice('3', 'nieuw', 'iPad', false, null).catch(() => undefined);
    expect(stappen.lijst[0]).toEqual(['from', 'user_devices']);
    expect(stappen.lijst[1]?.[0]).toBe('insert');
    expect((stappen.lijst[1]?.[1] as any)?.status).toBe('pending');
  });
});

// Controle-ronde 09-09, nr. 2: de sessie komt op de toestelrij, maar de code
// moet blijven werken zolang de migratie 2026-09-09_user_devices_sessie.sql
// niet gedraaid is (Jarno draait migraties handmatig, volgorde mag niet
// uitmaken). Deze tests staan bewust laatst: de eerste "kolom ontbreekt"-fout
// zet de sessiebinding vijf minuten uit voor deze module-instantie.
describe('sessie op de toestelrij, met stille terugval zonder kolom', () => {
  const rij = { userId: '3', deviceToken: 'tok', name: 'iPhone', status: 'approved' as const, createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null, sessionId: null };
  const kolomOntbreekt = { data: null, error: { code: '42703', message: 'column user_devices.session_id does not exist' } };
  const raaktSessie = (query: Array<[string, ...unknown[]]>) =>
    query.some(([n, arg]) => (n === 'update' || n === 'insert') && arg !== null && typeof arg === 'object' && 'session_id' in (arg as object))
    || query.some(([n, arg]) => n === 'select' && arg === 'session_id');

  it('bestaand toestel: session_id gaat mee in de last_seen-update', async () => {
    const uit = await registerDevice('3', 'tok', 'iPhone', true, rij, 'sess-1');
    const update = stappen.lijst.find(([n]) => n === 'update');
    expect((update?.[1] as any)?.session_id).toBe('sess-1');
    expect(uit.device.sessionId).toBe('sess-1');
  });

  it('nieuw toestel: session_id gaat mee in de insert', async () => {
    await registerDevice('3', 'nieuw', 'iPad', false, null, 'sess-2').catch(() => undefined);
    const insert = stappen.lijst.find(([n]) => n === 'insert');
    expect((insert?.[1] as any)?.session_id).toBe('sess-2');
  });

  it('zonder sessie (token zonder claim) verandert er niets aan de query', async () => {
    await registerDevice('3', 'tok', 'iPhone', true, rij, null);
    const update = stappen.lijst.find(([n]) => n === 'update');
    expect('session_id' in (update?.[1] as object)).toBe(false);
  });

  it('kolom ontbreekt: de registratie probeert het één keer mét, daarna zonder session_id, en slaagt', async () => {
    stappen.antwoord = (query) => (raaktSessie(query) ? kolomOntbreekt : null);
    const stil = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const uit = await registerDevice('3', 'tok', 'iPhone', true, rij, 'sess-3');
    expect(uit.created).toBe(false);
    expect(uit.device.sessionId).toBeNull();
    const updates = stappen.lijst.filter(([n]) => n === 'update');
    expect(updates.map(([, arg]) => 'session_id' in (arg as object))).toEqual([true, false]);
    // Binnen de vijf minuten daarna: niet opnieuw proberen, geen query meer
    // voor de sessielijst (exact het oude gedrag, zonder extra DB-trips).
    stappen.lijst = [];
    await expect(listRevokedSessionIds()).resolves.toEqual([]);
    expect(stappen.lijst).toEqual([]);
    stil.mockRestore();
  });

  it('na vijf minuten een herkans: ontbreekt de kolom nog, dan opnieuw een lege lijst zonder fout', async () => {
    const straks = Date.now() + 6 * 60_000;
    const klok = vi.spyOn(Date, 'now').mockReturnValue(straks);
    const stil = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stappen.antwoord = (query) => (raaktSessie(query) ? kolomOntbreekt : null);
    await expect(listRevokedSessionIds()).resolves.toEqual([]);
    expect(stappen.lijst).toContainEqual(['select', 'session_id']);
    stil.mockRestore();
    klok.mockRestore();
  });

  it('is de migratie intussen gedraaid, dan komt de lijst vanzelf terug (geen nieuwe deploy nodig)', async () => {
    const klok = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 12 * 60_000);
    stappen.antwoord = (query) => (raaktSessie(query) ? { data: [{ session_id: 'sess-weg' }], error: null } : null);
    await expect(listRevokedSessionIds()).resolves.toEqual(['sess-weg']);
    expect(stappen.lijst).toContainEqual(['eq', 'status', 'revoked']);
    klok.mockRestore();
  });
});
