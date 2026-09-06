import type express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabase } from "./db.js";
import { DEVICE_GATE_EXEMPT, DEVICE_GATE_SETTING_KEY, evaluateDeviceGate, isMissingTableError, type DeviceGateSetting } from "./deviceGate.js";
import { normalizeEmail } from "./helpers.js";
import { getAppSetting, getDevice, koppelAuthId } from "./storage.js";
import { getUsersCached, invalidateUsersCache } from "./userCache.js";
import type { AppUser, AppUserIntern, AuthenticatedRequest, Role } from "./types.js";

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
const bearerMatches = (req: express.Request, secret: string | undefined): boolean => {
  if (!secret) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const provided = createHash("sha256").update(String(req.headers.authorization ?? "")).digest();
  return timingSafeEqual(expected, provided);
};
export const isCronAuthorized = (req: express.Request): boolean => bearerMatches(req, process.env.CRON_SECRET);

/**
 * Roostersolver-export (vhb-planner op Render): eigen secret
 * ROSTERING_EXPORT_SECRET, zodat het cron-secret niet óók in een andere
 * omgeving hoeft te staan — wie het daar vond, kon ook back-up, briefing en
 * OCPI-sync triggeren (controle-ronde 27-08, bevinding 28). Overgang: zolang
 * het nieuwe secret niet gezet is, blijft CRON_SECRET werken, met een
 * waarschuwing in de logs. Zodra het gezet is (Vercel + Render), werkt alleen
 * nog het eigen secret.
 */
export const isRosteringExportAuthorized = (req: express.Request): boolean => {
  const eigen = process.env.ROSTERING_EXPORT_SECRET;
  if (eigen) return bearerMatches(req, eigen);
  const viaCron = isCronAuthorized(req);
  if (viaCron) console.warn("[rostering-export] geautoriseerd met CRON_SECRET, zet ROSTERING_EXPORT_SECRET (Vercel én Render) zodat het cron-secret niet gedeeld hoeft te worden.");
  return viaCron;
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
    const check = await verifieerToken(token);
    if (check.ok === false) return null;
    const gevonden = await findAppUser({ id: check.id, email: check.email });
    return gevonden === "koppeling" ? null : gevonden;
  } catch {
    return null;
  }
};

type TokenCheck = { ok: true; id: string; email: string | null } | { ok: false; status: 401 | 503 };
const is4xx = (e: unknown): boolean => {
  const st = (e as { status?: unknown })?.status;
  return typeof st === "number" && st >= 400 && st < 500;
};

/**
 * Token → identiteit, zónder netwerk-roundtrip per request.
 *
 * 1) Lokaal: `getClaims` verifieert de handtekening tegen de JWKS van het
 *    project (ES256; supabase-js cachet de sleutels) en controleert exp/nbf.
 *    Voorheen ging élke API-call langs `getUser` (netwerk): een planner-boot
 *    ≈ 11 parallelle Auth-roundtrips, en elke Auth-hik raakte élke call —
 *    de 503-bursts van 29-30/07 (controle-ronde 27-08, voorstel 55).
 * 2) Fallback: `getUser` met de bestaande 401/503-scheiding — als getClaims
 *    niet kan (JWKS onbereikbaar, HS256-token, oude client-lib) of een
 *    onduidelijke fout geeft. Een aantoonbaar ongeldig/verlopen token
 *    (4xx of AuthInvalidJwtError) is meteen 401, zonder roundtrip.
 */
export const verifieerToken = async (token: string): Promise<TokenCheck> => {
  if (!supabase) return { ok: false, status: 503 };
  try {
    const auth = supabase.auth as unknown as { getClaims?: (jwt: string) => Promise<{ data: { claims?: { sub?: unknown; email?: unknown } } | null; error: { name?: string; status?: number; message?: string } | null }> };
    if (typeof auth.getClaims === "function") {
      const { data, error } = await auth.getClaims(token);
      const sub = data?.claims?.sub;
      if (!error && typeof sub === "string" && sub) {
        const email = data?.claims?.email;
        return { ok: true, id: sub, email: typeof email === "string" ? email : null };
      }
      if (error && (is4xx(error) || error.name === "AuthInvalidJwtError")) return { ok: false, status: 401 };
      // Anders: geen uitspraak → hieronder via getUser.
    }
  } catch (err) {
    console.warn("[auth] lokale JWT-verificatie niet mogelijk, terugvallen op getUser:", (err as Error)?.message ?? err);
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    authResult = await supabase.auth.getUser(token);
  } catch (err) {
    console.error("Auth-check onbereikbaar (throw):", err);
    return { ok: false, status: 503 };
  }
  const { data, error } = authResult;
  if (error) {
    // 4xx = het token zelf is verlopen/ongeldig → écht opnieuw aanmelden.
    // status 0 (netwerk/AuthRetryableFetchError), 5xx of onbekend = storing:
    // 503, zodat de client zijn sessie houdt en gewoon opnieuw probeert
    // (elke fout was eerst 401 → alle toestellen tegelijk uitgelogd, 29-30/07).
    if (is4xx(error)) return { ok: false, status: 401 };
    console.error("Auth-check-storing:", (error as { status?: number }).status, error.message);
    return { ok: false, status: 503 };
  }
  if (!data.user) return { ok: false, status: 401 };
  return { ok: true, id: data.user.id, email: data.user.email ?? null };
};

const getBearerToken = (req: express.Request) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
};

/**
 * Token → portaalprofiel. Sinds 05-09 (controle-ronde, security 7) is de
 * Auth-uid de identiteit: een profiel dat al gekoppeld is, wordt alleen op
 * `authId` gevonden. Het e-mailadres dient nog één keer, bij de eerste
 * aanmelding, om te koppelen (self-heal) — daarna kan iemand die zijn
 * Auth-e-mail wijzigt naar dat van een collega niet meer in diens profiel
 * terechtkomen ("koppeling" → 403).
 */
let koppelFoutGemeld = false;
const findAppUser = async (check: { id: string; email: string | null }): Promise<AppUserIntern | null | "koppeling"> => {
  // Gecachte lijst: de auth-hot-path draait bij elke request en hoeft niet
  // telkens de volledige users-tabel op te halen (zie userCache.ts).
  const users = (await getUsersCached()) as AppUserIntern[];
  const opAuth = users.find((user) => user.authId && user.authId === check.id);
  if (opAuth) return opAuth;

  const normalizedEmail = normalizeEmail(check.email);
  if (!normalizedEmail) return null;
  const opEmail = users.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
  if (!opEmail) return null;
  if (opEmail.authId && opEmail.authId !== check.id) return "koppeling";
  // Eerste aanmelding met dit Auth-account: koppelen (best-effort; mislukt
  // het, dan blijft e-mail deze keer de sleutel en proberen we het volgende
  // request opnieuw).
  try {
    await koppelAuthId(opEmail.id, check.id);
    invalidateUsersCache();
  } catch (err: any) {
    // Vóór de migratie 2026-09-05_users_authid.sql bestaat de kolom niet:
    // één keer melden, verder stil (e-mail blijft dan de sleutel).
    if (!koppelFoutGemeld) {
      koppelFoutGemeld = true;
      console.error("[auth] authId koppelen mislukt (migratie users.authid gedraaid?):", err?.message ?? err);
    }
  }
  return { ...opEmail, authId: check.id };
};

export const authenticate = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase Auth is niet geconfigureerd." });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ error: "Niet aangemeld." });
  }

  // Token-validatie: lokaal (getClaims/JWKS) met getUser als fallback — zie
  // verifieerToken. 401 = token zelf ongeldig/verlopen (client logt uit),
  // 503 = auth-dienst onbereikbaar (client houdt zijn sessie).
  const check = await verifieerToken(accessToken);
  if (check.ok === false) {
    if (check.status === 401) return res.status(401).json({ error: "Ongeldige sessie." });
    return res.status(503).json({ error: "Aanmeldcontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.", code: "auth_unavailable" });
  }
  const authUser = { id: check.id, email: check.email ?? undefined };

  const gevonden = await findAppUser({ id: check.id, email: check.email });
  if (gevonden === "koppeling") {
    return res.status(403).json({ error: "Dit profiel is aan een andere aanmelding gekoppeld. Neem contact op met de planning." });
  }
  const appUser = gevonden;
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
        console.error("Toestel-tabel ontbreekt, gate tijdelijk overgeslagen:", err);
        req.accessToken = accessToken;
        req.authUser = authUser;
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
  req.authUser = authUser;
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
