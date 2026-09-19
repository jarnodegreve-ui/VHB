import type express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabase } from "./db.js";
import { DEVICE_GATE_EXEMPT, DEVICE_GATE_SETTING_KEY, evaluateDeviceGate, isMissingTableError, type DeviceGateSetting } from "./deviceGate.js";
import { normalizeEmail } from "./helpers.js";
import { getAppSetting, koppelAuthId, noteerAanwezigheid, type UserDevice } from "./storage.js";
import { getDeviceCached } from "./_lib/deviceCache.js";
import { magSchrijven } from "./_lib/aanwezigheid.js";
import { getOnderhoud } from "./_lib/onderhoud.js";
import { beslisSchrijfblok, isSchrijfmethode, ONDERHOUD_FOUT } from "./_lib/onderhoudRegels.js";
import { bijUsersCacheWissel, epochStand, getUsersCached, invalidateUsersCache } from "./userCache.js";
import { maakSwrCache, SWR_STALE_MS } from "./_lib/swrCache.js";
import { isStafRol } from "./types.js";
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
//
// Sinds ronde 3 (19-09) stale-while-revalidate (api/_lib/swrCache.ts): na de
// TTL de oude waarde (max. 5 min) en verversen op de achtergrond, maar alleen
// zolang de gedeelde epoch nét geverifieerd en ongewijzigd is. De schakelaar
// omzetten verhoogt die epoch (meldDeviceGateWijziging), dus AANzetten geldt
// binnen ±2 s op elke instantie i.p.v. pas na haar TTL.
const gateSettingCache = maakSwrCache<boolean>(
  async () => {
    try {
      const setting = await getAppSetting<DeviceGateSetting>(DEVICE_GATE_SETTING_KEY);
      return setting?.enabled !== false;
    } catch {
      return true;
    }
  },
  { ttlMs: 30_000, staleMs: SWR_STALE_MS, epoch: epochStand },
);
export const isDeviceGateEnabled = (): Promise<boolean> => gateSettingCache.get();
/** Alleen de lokale cache wissen (tests, epoch-wissel). */
export const invalidateDeviceGateCache = () => { gateSettingCache.invalidate(); };
bijUsersCacheWissel(invalidateDeviceGateCache);
/** Na een wijziging via de API: lokaal meteen, elders via de gedeelde epoch. */
export const meldDeviceGateWijziging = () => {
  invalidateDeviceGateCache();
  invalidateUsersCache();
};

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

type TokenCheck = { ok: true; id: string; email: string | null; aal: "aal1" | "aal2" } | { ok: false; status: 401 | 503 };

/** 'aal2' alleen wanneer het token dat expliciet zegt; alles anders = aal1. */
const normaliseerAal = (v: unknown): "aal1" | "aal2" => (v === "aal2" ? "aal2" : "aal1");

/** Leest de `aal`-claim uit een al geverifieerd JWT (getUser-fallback geeft
 *  die niet terug). Alleen aanroepen ná verificatie, de payload wordt hier
 *  niet gecontroleerd. */
export const aalUitJwt = (token: string): "aal1" | "aal2" => {
  try {
    const deel = token.split(".")[1] ?? "";
    const json = Buffer.from(deel.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return normaliseerAal((JSON.parse(json) as { aal?: unknown }).aal);
  } catch {
    return "aal1";
  }
};

// --- Twee-stapsverificatie voor staf (verbeterronde 07-09, nr. 8) ---
// Supabase MFA (TOTP) geeft het JWT na de code de claim aal='aal2'. Met
// MFA_STAF=aan eist de API dat niveau voor planner/admin op alle routes,
// behalve de paden die nodig zijn om in te schrijven of de code in te
// voeren. Chauffeurs blijven buiten schot (toestel-whitelist is hun laag).
// Standaard uit: pas aanzetten nadat TOTP in het Supabase-dashboard aanstaat
// en de beheerder zichzelf heeft ingeschreven, anders sluit je jezelf buiten.
export const mfaStafVerplicht = (): boolean => (process.env.MFA_STAF ?? "uit").toLowerCase() === "aan";
export const MFA_EXEMPT = new Set(["/api/me", "/api/me/beveiliging", "/api/auth/session", "/api/devices/register", "/api/client-errors"]);
// isStafRol staat in api/types.ts (geen afhankelijkheden); hier opnieuw
// geëxporteerd zodat bestaande imports uit middleware blijven werken.
export { isStafRol };
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
    const auth = supabase.auth as unknown as { getClaims?: (jwt: string) => Promise<{ data: { claims?: { sub?: unknown; email?: unknown; aal?: unknown } } | null; error: { name?: string; status?: number; message?: string } | null }> };
    if (typeof auth.getClaims === "function") {
      const { data, error } = await auth.getClaims(token);
      const sub = data?.claims?.sub;
      if (!error && typeof sub === "string" && sub) {
        const email = data?.claims?.email;
        return { ok: true, id: sub, email: typeof email === "string" ? email : null, aal: normaliseerAal((data?.claims as { aal?: unknown } | undefined)?.aal) };
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
  return { ok: true, id: data.user.id, email: data.user.email ?? null, aal: aalUitJwt(token) };
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

  // Onderhoudsmodus met schrijfblok (api/_lib/onderhoudRegels.ts): zolang
  // de beheerder het blok aan heeft, krijgt elke schrijfactie van een
  // niet-admin 503 met code 'onderhoud' (de client toont één toast). Lezen
  // blijft werken; admins gaan altijd door. De instelling is 30 s gecacht en
  // wordt alleen bij schrijfmethodes geraadpleegd.
  if (isSchrijfmethode(req.method) && appUser.role !== "admin"
    && beslisSchrijfblok({ method: req.method, path: req.path, role: appUser.role, onderhoud: await getOnderhoud() })) {
    return res.status(503).json(ONDERHOUD_FOUT);
  }

  // Twee-stapsverificatie voor staf: zie mfaStafVerplicht hierboven.
  if (mfaStafVerplicht() && isStafRol(appUser.role) && check.aal !== "aal2" && !MFA_EXEMPT.has(req.path)) {
    return res.status(403).json({ error: "Twee-stapsverificatie is vereist voor dit account.", code: "mfa_required" });
  }

  // Toestel-whitelist, niet op de exempt-paden (registratie/sessie-
  // boekhouding). Chauffeurs: altijd. Planner/admin: alleen wanneer het
  // verzoek een toesteltoken draagt, en dan enkel om een expliciet
  // ingetrokken toestel tegen te houden (geen goedkeuring vereist, dus geen
  // lock-out). Zonder token blijft stafverkeer zonder extra query.
  //
  // Een geldig token is een 36-teken UUID. Alles langer dan 100 tekens is
  // onzin (en zou de PostgREST-URL kunnen opblazen → een geforceerde DB-fout
  // waarmee de gate anders te omzeilen was): behandel als onbekend toestel,
  // zónder DB-lookup.
  const rawToken = String(req.headers[DEVICE_TOKEN_HEADER] ?? "").trim();
  const deviceToken = rawToken.length > 0 && rawToken.length <= 100 ? rawToken : "";
  // Niet-staf (chauffeur én technieker) valt altijd onder de gate; staf
  // alleen wanneer het verzoek een toesteltoken draagt.
  const gateVanToepassing = !isStafRol(appUser.role) || deviceToken.length > 0;
  if (gateVanToepassing && !DEVICE_GATE_EXEMPT.has(req.path)) {
    let device: UserDevice | null = null;
    try {
      // Gecacht (30 s per instantie, gewist via de gedeelde epoch bij elke
      // toestelwijziging): zie de afweging in _lib/deviceCache.ts. Fouten
      // worden niet gecacht en komen hier ongewijzigd terecht.
      device = deviceToken ? await getDeviceCached(String(appUser.id), deviceToken) : null;
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
        req.aal = check.aal;
        return next();
      }
      console.error("Toestel-controle DB-fout (fail-closed):", err);
      return res.status(503).json({ error: "Toestel-controle is tijdelijk niet beschikbaar. Probeer het zo opnieuw.", code: "device_check_failed" });
    }

    // Alleen wanneer het toestel niet al goedgekeurd is maakt de schakelaar
    // het verschil, dan pas (gecacht) ophalen. Voor staf is de schakelaar
    // irrelevant (enkel de revoked-check telt), dus geen extra query.
    const gateEnabled = isStafRol(appUser.role) || device?.status === "approved" ? true : await isDeviceGateEnabled();
    const verdict = evaluateDeviceGate(appUser.role, req.path, device, gateEnabled);
    if (!verdict.allow) {
      return res.status(verdict.status ?? 403).json(verdict.body ?? { error: "Dit toestel heeft geen toegang.", code: "device_unknown" });
    }
    // Het opgezochte toestel meegeven: /api/me hoeft het dan niet nog eens
    // te queryen.
    req.device = device;
  }

  req.accessToken = accessToken;
  req.authUser = authUser;
  req.appUser = appUser;
  req.aal = check.aal;
  registreerAanwezigheid(appUser);
  next();
};

/**
 * Aanwezigheid bijhouden als bijwerking van een geslaagde authenticatie.
 *
 * Waarom hier en niet met een eigen hartslag vanuit de app: het portaal doet
 * toch al elke minuut een geauthenticeerd verzoek zolang het scherm zichtbaar
 * is (de onderhoud-poll, die zelf op visibilityState let). Meeliften kost dus
 * nul extra netwerkverzoeken, nul extra timers en nul batterij op de telefoon,
 * en "aanwezig" betekent automatisch "app op de voorgrond" in plaats van
 * "toestel ligt aan".
 *
 * Bewust ná de toestel-gate: op een niet-goedgekeurd toestel wordt er niets
 * vastgelegd, zodat een admin nooit iemand "actief" ziet die in werkelijkheid
 * een buitenstaander met gestolen inloggegevens is (zelfde regel als de
 * sessie-boekhouding in /api/auth/session).
 *
 * Fire-and-forget: geen await, dus het verzoek wacht er niet op en wordt geen
 * milliseconde trager. Elke fout wordt gesmoord, inclusief een ontbrekende
 * tabel wanneer de migratie nog niet gedraaid is.
 */
const registreerAanwezigheid = (appUser: { id: string | number; role: Role }) => {
  const id = String(appUser.id);
  if (!id || !magSchrijven(id)) return;
  void noteerAanwezigheid(id, appUser.role).catch(() => {
    // Aanwezigheid is een waarneming, geen functionaliteit: als ze niet
    // wegschrijft mag daar niets van te merken zijn.
  });
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
