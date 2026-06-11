import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

import { buildCalendar, type IcsEvent } from "./ics.js";
import { computeDayGap, resolveDayType, type DayGap } from "./coverageGaps.js";

import { sendLeaveDecisionEmail, type LeaveDecisionAction } from "./email.js";
import type { AppUser, AuthenticatedRequest } from "./types.js";
import { db, supabase, supabaseAdmin } from "./db.js";
import { authenticate, requireRole } from "./middleware.js";
import { normalizeEmail, parsePlanningMatrixXlsx, toRoleScopedUser } from "./helpers.js";
import {
  buildPlanningFromMatrix,
  getActivityLog,
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
  replacePlanningData,
  saveDiversionsData,
  saveLeaveData,
  savePlanningCodesData,
  savePlanningData,
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
} from "./storage.js";

dotenv.config();

console.log("Server starting in environment:", process.env.NODE_ENV);
console.log("Supabase URL present:", !!process.env.SUPABASE_URL);
console.log("Supabase Key present:", !!process.env.SUPABASE_ANON_KEY);
console.log("Supabase Service Role present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health check
app.get("/api/health", async (req, res) => {
  let supabaseStatus = "not configured";
  let tables: any = {};
  
  if (supabase) {
    supabaseStatus = "configured";
    try {
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
    } catch (e: any) {
      supabaseStatus = `Error: ${e.message}`;
    }
  }

  res.json({ 
    status: "ok", 
    supabase: supabaseStatus, 
    tables,
    env: process.env.NODE_ENV, 
    time: new Date().toISOString() 
  });
});

// API Routes
app.post("/api/test", (req, res) => {
  res.json({ success: true, message: "POST method is working", body: req.body });
});

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

    const nextUser: AppUser = {
      ...currentUser,
      lastLogin: action === "start" ? new Date().toLocaleString("nl-BE") : currentUser.lastLogin,
      activeSessions: action === "start"
        ? (currentUser.activeSessions || 0) + 1
        : Math.max(0, (currentUser.activeSessions || 1) - 1),
    };

    const allUsers = await getUsersData();
    const updatedUsers = allUsers.map((user) => user.id === nextUser.id ? nextUser : user);
    await saveUsersData(updatedUsers);
    res.json(nextUser);
  } catch (error: any) {
    res.status(500).json({ error: "Kon sessie niet bijwerken.", details: error.message });
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

    const authUser = authPage.users.find((user) => normalizeEmail(user.email) === normalizeEmail(targetUser.email));
    if (!authUser) {
      return res.status(404).json({ error: "Geen gekoppeld auth-account gevonden." });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password });
    if (error) throw error;

    await logActivity(req, "auth", "Wachtwoord gereset", `Wachtwoord opnieuw ingesteld voor ${targetUser.name}.`, { type: "user", id: targetUser.id });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: "Wachtwoord reset mislukt.", details: error.message });
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
    res.json(data);
  } catch (err) {
    console.error("Error reading planning data:", err);
    res.status(500).json({ error: "Failed to read data" });
  }
});

// === Agenda-abonnement (.ics-feed) =========================================
// Chauffeurs abonneren hun diensten in Google/Apple Agenda via een
// persoonlijke, token-beveiligde URL die de agenda-app periodiek ophaalt
// (auto-update). De token is een HMAC over het user-id met een server-
// secret — stateless, geen DB-kolom nodig. De feed bevat enkel de eigen
// diensten (geen gevoelige data), maar behandel de URL als privé.
const CAL_SECRET =
  process.env.CALENDAR_FEED_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "vhb-portaal-calendar-fallback-secret";

const calendarToken = (userId: string) =>
  crypto.createHmac("sha256", CAL_SECRET).update(`calendar:${userId}`).digest("hex");

const verifyCalendarToken = (userId: string, token: string) => {
  const expected = calendarToken(userId);
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

app.post("/api/planning", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      await savePlanningData(newData);
      await logActivity(
        req,
        "planning",
        "Planning opgeslagen",
        `${newData.length} planningregels handmatig opgeslagen. Voorbeeld: ${summarizeTokens(newData.map((shift: any) => `dienst ${shift.line || shift.id}`))}.`,
      );
      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Invalid data format. Expected an array." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving planning data:", errorMessage);
    res.status(500).json({ error: "Failed to save data", details: errorMessage });
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

    const chauffeurs = users
      .filter((u: any) => u.isActive !== false && u.role === "chauffeur" && norm(u.name) !== "beheerder")
      .map((u: any) => ({ id: String(u.id), name: u.name as string, key: norm(u.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const idByNameKey = new Map(chauffeurs.map((c) => [c.key, c.id]));

    // Code-resolutie — zelfde logica als lib/planning.ts, server-side.
    // We geven ook label + uren-segmenten mee zodat de UI per cel een
    // detail kan tonen zonder de services/codes naar elke client te sturen.
    const serviceByNorm = new Map(services.map((s: any) => [norm(s.serviceNumber), s]));
    const codeByNorm = new Map(codes.map((c: any) => [norm(c.code), c]));
    const segmentsOf = (s: any): string[] => [
      s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : "",
      s.startTime2 && s.endTime2 ? `${s.startTime2} - ${s.endTime2}` : "",
      s.startTime3 && s.endTime3 ? `${s.startTime3} - ${s.endTime3}` : "",
    ].filter(Boolean);
    const resolve = (code: string): { kind: string; label: string; segments: string[] } | null => {
      const n = norm(code);
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
        const id = idByNameKey.get(norm(driverName));
        if (!id) continue;
        const code = String(rawCode ?? "").trim();
        if (!code) continue;
        const r = resolve(code);
        if (!r) continue;
        if (!cells[id]) cells[id] = {};
        cells[id][date] = { code, kind: r.kind, label: r.label, segments: r.segments };
      }
    }

    res.json({ month, dates, drivers: chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells });
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
    const [expectations, rows, services] = await Promise.all([
      getCoverageExpectations(),
      getPlanningMatrixRows(),
      getServicesData(),
    ]);
    // resolveDayType valt terug op weekdag/zaterdag/zondag wanneer de
    // import geen expliciet dag-type meegaf (planning "zonder kopjes"),
    // zodat er altijd dag-types zijn om verwachtingen tegen in te stellen.
    const dayTypes = Array.from(
      new Set(rows.map((r: any) => resolveDayType(r.day_type, String(r.source_date ?? ""))).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
    const serviceNumbers = Array.from(
      new Set((services as any[]).map((s) => String(s.serviceNumber ?? "").trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    res.json({ expectations, dayTypes, services: serviceNumbers });
  } catch (err) {
    console.error("Error reading coverage expectations:", err);
    res.status(500).json({ error: "Kon dekkingsinstellingen niet laden." });
  }
});

app.put("/api/coverage-expectations", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const body = req.body?.expectations;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "Verwacht { expectations: { dagtype: [dienstnummers] } }." });
    }
    const clean: Record<string, string[]> = {};
    for (const [dayType, list] of Object.entries(body)) {
      const dt = String(dayType).trim();
      if (!dt) continue;
      clean[dt] = Array.isArray(list) ? list.map((s) => String(s).trim()).filter(Boolean) : [];
    }
    await saveCoverageExpectations(clean);
    await logActivity(req, "planning", "Dekkingsinstellingen bijgewerkt", "Verwachte diensten per dag-type aangepast.", undefined);
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
    const [expectations, rows] = await Promise.all([
      getCoverageExpectations(),
      getPlanningMatrixRows(),
    ]);
    const inRange = rows
      .filter((r: any) => {
        const d = String(r.source_date ?? "");
        return d >= from && d <= to;
      })
      .sort((a: any, b: any) => String(a.source_date).localeCompare(String(b.source_date)));
    const days: DayGap[] = inRange.map((r: any) => {
      // Zelfde afleiding als de config-endpoint, zodat ingestelde
      // verwachtingen per dag-type ook echt matchen met de dagen.
      const dayType = resolveDayType(r.day_type, String(r.source_date ?? ""));
      const expected = expectations[dayType] || [];
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
    res.status(500).json({ error: "Failed to read planning matrix", details: err.message });
  }
});

app.get("/api/planning-matrix/history", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const history = await getPlanningMatrixHistory();
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read planning matrix history", details: err.message });
  }
});

app.get("/api/activity", authenticate, requireRole("admin"), async (_req, res) => {
  try {
    const activity = await getActivityLog();
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read activity log", details: err.message });
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
      res.status(500).json({ error: "Failed to read entity history", details: err.message });
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
  return { rows: parsePlanningMatrixXlsx(buffer) };
};

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

    await savePlanningMatrixRows(rows);
    await replacePlanningData(generatedPlanning.shifts);
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
    res.status(500).json({ error: "Failed to import planning matrix", details: err.message });
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
    res.status(500).json({ error: "Failed to preview planning matrix", details: err.message });
  }
});

app.post("/api/planning/sync-from-matrix", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const generatedPlanning = await buildPlanningFromMatrix();
    await replacePlanningData(generatedPlanning.shifts);
    await logActivity(
      _req,
      "planning",
      "Planning opnieuw opgebouwd",
      `${generatedPlanning.summary.generatedShifts} diensten opgebouwd vanuit de actuele matrix. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}.`,
    );
    res.json({ success: true, ...generatedPlanning.summary });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to sync planning from matrix", details: err.message });
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
    res.status(500).json({ error: "Kon wijzigingen niet ophalen.", details: err.message });
  }
});

app.get("/api/planning-codes", authenticate, requireRole("planner", "admin"), async (_req, res) => {
  try {
    const codes = await getPlanningCodesData();
    res.json(codes);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read planning codes", details: err.message });
  }
});

app.post("/api/planning-codes", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const codes = req.body;
    if (!Array.isArray(codes)) {
      return res.status(400).json({ error: "Invalid data format. Expected an array." });
    }

    const previousCodes = await getPlanningCodesData();
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

    res.json({ success: true, count: codes.length });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save planning codes", details: err.message });
  }
});

app.get("/api/users", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const users = await getUsersData();
    res.json(users.map((user) => toRoleScopedUser(user, req.appUser!.role)));
  } catch (err) {
    console.error("Error reading users data:", err);
    res.status(500).json({ error: "Failed to read data" });
  }
});

app.post("/api/users", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      const previousUsers = await getUsersData();
      await saveUsersData(newData);
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

      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Invalid data format. Expected an array." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving users data:", errorMessage);
    res.status(500).json({ error: "Failed to save data", details: errorMessage });
  }
});

app.get("/api/diversions", authenticate, async (req, res) => {
  try {
    const data = await getDiversionsData();
    res.json(data);
  } catch (err) {
    console.error("Error reading diversions data:", err);
    res.status(500).json({ error: "Failed to read data" });
  }
});

app.post("/api/diversions", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      const previousDiversions = await getDiversionsData();
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

      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Invalid data format. Expected an array." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving diversions data:", errorMessage);
    res.status(500).json({ error: "Failed to save data", details: errorMessage });
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
    res.status(500).json({ error: "Kon PDF niet uploaden.", details: err.message });
  }
});

app.get("/api/services", authenticate, async (req, res) => {
  try {
    const data = await getServicesData();
    res.json(data);
  } catch (err) {
    console.error("Error reading services data:", err);
    res.status(500).json({ error: "Failed to read data" });
  }
});

app.post("/api/services", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      const previousServices = await getServicesData();
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

      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Invalid data format. Expected an array." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving services data:", errorMessage);
    res.status(500).json({ error: "Failed to save data", details: errorMessage });
  }
});

app.get("/api/updates", authenticate, async (req, res) => {
  try {
    const data = await getUpdatesData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to read updates" });
  }
});

app.post("/api/updates", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const newData = req.body;
    const previousUpdates = await getUpdatesData();
    const arr = Array.isArray(newData) ? newData : [];
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

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save updates", details: err.message });
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
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to read swaps" });
  }
});

app.post("/api/swaps", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const newData = req.body;
    if (!Array.isArray(newData)) {
      return res.status(400).json({ error: "Invalid data format. Expected an array." });
    }

    const previousSwaps = await getSwapsData();
    const previousById = new Map(previousSwaps.map((s) => [String(s.id), s]));
    const newById = new Map(newData.map((s: any) => [String(s.id), s]));

    if (req.appUser?.role === "chauffeur") {
      const selfId = String(req.appUser.id);

      // Verwijderingen: alleen eigen pending-aanvragen mogen weg.
      for (const [id, prev] of previousById) {
        if (!newById.has(id)) {
          if (String(prev.requesterId) !== selfId || prev.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen je eigen openstaande wisselverzoeken intrekken." });
          }
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
          } else {
            const fields = ["shiftId", "requesterId", "targetDriverId", "status", "createdAt", "reason", "decidedAt", "returnDate", "returnCode"] as const;
            for (const f of fields) {
              if (String((next as any)[f] ?? "") !== String((prev as any)[f] ?? "")) {
                return res.status(403).json({ error: "Niet toegestaan: bestaande wisselverzoeken kunnen alleen door planner/admin worden aangepast." });
              }
            }
          }
        }
      }
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
      }
    }

    await saveSwapsData(newData);

    // Activity log: detecteer state-overgangen en nieuwe aanvragen.
    const usersForLog = await getUsersData();
    const userName = (id: string) => usersForLog.find((u) => String(u.id) === String(id))?.name || `Onbekende gebruiker (${id})`;
    for (const next of newData) {
      const prev = previousById.get(String(next.id));
      if (!prev) {
        await logActivity(req, "swaps", "Dienstruil aangevraagd", `${userName(next.requesterId)} bood een dienst aan voor ruil.`, { type: "swap", id: next.id });
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
        }
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save swaps", details: err.message });
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
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to read leave" });
  }
});

app.post("/api/leave", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const newData = req.body;
    if (!Array.isArray(newData)) {
      res.status(400).json({ error: "Invalid data format. Expected an array." });
      return;
    }

    const previousLeave = await getLeaveData();
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
    if (req.appUser?.role === "chauffeur") {
      const newById = new Map(newData.map((r: any) => [String(r.id), r]));
      const selfId = String(req.appUser.id);

      for (const [id, prev] of previousById) {
        if (!newById.has(String(id))) {
          if (String(prev.userId) !== selfId || prev.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: je kan alleen je eigen openstaande verlofaanvraag intrekken." });
          }
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

    await saveLeaveData(newData);

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

        // E-mail de aanvrager — niet de actor zelf (geen mail naar jezelf
        // als planner/admin je eigen verlof beslist).
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
        }
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save leave", details: err.message });
  }
});

app.post("/api/send-urgent-update-email", authenticate, requireRole("planner", "admin"), async (req, res) => {
  const { update, recipients } = req.body;
  
  if (!update || !recipients || !Array.isArray(recipients)) {
    return res.status(400).json({ error: "Missing update or recipients" });
  }

  const emails = recipients.map((u: any) => u.email).filter(Boolean);
  
  if (emails.length === 0) {
    return res.json({ success: true, message: "No recipients with email found" });
  }

  console.log(`Attempting to send urgent email for: ${update.title} to ${emails.length} recipients`);

  // SMTP Configuration from environment variables
  const smtpConfig = {
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };

  const hasSmtp = process.env.SMTP_USER && process.env.SMTP_PASS;

  if (!hasSmtp) {
    console.warn("SMTP credentials missing. Logging email content instead of sending.");
    console.log("--- URGENT EMAIL CONTENT ---");
    console.log("To:", emails.join(", "));
    console.log("Subject: DRINGENDE UPDATE: " + update.title);
    console.log("Body:", update.content);
    console.log("----------------------------");
    return res.json({ 
      success: true, 
      message: "Email gelogd (geen SMTP geconfigureerd)", 
      mocked: true,
      content: {
        to: emails,
        subject: "DRINGENDE UPDATE: " + update.title,
        body: update.content
      }
    });
  }

  try {
    const transporter = nodemailer.createTransport(smtpConfig);
    
    await transporter.sendMail({
      from: `"VHB Portaal" <${process.env.SMTP_FROM || smtpConfig.auth.user}>`,
      to: emails.join(", "),
      subject: `DRINGENDE UPDATE: ${update.title}`,
      text: `${update.content}\n\nBekijk de volledige update in het VHB Portaal.`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
          <div style="background-color: #f59e0b; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">DRINGENDE UPDATE</h1>
          </div>
          <div style="padding: 30px;">
            <h2 style="color: #1e293b; margin-top: 0;">${update.title}</h2>
            <p style="color: #475569; line-height: 1.6;">${update.content}</p>
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

    res.json({ success: true, message: "Emails succesvol verzonden" });
  } catch (error: any) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: "Fout bij verzenden email", details: error.message });
  }
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
    res.status(500).json({ error: "Kon ritblaadje niet ophalen.", details: err.message });
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
    res.status(500).json({ error: "Kon ritblaadje niet uploaden.", details: err.message });
  }
});

app.delete("/api/ritblaadje", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
    }

    const { data: existing } = await supabaseAdmin.from("ritblaadje").select("*").eq("id", "current").maybeSingle();
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
    res.status(500).json({ error: "Kon ritblaadje niet verwijderen.", details: err.message });
  }
});

app.get("/api/test", (req, res) => {
  res.send("VHB Portaal API is active");
});

app.all("/api/*", (req, res) => {
  console.log(`API Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found on server` });
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ 
    error: "Internal Server Error", 
    details: err.message || String(err),
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
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
