import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import dotenv from "dotenv";

import { buildCalendar, type IcsEvent } from "./ics.js";
import { TABLE_PROBES } from "./schemaProbes.js";
import { computeDayGap, resolveDayType, parseOverrides, encodeOverride, DEFAULT_DAY_TYPES, DEFAULT_WEEKDAYS, type DayTypeOverride, type DayGap } from "./coverageGaps.js";

// Gereserveerde sleutels in coverage_expectations om de weekdag-toewijzing en
// de uitzonderingen op te slaan — zo is er geen aparte tabel/migratie nodig.
// Ze worden nooit als echt dag-type getoond.
const COVERAGE_WEEKDAYS_KEY = "__weekdagen__";
const COVERAGE_OVERRIDES_KEY = "__uitzonderingen__";
// Behandel élke __...__ sleutel als gereserveerd: zo vervuilen ook oudere
// interne sleutels (bv. een vroegere __vakantieperiodes__) de dag-type-lijst niet.
const isReservedCoverageKey = (k: string) => /^__.+__$/.test(k);

import { sendLeaveDecisionEmail, sendEmail, type LeaveDecisionAction } from "./email.js";
import { getVapidPublicKey, savePushSubscription, deletePushSubscriptionForUser, sendPushToUsers } from "./push.js";
import type { AppUser, AuthenticatedRequest } from "./types.js";
import { db, supabase, supabaseAdmin } from "./db.js";
import { authenticate, requireRole } from "./middleware.js";
import { rateLimitMiddleware } from "./rateLimit.js";
import { mountOcpiRoutes, getOcpiRegistration } from "./ocpi.js";
import { invalidateUsersCache } from "./userCache.js";
import { normalizeEmail, parsePlanningMatrixXlsx, toRoleScopedUser, toLookupToken } from "./helpers.js";
import {
  buildPlanningFromMatrix,
  getActivityLog,
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
  getUsersData,
  logActivity,
  logClientError,
  getClientErrors,
  getClientErrorsSince,
  storeBackup,
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
  savePlanningMatrixRows,
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
} from "./storage.js";

dotenv.config();

console.log("Server starting in environment:", process.env.NODE_ENV);
console.log("Supabase URL present:", !!process.env.SUPABASE_URL);
console.log("Supabase Key present:", !!process.env.SUPABASE_ANON_KEY);
console.log("Supabase Service Role present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
const PORT = 3000;

// CORS beperkt tot de eigen origins (prod, Vercel-previews van dit project,
// lokale dev) i.p.v. wildcard. De app draait same-origin, dus browsers hebben
// dit zelden nodig — maar wildcard liet elke website met een gestolen token
// cross-origin lezen. exposedHeaders: laat clients de custom response-headers
// lezen (revisie-check + 429-Retry-After).
const ALLOWED_ORIGINS: Array<string | RegExp> = [
  "https://vhb-five.vercel.app",
  /^https:\/\/vhb-[a-z0-9-]+-jarnodegreve-uis-projects\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
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
    env: process.env.NODE_ENV,
    time: new Date().toISOString(),
  });
});

// Schema-drift-detectie: migraties draait Jarno handmatig in de SQL Editor —
// deze route verifieert ná een deploy dat elke kolom/RPC waar de code op
// rekent ook écht bestaat (de sessie brak hier al 2× bijna op). Per tabel een
// select met expliciete kolomnamen (PostgREST valideert die), per RPC een
// probe-call. Toegang: admin-token of CRON_SECRET (voor een post-deploy curl).
app.get("/api/health/schema", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const viaCronSecret = !!secret && req.headers.authorization === `Bearer ${secret}`;
  if (!viaCronSecret) {
    // Geen cron-secret → normale admin-auth vereisen.
    return authenticate(req as AuthenticatedRequest, res, () => {
      const role = (req as AuthenticatedRequest).appUser?.role;
      if (role !== "admin") return res.status(403).json({ error: "Alleen voor admins." });
      void runSchemaCheck(res);
    });
  }
  void runSchemaCheck(res);
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

app.post("/api/auth/session", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const action = req.body?.action;
    const currentUser = req.appUser;

    if (!currentUser || (action !== "start" && action !== "end")) {
      return res.status(400).json({ error: "Ongeldige sessieactie." });
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
      // + basis voor het per-dag-actieve-gebruikers-overzicht.
      await logActivity(req, "auth", "Aangemeld", `${currentUser.name} meldde zich aan.`, { type: "user", id: String(currentUser.id) });
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
const CAL_SECRET =
  process.env.CALENDAR_FEED_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  null;

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
    const [shifts, users] = await Promise.all([
      getPlanningData({ driverId: userId }),
      getUsersData(),
    ]);
    const user = users.find((u: any) => String(u.id) === userId);
    // Gedeactiveerde/verwijderde medewerkers verliezen hun feed (de token
    // is stateless en kan niet ingetrokken worden — dit is de check).
    if (!user || user.isActive === false) {
      return res.status(404).send("Not found");
    }
    const events: IcsEvent[] = (shifts as any[]).map((s) => ({
      uid: `vhb-shift-${s.id}@vhb-portaal`,
      date: String(s.date),
      startTime: String(s.startTime || "00:00"),
      endTime: String(s.endTime || "00:00"),
      summary: `Dienst ${String(s.line || s.serviceNumber || "").trim()}`.trim(),
      description: [s.busNumber && `Bus ${s.busNumber}`, s.loopnr && `Loop ${s.loopnr}`]
        .filter(Boolean)
        .join(" · ") || undefined,
    }));
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

    const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
    const [users, leave] = await Promise.all([getUsersData(), getLeaveData()]);
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
          lines[id] = lines[id] ? `${lines[id]}/${line}` : line;
        }
      }
      const onLeave = new Set<string>();
      for (const l of approvedLeave) {
        if (String(l.startDate) <= date && date <= String(l.endDate) && chauffeurIds.has(String(l.userId))) {
          onLeave.add(String(l.userId));
        }
      }
      const free = chauffeurs.filter((c) => !working.has(c.id) && !onLeave.has(c.id)).map((c) => c.id);
      return { date, working: Array.from(working), leave: Array.from(onLeave), free, lines };
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
app.get("/api/month-planning", authenticate, async (req, res) => {
  try {
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
    if (!month) return res.status(400).json({ error: "Geef een geldige maand (YYYY-MM)." });

    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const [rows, users, services, codes] = await Promise.all([
      getPlanningMatrixRows(),
      getUsersData(),
      getServicesData(),
      getPlanningCodesData(),
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
    // sorteert achteraan; binnen een sectie alfabetisch op naam.
    const SECTION_ORDER = ["Reguliere", "Nacht", "Flexi", "Schoolvervoer"];
    const sectionRank = (s: string) => {
      const i = SECTION_ORDER.findIndex((x) => x.toLowerCase() === s.trim().toLowerCase());
      return i === -1 ? SECTION_ORDER.length : i;
    };
    const chauffeurs = users
      .filter((u: any) => u.isActive !== false && u.role === "chauffeur" && norm(u.name) !== "beheerder")
      .map((u: any) => ({ id: String(u.id), name: u.name as string, section: String(u.section ?? "").trim() }))
      .sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.name.localeCompare(b.name));
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
    const segmentsOf = (s: any): string[] => [
      s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : "",
      s.startTime2 && s.endTime2 ? `${s.startTime2} - ${s.endTime2}` : "",
      s.startTime3 && s.endTime3 ? `${s.startTime3} - ${s.endTime3}` : "",
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
    const [stored, rows] = await Promise.all([
      getCoverageExpectations(),
      getPlanningMatrixRows(),
    ]);
    // Zelfde weekdag-toewijzing + uitzonderingen als bij het instellen, zodat
    // het dag-type per dag consistent bepaald wordt.
    const weekdaysRaw = Array.isArray(stored[COVERAGE_WEEKDAYS_KEY]) ? stored[COVERAGE_WEEKDAYS_KEY] : null;
    const weekdays = weekdaysRaw && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? "")) : [...DEFAULT_WEEKDAYS];
    const overrides = parseOverrides(stored[COVERAGE_OVERRIDES_KEY]);
    const inRange = rows
      .filter((r: any) => {
        const d = String(r.source_date ?? "");
        return d >= from && d <= to;
      })
      .sort((a: any, b: any) => String(a.source_date).localeCompare(String(b.source_date)));
    const days: DayGap[] = inRange.map((r: any) => {
      const dayType = resolveDayType(r.day_type, String(r.source_date ?? ""), weekdays, overrides);
      const expected = stored[dayType] || [];
      const assignmentValues = r.assignments && typeof r.assignments === "object" && !Array.isArray(r.assignments)
        ? Object.values(r.assignments).map((v) => String(v))
        : [];
      return computeDayGap(String(r.source_date), dayType, expected, assignmentValues);
    });
    res.json({ from, to, days });
  } catch (err) {
    console.error("Error computing coverage gaps:", err);
    res.status(500).json({ error: "Kon dekking niet berekenen." });
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

app.get("/api/activity", authenticate, requireRole("admin"), async (_req, res) => {
  try {
    const activity = await getActivityLog();
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

    // Verlof-conflict-detectie: import overschrijft anders een goedgekeurd
    // verlof met een dienst-toewijzing.
    const [leaveForCheck, usersForCheck] = await Promise.all([getLeaveData(), getUsersData()]);
    const userNameForConflict = (id: string) => usersForCheck.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
    const approvedLeaveForCheck = leaveForCheck.filter((l) => l.status === "approved");
    const verlofConflictsForImport: Array<{ driverId: string; driverName: string; date: string; serviceNumber: string; leaveStart: string; leaveEnd: string }> = [];
    for (const shift of generatedPlanning.shifts) {
      const overlap = approvedLeaveForCheck.find((l) =>
        String(l.userId) === String(shift.driverId) &&
        l.startDate <= shift.date &&
        l.endDate >= shift.date,
      );
      if (overlap) {
        verlofConflictsForImport.push({
          driverId: shift.driverId,
          driverName: userNameForConflict(shift.driverId),
          date: shift.date,
          serviceNumber: shift.line,
          leaveStart: overlap.startDate,
          leaveEnd: overlap.endDate,
        });
      }
    }

    if (
      generatedPlanning.summary.unknownCodes.length > 0 ||
      generatedPlanning.summary.unmatchedDrivers.length > 0 ||
      verlofConflictsForImport.length > 0
    ) {
      return res.status(400).json({
        error: "Import geblokkeerd: er zijn onbekende codes, niet-gematchte chauffeurs of verlof-conflicten. Los deze eerst op en probeer opnieuw.",
        unknownCodes: generatedPlanning.summary.unknownCodes,
        unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
        verlofConflicts: verlofConflictsForImport,
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
      `${rows.length} dagen verwerkt (${rows[0]?.source_date || "?"} t/m ${rows[rows.length - 1]?.source_date || "?"}), ${generatedPlanning.summary.generatedShifts} diensten opgebouwd. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}. Niet-gematchte chauffeurs: ${summarizeTokens(generatedPlanning.summary.unmatchedDrivers)}.`,
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

    // Verlof-conflicten detecteren: een chauffeur staat met goedgekeurd
    // verlof én tegelijk met een dienst in de nieuwe import.
    const [leave, users] = await Promise.all([getLeaveData(), getUsersData()]);
    const userName = (id: string) => users.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
    const approvedLeave = leave.filter((l) => l.status === "approved");
    const verlofConflicts: Array<{
      driverId: string; driverName: string; date: string; serviceNumber: string;
      leaveStart: string; leaveEnd: string;
    }> = [];
    for (const shift of generatedPlanning.shifts) {
      const overlap = approvedLeave.find((l) =>
        String(l.userId) === String(shift.driverId) &&
        l.startDate <= shift.date &&
        l.endDate >= shift.date,
      );
      if (overlap) {
        verlofConflicts.push({
          driverId: shift.driverId,
          driverName: userName(shift.driverId),
          date: shift.date,
          serviceNumber: shift.line,
          leaveStart: overlap.startDate,
          leaveEnd: overlap.endDate,
        });
      }
    }

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
      unknownCodes: generatedPlanning.summary.unknownCodes,
      unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
      servicesWithoutSegments: generatedPlanning.summary.servicesWithoutSegments,
      perDriver: generatedPlanning.summary.perDriver,
    });
  } catch (err: any) {
    console.error("Import-voorbeeld maken is mislukt.", err);
    res.status(500).json({ error: "Import-voorbeeld maken is mislukt." });
  }
});

app.post("/api/planning/sync-from-matrix", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const generatedPlanning = await buildPlanningFromMatrix();
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
      `${generatedPlanning.summary.generatedShifts} diensten opgebouwd vanuit de actuele matrix. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}.`,
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
      await saveUsersData(newData);
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
      }

      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUsersData()));
      res.json({ success: true, count: newData.length });
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

// --- Client-foutmonitoring ---
// Bewust zónder authenticate: fouten op het loginscherm of bij een verlopen
// sessie moeten ook binnenkomen. De client dedupet en plafonneert zelf
// (max 20/sessie); hier kappen we payloads af zodat misbruik niets oplevert.
app.post("/api/client-errors", async (req, res) => {
  try {
    const b = req.body ?? {};
    const cut = (v: unknown, max: number) => String(v ?? "").slice(0, max);
    const entry = {
      message: cut(b.message, 1000),
      stack: cut(b.stack, 4000),
      source: cut(b.source, 50),
      url: cut(b.url, 300),
      userAgent: cut(b.userAgent, 300),
      userId: cut(b.userId, 100),
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
    getActivityLog(),
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
    // te gebruiken bij disaster-recovery).
    authUsers,
    ocpiRegistration,
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
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Niet toegestaan." });
  }
  try {
    const payload = await buildBackupPayload();
    const filename = `vhb-backup-${payload.exportedAt.slice(0, 10)}.json`;
    const json = JSON.stringify(payload);
    const stored = await storeBackup(filename, json);
    console.log(`[cron-backup] ${filename} opgeslagen, ${stored.removedOld} oude back-up(s) opgeruimd.`);

    // Wekelijkse off-site kopie (zondag): de bucket-back-ups wonen in
    // hetzélfde Supabase-project — bij projectverlies zijn ze mee weg. Een
    // mail-bijlage naar ALERT_EMAIL/admins is de goedkoopste externe kopie.
    let mailedOffsite = false;
    if (new Date().getUTCDay() === 0) {
      const explicit = (process.env.ALERT_EMAIL || "").split(",").map((e) => e.trim()).filter(Boolean);
      const recipients = explicit.length > 0
        ? explicit
        : (await getUsersData()).filter((u) => u.role === "admin" && u.isActive !== false && u.email).map((u) => u.email as string);
      if (recipients.length > 0) {
        const result = await sendEmail({
          to: recipients,
          context: "weekly-backup",
          subject: `VHB Portaal — wekelijkse back-up ${payload.exportedAt.slice(0, 10)}`,
          text: "In bijlage de wekelijkse off-site kopie van de portaal-back-up. Bewaar deze mail (of de bijlage) buiten Supabase/Vercel.",
          html: "<p>In bijlage de wekelijkse off-site kopie van de portaal-back-up. Bewaar deze mail (of de bijlage) buiten Supabase/Vercel.</p>",
          attachments: [{ filename, content: json }],
        });
        mailedOffsite = result.ok && !result.mocked;
      }
    }

    await logCronHeartbeat("backup", `${filename} opgeslagen (${stored.removedOld} oude opgeruimd${mailedOffsite ? ", off-site kopie gemaild" : ""}).`);
    res.json({ success: true, filename, removedOld: stored.removedOld, mailedOffsite });
  } catch (err: any) {
    console.error("[cron-backup] mislukt:", err?.message || err);
    console.error("Back-up mislukt", err);
    res.status(500).json({ error: "Back-up mislukt" });
  }
});

// Foutmelding-digest: periodiek (Vercel-cron) de client-fouten van het
// afgelopen interval samenvatten en mailen, zodat een storing/foutenpiek niet
// onopgemerkt blijft tot een chauffeur klaagt. DB-gebaseerd (geen per-instance
// telprobleem). Stuurt naar ALERT_EMAIL als die env-var bestaat, anders naar
// alle admin-accounts. Stuurt niets als er geen fouten zijn.
app.get("/api/cron/error-digest", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
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
      : 1;
    const sinceMs = Date.now() - intervalMin * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    const errors = await getClientErrorsSince(sinceIso);
    if (errors.length < minCount) {
      await logCronHeartbeat("error-digest", `Geen foutenpiek (${errors.length} fouten in ${intervalMin} min).`);
      return res.json({ success: true, count: errors.length, alerted: false });
    }

    // Bepaal de ontvangers.
    const explicit = (process.env.ALERT_EMAIL || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const recipients = explicit.length > 0
      ? explicit
      : (await getUsersData())
          .filter((u) => u.role === "admin" && u.isActive !== false && u.email)
          .map((u) => u.email as string);
    if (recipients.length === 0) {
      return res.json({ success: true, count: errors.length, alerted: false, reason: "geen ontvangers" });
    }

    // Groepeer op bron + bericht.
    const groups = new Map<string, { source: string; message: string; count: number; lastUrl?: string }>();
    for (const e of errors) {
      const key = `${e.source || "?"}::${e.message}`;
      const g = groups.get(key) ?? { source: e.source || "onbekend", message: e.message, count: 0, lastUrl: e.url };
      g.count += 1;
      groups.set(key, g);
    }
    const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
    const topLines = sorted.slice(0, 15)
      .map((g) => `• [${g.count}×] ${g.source}: ${g.message}${g.lastUrl ? ` (${g.lastUrl})` : ""}`)
      .join("\n");
    const moreLine = sorted.length > 15 ? `\n…en nog ${sorted.length - 15} andere foutsoorten.` : "";

    const windowLabel = intervalMin % 60 === 0 ? `${intervalMin / 60} uur` : `${intervalMin} min`;
    const subject = `⚠️ VHB Portaal: ${errors.length} fout${errors.length === 1 ? "" : "en"} in de afgelopen ${windowLabel}`;
    const text = `In de afgelopen ${windowLabel} zijn er ${errors.length} client-fouten gemeld (${sorted.length} unieke soorten).\n\n${topLines}${moreLine}\n\nBekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.`;
    const html = `<p>In de afgelopen <strong>${windowLabel}</strong> zijn er <strong>${errors.length}</strong> client-fouten gemeld (${sorted.length} unieke soorten).</p><ul>${sorted.slice(0, 15).map((g) => `<li><strong>${g.count}×</strong> [${g.source}] ${g.message}${g.lastUrl ? ` <em>(${g.lastUrl})</em>` : ""}</li>`).join("")}</ul>${sorted.length > 15 ? `<p>…en nog ${sorted.length - 15} andere foutsoorten.</p>` : ""}<p>Bekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.</p>`;

    const result = await sendEmail({ to: recipients, subject, text, html, context: "error-digest" });
    console.log(`[error-digest] ${errors.length} fouten, mail naar ${recipients.length} ontvanger(s), mocked=${result.mocked}`);
    await logCronHeartbeat("error-digest", `${errors.length} fouten gemeld aan ${recipients.length} ontvanger(s).`);
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

app.get("/api/diversions", authenticate, async (req, res) => {
  try {
    const data = await getDiversionsData();
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
    res.json(data);
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
      const fmtDiv = (d: any) => `${d.title} (lijn ${d.line}, ${d.severity}) — ${d.startDate}${d.endDate ? ` t/m ${d.endDate}` : ''}.`;
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

    const { data: publicData } = supabaseAdmin.storage.from(DIVERSIONS_BUCKET).getPublicUrl(storagePath);
    res.json({ publicUrl: publicData.publicUrl, storagePath, filename, sizeBytes: buffer.length });
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
    const fmtUpd = (u: any) => `${u.title} [${u.category}${u.isUrgent ? ', URGENT' : ''}].`;
    for (const u of updDiff.added) {
      await logActivity(req, "updates", "Update toegevoegd", fmtUpd(u), { type: "update", id: u.id });
    }
    for (const u of updDiff.changed) {
      await logActivity(req, "updates", "Update gewijzigd", fmtUpd(u), { type: "update", id: u.id });
    }
    for (const u of updDiff.removed) {
      await logActivity(req, "updates", "Update verwijderd", fmtUpd(u), { type: "update", id: u.id });
    }

    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Updates opslaan is mislukt.", err);
    res.status(500).json({ error: "Updates opslaan is mislukt." });
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
    // Eén open/goedgekeurde ruil per dienst — voorkomt dat twee gelijktijdige
    // verzoeken voor dezelfde shift allebei blijven lopen of goedgekeurd raken.
    const OPEN_SWAP_STATES = new Set(["pending", "accepted", "approved"]);
    // Wat er werkelijk weggeschreven wordt. Planner/admin schrijven de hele
    // payload (vertrouwde rol); voor een chauffeur bouwen we de set op uit
    // enkel de records die hij/zij legitiem toevoegt of beantwoordt — zo
    // overschrijft een echo van ongewijzigde records nooit een gelijktijdige
    // wijziging van een ander (geen vals 403, geen clobber).
    let recordsToWrite: any[] = newData;

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

      // Toevoegingen + wijzigingen
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
          if (!next.returnCode || String(next.returnCode).trim() === "" || !next.returnDate || String(next.returnDate).trim() === "") {
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
          const allUsersForCheck = await getUsersData();
          const targetUser = allUsersForCheck.find((u: any) => String(u.id) === String(next.targetDriverId));
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
            writes.push(next);
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

    if (req.appUser?.role !== "chauffeur") {
      for (const [id] of previousById) {
        if (!newById.has(String(id))) swapIdsToDelete.push(String(id));
      }
    }

    // Exclusiviteit bij goedkeuren: een dienst kan niet via twee ruilen
    // tegelijk goedgekeurd raken. Blokkeer een approve-overgang als er al een
    // ándere goedgekeurde ruil voor dezelfde shift bestaat.
    for (const next of newData) {
      const prev = previousById.get(String(next.id));
      const becomesApproved = next.status === "approved" && (!prev || prev.status !== "approved");
      if (becomesApproved && previousSwaps.some((s) => String(s.id) !== String(next.id) && String(s.shiftId) === String(next.shiftId) && String(s.status) === "approved")) {
        return res.status(409).json({ error: "Voor deze dienst is al een andere ruil goedgekeurd." });
      }
    }

    await saveSwapsData(recordsToWrite, swapIdsToDelete);

    // Activity log: detecteer state-overgangen en nieuwe aanvragen.
    const usersForLog = await getUsersData();
    const userName = (id: string) => usersForLog.find((u) => String(u.id) === String(id))?.name || `Onbekende gebruiker (${id})`;
    for (const next of newData) {
      const prev = previousById.get(String(next.id));
      if (!prev) {
        await logActivity(req, "swaps", "Dienstruil aangevraagd", `${userName(next.requesterId)} bood een dienst aan voor ruil.`, { type: "swap", id: next.id });
        // De aangezochte collega krijgt direct een seintje.
        if (next.targetDriverId) {
          await sendPushToUsers([String(next.targetDriverId)], {
            title: "Nieuwe dienstruil-aanvraag",
            body: `${userName(next.requesterId)} wil een dienst met je ruilen.`,
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
          await logActivity(req, "swaps", action, `${userName(next.requesterId)} — dienstruil (${prev.status} → ${next.status}).`, { type: "swap", id: next.id });
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
        }
      }
    }

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
    const ifStatus = req.body?.ifStatus ? String(req.body.ifStatus) : null;

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
      // of weigeren — zelfde regels als de array-route.
      const isTarget = String(current.targetDriverId ?? "") === selfId && String(current.requesterId) !== selfId;
      const validTransition = current.status === "pending" && (status === "accepted" || status === "rejected");
      if (!isTarget || !validTransition) {
        return res.status(403).json({ error: "Niet toegestaan: je mag een aan jou gerichte, openstaande ruil alleen accepteren of weigeren." });
      }
    } else {
      const allowed = ["accepted", "approved", "rejected", "cancelled", "completed"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: "Ongeldige status." });
      }
      // Force-approve vanuit pending blijft admin-only (zelfde beleid als POST).
      if (role !== "admin" && current.status === "pending" && status === "approved") {
        return res.status(403).json({ error: "Niet toegestaan: een ruil zonder bevestiging van de collega kan alleen een admin rechtstreeks goedkeuren." });
      }
    }

    // Exclusiviteit: een dienst kan niet via twee ruilen tegelijk goedgekeurd
    // raken (zie ook POST /api/swaps).
    if (status === "approved" && current.status !== "approved" &&
        all.some((s) => String(s.id) !== id && String(s.shiftId) === String(current.shiftId) && String(s.status) === "approved")) {
      return res.status(409).json({ error: "Voor deze dienst is al een andere ruil goedgekeurd." });
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
    await logActivity(req, "swaps", action, `${userName(String(current.requesterId))} — dienstruil (${current.status} → ${status}).`, { type: "swap", id });

    const betrokkenen = [String(current.requesterId), String(current.targetDriverId ?? "")]
      .filter((uid) => uid && uid !== selfId);
    await sendPushToUsers(betrokkenen, {
      title: action,
      body: status === "accepted"
        ? `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil — wacht op goedkeuring van de planner.`
        : `Dienstruil van ${userName(String(current.requesterId))}: ${current.status} → ${status}.`,
      url: "/",
    });

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
    };
    const formatLeaveType = (t: string) => leaveTypeLabels[t] ?? t;

    // Server-side autorisatie: chauffeurs kunnen alleen eigen pending-aanvragen
    // toevoegen of intrekken. Status-overgangen en bewerken van anderen vereist
    // planner/admin.
    const payloadLeaveIds = new Set(newData.map((r: any) => String(r.id)));
    const leaveIdsToDelete: string[] = [];

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
          if (prev.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen je eigen openstaande verlofaanvraag intrekken." });
          }
          leaveIdsToDelete.push(String(id));
        }
      }

      for (const next of newData) {
        const prev = previousById.get(String(next.id));
        if (!prev) {
          if (String(next.userId) !== selfId) {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen voor jezelf verlof aanvragen." });
          }
          if (next.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: nieuwe verlofaanvragen starten als 'pending'." });
          }
          if (next.decidedAt) {
            return res.status(403).json({ error: "Niet toegestaan: nieuwe aanvraag mag geen beslismoment hebben." });
          }
        } else {
          const fields = ["userId", "startDate", "endDate", "type", "status", "comment", "createdAt", "decidedAt"] as const;
          for (const f of fields) {
            if (String((next as any)[f] ?? "") !== String((prev as any)[f] ?? "")) {
              return res.status(403).json({ error: "Niet toegestaan: bestaande verlofaanvragen kunnen alleen door planner/admin worden aangepast." });
            }
          }
        }
      }
    }

    // Planner/admin: alles wat uit de (volledige) payload is weggelaten is
    // een bewuste verwijdering door een vertrouwde rol.
    if (req.appUser?.role !== "chauffeur") {
      for (const [id] of previousById) {
        if (!payloadLeaveIds.has(String(id))) leaveIdsToDelete.push(String(id));
      }
    }

    await saveLeaveData(newData, leaveIdsToDelete);

    if (leaveIdsToDelete.length > 0) {
      await logActivity(
        req,
        "leave",
        "Verlof ingetrokken",
        `${leaveIdsToDelete.length} verlofaanvra${leaveIdsToDelete.length === 1 ? "ag" : "gen"} ingetrokken/verwijderd.`,
      );
    }

    for (const next of newData) {
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
    const ifStatus = req.body?.ifStatus ? String(req.body.ifStatus) : null;
    const allowed = ["approved", "rejected", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Ongeldige status." });
    }

    const all = await getLeaveData();
    const current = all.find((l) => String(l.id) === id);
    if (!current) {
      return res.status(404).json({ error: "Deze verlofaanvraag bestaat niet (meer) — mogelijk net ingetrokken." });
    }
    if (ifStatus && String(current.status) !== ifStatus) {
      return res.status(409).json({
        error: `Deze aanvraag is intussen al '${current.status}' — de lijst is ververst.`,
        currentStatus: current.status,
      });
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
  const { update, recipients } = req.body;
  
  if (!update || !recipients || !Array.isArray(recipients)) {
    return res.status(400).json({ error: "Missing update or recipients" });
  }

  const emails = recipients.map((u: any) => u.email).filter(Boolean);

  // Push naar álle ontvangers (ook wie geen e-mail heeft) — best-effort.
  await sendPushToUsers(
    recipients.map((u: any) => String(u?.id ?? "")).filter(Boolean),
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

    const { data: publicData } = db.storage.from(RITBLAADJE_BUCKET).getPublicUrl(data.storage_path);
    return res.json(ritblaadjeRowToPublic(data, publicData.publicUrl));
  } catch (err: any) {
    console.error("Ritblaadje fetch error:", err);
    console.error("Kon ritblaadje niet ophalen.", err);
    res.status(500).json({ error: "Kon ritblaadje niet ophalen." });
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

    const { data: publicData } = supabaseAdmin.storage.from(RITBLAADJE_BUCKET).getPublicUrl(storagePath);
    res.json(ritblaadjeRowToPublic(row, publicData.publicUrl));
  } catch (err: any) {
    console.error("Ritblaadje upload error:", err);
    console.error("Kon ritblaadje niet uploaden.", err);
    res.status(500).json({ error: "Kon ritblaadje niet uploaden." });
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
    res.status(500).json({ error: "Kon ritblaadje niet verwijderen." });
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
