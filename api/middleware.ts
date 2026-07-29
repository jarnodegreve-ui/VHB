import type express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabase } from "./db.js";
import { DEVICE_GATE_EXEMPT, DEVICE_GATE_SETTING_KEY, evaluateDeviceGate, isMissingTableError, type DeviceGateSetting } from "./deviceGate.js";
import { normalizeEmail } from "./helpers.js";
import { getAppSetting, getDevice } from "./storage.js";
import { getUsersCached } from "./userCache.js";
import type { AppUser, AuthenticatedRequest, Role } from "./types.js";

// --- Toestel-whitelist (zie supabase/user_devices.sql + api/deviceGate.ts) ---
// Chauffeurs mogen de API alleen gebruiken vanaf een goedgekeurd toestel;
// zo is een doorgegeven login onbruikbaar voor buitenstaanders. Planner/admin
// worden nooit geblokkeerd (registratie is daar alleen zichtbaarheid) — de
// beheerder kan zichzelf dus niet buitensluiten. De pure beslissingslogica
// (evaluateDeviceGate) staat los in deviceGate.ts (unit-getest).

export const DEVICE_TOKEN_HEADER = "x-device-token";

// Schakelaar "toestel-goedkeuring vereist" (app_settings, beheerbaar in
// Beheer → Toestellen). Kort gecacht: de waarde wordt alleen geraadpleegd
// wanneer een toestel NIET approved is (goedgekeurde toestellen passeren
// zonder extra query), maar ook dan willen we geen query per request.
// Default (geen tabel/rij/fout) = true — de veilige kant.
let gateSettingCache: { value: boolean; at: number } | null = null;
export const isDeviceGateEnabled = async (): Promise<boolean> => {
  if (gateSettingCache && Date.now() - gateSettingCache.at < 30_000) return gateSettingCache.value;
  let value = true;
  try {
    const setting = await getAppSetting<DeviceGateSetting>(DEVICE_GATE_SETTING_KEY);
    value = setting?.enabled !== false;
  } catch {
    value = true;
  }
  gateSettingCache = { value, at: Date.now() };
  return value;
};
/** Na een wijziging via de API meteen de nieuwe waarde laten gelden. */
export const invalidateDeviceGateCache = () => { gateSettingCache = null; };

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

const getBearerToken = (req: express.Request) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
};

const findUserByEmail = async (email?: string | null): Promise<AppUser | null> => {
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
    // Een geldig token is een 36-teken UUID. Alles langer dan 100 tekens is
    // onzin (en zou de PostgREST-URL kunnen opblazen → een geforceerde DB-fout
    // waarmee de gate anders te omzeilen was): behandel als onbekend toestel,
    // zónder DB-lookup.
    const rawToken = String(req.headers[DEVICE_TOKEN_HEADER] ?? "").trim();
    const deviceToken = rawToken.length > 0 && rawToken.length <= 100 ? rawToken : "";

    let device: { status: string } | null = null;
    try {
      device = deviceToken ? await getDevice(String(appUser.id), deviceToken) : null;
    } catch (err) {
      // Fail-OPEN uitsluitend wanneer de user_devices-tabel nog niet bestaat
      // (migratie niet gedraaid) — dan mag de whitelist de app niet platleggen.
      // Elke andere DB-fout = fail-CLOSED (503), anders is de gate met een
      // geforceerde fout te omzeilen. Chauffeur-only, dus planners/admins
      // blijven sowieso werken.
      if (isMissingTableError(err)) {
        console.error("Toestel-tabel ontbreekt — gate tijdelijk overgeslagen:", err);
        req.accessToken = accessToken;
        req.authUser = data.user;
        req.appUser = appUser;
        return next();
      }
      console.error("Toestel-controle DB-fout (fail-closed):", err);
      return res.status(503).json({ error: "Toestel-controle is tijdelijk niet beschikbaar. Probeer het zo opnieuw.", code: "device_check_failed" });
    }

    // Alleen wanneer het toestel niet al goedgekeurd is maakt de schakelaar
    // het verschil — dan pas (gecacht) ophalen.
    const gateEnabled = device?.status === "approved" ? true : await isDeviceGateEnabled();
    const verdict = evaluateDeviceGate(appUser.role, req.path, device, gateEnabled);
    if (!verdict.allow) {
      return res.status(verdict.status ?? 403).json(verdict.body ?? { error: "Dit toestel heeft geen toegang.", code: "device_unknown" });
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
