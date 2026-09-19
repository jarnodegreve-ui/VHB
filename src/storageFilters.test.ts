// @vitest-environment node
/**
 * De query-filters van getSwapsData/getLeaveData (ronde 3): niet-staf leest
 * niet langer de hele tabel. Hier alleen de vorm van de query; dat de routes
 * het filter meegeven (en het JS-vangnet behouden) zit in apiIntegration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stappen = vi.hoisted(() => ({ lijst: [] as Array<[string, ...unknown[]]> }));

vi.mock('../api/db.js', () => {
  const keten = (): any => new Proxy({}, {
    get: (_t, naam: string) => {
      if (naam === 'then') return (ok: (v: unknown) => void) => ok({ data: [], error: null, count: 0 });
      return (...args: unknown[]) => { stappen.lijst.push([naam, ...args]); return keten(); };
    },
  });
  return { db: { from: (tabel: string) => { stappen.lijst.push(['from', tabel]); return keten(); } }, supabase: null, supabaseAdmin: null };
});

const { getSwapsData, getLeaveData } = await import('../api/storage.js');

beforeEach(() => { stappen.lijst = []; });

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
