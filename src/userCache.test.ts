import { describe, expect, it } from 'vitest';
import { makeUserCache } from '../api/userCache';
import type { AppUser } from '../api/types';

const users = (n: number): AppUser[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), name: `U${i}`, email: `u${i}@x.be`, role: 'chauffeur', employeeId: `E${i}` } as AppUser));

describe('makeUserCache', () => {
  it('haalt één keer op binnen de TTL', async () => {
    let calls = 0;
    let t = 0;
    const cache = makeUserCache(async () => { calls++; return users(1); }, { ttlMs: 1000, now: () => t });
    await cache.get();
    await cache.get();
    await cache.get();
    expect(calls).toBe(1);
  });

  it('haalt opnieuw op nadat de TTL verstreken is', async () => {
    let calls = 0;
    let t = 0;
    const cache = makeUserCache(async () => { calls++; return users(1); }, { ttlMs: 1000, now: () => t });
    await cache.get();
    t += 1001;
    await cache.get();
    expect(calls).toBe(2);
  });

  it('forceert een verse fetch na invalidate()', async () => {
    let calls = 0;
    let t = 0;
    const cache = makeUserCache(async () => { calls++; return users(1); }, { ttlMs: 100000, now: () => t });
    await cache.get();
    cache.invalidate();
    await cache.get();
    expect(calls).toBe(2);
  });

  it('vult de cache NIET met een fetch die vóór invalidate() startte', async () => {
    let calls = 0;
    let resolveFirst!: (u: AppUser[]) => void;
    const cache = makeUserCache(() => {
      calls++;
      // Alleen de eerste fetch blijft hangen tot we hem expliciet oplossen;
      // latere fetches lossen meteen op.
      if (calls === 1) return new Promise<AppUser[]>((r) => { resolveFirst = r; });
      return Promise.resolve(users(1));
    }, { ttlMs: 100000, now: () => 0 });

    const p1 = cache.get();       // start fetch #1 (blijft hangen)
    cache.invalidate();           // user-write tijdens de fetch
    resolveFirst(users(1));       // fetch #1 lost nu pas op
    await p1;
    // De cache mag NIET door fetch #1 gevuld zijn → volgende get() fetcht opnieuw.
    await cache.get();
    expect(calls).toBe(2);
  });

  it('deelt één fetch tussen gelijktijdige misses (stampede-bescherming)', async () => {
    let calls = 0;
    const cache = makeUserCache(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return users(2);
    }, { ttlMs: 1000, now: () => 0 });
    const [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(calls).toBe(1);
    expect(a).toHaveLength(2);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe('makeUserCache — gedeelde epoch over instanties (controle-ronde 27-08, nr. 33)', () => {
  const fakeStore = () => {
    let epoch = 0;
    return { lees: async () => epoch, verhoog: async () => { epoch += 1; } };
  };

  it('een invalidate op instantie A laat instantie B bij de volgende check opnieuw ophalen', async () => {
    const store = fakeStore();
    let callsB = 0;
    let t = 0;
    const a = makeUserCache(async () => users(1), { ttlMs: 100000, now: () => t, epochStore: store, epochCheckMs: 1000 });
    const b = makeUserCache(async () => { callsB++; return users(1); }, { ttlMs: 100000, now: () => t, epochStore: store, epochCheckMs: 1000 });
    await b.get();
    await b.get();
    expect(callsB).toBe(1);
    a.invalidate();
    await Promise.resolve(); // best-effort verhoog() laten landen
    t += 999;
    await b.get(); // nog binnen epochCheckMs: geen check, oude cache
    expect(callsB).toBe(1);
    t += 2;
    await b.get(); // check → epoch verschoven → verse fetch
    expect(callsB).toBe(2);
  });

  it('zonder bereikbare store valt het terug op TTL-gedrag', async () => {
    let calls = 0;
    let t = 0;
    const kapot = { lees: async () => null, verhoog: async () => { throw new Error('down'); } };
    const c = makeUserCache(async () => { calls++; return users(1); }, { ttlMs: 1000, now: () => t, epochStore: kapot, epochCheckMs: 10 });
    await c.get();
    t += 500;
    await c.get();
    expect(calls).toBe(1);
    c.invalidate(); // verhoog() faalt — mag niet gooien
    await c.get();
    expect(calls).toBe(2);
  });
});
