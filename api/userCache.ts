import type { AppUser } from "./types.js";
import { getUsersData } from "./storage.js";
import { sharedPipeline } from "./rateLimit.js";

type Clock = () => number;

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

// Korte TTL: de auth-middleware leest de gebruikerslijst bij ELKE request en
// haalde tot nu toe telkens de volledige users-tabel op. Een korte cache
// snijdt dat weg tijdens drukte.
//
// REVOCATIE: een rol-/isActive-wijziging werkt op de instantie die de write
// afhandelt meteen door (expliciete invalidate). Andere warme Vercel-
// instanties hebben elk hun eigen in-memory cache en kregen dat signaal
// vroeger niet — daar gold de wijziging pas na de TTL (30 s). Sinds
// 28-08 (controle-ronde 27-08, bevinding 33) staat er een gedeelde EPOCH in
// Upstash: invalidate() verhoogt hem, en elke instantie vergelijkt hem
// hooguit één keer per EPOCH_CHECK_MS met wat ze kent — wijkt hij af, dan
// gooit ze haar cache weg. Revocatie is zo binnen ±2 s globaal. Zonder
// Upstash (lokaal, of store onbereikbaar) valt het terug op het oude
// TTL-gedrag; de rate-limiter degradeert op dezelfde manier.
const DEFAULT_TTL_MS = num(process.env.USER_CACHE_TTL_MS, 30_000);
const DEFAULT_EPOCH_CHECK_MS = num(process.env.USER_CACHE_EPOCH_CHECK_MS, 2_000);

/** Gedeelde epoch-teller: lees() = huidige waarde (null = store niet
 *  beschikbaar), verhoog() = best-effort INCR. Injecteerbaar voor tests. */
export type EpochStore = { lees: () => Promise<number | null>; verhoog: () => Promise<void> };
const EPOCH_KEY = "users-cache:epoch";
const upstashEpochStore: EpochStore = {
  lees: async () => {
    const r = await sharedPipeline([["GET", EPOCH_KEY]], 800);
    if (!r) return null;
    const v = Number(r[0]?.result ?? 0);
    return Number.isFinite(v) ? v : 0;
  },
  verhoog: async () => {
    await sharedPipeline([["INCR", EPOCH_KEY]], 800);
  },
};

export function makeUserCache(
  fetcher: () => Promise<AppUser[]>,
  opts?: { ttlMs?: number; now?: Clock; epochStore?: EpochStore | null; epochCheckMs?: number },
) {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts?.now ?? (() => Date.now());
  const store = opts?.epochStore ?? null;
  const epochCheckMs = opts?.epochCheckMs ?? DEFAULT_EPOCH_CHECK_MS;
  let cache: { users: AppUser[]; at: number } | null = null;
  let inflight: Promise<AppUser[]> | null = null;
  // Epoch: invalidate() verhoogt dit. Een fetch die vóór de invalidate startte
  // mag de cache daarna NIET meer vullen (anders herleeft net-overschreven
  // data tot de TTL na een user-write).
  let epoch = 0;
  // Gedeelde epoch (Upstash): laatst geziene waarde + wanneer gecheckt.
  let remoteEpoch: number | null = null;
  let remoteCheckedAt = Number.NEGATIVE_INFINITY;

  const syncRemoteEpoch = async () => {
    if (!store) return;
    const t = now();
    if (t - remoteCheckedAt < epochCheckMs) return;
    remoteCheckedAt = t;
    let remote: number | null = null;
    try { remote = await store.lees(); } catch { remote = null; }
    if (remote === null) return; // store onbereikbaar → TTL-gedrag
    if (remoteEpoch !== null && remote !== remoteEpoch) {
      cache = null;
      inflight = null;
      epoch += 1;
    }
    remoteEpoch = remote;
  };

  const get = async (): Promise<AppUser[]> => {
    if (store) await syncRemoteEpoch();
    const t = now();
    if (cache && t - cache.at < ttlMs) return cache.users;
    // Stampede-bescherming: gelijktijdige misses delen één fetch.
    if (inflight) return inflight;
    const startedEpoch = epoch;
    inflight = (async () => {
      try {
        const users = await fetcher();
        // Alleen cachen als er ondertussen geen invalidate gebeurde.
        if (epoch === startedEpoch) cache = { users, at: now() };
        return users;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  const invalidate = () => {
    cache = null;
    inflight = null;
    epoch += 1;
    if (store) {
      // Andere instanties op de hoogte brengen; de eigen bijgewerkte waarde
      // wordt bij de volgende check gewoon overgenomen (remoteEpoch = null).
      remoteEpoch = null;
      void store.verhoog().catch(() => { /* best-effort */ });
    }
  };

  return { get, invalidate };
}

const defaultCache = makeUserCache(getUsersData, { epochStore: upstashEpochStore });

/** Gecachte gebruikerslijst voor de auth-hot-path. */
export const getUsersCached = defaultCache.get;

/** Wis de auth-cache — aanroepen na elke write die rol/isActive/e-mail van
 *  een gebruiker kan wijzigen, zodat dat meteen doorwerkt i.p.v. pas na TTL. */
export const invalidateUsersCache = defaultCache.invalidate;
