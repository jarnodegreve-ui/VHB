import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import dotenv from "dotenv";

import { buildCalendar, type IcsEvent } from "./ics.js";
import { TABLE_PROBES } from "./schemaProbes.js";
import { computeDayGap, normalizeCode, resolveDayType, parseOverrides, encodeOverride, DEFAULT_DAY_TYPES, DEFAULT_WEEKDAYS, type DayTypeOverride, type DayGap } from "./coverageGaps.js";

// Gereserveerde sleutels in coverage_expectations om de weekdag-toewijzing en
// de uitzonderingen op te slaan — zo is er geen aparte tabel/migratie nodig.
// Ze worden nooit als echt dag-type getoond.
const COVERAGE_WEEKDAYS_KEY = "__weekdagen__";
const COVERAGE_OVERRIDES_KEY = "__uitzonderingen__";
// Behandel élke __...__ sleutel als gereserveerd: zo vervuilen ook oudere
// interne sleutels (bv. een vroegere __vakantieperiodes__) de dag-type-lijst niet.
const isReservedCoverageKey = (k: string) => /^__.+__$/.test(k);

import { sendLeaveDecisionEmail, sendEmail, sendWelcomeEmail, isSmtpConfigured, type LeaveDecisionAction } from "./email.js";
import { getVapidPublicKey, savePushSubscription, deletePushSubscriptionForUser, sendPushToUsers } from "./push.js";
import type { AppUser, AuthenticatedRequest } from "./types.js";
import { db, supabase, supabaseAdmin } from "./db.js";
import { authenticate, requireRole, isCronAuthorized, resolveOptionalUser } from "./middleware.js";
import { isMissingTableError } from "./deviceGate.js";
import { encryptOpensslCompatible } from "./backupCrypto.js";
import { symbolicateTopFrame } from "./symbolicate.js";
import { rateLimitMiddleware, clientErrorRateLimit } from "./rateLimit.js";
import { mountOcpiRoutes, getOcpiRegistration } from "./ocpi.js";
import { mountDeviceRoutes } from "./deviceRoutes.js";
import { invalidateUsersCache } from "./userCache.js";
import { normalizeEmail, parsePlanningMatrixXlsx, toRoleScopedUser, toLookupToken, matrixCodesForDate, isTakeoverCode, isDigestRuis, normalizeSwapType, TAKEOVER_CODES } from "./helpers.js";
import {
  applySwapsToPlanningRows,
  applySwapToPlanning,
  revertSwapFromPlanning,
  buildPlanningFromMatrix,
  getActivityLog,
  getLatestAuthEventAt,
  getLoginActivity,
  getCoverageExpectations,
  saveCoverageExpectations,
  getEntityHistory,
  getDiversionsData,
  getLeaveData,
  getPlanningCodesData,
  getPlanningData,
  getPlanningMatrixHistory,
  getPlanningMatrixRows,
  getServicesData,
  getSwapsData,
  getUpdatesData,
  getUpdateReadCounts,
  getUsersData,
  logActivity,
  markUpdatesRead,
  logClientError,
  getClientErrors,
  getClientErrorsSince,
  storeBackup,
  checkBackupIntegrity,
  pruneOldRecords,
  listUserDocuments,
  markUserDocumentOpened,
  getUserDocument,
  getRitblaadjeMeta,
  deleteAllDocumentsForUser,
  insertUserDocument,
  deleteUserDocument,
  DOCUMENTS_BUCKET,
  restoreFromBackup,
  replacePlanningData,
  replacePlanningAndMatrix,
  saveDiversionsData,
  saveLeaveData,
  savePlanningCodesData,
  savePlanningData,
  clearPlanningData,
  updateUserSessionMeta,
  bumpActiveSessions,
  getShiftById,
  savePlanningMatrixHistoryEntry,
  saveServicesData,
  saveSwapsData,
  saveUpdatesData,
  saveUsersData,
  DIVERSIONS_BUCKET,
  summarizeDiversionChanges,
  summarizePlanningCodeChanges,
  diffDiversionChanges,
  diffUpdateChanges,
  diffUserChanges,
  diffPlanningCodeChanges,
  summarizeServiceChanges,
  diffServiceChanges,
  summarizeTokens,
  summarizeUpdateChanges,
  summarizeUserChanges,
  isMissingDbFunction,
  logCronHeartbeat,
  getCronHeartbeats,
  getDevice,
  getPlanningNotes,
  upsertPlanningNote,
  deletePlanningNote,
  getLatestBackup,
} from "./storage.js";

dotenv.config();

console.log("Server starting in environment:", process.env.NODE_ENV);
console.log("Supabase URL present:", !!process.env.SUPABASE_URL);
console.log("Supabase Key present:", !!process.env.SUPABASE_ANON_KEY);
console.log("Supabase Service Role present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
// Zonder eigen secret is de agenda-feed uit (fail-closed, zie CAL_SECRET).
// Luid loggen: dit viel vroeger niet op omdat hij stil terugviel op de
// service-role-key en dus altijd "werkte".
if (!process.env.CALENDAR_FEED_SECRET) {
  console.warn("[config] CALENDAR_FEED_SECRET ontbreekt — de agenda-feed is uitgeschakeld. Zet hem in de env om abonneren weer mogelijk te maken.");
}

const app = express();
const PORT = 3000;

// CORS beperkt tot de eigen origins (prod, Vercel-previews van dit project,
// lokale dev) i.p.v. wildcard. De app draait same-origin, dus browsers hebben
// dit zelden nodig — maar wildcard liet elke website met een gestolen token
// cross-origin lezen. exposedHeaders: laat clients de custom response-headers
// lezen (revisie-check + 429-Retry-After).
// vhbportaal.com ontbrak: de app draait daar same-origin, dus browsers vragen
// er geen CORS voor — maar zodra iets wél een preflight doet (een tweede
// domein, een tool), stond het echte productiedomein er niet in.
// localhost staat er alleen buiten productie: op de live-deploy heeft niemand
// een legitieme reden om vanaf een lokale pagina te posten, en het scheelt een
// origin die een aanvaller op zijn eigen machine kan nabootsen.
const ALLOWED_ORIGINS: Array<string | RegExp> = [
  "https://vhbportaal.com",
  "https://www.vhbportaal.com",
  "https://vhb-five.vercel.app",
  /^https:\/\/vhb-[a-z0-9-]+-jarnodegreve-uis-projects\.vercel\.app$/,
  ...(process.env.VERCEL_ENV === "production" ? [] : [/^http:\/\/localhost:\d+$/]),
];
app.use(cors({ origin: ALLOWED_ORIGINS, exposedHeaders: ["X-Collection-Revision", "Retry-After"] }));
// 5 MB is eerlijk: Vercel kapt request-bodies sowieso op ~4,5 MB af — de
// oude 25mb-limiet wekte de indruk dat grotere uploads (PDF's, Excels) konden.
app.use(express.json({ limit: '5mb' }));

// Rem op tollende/vastgelopen clients — per ingelogde gebruiker (token),
// niet per IP, zodat het hele bedrijfsnetwerk achter één NAT niet samen één
// limiet deelt. Zie rateLimit.ts voor de serverless-nuance.
app.use("/api", rateLimitMiddleware);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// OCPI 2.2.1 (eMSP, read-only monitoring van ChargEye) — eigen token-auth,
// los van de Supabase-auth. Zie api/ocpi.ts.
mountOcpiRoutes(app);

// Toestel-whitelist (registratie + admin-beheer). Zie api/deviceRoutes.ts.
mountDeviceRoutes(app);

// Health check — publiek maar kaal: geen tabelstatussen/foutmeldingen/env
// naar buiten (info-disclosure). Gedetailleerde checks alleen voor admins.
app.get("/api/health", async (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/api/health/details", authenticate, requireRole("admin"), async (_req, res) => {
  let supabaseStatus = "not configured";
  const tables: Record<string, string> = {};

  if (supabase) {
    supabaseStatus = "configured";
    const checkTable = async (name: string) => {
      try {
        const { error } = await db!.from(name).select('*').limit(0);
        return error ? `Error: ${error.message}` : "OK";
      } catch (e: any) {
        return `Exception: ${e.message}`;
      }
    };
    tables.users = await checkTable('users');
    tables.planning = await checkTable('planning');
    tables.diversions = await checkTable('diversions');
    tables.services = await checkTable('services');
  }

  res.json({
    status: "ok",
    supabase: supabaseStatus,
    tables,
    // Zonder SMTP-gegevens logt sendEmail de mail alleen naar de console en
    // meldt 'ok' — dan lijkt alles te werken terwijl er niets vertrekt.
    // Daarom hier expliciet zichtbaar, mét de gebruikte afzender.
    smtp: isSmtpConfigured()
      ? { status: "configured", from: process.env.SMTP_FROM || process.env.SMTP_USER || "onbekend", host: process.env.SMTP_HOST || "onbekend" }
      : { status: "not configured", from: null, host: null },
    env: process.env.NODE_ENV,
    time: new Date().toISOString(),
  });
});

// Testmail naar de ingelogde admin zelf: de enige manier om te bevestigen dat
// de SMTP-gegevens écht kloppen. Geeft de rauwe serverfout terug (alleen aan
// admins) zodat een verkeerd wachtwoord/poort meteen te zien is.
app.post("/api/admin/test-email", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  const to = String(req.appUser?.email || "").trim();
  if (!to) {
    return res.status(400).json({ error: "Je account heeft geen e-mailadres; vul dat eerst in bij Gebruikersbeheer." });
  }
  if (!isSmtpConfigured()) {
    return res.status(400).json({
      error: "SMTP is niet geconfigureerd (SMTP_USER/SMTP_PASS ontbreken). Mails worden nu alleen gelogd, niet verstuurd.",
      smtpConfigured: false,
    });
  }
  const result = await sendEmail({
    to: [to],
    subject: "VHB Portaal — testmail",
    text: `Deze testmail bevestigt dat de mailinstellingen van het portaal werken.\n\nVerstuurd op ${new Date().toLocaleString("nl-BE", { timeZone: "Europe/Brussels" })}.`,
    html: `<p>Deze testmail bevestigt dat de mailinstellingen van het portaal werken.</p><p style="color:#64748b;font-size:12px">Verstuurd op ${new Date().toLocaleString("nl-BE", { timeZone: "Europe/Brussels" })}.</p>`,
    context: "test-email",
  });
  if (!result.ok) {
    return res.status(502).json({ error: result.error || "Verzenden mislukt — controleer host, poort, gebruiker en wachtwoord.", smtpConfigured: true });
  }
  res.json({ success: true, to, message: `Testmail verstuurd naar ${to}. Zie ook je spam-map.` });
});

// Schema-drift-detectie: migraties draait Jarno handmatig in de SQL Editor —
// deze route verifieert ná een deploy dat elke kolom/RPC waar de code op
// rekent ook écht bestaat (de sessie brak hier al 2× bijna op). Per tabel een
// select met expliciete kolomnamen (PostgREST valideert die), per RPC een
// probe-call. Toegang: admin-token of CRON_SECRET (voor een post-deploy curl).
app.get("/api/health/schema", async (req, res) => {
  if (!isCronAuthorized(req)) {
    // Geen cron-secret → normale admin-auth vereisen.
    return authenticate(req as AuthenticatedRequest, res, () => {
      const role = (req as AuthenticatedRequest).appUser?.role;
      if (role !== "admin") return res.status(403).json({ error: "Alleen voor admins." });
      runSchemaCheck(res).catch((err) => {
        console.error("Schema-check mislukt:", err);
        if (!res.headersSent) res.status(500).json({ ok: false, error: "Schema-check mislukt." });
      });
    });
  }
  runSchemaCheck(res).catch((err) => {
    console.error("Schema-check mislukt:", err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: "Schema-check mislukt." });
  });
});

const runSchemaCheck = async (res: express.Response) => {
  if (!db) return res.status(503).json({ ok: false, error: "Database niet geconfigureerd." });
  const missing: string[] = [];

  // Kolomlijsten gedeeld met de contracttest (src/schemaContract.test.ts):
  // zie api/schemaProbes.ts.
  for (const probe of TABLE_PROBES) {
    const { error } = await db.from(probe.table).select(probe.columns).limit(0);
    if (error) missing.push(`${probe.table}: ${error.message}`);
  }

  // RPC's: een probe met null-args. Bestaat de functie, dan weigert ze de
  // null-input met een eigen exception (≠ ontbreekt); PGRST202 = ontbreekt.
  const RPC_PROBES: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "replace_planning", args: { rows: null } },
    { name: "replace_planning_matrix_rows", args: { rows: null } },
    { name: "replace_planning_and_matrix", args: { matrix_rows: null, shifts: null } },
    { name: "bump_active_sessions", args: { uid: "__schema_probe__", delta: 0 } },
  ];
  for (const probe of RPC_PROBES) {
    const { error } = await db.rpc(probe.name, probe.args);
    if (error && isMissingDbFunction(error)) missing.push(`rpc ${probe.name}: ontbreekt (migratie niet gedraaid?)`);
  }

  // Cron-heartbeats: stale = ouder dan 2× het verwachte interval.
  const now = Date.now();
  const beats = await getCronHeartbeats(["backup", "error-digest", "ocpi-sync"]);
  const CRON_MAX_AGE_H: Record<string, number> = { backup: 48, "error-digest": 48, "ocpi-sync": 2 };
  const crons = Object.fromEntries(
    Object.entries(beats).map(([name, last]) => {
      const ageH = last ? (now - Date.parse(last)) / 36e5 : null;
      return [name, { last, stale: ageH === null ? true : ageH > (CRON_MAX_AGE_H[name] ?? 48) }];
    }),
  );

  res.json({ ok: missing.length === 0, missing, crons, time: new Date().toISOString() });
};

app.get("/api/me", authenticate, async (req: AuthenticatedRequest, res) => {
  res.json(req.appUser);
});

// Kalenderdag in Belgische tijd (server draait op UTC) — voor de per-dag-
// dedup van het 'Actief'-event bij sessie-herstel.
const brusselsDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });

app.post("/api/auth/session", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const action = req.body?.action;
    const currentUser = req.appUser;

    if (!currentUser || (action !== "start" && action !== "end" && action !== "resume")) {
      return res.status(400).json({ error: "Ongeldige sessieactie." });
    }

    // Dit pad is device-gate-exempt (login/logout moet kunnen vóór goed-
    // keuring), maar dat mag géén PII-luik zijn: op een niet-goedgekeurd
    // toestel geen volledig profiel (telefoon/mail/verlofBudget) teruggeven
    // en niets in het aanwezigheidslog schrijven — anders "ziet" de admin
    // een chauffeur actief terwijl het een buitenstaander met gestolen
    // inloggegevens is. Ontbrekende device-tabel = fail-open (zelfde regel
    // als de middleware-gate).
    let deviceApproved = true;
    if (currentUser.role === "chauffeur") {
      const rawToken = String(req.headers["x-device-token"] ?? "").trim();
      const deviceToken = rawToken.length > 0 && rawToken.length <= 100 ? rawToken : "";
      try {
        const device = deviceToken ? await getDevice(String(currentUser.id), deviceToken) : null;
        deviceApproved = device?.status === "approved";
      } catch (err) {
        deviceApproved = isMissingTableError(err);
      }
    }
    if (!deviceApproved) {
      // Minimaal antwoord dat de login-flow niet breekt (id+role+naam), maar
      // zonder contactgegevens of saldi; geen teller-/log-boekhouding.
      return res.json({ id: currentUser.id, name: currentUser.name, role: currentUser.role });
    }

    // 'resume' = app geopend met een nog geldige sessie (PWA-herstel, geen
    // nieuwe login). Zonder dit event was zo'n gebruiker onzichtbaar in
    // "Actieve gebruikers per dag" — de grafiek telde alleen wie opnieuw
    // moest inloggen. Max. één 'Actief'-event per gebruiker per dag; raakt
    // de sessieteller en lastLogin niet aan.
    if (action === "resume") {
      const latestAuthEventAt = await getLatestAuthEventAt(String(currentUser.id));
      const today = brusselsDay(new Date().toISOString());
      if (!latestAuthEventAt || brusselsDay(latestAuthEventAt) !== today) {
        await logActivity(req, "auth", "Actief", `${currentUser.name} was actief op het portaal.`, { type: "user", id: String(currentUser.id) });
      }
      return res.json(currentUser);
    }

    // Teller atomair bijwerken (RPC) i.p.v. read-modify-write op de gecachte
    // waarde — anders telt het mis bij ~gelijktijdig in/uitloggen.
    await bumpActiveSessions(String(currentUser.id), action === "start" ? 1 : -1);
    // ISO opslaan (was een nl-BE-string in UTC-servertijd → stond 1-2u fout
    // en sorteerde niet); de client formatteert naar Belgische tijd.
    const lastLogin = action === "start" ? new Date().toISOString() : currentUser.lastLogin;
    if (action === "start") {
      await updateUserSessionMeta(String(currentUser.id), { lastLogin });
      // Login-event vastleggen: lastLogin wordt overschreven, maar de
      // activiteitenlog bewaart elke aanmelding apart → historiek "wie wanneer"
      // + basis voor het per-dag-actieve-gebruikers-overzicht. Dedup binnen
      // 10 minuten: 'start' is anders onbeperkt herhaalbaar en daarmee was
      // het aanwezigheidslog te vervuilen (controle-ronde #31); een échte
      // her-login binnen 10 min verliest hooguit één historiekregel.
      const latestAuthEventAt = await getLatestAuthEventAt(String(currentUser.id));
      const tenMinAgo = Date.now() - 10 * 60 * 1000;
      if (!latestAuthEventAt || new Date(latestAuthEventAt).getTime() < tenMinAgo) {
        await logActivity(req, "auth", "Aangemeld", `${currentUser.name} meldde zich aan.`, { type: "user", id: String(currentUser.id) });
      }
    }
    // Optimistische teller in de respons (exact-genoeg voor weergave; de
    // DB-waarde is gezaghebbend en nu wél race-vrij).
    const nextUser: AppUser = {
      ...currentUser,
      lastLogin,
      activeSessions: action === "start"
        ? (currentUser.activeSessions || 0) + 1
        : Math.max(0, (currentUser.activeSessions || 1) - 1),
    };
    res.json(nextUser);
  } catch (error: any) {
    console.error("Kon sessie niet bijwerken.", error);
    res.status(500).json({ error: "Kon sessie niet bijwerken." });
  }
});

app.post("/api/admin/users/reset-password", authenticate, requireRole("admin"), async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    }

    const userId = String(req.body?.userId || "");
    const password = String(req.body?.password || "");
    if (!userId || password.length < 6) {
      return res.status(400).json({ error: "Geef een gebruiker en een wachtwoord van minstens 6 tekens." });
    }

    const users = await getUsersData();
    const targetUser = users.find((user) => String(user.id) === userId);
    if (!targetUser?.email) {
      return res.status(404).json({ error: "Gebruiker met e-mailadres niet gevonden." });
    }

    const { data: authPage, error: authListError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (authListError) throw authListError;

    // Expliciete cast: Vercel's function-builder typeert authPage.users soms
    // als never[] (striktere TS/supabase-types dan lokaal/CI) → bouwfout. De
    // cast maakt de vorm versie-onafhankelijk.
    const authUsers = (authPage?.users ?? []) as Array<{ id: string; email?: string | null }>;
    const authUser = authUsers.find((user) => normalizeEmail(user.email) === normalizeEmail(targetUser.email));
    if (!authUser) {
      return res.status(404).json({ error: "Geen gekoppeld auth-account gevonden." });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password });
    if (error) throw error;

    await logActivity(req, "auth", "Wachtwoord gereset", `Wachtwoord opnieuw ingesteld voor ${targetUser.name}.`, { type: "user", id: targetUser.id });
    res.json({ success: true });
  } catch (error: any) {
    console.error("Wachtwoord reset mislukt.", error);
    res.status(500).json({ error: "Wachtwoord reset mislukt." });
  }
});

app.get("/api/planning", authenticate, async (req, res) => {
  try {
    // Optionele filters: ?driverId=X of ?month=YYYY-MM laten de client
    // gericht ophalen i.p.v. de hele tabel — drastisch minder data over
    // het draad voor mobile en maandprint.
    const driverId = typeof req.query.driverId === "string" && req.query.driverId.trim()
      ? req.query.driverId.trim()
      : undefined;
    const monthIso = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : undefined;
    const data = await getPlanningData({ driverId, monthIso });
    // Revisie alleen over de volledige collectie (ongefilterd) — een revisie
    // over een subset zou bij het opslaan altijd een vals conflict geven.
    if (!driverId && !monthIso) {
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
    }
    res.json(data);
  } catch (err) {
    console.error("Error reading planning data:", err);
    res.status(500).json({ error: "Gegevens laden is mislukt." });
  }
});

// === Agenda-abonnement (.ics-feed) =========================================
// Chauffeurs abonneren hun diensten in Google/Apple Agenda via een
// persoonlijke, token-beveiligde URL die de agenda-app periodiek ophaalt
// (auto-update). De token is een HMAC over het user-id met een server-
// secret — stateless, geen DB-kolom nodig. De feed bevat enkel de eigen
// diensten (geen gevoelige data), maar behandel de URL als privé.
// Bewust GEEN anon-key in de fallback-keten: die zit publiek in de
// frontend-bundle en zou token-forging mogelijk maken zodra de service-
// role-key ontbreekt. Ook GEEN hardcoded fallback-secret meer (stond in de
// publieke repo → tokens waren forgebaar zodra beide env-vars ontbraken):
// zonder secret is de feed gewoon uitgeschakeld (fail-closed).
// GEEN terugval meer op SUPABASE_SERVICE_ROLE_KEY. Die terugval maakte de
// service-role-key tot ondertekensleutel van elke agenda-feed: één gelekte
// feed-URL intrekken zou betekenen dat je de sleutel van je hele database
// roteert. Nu fail-closed op een eigen secret — staat CALENDAR_FEED_SECRET
// niet in de env, dan is de feed simpelweg uit (en meldt /api/health dat).
const CAL_SECRET = process.env.CALENDAR_FEED_SECRET || null;

const calendarToken = (userId: string) => {
  if (!CAL_SECRET) return null;
  return crypto.createHmac("sha256", CAL_SECRET).update(`calendar:${userId}`).digest("hex");
};

const verifyCalendarToken = (userId: string, token: string) => {
  const expected = calendarToken(userId);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Persoonlijke abonnee-links voor de ingelogde gebruiker.
app.get("/api/calendar-url", authenticate, async (req: AuthenticatedRequest, res) => {
  const u = req.appUser;
  if (!u) return res.status(401).json({ error: "Niet aangemeld." });
  const userId = String(u.id);
  const token = calendarToken(userId);
  if (!token) return res.status(503).json({ error: "Agenda-feed is niet geconfigureerd op de server." });
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const feedPath = `/api/calendar/${encodeURIComponent(userId)}/${token}.ics`;
  const url = `${proto}://${host}${feedPath}`;
  const webcal = `webcal://${host}${feedPath}`;
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  res.json({ url, webcal, googleUrl });
});

// De feed zelf — GEEN bearer-auth (agenda-apps sturen geen headers); de
// token in de URL authenticeert. Geeft text/calendar terug.
app.get("/api/calendar/:userId/:token", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    const token = String(req.params.token || "").replace(/\.ics$/i, "");
    if (!userId || !verifyCalendarToken(userId, token)) {
      return res.status(404).send("Not found");
    }
    const [shifts, users, leave] = await Promise.all([
      getPlanningData({ driverId: userId }),
      getUsersData(),
      getLeaveData(),
    ]);
    const user = users.find((u: any) => String(u.id) === userId);
    // Gedeactiveerde/verwijderde medewerkers verliezen hun feed (de token
    // is stateless en kan niet ingetrokken worden — dit is de check).
    if (!user || user.isActive === false) {
      return res.status(404).send("Not found");
    }
    // Dienstnotities meesturen in de agenda-beschrijving (best-effort:
    // zonder tabel gewoon geen notities).
    let noteByDate = new Map<string, string>();
    try {
      const dates = (shifts as any[]).map((s) => String(s.date)).sort();
      if (dates.length > 0) {
        const notes = await getPlanningNotes({ fromIso: dates[0], toIso: dates[dates.length - 1], driverId: userId });
        noteByDate = new Map(notes.map((n) => [n.date, n.note]));
      }
    } catch { /* notities zijn nice-to-have in de feed */ }
    // Rijen zonder tijden overslaan: de 00:00-fallback werd door de
    // eind≤start-regel van buildVevent een 24-uursblok in de agenda.
    const events: IcsEvent[] = (shifts as any[]).filter((s) => s.startTime && s.endTime).map((s) => ({
      uid: `vhb-shift-${s.id}@vhb-portaal`,
      date: String(s.date),
      startTime: String(s.startTime),
      endTime: String(s.endTime),
      summary: `Dienst ${String(s.line || s.serviceNumber || "").trim()}`.trim(),
      description: [s.busNumber && `Bus ${s.busNumber}`, s.loopnr && `Loop ${s.loopnr}`, noteByDate.get(String(s.date)) && `Notitie: ${noteByDate.get(String(s.date))}`]
        .filter(Boolean)
        .join(" · ") || undefined,
    }));
    // Goedgekeurd verlof/ziekte als hele-dag-gebeurtenissen — zo is de agenda
    // compleet (dienst + afwezigheid) i.p.v. alleen de diensten.
    const leaveLabel: Record<string, string> = { betaald_verlof: "Verlof", klein_verlet: "Klein verlet", ziekte: "Ziek" };
    for (const l of leave as any[]) {
      if (String(l.userId) !== userId || l.status !== "approved") continue;
      events.push({
        uid: `vhb-leave-${l.id}@vhb-portaal`,
        date: String(l.startDate),
        endDate: String(l.endDate || l.startDate),
        startTime: "00:00",
        endTime: "00:00",
        allDay: true,
        summary: leaveLabel[l.type] ?? "Afwezig",
        // Bewust ZONDER l.comment: dat is vrije tekst met de reden (ziekte,
        // overlijden, familiale situatie). De feed-URL is stateless en niet
        // in te trekken, en wie 'm in Google Agenda zet, laat Google die
        // tekst periodiek ophalen en bewaren. Het type-label volstaat.
      });
    }
    const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const calName = user?.name ? `VHB Diensten — ${user.name}` : "VHB Diensten";
    const ics = buildCalendar(events, { calName, dtstamp });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="vhb-diensten.ics"');
    res.setHeader("Cache-Control", "no-cache, max-age=0");
    res.send(ics);
  } catch (err) {
    console.error("Error building calendar feed:", err);
    res.status(500).send("error");
  }
});

app.post("/api/planning", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      if (newData.length === 0) {
        // Volledige wipe is een bewuste, zware actie ('Planning wissen'):
        // alleen admin, en expliciet — nooit als bijwerking van een lege save.
        if (req.appUser?.role !== "admin") {
          return res.status(403).json({ error: "Alleen een admin kan de volledige planning wissen." });
        }
        await clearPlanningData();
        await logActivity(req, "planning", "Planning gewist", "De volledige actieve planning is gewist.");
        return res.json({ success: true, count: 0 });
      }
      // Optimistic-concurrency + wipe-detectie: een stale volledige-array-save
      // (bv. planner B saved terwijl A net een maand importeerde) verwijderde
      // anders stilletjes alles wat B nog niet gezien had.
      const previousPlanning = await getPlanningData();
      if (revisionConflict(req, previousPlanning)) return revisionConflictResponse(res, "De planning");
      const shiftsRemoved = detectMassDelete(previousPlanning, newData);
      if (shiftsRemoved !== null) return massDeleteResponse(res, shiftsRemoved, previousPlanning.length, "diensten");
      await savePlanningData(newData);
      await logActivity(
        req,
        "planning",
        "Planning opgeslagen",
        `${newData.length} planningregels handmatig opgeslagen. Voorbeeld: ${summarizeTokens(newData.map((shift: any) => `dienst ${shift.line || shift.id}`))}.`,
      );
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getPlanningData()));
      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving planning data:", errorMessage);
    console.error("Opslaan is mislukt.", errorMessage);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

// Beschikbaarheid per dag — voor het bezettingsoverzicht + dienstruil-
// matching. Geeft minimale data terug (per dag: wie rijdt / op verlof /
// vrij) zodat ook chauffeurs (die normaal enkel hun eigen shifts zien)
// kunnen zien wie er vrij is om mee te ruilen. Geen shift-details, enkel
// driver-ids + namen. Toegankelijk voor alle ingelogde gebruikers.
app.get("/api/availability", authenticate, async (req, res) => {
  try {
    const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : undefined;
    const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : undefined;
    if (!from || !to || from > to) {
      return res.status(400).json({ error: "Geef geldige from/to-datums (YYYY-MM-DD), met from <= to." });
    }
    // Expliciete fout i.p.v. stilletjes afkappen: een afgekapt antwoord
    // leek compleet en gaf foute bezettingsbeelden.
    const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
    if (spanDays > 120) {
      return res.status(400).json({ error: "Bereik te groot: maximaal 120 dagen per aanvraag." });
    }

    // Datums in [from, to] enumereren (guard van 120 dagen tegen runaway).
    const dates: string[] = [];
    {
      const cursor = new Date(`${from}T00:00:00Z`);
      const end = new Date(`${to}T00:00:00Z`);
      let guard = 0;
      while (cursor <= end && guard < 120) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        guard++;
      }
    }
    if (dates.length === 0) return res.json({ from, to, drivers: [], days: [] });

    // Ruil zonder tegenprestatie: enkel op expliciete vraag (?takeover=1),
    // want dit vergt de volledige planning-matrix erbij — die hoeft het
    // bezettingsoverzicht (tot 120 dagen) niet te betalen.
    const wantTakeover = req.query.takeover === "1" || req.query.takeover === "true";

    const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
    const [users, leave, matrixRows] = await Promise.all([
      getUsersData(),
      getLeaveData(),
      wantTakeover ? getPlanningMatrixRows() : Promise.resolve([]),
    ]);
    const shiftChunks = await Promise.all(months.map((m) => getPlanningData({ monthIso: m })));
    const shifts = shiftChunks.flat().filter((s: any) => s.date >= from && s.date <= to);

    const chauffeurs = users
      .filter((u: any) => u.isActive !== false && u.role === "chauffeur" && String(u.name).toLowerCase() !== "beheerder")
      .map((u: any) => ({ id: String(u.id), name: u.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const chauffeurIds = new Set(chauffeurs.map((c) => c.id));
    const approvedLeave = leave.filter((l: any) => l.status === "approved");

    const days = dates.map((date) => {
      const working = new Set<string>();
      // Per werkende chauffeur het dienst-/lijnnummer (voor het maandrooster).
      // Meerdere diensten op één dag → samengevoegd met '/'.
      const lines: Record<string, string> = {};
      for (const s of shifts) {
        if (s.date === date && chauffeurIds.has(String(s.driverId))) {
          const id = String(s.driverId);
          working.add(id);
          const line = String(s.line ?? "").trim() || "•";
          // Gesplitste dienst = meerdere planning-rijen met hetzelfde nummer:
          // dedupliceren, anders wordt het "4101/4101" (en zo als returnCode
          // op een dienstruil opgeslagen).
          const seen = lines[id] ? lines[id].split("/") : [];
          if (!seen.includes(line)) lines[id] = [...seen, line].join("/");
        }
      }
      const onLeave = new Set<string>();
      for (const l of approvedLeave) {
        if (String(l.startDate) <= date && date <= String(l.endDate) && chauffeurIds.has(String(l.userId))) {
          onLeave.add(String(l.userId));
        }
      }
      const free = chauffeurs.filter((c) => !working.has(c.id) && !onLeave.has(c.id)).map((c) => c.id);
      const day: Record<string, unknown> = { date, working: Array.from(working), leave: Array.from(onLeave), free, lines };
      if (wantTakeover) {
        // Wie mag die dag een dienst overnemen zónder tegenprestatie: staat
        // in de planning op vrij/bv/tk/ta én rijdt zelf geen dienst. Waarde =
        // de code, zodat de UI kan tonen wáárom ('bv' leest anders dan 'vrij').
        // Dezelfde regel als de server-validatie in POST /api/swaps.
        const takeover: Record<string, string> = {};
        for (const [driverId, code] of matrixCodesForDate(matrixRows, chauffeurs, date)) {
          if (!chauffeurIds.has(driverId) || working.has(driverId)) continue;
          if (isTakeoverCode(code)) takeover[driverId] = code.toLowerCase();
        }
        day.takeover = takeover;
      }
      return day;
    });

    res.json({ from, to, drivers: chauffeurs, days });
  } catch (err: any) {
    console.error("Error computing availability:", err);
    res.status(500).json({ error: "Kon beschikbaarheid niet berekenen." });
  }
});

// Read-only maandplanning voor iedereen — de geïmporteerde planning-matrix
// (chauffeur × datum met codes) zoals die in het chauffeurslokaal hangt.
// Server resolved per cel het type (dienst/verlof/afwezig/opleiding) via
// services + planningcodes, en geeft een compacte, render-klare payload.
app.get("/api/month-planning", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
    if (!month) return res.status(400).json({ error: "Geef een geldige maand (YYYY-MM)." });

    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const [rows, users, services, codes, leave] = await Promise.all([
      getPlanningMatrixRows(),
      getUsersData(),
      getServicesData(),
      getPlanningCodesData(),
      getLeaveData(),
    ]);

    const monthRows = rows
      .filter((r: any) => String(r.source_date ?? "").startsWith(`${month}-`))
      .sort((a: any, b: any) => String(a.source_date).localeCompare(String(b.source_date)));
    const dates = monthRows.map((r: any) => String(r.source_date));

    // Naam- en code-resolutie identiek aan buildPlanningFromMatrix (toLookupToken
    // strikt: accenten/interpunctie/hoofdletters genormaliseerd). Anders kreeg
    // /month-planning lege of foute cellen voor accent-/omgekeerde namen en
    // toonde een dienst met scheidingsteken als 'onbekend'.
    const sortedNameToken = (name: string) =>
      toLookupToken(name).split(/\s+/).filter(Boolean).sort().join(" ");
    // Groepering + volgorde per sectie (uit users.section, gezet in het
    // gebruikersbeheer — staat los van de Excel-import). Onbekende/lege sectie
    // sorteert achteraan; binnen een sectie op anciënniteit (vroegste startdatum
    // eerst, uit users.startDate), naam als tiebreak. Chauffeurs zonder
    // startdatum sorteren onderaan binnen hun sectie.
    const SECTION_ORDER = ["Reguliere", "Nacht", "Flexi", "Schoolvervoer"];
    const sectionRank = (s: string) => {
      const i = SECTION_ORDER.findIndex((x) => x.toLowerCase() === s.trim().toLowerCase());
      return i === -1 ? SECTION_ORDER.length : i;
    };
    const seniorityKey = (d: string) => d || "9999-12-31"; // geen startdatum → achteraan
    const chauffeurs = users
      .filter((u: any) => u.isActive !== false && u.role === "chauffeur" && norm(u.name) !== "beheerder")
      .map((u: any) => ({ id: String(u.id), name: u.name as string, section: String(u.section ?? "").trim(), startDate: String(u.startDate ?? "").trim() }))
      .sort((a, b) =>
        sectionRank(a.section) - sectionRank(b.section)
        || seniorityKey(a.startDate).localeCompare(seniorityKey(b.startDate))
        || a.name.localeCompare(b.name),
      );
    // Volgorde-onafhankelijke index: zowel "Jan Janssen" als "Janssen Jan" matcht.
    const idByNameKey = new Map<string, string>();
    for (const c of chauffeurs) {
      idByNameKey.set(toLookupToken(c.name), c.id);
      idByNameKey.set(sortedNameToken(c.name), c.id);
    }

    // Code-resolutie — zelfde token-normalisatie als de matrix-import.
    // We geven ook label + uren-segmenten mee zodat de UI per cel een
    // detail kan tonen zonder de services/codes naar elke client te sturen.
    const serviceByNorm = new Map(services.map((s: any) => [toLookupToken(s.serviceNumber), s]));
    const codeByNorm = new Map(codes.map((c: any) => [toLookupToken(c.code), c]));
    // Loopnummer hoort bij het blok (het deel van de dienst waaronder
    // bepaalde ritten vallen), dus toon het meteen bij de uren.
    const withLoop = (times: string, loopnr: unknown) => {
      const loop = String(loopnr ?? "").trim();
      return loop ? `${times} (loop ${loop})` : times;
    };
    const segmentsOf = (s: any): string[] => [
      s.startTime && s.endTime ? withLoop(`${s.startTime} - ${s.endTime}`, s.loopnr) : "",
      s.startTime2 && s.endTime2 ? withLoop(`${s.startTime2} - ${s.endTime2}`, s.loopnr2) : "",
      s.startTime3 && s.endTime3 ? withLoop(`${s.startTime3} - ${s.endTime3}`, s.loopnr3) : "",
    ].filter(Boolean);
    const resolve = (code: string): { kind: string; label: string; segments: string[] } | null => {
      const n = toLookupToken(code);
      if (!n) return null;
      const svc = serviceByNorm.get(n);
      if (svc) return { kind: "service", label: `Dienst ${svc.serviceNumber}`, segments: segmentsOf(svc) };
      const pc = codeByNorm.get(n);
      if (pc) return { kind: String(pc.category), label: pc.description || String(pc.code).toUpperCase(), segments: [] };
      return { kind: "unknown", label: "Onbekende code", segments: [] };
    };

    // BEWUSTE KEUZE (Jarno, 01-08-2026): afwezigheidscodes — ziekte incluis —
    // blijven voor iedereen zichtbaar, gelijk aan de fysieke planning in het
    // chauffeurslokaal. Er is kort een maskering voor chauffeurs actief geweest
    // (zie #290); die is er op verzoek weer uit gehaald omdat het digitale
    // scherm niet strenger hoeft te zijn dan het bord waar iedereen langsloopt.
    //
    // Ziekte is wél een bijzondere categorie persoonsgegevens (AVG art. 9), dus
    // dit is een openstaande keuze en geen afgesloten dossier — Jarno bekijkt
    // het later opnieuw, dan samen met het bord. Voer het tot die tijd NIET
    // opnieuw op als bevinding. De maskering terugzetten is klein werk: de
    // implementatie staat in commit f2a9b33 (helpers: HEALTH_CODES /
    // isHealthCode, hier: één ternary op de cel).
    const cells: Record<string, Record<string, { code: string; kind: string; label: string; segments: string[] }>> = {};
    for (const row of monthRows) {
      const date = String(row.source_date);
      const assignments = row.assignments && typeof row.assignments === "object" && !Array.isArray(row.assignments) ? row.assignments : {};
      for (const [driverName, rawCode] of Object.entries(assignments)) {
        const id = idByNameKey.get(toLookupToken(driverName)) ?? idByNameKey.get(sortedNameToken(driverName));
        if (!id) continue;
        const code = String(rawCode ?? "").trim();
        if (!code) continue;
        const r = resolve(code);
        if (!r) continue;
        if (!cells[id]) cells[id] = {};
        cells[id][date] = { code, kind: r.kind, label: r.label, segments: r.segments };
      }
    }

    // Goedgekeurde afwezigheden uit de verlof-module (ziekmelding incluis)
    // overschrijven de matrix-cel. De Excel-import is een momentopname; wie
    // dáárna ziek gemeld wordt, stond in het maandrooster nog gewoon op zijn
    // dienst — terwijl de ziekmeldings-mail belooft dat de dienst als
    // onbeschikbaar zichtbaar is. De overlay gebruikt de bestaande matrix-
    // codes (ziek/bv/kv), dus de weergave is identiek aan een code die via
    // de Excel zelf binnenkwam. Overschrijven per dag, alleen op dagen die
    // een matrix-rij hebben — kolommen zonder rij rendert de UI toch niet.
    const LEAVE_CODE: Record<string, string> = { ziekte: "ziek", betaald_verlof: "bv", klein_verlet: "kv" };
    const LEAVE_FALLBACK: Record<string, { kind: string; label: string }> = {
      ziekte: { kind: "absence", label: "Ziek" },
      betaald_verlof: { kind: "leave", label: "Betaald Verlof" },
      klein_verlet: { kind: "absence", label: "Klein Verlet" },
    };
    const chauffeurIds = new Set(chauffeurs.map((c) => c.id));
    for (const l of leave as any[]) {
      if (l?.status !== "approved") continue;
      const id = String(l.userId ?? "");
      if (!chauffeurIds.has(id)) continue;
      const code = LEAVE_CODE[String(l.type)] ?? "ziek";
      const r = resolve(code) ?? LEAVE_FALLBACK[String(l.type)] ?? LEAVE_FALLBACK.ziekte;
      // resolve() kan 'unknown' geven als de code niet in planning_codes
      // staat — dan wint de fallback, anders leest de cel als 'Onbekende code'.
      const cel = r.kind === "unknown" ? { ...LEAVE_FALLBACK[String(l.type)] ?? LEAVE_FALLBACK.ziekte, segments: [] as string[] } : r;
      for (const date of dates) {
        if (String(l.startDate) <= date && date <= String(l.endDate)) {
          if (!cells[id]) cells[id] = {};
          cells[id][date] = { code, kind: cel.kind, label: cel.label, segments: [] };
        }
      }
    }

    res.json({ month, dates, drivers: chauffeurs.map((c) => ({ id: c.id, name: c.name, section: c.section || null })), cells });
  } catch (err: any) {
    console.error("Error computing month planning:", err);
    res.status(500).json({ error: "Kon maandplanning niet berekenen." });
  }
});

// === Dekking: verwachte diensten per dag-type + niet-ingevulde diensten ===
// Config + gaten-overzicht voor planner/admin. Een "gat" = een verwachte
// dienst (ingesteld per dag-type) die op een dag door niemand is ingevuld.
app.get("/api/coverage-expectations", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const [stored, services] = await Promise.all([
      getCoverageExpectations(),
      getServicesData(),
    ]);
    // Reserved keys eruit halen: de weekdag-toewijzing en de uitzonderingen.
    const weekdaysRaw = Array.isArray(stored[COVERAGE_WEEKDAYS_KEY]) ? stored[COVERAGE_WEEKDAYS_KEY] : null;
    const weekdays = weekdaysRaw && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? "")) : [...DEFAULT_WEEKDAYS];
    const overrides = parseOverrides(stored[COVERAGE_OVERRIDES_KEY]);
    // De overige sleutels zijn de zelf-gedefinieerde dag-types + hun diensten.
    const dayTypeEntries = Object.entries(stored).filter(([k]) => !isReservedCoverageKey(k));
    const dayTypes = dayTypeEntries.length > 0
      ? dayTypeEntries
          .map(([name, svcs]) => ({ name, services: Array.isArray(svcs) ? svcs : [] }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : DEFAULT_DAY_TYPES.map((name) => ({ name, services: [] as string[] }));
    const serviceNumbers = Array.from(
      new Set((services as any[]).map((s) => String(s.serviceNumber ?? "").trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    res.json({ services: serviceNumbers, dayTypes, weekdays, overrides });
  } catch (err) {
    console.error("Error reading coverage expectations:", err);
    res.status(500).json({ error: "Kon dekkingsinstellingen niet laden." });
  }
});

app.put("/api/coverage-expectations", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const rawDayTypes = Array.isArray(req.body?.dayTypes) ? req.body.dayTypes : null;
    if (!rawDayTypes) {
      return res.status(400).json({ error: "Verwacht { dayTypes: [{ name, services }], weekdays, overrides }." });
    }
    const clean: Record<string, string[]> = {};
    const validNames = new Set<string>();
    for (const dt of rawDayTypes) {
      const name = String(dt?.name ?? "").trim();
      // Lege namen en gereserveerde (__...__) sleutels overslaan; eerste wint bij dubbel.
      if (!name || isReservedCoverageKey(name) || validNames.has(name)) continue;
      validNames.add(name);
      clean[name] = Array.isArray(dt?.services) ? dt.services.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
    }
    // Weekdag-toewijzing: precies 7 strings (dow 0=zo..6=za); alleen bestaande
    // dag-type-namen toelaten, anders leeg.
    const rawWeekdays = Array.isArray(req.body?.weekdays) ? req.body.weekdays : [];
    const weekdays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const v = String(rawWeekdays[i] ?? "").trim();
      weekdays.push(validNames.has(v) ? v : "");
    }
    clean[COVERAGE_WEEKDAYS_KEY] = weekdays;
    // Uitzonderingen: geldige range + bestaand dag-type, opgeslagen als string.
    const rawOverrides = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
    const overrideStrings: string[] = [];
    for (const o of rawOverrides) {
      const from = String(o?.from ?? "").trim();
      const to = String(o?.to ?? "").trim();
      const dayType = String(o?.dayType ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
      if (!validNames.has(dayType)) continue;
      overrideStrings.push(encodeOverride({ from, to, dayType } as DayTypeOverride));
    }
    clean[COVERAGE_OVERRIDES_KEY] = overrideStrings;
    await saveCoverageExpectations(clean);
    await logActivity(req, "planning", "Dekkingsinstellingen bijgewerkt", "Dag-types, weekdag-toewijzing en/of uitzonderingen aangepast.", undefined);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error saving coverage expectations:", err);
    res.status(500).json({ error: err?.message || "Opslaan mislukt. Bestaat de tabel coverage_expectations al?" });
  }
});

app.get("/api/coverage-gaps", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ error: "Geef een geldige periode (from/to als YYYY-MM-DD)." });
    }
    const [stored, rows, usersForLeave, leaveAll] = await Promise.all([
      getCoverageExpectations(),
      getPlanningMatrixRows(),
      getUsersData(),
      getLeaveData(),
    ]);
    // Zelfde weekdag-toewijzing + uitzonderingen als bij het instellen, zodat
    // het dag-type per dag consistent bepaald wordt.
    const weekdaysRaw = Array.isArray(stored[COVERAGE_WEEKDAYS_KEY]) ? stored[COVERAGE_WEEKDAYS_KEY] : null;
    const weekdays = weekdaysRaw && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? "")) : [...DEFAULT_WEEKDAYS];
    const overrides = parseOverrides(stored[COVERAGE_OVERRIDES_KEY]);
    // Goedgekeurde afwezigheden: de matrix-cel van die chauffeur telt die dag
    // niet mee als invulling — zijn dienst valt dus (terecht) als gat uit de
    // dekking. Matrix-cellen zijn op náám, leave op user-id; zelfde
    // volgorde-onafhankelijke naam-resolutie als /api/month-planning.
    const approvedLeaveAll = (leaveAll as any[]).filter((l) => l?.status === "approved");
    const idByNameToken = new Map<string, string>();
    const userNameById = new Map<string, string>();
    for (const u of usersForLeave as any[]) {
      if (u?.role !== "chauffeur") continue;
      const token = toLookupToken(String(u.name ?? ""));
      idByNameToken.set(token, String(u.id));
      idByNameToken.set(token.split(/\s+/).filter(Boolean).sort().join(" "), String(u.id));
      userNameById.set(String(u.id), String(u.name ?? ""));
    }
    const UITVAL_REDEN: Record<string, string> = { ziekte: "ziek", betaald_verlof: "verlof", klein_verlet: "klein verlet" };
    const inRange = rows
      .filter((r: any) => {
        const d = String(r.source_date ?? "");
        return d >= from && d <= to;
      })
      .sort((a: any, b: any) => String(a.source_date).localeCompare(String(b.source_date)));
    const days: DayGap[] = inRange.map((r: any) => {
      const date = String(r.source_date ?? "");
      const dayType = resolveDayType(r.day_type, date, weekdays, overrides);
      const expected = stored[dayType] || [];
      // Afwezige chauffeurs mét hun reden — de reden reist mee naar de tegel
      // ("4407 · Pascal · ziek"), zodat de planner ziet wáárom een dienst
      // openvalt en niet alleen dát hij openvalt.
      const afwezigen = new Map<string, string>(); // userId → reden
      for (const l of approvedLeaveAll) {
        if (String(l.startDate) <= date && date <= String(l.endDate)) {
          afwezigen.set(String(l.userId), UITVAL_REDEN[String(l.type)] ?? String(l.type));
        }
      }
      // Cellen van afwezigen tellen niet mee als invulling; onthoud per
      // weggefilterde code wie uitviel. Eén uitvaller per code volstaat — twee
      // zieken op dezelfde dienst is theorie, en dan is elke naam even goed.
      const uitvalByCode = new Map<string, { name: string; reason: string }>();
      const assignmentValues: string[] = [];
      const entries = r.assignments && typeof r.assignments === "object" && !Array.isArray(r.assignments)
        ? Object.entries(r.assignments)
        : [];
      for (const [naam, v] of entries) {
        const token = toLookupToken(String(naam));
        const id = idByNameToken.get(token) ?? idByNameToken.get(token.split(/\s+/).filter(Boolean).sort().join(" "));
        const reden = id ? afwezigen.get(id) : undefined;
        if (id && reden) {
          uitvalByCode.set(normalizeCode(String(v)), { name: userNameById.get(id) || String(naam), reason: reden });
        } else {
          assignmentValues.push(String(v));
        }
      }
      const gap = computeDayGap(date, dayType, expected, assignmentValues);
      // Alleen uitval-info voor codes die ook echt als gat eindigen — een
      // weggefilterde 'bv'-cel is geen dienst en hoort nergens te verschijnen.
      const uitval: NonNullable<DayGap["uitval"]> = {};
      for (const svc of gap.missing) {
        const info = uitvalByCode.get(normalizeCode(svc));
        if (info) uitval[normalizeCode(svc)] = info;
      }
      return Object.keys(uitval).length > 0 ? { ...gap, uitval } : gap;
    });
    res.json({ from, to, days });
  } catch (err) {
    console.error("Error computing coverage gaps:", err);
    res.status(500).json({ error: "Kon dekking niet berekenen." });
  }
});


// --- Dienstnotities: kort bericht van de planner bij één dienstdag ---
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get("/api/planning-notes", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) {
      return res.status(400).json({ error: "from/to (JJJJ-MM-DD) vereist." });
    }
    // Chauffeurs zien alleen hun eigen notities; planner/admin alles.
    const driverId = req.appUser!.role === "chauffeur" ? String(req.appUser!.id) : undefined;
    const notes = await getPlanningNotes({ fromIso: from, toIso: to, driverId });
    res.json(notes);
  } catch (err) {
    if (isMissingTableError(err)) return res.json([]); // migratie nog niet gedraaid
    console.error("Notities laden is mislukt.", err);
    res.status(500).json({ error: "Notities laden is mislukt." });
  }
});

app.put("/api/planning-notes", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const driverId = String(req.body?.driverId ?? "").trim();
    const date = String(req.body?.date ?? "").trim();
    const note = String(req.body?.note ?? "").trim().slice(0, 280);
    if (!driverId || !ISO_DAY_RE.test(date)) {
      return res.status(400).json({ error: "driverId en date (JJJJ-MM-DD) vereist." });
    }
    const users = await getUsersData();
    const driver = users.find((u) => String(u.id) === driverId);
    if (!driver) return res.status(400).json({ error: "Onbekende chauffeur." });

    if (!note) {
      await deletePlanningNote(driverId, date);
      await logActivity(req, "planning", "Dienstnotitie verwijderd", `${driver.name} — ${date}.`);
      return res.json({ success: true, removed: true });
    }
    await upsertPlanningNote(driverId, date, note, req.appUser?.name ?? null);
    await logActivity(req, "planning", "Dienstnotitie geplaatst", `${driver.name} — ${date}: ${note.slice(0, 80)}`);
    // De chauffeur meteen op de hoogte — push is best-effort.
    await sendPushToUsers([driverId], {
      title: "Notitie bij je dienst",
      body: `${date.split("-").reverse().join("/")}: ${note.slice(0, 120)}`,
      url: "/",
    });
    res.json({ success: true });
  } catch (err) {
    if (isMissingTableError(err)) {
      return res.status(503).json({ error: "De notities-tabel bestaat nog niet: draai supabase/2026-07-30_planning_notes.sql in de SQL Editor." });
    }
    console.error("Notitie opslaan is mislukt.", err);
    res.status(500).json({ error: "Notitie opslaan is mislukt." });
  }
});

app.get("/api/planning-matrix", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const rows = await getPlanningMatrixRows();
    res.json(rows);
  } catch (err: any) {
    console.error("Planning-overzicht laden is mislukt.", err);
    res.status(500).json({ error: "Planning-overzicht laden is mislukt." });
  }
});

app.get("/api/planning-matrix/history", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const history = await getPlanningMatrixHistory();
    res.json(history);
  } catch (err: any) {
    console.error("Import-geschiedenis laden is mislukt.", err);
    res.status(500).json({ error: "Import-geschiedenis laden is mislukt." });
  }
});

app.get("/api/activity", authenticate, requireRole("admin"), async (req, res) => {
  try {
    // ?window=7d|30d|all — de UI-filters bepalen het venster server-side,
    // zodat "30 dagen"/"Alles" en de CSV-export écht dat venster dekken.
    const window = String(req.query.window || "7d");
    const days = window === "30d" ? 30 : window === "all" ? null : 7;
    const sinceIso = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
    const activity = await getActivityLog({ sinceIso, max: 5000 });
    res.json(activity);
  } catch (err: any) {
    console.error("Activiteit laden is mislukt.", err);
    res.status(500).json({ error: "Activiteit laden is mislukt." });
  }
});

// Aanmeldingen (login-events) voor het aanwezigheids-overzicht: wie wanneer
// op het portaal kwam + per-dag actieve gebruikers. Standaard de laatste 30
// dagen; ?days= override (1–365).
app.get("/api/activity/logins", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const reqDays = Number(req.query.days);
    const days = Number.isFinite(reqDays) && reqDays >= 1 && reqDays <= 365 ? Math.floor(reqDays) : 30;
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const logins = await getLoginActivity(sinceIso);
    res.json({ days, logins });
  } catch (err: any) {
    console.error("Aanmeldingen laden is mislukt.", err);
    res.status(500).json({ error: "Aanmeldingen laden is mislukt." });
  }
});

// Per-entity geschiedenis — toegankelijk voor planner/admin om wijzigingen
// te traceren per dienst, swap, verlof, etc.
app.get(
  "/api/activity/:entityType/:entityId",
  authenticate,
  requireRole("planner", "admin"),
  async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const allowed = ["user", "service", "diversion", "update", "swap", "leave", "planning_code", "shift"];
      if (!allowed.includes(entityType)) {
        return res.status(400).json({ error: "Onbekend entity-type." });
      }
      const history = await getEntityHistory(entityType as any, entityId);
      res.json(history);
    } catch (err: any) {
      console.error("Geschiedenis laden is mislukt.", err);
      res.status(500).json({ error: "Geschiedenis laden is mislukt." });
    }
});

// Helper: decode de geüploade Excel-buffer en parse de praktijk-tab.
const parseMatrixInput = (body: any) => {
  const xlsxBase64 = typeof body?.xlsxBase64 === "string" ? body.xlsxBase64 : "";
  if (!xlsxBase64) {
    throw new Error("Geen Excel-bestand meegegeven (verwacht xlsxBase64 in body).");
  }
  const cleaned = xlsxBase64.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(cleaned, "base64");
  if (buffer.length === 0) {
    throw new Error("Excel-bestand is leeg.");
  }
  // Harde limiet vóór het parsen: een .xlsx is een zip en kan bij het
  // uitpakken exploderen (zip-bomb → geheugen-DoS van de functie). Een echte
  // praktijk-tab is enkele honderden kB; 5 MB is ruim.
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Excel-bestand is te groot (max 5 MB). Exporteer enkel de praktijk-tab.");
  }
  return { rows: parsePlanningMatrixXlsx(buffer) };
};

// Escape user-invoer vóór die in HTML-e-mails belandt (injectie-preventie).
const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

app.post("/api/planning-matrix/import", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    let rows;
    try {
      ({ rows } = parseMatrixInput(req.body));
    } catch (parseErr: any) {
      return res.status(400).json({ error: parseErr.message });
    }
    const importedDates = rows.map((row) => row.source_date).filter(Boolean);
    const startDate = importedDates[0] || null;
    const endDate = importedDates[importedDates.length - 1] || null;

    // Bouw eerst, schrijf pas weg na strict-mode validatie. Als er onbekende
    // codes of niet-gematchte chauffeurs zijn, weiger de import zodat de
    // planner eerst de oorzaak kan rechtzetten.
    const generatedPlanning = await buildPlanningFromMatrix(rows);

    const [leaveForCheck, usersForCheck] = await Promise.all([getLeaveData(), getUsersData()]);
    const userNameForConflict = (id: string) => usersForCheck.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
    const approvedLeaveForCheck = leaveForCheck.filter((l) => l.status === "approved");

    // Conflicten VÓÓR de replay = conflicten die in de Excel zelf zitten. Die
    // kan de planner daar oplossen.
    const matrixConflicts = verlofConflictsIn(generatedPlanning.shifts, approvedLeaveForCheck, userNameForConflict);

    // Goedgekeurde ruilen opnieuw toepassen — de matrix kent ze niet.
    const reapplied = await reapplyApprovedSwaps(generatedPlanning.shifts, { van: startDate, tot: endDate });

    // Alles ná de replay; het verschil komt dus uit een doorgevoerde ruil.
    // Dat onderscheid is belangrijk: zo'n conflict staat NIET in de Excel — de
    // planner zocht zich suf naar een rij die daar niet bestaat, en de import
    // bleef geblokkeerd tot hij toevallig de ruil of het verlof vond.
    const alleConflicts = verlofConflictsIn(generatedPlanning.shifts, approvedLeaveForCheck, userNameForConflict);
    const matrixKeys = new Set(matrixConflicts.map(verlofConflictKey));
    const replayConflicts = alleConflicts.filter((c) => !matrixKeys.has(verlofConflictKey(c)));
    const verlofConflictsForImport = alleConflicts;

    if (
      generatedPlanning.summary.unknownCodes.length > 0 ||
      generatedPlanning.summary.unmatchedDrivers.length > 0 ||
      verlofConflictsForImport.length > 0
    ) {
      const delen: string[] = [];
      if (generatedPlanning.summary.unknownCodes.length > 0 || generatedPlanning.summary.unmatchedDrivers.length > 0) {
        delen.push("onbekende codes of niet-gematchte chauffeurs");
      }
      if (matrixConflicts.length > 0) delen.push(`${matrixConflicts.length} verlof-conflict(en) in de Excel`);
      if (replayConflicts.length > 0) {
        delen.push(
          `${replayConflicts.length} verlof-conflict(en) die uit een doorgevoerde dienstruil komen — die staan NIET in je Excel. `
          + "Los ze op door de betreffende ruil te annuleren of het verlof in te trekken",
        );
      }
      return res.status(400).json({
        error: `Import geblokkeerd: ${delen.join("; ")}.`,
        unknownCodes: generatedPlanning.summary.unknownCodes,
        unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
        verlofConflicts: verlofConflictsForImport,
        matrixVerlofConflicts: matrixConflicts,
        ruilVerlofConflicts: replayConflicts,
        blocked: true,
      });
    }

    // Atomair: matrix + planning in één transactie (geen skew als één van
    // beide zou falen). Valt server-side terug op het oude pad zolang de
    // RPC-migratie nog niet gedraaid is.
    await replacePlanningAndMatrix(rows, generatedPlanning.shifts);
    await savePlanningMatrixHistoryEntry({
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      importedDays: rows.length,
      detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
      generatedShifts: generatedPlanning.summary.generatedShifts,
      matchedServices: generatedPlanning.summary.matchedServices,
      skippedAbsences: generatedPlanning.summary.skippedAbsences,
      unknownCodes: generatedPlanning.summary.unknownCodes,
      unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
    });
    await logActivity(
      req,
      "planning",
      "Matrix import bevestigd",
      `${rows.length} dagen verwerkt (${rows[0]?.source_date || "?"} t/m ${rows[rows.length - 1]?.source_date || "?"}), ${generatedPlanning.summary.generatedShifts} diensten opgebouwd, ${reapplied.applied} goedgekeurde ruil(en) opnieuw doorgevoerd${reapplied.skipped > 0 ? ` (${reapplied.skipped} niet toepasbaar)` : ""}. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}. Niet-gematchte chauffeurs: ${summarizeTokens(generatedPlanning.summary.unmatchedDrivers)}.`,
    );

    // Chauffeurs met diensten in deze import krijgen een seintje.
    const affectedDriverIds = [...new Set(generatedPlanning.shifts.map((s: any) => String(s.driverId)))];
    await sendPushToUsers(affectedDriverIds, {
      title: "Planning bijgewerkt",
      body: `Nieuwe planning geïmporteerd (${rows[0]?.source_date || "?"} t/m ${rows[rows.length - 1]?.source_date || "?"}). Bekijk je rooster.`,
      url: "/",
    });

    res.json({
      success: true,
      importedDays: rows.length,
      detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
      generatedShifts: generatedPlanning.summary.generatedShifts,
      matchedServices: generatedPlanning.summary.matchedServices,
      skippedAbsences: generatedPlanning.summary.skippedAbsences,
      unknownCodes: generatedPlanning.summary.unknownCodes,
      unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
      servicesWithoutSegments: generatedPlanning.summary.servicesWithoutSegments,
      perDriver: generatedPlanning.summary.perDriver,
      startDate,
      endDate,
    });
  } catch (err: any) {
    console.error("Planning importeren is mislukt.", err);
    res.status(500).json({ error: "Planning importeren is mislukt." });
  }
});

app.post("/api/planning-matrix/preview", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    let rows;
    try {
      ({ rows } = parseMatrixInput(req.body));
    } catch (parseErr: any) {
      return res.status(400).json({ error: parseErr.message });
    }
    const importedDates = rows.map((row) => row.source_date).filter(Boolean);
    const startDate = importedDates[0] || null;
    const endDate = importedDates[importedDates.length - 1] || null;
    const generatedPlanning = await buildPlanningFromMatrix(rows);

    const [leave, users] = await Promise.all([getLeaveData(), getUsersData()]);
    const userName = (id: string) => users.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
    const approvedLeave = leave.filter((l) => l.status === "approved");

    // Zelfde volgorde als de echte import (zie /planning-matrix/import), zodat
    // het voorbeeld ook echt toont wat de import oplevert — inclusief het
    // onderscheid tussen conflicten uit de Excel en conflicten die pas door een
    // doorgevoerde ruil ontstaan.
    const matrixConflicts = verlofConflictsIn(generatedPlanning.shifts, approvedLeave, userName);
    const reapplied = await reapplyApprovedSwaps(generatedPlanning.shifts, { van: startDate, tot: endDate });
    const verlofConflicts = verlofConflictsIn(generatedPlanning.shifts, approvedLeave, userName);
    const matrixKeys = new Set(matrixConflicts.map(verlofConflictKey));
    const replayConflicts = verlofConflicts.filter((c) => !matrixKeys.has(verlofConflictKey(c)));

    // perDriver komt uit buildPlanningFromMatrix en is dus van vóór de replay:
    // de chauffeur die een dienst wegruilde stond er nog mét, de ontvanger
    // zonder. Het aantal rijen hertellen op het eindbeeld, zodat de preview
    // niet half pre- en half post-ruil is (verlofConflicts hierboven was dat
    // wél al).
    const rijenPerDriver = new Map<string, number>();
    for (const s of generatedPlanning.shifts) {
      rijenPerDriver.set(String(s.driverId), (rijenPerDriver.get(String(s.driverId)) ?? 0) + 1);
    }
    const perDriverNaRuilen = generatedPlanning.summary.perDriver.map((d: any) => ({
      ...d,
      shiftsGenerated: rijenPerDriver.get(String(d.driverId)) ?? 0,
    }));

    res.json({
      success: true,
      importedDays: rows.length,
      detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
      generatedShifts: generatedPlanning.summary.generatedShifts,
      matchedServices: generatedPlanning.summary.matchedServices,
      skippedAbsences: generatedPlanning.summary.skippedAbsences,
      startDate,
      endDate,
      importedDates,
      verlofConflicts,
      matrixVerlofConflicts: matrixConflicts,
      ruilVerlofConflicts: replayConflicts,
      unknownCodes: generatedPlanning.summary.unknownCodes,
      unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
      servicesWithoutSegments: generatedPlanning.summary.servicesWithoutSegments,
      perDriver: perDriverNaRuilen,
      // De import meldde de replay wél in de log, het voorbeeld verzweeg hem —
      // terwijl de cijfers hierboven er al door beïnvloed zijn.
      reappliedSwaps: reapplied,
    });
  } catch (err: any) {
    console.error("Import-voorbeeld maken is mislukt.", err);
    res.status(500).json({ error: "Import-voorbeeld maken is mislukt." });
  }
});

app.post("/api/planning/sync-from-matrix", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const generatedPlanning = await buildPlanningFromMatrix();
    // Goedgekeurde ruilen opnieuw toepassen — de matrix kent ze niet.
    const reapplied = await reapplyApprovedSwaps(generatedPlanning.shifts);
    // Zelfde vangrails als /import: zonder deze guard liet een naamswijziging
    // in gebruikersbeheer ("unmatched driver") hier stilletjes alle diensten
    // van die chauffeur uit de planning vallen bij het heropbouwen.
    if (
      generatedPlanning.summary.unknownCodes.length > 0 ||
      generatedPlanning.summary.unmatchedDrivers.length > 0
    ) {
      return res.status(400).json({
        error: "Opnieuw opbouwen geblokkeerd: er zijn onbekende codes of niet-gematchte chauffeurs. Los deze eerst op (planningscodes/gebruikersnamen) en probeer opnieuw.",
        unknownCodes: generatedPlanning.summary.unknownCodes,
        unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
        blocked: true,
      });
    }
    await replacePlanningData(generatedPlanning.shifts);
    await logActivity(
      _req,
      "planning",
      "Planning opnieuw opgebouwd",
      `${generatedPlanning.summary.generatedShifts} diensten opgebouwd vanuit de actuele matrix, ${reapplied.applied} goedgekeurde ruil(en) opnieuw doorgevoerd${reapplied.skipped > 0 ? ` (${reapplied.skipped} niet toepasbaar)` : ""}. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}.`,
    );
    res.json({ success: true, ...generatedPlanning.summary });
  } catch (err: any) {
    console.error("Planning opnieuw opbouwen is mislukt.", err);
    res.status(500).json({ error: "Planning opnieuw opbouwen is mislukt." });
  }
});

// Geeft alle in-app beslissingen (verlof, dienstruil) sinds de vorige
// matrix-import. Helpt de planner om Excel up-to-date te brengen voor de
// volgende upload, zodat goedgekeurde wijzigingen niet stilzwijgend
// overschreven worden.
app.get("/api/planning-matrix/changes-since-import", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const history = await getPlanningMatrixHistory();
    const lastImport = history.length > 0 ? history[0] : null;
    const sinceIso = lastImport?.createdAt || new Date(0).toISOString();

    const [leave, swaps, users] = await Promise.all([getLeaveData(), getSwapsData(), getUsersData()]);
    const userName = (id?: string | null) => {
      if (!id) return null;
      return users.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
    };

    const approvedLeave = leave
      .filter((l) => l.status === "approved" && l.decidedAt && l.decidedAt > sinceIso)
      .map((l) => ({
        id: l.id,
        userId: l.userId,
        userName: userName(l.userId),
        startDate: l.startDate,
        endDate: l.endDate,
        type: l.type,
        decidedAt: l.decidedAt,
      }));

    const approvedSwaps = swaps
      .filter((s) => s.status === "approved" && s.decidedAt && s.decidedAt > sinceIso)
      .map((s) => ({
        id: s.id,
        requesterId: s.requesterId,
        requesterName: userName(s.requesterId),
        targetDriverId: s.targetDriverId,
        targetName: userName(s.targetDriverId),
        shiftId: s.shiftId,
        decidedAt: s.decidedAt,
        // Bij een overname verhuist enkel de dienst van de aanvrager; er staat
        // geen tegenprestatie tegenover die de planner ook moet inboeken.
        swapType: normalizeSwapType(s.swapType),
      }));

    res.json({
      lastImport: lastImport
        ? { createdAt: lastImport.createdAt, importedDays: lastImport.importedDays }
        : null,
      approvedLeave,
      approvedSwaps,
    });
  } catch (err: any) {
    console.error("Changes-since-import error:", err);
    console.error("Kon wijzigingen niet ophalen.", err);
    res.status(500).json({ error: "Kon wijzigingen niet ophalen." });
  }
});

app.get("/api/planning-codes", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const codes = await getPlanningCodesData();
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(codes));
    res.json(codes);
  } catch (err: any) {
    console.error("Planningscodes laden is mislukt.", err);
    res.status(500).json({ error: "Planningscodes laden is mislukt." });
  }
});

/** Vangrail tegen bulk-wipes: het write-model vervangt de hele collectie,
 *  dus een client die opslaat vanuit een niet-geladen staat zou álles als
 *  "verwijderd" aanbieden. Een POST die meer dan de helft van een bestaande
 *  collectie (≥ 5 records) schrapt, is vrijwel zeker zo'n vergissing.
 *  Retourneert het aantal te verwijderen records als de save geblokkeerd
 *  moet worden, anders null. */
const detectMassDelete = (
  previous: any[],
  incoming: any[],
  idOf: (x: any) => string = (x) => String(x?.id),
): number | null => {
  if (previous.length < 5) return null;
  const incomingIds = new Set(incoming.map(idOf));
  const removed = previous.filter((p) => !incomingIds.has(idOf(p))).length;
  return removed > previous.length / 2 ? removed : null;
};

const massDeleteResponse = (res: any, removed: number, total: number, label: string) =>
  res.status(409).json({
    error: "Bulk-verwijdering geblokkeerd",
    details: `Deze opslag zou ${removed} van de ${total} ${label} verwijderen. Vermoedelijk was je scherm niet volledig geladen — vernieuw de pagina en probeer opnieuw, of verwijder in kleinere stappen.`,
  });

/**
 * Optimistic-concurrency voor de "hele lijst opslaan"-collecties (diensten,
 * omleidingen, updates, planningscodes). Twee beheerders die tegelijk
 * dezelfde lijst bewerken konden elkaar stil overschrijven; nu krijgt de
 * tweede een 409.
 *
 * De revisie is een hash van de huidige collectie. GET zet 'm als header;
 * de client stuurt 'm bij POST terug in x-base-revision. Omdat zowel GET als
 * POST de revisie over dezelfde getX()-output berekenen (identieke
 * normalisatie + sortering op id/code), is de vergelijking stabiel. De client
 * behandelt de waarde als ondoorzichtig en hasht zelf niets.
 */
const COLLECTION_REVISION_HEADER = "x-collection-revision";
const revisionOf = (rows: any[]): string => {
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    String(a?.id ?? a?.code ?? "").localeCompare(String(b?.id ?? b?.code ?? "")),
  );
  return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("base64url").slice(0, 22);
};
/** True als de client een base-revisie meegaf die niet meer overeenkomt met
 *  de huidige serverstaat → iemand anders heeft intussen opgeslagen. */
const revisionConflict = (req: AuthenticatedRequest, current: any[]): boolean => {
  const base = req.headers[COLLECTION_REVISION_HEADER];
  if (typeof base !== "string" || base.length === 0) return false; // oudere client → check overslaan
  return base !== revisionOf(current);
};
const revisionConflictResponse = (res: any, label: string) =>
  res.status(409).json({
    error: "Gewijzigd door iemand anders",
    details: `${label} is intussen door iemand anders aangepast. De lijst wordt ververst — bekijk de wijziging en probeer je aanpassing opnieuw.`,
    conflict: "revision",
  });

app.post("/api/planning-codes", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const codes = req.body;
    if (!Array.isArray(codes)) {
      return res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
    }

    const previousCodes = await getPlanningCodesData();
    if (revisionConflict(req, previousCodes)) return revisionConflictResponse(res, "De planningscodes");
    const codesRemoved = detectMassDelete(previousCodes, codes, (c) => String(c?.code));
    if (codesRemoved !== null) return massDeleteResponse(res, codesRemoved, previousCodes.length, "planningscodes");
    await savePlanningCodesData(codes);
    await logActivity(
      req,
      "planning_codes",
      "Planningscodes opgeslagen",
      `${codes.length} planningscodes opgeslagen. ${summarizePlanningCodeChanges(previousCodes, codes)}.`,
    );

    // Per-code audit entries — code zelf is de unieke key (geen apart id)
    const codeDiff = diffPlanningCodeChanges(previousCodes, codes);
    const fmtCode = (c: typeof codes[number]) => `${c.code} — ${c.description || '(geen omschrijving)'} [${c.category}].`;
    for (const c of codeDiff.added) {
      await logActivity(req, "planning_codes", "Code toegevoegd", fmtCode(c), { type: "planning_code", id: c.code });
    }
    for (const c of codeDiff.changed) {
      await logActivity(req, "planning_codes", "Code gewijzigd", fmtCode(c), { type: "planning_code", id: c.code });
    }
    for (const c of codeDiff.removed) {
      await logActivity(req, "planning_codes", "Code verwijderd", fmtCode(c), { type: "planning_code", id: c.code });
    }

    // Revisie over de gecanoniseerde serverstaat (save normaliseert/dedupt),
    // zodat de volgende save geen vals conflict ziet.
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getPlanningCodesData()));
    res.json({ success: true, count: codes.length });
  } catch (err: any) {
    console.error("Planningscodes opslaan is mislukt.", err);
    res.status(500).json({ error: "Planningscodes opslaan is mislukt." });
  }
});

app.get("/api/users", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const users = await getUsersData();
    // Revisie over de volledige serverstaat (niet de role-scoped weergave):
    // opaque token, hoeft enkel consistent te zijn met de POST-vergelijking.
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(users));
    res.json(users.map((user) => toRoleScopedUser(user, req.appUser!.role, req.appUser!.id)));
  } catch (err) {
    console.error("Error reading users data:", err);
    res.status(500).json({ error: "Gegevens laden is mislukt." });
  }
});

app.post("/api/users", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      const previousUsers = await getUsersData();
      // Revisie-check: twee admin-sessies die tegelijk bewerken overschreven
      // elkaar anders stil — en saveUsersData doet onomkeerbare Auth-deletes.
      if (revisionConflict(req, previousUsers)) return revisionConflictResponse(res, "De gebruikerslijst");
      const usersRemoved = detectMassDelete(previousUsers, newData);
      if (usersRemoved !== null) return massDeleteResponse(res, usersRemoved, previousUsers.length, "gebruikers");
      const { createdAccounts } = (await saveUsersData(newData)) ?? { createdAccounts: [] };
      // Auth-cache verversen: rol/isActive/e-mail-wijzigingen moeten meteen
      // doorwerken, niet pas na de TTL.
      invalidateUsersCache();
      await logActivity(
        req,
        "users",
        "Gebruikers opgeslagen",
        `${newData.length} gebruikers verwerkt in gebruikersbeheer. ${summarizeUserChanges(previousUsers, newData)}.`,
      );

      // Per-user audit entries
      const userDiff = diffUserChanges(previousUsers, newData);
      for (const u of userDiff.added) {
        await logActivity(req, "users", "Gebruiker toegevoegd", `${u.name} (${u.role}, ${u.employeeId || '—'}).`, { type: "user", id: u.id });
      }
      for (const { user: u, fields } of userDiff.changed) {
        await logActivity(req, "users", "Gebruiker gewijzigd", `${u.name} — ${fields.join(', ')}.`, { type: "user", id: u.id });
      }
      for (const u of userDiff.removed) {
        await logActivity(req, "users", "Gebruiker verwijderd", `${u.name} (${u.role}).`, { type: "user", id: u.id });
        // Wees-documenten opruimen: verwijder de bijhorende storage-bestanden +
        // metadata-rijen zodat er niets van de ex-medewerker achterblijft.
        const removedDocs = await deleteAllDocumentsForUser(String(u.id));
        if (removedDocs > 0) {
          await logActivity(req, "users", "Documenten opgeruimd", `${removedDocs} document(en) van ${u.name} verwijderd.`, { type: "user", id: u.id });
        }
      }

      // Welkomstmail voor élk nieuw aangemaakt Auth-account: met een
      // recovery-link stelt de nieuwe collega direct een eigen wachtwoord in
      // (i.p.v. een doorgefluisterd Excel-wachtwoord). Best-effort — een
      // mailfout mag de save niet laten falen.
      for (const account of createdAccounts ?? []) {
        try {
          let actionLink: string | null = null;
          if (supabaseAdmin) {
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
              type: "recovery",
              email: account.email,
              options: { redirectTo: process.env.APP_URL || "https://vhbportaal.com" },
            });
            if (!linkError) actionLink = linkData?.properties?.action_link ?? null;
          }
          await sendWelcomeEmail({ to: account.email, name: account.name, actionLink });
        } catch (err) {
          console.error(`[welcome-mail] versturen naar ${account.email} mislukt:`, err);
        }
      }

      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUsersData()));
      res.json({ success: true, count: newData.length, welcomed: (createdAccounts ?? []).length });
    } else {
      res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving users data:", errorMessage);
    console.error("Opslaan is mislukt.", errorMessage);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

// --- Push-notificaties ---
app.get("/api/push/public-key", authenticate, (_req, res) => {
  // null = push staat uit (geen VAPID-keys geconfigureerd) — de client
  // verbergt de meldingen-knop dan.
  res.json({ publicKey: getVapidPublicKey() });
});

app.post("/api/push/subscribe", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const sub = req.body;
    const endpoint = String(sub?.endpoint ?? "");
    const p256dh = String(sub?.keys?.p256dh ?? "");
    const auth = String(sub?.keys?.auth ?? "");
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: "Ongeldig push-abonnement." });
    }
    await savePushSubscription({ userId: String(req.appUser!.id), endpoint, p256dh, auth });
    res.json({ success: true });
  } catch (err: any) {
    console.error("Abonneren mislukt", err);
    res.status(500).json({ error: "Abonneren mislukt" });
  }
});

app.post("/api/push/unsubscribe", authenticate, async (req: AuthenticatedRequest, res) => {
  const endpoint = String(req.body?.endpoint ?? "");
  if (!endpoint) return res.status(400).json({ error: "endpoint is verplicht" });
  // Alleen je eigen abonnement mag je afmelden (geen IDOR op andermans endpoint).
  await deletePushSubscriptionForUser(endpoint, String(req.appUser!.id));
  res.json({ success: true });
});

// --- Toestel-whitelist --- → losgetrokken naar api/deviceRoutes.ts
// (mountDeviceRoutes, hierboven gemount naast mountOcpiRoutes).

// --- Client-foutmonitoring ---
// Bewust zónder authenticate: fouten op het loginscherm of bij een verlopen
// sessie moeten ook binnenkomen. De client dedupet en plafonneert zelf
// (max 20/sessie); hier kappen we payloads af zodat misbruik niets oplevert.
app.post("/api/client-errors", clientErrorRateLimit, async (req, res) => {
  try {
    const b = req.body ?? {};
    const cut = (v: unknown, max: number) => String(v ?? "").slice(0, max);
    // userId komt van de client en is zonder sessie niet te vertrouwen: met
    // een geldig token overschrijven we hem met de échte gebruiker, anders
    // markeren we hem expliciet als onbevestigd (route blijft bewust open
    // voor fouten vanaf het loginscherm).
    const verifiedUser = await resolveOptionalUser(req);
    const claimedId = cut(b.userId, 80);
    const entry = {
      message: cut(b.message, 1000),
      stack: cut(b.stack, 4000),
      source: cut(b.source, 50),
      url: cut(b.url, 300),
      userAgent: cut(b.userAgent, 300),
      userId: verifiedUser ? verifiedUser.id : claimedId ? `onbevestigd:${claimedId}` : "",
    };
    if (!entry.message) {
      return res.status(400).json({ error: "message is verplicht" });
    }
    // Vangnet dat altijd werkt: zichtbaar in de Vercel-functielogs.
    console.error("[client-error]", JSON.stringify(entry));
    await logClientError(entry);
    res.status(204).end();
  } catch {
    // Foutrapportage mag nooit zelf een fout-loop veroorzaken.
    res.status(204).end();
  }
});

// CSP-schendingen. De policy stond op Report-Only zónder report-uri: niet
// afgedwongen én de meldingen kwamen nergens aan, dus effectief geen CSP. Nu
// hij wél afgedwongen wordt, is dit het vangnet — een geblokkeerde bron
// verschijnt in de foutendigest i.p.v. stil te falen bij één chauffeur.
//
// Browsers posten dit als application/csp-report, dat express.json() niet
// standaard parseert; vandaar de eigen type-matcher. Bewust open (zoals
// /api/client-errors) met dezelfde rate-limiter: zo'n rapport komt juist
// binnen wanneer er iets stuk is, mogelijk nog vóór het inloggen.
app.post(
  "/api/csp-report",
  express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "64kb" }),
  clientErrorRateLimit,
  async (req, res) => {
    try {
      const r = ((req.body as any)?.["csp-report"] ?? req.body ?? {}) as Record<string, unknown>;
      const cut = (v: unknown, max: number) => String(v ?? "").slice(0, max);
      const geblokkeerd = cut(r["blocked-uri"] ?? r.blockedURL, 300);
      const directive = cut(r["violated-directive"] ?? r.effectiveDirective, 100);
      if (!geblokkeerd && !directive) return res.status(204).end();
      const entry = {
        message: `CSP blokkeerde ${geblokkeerd || "een bron"} (${directive || "onbekende directive"})`,
        stack: cut(r["source-file"] ?? r.sourceFile, 4000),
        source: "csp",
        url: cut(r["document-uri"] ?? r.documentURL, 300),
        userAgent: cut(req.headers["user-agent"], 300),
        userId: "",
      };
      console.error("[csp-report]", JSON.stringify(entry));
      await logClientError(entry);
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  },
);

app.get("/api/client-errors", authenticate, requireRole("admin"), async (_req, res) => {
  try {
    res.json(await getClientErrors(100));
  } catch {
    res.json([]);
  }
});

// --- Back-up: alle collecties als één JSON ---
const buildBackupPayload = async () => {
  const [users, planning, services, diversions, updates, leave, swaps, planningCodes, planningMatrixRows, coverageExpectations, activityLog] = await Promise.all([
    getUsersData(),
    getPlanningData(),
    getServicesData(),
    getDiversionsData(),
    getUpdatesData(),
    getLeaveData(),
    getSwapsData(),
    getPlanningCodesData(),
    getPlanningMatrixRows(),
    getCoverageExpectations(),
    // Volledig auditspoor (binnen retentie) — met de default-cap van 100
    // bevatte de "volledige" back-up stil maar 100 logregels.
    getActivityLog({ sinceIso: null, max: 50000 }),
  ]);
  // Auth-accounts (id+e-mail): een restore van een verwijderde gebruiker
  // maakt anders een account met random wachtwoord aan zonder dat je weet
  // welk e-mailadres erbij hoorde. Best-effort — Auth-uitval mag de backup
  // niet blokkeren.
  let authUsers: Array<{ id: string; email: string | null }> = [];
  try {
    if (supabaseAdmin) {
      const { data: authPage } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      authUsers = ((authPage?.users ?? []) as Array<{ id: string; email?: string }>).map((u) => ({ id: u.id, email: u.email ?? null }));
    }
  } catch (err) {
    console.error("[backup] auth-export mislukt (backup gaat door):", err);
  }

  // OCPI-registratie (Token C + endpoints): zonder deze rij moet de hele
  // ChargEye-handshake opnieuw na een restore.
  let ocpiRegistration: unknown = null;
  try {
    ocpiRegistration = await getOcpiRegistration();
  } catch (err) {
    console.error("[backup] ocpi_registration-export mislukt (backup gaat door):", err);
  }

  // Documenten- + ritblad-metadata: de bestanden zelf staan in Storage-buckets
  // (niet in deze JSON), maar zonder deze rijen weet je na projectverlies niet
  // meer wélk document bij wie hoorde. Referentie-export (net als authUsers).
  let userDocuments: unknown[] = [];
  let ritblaadje: unknown = null;
  try {
    userDocuments = await listUserDocuments();
    ritblaadje = await getRitblaadjeMeta();
  } catch (err) {
    console.error("[backup] documenten/ritblad-export mislukt (backup gaat door):", err);
  }

  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    collections: {
      users,
      planning,
      services,
      diversions,
      updates,
      leave,
      swaps,
      planningCodes,
      planningMatrixRows,
      coverageExpectations,
      activityLog,
    },
    // Referentie-exports (niet door /api/restore teruggeschreven; handmatig
    // te gebruiken bij disaster-recovery). userDocuments/ritblaadje = metadata;
    // de bijhorende bestanden wonen in de Storage-buckets.
    authUsers,
    ocpiRegistration,
    userDocuments,
    ritblaadje,
  };
};

app.get("/api/backup", authenticate, requireRole("admin"), async (_req, res) => {
  try {
    res.json(await buildBackupPayload());
  } catch (err: any) {
    console.error("Back-up genereren is mislukt", err);
    res.status(500).json({ error: "Back-up genereren is mislukt" });
  }
});

// Nachtelijke back-up, aangeroepen door de Vercel-cron (zie vercel.json).
// Vercel stuurt automatisch `Authorization: Bearer ${CRON_SECRET}` mee als
// die env-var in het project staat — zonder geldig secret: 401.
app.get("/api/cron/backup", async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Niet toegestaan." });
  }
  try {
    const payload = await buildBackupPayload();
    const filename = `vhb-backup-${payload.exportedAt.slice(0, 10)}.json`;
    const json = JSON.stringify(payload);
    const stored = await storeBackup(filename, json);
    console.log(`[cron-backup] ${filename} opgeslagen, ${stored.removedOld} oude back-up(s) opgeruimd.`);

    // Integriteitscheck: vangt een stille lege/kapotte back-up (geen admin,
    // ontbrekende collectie, niet-serialiseerbaar) vóór het pas bij een échte
    // restore opvalt. Bij problemen mailen naar ALERT_EMAIL/admins.
    const integrity = checkBackupIntegrity(payload);
    if (!integrity.ok) {
      console.error(`[cron-backup] INTEGRITEIT: ${integrity.issues.join("; ")}`);
      try {
        const alertTo = await systemMailRecipients();
        if (alertTo.length > 0) {
          await sendEmail({
            to: alertTo,
            context: "backup-integrity",
            subject: `⚠️ VHB back-up-integriteit — controleer ${filename}`,
            text: `De back-up ${filename} is opgeslagen maar faalde de integriteitscheck:\n\n- ${integrity.issues.join("\n- ")}\n\nControleer of de portaal-data compleet is.`,
            html: `<p>De back-up <strong>${escapeHtml(filename)}</strong> is opgeslagen maar faalde de integriteitscheck:</p><ul>${integrity.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul><p>Controleer of de portaal-data compleet is.</p>`,
          });
        }
      } catch (mailErr) {
        console.error("[cron-backup] integriteit-alert mailen mislukt:", mailErr);
      }
    }

    // Wekelijkse off-site kopie (zondag): de bucket-back-ups wonen in
    // hetzélfde Supabase-project — bij projectverlies zijn ze mee weg. Een
    // mail-bijlage naar ALERT_EMAIL/admins is de goedkoopste externe kopie.
    // VERSLEUTELD (30/07): de bijlage bevatte de volledige personeelsdata
    // leesbaar in mailboxen én in het Resend-dashboard — één gehackte
    // mailbox was een compleet datalek. Zonder BACKUP_PASSPHRASE wordt er
    // NIET gemaild (fail-closed) — de nachtelijke bucket-kopie blijft er.
    let mailedOffsite = false;
    if (new Date().getUTCDay() === 0) {
      const passphrase = process.env.BACKUP_PASSPHRASE;
      if (!passphrase) {
        console.error("[cron-backup] BACKUP_PASSPHRASE ontbreekt — wekelijkse off-site mail overgeslagen (bewust: nooit onversleuteld mailen).");
      } else {
        const recipients = await systemMailRecipients();
        if (recipients.length > 0) {
          const encrypted = encryptOpensslCompatible(json, passphrase);
          const uitleg = "Ontsleutelen (vraagt om de wachtwoordzin uit je wachtwoordmanager):\n\n  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in " + filename + ".enc -out " + filename + "\n\nZie ook docs/RESTORE.md in de repo.";
          const result = await sendEmail({
            to: recipients,
            context: "weekly-backup",
            subject: `VHB Portaal — wekelijkse back-up ${payload.exportedAt.slice(0, 10)} (versleuteld)`,
            text: `In bijlage de wekelijkse off-site kopie van de portaal-back-up, AES-256-versleuteld. Bewaar deze mail buiten Supabase/Vercel.\n\n${uitleg}`,
            html: `<p>In bijlage de wekelijkse off-site kopie van de portaal-back-up, <strong>AES-256-versleuteld</strong>. Bewaar deze mail buiten Supabase/Vercel.</p><p>Ontsleutelen (vraagt om de wachtwoordzin uit je wachtwoordmanager):</p><pre>openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ${escapeHtml(filename)}.enc -out ${escapeHtml(filename)}</pre><p>Zie ook <code>docs/RESTORE.md</code> in de repo.</p>`,
            attachments: [{ filename: `${filename}.enc`, content: encrypted }],
          });
          mailedOffsite = result.ok && !result.mocked;
        }
      }
    }

    // Retentie ná de back-up: de zojuist gemaakte back-up bevat de volledige
    // historiek nog, daarna mag oud grut weg (fouten 30 d, auditlog 1 jaar —
    // instelbaar via env). Best-effort: mag de back-up-respons niet breken.
    const errorDays = Number(process.env.RETENTION_ERROR_DAYS) > 0 ? Number(process.env.RETENTION_ERROR_DAYS) : 30;
    const logDays = Number(process.env.RETENTION_LOG_DAYS) > 0 ? Number(process.env.RETENTION_LOG_DAYS) : 365;
    const noteDays = Number(process.env.RETENTION_NOTE_DAYS) > 0 ? Number(process.env.RETENTION_NOTE_DAYS) : 90;
    const pruned = await pruneOldRecords({ errorDays, logDays, noteDays });
    const prunedTotal = pruned.clientErrors + pruned.activityLog + pruned.planningNotes + pruned.pushSubscriptions;
    if (prunedTotal > 0) {
      console.log(`[cron-backup] retentie: ${pruned.clientErrors} client-fouten (>${errorDays}d), ${pruned.activityLog} log-regels (>${logDays}d), ${pruned.planningNotes} dienstnotities (>${noteDays}d) en ${pruned.pushSubscriptions} verweesde push-abonnementen opgeruimd.`);
    }

    await logCronHeartbeat("backup", `${filename} opgeslagen (${stored.removedOld} oude opgeruimd${mailedOffsite ? ", off-site kopie gemaild" : ""}${prunedTotal ? `, retentie: ${pruned.clientErrors} fouten + ${pruned.activityLog} log-regels + ${pruned.planningNotes} notities + ${pruned.pushSubscriptions} push-abonnementen weg` : ""}${integrity.ok ? "" : `, ⚠️ integriteit: ${integrity.issues.join(", ")}`}).`);
    res.json({ success: true, filename, removedOld: stored.removedOld, mailedOffsite, pruned, integrity });
  } catch (err: any) {
    console.error("[cron-backup] mislukt:", err?.message || err);
    console.error("Back-up mislukt", err);
    res.status(500).json({ error: "Back-up mislukt" });
  }
});

// Ontvangers van systeemmails (foutendigest, back-ups): ALERT_EMAIL wint;
// anders alle actieve admins mét e-mailadres die zich niet hebben afgemeld
// (users.wantssystemmail, beheerbaar in Gebruikersbeheer).
const systemMailRecipients = async (): Promise<string[]> => {
  const explicit = (process.env.ALERT_EMAIL || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (explicit.length > 0) return explicit;
  return (await getUsersData())
    .filter((u) => u.role === "admin" && u.isActive !== false && u.email && u.wantsSystemMail !== false)
    .map((u) => u.email as string);
};

// Foutmelding-digest: periodiek (Vercel-cron) de client-fouten van het
// afgelopen interval samenvatten en mailen, zodat een storing/foutenpiek niet
// onopgemerkt blijft tot een chauffeur klaagt. DB-gebaseerd (geen per-instance
// telprobleem). Stuurt naar ALERT_EMAIL als die env-var bestaat, anders naar
// alle admin-accounts. Stuurt niets als er geen fouten zijn.
// Wekelijkse cijfermail (maandagochtend): actieve gebruikers, afgehandelde
// aanvragen en de foutentrend van de afgelopen week — voor Jarno's
// maandagoverzicht zonder het portaal te openen. Zelfde ontvangers en
// opt-out als de andere systeemmails.
app.get("/api/cron/week-rapport", async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Niet toegestaan." });
  }
  try {
    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [logins, leave, swaps, errors] = await Promise.all([
      getLoginActivity(sinceIso),
      getLeaveData(),
      getSwapsData(),
      getClientErrorsSince(sinceIso),
    ]);
    const uniekeGebruikers = new Set(logins.map((l) => String(l.entityId || l.actorName))).size;
    const inWindow = (iso?: string) => Boolean(iso && iso >= sinceIso);
    const verlofBeslist = leave.filter((l) => inWindow(l.decidedAt)).length;
    const verlofNieuw = leave.filter((l) => inWindow(l.createdAt)).length;
    const ruilBeslist = swaps.filter((sw) => inWindow(sw.decidedAt)).length;
    const ruilNieuw = swaps.filter((sw) => inWindow(sw.createdAt)).length;
    const openVerlof = leave.filter((l) => l.status === "pending").length;
    const openRuil = swaps.filter((sw) => sw.status === "pending" || sw.status === "accepted").length;
    const echteFouten = errors.filter((e) => !isDigestRuis(e.message)).length;

    const recipients = await systemMailRecipients();
    if (recipients.length === 0) {
      return res.json({ success: true, sent: false, reason: "geen ontvangers" });
    }
    const regels = [
      `Actieve gebruikers: ${uniekeGebruikers}`,
      `Verlof: ${verlofNieuw} nieuw · ${verlofBeslist} beslist · ${openVerlof} open`,
      `Dienstruil: ${ruilNieuw} nieuw · ${ruilBeslist} beslist · ${openRuil} open`,
      `Client-fouten: ${echteFouten} (sessie-meldingen niet meegeteld)`,
    ];
    await sendEmail({
      to: recipients,
      context: "week-rapport",
      subject: `VHB Portaal — weekoverzicht`,
      text: `Cijfers van de afgelopen 7 dagen:\n\n- ${regels.join("\n- ")}\n\nBekijk de details in het portaal.`,
      html: `<p>Cijfers van de afgelopen <strong>7 dagen</strong>:</p><ul>${regels.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul><p>Bekijk de details in het portaal.</p>`,
    });
    await logCronHeartbeat("week-rapport", `Weekoverzicht gemaild aan ${recipients.length} ontvanger(s).`);
    res.json({ success: true, sent: true });
  } catch (err: any) {
    console.error("[week-rapport] mislukt:", err?.message || err);
    res.status(500).json({ error: "Weekrapport mislukt" });
  }
});

// Maandelijkse restore-proef: de back-up wordt elke nacht gemaakt en op
// integriteit gecheckt bij het MAKEN — maar of het bestand ook terug te
// lezen en te herstellen valt, werd nooit geoefend. Deze cron leest de
// laatste back-up terug, parseert hem en draait dezelfde integriteitscheck;
// faalt er iets, dan gaat er direct een alarm-mail uit.
app.get("/api/cron/restore-proef", async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Niet toegestaan." });
  }
  try {
    const issues: string[] = [];
    let filename = "";
    try {
      const backup = await getLatestBackup();
      if (!backup) {
        issues.push("geen enkel back-upbestand gevonden in de bucket");
      } else {
        filename = backup.filename;
        let payload: any;
        try {
          payload = JSON.parse(backup.body);
        } catch {
          issues.push(`${backup.filename} is geen geldige JSON`);
        }
        if (payload) {
          const integrity = checkBackupIntegrity(payload);
          if (!integrity.ok) issues.push(...integrity.issues);
          // Sanity: live niet-lege kerncollecties moeten ook in de back-up zitten.
          const liveUsers = (await getUsersData()).length;
          const backupUsers = Array.isArray(payload?.collections?.users) ? payload.collections.users.length : 0;
          if (liveUsers > 0 && backupUsers === 0) issues.push("back-up bevat 0 gebruikers terwijl er live wél zijn");
        }
      }
    } catch (err: any) {
      issues.push(`teruglezen mislukt: ${err?.message || err}`);
    }

    if (issues.length > 0) {
      const recipients = await systemMailRecipients();
      if (recipients.length > 0) {
        await sendEmail({
          to: recipients,
          context: "restore-proef",
          subject: `⚠️ VHB restore-proef gefaald${filename ? ` — ${filename}` : ""}`,
          text: `De maandelijkse restore-proef vond problemen:\n\n- ${issues.join("\n- ")}\n\nControleer de back-ups zo snel mogelijk — dit is je herstelpad.`,
          html: `<p>De maandelijkse restore-proef vond problemen:</p><ul>${issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul><p>Controleer de back-ups zo snel mogelijk — dit is je herstelpad.</p>`,
        });
      }
      await logCronHeartbeat("restore-proef", `GEFAALD: ${issues.join("; ")}`);
      return res.json({ success: false, issues });
    }
    await logCronHeartbeat("restore-proef", `${filename} teruggelezen en integriteitscheck geslaagd.`);
    res.json({ success: true, filename });
  } catch (err: any) {
    console.error("[restore-proef] mislukt:", err?.message || err);
    res.status(500).json({ error: "Restore-proef mislukt" });
  }
});

app.get("/api/cron/error-digest", async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Niet toegestaan." });
  }
  try {
    // Default 1440 min (24u): de cron draait dagelijks — een Hobby-plan staat
    // geen vaker-dan-daagse cron toe. Op Pro kun je de cron frequenter zetten
    // en deze env navenant verlagen (bv. 60 voor uurlijks).
    const intervalMin = Number(process.env.ERROR_DIGEST_INTERVAL_MIN) > 0
      ? Number(process.env.ERROR_DIGEST_INTERVAL_MIN)
      : 1440;
    const minCount = Number(process.env.ERROR_DIGEST_MIN_COUNT) > 0
      ? Number(process.env.ERROR_DIGEST_MIN_COUNT)
      : 0;
    const sinceMs = Date.now() - intervalMin * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    const allErrors = await getClientErrorsSince(sinceIso);
    // Levenscyclus ("sessie verlopen") en deploy-ruis (chunk-laadfouten die
    // lazyWithRetry al opvangt) horen niet in de mail — zie isDigestRuis.
    // De rijen blijven wél in de DB en in Systeem Status zichtbaar.
    const errors = allErrors.filter((e) => !isDigestRuis(e.message));
    const filtered = allErrors.length - errors.length;
    // Bewust GEEN drempel meer (verzoek Jarno, 02-08): elke dag een overzicht,
    // ook bij nul meldingen. Een mail die alleen bij problemen komt, laat je
    // je afvragen of hij niet gewoon niet verstuurd is. ERROR_DIGEST_MIN_COUNT
    // blijft bestaan voor wie hem toch wil gebruiken; standaard 0 = altijd.
    if (minCount > 0 && errors.length < minCount) {
      await logCronHeartbeat("error-digest", `Onder de drempel (${errors.length} meldingen${filtered ? ` + ${filtered} genegeerd als ruis` : ""} in ${intervalMin} min).`);
      return res.json({ success: true, count: errors.length, ignored: filtered, alerted: false });
    }

    // Bepaal de ontvangers.
    const recipients = await systemMailRecipients();
    if (recipients.length === 0) {
      return res.json({ success: true, count: errors.length, alerted: false, reason: "geen ontvangers" });
    }

    // Groepeer op bron + bericht. getClientErrorsSince sorteert nieuwste
    // eerst, dus de stack bij het aanmaken van de groep is de recentste.
    const groups = new Map<string, { source: string; message: string; count: number; lastUrl?: string; lastStack?: string }>();
    for (const e of errors) {
      const key = `${e.source || "?"}::${e.message}`;
      const g = groups.get(key) ?? { source: e.source || "onbekend", message: e.message, count: 0, lastUrl: e.url, lastStack: e.stack };
      g.count += 1;
      groups.set(key, g);
    }
    const sorted = [...groups.values()].sort((a, b) => b.count - a.count);

    // Geminifieerde stacks terugvertalen naar src/-posities (best-effort,
    // alleen de top — de sourcemap-consumer wordt per bundel gecachet).
    const originOf = new Map<(typeof sorted)[number], string>();
    for (const g of sorted.slice(0, 8)) {
      try {
        const origin = await symbolicateTopFrame(g.lastStack);
        if (origin) originOf.set(g, origin);
      } catch { /* digest nooit laten falen op symbolicatie */ }
    }

    const topLines = sorted.slice(0, 15)
      .map((g) => `• [${g.count}×] ${g.source}: ${g.message}${originOf.has(g) ? ` → ${originOf.get(g)}` : ""}${g.lastUrl ? ` (${g.lastUrl})` : ""}`)
      .join("\n");
    const moreLine = sorted.length > 15 ? `\n…en nog ${sorted.length - 15} andere foutsoorten.` : "";

    const windowLabel = intervalMin % 60 === 0 ? `${intervalMin / 60} uur` : `${intervalMin} min`;

    // Hoeveel toestellen/gebruikers raakte het? Dát is het signaal, niet het
    // aantal meldingen: 16 meldingen van één toestel is iemand die zit te
    // klikken tijdens een deploy, 16 verdeeld over tien mensen is een storing.
    // Lege userId = niet ingelogd; die tellen als één groep 'onbekend'.
    const gebruikers = new Set(errors.map((e) => String(e.userId || "").replace(/^onbevestigd:/, "") || "onbekend"));
    const impact = errors.length === 0
      ? "geen meldingen"
      : `${errors.length} melding${errors.length === 1 ? "" : "en"} · ${gebruikers.size} ${gebruikers.size === 1 ? "toestel" : "toestellen"}`;

    // Neutrale toon, bewust zonder waarschuwingsteken (verzoek Jarno, 02-08):
    // dit is een dagoverzicht dat élke ochtend komt, geen alarm. Een
    // ⚠️ bij 16 meldingen van je eigen toestel las als een storing terwijl er
    // niets aan de hand was. Wat er wél toe doet — hoeveel mensen geraakt
    // zijn — staat nu in de onderwerpregel.
    const subject = `VHB Portaal · dagoverzicht — ${impact}`;
    const inleiding = errors.length === 0
      ? `In de afgelopen ${windowLabel} zijn er geen meldingen binnengekomen.`
      : `In de afgelopen ${windowLabel}: ${errors.length} melding${errors.length === 1 ? "" : "en"} van ${gebruikers.size} ${gebruikers.size === 1 ? "toestel" : "toestellen"} (${sorted.length} unieke soorten).`;
    const staart = filtered > 0
      ? `\n\n${filtered} melding${filtered === 1 ? "" : "en"} niet meegeteld (verlopen sessies en laadfouten vlak na een uitrol — die vangt de app zelf op).`
      : "";
    const text = `${inleiding}${errors.length === 0 ? "" : `\n\n${topLines}${moreLine}`}${staart}\n\nBekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.`;
    // g.source/message/lastUrl zijn door de client aangeleverd — escapen,
    // anders is de digest-mail een HTML-injectiekanaal richting de admins.
    // De symbolicatie-uitkomst komt uit de sourcemap (indirect ook input) —
    // dus óók escapen.
    const html = `<p>${escapeHtml(inleiding)}</p>${errors.length === 0 ? "" : `<ul>${sorted.slice(0, 15).map((g) => `<li><strong>${g.count}×</strong> [${escapeHtml(g.source)}] ${escapeHtml(g.message)}${originOf.has(g) ? ` → <code>${escapeHtml(originOf.get(g)!)}</code>` : ""}${g.lastUrl ? ` <em>(${escapeHtml(g.lastUrl)})</em>` : ""}</li>`).join("")}</ul>${sorted.length > 15 ? `<p>…en nog ${sorted.length - 15} andere soorten.</p>` : ""}`}${filtered > 0 ? `<p style="color:#6E767F">${filtered} melding${filtered === 1 ? "" : "en"} niet meegeteld (verlopen sessies en laadfouten vlak na een uitrol — die vangt de app zelf op).</p>` : ""}<p>Bekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.</p>`;

    const result = await sendEmail({ to: recipients, subject, text, html, context: "error-digest" });
    console.log(`[error-digest] ${errors.length} fouten, mail naar ${recipients.length} ontvanger(s), mocked=${result.mocked}`);
    await logCronHeartbeat("error-digest", `Dagoverzicht verstuurd: ${impact}${filtered ? `, ${filtered} als ruis genegeerd` : ""} → ${recipients.length} ontvanger(s).`);
    res.json({ success: true, count: errors.length, alerted: true, recipients: recipients.length, mocked: result.mocked });
  } catch (err: any) {
    console.error("[error-digest] mislukt:", err?.message || err);
    console.error("Digest mislukt", err);
    res.status(500).json({ error: "Digest mislukt" });
  }
});

// Herstellen vanuit een back-up (admin). Overschrijft de operationele
// collecties met de inhoud van een eerder gedownload/automatisch back-up-
// bestand. Bewust een aparte, expliciete route (niet via de array-POSTs) —
// de bulk-wipe-vangrails gelden hier dus niet: dit ís een bewuste volledige
// vervanging, beveiligd met admin-rol + bevestiging in de UI.
app.post("/api/restore", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body ?? {};
    const collections = body?.collections;
    if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
      return res.status(400).json({ error: "Ongeldig back-up-bestand: 'collections' ontbreekt." });
    }
    // Minimale sanity-check: een geldige back-up heeft minstens gebruikers,
    // en die set moet een admin bevatten (anders sluit je jezelf buiten).
    if (Array.isArray(collections.users)) {
      const hasAdmin = collections.users.some((u: any) => u?.role === "admin");
      if (!hasAdmin) {
        return res.status(400).json({ error: "Herstel geweigerd: de back-up bevat geen admin-account." });
      }
    }
    const summary = await restoreFromBackup(collections);
    // Restore kan de gebruikers (incl. rollen) hebben vervangen → auth-cache wissen.
    invalidateUsersCache();
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    await logActivity(
      req,
      "system",
      "Back-up hersteld",
      `Volledige restore uitgevoerd (${body.exportedAt ? `back-up van ${String(body.exportedAt).slice(0, 10)}` : "onbekende datum"}). ${total} records over ${Object.keys(summary).length} collecties teruggezet.`,
    );
    res.json({ success: true, summary });
  } catch (err: any) {
    console.error("Restore mislukt:", err?.message || err);
    // Restore is niet transactioneel: log + meld wat al wel toegepast is, zodat
    // de admin de staat begrijpt en niet half-en-half blijft gokken.
    const appliedSoFar = err?.appliedSoFar && typeof err.appliedSoFar === "object" ? err.appliedSoFar : null;
    if (appliedSoFar) {
      invalidateUsersCache();
      try {
        await logActivity(req, "system", "Back-up gedeeltelijk hersteld",
          `Restore halverwege gefaald. Wél teruggezet: ${Object.entries(appliedSoFar).map(([k, v]) => `${k} (${v})`).join(", ") || "niets"}. Fout: ${err?.message || "onbekend"}.`);
      } catch { /* logging mag de foutrespons niet blokkeren */ }
    }
    console.error("Herstellen is mislukt", err);
    res.status(500).json({ error: "Herstellen is mislukt", appliedSoFar });
  }
});

// Bijlage-URL's zijn kortlevend ondertekend (bucket is privé, zie
// supabase/2026-07-26_diversions_private.sql): een gedeelde link vervalt,
// i.p.v. eeuwig te blijven werken voor ex-medewerkers. Pad is stabiel
// `${id}.pdf`. Mislukt het ondertekenen (bucket nog publiek, bestand weg),
// dan blijft de opgeslagen URL staan — bijlagen breken nooit door deze stap.
const DIVERSION_URL_TTL_SEC = 60 * 60 * 12;
const withSignedDiversionUrls = async (diversions: any[]): Promise<any[]> => {
  if (!db) return diversions;
  return Promise.all(
    diversions.map(async (d) => {
      if (!d?.pdfUrl || !d?.id) return d;
      try {
        const { data: signed } = await db.storage
          .from(DIVERSIONS_BUCKET)
          .createSignedUrl(`${d.id}.pdf`, DIVERSION_URL_TTL_SEC);
        return signed?.signedUrl ? { ...d, pdfUrl: signed.signedUrl } : d;
      } catch {
        return d;
      }
    }),
  );
};

app.get("/api/diversions", authenticate, async (req, res) => {
  try {
    const data = await getDiversionsData();
    // Revisie op de rauwe data: de ondertekende URL's wisselen per request en
    // zouden de optimistische-concurrency-hash anders elke keer veranderen.
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
    res.json(await withSignedDiversionUrls(data));
  } catch (err) {
    console.error("Error reading diversions data:", err);
    res.status(500).json({ error: "Gegevens laden is mislukt." });
  }
});

app.post("/api/diversions", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      const previousDiversions = await getDiversionsData();
      if (revisionConflict(req, previousDiversions)) return revisionConflictResponse(res, "De omleidingen");
      const diversionsRemoved = detectMassDelete(previousDiversions, newData);
      if (diversionsRemoved !== null) return massDeleteResponse(res, diversionsRemoved, previousDiversions.length, "omleidingen");
      await saveDiversionsData(newData);
      await logActivity(
        req,
        "diversions",
        "Omleidingen opgeslagen",
        `${newData.length} omleidingen opgeslagen. ${summarizeDiversionChanges(previousDiversions, newData)}.`,
      );

      // Per-omleiding audit entries
      const divDiff = diffDiversionChanges(previousDiversions, newData);
      const fmtDiv = (d: any) => `${d.title} (lijn ${d.line}) — ${d.startDate}${d.endDate ? ` t/m ${d.endDate}` : ''}.`;
      for (const d of divDiff.added) {
        await logActivity(req, "diversions", "Omleiding toegevoegd", fmtDiv(d), { type: "diversion", id: d.id });
      }
      for (const d of divDiff.changed) {
        await logActivity(req, "diversions", "Omleiding gewijzigd", fmtDiv(d), { type: "diversion", id: d.id });
      }
      for (const d of divDiff.removed) {
        await logActivity(req, "diversions", "Omleiding verwijderd", fmtDiv(d), { type: "diversion", id: d.id });
      }

      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving diversions data:", errorMessage);
    console.error("Opslaan is mislukt.", errorMessage);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

app.post("/api/diversions/pdf", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    }

    const id = String(req.body?.id || "").trim();
    const filename = String(req.body?.filename || "").trim();
    const dataUrl = String(req.body?.dataUrl || "");
    if (!id) {
      return res.status(400).json({ error: "Diversion-id ontbreekt." });
    }
    if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({ error: "Geef een PDF-bestand met een .pdf extensie." });
    }
    const base64Match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
    if (!base64Match) {
      return res.status(400).json({ error: "Bestand is geen geldige PDF (base64 data URL verwacht)." });
    }
    const buffer = Buffer.from(base64Match[1], "base64");
    if (buffer.length === 0) {
      return res.status(400).json({ error: "Bestand is leeg." });
    }

    // Stable path per diversion: re-uploaden = upsert overschrijft het oude bestand.
    const storagePath = `${id}.pdf`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(DIVERSIONS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    // Ondertekende URL i.p.v. publieke: de bucket is privé. De opgeslagen
    // pdfUrl vervalt, maar GET /api/diversions ondertekent bij élk ophalen
    // opnieuw op basis van `${id}.pdf`, dus de bijlage blijft bereikbaar.
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(DIVERSIONS_BUCKET)
      .createSignedUrl(storagePath, DIVERSION_URL_TTL_SEC);
    if (signError || !signed?.signedUrl) throw signError ?? new Error("Kon geen ondertekende URL maken.");
    res.json({ publicUrl: signed.signedUrl, storagePath, filename, sizeBytes: buffer.length });
  } catch (err: any) {
    console.error("Diversion PDF upload error:", err);
    console.error("Kon PDF niet uploaden.", err);
    res.status(500).json({ error: "Kon PDF niet uploaden." });
  }
});

app.get("/api/services", authenticate, async (req, res) => {
  try {
    const data = await getServicesData();
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
    res.json(data);
  } catch (err) {
    console.error("Error reading services data:", err);
    res.status(500).json({ error: "Gegevens laden is mislukt." });
  }
});

// --- Rostering-brug: solver-input als één JSON ---
// Read-only export voor de CP-SAT-roostersolver (vhb-planner): actieve
// chauffeurs met sectie/anciënniteit, dienstdefinities, goedgekeurd verlof
// (onbeschikbaarheid) en de huidige toewijzingen binnen [from, to].
// Auth: planner/admin-token, of Bearer CRON_SECRET zodat de solver headless
// kan ophalen zonder gebruikersaccount.
app.get("/api/rostering-export", async (req, res) => {
  const handle = async () => {
    try {
      // brusselsDay i.p.v. toISOString: op een UTC-server is "vandaag" tussen
    // 00:00 en 02:00 Belgische tijd anders gisteren.
    const iso = (d: Date) => brusselsDay(d.toISOString());
      const today = new Date();
      const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const from = validDate(req.query.from) ? req.query.from : iso(today);
      const to = validDate(req.query.to) ? req.query.to : iso(new Date(today.getTime() + 8 * 7 * 86_400_000));
      if (to < from) return res.status(400).json({ error: "'to' ligt vóór 'from'." });

      const [users, services, leave, planning] = await Promise.all([
        getUsersData(),
        getServicesData(),
        getLeaveData(),
        getPlanningData(),
      ]);
      res.json({
        generatedAt: new Date().toISOString(),
        range: { from, to },
        drivers: users
          .filter((u) => u.role === "chauffeur" && u.isActive !== false)
          .map((u) => ({ id: u.id, name: u.name, employeeId: u.employeeId ?? null, section: u.section ?? null, startDate: u.startDate ?? null })),
        services,
        approvedLeave: leave
          .filter((l) => l.status === "approved" && l.startDate <= to && l.endDate >= from)
          .map((l) => ({ userId: l.userId, startDate: l.startDate, endDate: l.endDate, type: l.type })),
        shifts: planning.filter((s: any) => s.date >= from && s.date <= to),
      });
    } catch (err) {
      console.error("Rostering-export mislukt:", err);
      if (!res.headersSent) res.status(500).json({ error: "Rostering-export mislukt." });
    }
  };
  if (isCronAuthorized(req)) return handle();
  return authenticate(req as AuthenticatedRequest, res, () => {
    const role = (req as AuthenticatedRequest).appUser?.role;
    if (role !== "admin" && role !== "planner") return res.status(403).json({ error: "Alleen voor planners/admins." });
    void handle();
  });
});

app.post("/api/services", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      const previousServices = await getServicesData();
      // De import-flow in dienstoverzicht-beheer vervangt legitiem de hele
      // collectie (verse ids per upload) en meldt dat expliciet via header.
      const isBulkReplace = req.headers["x-bulk-replace"] === "1";
      // De volledige-vervang-import is in de UI admin-only; dwing dat ook
      // server-side af (de header omzeilt anders de wipe-vangrail).
      if (isBulkReplace && req.appUser?.role !== "admin") {
        return res.status(403).json({ error: "Bulk-import van het dienstoverzicht is alleen voor admins." });
      }
      if (!isBulkReplace) {
        // Bulk-import vervangt bewust de hele collectie → revisie-/wipe-checks
        // alleen voor gewone bewerkingen.
        if (revisionConflict(req, previousServices)) return revisionConflictResponse(res, "Het dienstoverzicht");
        const servicesRemoved = detectMassDelete(previousServices, newData);
        if (servicesRemoved !== null) return massDeleteResponse(res, servicesRemoved, previousServices.length, "diensten");
      }
      await saveServicesData(newData);

      // Global summary entry (zoals voorheen)
      await logActivity(
        req,
        "services",
        "Diensten opgeslagen",
        `${newData.length} diensten opgeslagen. ${summarizeServiceChanges(previousServices, newData)}.`,
      );

      // Per-service entries voor per-entity wijzigingsgeschiedenis
      const diff = diffServiceChanges(previousServices, newData);
      const formatService = (s: typeof newData[number]) =>
        `Dienst ${s.serviceNumber} (${s.startTime}–${s.endTime}${s.startTime2 ? `, ${s.startTime2}–${s.endTime2}` : ''}${s.startTime3 ? `, ${s.startTime3}–${s.endTime3}` : ''}).`;
      for (const s of diff.added) {
        await logActivity(req, "services", "Dienst toegevoegd", formatService(s), { type: "service", id: s.id });
      }
      for (const s of diff.changed) {
        await logActivity(req, "services", "Dienst gewijzigd", formatService(s), { type: "service", id: s.id });
      }
      for (const s of diff.removed) {
        await logActivity(req, "services", "Dienst verwijderd", formatService(s), { type: "service", id: s.id });
      }

      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getServicesData()));
      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving services data:", errorMessage);
    console.error("Opslaan is mislukt.", errorMessage);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

app.get("/api/updates", authenticate, async (req, res) => {
  try {
    const data = await getUpdatesData();
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Updates laden is mislukt." });
  }
});

app.post("/api/updates", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const newData = req.body;
    // Zonder deze guard normaliseerde saveUpdatesData een niet-array naar []
    // en wiste vervolgens ALLE updates — met een vrolijke success-response.
    if (!Array.isArray(newData)) {
      return res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
    }
    const previousUpdates = await getUpdatesData();
    if (revisionConflict(req, previousUpdates)) return revisionConflictResponse(res, "De updates");
    const updatesRemoved = detectMassDelete(previousUpdates, newData);
    if (updatesRemoved !== null) return massDeleteResponse(res, updatesRemoved, previousUpdates.length, "updates");
    const arr = newData;
    await saveUpdatesData(newData);
    await logActivity(
      req,
      "updates",
      "Updates opgeslagen",
      `${arr.length} updates opgeslagen. ${summarizeUpdateChanges(previousUpdates, arr)}.`,
    );

    // Per-update audit entries
    const updDiff = diffUpdateChanges(previousUpdates, arr);
    // Categorieën zijn uit de UI verdwenen (#241) — niet meer in het
    // auditspoor echoën; URGENT blijft betekenisvol.
    const fmtUpd = (u: any) => `${u.title}${u.isUrgent ? ' [URGENT]' : ''}.`;
    for (const u of updDiff.added) {
      await logActivity(req, "updates", "Update toegevoegd", fmtUpd(u), { type: "update", id: u.id });
    }
    for (const u of updDiff.changed) {
      await logActivity(req, "updates", "Update gewijzigd", fmtUpd(u), { type: "update", id: u.id });
    }
    for (const u of updDiff.removed) {
      await logActivity(req, "updates", "Update verwijderd", fmtUpd(u), { type: "update", id: u.id });
    }

    // Nieuwe update → push naar alle actieve chauffeurs. Urgente updates mailen
    // al (aparte flow); een push zorgt dat óók gewone updates niet onopgemerkt
    // blijven tot iemand de app toevallig opent.
    if (updDiff.added.length > 0) {
      const chauffeurIds = (await getUsersData()).filter((u) => u.role === "chauffeur" && u.isActive !== false).map((u) => String(u.id));
      for (const u of updDiff.added) {
        await sendPushToUsers(chauffeurIds, {
          title: u.isUrgent ? "Belangrijke update" : "Nieuwe update",
          body: u.title,
          url: "/",
        });
      }
    }

    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Updates opslaan is mislukt.", err);
    res.status(500).json({ error: "Updates opslaan is mislukt." });
  }
});

// Chauffeur bevestigt gelezen: de Updates-weergave meldt de zichtbare updates
// bij het openen. Idempotent — al-gelezen combinaties zijn een no-op.
app.post("/api/updates/read", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    // De teller telt alléén chauffeurs (zij zijn de doelgroep). Een planner/
    // admin die de Updates-weergave opent mag de cijfers niet flatteren, dus
    // registreren we hun reads niet.
    if (req.appUser!.role !== "chauffeur") return res.json({ success: true });
    const ids = Array.isArray(req.body?.updateIds) ? req.body.updateIds.map((id: unknown) => String(id)) : [];
    if (ids.length === 0) return res.json({ success: true });
    await markUpdatesRead(String(req.appUser!.id), ids);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Leesbevestiging opslaan is mislukt.", err);
    res.status(500).json({ error: "Leesbevestiging opslaan is mislukt." });
  }
});

// Planner-teller: hoeveel (van de actieve) chauffeurs elke update gelezen heeft.
app.get("/api/updates/read-counts", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const users = await getUsersData();
    // Alleen actieve chauffeurs tellen mee — zowel in de noemer als, via de
    // id-set, in de teller (defensief tegen oude reads van wie intussen geen
    // actieve chauffeur meer is, zodat je nooit "8/6 gelezen" ziet).
    const chauffeurIds = new Set(
      users.filter((u) => u.role === "chauffeur" && u.isActive !== false).map((u) => String(u.id)),
    );
    const counts = await getUpdateReadCounts(chauffeurIds);
    res.json({ counts, totalChauffeurs: chauffeurIds.size });
  } catch (err: any) {
    console.error("Leestellers laden is mislukt.", err);
    res.status(500).json({ error: "Leestellers laden is mislukt." });
  }
});

app.get("/api/swaps", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = await getSwapsData();
    // Privacy: een chauffeur ziet enkel ruilen waar hij zélf bij betrokken is
    // (aanvrager of aangezochte collega) — niet de ruilhistoriek van iedereen.
    // Planner/admin zien alles (nodig voor validatie + beheer).
    if (req.appUser?.role === "chauffeur") {
      const selfId = String(req.appUser.id);
      const scoped = data.filter(
        (s) => String(s.requesterId) === selfId || String(s.targetDriverId ?? "") === selfId,
      );
      return res.json(scoped);
    }
    // Revisie enkel voor planner/admin (volledige weergave) — de POST-check
    // geldt ook alleen voor hen (chauffeur-payloads worden delta-gereconstrueerd).
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Dienstruilen laden is mislukt." });
  }
});

// Afgehandelde ruil-statussen: hieruit is geen overgang meer toegestaan.
const TERMINAL_SWAP_STATES = new Set(["rejected", "cancelled", "completed"]);

/** Leesbare activity-log-melding van een planning-doorvoer. `r` = resultaat
 *  van applySwapToPlanning/revertSwapFromPlanning; null = geen dienst-info op
 *  de swap (aanvraag van vóór de shift_info-migratie). */
const describeSwapCarry = (
  swap: any,
  r: { offeredMoved: number; returnMoved: number | null } | null,
  richting: "doorgevoerd" | "teruggedraaid",
): string => {
  if (!r) {
    return "Planning NIET automatisch bijgewerkt (aanvraag zonder dienst-info) — pas de planning handmatig aan.";
  }
  const delen: string[] = [];
  delen.push(
    r.offeredMoved > 0
      ? `dienst ${swap.shiftLine} op ${swap.shiftDate}: ${r.offeredMoved} rij(en) ${richting}`
      : `LET OP: dienst ${swap.shiftLine} op ${swap.shiftDate} niet gevonden in de planning — controleer handmatig`,
  );
  if (r.returnMoved !== null) {
    delen.push(
      r.returnMoved > 0
        ? `terugruil ${swap.returnCode} op ${swap.returnDate}: ${r.returnMoved} rij(en) ${richting}`
        : `LET OP: terugruil ${swap.returnCode} op ${swap.returnDate} niet gevonden — controleer handmatig`,
    );
  }
  return `Planning ${richting}: ${delen.join("; ")}.`;
};

/** Heropbouw-replay: goedgekeurde ruilen opnieuw toepassen op een vers
 *  gegenereerde planning. De matrix (Excel) kent de ruilen immers niet —
 *  zonder deze stap veegde elke import/heropbouw alle doorgevoerde wissels
 *  weer weg (en moest de planner ze in Excel overtypen). Volgorde op
 *  decidedAt zodat een latere ruil op het resultaat van een eerdere werkt. */
const reapplyApprovedSwaps = async (
  shifts: Array<{ date: string; line: string; driverId: string }>,
  bereik?: { van: string | null; tot: string | null },
) => {
  const approved = (await getSwapsData())
    .filter((sw) => sw.status === "approved")
    .sort((a, b) => String(a.decidedAt ?? "").localeCompare(String(b.decidedAt ?? "")));
  // Alleen ruilen binnen het geïmporteerde bereik meetellen. Zonder deze filter
  // telde élke historische ruil buiten het bereik als "niet toepasbaar", zodat
  // de import-log een almaar groeiend "(x niet toepasbaar)" meldde terwijl er
  // niets mis was — en een échte mismatch (dienst intussen handmatig verlegd)
  // daarin verdronk.
  const relevant = bereik?.van && bereik?.tot
    ? approved.filter((sw) => {
        const d = String(sw.shiftDate ?? "");
        return !d || (d >= bereik.van! && d <= bereik.tot!);
      })
    : approved;
  return applySwapsToPlanningRows(shifts, relevant);
};

/** Verlof-conflicten in een set planning-rijen: de chauffeur staat ingepland
 *  op een dag waarop hij goedgekeurd verlof heeft. */
type VerlofConflict = {
  driverId: string; driverName: string; date: string; serviceNumber: string;
  leaveStart: string; leaveEnd: string;
};
const verlofConflictKey = (c: VerlofConflict) => `${c.driverId}|${c.date}`;
const verlofConflictsIn = (
  shifts: Array<{ driverId: string; date: string; line: string }>,
  approvedLeave: Array<{ userId: string; startDate: string; endDate: string }>,
  naamVan: (id: string) => string,
): VerlofConflict[] => {
  const uit: VerlofConflict[] = [];
  for (const shift of shifts) {
    const overlap = approvedLeave.find((l) =>
      String(l.userId) === String(shift.driverId) &&
      l.startDate <= shift.date &&
      l.endDate >= shift.date,
    );
    if (overlap) {
      uit.push({
        driverId: shift.driverId,
        driverName: naamVan(shift.driverId),
        date: shift.date,
        serviceNumber: shift.line,
        leaveStart: overlap.startDate,
        leaveEnd: overlap.endDate,
      });
    }
  }
  return uit;
};

/**
 * Exclusiviteit bij goedkeuren — vervangt de oude check "bestaat er al een
 * andere goedgekeurde ruil voor deze shiftId?".
 *
 * Die check keek naar de rij-id, en die blijft na een doorvoer de
 * oorspronkelijke chauffeur bevatten. Een tweede ruil op dezelfde shiftId is
 * dus géén dubbele goedkeuring maar een legitieme dóórgeef-ketting
 * (d1 → d2 → d3); de oude vorm blokkeerde die permanent.
 *
 * Wat we wél moeten tegenhouden is een STÁLE ruil: eentje waarvan de aanvrager
 * de dienst intussen niet meer heeft. Die zou bij goedkeuring 0 rijen
 * verplaatsen en alleen een waarschuwing in de log achterlaten — de planner
 * denkt dan dat de wissel doorgevoerd is.
 *
 * Staat de dienst helemaal niet meer in de planning (heropbouw, handmatig
 * verwijderd), dan valt eigendom niet te controleren. Daar vallen we terug op
 * de oude regel, maar enkel voor dezélfde aanvrager: twee goedgekeurde ruilen
 * waarin chauffeur X dezelfde dienst weggeeft kan nooit kloppen, terwijl een
 * ketting (X → Y → Z) juist verschillende aanvragers heeft.
 */
const staleApprovalError = async (
  swap: { id?: unknown; shiftId?: unknown; requesterId?: unknown },
  allSwaps: Array<{ id?: unknown; shiftId?: unknown; requesterId?: unknown; status?: unknown }>,
): Promise<string | null> => {
  const shift = await getShiftById(String(swap?.shiftId ?? ""));
  if (shift) {
    return String(shift.driverId) === String(swap?.requesterId ?? "")
      ? null
      : "Deze dienst staat niet meer op naam van de aanvrager — de planning is intussen gewijzigd. Vernieuw de pagina en beoordeel opnieuw.";
  }
  const dubbelVanZelfdeAanvrager = allSwaps.some((s) =>
    String(s.id) !== String(swap?.id)
    && String(s.shiftId) === String(swap?.shiftId)
    && String(s.requesterId) === String(swap?.requesterId)
    && String(s.status) === "approved");
  return dubbelVanZelfdeAanvrager
    ? "Voor deze dienst is al een andere ruil van dezelfde chauffeur goedgekeurd."
    : null;
};

app.post("/api/swaps", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const newData = req.body;
    if (!Array.isArray(newData)) {
      return res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
    }

    const previousSwaps = await getSwapsData();
    // Planner/admin schrijven de hele payload ("ontbreekt = verwijderen"):
    // zonder revisie-check verwijderde een stale save stilletjes een verse
    // aanvraag die intussen binnenkwam. Chauffeur-payloads worden hieronder
    // delta-gereconstrueerd en hebben de check niet nodig.
    if (req.appUser?.role !== "chauffeur") {
      if (revisionConflict(req, previousSwaps)) return revisionConflictResponse(res, "De dienstruilen");
      const swapsRemoved = detectMassDelete(previousSwaps, newData);
      if (swapsRemoved !== null) return massDeleteResponse(res, swapsRemoved, previousSwaps.length, "dienstruilen");
    }
    const previousById = new Map(previousSwaps.map((s) => [String(s.id), s]));
    const newById = new Map(newData.map((s: any) => [String(s.id), s]));
    const swapIdsToDelete: string[] = [];
    // Eén lopende ruil per dienst — voorkomt dat twee gelijktijdige verzoeken
    // voor dezelfde shift allebei blijven lopen of goedgekeurd raken.
    //
    // BEWUST zonder 'approved': sinds de planning-doorvoer (#289) verhuist een
    // goedgekeurde ruil de dienst écht naar de collega, maar de rij-id blijft
    // de oorspronkelijke chauffeur bevatten. Stond 'approved' er nog in, dan
    // blokkeerde die afgehandelde ruil voor eeuwig élk nieuw verzoek voor
    // dezelfde shiftId — de nieuwe eigenaar kon de dienst dus nooit doorgeven
    // of terugruilen (409). Dat een dienst niet twee keer tegelijk weggegeven
    // wordt, bewaakt de eigendomscheck hieronder al: alleen de húidige
    // eigenaar kan hem aanbieden.
    const OPEN_SWAP_STATES = new Set(["pending", "accepted"]);
    // Wat er werkelijk weggeschreven wordt. Planner/admin schrijven de hele
    // payload (vertrouwde rol); voor een chauffeur bouwen we de set op uit
    // enkel de records die hij/zij legitiem toevoegt of beantwoordt — zo
    // overschrijft een echo van ongewijzigde records nooit een gelijktijdige
    // wijziging van een ander (geen vals 403, geen clobber).
    let recordsToWrite: any[] = newData;

    // Exclusiviteit per dienst geldt ook voor planner/admin-aanvragen —
    // de check zat eerst alleen in de chauffeur-tak.
    if (req.appUser?.role !== "chauffeur") {
      for (const next of newData) {
        if (previousById.has(String(next.id))) continue;
        // Alleen echte nieuwe aanvragen ('pending'); andere creatie-statussen
        // worden verderop al met een strengere 403 geweigerd.
        if (String(next.status) !== "pending") continue;
        if (previousSwaps.some((s) => String(s.shiftId) === String(next.shiftId) && OPEN_SWAP_STATES.has(String(s.status)))) {
          return res.status(409).json({ error: "Voor deze dienst loopt al een ruilverzoek. Trek dat eerst in of wacht de beslissing af." });
        }
      }
    }

    if (req.appUser?.role === "chauffeur") {
      const selfId = String(req.appUser.id);
      const writes: any[] = [];

      // Verwijderingen: alleen eigen pending-aanvragen mogen weg.
      for (const [id, prev] of previousById) {
        if (!newById.has(id)) {
          // GET /api/swaps is voor chauffeurs gescoped op ruilen waar ze
          // zélf bij betrokken zijn — andermans ruilen ontbreken dus altijd
          // in hun payload en zijn géén intrekking.
          const involved = String(prev.requesterId) === selfId || String(prev.targetDriverId ?? "") === selfId;
          if (!involved) continue;
          if (String(prev.requesterId) !== selfId || prev.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen je eigen openstaande wisselverzoeken intrekken." });
          }
          swapIdsToDelete.push(String(id));
        }
      }

      // Toevoegingen + wijzigingen. Users éénmalig vooraf: dit stond eerst
      // per nieuw record ín de loop (volledige gepagineerde users-fetch per
      // ruilverzoek).
      const allUsersForSwapChecks = await getUsersData();
      for (const next of newData) {
        const prev = previousById.get(String(next.id));
        if (!prev) {
          if (String(next.requesterId) !== selfId) {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen voor jezelf een wisselverzoek indienen." });
          }
          if (next.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: nieuwe wisselverzoeken starten als 'pending'." });
          }
          if (!next.targetDriverId || String(next.targetDriverId).trim() === "") {
            return res.status(400).json({ error: "Selecteer een collega aan wie je de dienstruil aanvraagt." });
          }
          if (String(next.targetDriverId) === selfId) {
            return res.status(400).json({ error: "Je kan geen dienstruil aan jezelf aanvragen." });
          }
          // Bij een overname (ruil zonder tegenprestatie) is er bewust géén
          // terugruil; de eigenlijke voorwaarde — de collega staat die dag op
          // vrij/bv/tk/ta — wordt rol-onafhankelijk verderop gecontroleerd.
          if (normalizeSwapType(next.swapType) === "ruil"
            && (!next.returnCode || String(next.returnCode).trim() === "" || !next.returnDate || String(next.returnDate).trim() === "")) {
            return res.status(400).json({ error: "Kies wat je in ruil neemt (een dienst of een vrije dag van de collega)." });
          }

          if (next.decidedAt) {
            return res.status(403).json({ error: "Niet toegestaan: nieuwe aanvraag mag geen beslismoment hebben." });
          }
          // Eigendom: de aangeboden dienst moet van de aanvrager zelf zijn
          // (anders kan je andermans dienst te ruil zetten) en de collega
          // moet een bestaande, actieve gebruiker zijn.
          const offeredShift = await getShiftById(String(next.shiftId ?? ""));
          if (!offeredShift || String(offeredShift.driverId) !== selfId) {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen je eigen dienst te ruil aanbieden." });
          }
          // Exclusiviteit per dienst: geen tweede open verzoek voor dezelfde shift.
          if (previousSwaps.some((s) => String(s.shiftId) === String(next.shiftId) && OPEN_SWAP_STATES.has(String(s.status)))) {
            return res.status(409).json({ error: "Voor deze dienst loopt al een ruilverzoek. Trek dat eerst in of wacht de beslissing af." });
          }
          const targetUser = allUsersForSwapChecks.find((u: any) => String(u.id) === String(next.targetDriverId));
          if (!targetUser || targetUser.isActive === false) {
            return res.status(400).json({ error: "De gekozen collega bestaat niet (meer) of is inactief." });
          }
          writes.push(next);
        } else {
          // De aangeduide collega mag een aan hem/haar gerichte, openstaande
          // ruil accepteren (pending → accepted) of weigeren (pending → rejected).
          // Definitieve goedkeuring blijft bij planner/admin (rij-/rusttijden).
          const selfIsTarget = String(prev.targetDriverId ?? "") === selfId;
          const selfIsRequester = String(prev.requesterId) === selfId;
          const isColleagueResponse =
            selfIsTarget && !selfIsRequester &&
            prev.status === "pending" &&
            (next.status === "accepted" || next.status === "rejected");

          if (isColleagueResponse) {
            // Enkel status (+ decidedAt bij weigeren) mag wijzigen; de rest niet.
            const immutable = ["shiftId", "requesterId", "targetDriverId", "createdAt", "reason", "returnDate", "returnCode"] as const;
            for (const f of immutable) {
              if (String((next as any)[f] ?? "") !== String((prev as any)[f] ?? "")) {
                return res.status(403).json({ error: "Niet toegestaan: je mag een aanvraag alleen accepteren of weigeren." });
              }
            }
            // Het ruiltype is eveneens onveranderlijk, maar tolerant voor een
            // oudere client uit de PWA-cache die het veld nog niet kent:
            // ontbreekt het, dan is dat géén wijziging — en we schrijven altijd
            // het opgeslagen type terug, zodat een overname niet stil naar een
            // 1-op-1 ruil degradeert.
            if (next.swapType !== undefined && normalizeSwapType(next.swapType) !== normalizeSwapType(prev.swapType)) {
              return res.status(403).json({ error: "Niet toegestaan: je mag een aanvraag alleen accepteren of weigeren." });
            }
            writes.push({ ...next, swapType: normalizeSwapType(prev.swapType) });
          }
          // Anders: ongewijzigde echo of een gelijktijdig door een ander
          // gewijzigd record → bewust NIET wegschrijven (geen 403, geen
          // overschrijving van de verse serverstaat).
        }
      }
      recordsToWrite = writes;
    }

    // Beleid: een ruil rechtstreeks goedkeuren vanuit 'pending' (dus zonder
    // bevestiging van de collega) mag enkel een admin. Planners keuren pas
    // goed nadat de collega accepteerde ('accepted' → 'approved'). Zo wordt de
    // UI-keuze ook server-side afgedwongen, niet enkel via verborgen knoppen.
    if (req.appUser?.role !== "admin") {
      for (const next of newData) {
        const prev = previousById.get(String(next.id));
        if (prev && prev.status === "pending" && next.status === "approved") {
          return res.status(403).json({ error: "Niet toegestaan: een ruil zonder bevestiging van de collega kan alleen een admin rechtstreeks goedkeuren." });
        }
        // Bypass-gat: zonder deze check kon een planner het pending-record
        // onder een NIEUW id met status 'approved' insturen en zo dezelfde
        // regel omzeilen. Nieuwe records starten dus altijd als 'pending'.
        if (!prev && next.status !== "pending") {
          return res.status(403).json({ error: "Niet toegestaan: nieuwe wisselverzoeken starten als 'pending'." });
        }
      }
    }

    // 'accepted' ís de instemming van de aangezochte collega — geen enkele
    // stafrol mag hem schrijven, ook een admin niet. De regel hierboven
    // blokkeerde alleen de sprong pending → approved; via pending → accepted
    // → approved was instemming alsnog te vervalsen (zelfde gat als in
    // PATCH /api/swaps/:id). Een admin keurt zonder bevestiging goed via de
    // directe pending → approved-weg.
    if (req.appUser?.role !== "chauffeur") {
      for (const next of newData) {
        const prev = previousById.get(String(next.id));
        if (String(next.status) === "accepted" && String(prev?.status ?? "") !== "accepted") {
          return res.status(403).json({ error: "Niet toegestaan: alleen de aangezochte collega kan een ruil accepteren." });
        }
      }
    }

    if (req.appUser?.role !== "chauffeur") {
      for (const [id] of previousById) {
        if (!newById.has(String(id))) swapIdsToDelete.push(String(id));
      }
    }

    // Exclusiviteit bij goedkeuren: de aanvrager moet de dienst op dat moment
    // nog écht hebben (zie staleApprovalError). Over recordsToWrite (niet
    // newData): een stale echo die niet weggeschreven wordt mag geen vals 409
    // op een ongerelateerde nieuwe aanvraag veroorzaken.
    for (const next of recordsToWrite) {
      const prev = previousById.get(String(next.id));
      const becomesApproved = next.status === "approved" && (!prev || prev.status !== "approved");
      if (!becomesApproved) continue;
      const stale = await staleApprovalError(next, previousSwaps);
      if (stale) return res.status(409).json({ error: stale });
    }

    // State-machine: een afgehandelde ruil (geweigerd/geannuleerd/voltooid) kan
    // niet meer van status veranderen — ook niet door een planner via een
    // directe API-call (rejected → approved was zo mogelijk).
    for (const next of recordsToWrite) {
      const prev = previousById.get(String(next.id));
      if (prev && String(next.status) !== String(prev.status) && TERMINAL_SWAP_STATES.has(String(prev.status))) {
        return res.status(409).json({ error: "Deze dienstruil is al afgehandeld en kan niet meer van status veranderen." });
      }
    }

    // Datum-shape afdwingen op nieuwe records — rol-onafhankelijk (de check
    // zat eerst alleen in de chauffeur-tak; de motivatie geldt voor élke rol:
    // een kapot formaat maakt de terugruil stil onzichtbaar in rooster/feed).
    for (const next of recordsToWrite) {
      if (previousById.has(String(next.id))) continue;
      if (next.returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(next.returnDate))) {
        return res.status(400).json({ error: "Ongeldige terugruil-datum: verwacht JJJJ-MM-DD." });
      }
    }

    // De tegenprestatie moet écht bestaan en van de aangezochte collega zijn.
    // Tot nu toe werd alleen het datumformaat gecontroleerd, terwijl de
    // planning-doorvoer die twee velden rechtstreeks vertaalt naar
    // `update planning set driverId`. Twee gaten die dat openliet:
    //
    //  1) een aanvrager kon een returnDate/returnCode meesturen die naar een
    //     ándere (aantrekkelijkere) dienst van de collega wijst dan de wizard
    //     toonde — twee mensen moeten akkoord gaan, maar de collega ziet in de
    //     UI wat er staat, niet wat er zou gebeuren;
    //  2) staat de collega die dag op twéé verschillende diensten, dan plakt
    //     /api/availability die samen tot "4101/4205". Als returnCode matcht
    //     dat geen enkele rij: de aangeboden dienst verhuisde wél, de
    //     tegenprestatie niet, en de 1-op-1 ruil werd stil een eenzijdige
    //     overname met alleen een waarschuwing in de log.
    //
    // 'vrij' blijft geldig zonder planning-rij: dan geeft de collega een vrije
    // dag en valt er niets te verplaatsen (zie swapHasReturnShift in storage).
    for (const next of recordsToWrite) {
      if (previousById.has(String(next.id))) continue;
      if (normalizeSwapType(next.swapType) === "overname") continue;
      const code = String(next.returnCode ?? "").trim();
      const date = String(next.returnDate ?? "").trim();
      if (!code || !date || code.toLowerCase() === "vrij") continue;
      const targetId = String(next.targetDriverId ?? "");
      const dagShifts = await getPlanningData({ driverId: targetId, monthIso: date.slice(0, 7) });
      const match = dagShifts.some((s: any) => String(s.date) === date && String(s.line).trim() === code);
      if (!match) {
        // Users pas hier ophalen: in het normale geval kost dit niets.
        const naam = (await getUsersData()).find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
        return res.status(400).json({
          error: code.includes("/")
            ? `${naam} rijdt op ${date} meerdere diensten (${code}). Kies één dienst als tegenprestatie.`
            : `Dienst ${code} staat op ${date} niet op naam van ${naam} — de planning is intussen gewijzigd. Vernieuw en kies opnieuw.`,
        });
      }
    }

    // Ruil zonder tegenprestatie ('overname'): alleen toegestaan als de
    // collega die dag géén dienst rijdt én in de planning op vrij/bv/tk/ta
    // staat. Rol-onafhankelijk: een dienst doorschuiven naar iemand die rijdt
    // (of ziek is) is voor elke rol onzin, niet enkel voor een chauffeur.
    // Het type zelf is immutable (zie de accepteer-tak hierboven), dus deze
    // check hoeft alleen op nieuwe records.
    {
      const newTakeovers = recordsToWrite.filter(
        (n: any) => !previousById.has(String(n.id)) && normalizeSwapType(n.swapType) === "overname",
      );
      if (newTakeovers.length > 0) {
        const [matrixRows, usersForTakeover] = await Promise.all([getPlanningMatrixRows(), getUsersData()]);
        for (const next of newTakeovers) {
          const targetId = String(next.targetDriverId ?? "").trim();
          if (!targetId) {
            return res.status(400).json({ error: "Selecteer een collega aan wie je de dienst wil doorgeven." });
          }
          const offeredShift = await getShiftById(String(next.shiftId ?? ""));
          if (!offeredShift) {
            return res.status(400).json({ error: "De aangeboden dienst bestaat niet (meer)." });
          }
          const date = String(offeredShift.date);
          const code = matrixCodesForDate(matrixRows, usersForTakeover, date).get(targetId);
          if (!isTakeoverCode(code)) {
            const naam = usersForTakeover.find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
            return res.status(409).json({
              error: code
                ? `${naam} staat op ${date} ingepland als '${code}'. Ruilen zonder tegenprestatie kan alleen als de collega die dag ${TAKEOVER_CODES.join("/")} staat.`
                : `Voor ${naam} staat er op ${date} niets in de planning. Ruilen zonder tegenprestatie kan alleen als de collega die dag ${TAKEOVER_CODES.join("/")} staat.`,
            });
          }
          // Dubbelcheck op de planning zelf: de matrix is de bron van de
          // codes, maar een handmatig toegevoegde dienst staat er niet in.
          const monthShifts = await getPlanningData({ monthIso: date.slice(0, 7) });
          if (monthShifts.some((s: any) => String(s.driverId) === targetId && String(s.date) === date)) {
            const naam = usersForTakeover.find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
            return res.status(409).json({ error: `${naam} heeft op ${date} toch een dienst in de planning staan — ruilen zonder tegenprestatie kan dan niet.` });
          }
        }
      }
    }

    // Het ruiltype ligt vast bij het indienen. Bestaande records erven dus
    // altijd het opgeslagen type: een client die het veld niet meestuurt
    // (oudere bundel uit de PWA-cache) mag een overname niet stil naar een
    // 1-op-1 ruil omzetten. shift_date/shift_line komen NOOIT van de client:
    // nieuw = server-side uit de planning-rij, bestaand = opgeslagen waarde —
    // dit is de sleutel voor de automatische planning-doorvoer hieronder.
    const finalRecords: any[] = [];
    for (const n of recordsToWrite) {
      const prev = previousById.get(String(n.id));
      let shiftDate = prev?.shiftDate;
      let shiftLine = prev?.shiftLine;
      if (!prev) {
        const offeredShift = await getShiftById(String(n.shiftId ?? ""));
        shiftDate = offeredShift?.date || undefined;
        shiftLine = offeredShift?.line || undefined;
      }
      // Zodra de collega heeft ingestemd (status niet meer 'pending') liggen
      // de vóórwaarden van de ruil vast — alleen status en beslismoment mogen
      // daarna nog wijzigen.
      //
      // Zonder deze bevriezing kon een planner een geaccepteerde ruil eerst
      // inhoudelijk herschrijven (andere collega, andere tegenprestatie) en
      // hem dan goedkeuren. Geen enkele guard hield dat tegen — er wordt geen
      // 'accepted' geschreven en er is geen pending → approved-sprong —
      // terwijl de doorvoer wél de gewijzigde voorwaarden uitvoert en de log
      // "Dienstruil goedgekeurd" noteert alsof de collega daarmee instemde.
      const bevroren = prev && String(prev.status) !== "pending"
        ? {
            shiftId: prev.shiftId,
            requesterId: prev.requesterId,
            targetDriverId: prev.targetDriverId,
            returnDate: prev.returnDate,
            returnCode: prev.returnCode,
          }
        : {};
      finalRecords.push({
        ...n,
        ...bevroren,
        swapType: normalizeSwapType(prev ? prev.swapType : n.swapType),
        shiftDate,
        shiftLine,
      });
    }

    // Planning-doorvoer VÓÓR de save — zelfde reden als bij PATCH /api/swaps/:id:
    // movePlanningRows filtert op de huidige eigenaar en is dus idempotent, dus
    // een herhaalde poging is ongevaarlijk. Faalt de doorvoer halverwege, dan
    // is de status nog niet gewijzigd en kan de planner het gewoon opnieuw
    // proberen — voorheen bleef er een halve wissel achter bij een ruil die al
    // op 'approved' stond. Blijft best-effort: 0 verplaatste rijen (dienst
    // handmatig verlegd) blokkeert de beslissing niet, maar komt in de log.
    //
    // Terugdraaien bij annuleren én afwijzen; 'completed' laat de wissel staan.
    const carryLogById = new Map<string, string>();
    for (const next of finalRecords) {
      const prev = previousById.get(String(next.id));
      if (!prev || prev.status === next.status) continue;
      if (next.status === "approved") {
        const r = await applySwapToPlanning(next);
        carryLogById.set(String(next.id), describeSwapCarry(next, r, "doorgevoerd"));
      } else if (prev.status === "approved" && (next.status === "cancelled" || next.status === "rejected")) {
        const r = await revertSwapFromPlanning(next);
        carryLogById.set(String(next.id), describeSwapCarry(next, r, "teruggedraaid"));
      }
    }

    await saveSwapsData(finalRecords, swapIdsToDelete);

    // Activity log: detecteer state-overgangen en nieuwe aanvragen. Over
    // recordsToWrite zodat een niet-weggeschreven echo geen spookmelding geeft.
    const usersForLog = await getUsersData();
    const userName = (id: string) => usersForLog.find((u) => String(u.id) === String(id))?.name || `Onbekende gebruiker (${id})`;
    for (const next of finalRecords) {
      const prev = previousById.get(String(next.id));
      if (!prev) {
        const isTakeover = normalizeSwapType(next.swapType) === "overname";
        await logActivity(
          req,
          "swaps",
          "Dienstruil aangevraagd",
          isTakeover
            ? `${userName(next.requesterId)} bood een dienst aan ter overname (zonder tegenprestatie).`
            : `${userName(next.requesterId)} bood een dienst aan voor ruil.`,
          { type: "swap", id: next.id },
        );
        // De aangezochte collega krijgt direct een seintje.
        if (next.targetDriverId) {
          await sendPushToUsers([String(next.targetDriverId)], {
            title: isTakeover ? "Vraag om een dienst over te nemen" : "Nieuwe dienstruil-aanvraag",
            body: isTakeover
              ? `${userName(next.requesterId)} vraagt of je een dienst wil overnemen — zonder tegenprestatie.`
              : `${userName(next.requesterId)} wil een dienst met je ruilen.`,
            url: "/",
          });
        }
        continue;
      }
      if (prev.status !== next.status && next.status !== "pending") {
        let action: string | null = null;
        if (next.status === "accepted") action = "Dienstruil geaccepteerd";
        else if (next.status === "approved") action = "Dienstruil goedgekeurd";
        else if (next.status === "rejected") action = "Dienstruil afgewezen";
        else if (next.status === "cancelled") action = "Dienstruil geannuleerd";
        else if (next.status === "completed") action = "Dienstruil voltooid";
        if (action) {
          const carry = carryLogById.get(String(next.id));
          await logActivity(req, "swaps", action, `${userName(next.requesterId)} — dienstruil (${prev.status} → ${next.status}).${carry ? ` ${carry}` : ""}`, { type: "swap", id: next.id });
          // Push naar de betrokkenen, behalve degene die de actie deed.
          const actorId = String(req.appUser?.id ?? "");
          const betrokkenen = [String(prev.requesterId), String(prev.targetDriverId ?? "")]
            .filter((id) => id && id !== actorId);
          await sendPushToUsers(betrokkenen, {
            title: action,
            body: next.status === "accepted"
              ? `${userName(String(prev.targetDriverId ?? ""))} accepteerde de ruil — wacht op goedkeuring van de planner.`
              : `Dienstruil van ${userName(next.requesterId)}: ${prev.status} → ${next.status}.`,
            url: "/",
          });
          // Geaccepteerd = er wacht een validatie op de planner — die kreeg
          // hier tot nu toe geen seintje van. Beslissers pushen (behalve de
          // actor zelf, als die toevallig planner/admin is).
          if (next.status === "accepted") {
            const beslissers = usersForLog
              .filter((u) => (u.role === "planner" || u.role === "admin") && String(u.id) !== actorId)
              .map((u) => String(u.id));
            await sendPushToUsers(beslissers, {
              title: "Dienstruil wacht op validatie",
              body: `${userName(String(prev.targetDriverId ?? ""))} accepteerde de ruil van ${userName(next.requesterId)} — rij- en rusttijden checken.`,
              url: "/",
            });
          }
        }
      }
    }

    // Verse revisie zodat een direct volgende save van dezelfde sessie geen
    // vals 409 krijgt ("gewijzigd door iemand anders" = je eigen save).
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getSwapsData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Dienstruil opslaan is mislukt.", err);
    res.status(500).json({ error: "Dienstruil opslaan is mislukt." });
  }
});

// Delta-endpoint voor beslissingen: één record, met optimistic-concurrency
// via ifStatus. Twee planners die tegelijk beoordelen kunnen elkaars
// beslissing zo niet meer stilletjes overschrijven (de whole-array-POST kon
// dat wel): de tweede krijgt een 409 en een verse lijst.
app.patch("/api/swaps/:id", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    const status = String(req.body?.status ?? "");
    // Verplicht: zonder ifStatus is er géén concurrency-guard en geldt stil
    // last-write-wins — precies het gat dat deze route moest dichten.
    const ifStatus = req.body?.ifStatus ? String(req.body.ifStatus) : null;
    if (!ifStatus) {
      return res.status(400).json({ error: "ifStatus ontbreekt: stuur de status waarop je beslissing gebaseerd is mee." });
    }

    const all = await getSwapsData();
    const current = all.find((s) => String(s.id) === id);
    if (!current) {
      return res.status(404).json({ error: "Deze dienstruil bestaat niet (meer) — mogelijk net ingetrokken." });
    }
    if (ifStatus && String(current.status) !== ifStatus) {
      return res.status(409).json({
        error: `Deze ruil is intussen al '${current.status}' — de lijst is ververst.`,
        currentStatus: current.status,
      });
    }

    const role = req.appUser!.role;
    const selfId = String(req.appUser!.id);
    if (role === "chauffeur") {
      // Alleen de aangezochte collega mag een openstaande ruil accepteren
      // of weigeren — zelfde regels als de array-route. Daarnaast mag de
      // AANVRAGER zijn eigen ruil intrekken zolang die nog open staat
      // (pending of accepted-maar-nog-niet-goedgekeurd): verlof kon dat al,
      // dienstruil dwong een belletje naar de planner af.
      const isTarget = String(current.targetDriverId ?? "") === selfId && String(current.requesterId) !== selfId;
      const targetTransition = isTarget && current.status === "pending" && (status === "accepted" || status === "rejected");
      const isRequester = String(current.requesterId) === selfId;
      const withdrawTransition = isRequester && status === "cancelled" && (current.status === "pending" || current.status === "accepted");
      if (!targetTransition && !withdrawTransition) {
        return res.status(403).json({ error: "Niet toegestaan: je mag een aan jou gerichte, openstaande ruil accepteren of weigeren, of je eigen openstaande aanvraag intrekken." });
      }
    } else {
      // 'accepted' ís de instemming van de aangezochte collega — alleen die
      // collega mag hem schrijven, geen enkele stafrol. Zonder deze regel
      // blokkeerde alleen de sprong pending → approved en kon een planner in
      // twee stappen (pending → accepted → approved) instemming vervalsen,
      // inclusief de push "<collega> accepteerde de ruil" naar de aanvrager.
      // Een admin die zonder bevestiging wil goedkeuren gebruikt de bestaande
      // directe pending → approved-weg hieronder.
      if (status === "accepted" && current.status !== "accepted") {
        return res.status(403).json({ error: "Niet toegestaan: alleen de aangezochte collega kan een ruil accepteren." });
      }
      const allowed = ["accepted", "approved", "rejected", "cancelled", "completed"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: "Ongeldige status." });
      }
      // Force-approve vanuit pending blijft admin-only (zelfde beleid als POST).
      if (role !== "admin" && current.status === "pending" && status === "approved") {
        return res.status(403).json({ error: "Niet toegestaan: een ruil zonder bevestiging van de collega kan alleen een admin rechtstreeks goedkeuren." });
      }
    }

    // State-machine: uit een afgehandelde status (geweigerd/geannuleerd/
    // voltooid) is geen overgang meer toegestaan (rejected → approved was zo
    // mogelijk).
    if (status !== current.status && TERMINAL_SWAP_STATES.has(String(current.status))) {
      return res.status(409).json({ error: "Deze dienstruil is al afgehandeld en kan niet meer van status veranderen." });
    }

    // Exclusiviteit: de aanvrager moet de dienst nog hebben (zie ook
    // staleApprovalError bij POST /api/swaps).
    if (status === "approved" && current.status !== "approved") {
      const stale = await staleApprovalError(current, all);
      if (stale) return res.status(409).json({ error: stale });
    }

    // Planning-doorvoer VÓÓR de statuswijziging. movePlanningRows filtert op
    // de huidige eigenaar en is daardoor idempotent: een tweede poging
    // verplaatst niets extra. Andersom (eerst opslaan) liet een mislukte
    // tweede leg een hálve wissel achter terwijl de ruil al op 'approved'
    // stond — en dan blokkeerde de ifStatus-guard elke nieuwe poging, zodat
    // alleen handmatig sleutelen in de database het nog rechttrok.
    //
    // Terugdraaien geldt voor élke overgang die betekent "gaat toch niet
    // door": annuleren én afwijzen. Alleen 'completed' laat de wissel staan,
    // want dat betekent juist dat hij is uitgevoerd. Stond hier eerst enkel
    // 'cancelled', waardoor approved → rejected de dienst bij de collega liet
    // staan terwijl de replay hem bij de volgende import weer terugzette.
    let carry: string | undefined;
    if (status === "approved" && current.status !== "approved") {
      const r = await applySwapToPlanning(current);
      carry = describeSwapCarry(current, r, "doorgevoerd");
    } else if (current.status === "approved" && (status === "cancelled" || status === "rejected")) {
      const r = await revertSwapFromPlanning(current);
      carry = describeSwapCarry(current, r, "teruggedraaid");
    }

    // 'accepted' is een tussenstap (collega akkoord), nog géén beslismoment —
    // decidedAt hoort pas bij een definitieve beslissing (zelfde semantiek
    // als de array-route/UI).
    const updated = status === "accepted"
      ? { ...current, status }
      : { ...current, status, decidedAt: new Date().toISOString() };
    await saveSwapsData([updated], []);

    const usersForLog = await getUsersData();
    const userName = (uid: string) => usersForLog.find((u) => String(u.id) === String(uid))?.name || `Onbekende gebruiker (${uid})`;
    const actionLabels: Record<string, string> = {
      accepted: "Dienstruil geaccepteerd",
      approved: "Dienstruil goedgekeurd",
      rejected: "Dienstruil afgewezen",
      cancelled: "Dienstruil geannuleerd",
      completed: "Dienstruil voltooid",
    };
    const action = actionLabels[status] ?? "Dienstruil bijgewerkt";
    await logActivity(req, "swaps", action, `${userName(String(current.requesterId))} — dienstruil (${current.status} → ${status}).${carry ? ` ${carry}` : ""}`, { type: "swap", id });

    const betrokkenen = [String(current.requesterId), String(current.targetDriverId ?? "")]
      .filter((uid) => uid && uid !== selfId);
    await sendPushToUsers(betrokkenen, {
      title: action,
      body: status === "accepted"
        ? `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil — wacht op goedkeuring van de planner.`
        : `Dienstruil van ${userName(String(current.requesterId))}: ${current.status} → ${status}.`,
      url: "/",
    });
    // Geaccepteerd = validatie nodig → beslissers een seintje (zie array-route).
    if (status === "accepted") {
      const beslissers = usersForLog
        .filter((u) => (u.role === "planner" || u.role === "admin") && String(u.id) !== selfId)
        .map((u) => String(u.id));
      await sendPushToUsers(beslissers, {
        title: "Dienstruil wacht op validatie",
        body: `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil van ${userName(String(current.requesterId))} — rij- en rusttijden checken.`,
        url: "/",
      });
    }

    // Verse collectie-revisie meegeven zodat een volgende array-save van
    // dezelfde client geen vals 409 krijgt na deze delta-wijziging.
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getSwapsData()));
    res.json({ success: true, swap: updated });
  } catch (err: any) {
    console.error("Beslissing opslaan is mislukt", err);
    res.status(500).json({ error: "Beslissing opslaan is mislukt" });
  }
});

app.get("/api/leave", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = await getLeaveData();
    // Privacy: een chauffeur ziet enkel zijn eigen verlof (incl. de vrije-tekst
    // reden). Planner/admin zien alles (voor verlof-beheer en bezetting).
    if (req.appUser?.role === "chauffeur") {
      const selfId = String(req.appUser.id);
      return res.json(data.filter((l) => String(l.userId) === selfId));
    }
    // Revisie enkel voor planner/admin (volledige weergave), zie /api/swaps.
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Verlofaanvragen laden is mislukt." });
  }
});

// Ziekmelding: aparte, directe flow (géén goedkeuring — de chauffeur ís al
// ziek). Maakt een reeds-goedgekeurd 'ziekte'-verlofrecord zodat de dag
// meteen als onbeschikbaar telt in Maandplanning/Dekking, en waarschuwt de
// planning via push + mail. BEWUST alleen planner/admin: ziekmelding komt
// telefonisch bij de planning binnen, die registreert het — een chauffeur
// mag zichzelf niet ziek (in)plannen.
app.post("/api/leave/sick-report", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const selfId = String(req.appUser?.id ?? "");
    const forUserId = String(req.body?.userId ?? "");
    if (!forUserId) return res.status(400).json({ error: "Kies de chauffeur die ziek is." });

    const isoDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const todayLocal = new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, lokale dag
    const startDate = isoDay(req.body?.startDate) ?? todayLocal;
    const endDate = isoDay(req.body?.endDate) ?? startDate;
    if (endDate < startDate) return res.status(400).json({ error: "Einddatum ligt vóór de startdatum." });
    const comment = String(req.body?.comment ?? "").slice(0, 1000);

    const users = await getUsersData();
    const target = users.find((u) => String(u.id) === forUserId);
    if (!target) return res.status(400).json({ error: "Onbekende gebruiker." });

    const record = {
      id: crypto.randomUUID(),
      userId: forUserId,
      startDate,
      endDate,
      type: "ziekte" as const,
      status: "approved" as const,
      comment,
      createdAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
    };
    const previousLeave = await getLeaveData();
    await saveLeaveData([...previousLeave, record]);

    const period = startDate === endDate ? startDate : `${startDate} t/m ${endDate}`;
    await logActivity(req, "leave", "Ziekmelding", `${target.name} ziek gemeld voor ${period} (door ${req.appUser?.name}).`, { type: "leave", id: record.id });

    // De hele planning waarschuwen. Push gaat niet naar wie het zelf
    // registreerde (een melding over je eigen klik is ruis), maar de mail
    // wél — die dient als vastlegging in de mailbox, en de registrerende
    // planner wil hem juist óók (verzoek Jarno 04-08).
    const planningRollen = users.filter((u) => u.role === "planner" || u.role === "admin");
    const beslissers = planningRollen.filter((u) => String(u.id) !== selfId);
    await sendPushToUsers(beslissers.map((u) => String(u.id)), {
      title: "Ziekmelding",
      body: `${target.name} is ziek gemeld voor ${period}.`,
      url: "/",
    });
    // Per planner een eigen mail, rechtstreeks geadresseerd — géén BCC-batch.
    // sendEmail zet meerdere ontvangers in BCC (met noreply als To), en
    // Microsoft 365 filterde precies die vorm stilletjes weg: de testmail
    // (direct in To) kwam wél aan op hetzelfde adres (04-08). De BCC-vorm is
    // er tegen adressenlekken bij bulk naar alle chauffeurs; voor een handvol
    // planners die elkaars adres kennen is los versturen veiliger én leest de
    // mail normaal. Volgorde: één voor één, fouten loggen maar niet blokkeren.
    const recipients = planningRollen.filter((u) => u.email).map((u) => u.email as string);
    for (const adres of recipients) {
      await sendEmail({
        to: [adres],
        context: `sick:${forUserId}`,
        subject: `Ziekmelding — ${target.name} (${period})`,
        text: `${target.name} is ziek gemeld voor ${period}.${comment ? `\n\nToelichting: ${comment}` : ""}\n\nDe dienst(en) staan nu als onbeschikbaar in de Maandplanning en Dekking.`,
        html: `<p><strong>${escapeHtml(target.name)}</strong> is ziek gemeld voor <strong>${escapeHtml(period)}</strong>.</p>${comment ? `<p>Toelichting: ${escapeHtml(comment)}</p>` : ""}<p>De dienst(en) staan nu als onbeschikbaar in de Maandplanning en Dekking.</p>`,
      });
    }

    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
    res.json({ success: true, leave: record });
  } catch (err) {
    console.error("Ziekmelding mislukt:", err);
    res.status(500).json({ error: "Ziekmelding is mislukt." });
  }
});

app.post("/api/leave", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const newData = req.body;
    if (!Array.isArray(newData)) {
      res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      return;
    }

    const previousLeave = await getLeaveData();
    // Planner/admin-payload is gezaghebbend ("ontbreekt = verwijderen"):
    // revisie-check + wipe-detectie zodat een stale save geen verse aanvraag
    // stilletjes verwijdert. Chauffeur-payloads worden delta-gereconstrueerd.
    if (req.appUser?.role !== "chauffeur") {
      if (revisionConflict(req, previousLeave)) return revisionConflictResponse(res, "De verlofaanvragen");
      const leaveRemoved = detectMassDelete(previousLeave, newData);
      if (leaveRemoved !== null) return massDeleteResponse(res, leaveRemoved, previousLeave.length, "verlofaanvragen");
    }
    const previousById = new Map(previousLeave.map((r) => [r.id, r]));
    const users = await getUsersData();
    const userName = (id: string) => users.find((u) => String(u.id) === String(id))?.name || `Onbekende gebruiker (${id})`;
    const formatPeriod = (start: string, end: string) => start === end ? start : `${start} t/m ${end}`;
    const leaveTypeLabels: Record<string, string> = {
      betaald_verlof: "Betaald verlof",
      klein_verlet: "Klein verlet",
      ziekte: "Ziekte",
    };
    const formatLeaveType = (t: string) => leaveTypeLabels[t] ?? t;

    // Server-side autorisatie: chauffeurs kunnen alleen eigen pending-aanvragen
    // toevoegen of intrekken. Status-overgangen en bewerken van anderen vereist
    // planner/admin.
    const payloadLeaveIds = new Set(newData.map((r: any) => String(r.id)));
    const leaveIdsToDelete: string[] = [];
    // Wat er werkelijk weggeschreven wordt. Planner/admin schrijven de hele
    // payload (vertrouwde rol); voor een chauffeur bouwen we — net als bij
    // /api/swaps — enkel de records op die hij/zij legitiem toevoegt, en
    // droppen we echo's van bestaande records. Zo geeft een stale echo geen
    // vals 403 en overschrijft hij nooit een gelijktijdige planner-beslissing
    // (TOCTOU-clobber).
    let recordsToWrite: any[] = newData;

    if (req.appUser?.role === "chauffeur") {
      const newById = new Map(newData.map((r: any) => [String(r.id), r]));
      const selfId = String(req.appUser.id);

      for (const [id, prev] of previousById) {
        if (!newById.has(String(id))) {
          // GET /api/leave is voor chauffeurs gescoped op eigen records:
          // verlof van collega's zit dus nooit in hun payload en mag hier
          // niet als 'intrekking' gelden — anders krijgt elke chauffeur
          // 403 zodra een collega ook maar één verlofrecord heeft.
          if (String(prev.userId) !== selfId) continue;
          // Alleen eigen pending-aanvragen die de chauffeur weglaat = intrekking.
          // Een weggelaten al-besliste eigen aanvraag (bv. stale sessie)
          // negeren we bewust i.p.v. 403 — beslissen doet de chauffeur toch niet.
          if (prev.status === "pending") leaveIdsToDelete.push(String(id));
        }
      }

      const chauffeurWrites: any[] = [];
      for (const next of newData) {
        // Echo van een bestaand record wordt NOOIT (her)geschreven: chauffeurs
        // mochten bestaande aanvragen sowieso niet bewerken. Enkel écht nieuwe.
        if (previousById.has(String(next.id))) continue;
        if (String(next.userId) !== selfId) {
          return res.status(403).json({ error: "Niet toegestaan: je kan alleen voor jezelf verlof aanvragen." });
        }
        if (next.status !== "pending") {
          return res.status(403).json({ error: "Niet toegestaan: nieuwe verlofaanvragen starten als 'pending'." });
        }
        if (next.decidedAt) {
          return res.status(403).json({ error: "Niet toegestaan: nieuwe aanvraag mag geen beslismoment hebben." });
        }
        chauffeurWrites.push(next);
      }
      recordsToWrite = chauffeurWrites;
    } else {
      // Planner/admin: alles wat uit de (volledige) payload is weggelaten is
      // een bewuste verwijdering door een vertrouwde rol.
      for (const [id] of previousById) {
        if (!payloadLeaveIds.has(String(id))) leaveIdsToDelete.push(String(id));
      }
    }

    // Domeinvalidatie op nieuwe records (álle rollen): alle afgeleide logica
    // (bezetting, conflictdetectie, agenda-feed) vergelijkt datums als
    // strings — één kapotte datum maakt een aanvraag daar stil onzichtbaar
    // terwijl hij wél goedgekeurd kan worden.
    const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
    for (const next of recordsToWrite) {
      if (previousById.has(String(next.id))) continue;
      const start = String(next.startDate ?? "");
      const end = String(next.endDate ?? "");
      if (!ISO_DAY.test(start) || !ISO_DAY.test(end)) {
        return res.status(400).json({ error: "Ongeldige datum in de aanvraag: verwacht JJJJ-MM-DD." });
      }
      if (end < start) {
        return res.status(400).json({ error: "De einddatum ligt vóór de startdatum." });
      }
      if (!leaveTypeLabels[String(next.type ?? "")]) {
        return res.status(400).json({ error: "Ongeldig verloftype." });
      }
    }

    await saveLeaveData(recordsToWrite, leaveIdsToDelete);

    if (leaveIdsToDelete.length > 0) {
      await logActivity(
        req,
        "leave",
        "Verlof ingetrokken",
        `${leaveIdsToDelete.length} verlofaanvra${leaveIdsToDelete.length === 1 ? "ag" : "gen"} ingetrokken/verwijderd.`,
      );
    }

    for (const next of recordsToWrite) {
      const prev = previousById.get(next.id);
      const period = formatPeriod(next.startDate, next.endDate);
      const typeLabel = formatLeaveType(next.type);

      if (!prev) {
        await logActivity(
          req,
          "leave",
          "Verlof aangevraagd",
          `${userName(next.userId)} vroeg ${typeLabel} aan voor ${period}.`,
          { type: "leave", id: next.id },
        );
        // Nieuwe aanvraag van een chauffeur → seintje naar planners/admins.
        if (req.appUser?.role === "chauffeur") {
          const beslissers = users.filter((u) => u.role === "planner" || u.role === "admin").map((u) => String(u.id));
          await sendPushToUsers(beslissers, {
            title: "Nieuwe verlofaanvraag",
            body: `${userName(next.userId)} vroeg ${typeLabel} aan voor ${period}.`,
            url: "/",
          });
        }
        continue;
      }

      if (prev.status !== next.status && next.status !== "pending") {
        let action: string | null = null;
        let emailAction: LeaveDecisionAction | null = null;
        if (next.status === "approved") { action = "Verlof goedgekeurd"; emailAction = "approved"; }
        else if (next.status === "rejected") { action = "Verlof afgewezen"; emailAction = "rejected"; }
        else if (next.status === "cancelled") { action = "Verlof geannuleerd"; emailAction = "cancelled"; }
        if (!action) continue;
        await logActivity(
          req,
          "leave",
          action,
          `${userName(next.userId)} — ${typeLabel} (${period}).`,
          { type: "leave", id: next.id },
        );

        // E-mail + push naar de aanvrager — niet de actor zelf (geen mail
        // naar jezelf als planner/admin je eigen verlof beslist).
        if (emailAction && req.appUser && String(req.appUser.id) !== String(next.userId)) {
          const recipient = users.find((u) => String(u.id) === String(next.userId));
          if (recipient?.email) {
            await sendLeaveDecisionEmail({
              to: recipient.email,
              recipientName: recipient.name,
              decidedByName: req.appUser.name || "Planning",
              typeLabel,
              startDate: next.startDate,
              endDate: next.endDate,
              action: emailAction,
            });
          }
          await sendPushToUsers([String(next.userId)], {
            title: action,
            body: `${typeLabel} (${period}) — beslist door ${req.appUser.name || "Planning"}.`,
            url: "/",
          });
        }
      }
    }

    // Verse revisie (zie /api/swaps).
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Verlofaanvraag opslaan is mislukt.", err);
    res.status(500).json({ error: "Verlofaanvraag opslaan is mislukt." });
  }
});

// Delta-endpoint voor verlofbeslissingen (zie PATCH /api/swaps/:id voor het
// waarom). Beslissen is planner/admin-werk; chauffeurs trekken in via de
// array-route (volledige verwijdering van eigen pending).
app.patch("/api/leave/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    const status = String(req.body?.status ?? "");
    // Verplicht, net als bij swaps: zonder ifStatus is er géén concurrency-
    // guard en geldt stil last-write-wins — het gat dat deze route moest
    // dichten (#251 beloofde dit voor beide routes; leave was vergeten).
    const ifStatus = req.body?.ifStatus ? String(req.body.ifStatus) : null;
    if (!ifStatus) {
      return res.status(400).json({ error: "ifStatus ontbreekt: stuur de status waarop je beslissing gebaseerd is mee." });
    }
    const allowed = ["approved", "rejected", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Ongeldige status." });
    }

    const all = await getLeaveData();
    const current = all.find((l) => String(l.id) === id);
    if (!current) {
      return res.status(404).json({ error: "Deze verlofaanvraag bestaat niet (meer) — mogelijk net ingetrokken." });
    }
    if (String(current.status) !== ifStatus) {
      return res.status(409).json({
        error: `Deze aanvraag is intussen al '${current.status}' — de lijst is ververst.`,
        currentStatus: current.status,
      });
    }
    // State-machine (spiegel van TERMINAL_SWAP_STATES): een afgewezen of
    // geannuleerde aanvraag is een eindstation. approved → cancelled blijft
    // toegestaan ("Verlof annuleren").
    if (status !== current.status && ["rejected", "cancelled"].includes(String(current.status))) {
      return res.status(409).json({ error: "Deze verlofaanvraag is al afgehandeld en kan niet meer van status veranderen." });
    }

    const decidedAt = new Date().toISOString();
    const updated = { ...current, status, decidedAt };
    await saveLeaveData([updated], []);

    const users = await getUsersData();
    const requester = users.find((u) => String(u.id) === String(current.userId));
    const requesterName = requester?.name || `Onbekende gebruiker (${current.userId})`;
    const period = current.startDate === current.endDate ? current.startDate : `${current.startDate} t/m ${current.endDate}`;
    const leaveTypeLabels: Record<string, string> = { betaald_verlof: "Betaald verlof", klein_verlet: "Klein verlet" };
    const typeLabel = leaveTypeLabels[current.type] ?? current.type;
    const actionLabels: Record<string, string> = {
      approved: "Verlof goedgekeurd",
      rejected: "Verlof afgewezen",
      cancelled: "Verlof geannuleerd",
    };
    const action = actionLabels[status]!;
    await logActivity(req, "leave", action, `${requesterName} — ${typeLabel} (${period}).`, { type: "leave", id });

    // E-mail + push naar de aanvrager — niet de actor zelf.
    if (req.appUser && String(req.appUser.id) !== String(current.userId)) {
      if (requester?.email) {
        await sendLeaveDecisionEmail({
          to: requester.email,
          recipientName: requester.name,
          decidedByName: req.appUser.name || "Planning",
          typeLabel,
          startDate: current.startDate,
          endDate: current.endDate,
          action: status as LeaveDecisionAction,
        });
      }
      await sendPushToUsers([String(current.userId)], {
        title: action,
        body: `${typeLabel} (${period}) — beslist door ${req.appUser.name || "Planning"}.`,
        url: "/",
      });
    }

    // Verse collectie-revisie (zie /api/swaps PATCH).
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
    res.json({ success: true, leave: updated });
  } catch (err: any) {
    console.error("Beslissing opslaan is mislukt", err);
    res.status(500).json({ error: "Beslissing opslaan is mislukt" });
  }
});

app.post("/api/send-urgent-update-email", authenticate, requireRole("planner", "admin"), async (req, res) => {
  const { update } = req.body;

  if (!update || !update.title) {
    return res.status(400).json({ error: "Missing update" });
  }

  // Ontvangers ALTIJD server-side bepalen (nooit uit de request-body): anders
  // kon een planner/admin de bedrijfs-SMTP als relay naar willekeurige externe
  // adressen gebruiken. De mail gaat naar wie een e-mailadres heeft; de push
  // naar álle actieve gebruikers (ook e-mailloze chauffeurs — het is dringend).
  const allUsers = await getUsersData();
  const activeUsers = allUsers.filter((u) => u.isActive !== false);
  const emails = activeUsers.map((u) => u.email).filter(Boolean) as string[];

  // Push naar álle actieve gebruikers (ook wie geen e-mail heeft) — best-effort.
  await sendPushToUsers(
    activeUsers.map((u) => String(u.id)).filter(Boolean),
    { title: `🚨 ${update.title}`, body: String(update.content || "").slice(0, 180), url: "/" },
  );

  if (emails.length === 0) {
    return res.json({ success: true, message: "No recipients with email found" });
  }

  console.log(`Attempting to send urgent email for: ${update.title} to ${emails.length} recipients`);

  // Via de gedeelde sendEmail-helper (api/email.ts): één SMTP-configuratie
  // en één mock-pad i.p.v. een eigen transporter per route.
  const result = await sendEmail({
    to: emails,
    context: "urgent-update",
    subject: `DRINGENDE UPDATE: ${update.title}`,
    text: `${update.content}\n\nBekijk de volledige update in het VHB Portaal.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #f59e0b; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">DRINGENDE UPDATE</h1>
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #1e293b; margin-top: 0;">${escapeHtml(update.title)}</h2>
          <p style="color: #475569; line-height: 1.6;">${escapeHtml(update.content)}</p>
          <div style="margin-top: 30px; text-align: center;">
            <a href="${process.env.APP_URL || '#'}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Open VHB Portaal</a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 15px; text-align: center; font-size: 12px; color: #94a3b8;">
          Dit is een automatisch bericht van het VHB Portaal.
        </div>
      </div>
    `,
  });

  if (result.mocked) {
    return res.json({ success: true, message: "Email gelogd (geen SMTP geconfigureerd)", mocked: true });
  }
  if (!result.ok) {
    return res.status(500).json({ error: "Fout bij verzenden email" });
  }
  res.json({ success: true, message: "Emails succesvol verzonden" });
});

// --- Ritblaadjes ---

const RITBLAADJE_BUCKET = "ritblaadjes";
// Was 30 dagen: die URL werd ook nog in localStorage bewaard, dus een
// geblokkeerd toestel hield wekenlang toegang tot het bedrijfsritblad. De
// client haalt de URL bij elk bezoek vers op, dus een uur is genoeg.
const RITBLAADJE_URL_TTL_SEC = 60 * 60;

const ritblaadjeRowToPublic = (row: any, publicUrl: string) => ({
  filename: row.filename as string,
  storagePath: row.storage_path as string,
  uploadedAt: row.uploaded_at as string,
  uploadedBy: row.uploaded_by as string | null,
  sizeBytes: row.size_bytes as number | null,
  url: publicUrl,
});

app.get("/api/ritblaadje", authenticate, async (_req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Supabase is niet geconfigureerd." });

    const { data, error } = await db.from("ritblaadje").select("*").eq("id", "current").maybeSingle();
    if (error) throw error;
    if (!data) return res.json(null);

    // Ondertekende URL i.p.v. publieke: de bucket wordt privé gezet zodat het
    // ritblad (interne dienstinfo) niet zonder sessie op te vragen is.
    const { data: signedData, error: signedError } = await db.storage
      .from(RITBLAADJE_BUCKET)
      .createSignedUrl(data.storage_path, RITBLAADJE_URL_TTL_SEC);
    if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("Kon geen ondertekende URL maken.");
    return res.json(ritblaadjeRowToPublic(data, signedData.signedUrl));
  } catch (err: any) {
    console.error("Ritblaadje fetch error:", err);
    console.error("Kon ritblaadje niet ophalen.", err);
    res.status(500).json({ error: "Kon ritblad niet ophalen." });
  }
});

app.post("/api/ritblaadje", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    }

    const filename = String(req.body?.filename || "").trim();
    const dataUrl = String(req.body?.dataUrl || "");
    if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({ error: "Geef een PDF-bestand met een .pdf extensie." });
    }
    const base64Match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
    if (!base64Match) {
      return res.status(400).json({ error: "Bestand is geen geldige PDF (base64 data URL verwacht)." });
    }
    const buffer = Buffer.from(base64Match[1], "base64");
    if (buffer.length === 0) {
      return res.status(400).json({ error: "Bestand is leeg." });
    }

    // Vorige record ophalen zodat we het oude bestand kunnen verwijderen.
    const { data: existing } = await supabaseAdmin
      .from("ritblaadje")
      .select("storage_path")
      .eq("id", "current")
      .maybeSingle();

    // Onvoorspelbaar pad per upload — verhindert dat ex-medewerkers met
    // een oud URL het laatste ritblaadje kunnen blijven opvragen.
    const randomSlug = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const storagePath = `current-${randomSlug}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(RITBLAADJE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    // Oud bestand opruimen (best-effort).
    if (existing?.storage_path && existing.storage_path !== storagePath) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(RITBLAADJE_BUCKET)
        .remove([existing.storage_path]);
      if (removeError) console.warn("Oude ritblaadje-bestand kon niet worden verwijderd:", removeError);
    }

    const row = {
      id: "current",
      filename,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      uploaded_by: req.appUser?.name ?? null,
      size_bytes: buffer.length,
    };
    const { error: upsertError } = await supabaseAdmin.from("ritblaadje").upsert(row);
    if (upsertError) throw upsertError;

    await logActivity(req, "planning", "Ritblaadje vervangen", `${filename} (${Math.round(buffer.length / 1024)} KB) geüpload.`);

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(RITBLAADJE_BUCKET)
      .createSignedUrl(storagePath, RITBLAADJE_URL_TTL_SEC);
    if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("Kon geen ondertekende URL maken.");
    res.json(ritblaadjeRowToPublic(row, signedData.signedUrl));
  } catch (err: any) {
    console.error("Ritblaadje upload error:", err);
    console.error("Kon ritblaadje niet uploaden.", err);
    res.status(500).json({ error: "Kon ritblad niet uploaden." });
  }
});

app.delete("/api/ritblaadje", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    }

    const { data: existing, error: selectError } = await supabaseAdmin.from("ritblaadje").select("*").eq("id", "current").maybeSingle();
    if (selectError) throw selectError;
    if (!existing) return res.json({ success: true });

    const { error: removeError } = await supabaseAdmin.storage
      .from(RITBLAADJE_BUCKET)
      .remove([existing.storage_path]);
    if (removeError) console.warn("Storage remove error:", removeError);

    const { error: deleteError } = await supabaseAdmin.from("ritblaadje").delete().eq("id", "current");
    if (deleteError) throw deleteError;

    await logActivity(req, "planning", "Ritblaadje verwijderd", `${existing.filename} verwijderd.`);

    res.json({ success: true });
  } catch (err: any) {
    console.error("Ritblaadje delete error:", err);
    console.error("Kon ritblaadje niet verwijderen.", err);
    res.status(500).json({ error: "Kon ritblad niet verwijderen." });
  }
});

// --- Documenten per gebruiker (attesten, reglement, loonbrieven) ---
// Zelfde beveiligingspatroon als de ritbladen: privé bucket, ondertekende
// URL's uit de API. Chauffeurs zien alleen hun eigen documenten.
// Kort houden: een signed URL omzeilt authenticate, de toestel-whitelist én
// accountdeactivatie. Met 7 dagen hield een geblokkeerde/vertrokken chauffeur
// nog een week toegang tot zijn loonbrieven zodra de link ergens stond. De
// lijst wordt bij elk bezoek opnieuw ondertekend, dus 15 min volstaat ruim.
const DOCUMENT_URL_TTL_SEC = 15 * 60; // 15 minuten

app.get("/api/documents", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Supabase is niet geconfigureerd." });
    const role = req.appUser?.role;
    // Documentbeheer is admin-only (loonbrieven/attesten = gevoelige PII). Een
    // planner kon eerder via ?userId=<x> andermans documenten opvragen; alleen
    // een admin mag een andere gebruiker uitlezen. Iedereen (incl. planner)
    // krijgt zonder admin altijd de eigen lijst.
    const isStaff = role === "admin";
    const requestedUserId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
    const scopeUserId = isStaff ? requestedUserId : String(req.appUser?.id ?? "");
    // Fail-closed: een lege eigen id mag nooit "geen filter" betekenen —
    // listUserDocuments zonder id geeft ALLE documenten terug (admin-pad).
    if (!isStaff && !scopeUserId) return res.json([]);
    const docs = await listUserDocuments(scopeUserId);
    const withUrls = await Promise.all(
      docs.map(async (d) => {
        try {
          const { data: signed } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUrl(d.storagePath, DOCUMENT_URL_TTL_SEC);
          return { ...d, url: signed?.signedUrl ?? null };
        } catch {
          return { ...d, url: null };
        }
      }),
    );
    res.json(withUrls);
  } catch (err) {
    console.error("Documenten laden mislukt:", err);
    res.status(500).json({ error: "Documenten laden is mislukt." });
  }
});

app.post("/api/documents", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    const userId = String(req.body?.userId || "").trim();
    const filename = String(req.body?.filename || "").trim();
    const category = String(req.body?.category || "").trim() || null;
    const dataUrl = String(req.body?.dataUrl || "");
    if (!userId) return res.status(400).json({ error: "userId is verplicht." });
    const users = await getUsersData();
    const targetUser = users.find((u) => String(u.id) === userId);
    if (!targetUser) return res.status(400).json({ error: "Onbekende gebruiker." });
    if (!filename || !/\.(pdf|png|jpe?g)$/i.test(filename)) {
      return res.status(400).json({ error: "Geef een PDF- of afbeeldingsbestand (.pdf/.png/.jpg)." });
    }
    const base64Match = dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,(.+)$/);
    if (!base64Match) return res.status(400).json({ error: "Bestand is geen geldige data-URL (PDF/PNG/JPG)." });
    const buffer = Buffer.from(base64Match[2], "base64");
    if (buffer.length === 0) return res.status(400).json({ error: "Bestand is leeg." });

    // Onvoorspelbaar pad per upload (zelfde reden als het ritblad): een oud
    // gelekt URL blijft niet werken voor nieuwe bestanden.
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
    const storagePath = `${userId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, buffer, { contentType: base64Match[1], upsert: false });
    if (uploadError) throw uploadError;

    const doc = await insertUserDocument({
      userId,
      filename,
      storagePath,
      category,
      sizeBytes: buffer.length,
      uploadedBy: req.appUser?.name ?? null,
    });
    await logActivity(req, "users", "Document toegevoegd", `${filename} voor ${targetUser.name}${category ? ` (${category})` : ""}.`, { type: "user", id: userId });
    await sendPushToUsers([userId], {
      title: "Nieuw document",
      body: `Er staat een nieuw document voor je klaar: ${filename}.`,
      url: "/",
    });
    res.json({ success: true, document: doc });
  } catch (err) {
    console.error("Document uploaden mislukt:", err);
    res.status(500).json({ error: "Document uploaden is mislukt." });
  }
});

// Eén document naar álle actieve chauffeurs (bv. nieuw reglement). Elke
// chauffeur krijgt een eigen kopie (eigen storage-pad + rij) zodat de
// wees-opruiming bij verwijderen per gebruiker klopt. Push naar allemaal.
app.post("/api/documents/broadcast", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    const filename = String(req.body?.filename || "").trim();
    const category = String(req.body?.category || "").trim() || null;
    const dataUrl = String(req.body?.dataUrl || "");
    if (!filename || !/\.(pdf|png|jpe?g)$/i.test(filename)) {
      return res.status(400).json({ error: "Geef een PDF- of afbeeldingsbestand (.pdf/.png/.jpg)." });
    }
    const base64Match = dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,(.+)$/);
    if (!base64Match) return res.status(400).json({ error: "Bestand is geen geldige data-URL (PDF/PNG/JPG)." });
    const buffer = Buffer.from(base64Match[2], "base64");
    if (buffer.length === 0) return res.status(400).json({ error: "Bestand is leeg." });

    const chauffeurs = (await getUsersData()).filter((u) => u.role === "chauffeur" && u.isActive !== false);
    if (chauffeurs.length === 0) return res.status(400).json({ error: "Geen actieve chauffeurs gevonden." });

    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
    let done = 0;
    for (const u of chauffeurs) {
      const storagePath = `${u.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, buffer, { contentType: base64Match[1], upsert: false });
      if (uploadError) { console.error(`[broadcast] upload voor ${u.id} mislukt:`, uploadError.message); continue; }
      await insertUserDocument({ userId: String(u.id), filename, storagePath, category, sizeBytes: buffer.length, uploadedBy: req.appUser?.name ?? null });
      done++;
    }

    await logActivity(req, "users", "Document rondgestuurd", `${filename}${category ? ` (${category})` : ""} naar ${done} chauffeur(s).`);
    await sendPushToUsers(chauffeurs.map((u) => String(u.id)), {
      title: "Nieuw document",
      body: `Er staat een nieuw document voor je klaar: ${filename}.`,
      url: "/",
    });
    res.json({ success: true, count: done });
  } catch (err) {
    console.error("Document rondsturen mislukt:", err);
    res.status(500).json({ error: "Document rondsturen is mislukt." });
  }
});

// Leesbevestiging: de chauffeur meldt dat hij dit document opende. Alleen op
// eigen documenten (de user_id-match zit in de update zelf) en alleen de
// eerste keer telt; best-effort, mag het openen nooit blokkeren.
app.post("/api/documents/:id/opened", authenticate, async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ error: "Document-id ontbreekt." });
  await markUserDocumentOpened(id, String(req.appUser?.id ?? ""));
  res.status(204).end();
});

app.delete("/api/documents/:id", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    const doc = await getUserDocument(String(req.params.id));
    if (!doc) return res.status(404).json({ error: "Document niet gevonden." });
    const { error: removeError } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([doc.storagePath]);
    if (removeError) console.warn("Document-bestand kon niet worden verwijderd:", removeError);
    await deleteUserDocument(doc.id);
    await logActivity(req, "users", "Document verwijderd", `${doc.filename}.`, { type: "user", id: doc.userId });
    res.json({ success: true });
  } catch (err) {
    console.error("Document verwijderen mislukt:", err);
    res.status(500).json({ error: "Document verwijderen is mislukt." });
  }
});

app.all("/api/*", (req, res) => {
  console.log(`API Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found on server` });
});

// Global error handler — details/stack alleen in de server-logs, nooit
// naar de client (info-disclosure).
app.use((err: any, req: any, res: any, next: any) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ error: "Er ging iets mis op de server." });
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const startVite = async () => {
    const { createServer: createViteServer } = await import("vite");
    console.log("Starting with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      optimizeDeps: {
        include: ['react', 'react-dom']
      }
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  };
  startVite();
} else {
  // Production mode
  console.log("Starting in production mode...");
  const distPath = path.join(process.cwd(), "dist");
  
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.warn("Dist folder not found. Static serving disabled.");
    app.get("*", (req, res) => {
      res.status(404).send("Production build not found. Please run 'npm run build'.");
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

export default app;
