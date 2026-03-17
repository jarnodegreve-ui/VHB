import express from "express";
// Build trigger: Environment variables updated in Vercel
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type User as SupabaseAuthUser } from "@supabase/supabase-js";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { parsePlanningMatrixCsv, type PlanningMatrixRow } from "./planningMatrix.ts";

dotenv.config();

console.log("Server starting in environment:", process.env.NODE_ENV);
console.log("Supabase URL present:", !!process.env.SUPABASE_URL);
console.log("Supabase Key present:", !!process.env.SUPABASE_ANON_KEY);
console.log("Supabase Service Role present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp for local files on Vercel if needed, but for reading we use process.cwd()
const DATA_FILE = path.join(process.cwd(), "planning_data.json");
const USERS_FILE = path.join(process.cwd(), "users_data.json");
const DIVERSIONS_FILE = path.join(process.cwd(), "diversions_data.json");
const SERVICES_FILE = path.join(process.cwd(), "services_data.json");
const UPDATES_FILE = path.join(process.cwd(), "updates_data.json");
const SWAPS_FILE = path.join(process.cwd(), "swaps_data.json");
const LEAVE_FILE = path.join(process.cwd(), "leave_data.json");
const PLANNING_MATRIX_FILE = path.join(process.cwd(), "planning_matrix_rows.json");

type Role = "chauffeur" | "planner" | "admin";

interface AppUser {
  id: string;
  name: string;
  role: Role;
  employeeId: string;
  lastLogin?: string;
  activeSessions?: number;
  isActive?: boolean;
  phone?: string;
  email?: string;
}

interface IncomingUser extends AppUser {
  password?: string;
}

interface SwapRecord {
  id: string;
  shiftId: string;
  requesterId: string;
  targetDriverId?: string;
  status: "pending" | "approved" | "rejected" | "completed";
  createdAt: string;
  reason?: string;
}

interface LeaveRecord {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: "vakantie" | "ziekte" | "persoonlijk" | "overig";
  status: "pending" | "approved" | "rejected";
  comment?: string;
  createdAt: string;
}

type AuthenticatedRequest = express.Request & {
  authUser?: SupabaseAuthUser;
  appUser?: AppUser;
  accessToken?: string;
};

const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase() || undefined;
const toPublicUser = (user: any): AppUser => ({
  id: String(user.id),
  name: user.name,
  role: user.role,
  employeeId: user.employeeId ?? user.employeeid,
  lastLogin: user.lastLogin ?? user.lastlogin,
  activeSessions: user.activeSessions ?? user.activesessions,
  isActive: user.isActive ?? user.isactive,
  phone: user.phone,
  email: user.email,
});

const sanitizeIncomingUser = (user: IncomingUser): AppUser => ({
  id: String(user.id),
  name: user.name?.trim() || "Onbekende gebruiker",
  role: user.role || "chauffeur",
  employeeId: user.employeeId?.trim() || `VHB-${String(user.id).slice(-6)}`,
  lastLogin: user.lastLogin,
  activeSessions: user.activeSessions ?? 0,
  isActive: user.isActive !== false,
  phone: user.phone?.trim() || undefined,
  email: normalizeEmail(user.email),
});

const toDatabaseUser = (user: AppUser) => ({
  id: String(user.id),
  name: user.name,
  role: user.role,
  employeeid: user.employeeId,
  lastlogin: user.lastLogin,
  activesessions: user.activeSessions ?? 0,
  isactive: user.isActive !== false,
  phone: user.phone,
  email: normalizeEmail(user.email),
});

const toPublicSwap = (swap: any): SwapRecord => ({
  id: String(swap.id),
  shiftId: String(swap.shiftId ?? swap.shiftid),
  requesterId: String(swap.requesterId ?? swap.requesterid),
  targetDriverId: swap.targetDriverId ?? swap.targetdriverid ?? undefined,
  status: swap.status,
  createdAt: String(swap.createdAt ?? swap.createdat),
  reason: swap.reason ?? undefined,
});

const toDatabaseSwap = (swap: SwapRecord) => ({
  id: String(swap.id),
  shiftid: String(swap.shiftId),
  requesterid: String(swap.requesterId),
  targetdriverid: swap.targetDriverId || null,
  status: swap.status,
  createdat: String(swap.createdAt),
  reason: swap.reason || null,
});

const toPublicLeave = (leave: any): LeaveRecord => ({
  id: String(leave.id),
  userId: String(leave.userId ?? leave.userid),
  startDate: String(leave.startDate ?? leave.startdate),
  endDate: String(leave.endDate ?? leave.enddate),
  type: leave.type,
  status: leave.status,
  comment: leave.comment ?? undefined,
  createdAt: String(leave.createdAt ?? leave.createdat),
});

const toDatabaseLeave = (leave: LeaveRecord) => ({
  id: String(leave.id),
  userid: String(leave.userId),
  startdate: String(leave.startDate),
  enddate: String(leave.endDate),
  type: leave.type,
  status: leave.status,
  comment: leave.comment || null,
  createdat: String(leave.createdAt),
});

const ensureUniqueUserEmails = (users: IncomingUser[]) => {
  const seen = new Set<string>();

  for (const user of users) {
    const email = normalizeEmail(user.email);
    if (!email) continue;

    if (seen.has(email)) {
      throw new Error(`E-mailadres ${email} komt meerdere keren voor.`);
    }

    seen.add(email);
  }
};

const countAdmins = (users: Array<Pick<AppUser, "role" | "isActive">>) =>
  users.filter((user) => user.role === "admin" && user.isActive !== false).length;

const randomPassword = () => Math.random().toString(36).slice(-10) + "A1!";

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
const supabaseAdmin = (supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
const db = supabaseAdmin ?? supabase;

if (!supabase) {
  console.warn("Supabase configuration missing. Falling back to local JSON files.");
} else {
  console.log("Supabase client initialized.");
}

// Default Mock Data
const DEFAULT_USERS: AppUser[] = [
  { id: '1', name: 'Jan de Vries', role: 'chauffeur', employeeId: 'CH-4492', phone: '0470 12 34 56', email: 'jan.devries@example.com', isActive: true },
  { id: '2', name: 'Sarah de Groot', role: 'planner', employeeId: 'PL-1102', phone: '0480 98 76 54', email: 'sarah.degroot@example.com', isActive: true },
  { id: '3', name: 'Mark Admin', role: 'admin', employeeId: 'AD-0001', phone: '0490 55 44 33', email: 'mark.admin@example.com', isActive: true },
];

const DEFAULT_SERVICES = [
  { id: '1', serviceNumber: 'D-101', startTime: '05:30', endTime: '13:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '2', serviceNumber: 'D-102', startTime: '06:15', endTime: '14:30', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '3', serviceNumber: 'D-201', startTime: '13:30', endTime: '21:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '4', serviceNumber: 'D-202', startTime: '14:15', endTime: '22:30', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '5', serviceNumber: 'D-301', startTime: '21:30', endTime: '05:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '6', serviceNumber: 'D-103', startTime: '07:00', endTime: '15:15', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '7', serviceNumber: 'D-104', startTime: '08:30', endTime: '16:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
];

// Helper to read/write data
const getPlanningData = async () => {
  if (db) {
    try {
      const { data, error } = await db.from('planning').select('*');
      if (error) {
        console.error("Supabase error fetching planning:", error);
      } else if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.error("Unexpected error fetching planning:", e);
    }
  }
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }
  return [];
};

const savePlanningData = async (data: any) => {
  if (db) {
    const { error } = await db.from('planning').upsert(data);
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const getPlanningMatrixRows = async (): Promise<PlanningMatrixRow[]> => {
  if (db) {
    try {
      const { data, error } = await db.from('planning_matrix_rows').select('*').order('source_date', { ascending: true });
      if (error) {
        console.error("Supabase error fetching planning matrix rows:", error);
      } else if (data) {
        return data as PlanningMatrixRow[];
      }
    } catch (e) {
      console.error("Unexpected error fetching planning matrix rows:", e);
    }
  }

  if (fs.existsSync(PLANNING_MATRIX_FILE)) {
    return JSON.parse(fs.readFileSync(PLANNING_MATRIX_FILE, "utf-8"));
  }

  return [];
};

const savePlanningMatrixRows = async (rows: PlanningMatrixRow[]) => {
  if (db) {
    const { error } = await db.from('planning_matrix_rows').upsert(rows);
    if (error) throw error;
    return;
  }

  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }

  fs.writeFileSync(PLANNING_MATRIX_FILE, JSON.stringify(rows, null, 2));
};

const getUsersData = async (): Promise<AppUser[]> => {
  console.log("getUsersData called. Supabase configured:", !!supabase);
  if (db) {
    try {
      const { data, error } = await db.from('users').select('*');
      if (error) {
        console.error("Supabase error fetching users:", error);
      } else if (data) {
        console.log(`Supabase returned ${data.length} users`);
        // If we have a connection to Supabase, it's the source of truth.
        // We only fall back to local/defaults if Supabase is empty AND we have local data.
        if (data.length > 0) return data.map(toPublicUser);
        
        // If Supabase is empty, check if we have local data to "bootstrap" from
        if (fs.existsSync(USERS_FILE)) {
          const content = fs.readFileSync(USERS_FILE, "utf-8");
          if (content.trim()) {
            const localData = JSON.parse(content);
            if (Array.isArray(localData) && localData.length > 0) {
              console.log("Supabase empty, using local file data");
              return localData.map(toPublicUser);
            }
          }
        }
        // If both are empty, return empty array (don't force defaults if we're connected)
        return [];
      }
    } catch (e) {
      console.error("Unexpected error fetching users:", e);
    }
  }
  
  // Fallback for non-Supabase environments
  if (fs.existsSync(USERS_FILE)) {
    try {
      const content = fs.readFileSync(USERS_FILE, "utf-8");
      if (content.trim()) {
        const data = JSON.parse(content);
        if (Array.isArray(data) && data.length > 0) return data.map(toPublicUser);
      }
    } catch (e) {
      console.error("Error reading users file:", e);
    }
  }
  console.log("No data found, returning DEFAULT_USERS");
  return DEFAULT_USERS;
};

const saveUsersData = async (incomingUsers: IncomingUser[]) => {
  console.log(`saveUsersData called with ${incomingUsers.length} items. Supabase:`, !!supabase);
  ensureUniqueUserEmails(incomingUsers);

  const sanitizedUsers = incomingUsers.map(sanitizeIncomingUser);
  if (countAdmins(sanitizedUsers) === 0) {
    throw new Error("Er moet minstens 1 actieve admin overblijven.");
  }

  if (db) {
    if (!supabaseAdmin) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt. Gebruikersbeheer vereist een service role key.");
    }

    const currentUsers = await getUsersData();
    const currentById = new Map<string, AppUser>(currentUsers.map((user): [string, AppUser] => [String(user.id), user]));
    const incomingIds = new Set(sanitizedUsers.map((user) => String(user.id)));

    const { data: authPage, error: authListError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (authListError) {
      throw authListError;
    }

    const authUsersByEmail = new Map<string, SupabaseAuthUser>(
      (authPage.users || [])
        .filter((user) => user.email)
        .map((user): [string, SupabaseAuthUser] => [normalizeEmail(user.email) as string, user]),
    );

    for (const currentUser of currentUsers) {
      if (incomingIds.has(String(currentUser.id))) continue;
      const existingAuth = normalizeEmail(currentUser.email)
        ? authUsersByEmail.get(normalizeEmail(currentUser.email) as string)
        : null;

      if (existingAuth) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(existingAuth.id);
        if (error) throw error;
      }
    }

    const removedUserIds = currentUsers
      .map((user) => String(user.id))
      .filter((id) => !incomingIds.has(id));

    for (const incomingUser of incomingUsers) {
      const sanitizedUser = sanitizeIncomingUser(incomingUser);
      const previousUser = currentById.get(String(sanitizedUser.id));
      const currentEmail = normalizeEmail(sanitizedUser.email);
      const previousEmail = normalizeEmail(previousUser?.email);

      if (!currentEmail) {
        continue;
      }

      const previousAuthUser = previousEmail ? authUsersByEmail.get(previousEmail) : null;
      const currentAuthUser = authUsersByEmail.get(currentEmail) ?? previousAuthUser;

      if (!currentAuthUser) {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: currentEmail,
          password: incomingUser.password || randomPassword(),
          email_confirm: true,
          user_metadata: { name: sanitizedUser.name, role: sanitizedUser.role },
        });
        if (error) throw error;
        if (data.user?.email) {
          authUsersByEmail.set(normalizeEmail(data.user.email) as string, data.user);
        }
        continue;
      }

      if (previousEmail && previousEmail !== currentEmail) {
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(currentAuthUser.id, {
          email: currentEmail,
          email_confirm: true,
          user_metadata: { name: sanitizedUser.name, role: sanitizedUser.role },
        });
        if (error) throw error;
        authUsersByEmail.delete(previousEmail);
        if (data.user?.email) {
          authUsersByEmail.set(normalizeEmail(data.user.email) as string, data.user);
        }
      }

      if (incomingUser.password) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(currentAuthUser.id, {
          password: incomingUser.password,
          user_metadata: { name: sanitizedUser.name, role: sanitizedUser.role },
        });
        if (error) throw error;
      }
    }

    if (removedUserIds.length > 0) {
      const { error } = await db.from('users').delete().in('id', removedUserIds);
      if (error) {
        console.error("Supabase delete error:", error);
        throw error;
      }
    }

    const databaseUsers = sanitizedUsers.map(toDatabaseUser);

    const { error } = await db.from('users').upsert(databaseUsers);
    if (error) {
      console.error("Supabase upsert error:", error);
      throw error;
    }
    console.log("Supabase upsert successful");
    return;
  }

  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel. Controleer de omgevingsvariabelen.");
  }

  fs.writeFileSync(USERS_FILE, JSON.stringify(sanitizedUsers, null, 2));
};

const getDiversionsData = async () => {
  if (db) {
    try {
      const { data, error } = await db.from('diversions').select('*');
      if (error) {
        console.error("Supabase error fetching diversions:", error);
      } else if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.error("Unexpected error fetching diversions:", e);
    }
  }
  if (fs.existsSync(DIVERSIONS_FILE)) {
    return JSON.parse(fs.readFileSync(DIVERSIONS_FILE, "utf-8"));
  }
  return [];
};

const saveDiversionsData = async (data: any) => {
  if (db) {
    const { error } = await db.from('diversions').upsert(data);
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }
  fs.writeFileSync(DIVERSIONS_FILE, JSON.stringify(data, null, 2));
};

const getServicesData = async () => {
  if (db) {
    try {
      const { data, error } = await db.from('services').select('*');
      if (error) {
        if (error.code === '42P01') {
          console.warn("Supabase 'services' table not found. Falling back to local/mock data.");
        } else {
          console.error("Supabase error fetching services:", error);
        }
      } else if (data) {
        // If we got a response from Supabase, even if empty, return it
        // unless we want to force defaults on first run.
        // Let's say if it's empty, we check local file, then defaults.
        if (data.length > 0) return data;
        
        // Check if we have local data to bootstrap
        if (fs.existsSync(SERVICES_FILE)) {
          const content = fs.readFileSync(SERVICES_FILE, "utf-8");
          if (content.trim()) {
            const localData = JSON.parse(content);
            if (Array.isArray(localData) && localData.length > 0) return localData;
          }
        }
        
        // If we are connected to Supabase and it's empty, we might want to return empty
        // but for the very first time, mock data is better.
        // However, if the user explicitly cleared it, we should respect that.
        // For now, let's return data if it's an array.
        return data; 
      }
    } catch (e) {
      console.error("Unexpected error fetching services:", e);
    }
  }
  if (fs.existsSync(SERVICES_FILE)) {
    try {
      const content = fs.readFileSync(SERVICES_FILE, "utf-8");
      if (content.trim()) {
        const data = JSON.parse(content);
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch (e) {
      console.error("Error reading services file:", e);
    }
  }
  return DEFAULT_SERVICES;
};

const saveServicesData = async (data: any) => {
  if (db) {
    // To handle deletions (replace all logic), we first delete all then insert
    // This is the most reliable way for a "manage list" interface
    try {
      // Delete all existing services
      const { error: deleteError } = await db.from('services').delete().neq('id', '0');
      if (deleteError) {
        console.error("Error deleting services for replace:", deleteError);
        // Fallback to upsert if delete fails
        const { error: upsertError } = await db.from('services').upsert(data);
        if (upsertError) throw upsertError;
      } else if (data.length > 0) {
        // Insert new services
        const { error: insertError } = await db.from('services').insert(data);
        if (insertError) throw insertError;
      }
      return;
    } catch (e) {
      console.error("Error in saveServicesData:", e);
      throw e;
    }
  }
  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(data, null, 2));
};

const getUpdatesData = async () => {
  if (db) {
    try {
      const { data, error } = await db.from('updates').select('*');
      if (error) console.error("Supabase error fetching updates:", error);
      else if (data) return data;
    } catch (e) {
      console.error("Unexpected error fetching updates:", e);
    }
  }
  if (fs.existsSync(UPDATES_FILE)) {
    return JSON.parse(fs.readFileSync(UPDATES_FILE, "utf-8"));
  }
  return [];
};

const saveUpdatesData = async (data: any) => {
  if (db) {
    const { error } = await db.from('updates').upsert(data);
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) throw new Error("Supabase is niet geconfigureerd op Vercel.");
  fs.writeFileSync(UPDATES_FILE, JSON.stringify(data, null, 2));
};

const getSwapsData = async () => {
  if (db) {
    try {
      const { data, error } = await db.from('swaps').select('*');
      if (error) console.error("Supabase error fetching swaps:", error);
      else if (data) return data.map(toPublicSwap);
    } catch (e) {
      console.error("Unexpected error fetching swaps:", e);
    }
  }
  if (fs.existsSync(SWAPS_FILE)) {
    return JSON.parse(fs.readFileSync(SWAPS_FILE, "utf-8")).map(toPublicSwap);
  }
  return [];
};

const saveSwapsData = async (data: any) => {
  const normalizedData = Array.isArray(data) ? data.map(toPublicSwap) : [];
  if (db) {
    const { error } = await db.from('swaps').upsert(normalizedData.map(toDatabaseSwap));
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) throw new Error("Supabase is niet geconfigureerd op Vercel.");
  fs.writeFileSync(SWAPS_FILE, JSON.stringify(normalizedData, null, 2));
};

const getLeaveData = async () => {
  if (db) {
    try {
      const { data, error } = await db.from('leave').select('*');
      if (error) console.error("Supabase error fetching leave:", error);
      else if (data) return data.map(toPublicLeave);
    } catch (e) {
      console.error("Unexpected error fetching leave:", e);
    }
  }
  if (fs.existsSync(LEAVE_FILE)) {
    return JSON.parse(fs.readFileSync(LEAVE_FILE, "utf-8")).map(toPublicLeave);
  }
  return [];
};

const saveLeaveData = async (data: any) => {
  const normalizedData = Array.isArray(data) ? data.map(toPublicLeave) : [];
  if (db) {
    const { error } = await db.from('leave').upsert(normalizedData.map(toDatabaseLeave));
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) throw new Error("Supabase is niet geconfigureerd op Vercel.");
  fs.writeFileSync(LEAVE_FILE, JSON.stringify(normalizedData, null, 2));
};

const getBearerToken = (req: express.Request) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
};

const findUserByEmail = async (email?: string | null): Promise<AppUser | null> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const users = await getUsersData();
  return users.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
};

const authenticate = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
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

  req.accessToken = accessToken;
  req.authUser = data.user;
  req.appUser = appUser;
  next();
};

const requireRole = (...roles: Role[]) => {
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

app.post("/api/planning-matrix/import", authenticate, requireRole("planner", "admin"), async (req, res) => {
  try {
    const csvContent = String(req.body?.csvContent || "");
    if (!csvContent.trim()) {
      return res.status(400).json({ error: "CSV-inhoud ontbreekt." });
    }

    const rows = parsePlanningMatrixCsv(csvContent);
    await savePlanningMatrixRows(rows);

    res.json({
      success: true,
      importedDays: rows.length,
      detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to import planning matrix", details: err.message });
  }
});

app.get("/api/users", authenticate, async (req, res) => {
  try {
    const users = await getUsersData();
    res.json(users);
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
      await saveUsersData(newData);
      console.log("Users saved successfully. Count:", newData.length);
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
      await saveDiversionsData(newData);
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
      await saveServicesData(newData);
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
    await saveUpdatesData(newData);
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
