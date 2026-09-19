// @vitest-environment node
/**
 * Rate-limiter met gedeelde store (Upstash): één pipeline-trip per request,
 * geen dubbeltelling voor anonieme requests, backstop telt niet mee voor wat
 * al op zijn eigen limiet sneuvelde, en de meegelezen users-epoch.
 * De store zelf is een nagebootste Redis achter een gemockte fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('../api/rateLimit');

const redis = new Map<string, number>();
let pipelines: string[][][] = [];
let storeKapot = false;

const nepFetch = vi.fn(async (_url: string, init: { body: string }) => {
  if (storeKapot) return { ok: false, status: 500, json: async () => ({}) } as any;
  const commands = JSON.parse(init.body) as string[][];
  pipelines.push(commands);
  const out = commands.map(([cmd, key]) => {
    if (cmd === 'INCR') { const v = (redis.get(key!) ?? 0) + 1; redis.set(key!, v); return { result: v }; }
    if (cmd === 'DECR') { const v = (redis.get(key!) ?? 0) - 1; redis.set(key!, v); return { result: v }; }
    if (cmd === 'EXPIRE') return { result: 1 };
    if (cmd === 'GET') return { result: redis.has(key!) ? String(redis.get(key!)) : null };
    return { error: 'onbekend commando' };
  });
  return { ok: true, status: 200, json: async () => out } as any;
});

const laad = async (env: Record<string, string> = {}): Promise<Mod> => {
  vi.resetModules();
  process.env.UPSTASH_REDIS_REST_URL = 'https://nep.upstash.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'nep';
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import('../api/rateLimit');
};

const run = (mod: Mod, headers: Record<string, string>) =>
  new Promise<number>((resolve) => {
    const res: any = { setHeader: () => {}, status: (code: number) => ({ json: () => resolve(code) }) };
    void mod.rateLimitMiddleware({ headers, ip: '10.0.0.1', socket: {} } as any, res, () => resolve(200));
  });

const teller = (prefix: string) => [...redis.entries()].filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);

beforeEach(() => {
  redis.clear();
  pipelines = [];
  storeKapot = false;
  nepFetch.mockClear();
  vi.stubGlobal('fetch', nepFetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RATE_LIMIT_MAX', 'RATE_LIMIT_ANON_MAX', 'RATE_LIMIT_IP_MAX']) delete process.env[k];
});

describe('rateLimitMiddleware met gedeelde store', () => {
  it('doet precies één store-trip per toegelaten request (token + backstop + epoch in één pipeline)', async () => {
    const mod = await laad();
    expect(await run(mod, { authorization: 'Bearer abc', 'x-vercel-forwarded-for': '203.0.113.9' })).toBe(200);
    expect(nepFetch).toHaveBeenCalledTimes(1);
    const cmds = pipelines[0]!.map((c) => c[0]);
    expect(cmds).toEqual(['INCR', 'EXPIRE', 'INCR', 'EXPIRE', 'GET']);
    expect(pipelines[0]![4]![1]).toBe(mod.USERS_EPOCH_KEY);
    expect(teller('rl:tok:')).toBe(1);
    expect(teller('rl:ip:203.0.113.9')).toBe(1);
  });

  it('telt een anoniem request één keer per teller: de anon-limiet is niet langer gehalveerd', async () => {
    const mod = await laad({ RATE_LIMIT_ANON_MAX: '4' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push(await run(mod, { 'x-vercel-forwarded-for': '203.0.113.9' }));
    // Vier toegelaten (vroeger: twee, want dezelfde sleutel werd 2× verhoogd).
    expect(codes).toEqual([200, 200, 200, 200, 429]);
    expect(teller('rl:anon:203.0.113.9')).toBe(5);
  });

  it('ingelogd verkeer achter hetzelfde IP eet niet van het anon-budget', async () => {
    const mod = await laad({ RATE_LIMIT_ANON_MAX: '2' });
    for (let i = 0; i < 5; i++) expect(await run(mod, { authorization: `Bearer t${i}`, 'x-vercel-forwarded-for': '203.0.113.9' })).toBe(200);
    expect(await run(mod, { 'x-vercel-forwarded-for': '203.0.113.9' })).toBe(200);
  });

  it('de IP-backstop geldt voor alle verkeer, ook met roterende tokens', async () => {
    const mod = await laad({ RATE_LIMIT_IP_MAX: '3' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push(await run(mod, { authorization: `Bearer roteer-${i}`, 'x-vercel-forwarded-for': '203.0.113.9' }));
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it('een request dat op zijn eigen limiet sneuvelt telt niet mee voor de backstop', async () => {
    const mod = await laad({ RATE_LIMIT_MAX: '2' });
    const h = { authorization: 'Bearer tollend', 'x-vercel-forwarded-for': '203.0.113.9' };
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push(await run(mod, h));
    expect(codes).toEqual([200, 200, 429, 429, 429, 429]);
    // Alleen de twee toegelaten requests staan op de IP-teller.
    expect(teller('rl:ip:203.0.113.9')).toBe(2);
  });

  it('stelt de meegelezen epoch beschikbaar (ontbrekende sleutel = 0)', async () => {
    const mod = await laad();
    expect(mod.laatsteEpochWaarneming()).toBeNull();
    await run(mod, { authorization: 'Bearer abc' });
    expect(mod.laatsteEpochWaarneming()?.waarde).toBe(0);
    redis.set(mod.USERS_EPOCH_KEY, 7);
    await run(mod, { authorization: 'Bearer abc' });
    const w = mod.laatsteEpochWaarneming();
    expect(w?.waarde).toBe(7);
    expect(Date.now() - (w?.at ?? 0)).toBeLessThan(1000);
  });

  it('valt bij een store-storing terug op de in-memory limiters (één poging, geen dubbele timeout)', async () => {
    const mod = await laad({ RATE_LIMIT_MAX: '2' });
    storeKapot = true;
    const h = { authorization: 'Bearer abc', 'x-vercel-forwarded-for': '203.0.113.9' };
    expect(await run(mod, h)).toBe(200);
    expect(nepFetch).toHaveBeenCalledTimes(1);
    expect(await run(mod, h)).toBe(200);
    expect(await run(mod, h)).toBe(429);
    expect(mod.laatsteEpochWaarneming()).toBeNull();
  });
});

describe('makeUserCache neemt de meegelezen epoch over', () => {
  it('doet geen eigen lees() zolang de limiter een verse waarde aanlevert, en ziet een wissel meteen', async () => {
    const { makeUserCache } = await import('../api/userCache');
    let t = 10_000;
    let lees = 0;
    let fetches = 0;
    let gezien: { waarde: number; at: number } | null = { waarde: 3, at: t };
    const cache = makeUserCache(async () => { fetches++; return []; }, {
      ttlMs: 100_000, now: () => t, epochCheckMs: 2000,
      epochStore: { lees: async () => { lees++; return 3; }, verhoog: async () => {}, recent: () => gezien },
    });
    await cache.get();
    t += 500; gezien = { waarde: 3, at: t };
    await cache.get();
    expect(lees).toBe(0);
    expect(fetches).toBe(1);
    // Elders ingetrokken: de volgende waarneming draagt een nieuwe epoch.
    t += 100; gezien = { waarde: 4, at: t };
    await cache.get();
    expect(fetches).toBe(2);
    expect(lees).toBe(0);
  });

  it('valt terug op lees() wanneer de waarneming te oud is', async () => {
    const { makeUserCache } = await import('../api/userCache');
    let t = 10_000;
    let lees = 0;
    const cache = makeUserCache(async () => [], {
      ttlMs: 100_000, now: () => t, epochCheckMs: 2000,
      epochStore: { lees: async () => { lees++; return 3; }, verhoog: async () => {}, recent: () => ({ waarde: 3, at: 1000 }) },
    });
    await cache.get();
    expect(lees).toBe(1);
  });
});
