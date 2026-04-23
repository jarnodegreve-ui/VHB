import fs from "fs";
import path from "path";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import type {
  ActivityLogRecord,
  ActivityLogRow,
  AppUser,
  AuthenticatedRequest,
  IncomingUser,
  LeaveRecord,
  PlanningCodeRecord,
  PlanningMatrixImportHistoryRecord,
  PlanningMatrixImportHistoryRow,
  PlanningMatrixRow,
  Role,
  ServiceRecord,
  ShiftRecord,
  SwapRecord,
} from "./types";
import {
  countAdmins,
  ensureUniqueUserEmails,
  normalizeEmail,
  parsePlanningMatrixCsv,
  randomPassword,
  sanitizeIncomingUser,
  toDatabaseLeave,
  toDatabasePlanningCode,
  toDatabaseSwap,
  toDatabaseUpdate,
  toDatabaseUser,
  toLookupToken,
  toPublicLeave,
  toPublicPlanningCode,
  toPublicSwap,
  toPublicUpdate,
  toPublicUser,
} from "./helpers";
import { db, supabase, supabaseAdmin } from "./db";

export const DATA_FILE = path.join(process.cwd(), "planning_data.json");
export const USERS_FILE = path.join(process.cwd(), "users_data.json");
export const DIVERSIONS_FILE = path.join(process.cwd(), "diversions_data.json");
export const SERVICES_FILE = path.join(process.cwd(), "services_data.json");
export const UPDATES_FILE = path.join(process.cwd(), "updates_data.json");
export const SWAPS_FILE = path.join(process.cwd(), "swaps_data.json");
export const LEAVE_FILE = path.join(process.cwd(), "leave_data.json");
export const PLANNING_MATRIX_FILE = path.join(process.cwd(), "planning_matrix_rows.json");
export const PLANNING_CODES_FILE = path.join(process.cwd(), "planning_codes.json");
export const PLANNING_MATRIX_HISTORY_FILE = path.join(process.cwd(), "planning_matrix_history.json");
export const ACTIVITY_LOG_FILE = path.join(process.cwd(), "activity_log.json");

export const DEFAULT_USERS: AppUser[] = [
  { id: '1', name: 'Jan de Vries', role: 'chauffeur', employeeId: 'CH-4492', phone: '0470 12 34 56', email: 'jan.devries@example.com', isActive: true },
  { id: '2', name: 'Sarah de Groot', role: 'planner', employeeId: 'PL-1102', phone: '0480 98 76 54', email: 'sarah.degroot@example.com', isActive: true },
  { id: '3', name: 'Mark Admin', role: 'admin', employeeId: 'AD-0001', phone: '0490 55 44 33', email: 'mark.admin@example.com', isActive: true },
];

export const DEFAULT_SERVICES = [
  { id: '1', serviceNumber: 'D-101', startTime: '05:30', endTime: '13:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '2', serviceNumber: 'D-102', startTime: '06:15', endTime: '14:30', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '3', serviceNumber: 'D-201', startTime: '13:30', endTime: '21:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '4', serviceNumber: 'D-202', startTime: '14:15', endTime: '22:30', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '5', serviceNumber: 'D-301', startTime: '21:30', endTime: '05:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '6', serviceNumber: 'D-103', startTime: '07:00', endTime: '15:15', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
  { id: '7', serviceNumber: 'D-104', startTime: '08:30', endTime: '16:45', startTime2: '', endTime2: '', startTime3: '', endTime3: '' },
];

// Helper to read/write data
export const getPlanningData = async () => {
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

export const savePlanningData = async (data: any) => {
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

export const replacePlanningData = async (data: ShiftRecord[]) => {
  if (db) {
    const { error: deleteError } = await db.from('planning').delete().neq('id', '__never__');
    if (deleteError) throw deleteError;

    if (data.length > 0) {
      const { error: insertError } = await db.from('planning').insert(data);
      if (insertError) throw insertError;
    }
    return;
  }

  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

export const getPlanningMatrixRows = async (): Promise<PlanningMatrixRow[]> => {
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

export const savePlanningMatrixRows = async (rows: PlanningMatrixRow[]) => {
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

export const getPlanningCodesData = async (): Promise<PlanningCodeRecord[]> => {
  if (db) {
    try {
      const { data, error } = await db.from('planning_codes').select('*').order('code', { ascending: true });
      if (error) {
        console.error("Supabase error fetching planning codes:", error);
      } else if (data) {
        return data.map(toPublicPlanningCode);
      }
    } catch (e) {
      console.error("Unexpected error fetching planning codes:", e);
    }
  }

  if (fs.existsSync(PLANNING_CODES_FILE)) {
    return JSON.parse(fs.readFileSync(PLANNING_CODES_FILE, "utf-8")).map(toPublicPlanningCode);
  }

  return [];
};

export const savePlanningCodesData = async (codes: PlanningCodeRecord[]) => {
  const normalizedCodes = codes
    .map(toPublicPlanningCode)
    .filter((code) => code.code.length > 0);

  const uniqueCodes = Array.from(
    new Map(normalizedCodes.map((code) => [code.code, code])).values(),
  );

  if (db) {
    const currentCodes = await getPlanningCodesData();
    const currentCodeSet = new Set(currentCodes.map((code) => code.code));
    const nextCodeSet = new Set(uniqueCodes.map((code) => code.code));
    const removedCodes = Array.from(currentCodeSet).filter((code) => !nextCodeSet.has(code));

    if (removedCodes.length > 0) {
      const { error: deleteError } = await db.from('planning_codes').delete().in('code', removedCodes);
      if (deleteError) throw deleteError;
    }

    if (uniqueCodes.length > 0) {
      const { error } = await db.from('planning_codes').upsert(uniqueCodes.map(toDatabasePlanningCode));
      if (error) throw error;
    }
    return;
  }

  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }

  fs.writeFileSync(PLANNING_CODES_FILE, JSON.stringify(uniqueCodes, null, 2));
};

export const toPublicPlanningMatrixHistory = (row: PlanningMatrixImportHistoryRow | PlanningMatrixImportHistoryRecord): PlanningMatrixImportHistoryRecord => ({
  id: row.id,
  createdAt: 'createdAt' in row ? row.createdAt : row.created_at,
  importedDays: 'importedDays' in row ? row.importedDays : row.imported_days,
  detectedDrivers: 'detectedDrivers' in row ? row.detectedDrivers : row.detected_drivers,
  generatedShifts: 'generatedShifts' in row ? row.generatedShifts : row.generated_shifts,
  matchedServices: 'matchedServices' in row ? row.matchedServices : row.matched_services,
  skippedAbsences: 'skippedAbsences' in row ? row.skippedAbsences : row.skipped_absences,
  unknownCodes: 'unknownCodes' in row ? row.unknownCodes : row.unknown_codes,
  unmatchedDrivers: 'unmatchedDrivers' in row ? row.unmatchedDrivers : row.unmatched_drivers,
});

export const getPlanningMatrixHistory = async (): Promise<PlanningMatrixImportHistoryRecord[]> => {
  if (db) {
    try {
      const { data, error } = await db
        .from('planning_matrix_import_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) {
        console.error("Supabase error fetching planning matrix history:", error);
      } else if (data) {
        return (data as PlanningMatrixImportHistoryRow[]).map(toPublicPlanningMatrixHistory);
      }
    } catch (e) {
      console.error("Unexpected error fetching planning matrix history:", e);
    }
  }

  if (fs.existsSync(PLANNING_MATRIX_HISTORY_FILE)) {
    return JSON.parse(fs.readFileSync(PLANNING_MATRIX_HISTORY_FILE, "utf-8")).map(toPublicPlanningMatrixHistory);
  }

  return [];
};

export const savePlanningMatrixHistoryEntry = async (entry: PlanningMatrixImportHistoryRecord) => {
  if (db) {
    try {
      const historyRow: PlanningMatrixImportHistoryRow = {
        id: entry.id,
        created_at: entry.createdAt,
        imported_days: entry.importedDays,
        detected_drivers: entry.detectedDrivers,
        generated_shifts: entry.generatedShifts,
        matched_services: entry.matchedServices,
        skipped_absences: entry.skippedAbsences,
        unknown_codes: entry.unknownCodes,
        unmatched_drivers: entry.unmatchedDrivers,
      };
      const { error } = await db.from('planning_matrix_import_history').insert(historyRow);
      if (!error) {
        return;
      }
      console.error("Supabase error saving planning matrix history:", error);
    } catch (e) {
      console.error("Unexpected error saving planning matrix history:", e);
    }
  }

  if (process.env.VERCEL) {
    return;
  }

  const existing = fs.existsSync(PLANNING_MATRIX_HISTORY_FILE)
    ? JSON.parse(fs.readFileSync(PLANNING_MATRIX_HISTORY_FILE, "utf-8"))
    : [];
  const nextHistory = [entry, ...existing].slice(0, 20);
  fs.writeFileSync(PLANNING_MATRIX_HISTORY_FILE, JSON.stringify(nextHistory, null, 2));
};

export const toPublicActivityLog = (row: ActivityLogRow | ActivityLogRecord): ActivityLogRecord => ({
  id: row.id,
  createdAt: "createdAt" in row ? row.createdAt : row.created_at,
  actorName: "actorName" in row ? row.actorName : row.actor_name,
  actorRole: "actorRole" in row ? row.actorRole : row.actor_role,
  category: row.category,
  action: row.action,
  details: row.details,
});

export const getActivityLog = async (): Promise<ActivityLogRecord[]> => {
  if (db) {
    try {
      const { data, error } = await db
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        console.error("Supabase error fetching activity log:", error);
      } else if (data) {
        return (data as ActivityLogRow[]).map(toPublicActivityLog);
      }
    } catch (e) {
      console.error("Unexpected error fetching activity log:", e);
    }
  }

  if (fs.existsSync(ACTIVITY_LOG_FILE)) {
    return JSON.parse(fs.readFileSync(ACTIVITY_LOG_FILE, "utf-8")).map(toPublicActivityLog);
  }

  return [];
};

export const saveActivityLogEntry = async (entry: ActivityLogRecord) => {
  if (db) {
    try {
      const row: ActivityLogRow = {
        id: entry.id,
        created_at: entry.createdAt,
        actor_name: entry.actorName,
        actor_role: entry.actorRole,
        category: entry.category,
        action: entry.action,
        details: entry.details,
      };
      const { error } = await db.from("activity_log").insert(row);
      if (!error) return;
      console.error("Supabase error saving activity log:", error);
    } catch (e) {
      console.error("Unexpected error saving activity log:", e);
    }
  }

  if (process.env.VERCEL) {
    return;
  }

  const existing = fs.existsSync(ACTIVITY_LOG_FILE)
    ? JSON.parse(fs.readFileSync(ACTIVITY_LOG_FILE, "utf-8"))
    : [];
  const nextEntries = [entry, ...existing].slice(0, 100);
  fs.writeFileSync(ACTIVITY_LOG_FILE, JSON.stringify(nextEntries, null, 2));
};

export const logActivity = async (
  req: AuthenticatedRequest,
  category: ActivityLogRecord["category"],
  action: string,
  details: string,
) => {
  if (!req.appUser) return;

  await saveActivityLogEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    actorName: req.appUser.name,
    actorRole: req.appUser.role,
    category,
    action,
    details,
  });
};

export const summarizeTokens = (values: Array<string | undefined | null>, limit = 4) => {
  const normalized = values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return "geen details";
  }

  const unique = Array.from(new Set(normalized));
  const visible = unique.slice(0, limit).join(", ");
  return unique.length > limit ? `${visible} +${unique.length - limit}` : visible;
};

export const summarizeUserChanges = (previousUsers: AppUser[], nextUsers: IncomingUser[]) => {
  const normalizedNextUsers = nextUsers.map(sanitizeIncomingUser);
  const previousById = new Map(previousUsers.map((user): [string, AppUser] => [String(user.id), user]));
  const nextById = new Map(normalizedNextUsers.map((user): [string, AppUser] => [String(user.id), user]));

  const added = normalizedNextUsers.filter((user) => !previousById.has(String(user.id))).map((user) => user.name);
  const removed = previousUsers.filter((user) => !nextById.has(String(user.id))).map((user) => user.name);
  const roleChanges = normalizedNextUsers
    .filter((user) => {
      const previous = previousById.get(String(user.id));
      return previous && previous.role !== user.role;
    })
    .map((user) => {
      const previous = previousById.get(String(user.id))!;
      return `${user.name} ${previous.role}->${user.role}`;
    });
  const statusChanges = normalizedNextUsers
    .filter((user) => {
      const previous = previousById.get(String(user.id));
      return previous && Boolean(previous.isActive ?? true) !== Boolean(user.isActive ?? true);
    })
    .map((user) => {
      const previous = previousById.get(String(user.id))!;
      return `${user.name} ${previous.isActive === false ? "inactief" : "actief"}->${user.isActive === false ? "inactief" : "actief"}`;
    });

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `rolwijzigingen: ${summarizeTokens(roleChanges)}`,
    `statuswijzigingen: ${summarizeTokens(statusChanges)}`,
  ].join(" · ");
};

export const summarizePlanningCodeChanges = (previousCodes: PlanningCodeRecord[], nextCodes: PlanningCodeRecord[]) => {
  const previousByCode = new Map(previousCodes.map((code): [string, PlanningCodeRecord] => [toLookupToken(code.code), code]));
  const nextByCode = new Map(nextCodes.map((code): [string, PlanningCodeRecord] => [toLookupToken(code.code), code]));

  const added = nextCodes.filter((code) => !previousByCode.has(toLookupToken(code.code))).map((code) => code.code);
  const removed = previousCodes.filter((code) => !nextByCode.has(toLookupToken(code.code))).map((code) => code.code);
  const changed = nextCodes
    .filter((code) => {
      const previous = previousByCode.get(toLookupToken(code.code));
      return previous && (
        previous.category !== code.category ||
        previous.description !== code.description ||
        previous.countsAsShift !== code.countsAsShift ||
        previous.isPaidAbsence !== code.isPaidAbsence ||
        previous.isDayOff !== code.isDayOff
      );
    })
    .map((code) => code.code);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};

export const summarizeServiceChanges = (previousServices: ServiceRecord[], nextServices: ServiceRecord[]) => {
  const previousById = new Map(previousServices.map((service): [string, ServiceRecord] => [String(service.id), service]));
  const nextById = new Map(nextServices.map((service): [string, ServiceRecord] => [String(service.id), service]));

  const added = nextServices.filter((service) => !previousById.has(String(service.id))).map((service) => service.serviceNumber);
  const removed = previousServices.filter((service) => !nextById.has(String(service.id))).map((service) => service.serviceNumber);
  const changed = nextServices
    .filter((service) => {
      const previous = previousById.get(String(service.id));
      return previous && (
        previous.serviceNumber !== service.serviceNumber ||
        previous.startTime !== service.startTime ||
        previous.endTime !== service.endTime ||
        previous.startTime2 !== service.startTime2 ||
        previous.endTime2 !== service.endTime2 ||
        previous.startTime3 !== service.startTime3 ||
        previous.endTime3 !== service.endTime3
      );
    })
    .map((service) => service.serviceNumber);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};

export const summarizeDiversionChanges = (previousDiversions: any[], nextDiversions: any[]) => {
  const previousById = new Map(previousDiversions.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextDiversions.map((item): [string, any] => [String(item.id), item]));
  const added = nextDiversions.filter((item) => !previousById.has(String(item.id))).map((item) => item.title);
  const removed = previousDiversions.filter((item) => !nextById.has(String(item.id))).map((item) => item.title);
  const changed = nextDiversions
    .filter((item) => {
      const previous = previousById.get(String(item.id));
      return previous && (
        previous.title !== item.title ||
        previous.description !== item.description ||
        previous.startDate !== item.startDate ||
        previous.endDate !== item.endDate ||
        previous.severity !== item.severity
      );
    })
    .map((item) => item.title);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};

export const summarizeUpdateChanges = (previousUpdates: any[], nextUpdates: any[]) => {
  const previousById = new Map(previousUpdates.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextUpdates.map((item): [string, any] => [String(item.id), item]));
  const added = nextUpdates.filter((item) => !previousById.has(String(item.id))).map((item) => item.title);
  const removed = previousUpdates.filter((item) => !nextById.has(String(item.id))).map((item) => item.title);
  const changed = nextUpdates
    .filter((item) => {
      const previous = previousById.get(String(item.id));
      return previous && (
        previous.title !== item.title ||
        previous.content !== item.content ||
        previous.category !== item.category ||
        Boolean(previous.isUrgent) !== Boolean(item.isUrgent)
      );
    })
    .map((item) => item.title);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};

export const getServiceSegments = (service: ServiceRecord) => (
  [
    service.startTime && service.endTime ? { startTime: service.startTime, endTime: service.endTime, segment: 1 } : null,
    service.startTime2 && service.endTime2 ? { startTime: service.startTime2, endTime: service.endTime2, segment: 2 } : null,
    service.startTime3 && service.endTime3 ? { startTime: service.startTime3, endTime: service.endTime3, segment: 3 } : null,
  ].filter(Boolean) as Array<{ startTime: string; endTime: string; segment: number }>
);

export const buildPlanningFromMatrix = async (inputRows?: PlanningMatrixRow[]) => {
  const [users, services, planningCodes] = await Promise.all([
    getUsersData(),
    getServicesData(),
    getPlanningCodesData(),
  ]);
  const rows = inputRows ?? await getPlanningMatrixRows();

  const usersByName = new Map(users.map((user): [string, AppUser] => [toLookupToken(user.name), user]));
  const servicesByNumber = new Map(
    (services as ServiceRecord[]).map((service): [string, ServiceRecord] => [toLookupToken(service.serviceNumber), service]),
  );
  const planningCodesByCode = new Map(planningCodes.map((code): [string, PlanningCodeRecord] => [toLookupToken(code.code), code]));

  const generatedShifts: ShiftRecord[] = [];
  const unknownCodes = new Set<string>();
  const unmatchedDrivers = new Set<string>();
  let matchedServices = 0;
  let skippedAbsences = 0;

  for (const row of rows) {
    for (const [driverName, rawCode] of Object.entries(row.assignments || {}) as Array<[string, string]>) {
      const driver = usersByName.get(toLookupToken(driverName));
      if (!driver) {
        unmatchedDrivers.add(driverName);
        continue;
      }

      const normalizedCode = toLookupToken(rawCode);
      const matchedService = servicesByNumber.get(normalizedCode);
      if (matchedService) {
        const segments = getServiceSegments(matchedService);
        for (const segment of segments) {
          generatedShifts.push({
            id: `${row.source_date}-${driver.id}-${matchedService.serviceNumber}-${segment.segment}`,
            date: row.source_date,
            startTime: segment.startTime,
            endTime: segment.endTime,
            line: matchedService.serviceNumber,
            busNumber: "",
            loopnr: "",
            driverId: driver.id,
          });
        }
        matchedServices += 1;
        continue;
      }

      const matchedCode = planningCodesByCode.get(normalizedCode);
      if (matchedCode) {
        if (!matchedCode.isDayOff && !matchedCode.countsAsShift) {
          skippedAbsences += 1;
        }
        continue;
      }

      unknownCodes.add(rawCode);
    }
  }

  generatedShifts.sort((a, b) => {
    const left = `${a.date} ${a.startTime} ${a.driverId}`;
    const right = `${b.date} ${b.startTime} ${b.driverId}`;
    return left.localeCompare(right);
  });

  return {
    shifts: generatedShifts,
    summary: {
      importedDays: rows.length,
      generatedShifts: generatedShifts.length,
      matchedServices,
      skippedAbsences,
      unknownCodes: Array.from(unknownCodes).sort(),
      unmatchedDrivers: Array.from(unmatchedDrivers).sort(),
    },
  };
};

export const getUsersData = async (): Promise<AppUser[]> => {
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

export const saveUsersData = async (incomingUsers: IncomingUser[]) => {
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

export const getDiversionsData = async () => {
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

export const saveDiversionsData = async (data: any) => {
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

export const getServicesData = async () => {
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

export const saveServicesData = async (data: any) => {
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

export const getUpdatesData = async () => {
  if (db) {
    try {
      const { data, error } = await db.from('updates').select('*');
      if (error) console.error("Supabase error fetching updates:", error);
      else if (data) return data.map(toPublicUpdate);
    } catch (e) {
      console.error("Unexpected error fetching updates:", e);
    }
  }
  if (fs.existsSync(UPDATES_FILE)) {
    return JSON.parse(fs.readFileSync(UPDATES_FILE, "utf-8")).map(toPublicUpdate);
  }
  return [];
};

export const saveUpdatesData = async (data: any) => {
  const normalizedData = Array.isArray(data) ? data.map(toPublicUpdate) : [];
  if (db) {
    const payloadWithoutUrgent = normalizedData.map((update) => ({
      id: String(update.id),
      date: String(update.date || ""),
      title: update.title || "",
      category: update.category || "algemeen",
      content: update.content || "",
    }));
    let { error } = await db.from('updates').upsert(payloadWithoutUrgent);
    if (error) throw error;

    // Best-effort: persist the urgent flag only when the production schema supports it.
    if (normalizedData.some((update) => Boolean(update.isUrgent))) {
      const lowerCasePayload = normalizedData.map(toDatabaseUpdate);
      const camelCasePayload = normalizedData.map((update) => ({
        ...payloadWithoutUrgent.find((item) => item.id === String(update.id)),
        isUrgent: Boolean(update.isUrgent),
      }));

      let urgentError = (await db.from('updates').upsert(lowerCasePayload)).error;
      if (urgentError && /isurgent/i.test(String(urgentError.message || ""))) {
        urgentError = (await db.from('updates').upsert(camelCasePayload)).error;
      }
      if (urgentError) {
        console.warn("Urgent flag for updates kon niet worden opgeslagen. Update zelf is wel bewaard.", urgentError);
      }
    }

    return;
  }
  if (process.env.VERCEL) throw new Error("Supabase is niet geconfigureerd op Vercel.");
  fs.writeFileSync(UPDATES_FILE, JSON.stringify(normalizedData, null, 2));
};

export const getSwapsData = async () => {
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

export const saveSwapsData = async (data: any) => {
  const normalizedData = Array.isArray(data) ? data.map(toPublicSwap) : [];
  if (db) {
    const { error } = await db.from('swaps').upsert(normalizedData.map(toDatabaseSwap));
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) throw new Error("Supabase is niet geconfigureerd op Vercel.");
  fs.writeFileSync(SWAPS_FILE, JSON.stringify(normalizedData, null, 2));
};

export const getLeaveData = async () => {
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

export const saveLeaveData = async (data: any) => {
  const normalizedData = Array.isArray(data) ? data.map(toPublicLeave) : [];
  if (db) {
    const { error } = await db.from('leave').upsert(normalizedData.map(toDatabaseLeave));
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) throw new Error("Supabase is niet geconfigureerd op Vercel.");
  fs.writeFileSync(LEAVE_FILE, JSON.stringify(normalizedData, null, 2));
};

