// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/storage.js', () => ({ getDevice: vi.fn(), getUsersData: vi.fn(async () => []) }));

const { makeDeviceCache } = await import('../api/_lib/deviceCache.js');

const toestel = (status: 'approved' | 'pending' | 'revoked') =>
  ({ userId: '3', deviceToken: 'tok', name: 'iPhone', status, createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });

describe('makeDeviceCache', () => {
  it('haalt één keer op binnen de TTL en opnieuw erna', async () => {
    let calls = 0;
    let t = 0;
    const c = makeDeviceCache(async () => { calls++; return toestel('approved'); }, { ttlMs: 1000, now: () => t });
    await c.get('3', 'tok');
    await c.get('3', 'tok');
    expect(calls).toBe(1);
    t += 1001;
    await c.get('3', 'tok');
    expect(calls).toBe(2);
  });

  it('houdt gebruiker + token uit elkaar', async () => {
    const gezien: string[] = [];
    const c = makeDeviceCache(async (u, tok) => { gezien.push(`${u}/${tok}`); return null; }, { now: () => 0 });
    await c.get('3', 'a');
    await c.get('3', 'b');
    await c.get('4', 'a');
    await c.get('3', 'a');
    expect(gezien).toEqual(['3/a', '3/b', '4/a']);
  });

  it('cachet ook "geen rij" (de weigerende kant), tot clear()', async () => {
    let calls = 0;
    const c = makeDeviceCache(async () => { calls++; return null; }, { now: () => 0 });
    expect(await c.get('3', 'tok')).toBeNull();
    expect(await c.get('3', 'tok')).toBeNull();
    expect(calls).toBe(1);
    c.clear();
    await c.get('3', 'tok');
    expect(calls).toBe(2);
  });

  it('cachet NOOIT een fout: de gate blijft fail-closed en elke poging gaat opnieuw naar de DB', async () => {
    let calls = 0;
    const c = makeDeviceCache(async () => { calls++; throw Object.assign(new Error('db weg'), { code: '08006' }); }, { now: () => 0 });
    await expect(c.get('3', 'tok')).rejects.toThrow('db weg');
    await expect(c.get('3', 'tok')).rejects.toThrow('db weg');
    expect(calls).toBe(2);
    expect(c.grootte()).toBe(0);
  });

  it('een lookup die vóór clear() startte vult de cache niet meer (ingetrokken toestel herleeft niet)', async () => {
    let calls = 0;
    let losEerste!: (d: ReturnType<typeof toestel>) => void;
    const c = makeDeviceCache(() => {
      calls++;
      if (calls === 1) return new Promise((r) => { losEerste = r; });
      return Promise.resolve(toestel('revoked'));
    }, { now: () => 0 });
    const p1 = c.get('3', 'tok');
    c.clear(); // intrekken tijdens de lookup
    losEerste(toestel('approved'));
    await p1;
    expect((await c.get('3', 'tok'))?.status).toBe('revoked');
    expect(calls).toBe(2);
  });

  it('deelt één lookup tussen gelijktijdige misses', async () => {
    let calls = 0;
    const c = makeDeviceCache(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return toestel('approved'); }, { now: () => 0 });
    await Promise.all([c.get('3', 'tok'), c.get('3', 'tok'), c.get('3', 'tok')]);
    expect(calls).toBe(1);
  });

  it('blijft begrensd: oudste eerst weg', async () => {
    const c = makeDeviceCache(async () => null, { max: 3, now: () => 0 });
    for (let i = 0; i < 10; i++) await c.get('3', `tok-${i}`);
    expect(c.grootte()).toBe(3);
  });
});
