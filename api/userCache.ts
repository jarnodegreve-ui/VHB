import type { AppUser } from "./types.js";
import { getUsersData } from "./storage.js";
import { laatsteEpochWaarneming, sharedPipeline, USERS_EPOCH_KEY } from "./rateLimit.js";

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
//
// STALE-WHILE-REVALIDATE (ronde 3, 19-09): na de TTL haalde het eerstvolgende
// request de hele users-tabel op terwijl de gebruiker wachtte. Nu krijgt dat
// request de oude lijst (tot max. STALE_MS oud) en loopt de verversing op de
// achtergrond. Dat mag ALLEEN wanneer de gedeelde epoch in ditzelfde
// check-venster met succes geverifieerd is ÉN gelijk is aan de epoch waarmee
// de lijst opgehaald werd: dan is er sinds onze fetch nergens een gebruiker
// of toestel gewijzigd, en is "oud" dus niet "fout".
// Geen store, store onbereikbaar, epoch gewijzigd of expliciete invalidate →
// geen stale-pad, wachten zoals vroeger. Revocatie wordt hierdoor niet trager.
const DEFAULT_TTL_MS = num(process.env.USER_CACHE_TTL_MS, 30_000);
const DEFAULT_STALE_MS = num(process.env.USER_CACHE_STALE_MS, 5 * 60_000);
const DEFAULT_EPOCH_CHECK_MS = num(process.env.USER_CACHE_EPOCH_CHECK_MS, 2_000);

/** Gedeelde epoch-teller: lees() = huidige waarde (null = store niet
 *  beschikbaar), verhoog() = best-effort INCR. Injecteerbaar voor tests.
 *
 *  recent() (optioneel) = een waarde die iemand anders nét al ophaalde, met
 *  het tijdstip erbij. De rate-limiter leest de epoch mee in zijn ene
 *  pipeline-aanroep per request (api/rateLimit.ts); is die waarneming verser
 *  dan onze laatste check, dan nemen we haar over en doet de cache GEEN eigen
 *  geawaite Upstash-call. Zonder verse waarneming (tests, buiten /api, store
 *  weg) blijft het bij lees(), hooguit één keer per EPOCH_CHECK_MS. */
export type EpochStore = {
  lees: () => Promise<number | null>;
  verhoog: () => Promise<void>;
  recent?: () => { waarde: number; at: number } | null;
};
const EPOCH_KEY = USERS_EPOCH_KEY;
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
  recent: laatsteEpochWaarneming,
};

export function makeUserCache(
  fetcher: () => Promise<AppUser[]>,
  opts?: { ttlMs?: number; staleMs?: number; now?: Clock; epochStore?: EpochStore | null; epochCheckMs?: number; bijWissel?: () => void },
) {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const now = opts?.now ?? (() => Date.now());
  const store = opts?.epochStore ?? null;
  const epochCheckMs = opts?.epochCheckMs ?? DEFAULT_EPOCH_CHECK_MS;
  // basis = de gedeelde epoch zoals bekend toen de fetch STARTTE (null =
  // onbekend, bv. vlak na een eigen invalidate). Alleen een lijst met een
  // bekende basis die nog steeds de huidige epoch is, mag stale geserveerd
  // worden: anders kan er tussen onze fetch en de eerstvolgende waarneming
  // ongemerkt iets ingetrokken zijn.
  let cache: { users: AppUser[]; at: number; basis: number | null } | null = null;
  let inflight: Promise<AppUser[]> | null = null;
  // Epoch: invalidate() verhoogt dit. Een fetch die vóór de invalidate startte
  // mag de cache daarna NIET meer vullen (anders herleeft net-overschreven
  // data tot de TTL na een user-write).
  let epoch = 0;
  // Gedeelde epoch (Upstash): laatst geziene waarde + wanneer gecheckt.
  let remoteEpoch: number | null = null;
  let remoteCheckedAt = Number.NEGATIVE_INFINITY;
  // Laatste GESLAAGDE epoch-verificatie (voorwaarde voor het stale-pad).
  let remoteOkAt = Number.NEGATIVE_INFINITY;

  // bijWissel: meeliftende caches (toestel-lookup, zie _lib/deviceCache.ts)
  // gaan mee weg bij een epoch-wissel én bij een lokale invalidate.
  const meldWissel = () => { try { opts?.bijWissel?.(); } catch { /* luisteraar mag de auth-cache niet breken */ } };

  const verwerkRemote = (remote: number) => {
    if (remoteEpoch !== null && remote !== remoteEpoch) {
      cache = null;
      inflight = null;
      epoch += 1;
      meldWissel();
    }
    remoteEpoch = remote;
  };

  /** Neem een verse waarneming van de limiter over (synchroon, geen I/O). */
  const neemWaarnemingOver = (t: number): boolean => {
    const gezien = store?.recent?.() ?? null;
    if (gezien && gezien.at > remoteCheckedAt && t - gezien.at < epochCheckMs) {
      remoteCheckedAt = gezien.at;
      remoteOkAt = gezien.at;
      verwerkRemote(gezien.waarde);
      return true;
    }
    return false;
  };

  const syncRemoteEpoch = async () => {
    if (!store) return;
    const t = now();
    // Meegelezen waarde van de limiter: alleen als ze verser is dan onze
    // laatste check én binnen het check-venster valt. Zo ziet in de praktijk
    // élk /api-request de epoch, zonder eigen roundtrip.
    if (neemWaarnemingOver(t)) return;
    if (t - remoteCheckedAt < epochCheckMs) return;
    remoteCheckedAt = t;
    let remote: number | null = null;
    try { remote = await store.lees(); } catch { remote = null; }
    if (remote === null) return; // store onbereikbaar → TTL-gedrag
    remoteOkAt = now();
    verwerkRemote(remote);
  };

  /** Stand van de gedeelde epoch: `waarde` = laatst geziene epoch (null =
   *  onbekend), `vers` = binnen het check-venster met succes geverifieerd.
   *  Synchroon; neemt een verse limiter-waarneming mee. Ook de voorwaarde
   *  voor het stale-pad van de andere auth-caches (onderhoud, toestel-gate,
   *  zie _lib/swrCache.ts). */
  const epochStand = (): { waarde: number | null; vers: boolean } => {
    if (!store) return { waarde: null, vers: false };
    const t = now();
    neemWaarnemingOver(t);
    return { waarde: remoteEpoch, vers: t - remoteOkAt < epochCheckMs };
  };

  const haalOp = (): Promise<AppUser[]> => {
    // Stampede-bescherming: gelijktijdige misses delen één fetch.
    if (inflight) return inflight;
    const startedEpoch = epoch;
    const basis = remoteEpoch;
    // `let p!`: de `finally` hieronder leest `p`, maar draait pas na een
    // `await`, wanneer de toewijzing allang gebeurd is. Dat kan de compiler
    // niet bewijzen (TS2454 onder `strict`); de `!` zegt het hem, zonder één
    // byte aan het gedrag te veranderen.
    let p!: Promise<AppUser[]>;
    p = (async () => {
      try {
        const users = await fetcher();
        // Alleen cachen als er ondertussen geen invalidate gebeurde.
        if (epoch === startedEpoch) cache = { users, at: now(), basis };
        return users;
      } finally {
        if (inflight === p) inflight = null;
      }
    })();
    inflight = p;
    return p;
  };

  const get = async (): Promise<AppUser[]> => {
    if (store) await syncRemoteEpoch();
    const t = now();
    // Eerst de epoch-stand (kan een verse waarneming overnemen en daarbij de
    // cache wissen), pas daarna de cache lezen.
    const stand = epochStand();
    const huidig = cache;
    if (huidig) {
      const leeftijd = t - huidig.at;
      if (leeftijd < ttlMs) return huidig.users;
      // Stale-while-revalidate, zie de kop van dit bestand.
      if (leeftijd < staleMs && stand.vers && huidig.basis !== null && huidig.basis === stand.waarde) {
        void haalOp().catch((err) => {
          console.error("[userCache] achtergrondverversing mislukt, oude lijst blijft staan:", (err as Error)?.message ?? err);
        });
        return huidig.users;
      }
    }
    return haalOp();
  };

  const invalidate = () => {
    cache = null;
    inflight = null;
    epoch += 1;
    meldWissel();
    if (store) {
      // Andere instanties op de hoogte brengen; de eigen bijgewerkte waarde
      // wordt bij de volgende check gewoon overgenomen (remoteEpoch = null).
      remoteEpoch = null;
      void store.verhoog().catch(() => { /* best-effort */ });
    }
  };

  return { get, invalidate, epochStand };
}

// Luisteraars op "de users-cache is weggegooid" (epoch-wissel of invalidate).
const wisselLuisteraars: Array<() => void> = [];
/** Registreer een cache die samen met de users-cache weg moet (bv. de
 *  toestel-cache): één gedeelde epoch voor alles wat een toegangsbesluit voedt. */
export const bijUsersCacheWissel = (fn: () => void) => { wisselLuisteraars.push(fn); };

const defaultCache = makeUserCache(getUsersData, {
  epochStore: upstashEpochStore,
  bijWissel: () => { for (const fn of wisselLuisteraars) fn(); },
});

/** Stand van de gedeelde epoch (waarde + "zonet geverifieerd"): de voorwaarde
 *  voor het stale-pad van de andere auth-caches (api/_lib/swrCache.ts). */
export const epochStand = defaultCache.epochStand;

/** Gecachte gebruikerslijst voor de auth-hot-path. */
export const getUsersCached = defaultCache.get;

/** Wis de auth-cache — aanroepen na elke write die rol/isActive/e-mail van
 *  een gebruiker kan wijzigen, zodat dat meteen doorwerkt i.p.v. pas na TTL. */
export const invalidateUsersCache = defaultCache.invalidate;
