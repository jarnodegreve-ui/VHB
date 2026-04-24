import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

import type { AppUser, AuthenticatedRequest } from "./types.js";
import { db, supabase, supabaseAdmin } from "./db.js";
import { authenticate, requireRole } from "./middleware.js";
import { normalizeEmail, parsePlanningMatrixCsv, toPublicUser, toRoleScopedUser } from "./helpers.js";
import {
  ACTIVITY_LOG_FILE,
  DATA_FILE,
  DIVERSIONS_FILE,
  LEAVE_FILE,
  PLANNING_CODES_FILE,
  PLANNING_MATRIX_FILE,
  PLANNING_MATRIX_HISTORY_FILE,
  SERVICES_FILE,
  SWAPS_FILE,
  UPDATES_FILE,
  USERS_FILE,
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
app.use(express.json({ limit: '10mb' }));

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
    if (!userId || password.length < 8) {
      return res.status(400).json({ error: "Geef een gebruiker en een wachtwoord van minstens 8 tekens." });
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
    await savePlanningMatrixRows(rows);
    const generatedPlanning = await buildPlanningFromMatrix(rows);
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

app.post("/api/swaps", authenticate, async (req, res) => {
  try {
    const newData = req.body;
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

app.post("/api/leave", authenticate, async (req, res) => {
  try {
    const newData = req.body;
    await saveLeaveData(newData);
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

app.get("/api/test", (req, res) => {
  res.send("VHB Portaal API is active");
});

// Admin endpoint to sync local JSON to Supabase
app.post("/api/admin/sync", authenticate, requireRole("admin"), async (req, res) => {
  console.log("Sync request received");
  if (!supabase) {
    console.error("Sync failed: Supabase not configured");
    return res.status(400).json({ error: "Supabase not configured. Cannot sync." });
  }

  try {
    const results: any = {};
    const cwd = process.cwd();
    console.log("Current working directory:", cwd);
    
    try {
      console.log("Files in CWD:", fs.readdirSync(cwd).join(", "));
    } catch (e) {
      console.error("Error reading CWD:", e);
    }

    // Sync Planning
    try {
      console.log("Checking planning file:", DATA_FILE);
      if (fs.existsSync(DATA_FILE)) {
        const localPlanning = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
        console.log(`Found ${localPlanning.length} planning items`);
        if (localPlanning.length > 0) {
          const { error } = await db!.from('planning').upsert(localPlanning);
          if (error) console.error("Planning sync error:", error);
          results.planning = error ? `Error: ${error.message}` : `Synced ${localPlanning.length} items`;
        } else {
          results.planning = "Empty file";
        }
      } else {
        console.warn("Planning file not found");
        results.planning = "File not found";
      }
    } catch (e: any) {
      results.planning = `Exception: ${e.message}`;
    }

    // Sync Users
    try {
      console.log("Checking users file:", USERS_FILE);
      if (fs.existsSync(USERS_FILE)) {
        const localUsers = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
        console.log(`Found ${localUsers.length} users`);
        if (localUsers.length > 0) {
          const { error } = await db!.from('users').upsert(localUsers.map(toPublicUser));
          if (error) console.error("Users sync error:", error);
          results.users = error ? `Error: ${error.message}` : `Synced ${localUsers.length} items`;
        } else {
          results.users = "Empty file";
        }
      } else {
        console.warn("Users file not found");
        results.users = "File not found";
      }
    } catch (e: any) {
      results.users = `Exception: ${e.message}`;
    }

    // Sync Diversions
    try {
      console.log("Checking diversions file:", DIVERSIONS_FILE);
      if (fs.existsSync(DIVERSIONS_FILE)) {
        const localDiversions = JSON.parse(fs.readFileSync(DIVERSIONS_FILE, "utf-8"));
        console.log(`Found ${localDiversions.length} diversions`);
        if (localDiversions.length > 0) {
          const { error } = await db!.from('diversions').upsert(localDiversions);
          if (error) console.error("Diversions sync error:", error);
          results.diversions = error ? `Error: ${error.message}` : `Synced ${localDiversions.length} items`;
        } else {
          results.diversions = "Empty file";
        }
      } else {
        console.warn("Diversions file not found");
        results.diversions = "File not found";
      }
    } catch (e: any) {
      results.diversions = `Exception: ${e.message}`;
    }

    // Sync Services
    try {
      console.log("Checking services file:", SERVICES_FILE);
      if (fs.existsSync(SERVICES_FILE)) {
        const localServices = JSON.parse(fs.readFileSync(SERVICES_FILE, "utf-8"));
        console.log(`Found ${localServices.length} services`);
        if (localServices.length > 0) {
          const { error } = await db!.from('services').upsert(localServices);
          if (error) console.error("Services sync error:", error);
          results.services = error ? `Error: ${error.message}` : `Synced ${localServices.length} items`;
        } else {
          results.services = "Empty file";
        }
      } else {
        console.warn("Services file not found");
        results.services = "File not found";
      }
    } catch (e: any) {
      results.services = `Exception: ${e.message}`;
    }

    console.log("Sync completed with results:", results);
    res.json({ success: true, results });
  } catch (err: any) {
    console.error("Global sync error:", err);
    res.status(500).json({ error: "Sync failed", details: err.message });
  }
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
