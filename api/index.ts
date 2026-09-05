import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";

import { buildCalendar, type IcsEvent } from "./ics.js";
import { TABLE_PROBES } from "./schemaProbes.js";

import { sendLeaveDecisionEmail, sendEmail, sendExpiryReminderEmail, isSmtpConfigured, escapeHtml, type LeaveDecisionAction } from "./email.js";
import { getVapidPublicKey, savePushSubscription, deletePushSubscriptionForUser, sendPushToUsers, getUsersMetPush } from "./push.js";
import type { AppUser, AuthenticatedRequest, IncomingUser } from "./types.js";
import { db, supabase, supabaseAdmin } from "./db.js";
import { authenticate, requireRole, isCronAuthorized, resolveOptionalUser, isRosteringExportAuthorized } from "./middleware.js";
import { isMissingTableError } from "./deviceGate.js";
import { encryptOpensslCompatible } from "./backupCrypto.js";
import { symbolicateTopFrame } from "./symbolicate.js";
import { rateLimitMiddleware, clientErrorRateLimit, urgentEmailRateLimit, createActionRateLimit } from "./rateLimit.js";
// Type-only import: de SDK zelf wordt pas geladen als de assistent echt wordt
// aangeroepen (dynamic import in de handler) — scheelt cold-start en houdt de
// tests onafhankelijk van een API-sleutel.
import type AnthropicClient from "@anthropic-ai/sdk";
import { mountOcpiRoutes, getOcpiRegistration, isSafeExternalHttpsUrl } from "./ocpi.js";
import { mountDeviceRoutes } from "./deviceRoutes.js";
import { mountTelegramRoutes, stuurTelegram, telegramGeconfigureerd, formatGaten, formatVandaag, formatZiek, DAG_KORT, meldVerlofAanvraagTelegram, meldRuilTerValidatieTelegram } from "./telegram.js";
import { mountCoverageRoutes, berekenDekkingsGaten, berekenVerwachtingsCheck, berekenCoverageAdvies } from "./coverageRoutes.js";
import { invalidateUsersCache } from "./userCache.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { userBodySchema, userLijstSchema, WACHTWOORD_MIN } from "../shared/schemas/user.js";
import { diversionBodySchema, diversionLijstSchema } from "../shared/schemas/diversion.js";
import { updateBodySchema, updateLijstSchema } from "../shared/schemas/update.js";
import { valideerLijst, valideerRecord } from "./_lib/valideer.js";
import {
  RECORD_REVISION_HEADER,
  recordRevisionOf,
  userRecordRevisionOf,
  withRecordRevision,
  requestedRecordRevision,
  verwerkUsersOpslag,
  verwerkDiversionsOpslag,
  verwerkUpdatesOpslag,
} from "./_lib/recordWrites.js";
import { addDagenIso, brusselsDay, normalizeEmail, parsePlanningMatrixXlsxMetWaarschuwingen, toRoleScopedUser, sanitizeIncomingUser, countAdmins, toLookupToken, sortedNameToken, nameIdIndex, afwezigOp, matrixCodesForDate, isTakeoverCode, bouwMatrixXlsx, bouwMaandoverzichtAoa, berekenMaandoverzicht, vindOngeregistreerdeZiekte, isDigestRuis, isHandmatigeWissel, HANDMATIGE_WISSEL_PREFIX, normalizeSwapType, TAKEOVER_CODES, LEAVE_TYPE_LABEL, EXPIRY_SOORT_LABEL, isActieveStaf } from "./helpers.js";
import {
  applySwapsToPlanningRows,
  swapRaaktBereik,
  applySwapToPlanning,
  revertSwapFromPlanning,
  swapToestandInPlanning,
  buildPlanningFromMatrix,
  getActivityLog,
  getLatestAuthEventAt,
  getLoginActivity,
  getCoverageExpectations,
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
  insertUserDocument,
  deleteUserDocument,
  DOCUMENTS_BUCKET,
  restoreFromBackup,
  replacePlanningData,
  replacePlanningAndMatrix,
  saveLeaveData,
  savePlanningCodesData,
  savePlanningData,
  clearPlanningData,
  updateUserSessionMeta,
  bumpActiveSessions,
  getShiftById,
  getShiftsOnDate,
  markSwapTargetSeen,
  getServiceSegments,
  saveMatrixRowAssignments,
  insertPlanningRows,
  savePlanningMatrixHistoryEntry,
  saveServicesData,
  saveSwapsData,
  DIVERSIONS_BUCKET,
  summarizePlanningCodeChanges,
  diffPlanningCodeChanges,
  summarizeServiceChanges,
  diffServiceChanges,
  summarizeTokens,
  isMissingDbFunction,
  logCronHeartbeat,
  getCronHeartbeats,
  getDevice,
  getPlanningNotes,
  upsertPlanningNote,
  getUserExpiries,
  saveUserExpiry,
  deleteUserExpiry,
  deletePlanningNote,
  getLatestBackup,
  storeImportSnapshot,
  getImportSnapshot,
  restorePlanningAndMatrixSnapshot,
} from "./storage.js";

dotenv.config();

// Env-dump alleen buiten productie: op serverless herhaalt dit zich bij elke
// koude start en verdunt het de echte fouten in de logs.
if (process.env.NODE_ENV !== "production") {
  console.log("Server starting in environment:", process.env.NODE_ENV);
  console.log("Supabase URL present:", !!process.env.SUPABASE_URL);
  console.log("Supabase Key present:", !!process.env.SUPABASE_ANON_KEY);
  console.log("Supabase Service Role present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
}
// Zonder eigen secret is de agenda-feed uit (fail-closed, zie CAL_SECRET).
// Luid loggen: dit viel vroeger niet op omdat hij stil terugviel op de
// service-role-key en dus altijd "werkte".
if (!process.env.CALENDAR_FEED_SECRET) {
  console.warn("[config] CALENDAR_FEED_SECRET ontbreekt — de agenda-feed is uitgeschakeld. Zet hem in de env om abonneren weer mogelijk te maken.");
}

// Wachtwoordminimum (WACHTWOORD_MIN) komt uit shared/schemas/user.ts — één
// bron voor client én server.

/** Deeplink-URL voor een push-melding: de app opent op die pagina i.p.v. op
 *  het dashboard (controle-ronde 27-08, voorstel 44; zie src/lib/deeplink.ts). */
const viewUrl = (view: string) => `/?view=${view}`;

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

// Request-logging alleen buiten productie — Vercel logt method/pad/status
// zelf al per aanroep, dus in productie was dit louter dubbel geluid.
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// OCPI 2.2.1 (eMSP, read-only monitoring van ChargEye) — eigen token-auth,
// los van de Supabase-auth. Zie api/ocpi.ts.
mountOcpiRoutes(app);

// Toestel-whitelist (registratie + admin-beheer). Zie api/deviceRoutes.ts.
mountDeviceRoutes(app);

// Telegram-bot voor de planner (webhook, commando's, goedkeurknoppen). Zie
// api/telegram.ts. De bereken-functies komen uit coverageRoutes/advisor; de
// vijf *Intern-schrijfkernen zijn function-declaraties verderop in dit
// bestand (gehoist) — doorgeven i.p.v. importeren voorkomt een cyclus
// (telegram.ts wordt hier immers geïmporteerd voor de meld-helpers).
mountTelegramRoutes(app, {
  berekenDekkingsGaten,
  berekenCoverageAdvies,
  beslisVerlof: beslisVerlofIntern,
  beslisRuil: beslisRuilIntern,
  registreerZiekmelding: registreerZiekmeldingIntern,
  wijsDienstToe: wijsDienstToeIntern,
  draaiPlannerChat,
});

// Dekking & advies (expectations, gaten, advisor). Zie api/coverageRoutes.ts.
mountCoverageRoutes(app);

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
    { name: "replace_planning_and_matrix_periode", args: { matrix_rows: null, shifts: null } },
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
    if (!userId || password.length < WACHTWOORD_MIN) {
      return res.status(400).json({ error: `Geef een gebruiker en een wachtwoord van minstens ${WACHTWOORD_MIN} tekens.` });
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

app.get("/api/planning", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    // Optionele filters: ?driverId=X of ?month=YYYY-MM laten de client
    // gericht ophalen i.p.v. de hele tabel — drastisch minder data over
    // het draad voor mobile en maandprint.
    const gevraagdeDriverId = typeof req.query.driverId === "string" && req.query.driverId.trim()
      ? req.query.driverId.trim()
      : undefined;
    // Een chauffeur mag alleen zijn eigen diensten via deze route lezen —
    // zonder deze scope kon hij met een kale fetch de volledige planning
    // (busnr, loopnr, segmenttijden) van álle collega's ophalen. Het open
    // maandbord (/api/month-planning) toont toewijzingen bewust wél breed,
    // maar deze detail-route hoort per-chauffeur begrensd (zoals /api/leave,
    // /api/swaps en /api/planning-notes dat al zijn).
    const driverId = req.appUser?.role === "chauffeur"
      ? String(req.appUser.id)
      : gevraagdeDriverId;
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
    // Diensten binnen een goedgekeurde afwezigheid overslaan: wie ziek
    // gemeld is, hoort geen agenda-melding voor die dienst te krijgen —
    // de hele-dag-gebeurtenis hieronder dekt die dag al.
    const events: IcsEvent[] = (shifts as any[])
      .filter((s) => s.startTime && s.endTime && !afwezigOp(leave as any[], userId, String(s.date)))
      .map((s) => ({
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
    const [rows, users, services, codes, leave, swaps] = await Promise.all([
      getPlanningMatrixRows(),
      getUsersData(),
      getServicesData(),
      getPlanningCodesData(),
      // Alleen afwezigheid die deze maand nog raakt — de volledige historiek
      // groeit onbegrensd en is hier nooit nodig.
      getLeaveData({ endOnOrAfter: `${month}-01` }),
      getSwapsData(),
    ]);

    const monthRows = rows
      .filter((r: any) => String(r.source_date ?? "").startsWith(`${month}-`))
      .sort((a: any, b: any) => String(a.source_date).localeCompare(String(b.source_date)));
    const dates = monthRows.map((r: any) => String(r.source_date));

    // Naam- en code-resolutie identiek aan buildPlanningFromMatrix (toLookupToken
    // strikt: accenten/interpunctie/hoofdletters genormaliseerd). Anders kreeg
    // /month-planning lege of foute cellen voor accent-/omgekeerde namen en
    // toonde een dienst met scheidingsteken als 'onbekend'.
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
    // Volgorde-onafhankelijke index: zowel "Jan Janssen" als "Janssen Jan"
    // matcht; botsende sleutels vallen weg i.p.v. last-wins (zie nameIdIndex).
    const idByNameKey = nameIdIndex(chauffeurs);

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
    const cells: Record<string, Record<string, { code: string; kind: string; label: string; segments: string[]; hiddenService?: string ; swapId?: string; swapManual?: boolean; swapFrom?: string }>> = {};
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

    const chauffeurIds = new Set(chauffeurs.map((c) => c.id));

    // Goedgekeurde dienstruilen doorvoeren in het maandbeeld (bevinding Jarno
    // 06-08): een goedgekeurde ruil verhuist de dienst wél in de planning-
    // tabel, maar de matrix — de bron van dit scherm — bleef de oude eigenaar
    // tonen. We wisselen de cellen van aanvrager en collega op de dienstdag
    // en (bij een 1-op-1 ruil) op de terugruil-dag, in beslisvolgorde zodat
    // kettingen (A→B, daarna B→C) kloppen. Guard tegen dubbel doorvoeren:
    // alleen wisselen als de cel van de gever nog de geruilde dienstcode
    // toont — is de Excel intussen opnieuw geïmporteerd mét de ruil erin
    // verwerkt, dan matcht dat niet meer en blijft alles staan. 'completed'
    // telt mee: ook een voltooide ruil is gereden zoals gewisseld.
    const dateSet = new Set(dates);
    // `merk` reist mee met de verplaatste cel: zo ziet de maandplanning welke
    // cellen afwijken van de geïmporteerde Excel, wie de dienst afstond en —
    // bij een handmatige admin-wissel — met welke swap je hem kan terugdraaien.
    const wisselCel = (
      date: string, vanId: string, naarId: string, verwachtCode: string,
      merk?: { swapId: string; swapManual: boolean; swapFrom: string },
    ) => {
      const vanCel = cells[vanId]?.[date];
      if (!vanCel || toLookupToken(vanCel.code) !== toLookupToken(verwachtCode)) return;
      const naarCel = cells[naarId]?.[date];
      if (!cells[naarId]) cells[naarId] = {};
      cells[naarId][date] = merk ? { ...vanCel, ...merk } : vanCel;
      if (naarCel) cells[vanId][date] = naarCel;
      else delete cells[vanId][date];
    };
    const doorgevoerdeRuilen = (swaps as any[])
      .filter((sw) => sw?.status === "approved" || sw?.status === "completed")
      .sort((a, b) => String(a.decidedAt ?? "").localeCompare(String(b.decidedAt ?? "")));
    const naamVanId = (id: string) => chauffeurs.find((c: any) => String(c.id) === id)?.name ?? "";
    for (const sw of doorgevoerdeRuilen) {
      const van = String(sw.requesterId ?? "");
      const naar = String(sw.targetDriverId ?? "");
      if (!chauffeurIds.has(van) || !chauffeurIds.has(naar)) continue;
      const dienstDag = String(sw.shiftDate ?? "");
      const dienstCode = String(sw.shiftLine ?? "").trim();
      const merk = { swapId: String(sw.id), swapManual: isHandmatigeWissel(sw), swapFrom: naamVanId(van) };
      // Zonder dienst-info (aanvraag van vóór de shift_info-migratie) valt er
      // niets veilig te wisselen.
      if (dienstDag && dienstCode && dateSet.has(dienstDag)) wisselCel(dienstDag, van, naar, dienstCode, merk);
      const terugDag = String(sw.returnDate ?? "");
      const terugCode = String(sw.returnCode ?? "").trim();
      if (normalizeSwapType(sw.swapType) !== "overname" && terugDag && terugCode && terugCode.toLowerCase() !== "vrij" && dateSet.has(terugDag)) {
        wisselCel(terugDag, naar, van, terugCode, { ...merk, swapFrom: naamVanId(naar) });
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
    // Ná de ruil-overlay: ziekte moet ook een geruilde dienst overschrijven.
    const LEAVE_CODE: Record<string, string> = { ziekte: "ziek", betaald_verlof: "bv", klein_verlet: "kv" };
    const LEAVE_FALLBACK: Record<string, { kind: string; label: string }> = {
      ziekte: { kind: "absence", label: "Ziek" },
      betaald_verlof: { kind: "leave", label: "Betaald Verlof" },
      klein_verlet: { kind: "absence", label: "Klein Verlet" },
    };
    // Ziekte als laatste verwerken zodat die bij overlappende records wint —
    // "ziek tijdens verlof" moet als ziek op het rooster, niet als bv.
    const overlayLeave = (leave as any[])
      .filter((l) => l?.status === "approved")
      .sort((a, b) => (String(a.type) === "ziekte" ? 1 : 0) - (String(b.type) === "ziekte" ? 1 : 0));
    for (const l of overlayLeave) {
      const id = String(l.userId ?? "");
      if (!chauffeurIds.has(id)) continue;
      // Onbekend (toekomstig) verloftype: niets tonen. Een fallback naar
      // "ziek" zou een valse gezondheidsstatus publiceren.
      const code = LEAVE_CODE[String(l.type)];
      if (!code) continue;
      // Records met kapotte of omgekeerde datums overslaan: een lege
      // startdatum vergeleek anders als "altijd waar" en overschreef de
      // hele maand.
      const start = String(l.startDate ?? "");
      const eind = String(l.endDate ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(eind) || start > eind) continue;
      // resolve() kent de code alleen als hij in planning_codes staat; zo
      // niet, dan wint het fallback-label (anders las de cel "Onbekende code").
      const r = resolve(code);
      const cel = !r || r.kind === "unknown" ? LEAVE_FALLBACK[String(l.type)] : r;
      for (const date of dates) {
        if (start <= date && date <= eind) {
          if (!cells[id]) cells[id] = {};
          // De dienst die deze afwezigheid overdekt, blijft meegestuurd:
          // ziek melden verwijdert de planning-rij niet, dus de dienst staat
          // nog op naam van deze chauffeur en moet herverdeeld worden. Zonder
          // dit veld was juist het hoofdscenario (ziekte) onbereikbaar in de
          // maandplanning — de cel toonde "ziek" en de dienstwissel-actie
          // hangt aan een dienst-cel.
          const overdekt = cells[id][date];
          cells[id][date] = {
            code, kind: cel.kind, label: cel.label, segments: [],
            ...(overdekt?.kind === "service" ? { hiddenService: overdekt.code } : {}),
          };
        }
      }
    }

    // Excel-terugexport (planner/admin): de ACTUELE cel-waarheid — wissels,
    // toewijzingen en afwezigheids-overlay verwerkt — in het praktijk-tab-
    // formaat, direct her-importeerbaar. Zo start de volgende Excel-bewerking
    // op de werkelijke stand i.p.v. de verouderde upload.
    // Maandoverzicht als data voor het Overzicht-venster in de maandplanning
    // — exact dezelfde telling als het xlsx-tabblad (gedeelde berekening),
    // zodat scherm en export nooit kunnen verschillen. Staf-only: tellingen
    // per collega zijn planner-informatie.
    if (String(req.query.format ?? "") === "summary") {
      if (req.appUser?.role === "chauffeur") {
        return res.status(403).json({ error: "Onvoldoende rechten." });
      }
      const overzicht = berekenMaandoverzicht(dates, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, services as any[], codes as any[]);
      return res.json({ month, dagen: dates.length, ...overzicht });
    }

    if (String(req.query.format ?? "") === "xlsx") {
      if (req.appUser?.role === "chauffeur") {
        return res.status(403).json({ error: "Onvoldoende rechten." });
      }
      const dayTypeByDate = new Map<string, string>(monthRows.map((r: any) => [String(r.source_date), String(r.day_type ?? "")]));
      // Tweede tabblad "maandoverzicht": per-chauffeur maandtelling (diensten,
      // uren, ziekte, verlof, vrij) op dezelfde cel-waarheid — opstap naar de
      // loonadministratie zonder aparte export.
      const overzicht = bouwMaandoverzichtAoa(month, dates, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, services as any[], codes as any[]);
      const buffer = bouwMatrixXlsx(dates, dayTypeByDate, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, overzicht);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="planning-${month}.xlsx"`);
      return res.send(buffer);
    }

    res.json({ month, dates, drivers: chauffeurs.map((c) => ({ id: c.id, name: c.name, section: c.section || null })), cells });
  } catch (err: any) {
    console.error("Error computing month planning:", err);
    res.status(500).json({ error: "Kon maandplanning niet berekenen." });
  }
});


// --- Planner-assistent: chat met Claude als motor (idee 6, 19-08) ---
//
// De harde invalregels blijven in code: het model krijgt alleen leestools die
// de bestaande, deterministische berekeningen aanroepen (gaten, advies,
// dagplanning, verlof) en adviseert alleen — er is bewust géén tool die iets
// wijzigt of verstuurt. Kostenbeheersing: rate limit per gebruiker, begrensde
// invoer, max 6 tool-rondes, en het maandbudget op de sleutel zelf (console).
const plannerChatRateLimit = createActionRateLimit("planner-chat", 60);

/** De assistent-kern (tools + tool-lus + beknoptheidscontract), losgetrokken
 *  van de route zodat óók de Telegram-bot vragen kan stellen. Zelfde model,
 *  zelfde leestools, zelfde grenzen — alleen de transportlaag verschilt. */
async function draaiPlannerChat(
  gesprek: Array<{ role: "user" | "assistant"; content: any }>,
): Promise<{ ok: true; antwoord: string } | { ok: false; status: number; error: string; code?: string }> {
    const apiKey = String(process.env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) {
      return {
        ok: false,
        status: 503,
        error: "De planner-assistent is nog niet geactiveerd — zet een ANTHROPIC_API_KEY in de Vercel-omgeving.",
        code: "assistent_uitgeschakeld",
      };
    }

    const vandaag = brusselsDay(new Date().toISOString());
    const weekdagLang = new Date(`${vandaag}T12:00:00Z`).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" });

    const tools = [
      {
        name: "openstaande_diensten",
        description: "Welke verwachte diensten zijn nog niet ingevuld, per dag — mét wie er eventueel uitviel en waarom. Gebruik dit voor elke vraag over gaten of openstaande diensten. Zonder datums: de komende 14 dagen.",
        input_schema: {
          type: "object",
          properties: {
            vanaf: { type: "string", description: "Begindatum YYYY-MM-DD (standaard vandaag)" },
            tot: { type: "string", description: "Einddatum YYYY-MM-DD (standaard vandaag + 13 dagen)" },
          },
        },
      },
      {
        name: "advies_voor_dienst",
        description: "Het volledige invaladvies voor één openstaande dienst op één dag: de collega-samenvatting, passende kandidaten (met gewerkte dagen deze week en deze maand, en de reeks aaneengesloten werkdagen), wie niet past en waarom, en eventuele ruilopties in één stap. Roep dit altijd aan vóór je iemand aanraadt voor een dienst.",
        input_schema: {
          type: "object",
          properties: {
            datum: { type: "string", description: "YYYY-MM-DD" },
            code: { type: "string", description: "Het dienstnummer, bv. 2603" },
          },
          required: ["datum", "code"],
        },
      },
      {
        name: "dagplanning",
        description: "De planning van één dag: wie rijdt welke dienst (met tijden), wie is goedgekeurd afwezig (verlof/ziekte/klein verlet) en wie is vrij.",
        input_schema: {
          type: "object",
          properties: { datum: { type: "string", description: "YYYY-MM-DD" } },
          required: ["datum"],
        },
      },
      {
        name: "verlof_periode",
        description: "Alle goedgekeurde afwezigheden (verlof, ziekte, klein verlet) die een periode raken. Gebruik dit voor vragen als 'wie is er volgende week op verlof'.",
        input_schema: {
          type: "object",
          properties: {
            vanaf: { type: "string", description: "YYYY-MM-DD" },
            tot: { type: "string", description: "YYYY-MM-DD" },
          },
          required: ["vanaf", "tot"],
        },
      },
    ];

    const isoOf = (v: unknown, fallback: string) => (typeof v === "string" && ISO_DAY_RE.test(v) ? v : fallback);
    const voerToolUit = async (naam: string, input: any): Promise<string> => {
      if (naam === "openstaande_diensten") {
        const vanaf = isoOf(input?.vanaf, vandaag);
        const tot = isoOf(input?.tot, addDagenIso(vandaag, 13));
        if (vanaf > tot) return JSON.stringify({ fout: "vanaf ligt na tot" });
        const dagen = await berekenDekkingsGaten(vanaf, tot);
        return JSON.stringify({
          vanaf,
          tot,
          open: dagen.filter((d) => d.missing.length > 0).map((d) => ({ datum: d.date, diensten: d.missing, uitval: d.uitval ?? undefined })),
        });
      }
      if (naam === "advies_voor_dienst") {
        const datum = isoOf(input?.datum, "");
        const code = String(input?.code ?? "").trim();
        if (!datum || !code) return JSON.stringify({ fout: "datum (YYYY-MM-DD) en code zijn verplicht" });
        const advies = await berekenCoverageAdvies(datum, code);
        // Compact doorgeven — alleen wat het model nodig heeft om te adviseren.
        return JSON.stringify({
          samenvatting: advies.samenvatting,
          tijden: advies.segmenten,
          tijdenOnbekend: advies.tijdenOnbekend,
          // Volgorde = de sortering van de advisor (minst gewerkt deze week
          // eerst); de teller-namen zeggen het model wat de cijfers betekenen.
          passend: advies.kandidaten.filter((k) => k.past).map((k) => ({ naam: k.name, dagenDezeWeek: k.dagenDezeWeek, reeksWerkdagen: k.dagenNaElkaar, dagenDezeMaand: k.dagenDezeMaand })),
          pastNiet: advies.kandidaten.filter((k) => !k.past).map((k) => ({ naam: k.name, redenen: k.redenen })),
          ruilOpties: advies.kettingen.map((k) => ({ wieRijdtHetGat: k.vanNaam, staatAf: k.viaCode, tijden: k.viaTijden, overgenomenDoor: k.naarNaam })),
        });
      }
      if (naam === "dagplanning") {
        const datum = isoOf(input?.datum, "");
        if (!datum) return JSON.stringify({ fout: "datum (YYYY-MM-DD) is verplicht" });
        const [users, leave, dagShifts] = await Promise.all([
          getUsersData(),
          getLeaveData({ endOnOrAfter: datum }),
          getPlanningData({ monthIso: datum.slice(0, 7) }),
        ]);
        const naam = new Map((users as any[]).map((u) => [String(u.id), String(u.name)]));
        const rijders = (dagShifts as any[])
          .filter((s) => String(s.date) === datum)
          .map((s) => ({ naam: naam.get(String(s.driverId)) ?? "onbekend", dienst: String(s.line ?? ""), tijden: `${s.startTime}–${s.endTime}` }))
          .sort((a, b) => a.tijden.localeCompare(b.tijden));
        const afwezig = (leave as any[])
          .filter((l) => l?.status === "approved" && String(l.startDate) <= datum && datum <= String(l.endDate))
          .map((l) => ({ naam: naam.get(String(l.userId)) ?? "onbekend", type: LEAVE_TYPE_LABEL[String(l.type)] ?? String(l.type) }));
        const bezet = new Set([...rijders.map((r) => r.naam), ...afwezig.map((a) => a.naam)]);
        const vrij = (users as any[])
          .filter((u) => u.isActive !== false && u.role === "chauffeur" && String(u.name).toLowerCase() !== "beheerder" && !bezet.has(String(u.name)))
          .map((u) => String(u.name))
          .sort((a, b) => a.localeCompare(b));
        return JSON.stringify({ datum, rijders, afwezig, vrij });
      }
      if (naam === "verlof_periode") {
        const vanaf = isoOf(input?.vanaf, "");
        const tot = isoOf(input?.tot, "");
        if (!vanaf || !tot || vanaf > tot) return JSON.stringify({ fout: "geldige vanaf/tot (YYYY-MM-DD) verplicht" });
        const [users, leave] = await Promise.all([getUsersData(), getLeaveData({ endOnOrAfter: vanaf })]);
        const naam = new Map((users as any[]).map((u) => [String(u.id), String(u.name)]));
        const rijen = (leave as any[])
          .filter((l) => l?.status === "approved" && String(l.startDate) <= tot && String(l.endDate) >= vanaf)
          .map((l) => ({ naam: naam.get(String(l.userId)) ?? "onbekend", type: LEAVE_TYPE_LABEL[String(l.type)] ?? String(l.type), van: String(l.startDate), totEnMet: String(l.endDate) }))
          .sort((a, b) => a.van.localeCompare(b.van));
        return JSON.stringify({ vanaf, tot, afwezigheden: rijen });
      }
      return JSON.stringify({ fout: `Onbekende tool: ${naam}` });
    };

    const system = [
      `Je bent de planner-assistent van het VHB-personeelsportaal — de digitale collega van de planning van busbedrijf VHB (onderaannemer van De Lijn). Vandaag is ${weekdagLang} (${vandaag}).`,
      "Je helpt de planner met vragen over de personeelsplanning: openstaande diensten, wie kan invallen, wie werkt of afwezig is, en hoe een gat opgelost kan worden.",
      "Baseer élk feit (namen, diensten, tijden, datums) op de uitvoer van je tools. Verzin nooit namen of diensten; geeft een tool niets terug, zeg dat dan eerlijk.",
      "De invalregels zitten al in de tools verwerkt: minstens 8 uur rust ten opzichte van de aansluitende werkdagen, maximaal 6 gewerkte dagen na elkaar, en schoolvervoerchauffeurs rijden geen lijndiensten. Volg het tool-advies en reken rusttijden nooit zelf uit.",
      "Je adviseert alleen — je kunt niets wijzigen of versturen. Verwijs voor het uitvoeren naar het portaal: toewijzen via Openstaande diensten, wissels via de Maandplanning.",
      // Beknoptheid als hard contract i.p.v. "kort en concreet" — feedback
      // Jarno 19-08: de antwoorden waren veel te lang.
      "Wees kort: standaard twee tot vier zinnen. Noem bij een invaladvies alleen de beste twee à drie kandidaten — de tools leveren ze al in de juiste volgorde (wie deze week het minst werkte eerst, dan de kortste reeks aaneengesloten werkdagen, dan het laagste maandtotaal). Som nooit een volledige kandidaten- of dagenlijst op; details zoals wie niet past en waarom, ruilopties of volledige dagplanningen geef je alleen wanneer de planner er expliciet naar vraagt.",
      "Antwoord in het Nederlands, in gewone lopende tekst zonder opmaaktekens (geen sterretjes, koppen of lijstjes met streepjes tenzij echt nodig). Schrijf datums als 'za 29 aug'. Interpreteer relatieve datums ('zaterdag', 'volgende week') ten opzichte van vandaag.",
    ].join("\n");

    const AnthropicSdk = (await import("@anthropic-ai/sdk")).default;
    const client: AnthropicClient = new AnthropicSdk({ apiKey });
    // Sonnet 5 (keuze Jarno 19-08): vrijwel Opus-niveau op dit werk — het
    // denkwerk zit in de deterministische tools — maar ~40% goedkoper en
    // vlotter in een chat. Effort laag om dezelfde reden. Via de env-var
    // PLANNER_CHAT_MODEL is zonder code-wijziging om te schakelen (bv. naar
    // claude-opus-5 als de vragen toch te complex blijken).
    const model = String(process.env.PLANNER_CHAT_MODEL ?? "").trim() || "claude-sonnet-5";
    const vraagModel = (messages: any[]) =>
      (client.messages.create as any)({
        model,
        max_tokens: 8192,
        output_config: { effort: "low" },
        system,
        tools,
        messages,
      });

    let response: any = await vraagModel(gesprek);
    let rondes = 0;
    while (response.stop_reason === "tool_use" && rondes < 6) {
      rondes++;
      gesprek.push({ role: "assistant", content: response.content });
      const resultaten: any[] = [];
      for (const blok of response.content) {
        if (blok.type !== "tool_use") continue;
        let uit: string;
        try {
          uit = await voerToolUit(String(blok.name), blok.input);
        } catch (e: any) {
          uit = JSON.stringify({ fout: e?.message ?? "tool mislukt" });
        }
        resultaten.push({ type: "tool_result", tool_use_id: blok.id, content: uit });
      }
      gesprek.push({ role: "user", content: resultaten });
      response = await vraagModel(gesprek);
    }

    // Een veiligheidsfilter kan een vraag afwijzen (stop_reason "refusal") —
    // in dit domein vrijwel uitgesloten, maar dan liever een nette zin dan
    // een leeg antwoord.
    if (response.stop_reason === "refusal") {
      return { ok: true, antwoord: "Daar kan ik binnen dit portaal niet mee helpen — stel gerust een planningsvraag." };
    }
    const antwoord = (response.content as any[])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { ok: true, antwoord: antwoord || "Daar kon ik geen antwoord op formuleren — probeer de vraag anders te stellen." };
}

app.post("/api/planner-chat", authenticate, requireRole("planner", "admin"), plannerChatRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    // Chatgeschiedenis van de client, hard begrensd (dit endpoint kost geld
    // per token): max 16 beurten van elk max 4000 tekens, alleen platte tekst.
    const ruw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const gesprek: Array<{ role: "user" | "assistant"; content: any }> = ruw
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim())
      .slice(-16)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (gesprek.length === 0 || gesprek[gesprek.length - 1].role !== "user") {
      return res.status(400).json({ error: "Stuur minstens één vraag mee." });
    }
    const uit = await draaiPlannerChat(gesprek);
    // 'in'-narrowing i.p.v. uit.ok: deze tsconfig narrowt boolean-
    // discriminanten niet betrouwbaar.
    if ("antwoord" in uit) {
      res.json({ antwoord: uit.antwoord });
      return;
    }
    res.status(uit.status).json({ error: uit.error, ...(uit.code ? { code: uit.code } : {}) });
  } catch (err: any) {
    console.error("[planner-chat] mislukt:", err?.message ?? err);
    res.status(500).json({ error: "De assistent kon je vraag niet beantwoorden — probeer het zo opnieuw." });
  }
});


// De verloftype-labels (LEAVE_TYPE_LABEL) wonen sinds de consolidatie in
// helpers.ts, naast de drift-test tegen de bewuste client-kopie in
// src/lib/format.ts.

// --- Vervaldata: Code 95 / medische schifting per chauffeur ---
// Beheer door planner/admin; een chauffeur ziet alleen zijn eigen datums.
// De dagelijkse digest-cron waarschuwt op 90/30/7/0 dagen (zie error-digest).
app.get("/api/user-expiries", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const alle = await getUserExpiries();
    // Alleen bewaakte soorten: rijbewijs is er uit (07-08) en eventuele oude
    // rijen in user_expiries mogen niet alsnog in de lijsten opduiken. De
    // rijen zelf blijven in de DB staan — geen dataverlies.
    const bewaakt = alle.filter((e) => Boolean(EXPIRY_SOORT_LABEL[e.soort]));
    const eigen = req.appUser?.role === "chauffeur"
      ? bewaakt.filter((e) => e.userId === String(req.appUser!.id))
      : bewaakt;
    res.json(eigen.map((e) => ({ userId: e.userId, soort: e.soort, validUntil: e.validUntil })));
  } catch (err) {
    console.error("Error reading user expiries:", err);
    res.status(500).json({ error: "Kon vervaldata niet lezen." });
  }
});

app.put("/api/user-expiries", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = String(req.body?.userId ?? "").trim();
    const soort = String(req.body?.soort ?? "").trim();
    // Lege datum = verwijderen (datum onbekend/niet van toepassing).
    const rauw = req.body?.validUntil;
    const validUntil = rauw === null || rauw === undefined || String(rauw).trim() === "" ? null : String(rauw).trim();
    if (!EXPIRY_SOORT_LABEL[soort]) {
      return res.status(400).json({ error: "Onbekende soort vervaldatum." });
    }
    if (validUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
      return res.status(400).json({ error: "Ongeldige datum: verwacht JJJJ-MM-DD." });
    }
    const users = await getUsersData();
    const user = users.find((u: any) => String(u.id) === userId);
    if (!user) {
      return res.status(404).json({ error: "Gebruiker niet gevonden." });
    }
    const label = EXPIRY_SOORT_LABEL[soort];
    if (validUntil === null) {
      await deleteUserExpiry(userId, soort);
    } else {
      await saveUserExpiry({ userId, soort, validUntil, updatedBy: String(req.appUser?.id ?? "") || null });
    }
    await logActivity(
      req,
      "users",
      validUntil ? "Vervaldatum bijgewerkt" : "Vervaldatum verwijderd",
      `${user.name}: ${label} ${validUntil ? `geldig tot ${validUntil}` : "— datum verwijderd"}.`,
      { type: "user", id: userId },
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error saving user expiry:", err);
    res.status(500).json({ error: "Kon vervaldatum niet opslaan." });
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
      url: viewUrl("rooster"),
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
  return parsePlanningMatrixXlsxMetWaarschuwingen(buffer);
};

// Parse + optionele periode-selectie, gedeeld door import en preview. De
// planner maakt de Excel vaak maanden vooruit, maar alleen het vaststaande
// deel mag het portaal in: rijen buiten [van, tot] worden genegeerd alsof ze
// niet in het bestand stonden. Het te vervangen bereik volgt daardoor vanzelf
// de overgebleven rijen (de RPC leidt het af uit min/max source_date).
const parseMatrixInputMetPeriode = (body: any) => {
  const { rows, waarschuwingen } = parseMatrixInput(body);
  const bestandDates = rows.map((row) => row.source_date).filter(Boolean);
  const fileStartDate = bestandDates[0] || null;
  const fileEndDate = bestandDates[bestandDates.length - 1] || null;
  const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
  const periode = body?.periode;
  let van: string | null = null;
  let tot: string | null = null;
  if (periode && typeof periode === "object") {
    van = typeof periode.van === "string" && ISO_DATUM.test(periode.van) ? periode.van : null;
    tot = typeof periode.tot === "string" && ISO_DATUM.test(periode.tot) ? periode.tot : null;
    if ((periode.van && !van) || (periode.tot && !tot)) {
      throw new Error("Ongeldige periode: gebruik datums in het formaat YYYY-MM-DD.");
    }
    if (van && tot && van > tot) {
      throw new Error("Ongeldige periode: de begindatum ligt na de einddatum.");
    }
  }
  const selectie = rows.filter((row) =>
    (!van || row.source_date >= van) && (!tot || row.source_date <= tot));
  if (selectie.length === 0) {
    throw new Error(`Geen dagen binnen de gekozen periode — het bestand loopt van ${fileStartDate ?? "?"} t/m ${fileEndDate ?? "?"}.`);
  }
  return { rows: selectie, fileStartDate, fileEndDate, parserWaarschuwingen: waarschuwingen };
};

app.post("/api/planning-matrix/import", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    let rows, fileStartDate, fileEndDate, parserWaarschuwingen;
    try {
      ({ rows, fileStartDate, fileEndDate, parserWaarschuwingen } = parseMatrixInputMetPeriode(req.body));
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
    // Alleen GEPLAND verlof blokkeert een import: betaald verlof en klein
    // verlet hoorde de planner in de Excel verwerkt te hebben. Ziekte is
    // onvoorzien — de Excel wordt vooraf gemaakt, dus een zieke die er nog in
    // staat is normaal; daarvoor bestaat de herverdeel-flow. De import
    // blokkeerde hierop en noemde het nog "verlof" ook (melding Jarno 15-08).
    const blokkerendVerlof = approvedLeaveForCheck.filter((l) => l.type !== "ziekte");
    const ziekteLeaveForCheck = approvedLeaveForCheck.filter((l) => l.type === "ziekte");

    // Conflicten VÓÓR de replay = conflicten die in de Excel zelf zitten. Die
    // kan de planner daar oplossen.
    const matrixConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userNameForConflict);

    // Goedgekeurde ruilen opnieuw toepassen — de matrix kent ze niet.
    const reapplied = await reapplyApprovedSwaps(generatedPlanning.shifts, { van: startDate, tot: endDate });

    // Alles ná de replay; het verschil komt dus uit een doorgevoerde ruil.
    // Dat onderscheid is belangrijk: zo'n conflict staat NIET in de Excel — de
    // planner zocht zich suf naar een rij die daar niet bestaat, en de import
    // bleef geblokkeerd tot hij toevallig de ruil of het verlof vond.
    const alleConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userNameForConflict);
    const matrixKeys = new Set(matrixConflicts.map(verlofConflictKey));
    const replayConflicts = alleConflicts.filter((c) => !matrixKeys.has(verlofConflictKey(c)));
    const verlofConflictsForImport = alleConflicts;
    // Informatief, niet blokkerend: diensten die op een ziek gemelde chauffeur
    // staan. Na de import vangt de herverdeel-flow ze op (maandplanning,
    // dashboard, dekking).
    const ziekteDiensten = verlofConflictsIn(generatedPlanning.shifts, ziekteLeaveForCheck, userNameForConflict);

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
        ziekteDiensten,
        blocked: true,
      });
    }

    // Herstelpunt: de volledige stand van vóór deze import naar de
    // backups-bucket. Best-effort — een falend herstelpunt mag de import
    // niet tegenhouden, maar zonder pad verschijnt er ook geen
    // terugzet-knop bij deze import in de historiek.
    let snapshotPath: string | null = null;
    try {
      const [matrixVoor, planningVoor] = await Promise.all([getPlanningMatrixRows(), getPlanningData()]);
      snapshotPath = await storeImportSnapshot({
        createdAt: new Date().toISOString(),
        matrixRows: matrixVoor,
        planning: planningVoor as any[],
      });
    } catch (snapErr) {
      console.error("Herstelpunt maken mislukt (import gaat door):", snapErr);
    }

    // Atomair: matrix + planning in één transactie (geen skew als één van
    // beide zou falen). Valt server-side terug op het oude pad zolang de
    // RPC-migratie nog niet gedraaid is.
    await replacePlanningAndMatrix(rows, generatedPlanning.shifts);
    const bestandsnaam = typeof req.body?.filename === "string" ? req.body.filename.trim().slice(0, 200) : "";
    const historiekOk = await savePlanningMatrixHistoryEntry({
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      importedDays: rows.length,
      detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
      generatedShifts: generatedPlanning.summary.generatedShifts,
      matchedServices: generatedPlanning.summary.matchedServices,
      skippedAbsences: generatedPlanning.summary.skippedAbsences,
      unknownCodes: generatedPlanning.summary.unknownCodes,
      unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
      filename: bestandsnaam || null,
      importedBy: req.appUser?.name ?? null,
      periodStart: startDate,
      periodEnd: endDate,
      fileStart: fileStartDate,
      fileEnd: fileEndDate,
      snapshotPath,
    });
    // Historiek niet weggeschreven (bv. migratie 2026-08-20 niet gedraaid):
    // de import zelf is geslaagd, maar er is geen terugzet-knop voor deze
    // import. Dat hoort de planner te zien, niet alleen de Vercel-logs
    // (controle-ronde 27-08, bevinding 25).
    if (!historiekOk) {
      const melding = "Herstelpunt niet vastgelegd: de import-historiek kon niet worden opgeslagen. Terugzetten via 'Zet terug' is voor deze import niet mogelijk — meld dit aan de beheerder (schema-check in Systeemstatus).";
      parserWaarschuwingen = [...(parserWaarschuwingen ?? []), melding];
      await logActivity(req, "planning", "Herstelpunt niet vastgelegd", melding);
    }
    await logActivity(
      req,
      "planning",
      "Matrix import bevestigd",
      `${rows.length} dagen verwerkt (periode ${rows[0]?.source_date || "?"} t/m ${rows[rows.length - 1]?.source_date || "?"} vervangen; planning daarbuiten onaangetast${fileStartDate !== startDate || fileEndDate !== endDate ? `; selectie uit bestand ${fileStartDate} t/m ${fileEndDate}` : ""}), ${generatedPlanning.summary.generatedShifts} diensten opgebouwd, ${reapplied.applied} goedgekeurde ruil(en) opnieuw doorgevoerd${reapplied.skipped > 0 ? ` (${reapplied.skipped} niet toepasbaar)` : ""}. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}. Niet-gematchte chauffeurs: ${summarizeTokens(generatedPlanning.summary.unmatchedDrivers)}.`,
    );

    // Chauffeurs met diensten in deze import krijgen een seintje.
    const affectedDriverIds = [...new Set(generatedPlanning.shifts.map((s: any) => String(s.driverId)))];
    await sendPushToUsers(affectedDriverIds, {
      title: "Planning bijgewerkt",
      body: `Nieuwe planning geïmporteerd (${rows[0]?.source_date || "?"} t/m ${rows[rows.length - 1]?.source_date || "?"}). Bekijk je rooster.`,
      url: viewUrl("rooster"),
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
      ziekteDiensten,
      parserWaarschuwingen,
      startDate,
      endDate,
      fileStartDate,
      fileEndDate,
    });
  } catch (err: any) {
    console.error("Planning importeren is mislukt.", err);
    res.status(500).json({ error: "Planning importeren is mislukt." });
  }
});

// Terugzetten naar het herstelpunt van een import: de volledige stand van
// matrix + planning van vóór díe import komt terug. Bewust admin-only en
// integraal — dit is een noodrem, geen bewerkingsknop. De
// planning_version-trigger verwittigt clients vanzelf.
app.post("/api/planning-matrix/restore", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const historyId = String(req.body?.historyId ?? "").trim();
    if (!historyId) {
      return res.status(400).json({ error: "Geef de import mee waarvan je het herstelpunt wilt terugzetten (historyId)." });
    }
    const history = await getPlanningMatrixHistory();
    const entry = history.find((h) => String(h.id) === historyId);
    if (!entry) {
      return res.status(404).json({ error: "Deze import staat niet (meer) in de historiek." });
    }
    if (!entry.snapshotPath) {
      return res.status(400).json({ error: "Voor deze import bestaat geen herstelpunt — die worden pas sinds eind augustus aangemaakt." });
    }
    const snapshot = await getImportSnapshot(entry.snapshotPath);
    if (!snapshot) {
      return res.status(404).json({ error: "Het herstelpunt is niet meer beschikbaar (alleen de laatste vijf blijven bewaard)." });
    }
    if (snapshot.matrixRows.length === 0) {
      return res.status(400).json({ error: "Dit herstelpunt is leeg (stand van vóór de allereerste import) — er valt niets terug te zetten." });
    }
    await restorePlanningAndMatrixSnapshot(snapshot);
    const importMoment = new Date(entry.createdAt).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Brussels" });
    await logActivity(
      req,
      "planning",
      "Planning teruggezet naar herstelpunt",
      `Stand van vóór de import van ${importMoment}${entry.filename ? ` (${entry.filename})` : ""} teruggezet: ${snapshot.matrixRows.length} matrixdagen, ${snapshot.planning.length} roosterregels.`,
    );
    res.json({ success: true, matrixDagen: snapshot.matrixRows.length, roosterregels: snapshot.planning.length });
  } catch (err: any) {
    console.error("Herstelpunt terugzetten mislukt:", err);
    res.status(500).json({ error: "Terugzetten is mislukt — de planning is mogelijk deels teruggezet. Controleer de maandplanning en probeer opnieuw." });
  }
});

app.post("/api/planning-matrix/preview", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    let rows, fileStartDate, fileEndDate, parserWaarschuwingen;
    try {
      ({ rows, fileStartDate, fileEndDate, parserWaarschuwingen } = parseMatrixInputMetPeriode(req.body));
    } catch (parseErr: any) {
      return res.status(400).json({ error: parseErr.message });
    }
    const importedDates = rows.map((row) => row.source_date).filter(Boolean);
    const startDate = importedDates[0] || null;
    const endDate = importedDates[importedDates.length - 1] || null;
    const generatedPlanning = await buildPlanningFromMatrix(rows);

    // Een import vervangt alléén zijn eigen datumbereik. Leg de bestaande
    // matrix ernaast zodat de preview kan tonen wat vervangen wordt, wat
    // blijft staan en of er een gat tussen beide periodes valt.
    const bestaandeMatrix = await getPlanningMatrixRows();
    const bestaandeMatrixDates = bestaandeMatrix
      .map((r) => String(r.source_date))
      .filter(Boolean)
      .sort();
    const existingStart = bestaandeMatrixDates[0] || null;
    const existingEnd = bestaandeMatrixDates[bestaandeMatrixDates.length - 1] || null;
    const replacedExistingDays = startDate && endDate
      ? bestaandeMatrixDates.filter((d) => d >= startDate && d <= endDate).length
      : 0;
    const retainedDays = bestaandeMatrixDates.length - replacedExistingDays;

    const [leave, users] = await Promise.all([getLeaveData(), getUsersData()]);
    const userName = (id: string) => users.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
    const approvedLeave = leave.filter((l) => l.status === "approved");
    // Zelfde splitsing als de echte import: alleen gepland verlof blokkeert;
    // ziekte is informatief (zie /planning-matrix/import).
    const blokkerendVerlof = approvedLeave.filter((l) => l.type !== "ziekte");
    const ziekteLeave = approvedLeave.filter((l) => l.type === "ziekte");

    // Zelfde volgorde als de echte import (zie /planning-matrix/import), zodat
    // het voorbeeld ook echt toont wat de import oplevert — inclusief het
    // onderscheid tussen conflicten uit de Excel en conflicten die pas door een
    // doorgevoerde ruil ontstaan.
    const matrixConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userName);
    const reapplied = await reapplyApprovedSwaps(generatedPlanning.shifts, { van: startDate, tot: endDate });
    const verlofConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userName);
    const matrixKeys = new Set(matrixConflicts.map(verlofConflictKey));
    const replayConflicts = verlofConflicts.filter((c) => !matrixKeys.has(verlofConflictKey(c)));
    const ziekteDiensten = verlofConflictsIn(generatedPlanning.shifts, ziekteLeave, userName);

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

    // Chauffeurs vergeleken met de planning vlak vóór deze periode: wie
    // verdween uit de Excel, wie kwam erbij? Zo valt een per ongeluk
    // weggevallen kolom (case Luc Cherlet, 20-08) meteen op — de import zelf
    // blokkeert hier bewust niet op, want een vertrokken of nieuwe collega is
    // ook gewoon zo. Het venster is begrensd (onbegrensd terugkijken liet elke
    // ooit-vertrokken chauffeur eeuwig als "verdwenen" terugkeren); dekt het
    // bestand de hele bewaarde periode, dan vergelijken we met de oude versie
    // van de vervangen periode zelf (controle-ronde 20-08).
    const VERGELIJK_VENSTER_DAGEN = 60;
    const vergelijkGrens = startDate ? addDagenIso(startDate, -VERGELIJK_VENSTER_DAGEN) : null;
    let vergelijkRows = (bestaandeMatrix as any[]).filter((r) => {
      const d = String(r?.source_date ?? "");
      return Boolean(startDate && vergelijkGrens) && d >= vergelijkGrens! && d < startDate!;
    });
    if (vergelijkRows.length === 0 && startDate && endDate) {
      vergelijkRows = (bestaandeMatrix as any[]).filter((r) => {
        const d = String(r?.source_date ?? "");
        return d >= startDate && d <= endDate;
      });
    }
    const namenIn = (rs: any[]) => {
      const m = new Map<string, { naam: string; laatste: string }>();
      for (const r of rs) {
        const date = String(r?.source_date ?? "");
        const assignments = r?.assignments && typeof r.assignments === "object" && !Array.isArray(r.assignments) ? r.assignments : {};
        for (const naam of Object.keys(assignments)) {
          const key = sortedNameToken(String(naam));
          const cur = m.get(key);
          if (!cur || date > cur.laatste) m.set(key, { naam: String(naam), laatste: date });
        }
      }
      return m;
    };
    let chauffeursNieuw: string[] = [];
    let chauffeursVerdwenen: Array<{ naam: string; laatste: string }> = [];
    if (vergelijkRows.length > 0) {
      const oud = namenIn(vergelijkRows);
      const nieuw = namenIn(rows as any[]);
      chauffeursVerdwenen = [...oud.entries()].filter(([k]) => !nieuw.has(k)).map(([, v]) => v).sort((a, b) => a.naam.localeCompare(b.naam));
      chauffeursNieuw = [...nieuw.entries()].filter(([k]) => !oud.has(k)).map(([, v]) => v.naam).sort();
    }

    // "ziek" in de Excel zonder geregistreerde ziekteperiode: het Ziekte-blad,
    // de digest en de advisor kennen die afwezigheid dan niet. Alleen vandaag
    // en later — historiek is geen actiepunt meer.
    const ziekTeRegistreren = vindOngeregistreerdeZiekte(rows as any[], users as any[], leave as any[], brusselsDay(new Date().toISOString()));

    // Verwachtingen-vs-praktijk over dit bestand: een dienstregelingswissel
    // waarvan de dag-type-lijsten nog niet bijgewerkt zijn, valt zo al in de
    // preview op i.p.v. pas als fantoomgaten op de dekking (20-08).
    const verwachtingsCheck = await berekenVerwachtingsCheck(rows as any[]);

    res.json({
      success: true,
      importedDays: rows.length,
      detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
      generatedShifts: generatedPlanning.summary.generatedShifts,
      matchedServices: generatedPlanning.summary.matchedServices,
      skippedAbsences: generatedPlanning.summary.skippedAbsences,
      startDate,
      endDate,
      fileStartDate,
      fileEndDate,
      importedDates,
      existingStart,
      existingEnd,
      replacedExistingDays,
      retainedDays,
      verlofConflicts,
      matrixVerlofConflicts: matrixConflicts,
      ruilVerlofConflicts: replayConflicts,
      ziekteDiensten,
      unknownCodes: generatedPlanning.summary.unknownCodes,
      unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
      servicesWithoutSegments: generatedPlanning.summary.servicesWithoutSegments,
      perDriver: perDriverNaRuilen,
      // De import meldde de replay wél in de log, het voorbeeld verzweeg hem —
      // terwijl de cijfers hierboven er al door beïnvloed zijn.
      reappliedSwaps: reapplied,
      parserWaarschuwingen,
      chauffeursNieuw,
      chauffeursVerdwenen,
      ziekTeRegistreren,
      verwachtingsCheck,
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
    // Diff vóór het vervangen: alleen chauffeurs van wie het rooster écht
    // wijzigt krijgen straks een push. Jarno herbouwt tijdens de testfase
    // meerdere keren per dag — iedereen elke keer pingen traint mensen om
    // meldingen te negeren, en dan mist iemand de wijziging die wél telt.
    const vorigePlanning = await getPlanningData();
    const dienstSleutel = (r: any) => `${r.date}|${r.startTime ?? ""}|${r.endTime ?? ""}|${r.line ?? ""}|${r.loopnr ?? ""}|${r.busNumber ?? ""}`;
    const perChauffeur = (rows: any[]) => {
      // Eerst lijsten verzamelen, dan één keer sorteren/joinen — de oude
      // opbouw her-splitte en her-sorteerde de string per rij (O(n²)) en
      // smokkelde via "".split("\n") een lege regel in elke sleutel.
      const lijsten = new Map<string, string[]>();
      for (const r of rows) {
        const id = String(r.driverId ?? "");
        if (!id) continue;
        const lijst = lijsten.get(id) ?? [];
        lijst.push(dienstSleutel(r));
        lijsten.set(id, lijst);
      }
      return new Map([...lijsten].map(([id, keys]) => [id, keys.sort().join("\n")] as const));
    };
    const oud = perChauffeur(vorigePlanning as any[]);
    const nieuwSet = perChauffeur(generatedPlanning.shifts); // ruilen zijn in-place toegepast
    const gewijzigd = [...new Set([...oud.keys(), ...nieuwSet.keys()])]
      .filter((id) => oud.get(id) !== nieuwSet.get(id));

    await replacePlanningData(generatedPlanning.shifts);
    await logActivity(
      _req,
      "planning",
      "Planning opnieuw opgebouwd",
      `${generatedPlanning.summary.generatedShifts} diensten opgebouwd vanuit de actuele matrix, ${reapplied.applied} goedgekeurde ruil(en) opnieuw doorgevoerd${reapplied.skipped > 0 ? ` (${reapplied.skipped} niet toepasbaar)` : ""}. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}.`,
    );
    // "Staat mijn rooster er al op?" is dé vraag van personeel — beantwoord
    // hem proactief, maar alleen bij wie er iets veranderde.
    if (gewijzigd.length > 0) {
      await sendPushToUsers(gewijzigd, {
        title: "Rooster bijgewerkt",
        body: "Je rooster is gewijzigd — bekijk je diensten.",
        url: viewUrl("rooster"),
      });
    }
    res.json({ success: true, ...generatedPlanning.summary, notifiedDrivers: gewijzigd.length });
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
/** Revisie van de gebruikerslijst ZONDER de sessie-velden. lastLogin en
 *  activeSessions muteren bij elke login/logout — server-side, buiten
 *  gebruikersbeheer om — en zaten mee in de hash: vrijwel elke admin-save
 *  overdag kreeg zo een valse 409 "gewijzigd door iemand anders"
 *  (controle-ronde 27-08). De velden zelf zijn ook geen beheer-invoer meer:
 *  saveUsersData houdt de DB-waarde aan. */
const usersRevisionOf = (users: AppUser[]): string =>
  revisionOf(users.map((user) => ({ ...user, lastLogin: undefined, activeSessions: undefined })));
/** True als de client een base-revisie meegaf die niet meer overeenkomt met
 *  de huidige serverstaat → iemand anders heeft intussen opgeslagen. */
const revisionConflict = (req: AuthenticatedRequest, current: any[], rev: (rows: any[]) => string = revisionOf): boolean => {
  const base = req.headers[COLLECTION_REVISION_HEADER];
  if (typeof base !== "string" || base.length === 0) return false; // oudere client → check overslaan
  return base !== rev(current);
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
    res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(users));
    // `_rev` per record (hash over de volledige serverstaat, zonder sessie-
    // velden): de client stuurt hem terug bij PUT/DELETE /api/users/:id.
    res.json(users.map((user) => withRecordRevision(toRoleScopedUser(user, req.appUser!.role, req.appUser!.id), userRecordRevisionOf(user))));
  } catch (err) {
    console.error("Error reading users data:", err);
    res.status(500).json({ error: "Gegevens laden is mislukt." });
  }
});

app.post("/api/users", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      // Gedeeld contract (shared/schemas/user.ts) — o.a. het wachtwoord-
      // minimum, dat ooit alleen in de UI stond (controle-ronde 27-08,
      // bevinding 32). 400 met veldfouten per rij; de data zelf gaat
      // ongewijzigd door (sanitizeIncomingUser normaliseert al).
      if (!valideerLijst(res, userLijstSchema, newData, (u: any) => u?.name)) return;
      const previousUsers = await getUsersData();
      // Revisie-check: twee admin-sessies die tegelijk bewerken overschreven
      // elkaar anders stil — en saveUsersData doet onomkeerbare Auth-deletes.
      if (revisionConflict(req, previousUsers, usersRevisionOf)) return revisionConflictResponse(res, "De gebruikerslijst");
      const usersRemoved = detectMassDelete(previousUsers, newData);
      if (usersRemoved !== null) return massDeleteResponse(res, usersRemoved, previousUsers.length, "gebruikers");
      // Bijwerkingen (Auth + welkomstmail, onthaal-docs, documenten opruimen,
      // audit, cache) zitten in de gedeelde schrijfkern — zelfde pad als de
      // per-record-routes hieronder.
      const { createdAccounts } = await verwerkUsersOpslag(req as AuthenticatedRequest, previousUsers, newData);

      res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
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

// --- Gebruikers per record (PUT/POST one/DELETE) ---
// Eerste stap weg van "POST de hele collectie": het scherm bewerkt rij voor
// rij, dus de API ook. Zelfde schrijfkern (verwerkUsersOpslag) als de
// collectie-POST; concurrency per record via `_rev` (zie recordWrites.ts).

/** Gedeelde 409 voor een record dat intussen gewijzigd is: het actuele
 *  record gaat mee zodat de client kan verversen. */
const recordConflictResponse = (res: any, label: string, record: unknown) =>
  res.status(409).json({
    error: "Gewijzigd door iemand anders",
    details: `${label} is intussen door iemand anders gewijzigd. De lijst wordt ververst — bekijk de wijziging en probeer je aanpassing opnieuw.`,
    conflict: "record",
    record,
  });
const recordRevisionMissingResponse = (res: any) =>
  res.status(400).json({ error: `${RECORD_REVISION_HEADER} ontbreekt: stuur de revisie van het record dat je zag mee.` });
const isPlainRecord = (body: unknown): body is Record<string, unknown> =>
  !!body && typeof body === "object" && !Array.isArray(body);
const newRecordId = () => crypto.randomUUID();

// Veldvalidatie (naam, e-mail, wachtwoordminimum, …) zit in het gedeelde
// contract: userBodySchema via valideerRecord → 400 met veldfouten.
/** Zelfde vangrail als saveUsersData, maar als nette 400 i.p.v. een 500. */
const laatsteAdminVerdwijnt = (users: IncomingUser[]) => countAdmins(users.map(sanitizeIncomingUser)) === 0;
const emailInGebruik = (users: AppUser[], email: string | undefined, eigenId: string) =>
  !!email && users.some((u) => String(u.id) !== eigenId && normalizeEmail(u.email) === email);
const userResponseRecord = async (id: string) => {
  const user = (await getUsersData()).find((u) => String(u.id) === id);
  return user ? withRecordRevision(user, userRecordRevisionOf(user)) : null;
};

app.post("/api/users/one", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body;
    if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één gebruiker verwacht." });
    if (!valideerRecord(res, userBodySchema, body)) return;
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : newRecordId();
    const previousUsers = await getUsersData();
    if (previousUsers.some((u) => String(u.id) === id)) {
      return res.status(409).json({ error: "Er bestaat al een gebruiker met dit id.", conflict: "exists" });
    }
    const email = normalizeEmail(typeof body.email === "string" ? body.email : undefined);
    if (emailInGebruik(previousUsers, email, id)) return res.status(409).json({ error: `E-mailadres ${email} is al in gebruik.`, conflict: "email" });
    const record = { ...body, id } as IncomingUser;
    await verwerkUsersOpslag(req, previousUsers, [...previousUsers, record], { samenvatting: false });
    res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
    res.status(201).json({ success: true, user: await userResponseRecord(id) });
  } catch (err: any) {
    console.error("Gebruiker toevoegen is mislukt.", err?.message || err);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

app.put("/api/users/:id", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body;
    if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één gebruiker verwacht." });
    if (!valideerRecord(res, userBodySchema, body)) return;
    const rev = requestedRecordRevision(req);
    if (!rev) return recordRevisionMissingResponse(res);
    const previousUsers = await getUsersData();
    const current = previousUsers.find((u) => String(u.id) === id);
    if (!current) return res.status(404).json({ error: "Gebruiker niet gevonden — mogelijk intussen verwijderd." });
    if (rev !== userRecordRevisionOf(current)) return recordConflictResponse(res, "Deze gebruiker", withRecordRevision(current, userRecordRevisionOf(current)));
    const email = normalizeEmail(typeof body.email === "string" ? body.email : undefined);
    if (emailInGebruik(previousUsers, email, id)) return res.status(409).json({ error: `E-mailadres ${email} is al in gebruik.`, conflict: "email" });
    const record = { ...body, id } as IncomingUser;
    const newData = previousUsers.map((u) => (String(u.id) === id ? record : u));
    if (laatsteAdminVerdwijnt(newData)) return res.status(400).json({ error: "Er moet minstens 1 actieve admin overblijven." });
    await verwerkUsersOpslag(req, previousUsers, newData, { samenvatting: false });
    res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
    res.json({ success: true, user: await userResponseRecord(id) });
  } catch (err: any) {
    console.error("Gebruiker opslaan is mislukt.", err?.message || err);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

app.delete("/api/users/:id", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    // Jezelf verwijderen blijft geblokkeerd (de UI beschermt dit ook).
    if (id === String(req.appUser!.id)) return res.status(403).json({ error: "Je kunt je eigen account niet verwijderen." });
    const rev = requestedRecordRevision(req);
    if (!rev) return recordRevisionMissingResponse(res);
    const previousUsers = await getUsersData();
    const current = previousUsers.find((u) => String(u.id) === id);
    if (!current) return res.status(404).json({ error: "Gebruiker niet gevonden — mogelijk al verwijderd." });
    if (rev !== userRecordRevisionOf(current)) return recordConflictResponse(res, "Deze gebruiker", withRecordRevision(current, userRecordRevisionOf(current)));
    const newData = previousUsers.filter((u) => String(u.id) !== id);
    if (laatsteAdminVerdwijnt(newData)) return res.status(400).json({ error: "Er moet minstens 1 actieve admin overblijven." });
    await verwerkUsersOpslag(req, previousUsers, newData, { samenvatting: false });
    res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Gebruiker verwijderen is mislukt.", err?.message || err);
    res.status(500).json({ error: "Verwijderen is mislukt." });
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
    // Het endpoint wordt later server-side aangeroepen door webpush.sendNotification
    // (en de digest-cron). Zonder deze check kon een geauthenticeerde gebruiker
    // een intern/loopback/metadata-adres opslaan en de server dat laten fetchen
    // (blinde SSRF). Alleen https naar een publieke host toestaan — een echt
    // push-endpoint (FCM/Mozilla/WNS/Apple) voldoet daar altijd aan.
    if (!isSafeExternalHttpsUrl(endpoint)) {
      return res.status(400).json({ error: "Ongeldig push-endpoint." });
    }
    await savePushSubscription({ userId: String(req.appUser!.id), endpoint, p256dh, auth });
    res.json({ success: true });
  } catch (err: any) {
    console.error("Abonneren mislukt", err);
    res.status(500).json({ error: "Abonneren mislukt" });
  }
});

// Wie kán meldingen ontvangen? Voedt de badge in Gebruikersbeheer; tijdens de
// uitrol is dat het verschil tussen "hij reageert niet" en "hij krijgt niets".
// Alleen gebruikers-ids, en alleen voor planner/admin.
app.get("/api/push/subscribers", authenticate, requireRole("planner", "admin"), async (_req: AuthenticatedRequest, res) => {
  try {
    res.json({ userIds: await getUsersMetPush() });
  } catch (err) {
    console.error("Push-abonnees lezen mislukt", err);
    res.status(500).json({ error: "Kon niet ophalen wie meldingen aan heeft staan." });
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

// Ochtendbriefing naar Telegram (verbeterronde-bot 22-08, nr. 4): elke dag
// een kort overzicht — óók als alles in orde is, want "geen bericht" en
// "geen probleem" zijn anders niet te onderscheiden. Bevat vandaag + morgen,
// wie ziek is, de planning-horizon en dringende vervaldata (nr. 5).
app.get("/api/cron/telegram-briefing", async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Niet toegestaan." });
  }
  try {
    if (!telegramGeconfigureerd()) {
      return res.json({ success: true, skipped: "telegram niet geconfigureerd" });
    }
    const vandaag = brusselsDay(new Date().toISOString());
    const morgen = addDagenIso(vandaag, 1);
    const [dagenVandaag, dagenMorgen, matrixRows, expiries, usersVoorVerval] = await Promise.all([
      berekenDekkingsGaten(vandaag, vandaag),
      berekenDekkingsGaten(morgen, morgen),
      getPlanningMatrixRows(),
      getUserExpiries(),
      getUsersData(),
    ]);

    const delen: string[] = [];
    const dagLang = new Date(`${vandaag}T12:00:00Z`).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Brussels" });
    delen.push(`🌅 <b>Ochtendbriefing — ${dagLang}</b>`);
    delen.push(await formatVandaag(dagenVandaag));
    const morgenGat = dagenMorgen.find((d) => d.date === morgen);
    delen.push(!morgenGat
      ? "⚠️ Geen geïmporteerde planning voor morgen."
      : morgenGat.missing.length > 0
        ? `Morgen open: ${morgenGat.missing.map((c) => escapeHtml(c)).join(", ")}.`
        : "Morgen: alles ingevuld.");
    delen.push(await formatZiek());

    // Planning-horizon: hoe ver reikt de geïmporteerde matrix nog?
    const laatste = (matrixRows as any[])
      .map((r) => String(r.source_date ?? ""))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .pop();
    if (laatste) {
      const dagenOver = Math.round((Date.parse(`${laatste}T00:00:00Z`) - Date.parse(`${vandaag}T00:00:00Z`)) / 86400000);
      if (dagenOver < 0) {
        delen.push(`⚠️ De geïmporteerde planning is verlopen (liep t/m ${DAG_KORT(laatste)}) — importeer de nieuwe Excel.`);
      } else if (dagenOver <= 7) {
        delen.push(`⚠️ Nog maar ${dagenOver} dag${dagenOver === 1 ? "" : "en"} planning in het portaal (t/m ${DAG_KORT(laatste)}) — tijd voor een import.`);
      }
    }

    // Dringende vervaldata (≤ 7 dagen of verlopen) — de mail meldt breder,
    // dit is alleen de staart die echt aandacht vraagt.
    const naamVan = (id: string) => (usersVoorVerval as any[]).find((u) => String(u.id) === id)?.name ?? "Onbekend";
    const dringend = expiries
      .filter((e) => Boolean(EXPIRY_SOORT_LABEL[e.soort]) && e.validUntil)
      .map((e) => ({ ...e, dagen: Math.round((Date.parse(`${e.validUntil}T00:00:00Z`) - Date.parse(`${vandaag}T00:00:00Z`)) / 86400000) }))
      .filter((e) => e.dagen <= 7)
      .sort((a, b) => a.dagen - b.dagen);
    if (dringend.length > 0) {
      delen.push(`📄 Documenten: ${dringend.map((e) => `${escapeHtml(naamVan(e.userId))} — ${EXPIRY_SOORT_LABEL[e.soort]} ${e.dagen < 0 ? `VERLOPEN (${e.validUntil})` : e.dagen === 0 ? "verloopt VANDAAG" : `nog ${e.dagen} dag${e.dagen === 1 ? "" : "en"}`}`).join("; ")}.`);
    }

    // Kandidaten-knoppen voor de gaten van vandaag + morgen (max 8).
    const { knoppen } = formatGaten([...dagenVandaag, ...dagenMorgen.filter((d) => d.date === morgen)]);
    const verzonden = await stuurTelegram(delen.join("\n\n"), { knoppen });
    await logCronHeartbeat("telegram-briefing", verzonden ? "Briefing verstuurd." : "Versturen mislukt of niet geconfigureerd.");
    res.json({ success: true, verzonden });
  } catch (err: any) {
    console.error("[telegram-briefing] mislukt:", err?.message ?? err);
    res.status(500).json({ error: "Briefing versturen is mislukt." });
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
    // Weekoverzicht i.p.v. dagoverzicht (Jarno 05-09: dagelijkse mail was
    // storend): de cron blijft dagelijks draaien (vervaldata-pushes en het
    // dekkingsoverzicht horen elke dag), maar de mail gaat alleen op de
    // ERROR_DIGEST_WEEKDAG (0 = zondag … 6; standaard 1 = maandag) en kijkt
    // dan zeven dagen terug. ERROR_DIGEST_WEEKDAG=elke = weer dagelijks.
    const weekdag = (process.env.ERROR_DIGEST_WEEKDAG ?? "1").trim().toLowerCase();
    const mailVandaag = weekdag === "elke" || String(new Date().getDay()) === weekdag;
    const intervalMin = Number(process.env.ERROR_DIGEST_INTERVAL_MIN) > 0
      ? Number(process.env.ERROR_DIGEST_INTERVAL_MIN)
      : weekdag === "elke" ? 1440 : 10080;
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

    // Vervaldata-bewaker (07-08): één keer per dag — dus in deze cron —
    // nakijken welke documenten (Code 95 / medische schifting) bijna
    // verlopen. Pushes op de vaste mijlpalen 90/30/7/0 dagen: de cron draait
    // 1×/dag, dus dat is vanzelf exact één push per mijlpaal, zonder aparte
    // verstuurd-administratie. De mailsectie hieronder toont alles binnen 60
    // dagen (herhaling in een dagoverzicht is juist de bedoeling).
    // Best-effort — mag het dagoverzicht nooit breken.
    let vervalTekst = "";
    let vervalHtml = "";
    try {
      const [expiries, alleUsers] = await Promise.all([getUserExpiries(), getUsersData()]);
      const actief = new Map(alleUsers.filter((u: any) => u.isActive !== false).map((u: any) => [String(u.id), u]));
      const vandaag = brusselsDay(new Date().toISOString());
      const dagenTot = (d: string) => Math.round((Date.parse(d) - Date.parse(vandaag)) / 86400000);
      const rijen = expiries
        // Alleen bewaakte soorten (rijbewijs is er uit): een achtergebleven
        // rij mag geen push of mailregel meer veroorzaken.
        .filter((e) => actief.has(e.userId) && Boolean(EXPIRY_SOORT_LABEL[e.soort]))
        .map((e) => ({
          ...e,
          naam: String((actief.get(e.userId) as any)?.name ?? "Onbekend"),
          label: EXPIRY_SOORT_LABEL[e.soort],
          dagen: dagenTot(e.validUntil),
        }))
        .filter((e) => Number.isFinite(e.dagen))
        .sort((a, b) => a.dagen - b.dagen);
      for (const e of rijen) {
        if (e.dagen === 90 || e.dagen === 30 || e.dagen === 7 || e.dagen === 0) {
          await sendPushToUsers([e.userId], {
            title: e.dagen === 0 ? `${e.label} verloopt vandaag` : `${e.label} verloopt over ${e.dagen} dagen`,
            body: `Je ${e.label.toLowerCase()} is geldig tot ${e.validUntil}. Regel tijdig de vernieuwing en geef het door aan de planning.`,
            url: "/",
          });
          // Óók per e-mail naar de chauffeur zelf (idee 46): push bereikt maar
          // een handvol chauffeurs, mail wél. Best-effort, mag de cron niet
          // laten vallen. Eén mijlpaal per dag ⇒ vanzelf één mail per mijlpaal.
          const mailAdres = String((actief.get(e.userId) as any)?.email ?? "").trim();
          if (mailAdres) {
            try {
              await sendExpiryReminderEmail({
                to: mailAdres,
                name: e.naam,
                soortLabel: e.label,
                validUntil: e.validUntil,
                dagen: e.dagen,
              });
            } catch (mailErr: any) {
              console.error("[error-digest] vervaldata-mail mislukt:", mailErr?.message ?? mailErr);
            }
          }
        }
      }
      const teMelden = rijen.filter((e) => e.dagen <= 60);
      if (teMelden.length > 0) {
        const regel = (e: (typeof teMelden)[number]) =>
          e.dagen < 0
            ? `${e.naam} — ${e.label} is VERLOPEN sinds ${e.validUntil} (${Math.abs(e.dagen)} dagen)`
            : e.dagen === 0
              ? `${e.naam} — ${e.label} verloopt VANDAAG (${e.validUntil})`
              : `${e.naam} — ${e.label} verloopt over ${e.dagen} ${e.dagen === 1 ? "dag" : "dagen"} (${e.validUntil})`;
        vervalTekst = `\n\nDocumenten (binnen 60 dagen):\n${teMelden.map((e) => `• ${regel(e)}`).join("\n")}`;
        vervalHtml = `<p><strong>Documenten (binnen 60 dagen)</strong></p><ul>${teMelden.map((e) => `<li>${escapeHtml(regel(e))}</li>`).join("")}</ul>`;
      }
    } catch (err: any) {
      console.error("[error-digest] vervaldata-sectie mislukt:", err?.message ?? err);
    }

    // Proactieve advisor (idee 3, 18-08): elke ochtend de openstaande diensten
    // van de komende 7 dagen mét het collega-advies per gat — de planner hoeft
    // het portaal niet meer te openen om te wéten dat er iets openstaat. Best-
    // effort, mag het dagoverzicht nooit breken. Per gat draait de volledige
    // adviesberekening; cap op 8 zodat de cron niet ontspoort bij een lege maand.
    let dekkingTekst = "";
    let dekkingHtml = "";
    try {
      const vandaagBrussel = brusselsDay(new Date().toISOString());
      const dagen = await berekenDekkingsGaten(vandaagBrussel, addDagenIso(vandaagBrussel, 6));
      const gaten = dagen.flatMap((d) => d.missing.map((code) => ({ date: d.date, code })));
      if (gaten.length > 0) {
        const MAX_ADVIEZEN = 8;
        const regels: string[] = [];
        for (const gat of gaten.slice(0, MAX_ADVIEZEN)) {
          try {
            const advies = await berekenCoverageAdvies(gat.date, gat.code);
            regels.push(`${DAG_KORT(gat.date)} — dienst ${gat.code}: ${advies.samenvatting}`);
          } catch {
            regels.push(`${DAG_KORT(gat.date)} — dienst ${gat.code}: advies kon niet berekend worden.`);
          }
        }
        if (gaten.length > MAX_ADVIEZEN) {
          regels.push(`…en nog ${gaten.length - MAX_ADVIEZEN} openstaande diensten — zie Openstaande diensten in het portaal.`);
        }
        dekkingTekst = `\n\nOpenstaande diensten (komende 7 dagen):\n${regels.map((r) => `• ${r}`).join("\n")}`;
        dekkingHtml = `<p><strong>Openstaande diensten (komende 7 dagen)</strong></p><ul>${regels.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`;
        // Push naar planners/admins — 1×/dag en alleen als er echt iets
        // openstaat (geen ruis bij een gedekte week, zelfde principe als
        // isDigestRuis). Mail blijft het volledige overzicht.
        const alleVoorPush = await getUsersData();
        const planners = (alleVoorPush as any[])
          .filter(isActieveStaf)
          .map((u) => String(u.id));
        if (planners.length > 0) {
          await sendPushToUsers(planners, {
            title: `${gaten.length} openstaande dienst${gaten.length === 1 ? "" : "en"} komende 7 dagen`,
            body: regels[0].slice(0, 140),
            url: viewUrl("dekking"),
          });
        }
        // Zelfde signaal ook naar de gekoppelde Telegram-chat, mét
        // kandidaten-knoppen per gat — push bereikt bijna niemand, Telegram
        // wél (keuze Jarno 21-08). Best-effort, net als de rest.
        if (telegramGeconfigureerd()) {
          const { tekst: tgTekst, knoppen } = formatGaten(dagen);
          await stuurTelegram(tgTekst, { knoppen });
        }
      }
    } catch (err: any) {
      console.error("[error-digest] openstaande-diensten-sectie mislukt:", err?.message ?? err);
    }

    // Bewust GEEN drempel meer (verzoek Jarno, 02-08): elke dag een overzicht,
    // ook bij nul meldingen. Een mail die alleen bij problemen komt, laat je
    // je afvragen of hij niet gewoon niet verstuurd is. ERROR_DIGEST_MIN_COUNT
    // blijft bestaan voor wie hem toch wil gebruiken; standaard 0 = altijd.
    if (minCount > 0 && errors.length < minCount) {
      await logCronHeartbeat("error-digest", `Onder de drempel (${errors.length} meldingen${filtered ? ` + ${filtered} genegeerd als ruis` : ""} in ${intervalMin} min).`);
      return res.json({ success: true, count: errors.length, ignored: filtered, alerted: false });
    }

    if (!mailVandaag) {
      await logCronHeartbeat("error-digest", `Geen mail vandaag (weekoverzicht op weekdag ${weekdag}); ${errors.length} meldingen in de wachtrij`);
      return res.json({ success: true, count: errors.length, ignored: filtered, alerted: false, reason: "weekoverzicht" });
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

    const windowLabel = intervalMin % 1440 === 0 && intervalMin > 1440
      ? `${intervalMin / 1440} dagen`
      : intervalMin % 60 === 0 ? `${intervalMin / 60} uur` : `${intervalMin} min`;
    const overzichtNaam = weekdag === "elke" ? "dagoverzicht" : "weekoverzicht";

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
    const subject = `VHB Portaal · ${overzichtNaam} — ${impact}`;
    const inleiding = errors.length === 0
      ? `In de afgelopen ${windowLabel} zijn er geen meldingen binnengekomen.`
      : `In de afgelopen ${windowLabel}: ${errors.length} melding${errors.length === 1 ? "" : "en"} van ${gebruikers.size} ${gebruikers.size === 1 ? "toestel" : "toestellen"} (${sorted.length} unieke soorten).`;
    const staart = filtered > 0
      ? `\n\n${filtered} melding${filtered === 1 ? "" : "en"} niet meegeteld (verlopen sessies en laadfouten vlak na een uitrol — die vangt de app zelf op).`
      : "";
    const text = `${inleiding}${errors.length === 0 ? "" : `\n\n${topLines}${moreLine}`}${staart}${vervalTekst}${dekkingTekst}\n\nBekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.`;
    // g.source/message/lastUrl zijn door de client aangeleverd — escapen,
    // anders is de digest-mail een HTML-injectiekanaal richting de admins.
    // De symbolicatie-uitkomst komt uit de sourcemap (indirect ook input) —
    // dus óók escapen.
    const html = `<p>${escapeHtml(inleiding)}</p>${errors.length === 0 ? "" : `<ul>${sorted.slice(0, 15).map((g) => `<li><strong>${g.count}×</strong> [${escapeHtml(g.source)}] ${escapeHtml(g.message)}${originOf.has(g) ? ` → <code>${escapeHtml(originOf.get(g)!)}</code>` : ""}${g.lastUrl ? ` <em>(${escapeHtml(g.lastUrl)})</em>` : ""}</li>`).join("")}</ul>${sorted.length > 15 ? `<p>…en nog ${sorted.length - 15} andere soorten.</p>` : ""}`}${filtered > 0 ? `<p style="color:#6E767F">${filtered} melding${filtered === 1 ? "" : "en"} niet meegeteld (verlopen sessies en laadfouten vlak na een uitrol — die vangt de app zelf op).</p>` : ""}${vervalHtml}${dekkingHtml}<p>Bekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.</p>`;

    const result = await sendEmail({ to: recipients, subject, text, html, context: "error-digest" });
    console.log(`[error-digest] ${errors.length} fouten, mail naar ${recipients.length} ontvanger(s), mocked=${result.mocked}`);
    await logCronHeartbeat("error-digest", `${overzichtNaam[0].toUpperCase()}${overzichtNaam.slice(1)} verstuurd: ${impact}${filtered ? `, ${filtered} als ruis genegeerd` : ""} → ${recipients.length} ontvanger(s).`);
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
    // `_rev` per record over de rauwe rij (vóór het ondertekenen, zelfde reden).
    const revs = data.map((d: any) => recordRevisionOf(d));
    res.json((await withSignedDiversionUrls(data)).map((d: any, i: number) => withRecordRevision(d, revs[i])));
  } catch (err) {
    console.error("Error reading diversions data:", err);
    res.status(500).json({ error: "Gegevens laden is mislukt." });
  }
});

app.post("/api/diversions", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      // Gedeeld contract (shared/schemas/diversion.ts): 400 met veldfouten per rij.
      if (!valideerLijst(res, diversionLijstSchema, newData, (d: any) => d?.title)) return;
      const previousDiversions = await getDiversionsData();
      if (revisionConflict(req, previousDiversions)) return revisionConflictResponse(res, "De omleidingen");
      const diversionsRemoved = detectMassDelete(previousDiversions, newData);
      if (diversionsRemoved !== null) return massDeleteResponse(res, diversionsRemoved, previousDiversions.length, "omleidingen");
      await verwerkDiversionsOpslag(req as AuthenticatedRequest, previousDiversions, newData);

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

// --- Omleidingen per record ---
// Veldvalidatie (titel, datums, einddatum ≥ startdatum) zit in het gedeelde
// contract: diversionBodySchema via valideerRecord → 400 met veldfouten.
const diversionResponseRecord = async (id: string) => {
  const raw = (await getDiversionsData()).find((d: any) => String(d.id) === id);
  if (!raw) return null;
  const [signed] = await withSignedDiversionUrls([raw]);
  return withRecordRevision(signed, recordRevisionOf(raw));
};

app.post("/api/diversions/one", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body;
    if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één omleiding verwacht." });
    if (!valideerRecord(res, diversionBodySchema, body)) return;
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : newRecordId();
    const previousDiversions = await getDiversionsData();
    if (previousDiversions.some((d: any) => String(d.id) === id)) {
      return res.status(409).json({ error: "Er bestaat al een omleiding met dit id.", conflict: "exists" });
    }
    await verwerkDiversionsOpslag(req, previousDiversions, [...previousDiversions, { ...body, id }], { samenvatting: false });
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
    res.status(201).json({ success: true, diversion: await diversionResponseRecord(id) });
  } catch (err: any) {
    console.error("Omleiding toevoegen is mislukt.", err?.message || err);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

app.put("/api/diversions/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body;
    if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één omleiding verwacht." });
    if (!valideerRecord(res, diversionBodySchema, body)) return;
    const rev = requestedRecordRevision(req);
    if (!rev) return recordRevisionMissingResponse(res);
    const previousDiversions = await getDiversionsData();
    const current = previousDiversions.find((d: any) => String(d.id) === id);
    if (!current) return res.status(404).json({ error: "Omleiding niet gevonden — mogelijk intussen verwijderd." });
    if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze omleiding", withRecordRevision(current, recordRevisionOf(current)));
    const newData = previousDiversions.map((d: any) => (String(d.id) === id ? { ...body, id } : d));
    await verwerkDiversionsOpslag(req, previousDiversions, newData, { samenvatting: false });
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
    res.json({ success: true, diversion: await diversionResponseRecord(id) });
  } catch (err: any) {
    console.error("Omleiding opslaan is mislukt.", err?.message || err);
    res.status(500).json({ error: "Opslaan is mislukt." });
  }
});

app.delete("/api/diversions/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    const rev = requestedRecordRevision(req);
    if (!rev) return recordRevisionMissingResponse(res);
    const previousDiversions = await getDiversionsData();
    const current = previousDiversions.find((d: any) => String(d.id) === id);
    if (!current) return res.status(404).json({ error: "Omleiding niet gevonden — mogelijk al verwijderd." });
    if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze omleiding", withRecordRevision(current, recordRevisionOf(current)));
    await verwerkDiversionsOpslag(req, previousDiversions, previousDiversions.filter((d: any) => String(d.id) !== id), { samenvatting: false });
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Omleiding verwijderen is mislukt.", err?.message || err);
    res.status(500).json({ error: "Verwijderen is mislukt." });
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
    // Strak formaat op het id: het wordt rechtstreeks de storage-key
    // (`${id}.pdf`), dus zonder deze check kon een planner met `../iets` naar
    // een afwijkende sleutel schrijven of een bestaand object overschrijven
    // (path-traversal in de diversions-bucket).
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: "Ongeldig diversion-id." });
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
// Auth: planner/admin-token, of Bearer ROSTERING_EXPORT_SECRET zodat de
// solver headless kan ophalen zonder gebruikersaccount (CRON_SECRET werkt
// alleen nog als overgang zolang het eigen secret niet gezet is — zie
// isRosteringExportAuthorized).
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
  if (isRosteringExportAuthorized(req)) return handle();
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
    res.json(data.map((u: any) => withRecordRevision(u, recordRevisionOf(u))));
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
    // Gedeeld contract (shared/schemas/update.ts): 400 met veldfouten per rij.
    if (!valideerLijst(res, updateLijstSchema, newData, (u: any) => u?.title)) return;
    const previousUpdates = await getUpdatesData();
    if (revisionConflict(req, previousUpdates)) return revisionConflictResponse(res, "De updates");
    const updatesRemoved = detectMassDelete(previousUpdates, newData);
    if (updatesRemoved !== null) return massDeleteResponse(res, updatesRemoved, previousUpdates.length, "updates");
    await verwerkUpdatesOpslag(req as AuthenticatedRequest, previousUpdates, newData, { pushUrl: viewUrl("updates") });

    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Updates opslaan is mislukt.", err);
    res.status(500).json({ error: "Updates opslaan is mislukt." });
  }
});

// --- Updates per record ---
// Veldvalidatie (titel, inhoud, datum) zit in het gedeelde contract:
// updateBodySchema via valideerRecord → 400 met veldfouten.
const updateResponseRecord = async (id: string) => {
  const u = (await getUpdatesData()).find((x: any) => String(x.id) === id);
  return u ? withRecordRevision(u, recordRevisionOf(u)) : null;
};

app.post("/api/updates/one", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body;
    if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één update verwacht." });
    if (!valideerRecord(res, updateBodySchema, body)) return;
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : newRecordId();
    const previousUpdates = await getUpdatesData();
    if (previousUpdates.some((u: any) => String(u.id) === id)) {
      return res.status(409).json({ error: "Er bestaat al een update met dit id.", conflict: "exists" });
    }
    // Nieuwste bovenaan, zoals de UI de lijst opbouwt.
    await verwerkUpdatesOpslag(req, previousUpdates, [{ ...body, id }, ...previousUpdates], { samenvatting: false, pushUrl: viewUrl("updates") });
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
    res.status(201).json({ success: true, update: await updateResponseRecord(id) });
  } catch (err: any) {
    console.error("Update toevoegen is mislukt.", err?.message || err);
    res.status(500).json({ error: "Updates opslaan is mislukt." });
  }
});

app.put("/api/updates/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body;
    if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één update verwacht." });
    if (!valideerRecord(res, updateBodySchema, body)) return;
    const rev = requestedRecordRevision(req);
    if (!rev) return recordRevisionMissingResponse(res);
    const previousUpdates = await getUpdatesData();
    const current = previousUpdates.find((u: any) => String(u.id) === id);
    if (!current) return res.status(404).json({ error: "Update niet gevonden — mogelijk intussen verwijderd." });
    if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze update", withRecordRevision(current, recordRevisionOf(current)));
    const newData = previousUpdates.map((u: any) => (String(u.id) === id ? { ...body, id } : u));
    await verwerkUpdatesOpslag(req, previousUpdates, newData, { samenvatting: false, pushUrl: viewUrl("updates") });
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
    res.json({ success: true, update: await updateResponseRecord(id) });
  } catch (err: any) {
    console.error("Update opslaan is mislukt.", err?.message || err);
    res.status(500).json({ error: "Updates opslaan is mislukt." });
  }
});

app.delete("/api/updates/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id);
    const rev = requestedRecordRevision(req);
    if (!rev) return recordRevisionMissingResponse(res);
    const previousUpdates = await getUpdatesData();
    const current = previousUpdates.find((u: any) => String(u.id) === id);
    if (!current) return res.status(404).json({ error: "Update niet gevonden — mogelijk al verwijderd." });
    if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze update", withRecordRevision(current, recordRevisionOf(current)));
    await verwerkUpdatesOpslag(req, previousUpdates, previousUpdates.filter((u: any) => String(u.id) !== id), { samenvatting: false, pushUrl: viewUrl("updates") });
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
    res.json({ success: true });
  } catch (err: any) {
    console.error("Update verwijderen is mislukt.", err?.message || err);
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

/** Afwezigheids-check voor een dienstruil, in béíde richtingen: de collega
 *  moet er zijn op de dienstdag die hij overneemt, en bij een 1-op-1 ruil de
 *  aanvrager op de terugruil-dag. Wordt gebruikt bij het indienen én bij het
 *  goedkeuren — tussen die twee momenten kan iemand ziek gemeld zijn, en de
 *  check dekte voorheen alleen het indienen (en alleen de collega). Geeft een
 *  foutzin of null. */
const AFWEZIG_LABEL: Record<string, string> = { ziekte: "ziek gemeld", betaald_verlof: "met verlof", klein_verlet: "afwezig (klein verlet)" };
const ruilAfwezigheidsFout = async (swap: {
  requesterId?: unknown; targetDriverId?: unknown; swapType?: unknown;
  shiftDate?: unknown; returnDate?: unknown; returnCode?: unknown;
}): Promise<string | null> => {
  const targetId = String(swap.targetDriverId ?? "").trim();
  const requesterId = String(swap.requesterId ?? "").trim();
  const dienstDag = String(swap.shiftDate ?? "").trim();
  const terugDag = String(swap.returnDate ?? "").trim();
  const terugCode = String(swap.returnCode ?? "").trim();
  const checks: Array<{ userId: string; date: string; wie: "collega" | "aanvrager" }> = [];
  if (targetId && dienstDag) checks.push({ userId: targetId, date: dienstDag, wie: "collega" });
  // Bij een overname of een 'vrij'-tegenprestatie rijdt de aanvrager niets terug.
  if (normalizeSwapType(swap.swapType) !== "overname" && requesterId && terugDag && terugCode && terugCode.toLowerCase() !== "vrij") {
    checks.push({ userId: requesterId, date: terugDag, wie: "aanvrager" });
  }
  if (checks.length === 0) return null;
  const vroegste = checks.map((c) => c.date).sort()[0];
  const [leave, users] = await Promise.all([getLeaveData({ endOnOrAfter: vroegste }), getUsersData()]);
  for (const c of checks) {
    const afwezig = afwezigOp(leave as any[], c.userId, c.date);
    if (afwezig) {
      const naam = users.find((u: any) => String(u.id) === c.userId)?.name ?? (c.wie === "collega" ? "De collega" : "De aanvrager");
      return `${naam} is ${AFWEZIG_LABEL[afwezig.type] ?? "afwezig gemeld"} op ${c.date} — deze ruil kan niet doorgaan.`;
    }
  }
  return null;
};

/** Dubbele inplanning bij het goedkeuren van een ruil: de collega mag op de
 *  dienstdag niet al een ándere dienst hebben. De overname-voorwaarde werd tot
 *  nu alleen bij het indienen getoetst (isTakeoverCode op de matrix); tussen
 *  accepteren en goedkeuren kan de collega intussen een dienst gekregen hebben
 *  — bijvoorbeeld via de handmatige admin-wissel, die zélf wél op conflicten
 *  controleert. Dan leverde de goedkeuring stil een dubbel ingeplande dag op.
 *
 *  Twee rijen tellen bewust NIET mee: de terugruil-dienst bij een 1-op-1 ruil
 *  op dezelfde dag (die verhuist in dezelfde beweging naar de aanvrager) en de
 *  aangeboden dienst zelf (al doorgevoerd → herhaling blijft idempotent). */
const dubbeleInplanningFout = async (swap: {
  targetDriverId?: unknown; shiftDate?: unknown; shiftLine?: unknown;
  returnDate?: unknown; returnCode?: unknown; swapType?: unknown;
}): Promise<string | null> => {
  const targetId = String(swap.targetDriverId ?? "").trim();
  const dienstDag = String(swap.shiftDate ?? "").trim();
  // Legacy-ruil zonder dienst-info: niets te controleren (de doorvoer slaat
  // die sowieso over, met een waarschuwing in de log).
  if (!targetId || !ISO_DAY_RE.test(dienstDag)) return null;
  const terugCode = normalizeSwapType(swap.swapType) === "overname" ? "" : String(swap.returnCode ?? "").trim();
  const terugDag = String(swap.returnDate ?? "").trim();
  const aangeboden = toLookupToken(String(swap.shiftLine ?? ""));
  const rijen = await getShiftsOnDate(dienstDag);
  const bezet = rijen.filter((r) => {
    if (String(r.driverId) !== targetId) return false;
    const lijnToken = toLookupToken(r.line);
    if (aangeboden && lijnToken === aangeboden) return false;
    if (terugCode && terugDag === dienstDag && lijnToken === toLookupToken(terugCode)) return false;
    return true;
  });
  if (bezet.length === 0) return null;
  const naam = (await getUsersData()).find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
  return `${naam} rijdt op ${dienstDag} al dienst ${bezet[0].line} — deze ruil zou een dubbele inplanning geven. Zet die dienst eerst weg.`;
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
  // Ook 'completed': een voltooide ruil is gereden zoals gewisseld (zelfde
  // regel als de maandplanning-weergave). Zonder 'completed' draaide een
  // heropbouw die wissel stil terug en spraken rooster en maandplanning
  // elkaar tegen.
  const approved = (await getSwapsData())
    .filter((sw) => sw.status === "approved" || sw.status === "completed")
    .sort((a, b) => String(a.decidedAt ?? "").localeCompare(String(b.decidedAt ?? "")));
  // Alleen ruilen binnen het geïmporteerde bereik meetellen. Zonder deze filter
  // telde élke historische ruil buiten het bereik als "niet toepasbaar", zodat
  // de import-log een almaar groeiend "(x niet toepasbaar)" meldde terwijl er
  // niets mis was — en een échte mismatch (dienst intussen handmatig verlegd)
  // daarin verdronk.
  // Beide benen tellen (swapRaaktBereik): een maandoverschrijdende 1-op-1-
  // ruil met het terugbeen ín de periode moest anders stil terug.
  const relevant = bereik?.van && bereik?.tot
    ? approved.filter((sw) => swapRaaktBereik(sw, { van: bereik.van!, tot: bereik.tot! }))
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
  // Dedupe per (chauffeur, dag, dienst): een gesplitste dienst is meerdere
  // planning-rijen en telde als 2-3 "conflicten" voor wat één dienst is —
  // zelfde segmenten-zijn-geen-diensten-les als #389 (gevonden door de
  // golden import-keten-test, 01-09).
  const gezien = new Set<string>();
  for (const shift of shifts) {
    const sleutel = `${shift.driverId}|${shift.date}|${toLookupToken(shift.line)}`;
    if (gezien.has(sleutel)) continue;
    const overlap = approvedLeave.find((l) =>
      String(l.userId) === String(shift.driverId) &&
      l.startDate <= shift.date &&
      l.endDate >= shift.date,
    );
    if (overlap) {
      gezien.add(sleutel);
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
            // decidedAt is server-gezaghebbend: 'accepted' is een tussenstap
            // (geen beslismoment, behoud wat er stond), 'rejected' krijgt het
            // servertijdstip. Nooit de client-waarde vertrouwen — reapplyApproved
            // Swaps sorteert kettingen op decidedAt.
            writes.push({
              ...next,
              swapType: normalizeSwapType(prev.swapType),
              decidedAt: next.status === "rejected" ? new Date().toISOString() : prev.decidedAt,
            });
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
      for (const [id, prev] of previousById) {
        if (newById.has(String(id))) continue;
        // Doorgevoerde ruilen (approved/completed) zitten in de heropbouw-
        // replay: verwijderen draait níéts terug in de planning, maar laat de
        // wissel bij de eerstvolgende Excel-import wél stil verdwijnen — het
        // rooster springt dan onaangekondigd terug. Alleen een admin mag dat
        // (bewust); een planner draait een ruil terug via status 'cancelled',
        // dan wordt de planning netjes mee teruggedraaid.
        if (req.appUser?.role !== "admin" && (prev.status === "approved" || prev.status === "completed")) {
          return res.status(403).json({ error: "Een doorgevoerde ruil kan niet verwijderd worden. Annuleer hem in plaats daarvan — dan wordt de planning mee teruggedraaid." });
        }
        swapIdsToDelete.push(String(id));
      }
    }

    // Exclusiviteit bij goedkeuren: de aanvrager moet de dienst op dat moment
    // nog écht hebben (zie staleApprovalError). Over recordsToWrite (niet
    // newData): een stale echo die niet weggeschreven wordt mag geen vals 409
    // op een ongerelateerde nieuwe aanvraag veroorzaken.
    // Halve doorvoer herkennen (zie beslisRuilIntern): staat de wissel al in
    // de planning, dan slaan de checks én de doorvoer over en wordt alleen
    // de status alsnog opgeslagen.
    const alDoorgevoerdIds = new Set<string>();
    for (const next of recordsToWrite) {
      const prev = previousById.get(String(next.id));
      const becomesApproved = next.status === "approved" && (!prev || prev.status !== "approved");
      if (!becomesApproved) continue;
      if (prev && (await swapToestandInPlanning(prev)) === "doorgevoerd") {
        alDoorgevoerdIds.add(String(next.id));
        continue;
      }
      const stale = await staleApprovalError(next, previousSwaps);
      if (stale) return res.status(409).json({ error: stale });
      // Tussen indienen en goedkeuren kan iemand ziek gemeld zijn — bij het
      // goedkeuren opnieuw toetsen, op de ópgeslagen voorwaarden.
      const afwFout = await ruilAfwezigheidsFout(prev ?? next);
      if (afwFout) return res.status(409).json({ error: afwFout });
      // …en de collega kan intussen een dienst gekregen hebben.
      const dubbelFout = await dubbeleInplanningFout(prev ?? next);
      if (dubbelFout) return res.status(409).json({ error: dubbelFout });
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
          // Alleen actieve chauffeurs in de naam-index: een gepauzeerd oud
          // account met dezelfde naam liet de sleutel wegvallen, waardoor de
          // overname met "staat niets in de planning" werd geweigerd terwijl
          // /api/availability de collega wél aanbood (controle-ronde 27-08,
          // bevinding 23; zelfde regel als /api/planning-presence).
          const actieveChauffeurs = usersForTakeover.filter((u: any) => u?.role === "chauffeur" && u?.isActive !== false);
          const code = matrixCodesForDate(matrixRows, actieveChauffeurs, date).get(targetId);
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

    // Afwezigheids-check voor élke nieuwe ruil (1-op-1 én overname): de
    // verlofmodule is sinds de ziek-melden-knop een eigen bron naast de
    // matrix — wie dáár ziek of met verlof gemeld staat, staat in de Excel
    // vaak nog gewoon op 'vrij'. In beide richtingen (collega op de dienstdag,
    // aanvrager op de terugruil-dag) — zie ruilAfwezigheidsFout.
    {
      const nieuweRuilen = recordsToWrite.filter((n: any) => !previousById.has(String(n.id)));
      for (const next of nieuweRuilen) {
        // Ontbrekende shift/target vangen de bestaande checks hierboven al af.
        const offeredShift = await getShiftById(String(next.shiftId ?? ""));
        const fout = await ruilAfwezigheidsFout({ ...next, shiftDate: offeredShift?.date });
        if (fout) return res.status(409).json({ error: fout });
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
            // Ook reason en createdAt liggen vast: de reden draagt bij een
            // handmatige admin-wissel de attributie ("Handmatige wissel door
            // …") — herschrijfbaar laten zou een planner de zichtbare
            // uitvoerder laten wegpoetsen. Het chauffeur-pad bevroor deze
            // velden al (immutable-lijst in de accepteer-tak).
            reason: prev.reason,
            createdAt: prev.createdAt,
          }
        : {};
      // decidedAt server-gezaghebbend (spiegel van de PATCH-route): een reeds
      // besliste ruil behoudt zijn oorspronkelijke tijdstip (niet herschrijfbaar
      // via een latere array-save), een verse beslissing krijgt het servertijd-
      // stip, en 'accepted'/ongewijzigd 'pending' hebben geen beslismoment.
      const wasBeslist = prev && String(prev.status) !== "pending" && String(prev.status) !== "accepted";
      const wordtBeslist = String(n.status) !== "pending" && String(n.status) !== "accepted";
      const decidedAtDef = wasBeslist
        ? prev!.decidedAt
        : (wordtBeslist ? new Date().toISOString() : (prev?.decidedAt ?? undefined));
      finalRecords.push({
        ...n,
        ...bevroren,
        swapType: normalizeSwapType(prev ? prev.swapType : n.swapType),
        shiftDate,
        shiftLine,
        decidedAt: decidedAtDef,
        // Gezien-bevestiging is nooit client-schrijfbaar via deze route: de
        // opgeslagen waarde wint altijd (nieuw record = nog niet bevestigd).
        targetSeenAt: prev?.targetSeenAt,
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
        if (alDoorgevoerdIds.has(String(next.id))) {
          carryLogById.set(String(next.id), "wissel stond al in de planning (herstel na een eerdere halve doorvoer)");
          continue;
        }
        const r = await applySwapToPlanning(next);
        // Concurrency-vangnet: 0 verplaatste rijen mét dienst-info betekent
        // dat de planning tussen de hercheck en de doorvoer nog wijzigde
        // (bv. een gelijktijdige admin-wissel). Dan NIET half goedkeuren met
        // enkel een logwaarschuwing — weigeren, zodat de planner met verse
        // data opnieuw beoordeelt. r === null (legacy zonder dienst-info)
        // houdt het oude waarschuw-gedrag.
        if (r && r.offeredMoved === 0) {
          return res.status(409).json({ error: "De planning is intussen gewijzigd — de dienst staat niet meer op naam van de aanvrager. Vernieuw de pagina en beoordeel opnieuw." });
        }
        carryLogById.set(String(next.id), describeSwapCarry(next, r, "doorgevoerd"));
      } else if (next.status === "cancelled" || next.status === "rejected") {
        // Terugdraaien vanuit 'approved', en bij afwijzen ook een halve
        // doorvoer (planning gewisseld zonder opgeslagen status).
        const terug = prev.status === "approved"
          || (next.status === "rejected" && (await swapToestandInPlanning(prev)) === "doorgevoerd");
        if (terug) {
          const r = await revertSwapFromPlanning(next);
          carryLogById.set(String(next.id), describeSwapCarry(next, r, "teruggedraaid"));
        }
      }
    }

    await saveSwapsData(finalRecords, swapIdsToDelete);

    // Activity log: detecteer state-overgangen en nieuwe aanvragen. Over
    // recordsToWrite zodat een niet-weggeschreven echo geen spookmelding geeft.
    const usersForLog = await getUsersData();
    const userName = (id: string) => usersForLog.find((u) => String(u.id) === String(id))?.name || `Onbekende gebruiker (${id})`;

    // Verwijderde ruilen laten anders geen enkel spoor na: een intrekking door
    // de aanvrager is legitiem, maar een staflid dat een geaccepteerde aanvraag
    // stil weggooit hoort zichtbaar te zijn (verlof logt dit al wél).
    for (const id of swapIdsToDelete) {
      const weg = previousById.get(String(id));
      if (!weg) continue;
      await logActivity(
        req,
        "swaps",
        "Dienstruil verwijderd",
        `${userName(String(weg.requesterId))} — dienstruil verwijderd (status ${weg.status}).`,
        { type: "swap", id: String(id) },
      );
    }
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
            url: viewUrl("ruil-verzoeken"),
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
            url: viewUrl("ruil-verzoeken"),
          });
          // Geaccepteerd = er wacht een validatie op de planner — die kreeg
          // hier tot nu toe geen seintje van. Beslissers pushen (behalve de
          // actor zelf, als die toevallig planner/admin is).
          if (next.status === "accepted") {
            const beslissers = usersForLog
              .filter((u) => isActieveStaf(u) && String(u.id) !== actorId)
              .map((u) => String(u.id));
            await sendPushToUsers(beslissers, {
              title: "Dienstruil wacht op validatie",
              body: `${userName(String(prev.targetDriverId ?? ""))} accepteerde de ruil van ${userName(next.requesterId)} — rij- en rusttijden checken.`,
              url: viewUrl("ruil-verzoeken"),
            });
            await meldRuilTerValidatieTelegram({
              id: String(next.id),
              omschrijving: `${userName(String(prev.targetDriverId ?? ""))} accepteerde de ruil van ${userName(next.requesterId)}${next.shiftLine ? ` — dienst ${next.shiftLine} op ${next.shiftDate ? DAG_KORT(String(next.shiftDate)) : "?"}` : ""}.`,
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
/** De ruil-beslissing zelf (rolregels, state-machine, planning-doorvoer,
 *  opslag, log en pushes) — gedeeld door PATCH /api/swaps/:id en de
 *  Telegram-goedkeurknoppen. Gedrag identiek aan de oude route-body. */
async function beslisRuilIntern(opts: { id: string; status: string; ifStatus: string | null; actor: BeslisActor }): Promise<
  { fout: { status: number; error: string; currentStatus?: string } } | { swap: any; melding: string }
> {
    const { id, status, ifStatus, actor } = opts;
    const all = await getSwapsData();
    const current = all.find((s) => String(s.id) === id);
    if (!current) {
      return { fout: { status: 404, error: "Deze dienstruil bestaat niet (meer) — mogelijk net ingetrokken." } };
    }
    if (ifStatus && String(current.status) !== ifStatus) {
      return { fout: { status: 409, error: `Deze ruil is intussen al '${current.status}' — de lijst is ververst.`, currentStatus: String(current.status) } };
    }

    const role = actor.role;
    const selfId = String(actor.id);
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
        return { fout: { status: 403, error: "Niet toegestaan: je mag een aan jou gerichte, openstaande ruil accepteren of weigeren, of je eigen openstaande aanvraag intrekken." } };
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
        return { fout: { status: 403, error: "Niet toegestaan: alleen de aangezochte collega kan een ruil accepteren." } };
      }
      const allowed = ["accepted", "approved", "rejected", "cancelled", "completed"];
      if (!allowed.includes(status)) {
        return { fout: { status: 400, error: "Ongeldige status." } };
      }
      // Force-approve vanuit pending blijft admin-only (zelfde beleid als POST).
      if (role !== "admin" && current.status === "pending" && status === "approved") {
        return { fout: { status: 403, error: "Niet toegestaan: een ruil zonder bevestiging van de collega kan alleen een admin rechtstreeks goedkeuren." } };
      }
    }

    // State-machine: uit een afgehandelde status (geweigerd/geannuleerd/
    // voltooid) is geen overgang meer toegestaan (rejected → approved was zo
    // mogelijk).
    if (status !== current.status && TERMINAL_SWAP_STATES.has(String(current.status))) {
      return { fout: { status: 409, error: "Deze dienstruil is al afgehandeld en kan niet meer van status veranderen." } };
    }

    // Halve doorvoer (planning al gewisseld, status nooit opgeslagen — DB-hik
    // tussen de twee writes): de checks hieronder zagen de dienst dan bij de
    // collega en gaven 409 op élke nieuwe poging, terwijl afwijzen niets
    // terugdraaide (controle-ronde 27-08, bevinding 8). Eén blik op de
    // planning maakt goedkeuren idempotent en afwijzen herstellend. Alleen
    // bij goedkeuren/afwijzen (stafbeslissingen); een chauffeur die zijn
    // eigen aanvraag intrekt raakt de planning niet.
    const alDoorgevoerd = (status === "approved" || status === "rejected") && current.status !== "approved"
      ? (await swapToestandInPlanning(current)) === "doorgevoerd"
      : false;

    // Exclusiviteit: de aanvrager moet de dienst nog hebben (zie ook
    // staleApprovalError bij POST /api/swaps).
    if (status === "approved" && current.status !== "approved" && !alDoorgevoerd) {
      const stale = await staleApprovalError(current, all);
      if (stale) return { fout: { status: 409, error: stale } };
      // Zelfde afwezigheids-hercheck als de array-route: wie ziek gemeld is
      // sinds het indienen, mag de dienst niet alsnog toegeschoven krijgen.
      const afwFout = await ruilAfwezigheidsFout(current);
      if (afwFout) return { fout: { status: 409, error: afwFout } };
      const dubbelFout = await dubbeleInplanningFout(current);
      if (dubbelFout) return { fout: { status: 409, error: dubbelFout } };
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
      if (alDoorgevoerd) {
        carry = "wissel stond al in de planning (herstel na een eerdere halve doorvoer)";
      } else {
        const r = await applySwapToPlanning(current);
        // Zelfde concurrency-vangnet als de array-route: 0 verplaatste rijen
        // mét dienst-info = planning wijzigde tussen check en doorvoer → 409
        // i.p.v. half goedkeuren met een logwaarschuwing.
        if (r && r.offeredMoved === 0) {
          return { fout: { status: 409, error: "De planning is intussen gewijzigd — de dienst staat niet meer op naam van de aanvrager. Vernieuw de pagina en beoordeel opnieuw." } };
        }
        carry = describeSwapCarry(current, r, "doorgevoerd");
      }
    } else if ((current.status === "approved" || alDoorgevoerd) && (status === "cancelled" || status === "rejected")) {
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
    await logActivity(actorReq(actor), "swaps", action, `${userName(String(current.requesterId))} — dienstruil (${current.status} → ${status}).${carry ? ` ${carry}` : ""}`, { type: "swap", id });

    const betrokkenen = [String(current.requesterId), String(current.targetDriverId ?? "")]
      .filter((uid) => uid && uid !== selfId);
    await sendPushToUsers(betrokkenen, {
      title: action,
      body: status === "accepted"
        ? `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil — wacht op goedkeuring van de planner.`
        : `Dienstruil van ${userName(String(current.requesterId))}: ${current.status} → ${status}.`,
      url: viewUrl("ruil-verzoeken"),
    });
    // Geaccepteerd = validatie nodig → beslissers een seintje (zie array-route)
    // en dezelfde melding mét goedkeurknoppen naar de Telegram-chat.
    if (status === "accepted") {
      const beslissers = usersForLog
        .filter((u) => isActieveStaf(u) && String(u.id) !== selfId)
        .map((u) => String(u.id));
      await sendPushToUsers(beslissers, {
        title: "Dienstruil wacht op validatie",
        body: `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil van ${userName(String(current.requesterId))} — rij- en rusttijden checken.`,
        url: viewUrl("ruil-verzoeken"),
      });
      await meldRuilTerValidatieTelegram({
        id: String(current.id),
        omschrijving: `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil van ${userName(String(current.requesterId))}${current.shiftLine ? ` — dienst ${current.shiftLine} op ${current.shiftDate ? DAG_KORT(String(current.shiftDate)) : "?"}` : ""}${current.returnCode && String(current.returnCode).toLowerCase() !== "vrij" ? `, tegenprestatie ${current.returnCode} op ${current.returnDate ? DAG_KORT(String(current.returnDate)) : "?"}` : ""}.`,
      });
    }

    return { swap: updated, melding: `${action} — ${userName(String(current.requesterId))}${current.shiftLine ? ` · dienst ${current.shiftLine} op ${current.shiftDate ? DAG_KORT(String(current.shiftDate)) : "?"}` : ""}.` };
}

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
    const uit = await beslisRuilIntern({
      id,
      status,
      ifStatus,
      actor: { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "chauffeur" | "planner" | "admin" },
    });
    if ("fout" in uit) {
      return res.status(uit.fout.status).json({ error: uit.fout.error, ...(uit.fout.currentStatus ? { currentStatus: uit.fout.currentStatus } : {}) });
    }

    // Verse collectie-revisie meegeven zodat een volgende array-save van
    // dezelfde client geen vals 409 krijgt na deze delta-wijziging.
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getSwapsData()));
    res.json({ success: true, swap: uit.swap });
  } catch (err: any) {
    console.error("Beslissing opslaan is mislukt", err);
    res.status(500).json({ error: "Beslissing opslaan is mislukt" });
  }
});

// --- Handmatige dienstwissel door een admin ---------------------------------
//
// Voor uitzonderlijke situaties (ziekte, mondeling afgesproken ruil, andere
// correctie): een admin zet een ingeplande dienst rechtstreeks op naam van een
// andere chauffeur, zonder de aanvraag/acceptatie-flow. Bewust géén eigen
// tabel: de wissel wordt opgeslagen als direct goedgekeurde 'overname' in
// swaps — daardoor liften de heropbouw-replay (reapplyApprovedSwaps), de
// maandplanning-overlay en de ruil-historiek gratis mee en kan een volgende
// Excel-import de wissel niet stil terugdraaien.
app.post("/api/admin/shift-swap", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const date = String(req.body?.date ?? "").trim();
    const line = String(req.body?.line ?? "").trim();
    const fromDriverId = String(req.body?.fromDriverId ?? "").trim();
    const toDriverId = String(req.body?.toDriverId ?? "").trim();
    const reason = String(req.body?.reason ?? "").trim();

    if (!ISO_DAY_RE.test(date)) return res.status(400).json({ error: "Ongeldige datum (JJJJ-MM-DD verwacht)." });
    if (!line) return res.status(400).json({ error: "Geen dienstnummer meegegeven." });
    if (!fromDriverId || !toDriverId) return res.status(400).json({ error: "Kies de huidige én de nieuwe chauffeur." });
    if (fromDriverId === toDriverId) return res.status(400).json({ error: "De nieuwe chauffeur is dezelfde als de huidige — er valt niets te wisselen." });
    if (!reason) return res.status(400).json({ error: "Geef een reden op voor de wissel." });
    if (reason.length > 280) return res.status(400).json({ error: "De reden is te lang (maximaal 280 tekens)." });

    const users = await getUsersData();
    const fromUser = users.find((u) => String(u.id) === fromDriverId);
    const toUser = users.find((u) => String(u.id) === toDriverId);
    if (!fromUser) return res.status(400).json({ error: "De huidige chauffeur bestaat niet (meer)." });
    if (!toUser || toUser.isActive === false) return res.status(400).json({ error: "De gekozen chauffeur bestaat niet (meer) of is inactief." });

    // Eigendom: de dienst moet op dit moment écht op naam van de huidige
    // chauffeur staan (zelfde principe als staleApprovalError — tussen openen
    // van het scherm en bevestigen kan de planning gewijzigd zijn).
    const dayRows = await getShiftsOnDate(date);
    // Genormaliseerd vergelijken: de maandplanning-cel stuurt de rúwe
    // Excel-code mee ("R12"), planning.line bevat het canonieke
    // dienstnummer ("r12"). Exact vergelijken liet zulke diensten altijd
    // op 409 stranden.
    const lineToken = toLookupToken(line);
    const ownRows = dayRows.filter((r) => toLookupToken(r.line) === lineToken && String(r.driverId) === fromDriverId);
    if (ownRows.length === 0) {
      return res.status(409).json({ error: `Dienst ${line} op ${date} staat niet (meer) op naam van ${fromUser.name} — de planning is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.` });
    }
    // Vanaf hier de schrijfwijze uit de planning zelf: die gaat de swap in en
    // stuurt de doorvoer (movePlanningRows matcht exact op line).
    const dienstLine = String(ownRows[0].line);

    // Planningsconflict: de nieuwe chauffeur rijdt die dag al een dienst.
    const conflictRow = dayRows.find((r) => String(r.driverId) === toDriverId);
    if (conflictRow) {
      return res.status(409).json({ error: `${toUser.name} rijdt op ${date} al dienst ${conflictRow.line} — deze wissel zou een dubbele inplanning geven. Zet die dienst eerst weg of kies iemand anders.` });
    }

    // Afwezigheid: wie ziek of met verlof gemeld is, krijgt geen dienst
    // toegeschoven (zelfde check als bij het goedkeuren van een ruil).
    const afwFout = await ruilAfwezigheidsFout({ requesterId: fromDriverId, targetDriverId: toDriverId, swapType: "overname", shiftDate: date });
    if (afwFout) return res.status(409).json({ error: afwFout });

    // Een openstaande ruilaanvraag op dezelfde dienst zou door deze wissel
    // stale worden (en bij goedkeuring niets meer verplaatsen) — eerst
    // afhandelen. Beide kanten van een 1-op-1 ruil tellen: staat deze dienst
    // als TEGENPRESTATIE in een open ruil, dan verhuist bij goedkeuring wel de
    // aangeboden dienst maar niet de terugruil — de aanvrager levert dan in
    // zonder iets terug te krijgen, en de replay reproduceert die halve staat.
    const allSwaps = await getSwapsData();
    const zelfdeDienst = (d?: unknown, l?: unknown) =>
      String(d ?? "") === date && !!String(l ?? "").trim() && toLookupToken(String(l ?? "")) === lineToken;
    const openSwap = allSwaps.find((s) =>
      (s.status === "pending" || s.status === "accepted") &&
      (zelfdeDienst(s.shiftDate, s.shiftLine) ||
        zelfdeDienst(s.returnDate, s.returnCode) ||
        ownRows.some((r) => String(r.id) === String(s.shiftId))));
    if (openSwap) {
      return res.status(409).json({ error: "Voor deze dienst loopt nog een ruilaanvraag. Handel die eerst af (goedkeuren, afwijzen of laten intrekken) en probeer daarna opnieuw." });
    }

    const nu = new Date().toISOString();
    const swap = {
      id: crypto.randomUUID(),
      shiftId: String(ownRows[0].id),
      requesterId: fromDriverId,
      targetDriverId: toDriverId,
      status: "approved" as const,
      createdAt: nu,
      decidedAt: nu,
      swapType: "overname" as const,
      shiftDate: date,
      shiftLine: dienstLine,
      reason: `${HANDMATIGE_WISSEL_PREFIX}${req.appUser?.name ?? "admin"} — ${reason}`,
    };

    // Doorvoer VÓÓR het opslaan (zelfde volgorde en motivatie als bij het
    // goedkeuren van een ruil): mislukt de verplaatsing, dan bestaat er ook
    // geen swap-record dat de replay later alsnog zou toepassen.
    const carryResult = await applySwapToPlanning(swap);
    if (!carryResult || carryResult.offeredMoved === 0) {
      return res.status(409).json({ error: "De dienst kon niet verplaatst worden — de planning is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw." });
    }
    await saveSwapsData([swap], []);

    const carry = describeSwapCarry(swap, carryResult, "doorgevoerd");
    await logActivity(
      req,
      "swaps",
      "Dienst handmatig overgezet",
      `${fromUser.name} → ${toUser.name} — dienst ${dienstLine} op ${date}. Reden: ${reason}. ${carry}`,
      { type: "swap", id: swap.id },
    );

    await sendPushToUsers([fromDriverId, toDriverId], {
      title: "Planning aangepast",
      body: `Dienst ${dienstLine} op ${date} is overgezet van ${fromUser.name} naar ${toUser.name}. Reden: ${reason}.`,
      url: viewUrl("rooster"),
    });

    // Verse collectie-revisie zodat een volgende array-save van dezelfde
    // client geen vals 409 krijgt (zelfde patroon als PATCH /api/swaps/:id).
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getSwapsData()));
    res.json({ success: true, swap, carry });
  } catch (err) {
    console.error("Handmatige dienstwissel is mislukt.", err);
    res.status(500).json({ error: "Handmatige dienstwissel is mislukt." });
  }
});

// --- Gezien-bevestiging op een doorgevoerde wissel --------------------------
//
// Push bereikt vrijwel niemand; hiermee weet de planner of de nieuwe rijder
// de wijziging echt gezien heeft. Alleen de ontvanger zelf mag bevestigen,
// en alleen op een doorgevoerde wissel (approved/completed).
app.post("/api/swaps/:id/gezien", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const id = String(req.params.id ?? "");
    const swap = (await getSwapsData()).find((s) => String(s.id) === id);
    if (!swap) return res.status(404).json({ error: "Deze dienstruil bestaat niet (meer)." });
    if (String(swap.targetDriverId ?? "") !== String(req.appUser?.id)) {
      return res.status(403).json({ error: "Alleen de chauffeur die de dienst overneemt kan bevestigen." });
    }
    if (swap.status !== "approved" && swap.status !== "completed") {
      return res.status(409).json({ error: "Deze wissel is (nog) niet doorgevoerd — er valt niets te bevestigen." });
    }
    if (!swap.targetSeenAt) {
      const nu = new Date().toISOString();
      await markSwapTargetSeen(id, nu);
      await logActivity(
        req,
        "swaps",
        "Dienstwissel bevestigd",
        `${req.appUser?.name ?? "Chauffeur"} bevestigde de overgenomen dienst${swap.shiftLine ? ` ${swap.shiftLine}` : ""}${swap.shiftDate ? ` op ${swap.shiftDate}` : ""}.`,
        { type: "swap", id },
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Bevestigen van de dienstwissel is mislukt.", err);
    res.status(500).json({ error: "Bevestigen is mislukt." });
  }
});

// --- Onbemande dienst toewijzen (vanuit Dekking) ----------------------------
//
// Een gat in de dekking = een verwachte dienst die op die dag op níémand
// staat. De dienstwissel kan daar niets mee (die verplaatst een bestaande
// rij); tot nu kon zo'n gat alleen via een nieuwe Excel-upload gevuld worden.
// Deze route schrijft de toewijzing in de planning-matrix (de bron waaruit
// elke heropbouw genereert — zo overleeft ze "opnieuw opbouwen") én zet de
// dienstblokken direct in de planning. Een nieuwe Excel-import vervangt de
// matrix en dus ook deze toewijzing: bewust, de Excel is dan de waarheid en
// het gat verschijnt gewoon weer in de dekking.
/** Onbemande dienst toewijzen (matrix + planning + log + push) — gedeeld
 *  door POST /api/planning/assign-service en de Telegram-toewijzen-knop.
 *  Gedrag identiek aan de oude route-body. */
async function wijsDienstToeIntern(invoer: { date: unknown; serviceNumber: unknown; driverId: unknown }, actor: BeslisActor): Promise<
  { fout: { status: number; error: string } } | { rows: number; serviceNumber: string; driverName: string; date: string }
> {
    const date = String(invoer.date ?? "").trim();
    const serviceNumber = String(invoer.serviceNumber ?? "").trim();
    const driverId = String(invoer.driverId ?? "").trim();
    if (!ISO_DAY_RE.test(date)) return { fout: { status: 400, error: "Ongeldige datum (JJJJ-MM-DD verwacht)." } };
    if (!serviceNumber || !driverId) return { fout: { status: 400, error: "Kies de dienst én de chauffeur." } };

    const [users, services, matrixRows, dayRows] = await Promise.all([
      getUsersData(),
      getServicesData(),
      getPlanningMatrixRows(),
      getShiftsOnDate(date),
    ]);
    const driver = users.find((u) => String(u.id) === driverId);
    if (!driver || driver.isActive === false) return { fout: { status: 400, error: "De gekozen chauffeur bestaat niet (meer) of is inactief." } };

    const dienstToken = toLookupToken(serviceNumber);
    const service = (services as any[]).find((s) => toLookupToken(s.serviceNumber) === dienstToken);
    if (!service) return { fout: { status: 400, error: `Dienst ${serviceNumber} staat niet in het dienstoverzicht.` } };
    const segments = getServiceSegments(service);
    if (segments.length === 0) return { fout: { status: 400, error: `Dienst ${service.serviceNumber} heeft geen tijdsblokken in het dienstoverzicht — vul die eerst aan.` } };

    // De dienst moet écht onbemand zijn (tussen openen en klikken kan een
    // collega hem al ingevuld hebben) en de chauffeur mag die dag niets rijden.
    const alBemand = dayRows.find((r) => toLookupToken(r.line) === dienstToken);
    if (alBemand) {
      const naam = users.find((u) => String(u.id) === String(alBemand.driverId))?.name ?? "iemand";
      return { fout: { status: 409, error: `Dienst ${service.serviceNumber} is op ${date} intussen al ingevuld door ${naam} — vernieuw de pagina.` } };
    }
    const heeftAl = dayRows.find((r) => String(r.driverId) === driverId);
    if (heeftAl) return { fout: { status: 409, error: `${driver.name} rijdt op ${date} al dienst ${heeftAl.line} — dubbele inplanning kan niet.` } };
    const afwFout = await ruilAfwezigheidsFout({ requesterId: "", targetDriverId: driverId, swapType: "overname", shiftDate: date });
    if (afwFout) return { fout: { status: 409, error: afwFout } };

    // Matrix-rij van die dag: sleutel is de chauffeursnáám zoals de Excel die
    // schrijft — hergebruik een bestaande naamvariant van deze chauffeur als
    // die er is (accenten/volgorde), anders de naam uit gebruikersbeheer.
    const matrixRow = (matrixRows as any[]).find((r) => String(r.source_date) === date);
    if (!matrixRow) return { fout: { status: 409, error: `Er is geen geïmporteerde planning voor ${date} — importeer eerst de Excel.` } };
    const assignments: Record<string, string> = { ...(matrixRow.assignments ?? {}) };
    const eigenToken = toLookupToken(driver.name);
    const eigenSorted = sortedNameToken(driver.name);
    const bestaandeKey = Object.keys(assignments).find((k) => toLookupToken(k) === eigenToken || sortedNameToken(k) === eigenSorted);
    const huidigeCode = bestaandeKey ? String(assignments[bestaandeKey] ?? "").trim() : "";
    // Alleen een lege cel of een overneembare code (vrij/bv/tk/ta) mag
    // overschreven worden — zelfde regel als de overname bij dienstruil.
    if (huidigeCode && !isTakeoverCode(huidigeCode)) {
      return { fout: { status: 409, error: `${driver.name} staat op ${date} al op '${huidigeCode}' in de planning — die cel kan niet stil overschreven worden.` } };
    }
    assignments[bestaandeKey ?? driver.name] = String(service.serviceNumber);

    const nieuweRijen = segments.map((segment: any) => ({
      id: `${date}-${driver.id}-${service.serviceNumber}-${segment.segment}`,
      date,
      startTime: segment.startTime,
      endTime: segment.endTime,
      line: String(service.serviceNumber),
      busNumber: "",
      loopnr: segment.loopnr ?? "",
      driverId: String(driver.id),
    }));
    // Eerst de matrix (de bron), dan de planning-rijen. Faalt de tweede stap,
    // dan zet de eerstvolgende heropbouw de planning alsnog goed vanuit de
    // matrix — nooit andersom een rij zonder bron.
    await saveMatrixRowAssignments(String(matrixRow.id), assignments);
    await insertPlanningRows(nieuweRijen as any);

    await logActivity(
      actorReq(actor),
      "planning",
      "Dienst toegewezen",
      `Dienst ${service.serviceNumber} op ${date} toegewezen aan ${driver.name} (was onbemand). ${nieuweRijen.length} rij(en) toegevoegd; matrix bijgewerkt.`,
    );
    await sendPushToUsers([driverId], {
      title: "Dienst toegewezen",
      body: `Je rijdt dienst ${service.serviceNumber} op ${date}. Bekijk je rooster.`,
      url: viewUrl("rooster"),
    });
    return { rows: nieuweRijen.length, serviceNumber: String(service.serviceNumber), driverName: driver.name, date };
}

app.post("/api/planning/assign-service", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const uit = await wijsDienstToeIntern(
      { date: req.body?.date, serviceNumber: req.body?.serviceNumber, driverId: req.body?.driverId },
      { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "planner" | "admin" },
    );
    if ("fout" in uit) return res.status(uit.fout.status).json({ error: uit.fout.error });
    res.json({ success: true, rows: uit.rows });
  } catch (err) {
    console.error("Dienst toewijzen is mislukt.", err);
    res.status(500).json({ error: "Dienst toewijzen is mislukt." });
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
/** De ziekmelding-kern (validatie, dedupe, record, log, openvallende
 *  diensten, pushes en mails) — gedeeld door POST /api/leave/sick-report en
 *  het /ziekmeld-commando van de Telegram-bot. `stuurTelegramAlert` staat uit
 *  wanneer de bot zelf de afzender is (die bouwt zijn eigen antwoord). */
async function registreerZiekmeldingIntern(
  invoer: { userId: unknown; startDate?: unknown; endDate?: unknown; comment?: unknown },
  actor: BeslisActor,
  stuurTelegramAlert = true,
): Promise<{ fout: { status: number; error: string } } | { leave: any; period: string; targetName: string; openDienstenIso: Array<{ date: string; nummers: string[] }> }> {
    const selfId = String(actor.id);
    const forUserId = String(invoer.userId ?? "");
    if (!forUserId) return { fout: { status: 400, error: "Kies de chauffeur die ziek is." } };

    // Echte kalendercheck, niet alleen het patroon: "2026-02-31" past in de
    // regex maar bestaat niet, en Date maakt er stilletjes 3 maart van — dan
    // klopt geen enkele vergelijking meer.
    const isoDay = (v: unknown): string | null => {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
      const d = new Date(`${v}T00:00:00`);
      return Number.isFinite(d.getTime()) && d.toLocaleDateString("en-CA") === v ? v : null;
    };
    // brusselsDay, niet de UTC-dag: een ziekmelding zonder expliciete datum
    // om 00:30 Brusselse tijd hoort op vandáág te landen — met de UTC-dag
    // belandde ze op gisteren en bleef de dienst van vandaag ingevuld staan.
    const todayLocal = brusselsDay(new Date().toISOString()); // yyyy-mm-dd, Brusselse dag
    if (invoer.startDate != null && !isoDay(invoer.startDate)) {
      return { fout: { status: 400, error: "Ongeldige startdatum." } };
    }
    if (invoer.endDate != null && !isoDay(invoer.endDate)) {
      return { fout: { status: 400, error: "Ongeldige einddatum." } };
    }
    const startDate = isoDay(invoer.startDate) ?? todayLocal;
    const endDate = isoDay(invoer.endDate) ?? startDate;
    if (endDate < startDate) return { fout: { status: 400, error: "Einddatum ligt vóór de startdatum." } };
    // Cap op de periode: één tikfout in het jaartal ("2027" i.p.v. "2026")
    // zette iemand anders permanent ziek in het hele rooster. Een jaar is
    // ruim genoeg voor langdurige ziekte; langer kan altijd via verlengen.
    const spanDagen = Math.round((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000);
    if (spanDagen > 366) {
      return { fout: { status: 400, error: "Ziekteperiode is langer dan een jaar — controleer de datums (tikfout in het jaartal?)." } };
    }
    const comment = String(invoer.comment ?? "").slice(0, 1000);

    const users = await getUsersData();
    const target = users.find((u) => String(u.id) === forUserId);
    if (!target) return { fout: { status: 400, error: "Onbekende gebruiker." } };
    // Alleen actieve chauffeurs: een admin, planner of ex-medewerker ziek
    // melden registreert gezondheidsdata op de verkeerde plek.
    if (target.role !== "chauffeur" || target.isActive === false) {
      return { fout: { status: 400, error: "Ziek melden kan alleen voor een actieve chauffeur." } };
    }

    const previousLeave = await getLeaveData();
    // Duplicaat-/overlapcheck: een tweede ziekmelding over (deels) dezelfde
    // periode maakt geen extra record maar verwijst naar het bestaande —
    // verlengen of corrigeren gaat via Verlofbeheer.
    const overlappend = previousLeave.find((l: any) =>
      l?.status === "approved" && l?.type === "ziekte" && String(l.userId) === forUserId &&
      String(l.startDate) <= endDate && startDate <= String(l.endDate),
    );
    if (overlappend) {
      const p = overlappend.startDate === overlappend.endDate ? overlappend.startDate : `${overlappend.startDate} t/m ${overlappend.endDate}`;
      return { fout: { status: 409, error: `${target.name} staat al ziek gemeld voor ${p}. Pas die melding aan via Verlofbeheer.` } };
    }

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
    // Alleen het nieuwe record schrijven — géén snapshot-herschrijf van de
    // hele tabel: die draaide een gelijktijdige verlofbeslissing van een
    // collega-planner stil terug naar de stand van dit request.
    await saveLeaveData([record]);

    const period = startDate === endDate ? startDate : `${startDate} t/m ${endDate}`;
    await logActivity(actorReq(actor), "leave", "Ziekmelding", `${target.name} ziek gemeld voor ${period} (door ${actor.name}).`, { type: "leave", id: record.id });

    // Welke diensten vallen door deze ziekte open? Per dag van de periode de
    // ingeplande dienst(en) van de chauffeur — dat is wat de planner meteen
    // wil weten (verzoek Jarno 04-08). Gesplitste diensten = meerdere
    // planning-rijen met hetzelfde nummer → dedupliceren per dag.
    // ÁLLE maanden van de periode enumereren, niet alleen start- en eindmaand:
    // bij een ziekte over drie maanden verzweeg de mail anders de middelste
    // maand — zonder enige aanwijzing dat er iets ontbrak.
    const zichtMaanden: string[] = [];
    for (let m = startDate.slice(0, 7); m <= endDate.slice(0, 7); ) {
      zichtMaanden.push(m);
      const [jr, mnd] = m.split("-").map(Number);
      m = mnd === 12 ? `${jr + 1}-01` : `${jr}-${String(mnd + 1).padStart(2, "0")}`;
    }
    const planningChunks = await Promise.all(zichtMaanden.map((m) => getPlanningData({ driverId: forUserId, monthIso: m })));
    const dagDiensten = new Map<string, string[]>(); // datum → dienstnummers
    for (const s of planningChunks.flat() as any[]) {
      // Zelf óók op chauffeur filteren, niet alleen op het storage-filter
      // vertrouwen — een dienst van een collega in deze mail zet de planner
      // op het verkeerde been.
      if (String(s.driverId ?? "") !== forUserId) continue;
      const d = String(s.date ?? "");
      if (d < startDate || d > endDate) continue;
      const nummer = String(s.line ?? "").trim();
      if (!nummer) continue;
      const lijst = dagDiensten.get(d) ?? [];
      if (!lijst.includes(nummer)) dagDiensten.set(d, [...lijst, nummer]);
    }
    const dagLabel = (iso: string) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
    const openDiensten = [...dagDiensten.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, nummers]) => ({ label: dagLabel(d), nummers: nummers.join(" / ") }));

    // De hele planning waarschuwen. Push gaat niet naar wie het zelf
    // registreerde (een melding over je eigen klik is ruis), maar de mail
    // wél — die dient als vastlegging in de mailbox, en de registrerende
    // planner wil hem juist óók (verzoek Jarno 04-08).
    const planningRollen = users.filter(isActieveStaf);
    const beslissers = planningRollen.filter((u) => String(u.id) !== selfId);
    await sendPushToUsers(beslissers.map((u) => String(u.id)), {
      title: "Ziekmelding",
      body: `${target.name} is ziek gemeld voor ${period}.`,
      url: viewUrl("ziekte"),
    });
    // Ziekmelding ook naar de gekoppelde Telegram-chat, mét de diensten die
    // erdoor openvallen — dát is wat de planner meteen wil weten. Best-effort.
    if (telegramGeconfigureerd() && stuurTelegramAlert) {
      const dienstRegels = openDiensten.slice(0, 5).map((d) => `• ${d.label}: ${d.nummers}`);
      if (openDiensten.length > 5) dienstRegels.push(`• …en nog ${openDiensten.length - 5} dagen`);
      await stuurTelegram([
        `🤒 <b>Ziekmelding</b> — ${escapeHtml(target.name)} (${period})`,
        openDiensten.length > 0 ? `Diensten op naam in deze periode:\n${dienstRegels.join("\n")}` : "Geen diensten op naam in deze periode.",
      ].join("\n"));
    }
    // Per planner een eigen mail, rechtstreeks geadresseerd — géén BCC-batch.
    // sendEmail zet meerdere ontvangers in BCC (met noreply als To), en
    // Microsoft 365 filterde precies die vorm stilletjes weg: de testmail
    // (direct in To) kwam wél aan op hetzelfde adres (04-08). De BCC-vorm is
    // er tegen adressenlekken bij bulk naar alle chauffeurs; voor een handvol
    // planners die elkaars adres kennen is los versturen veiliger én leest de
    // mail normaal. Volgorde: één voor één, fouten loggen maar niet blokkeren.
    const recipients = planningRollen.filter((u) => u.email).map((u) => u.email as string);
    // Openstaande diensten in de mail (zelfde term als het scherm): "do 6 aug — 4407". Geen diensten in
    // de periode (ziek op vrije dagen) → dat óók gewoon zeggen, dan hoeft de
    // planner het rooster niet open te doen om niets te vinden.
    const dienstenTekst = openDiensten.length > 0
      ? `\n\nOpenstaande dienst(en):\n${openDiensten.map((o) => `- ${o.label} — ${o.nummers}`).join("\n")}\n\nDeze staan nu als onbeschikbaar in de Maandplanning en Dekking.`
      : "\n\nGeen ingeplande diensten in deze periode.";
    const dienstenHtml = openDiensten.length > 0
      ? `<p><strong>Openstaande dienst(en):</strong></p><ul>${openDiensten.map((o) => `<li>${escapeHtml(o.label)} — ${escapeHtml(o.nummers)}</li>`).join("")}</ul><p>Deze staan nu als onbeschikbaar in de Maandplanning en Dekking.</p>`
      : `<p>Geen ingeplande diensten in deze periode.</p>`;
    for (const adres of recipients) {
      await sendEmail({
        to: [adres],
        context: `sick:${forUserId}`,
        subject: `Ziekmelding — ${target.name} (${period})`,
        text: `${target.name} is ziek gemeld voor ${period}.${comment ? `\n\nToelichting: ${comment}` : ""}${dienstenTekst}`,
        html: `<p><strong>${escapeHtml(target.name)}</strong> is ziek gemeld voor <strong>${escapeHtml(period)}</strong>.</p>${comment ? `<p>Toelichting: ${escapeHtml(comment)}</p>` : ""}${dienstenHtml}`,
      });
    }

    return {
      leave: record,
      period,
      targetName: target.name,
      // ISO-variant voor de bot: kandidaten-knoppen hebben de rauwe datum
      // nodig; de label-variant leeft alleen intern (mail/alert).
      openDienstenIso: [...dagDiensten.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, nummers]) => ({ date: d, nummers })),
    };
}

app.post("/api/leave/sick-report", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const uit = await registreerZiekmeldingIntern(
      { userId: req.body?.userId, startDate: req.body?.startDate, endDate: req.body?.endDate, comment: req.body?.comment },
      { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "planner" | "admin" },
    );
    if ("fout" in uit) return res.status(uit.fout.status).json({ error: uit.fout.error });
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
    res.json({ success: true, leave: uit.leave });
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
    const formatLeaveType = (t: string) => LEAVE_TYPE_LABEL[t] ?? t;

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

    // State-machine (zelfde regel als de PATCH-route en de swaps-array-route):
    // een afgewezen of geannuleerde aanvraag is een eindstation. Zonder deze
    // guard kon een planner-save (of stale client) rejected → approved zetten,
    // mét goedkeuringsmail, zonder dat iemand het als heropening herkende.
    // approved → cancelled blijft toegestaan ("Verlof annuleren").
    for (const next of recordsToWrite) {
      const prev = previousById.get(String(next.id));
      if (prev && String(next.status) !== String(prev.status) && ["rejected", "cancelled"].includes(String(prev.status))) {
        return res.status(409).json({ error: "Deze verlofaanvraag is al afgehandeld en kan niet meer van status veranderen." });
      }
    }

    // Domeinvalidatie (álle rollen, óók op gewijzigde bestaande records):
    // alle afgeleide logica (bezetting, conflictdetectie, agenda-feed)
    // vergelijkt datums als strings — één kapotte datum maakt een aanvraag
    // daar stil onzichtbaar terwijl hij wél goedgekeurd blijft. Voorheen
    // sloeg deze lus bestaande records over (`previousById.has → continue`),
    // zodat een planner-save de periode van bestaand verlof onbewaakt kon
    // verzetten. Ongewijzigde records overslaan blijft (idempotente echo's,
    // en oude records met een verouderd formaat mogen niet retro-falen).
    const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
    const ongewijzigd = (a: any, b: any) =>
      a && String(a.startDate) === String(b.startDate) &&
      String(a.endDate) === String(b.endDate) &&
      String(a.type) === String(b.type);
    for (const next of recordsToWrite) {
      const prev = previousById.get(String(next.id));
      if (prev && ongewijzigd(prev, next)) continue;
      const start = String(next.startDate ?? "");
      const end = String(next.endDate ?? "");
      if (!ISO_DAY.test(start) || !ISO_DAY.test(end)) {
        return res.status(400).json({ error: "Ongeldige datum in de aanvraag: verwacht JJJJ-MM-DD." });
      }
      if (end < start) {
        return res.status(400).json({ error: "De einddatum ligt vóór de startdatum." });
      }
      if (!LEAVE_TYPE_LABEL[String(next.type ?? "")]) {
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
        // Nieuwe aanvraag van een chauffeur → seintje naar planners/admins,
        // en dezelfde melding mét goedkeurknoppen naar de Telegram-chat.
        if (req.appUser?.role === "chauffeur") {
          const beslissers = users.filter(isActieveStaf).map((u) => String(u.id));
          await sendPushToUsers(beslissers, {
            title: "Nieuwe verlofaanvraag",
            body: `${userName(next.userId)} vroeg ${typeLabel} aan voor ${period}.`,
            url: viewUrl("verlof"),
          });
          await meldVerlofAanvraagTelegram({ id: String(next.id), naam: userName(next.userId), typeLabel, start: String(next.startDate), eind: String(next.endDate) });
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
            url: viewUrl("verlof"),
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
/** Actor van een beslissing die niet via een HTTP-request binnenkomt (de
 *  Telegram-bot). logActivity leest alleen req.appUser — een synthetisch
 *  request met dezelfde velden volstaat en houdt de auditlog eerlijk. */
type BeslisActor = { id: string; name: string; role: "chauffeur" | "planner" | "admin" };
const actorReq = (actor: BeslisActor) => ({ appUser: actor } as AuthenticatedRequest);

/** De verlof-beslissing zelf (concurrency-guard, state-machine, opslag, log,
 *  mail + push) — gedeeld door PATCH /api/leave/:id en de Telegram-knoppen. */
async function beslisVerlofIntern(opts: { id: string; status: string; ifStatus: string; actor: BeslisActor }): Promise<
  { fout: { status: number; error: string; currentStatus?: string } } | { leave: any; melding: string }
> {
    const { id, status, ifStatus, actor } = opts;
    const allowed = ["approved", "rejected", "cancelled"];
    if (!allowed.includes(status)) {
      return { fout: { status: 400, error: "Ongeldige status." } };
    }

    const all = await getLeaveData();
    const current = all.find((l) => String(l.id) === id);
    if (!current) {
      return { fout: { status: 404, error: "Deze verlofaanvraag bestaat niet (meer) — mogelijk net ingetrokken." } };
    }
    if (String(current.status) !== ifStatus) {
      return { fout: { status: 409, error: `Deze aanvraag is intussen al '${current.status}' — de lijst is ververst.`, currentStatus: String(current.status) } };
    }
    // State-machine (spiegel van TERMINAL_SWAP_STATES): een afgewezen of
    // geannuleerde aanvraag is een eindstation. approved → cancelled blijft
    // toegestaan ("Verlof annuleren").
    if (status !== current.status && ["rejected", "cancelled"].includes(String(current.status))) {
      return { fout: { status: 409, error: "Deze verlofaanvraag is al afgehandeld en kan niet meer van status veranderen." } };
    }

    const decidedAt = new Date().toISOString();
    const updated = { ...current, status, decidedAt };
    await saveLeaveData([updated], []);

    const users = await getUsersData();
    const requester = users.find((u) => String(u.id) === String(current.userId));
    const requesterName = requester?.name || `Onbekende gebruiker (${current.userId})`;
    const period = current.startDate === current.endDate ? DAG_KORT(String(current.startDate)) : `${DAG_KORT(String(current.startDate))} t/m ${DAG_KORT(String(current.endDate))}`;
    const typeLabel = LEAVE_TYPE_LABEL[current.type] ?? current.type;
    const actionLabels: Record<string, string> = {
      approved: "Verlof goedgekeurd",
      rejected: "Verlof afgewezen",
      cancelled: "Verlof geannuleerd",
    };
    const action = actionLabels[status]!;
    await logActivity(actorReq(actor), "leave", action, `${requesterName} — ${typeLabel} (${period}).`, { type: "leave", id });

    // E-mail + push naar de aanvrager — niet de actor zelf.
    if (String(actor.id) !== String(current.userId)) {
      if (requester?.email) {
        await sendLeaveDecisionEmail({
          to: requester.email,
          recipientName: requester.name,
          decidedByName: actor.name || "Planning",
          typeLabel,
          startDate: current.startDate,
          endDate: current.endDate,
          action: status as LeaveDecisionAction,
        });
      }
      await sendPushToUsers([String(current.userId)], {
        title: action,
        body: `${typeLabel} (${period}) — beslist door ${actor.name || "Planning"}.`,
        url: viewUrl("verlof"),
      });
    }
    return { leave: updated, melding: `${action}: ${requesterName} — ${typeLabel} (${period}).` };
}

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
    const uit = await beslisVerlofIntern({
      id,
      status,
      ifStatus,
      actor: { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "planner" | "admin" },
    });
    if ("fout" in uit) {
      return res.status(uit.fout.status).json({ error: uit.fout.error, ...(uit.fout.currentStatus ? { currentStatus: uit.fout.currentStatus } : {}) });
    }

    // Verse collectie-revisie (zie /api/swaps PATCH).
    res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getLeaveData()));
    res.json({ success: true, leave: uit.leave });
  } catch (err: any) {
    console.error("Beslissing opslaan is mislukt", err);
    res.status(500).json({ error: "Beslissing opslaan is mislukt" });
  }
});

app.post("/api/send-urgent-update-email", authenticate, requireRole("planner", "admin"), urgentEmailRateLimit, async (req, res) => {
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
    { title: `🚨 ${update.title}`, body: String(update.content || "").slice(0, 180), url: viewUrl("updates") },
  );

  if (emails.length === 0) {
    return res.json({ success: true, message: "No recipients with email found" });
  }

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
      url: viewUrl("documenten"),
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
      url: viewUrl("documenten"),
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
  if (process.env.NODE_ENV !== "production") console.log(`API Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found on server` });
});

// Global error handler — details/stack alleen in de server-logs, nooit
// naar de client (info-disclosure).
app.use((err: any, req: any, res: any, next: any) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ error: "Er ging iets mis op de server." });
});

// Vite-middleware voor lokale ontwikkeling. Er is bewust géén productie-tak
// (express.static + SPA-fallback): op Vercel serveert de platform-rewrite
// (vercel.json) dist/ en index.html zelf en bereikt alleen /api/* deze functie.
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
}

export default app;
