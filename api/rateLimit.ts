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
 * Voor écht globale limiting is een gedeelde store nodig (Upstash/Vercel KV);
 * dat is bewust níét toegevoegd om geen extra dienst/kost te introduceren.
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

const WINDOW_MS = num(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
// Ruim boven normaal gebruik (boot ~11 calls, realtime-refetches, bulk-acties)
// maar ver onder een tollende lus. Configureerbaar via env.
const AUTHED_MAX = num(process.env.RATE_LIMIT_MAX, 300);
const ANON_MAX = num(process.env.RATE_LIMIT_ANON_MAX, 60);

const authedLimiter = createRateLimiter({ windowMs: WINDOW_MS, max: AUTHED_MAX });
const anonLimiter = createRateLimiter({ windowMs: WINDOW_MS, max: ANON_MAX });

const clientIp = (req: express.Request): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
};

/**
 * Globale limiter voor /api. Sleutel = het bearer-token wanneer aanwezig
 * (dus per ingelogde gebruiker — géén gedeelde limiet voor het hele
 * bedrijfsnetwerk achter één NAT-IP), anders het client-IP voor
 * niet-geauthenticeerde routes (bv. foutrapportage).
 */
export const rateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
  const { allowed, retryAfterSec } = limiter.check(key);
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "Te veel verzoeken in korte tijd. Probeer het zo dadelijk opnieuw." });
  }
  next();
};

/** Voor tests: wis alle telstanden zodat testvolgorde geen 429 veroorzaakt. */
export const resetAllRateLimiters = () => {
  authedLimiter.reset();
  anonLimiter.reset();
};
