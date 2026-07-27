import type express from "express";
import { createHash } from "node:crypto";

type Clock = () => number;

export type RateLimiter = {
  /** Registreer één hit voor `key`. allowed=false bij overschrijding. */
  check: (key: string) => { allowed: boolean; retryAfterSec: number };
  reset: () => void;
};

/**
 * Eenvoudige in-memory fixed-window rate limiter.
 *
 * BELANGRIJKE NUANCE: op Vercel draait dit PER WARME SERVERLESS-INSTANTIE,
 * niet globaal gedeeld. Het vangt daarmee vooral het meest waarschijnlijke
 * scenario af — één op hol geslagen of vastgelopen client (oneindige
 * fetch-lus) — en niet een gecoördineerde gedistribueerde overbelasting.
 * Voor écht globale limiting is een gedeelde store nodig: die is er nu
 * optioneel (zie createSharedLimiter, Upstash Redis REST). Zonder env-vars
 * blijft dit in-memory gedrag de fallback.
 */
export function createRateLimiter(opts: { windowMs: number; max: number; now?: Clock }): RateLimiter {
  const { windowMs, max } = opts;
  const now = opts.now ?? (() => Date.now());
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastPrune = 0;

  const prune = (t: number) => {
    if (t - lastPrune < windowMs) return;
    lastPrune = t;
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  };

  return {
    check(key: string) {
      const t = now();
      prune(t);
      const b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return { allowed: true, retryAfterSec: 0 };
      }
      if (b.count >= max) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
      }
      b.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },
    reset() {
      buckets.clear();
      lastPrune = 0;
    },
  };
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};


// --- Gedeelde (cross-instance) limiter via Upstash Redis REST ---
// Zonder deze store telt elke warme serverless-instantie apart, waardoor de
// effectieve limiet met het aantal instanties meeschaalt (controle-ronde #38).
// Werkt met platte fetch — geen extra dependency. Niet geconfigureerd of
// onbereikbaar? Dan valt de middleware terug op de in-memory limiter: liever
// een ruimere limiet dan een portaal dat plat gaat door een storing bij de
// store.
const SHARED_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const SHARED_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const hasSharedStore = () => Boolean(SHARED_URL && SHARED_TOKEN);

/**
 * Fixed-window teller in Redis: INCR + (bij de eerste hit) EXPIRE.
 * Geeft null terug wanneer de store niet geconfigureerd of onbereikbaar is,
 * zodat de aanroeper kan terugvallen.
 */
export async function sharedCheck(
  key: string,
  windowMs: number,
  max: number,
): Promise<{ allowed: boolean; retryAfterSec: number } | null> {
  if (!hasSharedStore()) return null;
  const windowSec = Math.max(1, Math.round(windowMs / 1000));
  // Vensters zijn deterministisch per tijdvak, zodat alle instanties dezelfde
  // sleutel gebruiken zonder onderlinge afstemming.
  const bucket = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${key}:${bucket}`;
  try {
    const res = await fetch(`${SHARED_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SHARED_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", redisKey], ["EXPIRE", redisKey, String(windowSec), "NX"]]),
      // Een trage store mag geen request ophouden.
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ result?: unknown }>;
    const count = Number(data?.[0]?.result);
    if (!Number.isFinite(count)) return null;
    const resetAt = (bucket + 1) * windowMs;
    return {
      allowed: count <= max,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  } catch {
    return null; // netwerkfout/timeout → fallback
  }
}

const WINDOW_MS = num(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
// Ruim boven normaal gebruik (boot ~11 calls, realtime-refetches, bulk-acties)
// maar ver onder een tollende lus. Configureerbaar via env.
const AUTHED_MAX = num(process.env.RATE_LIMIT_MAX, 300);
const ANON_MAX = num(process.env.RATE_LIMIT_ANON_MAX, 60);
// Backstop per IP over álle verkeer heen: ruim genoeg voor een heel depot
// achter één NAT-IP, maar begrenst een aanvaller die verzonnen bearer-tokens
// roteert om telkens een vers per-token-budget te krijgen.
const IP_GUARD_MAX = num(process.env.RATE_LIMIT_IP_MAX, 900);
// Foutrapportage is ongeauthenticeerd bereikbaar — eigen, strakke limiet.
const ERRORS_MAX = num(process.env.RATE_LIMIT_ERRORS_MAX, 10);

const authedLimiter = createRateLimiter({ windowMs: WINDOW_MS, max: AUTHED_MAX });
const anonLimiter = createRateLimiter({ windowMs: WINDOW_MS, max: ANON_MAX });
const ipGuardLimiter = createRateLimiter({ windowMs: WINDOW_MS, max: IP_GUARD_MAX });
const clientErrorLimiter = createRateLimiter({ windowMs: WINDOW_MS, max: ERRORS_MAX });

const clientIp = (req: express.Request): string => {
  // x-real-ip wordt door Vercel/de proxy gezet en is niet client-beïnvloedbaar
  // — de voorkeur boven x-forwarded-for, waarvan het LINKSE token door de
  // client te spoofen is (waarmee de anon-/foutlimiet te omzeilen was door de
  // header te roteren). Valt die weg, neem dan het RECHTSE (proxy-toegevoegde)
  // xff-token i.p.v. het linkse.
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim().length > 0) return real.trim();
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
};

/**
 * Globale limiter voor /api. Sleutel = het bearer-token wanneer aanwezig
 * (dus per ingelogde gebruiker — géén gedeelde limiet voor het hele
 * bedrijfsnetwerk achter één NAT-IP), anders het client-IP voor
 * niet-geauthenticeerde routes (bv. foutrapportage).
 */
export const rateLimitMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const auth = req.headers.authorization;
  let key: string;
  let limiter: RateLimiter;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    // Hash het token i.p.v. het ruw als sleutel te bewaren — geen rauwe
    // bearer-tokens in het geheugen, en de sleutel blijft uniek per token.
    const token = auth.slice("Bearer ".length);
    key = `tok:${createHash("sha256").update(token).digest("base64url")}`;
    limiter = authedLimiter;
  } else {
    key = `ip:${clientIp(req)}`;
    limiter = anonLimiter;
  }
  const max = limiter === authedLimiter ? AUTHED_MAX : ANON_MAX;
  // Gedeelde store eerst; null = niet geconfigureerd of storing → in-memory.
  const { allowed, retryAfterSec } = (await sharedCheck(key, WINDOW_MS, max)) ?? limiter.check(key);
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "Te veel verzoeken in korte tijd. Probeer het zo dadelijk opnieuw." });
  }
  // Het token wordt hier niet gevalideerd (dat doet `authenticate` later),
  // dus een verzonnen Bearer mag niet volstaan om aan elke IP-limiet te
  // ontsnappen: de ruime IP-backstop telt altijd mee.
  const guardKey = `ip:${clientIp(req)}`;
  const guard = (await sharedCheck(guardKey, WINDOW_MS, IP_GUARD_MAX)) ?? ipGuardLimiter.check(guardKey);
  if (!guard.allowed) {
    res.setHeader("Retry-After", String(guard.retryAfterSec));
    return res.status(429).json({ error: "Te veel verzoeken in korte tijd. Probeer het zo dadelijk opnieuw." });
  }
  next();
};

/**
 * Extra strakke limiet voor de ongeauthenticeerde foutrapportage-route:
 * één kapotte (of kwaadwillende) client mag de client_errors-tabel en de
 * digest-mail niet vol spammen.
 */
export const clientErrorRateLimit = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Juist híer telt de gedeelde store het meest: deze route is
  // ongeauthenticeerd, dus de limiet moet over alle instanties heen gelden.
  const errKey = `err:${clientIp(req)}`;
  const { allowed, retryAfterSec } =
    (await sharedCheck(errKey, WINDOW_MS, ERRORS_MAX)) ?? clientErrorLimiter.check(`ip:${clientIp(req)}`);
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "Te veel foutmeldingen in korte tijd." });
  }
  next();
};

/** Voor tests: wis alle telstanden zodat testvolgorde geen 429 veroorzaakt. */
export const resetAllRateLimiters = () => {
  authedLimiter.reset();
  anonLimiter.reset();
  ipGuardLimiter.reset();
  clientErrorLimiter.reset();
};
