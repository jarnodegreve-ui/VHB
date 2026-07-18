import type express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabase } from "./db.js";
import { normalizeEmail } from "./helpers.js";
import { getDevice } from "./storage.js";
import { getUsersCached } from "./userCache.js";
import type { AppUser, AuthenticatedRequest, Role } from "./types.js";

// --- Toestel-whitelist (zie supabase/user_devices.sql) ---
// Chauffeurs mogen de API alleen gebruiken vanaf een goedgekeurd toestel;
// zo is een doorgegeven login onbruikbaar voor buitenstaanders. Planner/admin
// worden nooit geblokkeerd (registratie is daar alleen zichtbaarheid) — de
// beheerder kan zichzelf dus niet buitensluiten.

export const DEVICE_TOKEN_HEADER = "x-device-token";

// Bereikbaar vanaf een niet-goedgekeurd toestel: de registratie zelf en de
// sessie-boekhouding bij login/logout.
const DEVICE_GATE_EXEMPT = new Set(["/api/devices/register", "/api/auth/session"]);

export type DeviceGateVerdict = {
  allow: boolean;
  status?: number;
  body?: { error: string; code: string };
};

/** Pure beslissingsfunctie (los getest in apiIntegration.test.ts). */
export const evaluateDeviceGate = (
  role: Role,
  path: string,
  device: { status: string } | null,
): DeviceGateVerdict => {
  if (role !== "chauffeur") return { allow: true };
  if (DEVICE_GATE_EXEMPT.has(path)) return { allow: true };
  if (!device) {
    return {
      allow: false,
      status: 403,
      body: { error: "Dit toestel is niet geregistreerd voor dit account.", code: "device_unknown" },
    };
  }
  if (device.status === "approved") return { allow: true };
  if (device.status === "revoked") {
    return {
      allow: false,
      status: 403,
      body: { error: "Dit toestel is geblokkeerd voor dit account.", code: "device_revoked" },
    };
  }
  return {
    allow: false,
    status: 403,
    body: { error: "Dit toestel wacht op goedkeuring door de planning.", code: "device_pending" },
  };
};

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

  // Toestel-whitelist: alleen voor chauffeurs, en niet op de exempt-paden
  // (registratie/sessie-boekhouding). De DB-lookup gebeurt pas hier, zodat
  // planner/admin-verkeer er geen query aan overhoudt.
  if (appUser.role === "chauffeur" && !DEVICE_GATE_EXEMPT.has(req.path)) {
    try {
      const deviceToken = String(req.headers[DEVICE_TOKEN_HEADER] ?? "").trim();
      const device = deviceToken ? await getDevice(String(appUser.id), deviceToken) : null;
      const verdict = evaluateDeviceGate(appUser.role, req.path, device);
      if (!verdict.allow) {
        return res.status(verdict.status ?? 403).json(verdict.body ?? { error: "Dit toestel heeft geen toegang.", code: "device_unknown" });
      }
    } catch (err) {
      // Bewust fail-open: als de user_devices-tabel nog niet bestaat (migratie
      // niet gedraaid) of de DB hapert, mag dat niet de hele chauffeurs-app
      // platleggen — de gewone auth hierboven staat er dan nog. Zichtbaar in
      // de functielogs zodat het niet stil blijft.
      console.error("Toestel-controle overgeslagen (fail-open):", err);
    }
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
