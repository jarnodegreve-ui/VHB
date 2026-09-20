import { createHash } from "node:crypto";
import { getDevice, listRevokedSessionIds, type UserDevice } from "../storage.js";
import { bijUsersCacheWissel, invalidateUsersCache } from "../userCache.js";

type Clock = () => number;

// --- Toestel-lookup voor de auth-hot-path, kort gecacht (ronde 3, 19-09) ---
// Sinds #455 stuurt de client `x-device-token` op ELK request mee, dus deed
// de gate bij elk request (ook voor staf) een eigen query op user_devices, en
// /api/me en /api/auth/session deden die daarna nog eens. Dat is per request
// een volledige DB-trip vóór de handler begint.
//
// AFWEGING: een cache op een toegangsbesluit maakt intrekken in principe
// trager. Daarom dezelfde opzet als de users-cache (api/userCache.ts):
//  - per instantie, sleutel = gebruiker + toesteltoken, TTL 30 s, begrensd;
//  - elke schrijfactie op user_devices (registreren, status, verwijderen,
//    alles intrekken) wist de cache lokaal én verhoogt de gedeelde
//    users-epoch (meldToestelWijziging). Elke instantie ziet die epoch bij
//    haar volgende request (de rate-limiter leest hem mee) en gooit dan ook
//    deze cache weg: intrekken geldt zo binnen ±2 s overal, net als een
//    rolwijziging. Zonder bereikbare store is het venster de TTL (30 s), wat
//    gelijk is aan wat voor gebruikers (isActive/rol) al gold.
//  - ook "geen rij" (null) wordt gecacht: dat is de weigerende kant, en een
//    registratie wist de cache.
//  - FOUTEN worden nooit gecacht en gaan ongewijzigd door naar de aanroeper:
//    de gate blijft fail-closed (503) bij een DB-fout en fail-open uitsluitend
//    bij een ontbrekende tabel, exact zoals vóór de cache.
//
// INGETROKKEN SESSIES (controle-ronde 09-09, nr. 2). De lookup hierboven hangt
// aan de header X-Device-Token, en die kan een client weglaten of verzinnen.
// Daarom houdt dezelfde cache ook de korte lijst bij van auth-sessies
// (session_id uit het geverifieerde JWT) die bij een ingetrokken toestel
// horen. Bewust géén tweede cache: zelfde TTL, zelfde generatie, zelfde
// clear(), dus meldToestelWijziging en de gedeelde epoch wissen beide tegelijk
// en een intrekking geldt voor header én sessie binnen dezelfde ±2 s. Eén
// lijst voor alle gebruikers (ingetrokken toestellen zijn zeldzaam, partiële
// index): dat is één query per 30 s per instantie, niet één per gebruiker.
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX = 500;

export function makeDeviceCache(
  fetcher: (userId: string, deviceToken: string) => Promise<UserDevice | null>,
  opts?: { ttlMs?: number; max?: number; now?: Clock; sessieFetcher?: () => Promise<string[]> },
) {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const max = opts?.max ?? DEFAULT_MAX;
  const now = opts?.now ?? (() => Date.now());
  const cache = new Map<string, { device: UserDevice | null; at: number }>();
  const inflight = new Map<string, Promise<UserDevice | null>>();
  // Generatie: clear() verhoogt dit. Een lookup die vóór de clear startte mag
  // de cache daarna niet meer vullen (anders herleeft een net ingetrokken
  // 'approved' tot de TTL).
  let generatie = 0;

  // Het token is de whitelist-sleutel van het toestel: niet rauw in het
  // geheugen bewaren (zelfde regel als de bearer-tokens in rateLimit.ts).
  const sleutel = (userId: string, deviceToken: string) =>
    createHash("sha256").update(`${userId}\n${deviceToken}`).digest("base64url");

  const get = async (userId: string, deviceToken: string): Promise<UserDevice | null> => {
    const k = sleutel(userId, deviceToken);
    const t = now();
    const hit = cache.get(k);
    if (hit && t - hit.at < ttlMs) return hit.device;
    if (hit) cache.delete(k);
    const lopend = inflight.get(k);
    if (lopend) return lopend;
    const gestart = generatie;
    const p = (async () => {
      try {
        const device = await fetcher(userId, deviceToken);
        if (generatie === gestart) {
          // Begrensde grootte: oudste eerst weg (Map bewaart invoegvolgorde).
          while (cache.size >= max) {
            const oudste = cache.keys().next().value;
            if (oudste === undefined) break;
            cache.delete(oudste);
          }
          cache.set(k, { device, at: now() });
        }
        return device;
      } finally {
        if (inflight.get(k) === p) inflight.delete(k);
      }
    })();
    inflight.set(k, p);
    return p;
  };

  // De ingetrokken sessies: één gedeelde waarde naast de per-toestel-rijen,
  // onder dezelfde TTL en generatie. Zonder sessieFetcher (tests van de
  // toestel-lookup) is geen enkele sessie ingetrokken.
  const sessieFetcher = opts?.sessieFetcher;
  let sessies: { set: Set<string>; at: number } | null = null;
  let sessiesLopend: Promise<Set<string>> | null = null;

  const ingetrokkenSessies = async (): Promise<Set<string>> => {
    if (!sessieFetcher) return new Set();
    if (sessies && now() - sessies.at < ttlMs) return sessies.set;
    sessies = null;
    if (sessiesLopend) return sessiesLopend;
    const gestart = generatie;
    const p = (async () => {
      try {
        const set = new Set(await sessieFetcher());
        if (generatie === gestart) sessies = { set, at: now() };
        return set;
      } finally {
        if (sessiesLopend === p) sessiesLopend = null;
      }
    })();
    sessiesLopend = p;
    return p;
  };

  const isSessieIngetrokken = async (sessionId: string): Promise<boolean> =>
    sessionId ? (await ingetrokkenSessies()).has(sessionId) : false;

  const clear = () => {
    cache.clear();
    inflight.clear();
    sessies = null;
    sessiesLopend = null;
    generatie += 1;
  };

  return { get, isSessieIngetrokken, clear, grootte: () => cache.size };
}

const defaultCache = makeDeviceCache((userId, deviceToken) => getDevice(userId, deviceToken), {
  sessieFetcher: () => listRevokedSessionIds(),
});

/** Gecachte toestel-lookup (zie de afweging hierboven). */
export const getDeviceCached = defaultCache.get;

/** Hoort deze auth-sessie bij een ingetrokken toestel? Zelfde cache, zelfde
 *  wis-regels; fouten gaan ongewijzigd naar de aanroeper (nooit gecacht). */
export const isSessieIngetrokken = defaultCache.isSessieIngetrokken;

/** Alleen de lokale cache wissen. */
export const invalidateDeviceCache = defaultCache.clear;

// Epoch-wissel (elders iets ingetrokken) of een lokale users-invalidate →
// ook de toestel-cache weg.
bijUsersCacheWissel(invalidateDeviceCache);

/**
 * Aanroepen na ELKE schrijfactie op user_devices die de gate kan raken
 * (nieuwe rij, statuswijziging, verwijderen, alles intrekken): wist de
 * lokale cache en verhoogt de gedeelde epoch zodat de andere instanties
 * volgen. Kost lokaal één extra users-fetch; toestelwijzigingen zijn zeldzaam.
 */
export const meldToestelWijziging = () => {
  invalidateDeviceCache();
  invalidateUsersCache();
};
