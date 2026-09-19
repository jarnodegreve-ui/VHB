import { describe, expect, it } from 'vitest';
import { maakSwrCache } from '../api/_lib/swrCache';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('maakSwrCache', () => {
  const opzet = () => {
    const s = { t: 0, calls: 0, epoch: 1 as number | null, vers: true, los: null as null | (() => void), hangVanaf: 2 };
    const cache = maakSwrCache(async () => {
      s.calls++;
      const n = s.calls;
      if (n >= s.hangVanaf) await new Promise<void>((r) => { s.los = r; });
      return n;
    }, { ttlMs: 1000, staleMs: 5000, now: () => s.t, epoch: () => ({ waarde: s.epoch, vers: s.vers }) });
    return { s, cache };
  };

  it('vers binnen de TTL, daarna oud + achtergrondverversing, één tegelijk', async () => {
    const { s, cache } = opzet();
    expect(await cache.get()).toBe(1);
    expect(await cache.get()).toBe(1);
    s.t = 1500;
    expect(await cache.get()).toBe(1);
    expect(await cache.get()).toBe(1);
    expect(s.calls).toBe(2);
    s.los?.();
    await tick();
    expect(await cache.get()).toBe(2);
  });

  it('ouder dan het stale-venster = wachten', async () => {
    const { s, cache } = opzet();
    s.hangVanaf = 99;
    await cache.get();
    s.t = 5001;
    expect(await cache.get()).toBe(2);
  });

  it('geen stale-pad wanneer de epoch niet vers geverifieerd is, onbekend was bij het laden, of gewijzigd is', async () => {
    for (const geval of ['niet-vers', 'basis-onbekend', 'gewijzigd'] as const) {
      const { s, cache } = opzet();
      s.hangVanaf = 99;
      if (geval === 'basis-onbekend') s.epoch = null;
      await cache.get();
      if (geval === 'niet-vers') s.vers = false;
      if (geval === 'basis-onbekend') s.epoch = 1;
      if (geval === 'gewijzigd') s.epoch = 2;
      s.t = 1500;
      expect(await cache.get(), geval).toBe(2);
    }
  });

  it('invalidate gooit alles weg, ook een lopende verversing vult de cache niet meer', async () => {
    const { s, cache } = opzet();
    await cache.get();
    s.t = 1500;
    await cache.get();            // achtergrond #2 hangt
    const losTwee = s.los!;
    cache.invalidate();
    const p = cache.get();        // #3
    losTwee();
    s.los?.();
    expect(await p).toBe(3);
    expect(await cache.get()).toBe(3);
  });
});
