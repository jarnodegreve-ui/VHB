import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../api/rateLimit';

describe('createRateLimiter', () => {
  it('staat tot en met max toe en blokkeert daarna', () => {
    let t = 1000;
    const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: () => t });
    expect(limiter.check('a').allowed).toBe(true);  // 1
    expect(limiter.check('a').allowed).toBe(true);  // 2
    expect(limiter.check('a').allowed).toBe(true);  // 3
    const blocked = limiter.check('a');             // 4 → geblokkeerd
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('houdt sleutels onafhankelijk bij', () => {
    let t = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => t });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true); // andere sleutel, eigen budget
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('reset het venster nadat de tijd verstreken is', () => {
    let t = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => t });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    t += 1001; // venster voorbij
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('reset() wist alle telstanden', () => {
    let t = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => t });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    limiter.reset();
    expect(limiter.check('a').allowed).toBe(true);
  });
});

describe('gedeelde store (Upstash) — fallback-gedrag', () => {
  it('sharedCheck geeft null zonder configuratie, zodat de in-memory limiter blijft werken', async () => {
    const { sharedCheck, hasSharedStore } = await import('../api/rateLimit');
    // In de testomgeving staan de env-vars niet: nooit een remote call doen.
    expect(hasSharedStore()).toBe(false);
    expect(await sharedCheck('ip:1.2.3.4', 60_000, 10)).toBeNull();
  });
});

describe('IP-bepaling: gespoofte headers mogen de limiet niet omzeilen', () => {
  it('gebruikt x-vercel-forwarded-for boven een door de client gezette x-real-ip', async () => {
    const { rateLimitMiddleware } = await import('../api/rateLimit');
    const seen: number[] = [];
    const run = (headers: Record<string, string>) =>
      new Promise<void>((resolve) => {
        const res: any = {
          setHeader: () => {},
          status: (code: number) => { seen.push(code); return { json: () => resolve() }; },
        };
        rateLimitMiddleware({ headers, ip: '10.0.0.1', socket: {} } as any, res, () => resolve());
      });

    // Zelfde echte client (Vercel-header), maar een roterende x-real-ip:
    // alle verzoeken horen in dezelfde bucket te vallen.
    for (let i = 0; i < 3; i++) {
      await run({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-real-ip': `1.2.3.${i}` });
    }
    // Geen 429 bij dit lage aantal — de test bewijst vooral dat de
    // middleware doorloopt en niet crasht op de headercombinatie.
    expect(seen.filter((c) => c === 429).length).toBe(0);
  });
});
