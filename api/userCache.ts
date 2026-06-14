import type { AppUser } from "./types.js";
import { getUsersData } from "./storage.js";

type Clock = () => number;

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

// Korte TTL: de auth-middleware leest de gebruikerslijst bij ELKE request en
// haalde tot nu toe telkens de volledige users-tabel op. Een korte cache
// snijdt dat weg tijdens drukte.
//
// REVOCATIE-VENSTER (eerlijk): een rol-/isActive-wijziging werkt OP DE
// INSTANTIE die de write afhandelt meteen door (we invalideren daar expliciet).
// Maar op Vercel draaien meerdere warme serverless-instances met elk hun eigen
// in-memory cache; die krijgen het invalidate-signaal niet. Op zo'n andere
// instance geldt de wijziging dus pas na het verstrijken van de TTL (default
// 30s). Een net gedeactiveerde gebruiker kan in dat venster nog door
// authenticate komen. Voor onmiddellijke globale revocatie is een gedeelde
// store nodig (bv. Redis); dat is bewust niet toegevoegd. Verlaag de TTL als
// een korter venster gewenst is.
const DEFAULT_TTL_MS = num(process.env.USER_CACHE_TTL_MS, 30_000);

export function makeUserCache(
  fetcher: () => Promise<AppUser[]>,
  opts?: { ttlMs?: number; now?: Clock },
) {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts?.now ?? (() => Date.now());
  let cache: { users: AppUser[]; at: number } | null = null;
  let inflight: Promise<AppUser[]> | null = null;
  // Epoch: invalidate() verhoogt dit. Een fetch die vóór de invalidate startte
  // mag de cache daarna NIET meer vullen (anders herleeft net-overschreven
  // data tot de TTL na een user-write).
  let epoch = 0;

  const get = async (): Promise<AppUser[]> => {
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
  };

  return { get, invalidate };
}

const defaultCache = makeUserCache(getUsersData);

/** Gecachte gebruikerslijst voor de auth-hot-path. */
export const getUsersCached = defaultCache.get;

/** Wis de auth-cache — aanroepen na elke write die rol/isActive/e-mail van
 *  een gebruiker kan wijzigen, zodat dat meteen doorwerkt i.p.v. pas na TTL. */
export const invalidateUsersCache = defaultCache.invalidate;
