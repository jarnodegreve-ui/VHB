import { describe, expect, it, vi } from 'vitest';
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

describe('makeUserCache, gedeelde epoch over instanties (controle-ronde 27-08, nr. 33)', () => {
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
    c.invalidate(); // verhoog() faalt, mag niet gooien
    await c.get();
    expect(calls).toBe(2);
  });
});

describe('makeUserCache, stale-while-revalidate (ronde 3)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const opzet = (o: { staleMs?: number } = {}) => {
    const s = { t: 0, calls: 0, epoch: 0, storeOk: true, hang: null as null | (() => void) };
    const store = { lees: async () => (s.storeOk ? s.epoch : null), verhoog: async () => { s.epoch += 1; } };
    const cache = makeUserCache(async () => {
      s.calls++;
      const n = s.calls;
      if (s.hang === null && n > 1) await new Promise<void>((r) => { s.hang = r; });
      return users(n);
    }, { ttlMs: 1000, staleMs: o.staleMs ?? 10_000, now: () => s.t, epochStore: store, epochCheckMs: 100 });
    return { s, cache };
  };

  it('geeft na de TTL meteen de oude lijst terug en ververst op de achtergrond (één keer)', async () => {
    const { s, cache } = opzet();
    expect(await cache.get()).toHaveLength(1);
    s.t += 1500;
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toHaveLength(1); // oud, zonder wachten: de fetch hangt nog
    expect(b).toHaveLength(1);
    expect(s.calls).toBe(2);   // één verversing, niet twee
    s.hang?.();
    await tick();
    expect(await cache.get()).toHaveLength(2); // verse lijst staat klaar
    expect(s.calls).toBe(2);
  });

  it('wacht wél wanneer de lijst ouder is dan het stale-venster', async () => {
    const { s, cache } = opzet({ staleMs: 5000 });
    await cache.get();
    s.hang = () => {}; // fetches lossen meteen op
    s.t += 5001;
    expect(await cache.get()).toHaveLength(2);
  });

  it('een epoch-wissel gooit alles weg: geen stale lijst, wachten op verse data', async () => {
    const { s, cache } = opzet();
    await cache.get();
    s.hang = () => {};
    s.epoch += 1; // elders ingetrokken
    s.t += 1500;
    expect(await cache.get()).toHaveLength(2);
  });

  it('invalidate() gooit alles weg, ook tijdens een lopende achtergrondverversing', async () => {
    const { s, cache } = opzet();
    await cache.get();
    s.t += 1500;
    await cache.get();          // start achtergrondverversing (#2, hangt)
    cache.invalidate();
    const p = cache.get();      // moet wachten op een NIEUWE fetch (#3)
    s.hang?.();
    expect(await p).toHaveLength(3);
    expect(await cache.get()).toHaveLength(3); // #2 heeft de cache niet gevuld
  });

  it('zonder bereikbare store geen stale-pad: gedrag zoals vóór SWR', async () => {
    const { s, cache } = opzet();
    await cache.get();
    s.hang = () => {};
    s.storeOk = false;
    s.t += 1500;
    expect(await cache.get()).toHaveLength(2);
  });

  it('zonder store (tests, lokaal) geen stale-pad', async () => {
    let calls = 0;
    let t = 0;
    const cache = makeUserCache(async () => { calls++; return users(calls); }, { ttlMs: 1000, staleMs: 10_000, now: () => t });
    await cache.get();
    t += 1500;
    expect(await cache.get()).toHaveLength(2);
  });

  it('een lijst die vlak na een eigen invalidate is opgehaald (basis onbekend) wordt niet stale geserveerd', async () => {
    const { s, cache } = opzet();
    await cache.get();
    cache.invalidate();     // basis-epoch onbekend tot de volgende check
    s.hang = () => {};
    await cache.get();      // fetch #2 start met basis = null... tenzij de check eerst slaagt
    s.epoch += 5;           // elders gewijzigd terwijl deze instantie stil lag
    s.t += 1500;
    const na = await cache.get();
    expect(na).toHaveLength(3); // verse fetch, niet de oude lijst (#2)
  });

  it('een mislukte achtergrondverversing laat de oude lijst staan en gooit niet', async () => {
    let calls = 0;
    let t = 0;
    const store = { lees: async () => 0, verhoog: async () => {} };
    const fout = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = makeUserCache(async () => { calls++; if (calls === 2) throw new Error('db weg'); return users(calls); },
      { ttlMs: 1000, staleMs: 10_000, now: () => t, epochStore: store, epochCheckMs: 100 });
    await cache.get();
    t += 1500;
    expect(await cache.get()).toHaveLength(1);
    await tick();
    expect(fout).toHaveBeenCalled();
    t += 200;
    expect(await cache.get()).toHaveLength(1); // nog steeds oud, nieuwe poging loopt
    await tick();
    expect(await cache.get()).toHaveLength(3);
    fout.mockRestore();
  });
});
