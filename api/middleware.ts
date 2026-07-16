import type express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabase } from "./db.js";
import { normalizeEmail } from "./helpers.js";
import { getUsersCached } from "./userCache.js";
import type { AppUser, AuthenticatedRequest, Role } from "./types.js";

/**
 * Timing-veilige CRON_SECRET-controle. Beide kanten worden eerst gehasht
 * zodat noch de lengte noch de inhoud van het secret via de vergelijkingsduur
 * kan lekken.
 */
export const isCronAuthorized = (req: express.Request): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const provided = createHash("sha256").update(String(req.headers.authorization ?? "")).digest();
  return timingSafeEqual(expected, provided);
};

/**
 * Best-effort gebruikersresolutie voor routes die zonder sessie bereikbaar
 * blijven (bv. foutrapportage vanaf het loginscherm): geeft de app-gebruiker
 * terug bij een geldig token, anders null — nooit een fout.
 */
export const resolveOptionalUser = async (req: express.Request): Promise<AppUser | null> => {
  const token = getBearerToken(req);
  if (!token || !supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return await findUserByEmail(data.user.email);
  } catch {
    return null;
  }
};

export const getBearerToken = (req: express.Request) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
};

export const findUserByEmail = async (email?: string | null): Promise<AppUser | null> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  // Gecachte lijst: de auth-hot-path draait bij elke request en hoeft niet
  // telkens de volledige users-tabel op te halen (zie userCache.ts).
  const users = await getUsersCached();
  return users.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
};

export const authenticate = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase Auth is niet geconfigureerd." });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ error: "Niet aangemeld." });
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return res.status(401).json({ error: "Ongeldige sessie." });
  }

  const appUser = await findUserByEmail(data.user.email);
  if (!appUser) {
    return res.status(403).json({ error: "Geen gebruikersprofiel gevonden voor dit account." });
  }

  if (appUser.isActive === false) {
    return res.status(403).json({ error: "Dit account is gedeactiveerd." });
  }

  req.accessToken = accessToken;
  req.authUser = data.user;
  req.appUser = appUser;
  next();
};

export const requireRole = (...roles: Role[]) => {
  return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.appUser) {
      return res.status(401).json({ error: "Niet aangemeld." });
    }

    if (!roles.includes(req.appUser.role)) {
      return res.status(403).json({ error: "Onvoldoende rechten." });
    }

    next();
  };
};
