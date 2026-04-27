import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

import { sendLeaveDecisionEmail, type LeaveDecisionAction } from "./email.js";
import type { AppUser, AuthenticatedRequest } from "./types.js";
import { db, supabase, supabaseAdmin } from "./db.js";
import { authenticate, requireRole } from "./middleware.js";
import { normalizeEmail, parsePlanningMatrixCsv, toRoleScopedUser } from "./helpers.js";
import {
  buildPlanningFromMatrix,
  getActivityLog,
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
  summarizeServiceChanges,
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

    await logActivity(req, "auth", "Wachtwoord gereset", `Wachtwoord opnieuw ingesteld voor ${targetUser.name}.`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: "Wachtwoord reset mislukt.", details: error.message });
  }
});

app.get("/api/planning", authenticate, async (req, res) => {
  try {
    const data = await getPlanningData();
    res.json(data);
  } catch (err) {
    console.error("Error reading planning data:", err);
    res.status(500).json({ error: "Failed to read data" });
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

app.post("/api/planning-matrix/import", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const csvContent = String(req.body?.csvContent || "");
    if (!csvContent.trim()) {
      return res.status(400).json({ error: "CSV-inhoud ontbreekt." });
    }

    const rows = parsePlanningMatrixCsv(csvContent);
    const importedDates = rows.map((row) => row.source_date).filter(Boolean);
    const startDate = importedDates[0] || null;
    const endDate = importedDates[importedDates.length - 1] || null;

    // Bouw eerst, schrijf pas weg na strict-mode validatie. Als er onbekende
    // codes of niet-gematchte chauffeurs zijn, weiger de import zodat de
    // planner eerst de oorzaak kan rechtzetten.
    const generatedPlanning = await buildPlanningFromMatrix(rows);
    if (generatedPlanning.summary.unknownCodes.length > 0 || generatedPlanning.summary.unmatchedDrivers.length > 0) {
      return res.status(400).json({
        error: "Import geblokkeerd: er zijn onbekende codes of niet-gematchte chauffeurs. Los deze eerst op en probeer opnieuw.",
        unknownCodes: generatedPlanning.summary.unknownCodes,
        unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
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
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to import planning matrix", details: err.message });
  }
});

app.post("/api/planning-matrix/preview", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const csvContent = String(req.body?.csvContent || "");
    if (!csvContent.trim()) {
      return res.status(400).json({ error: "CSV-inhoud ontbreekt." });
    }

    const rows = parsePlanningMatrixCsv(csvContent);
    const importedDates = rows.map((row) => row.source_date).filter(Boolean);
    const startDate = importedDates[0] || null;
    const endDate = importedDates[importedDates.length - 1] || null;
    const generatedPlanning = await buildPlanningFromMatrix(rows);

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
      unknownCodes: generatedPlanning.summary.unknownCodes,
      unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
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
  console.log("POST /api/users called. Body size:", req.body?.length);
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      const previousUsers = await getUsersData();
      await saveUsersData(newData);
      console.log("Users saved successfully. Count:", newData.length);
      await logActivity(
        req,
        "users",
        "Gebruikers opgeslagen",
        `${newData.length} gebruikers verwerkt in gebruikersbeheer. ${summarizeUserChanges(previousUsers, newData)}.`,
      );
      res.json({ success: true, count: newData.length });
    } else {
      console.warn("Invalid data format for POST /api/users:", typeof newData);
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
      await logActivity(
        req,
        "services",
        "Diensten opgeslagen",
        `${newData.length} diensten opgeslagen. ${summarizeServiceChanges(previousServices, newData)}.`,
      );
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
    await saveUpdatesData(newData);
    await logActivity(
      req,
      "updates",
      "Updates opgeslagen",
      `${Array.isArray(newData) ? newData.length : 0} updates opgeslagen. ${summarizeUpdateChanges(previousUpdates, Array.isArray(newData) ? newData : [])}.`,
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save updates", details: err.message });
  }
});

app.get("/api/swaps", authenticate, async (req, res) => {
  try {
    const data = await getSwapsData();
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

    if (req.appUser?.role === "chauffeur") {
      const previousSwaps = await getSwapsData();
      const previousById = new Map(previousSwaps.map((s) => [String(s.id), s]));
      const newById = new Map(newData.map((s: any) => [String(s.id), s]));
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
        } else {
          const fields = ["shiftId", "requesterId", "targetDriverId", "status", "createdAt", "reason"] as const;
          for (const f of fields) {
            if (String((next as any)[f] ?? "") !== String((prev as any)[f] ?? "")) {
              return res.status(403).json({ error: "Niet toegestaan: bestaande wisselverzoeken kunnen alleen door planner/admin worden aangepast." });
            }
          }
        }
      }
    }

    await saveSwapsData(newData);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save swaps", details: err.message });
  }
});

app.get("/api/leave", authenticate, async (req, res) => {
  try {
    const data = await getLeaveData();
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

    // Stable storage path so public URLs stay valid across uploads.
    const storagePath = "current.pdf";

    const { error: uploadError } = await supabaseAdmin.storage
      .from(RITBLAADJE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) throw uploadError;

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
