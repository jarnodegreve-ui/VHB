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
  ServiceRecord,
  ShiftRecord,
  SwapRecord,
} from "./types.js";
import {
  countAdmins,
  ensureUniqueUserEmails,
  normalizeEmail,
  randomPassword,
  sanitizeIncomingUser,
  toDatabaseDiversion,
  toDatabaseLeave,
  toDatabasePlanningCode,
  toDatabaseSwap,
  toDatabaseUpdate,
  toDatabaseUser,
  toLookupToken,
  toPublicDiversion,
  toPublicLeave,
  toPublicPlanningCode,
  toPublicSwap,
  toPublicUpdate,
  toPublicUser,
} from "./helpers.js";
import { db, supabaseAdmin } from "./db.js";

const requireDb = () => {
  if (!db) {
    throw new Error("Supabase is niet geconfigureerd. Stel SUPABASE_URL en SUPABASE_ANON_KEY (en SUPABASE_SERVICE_ROLE_KEY) in als env vars.");
  }
  return db;
};

// --- Planning ---

export const getPlanningData = async () => {
  const client = requireDb();
  const { data, error } = await client.from('planning').select('*');
  if (error) throw error;
  return data ?? [];
};

export const savePlanningData = async (data: any) => {
  const client = requireDb();
  const { error } = await client.from('planning').upsert(data);
  if (error) throw error;
};

export const replacePlanningData = async (data: ShiftRecord[]) => {
  const client = requireDb();
  const { error: deleteError } = await client.from('planning').delete().neq('id', '__never__');
  if (deleteError) throw deleteError;

  if (data.length > 0) {
    const { error: insertError } = await client.from('planning').insert(data);
    if (insertError) throw insertError;
  }
};

// --- Planning matrix rows ---

export const getPlanningMatrixRows = async (): Promise<PlanningMatrixRow[]> => {
  const client = requireDb();
  const { data, error } = await client
    .from('planning_matrix_rows')
    .select('*')
    .order('source_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanningMatrixRow[];
};

export const savePlanningMatrixRows = async (rows: PlanningMatrixRow[]) => {
  const client = requireDb();
  const { error } = await client.from('planning_matrix_rows').upsert(rows);
  if (error) throw error;
};

// --- Planning codes ---

export const getPlanningCodesData = async (): Promise<PlanningCodeRecord[]> => {
  const client = requireDb();
  const { data, error } = await client
    .from('planning_codes')
    .select('*')
    .order('code', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toPublicPlanningCode);
};

export const savePlanningCodesData = async (codes: PlanningCodeRecord[]) => {
  const client = requireDb();
  const normalizedCodes = codes
    .map(toPublicPlanningCode)
    .filter((code) => code.code.length > 0);

  const uniqueCodes = Array.from(
    new Map(normalizedCodes.map((code) => [code.code, code])).values(),
  );

  const currentCodes = await getPlanningCodesData();
  const currentCodeSet = new Set(currentCodes.map((code) => code.code));
  const nextCodeSet = new Set(uniqueCodes.map((code) => code.code));
  const removedCodes = Array.from(currentCodeSet).filter((code) => !nextCodeSet.has(code));

  if (removedCodes.length > 0) {
    const { error: deleteError } = await client.from('planning_codes').delete().in('code', removedCodes);
    if (deleteError) throw deleteError;
  }

  if (uniqueCodes.length > 0) {
    const { error } = await client.from('planning_codes').upsert(uniqueCodes.map(toDatabasePlanningCode));
    if (error) throw error;
  }
};

// --- Planning matrix import history ---

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
  const client = requireDb();
  const { data, error } = await client
    .from('planning_matrix_import_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return ((data ?? []) as PlanningMatrixImportHistoryRow[]).map(toPublicPlanningMatrixHistory);
};

export const savePlanningMatrixHistoryEntry = async (entry: PlanningMatrixImportHistoryRecord) => {
  const client = requireDb();
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
  const { error } = await client.from('planning_matrix_import_history').insert(historyRow);
  if (error) console.error("Supabase error saving planning matrix history:", error);
};

// --- Activity log ---

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
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as ActivityLogRow[]).map(toPublicActivityLog);
};

export const saveActivityLogEntry = async (entry: ActivityLogRecord) => {
  const client = requireDb();
  const row: ActivityLogRow = {
    id: entry.id,
    created_at: entry.createdAt,
    actor_name: entry.actorName,
    actor_role: entry.actorRole,
    category: entry.category,
    action: entry.action,
    details: entry.details,
  };
  const { error } = await client.from("activity_log").insert(row);
  if (error) console.error("Supabase error saving activity log:", error);
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

// --- Change summarizers (pure utilities used by routes) ---

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

// --- Service segment helpers + planning build from matrix ---

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

// --- Users ---

export const getUsersData = async (): Promise<AppUser[]> => {
  const client = requireDb();
  const { data, error } = await client.from('users').select('*');
  if (error) throw error;
  return (data ?? []).map(toPublicUser);
};

export const saveUsersData = async (incomingUsers: IncomingUser[]) => {
  const client = requireDb();
  if (!supabaseAdmin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt. Gebruikersbeheer vereist een service role key.");
  }

  ensureUniqueUserEmails(incomingUsers);

  const sanitizedUsers = incomingUsers.map(sanitizeIncomingUser);
  if (countAdmins(sanitizedUsers) === 0) {
    throw new Error("Er moet minstens 1 actieve admin overblijven.");
  }

  const currentUsers = await getUsersData();
  const currentById = new Map<string, AppUser>(currentUsers.map((user): [string, AppUser] => [String(user.id), user]));
  const incomingIds = new Set(sanitizedUsers.map((user) => String(user.id)));

  const { data: authPage, error: authListError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authListError) throw authListError;

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

    if (!currentEmail) continue;

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
    const { error } = await client.from('users').delete().in('id', removedUserIds);
    if (error) throw error;
  }

  const databaseUsers = sanitizedUsers.map(toDatabaseUser);
  const { error } = await client.from('users').upsert(databaseUsers);
  if (error) throw error;
};

// --- Diversions ---

export const DIVERSIONS_BUCKET = "diversions";

export const removeDiversionPdfs = async (diversionIds: string[]) => {
  if (!supabaseAdmin || diversionIds.length === 0) return;
  const paths = diversionIds.map((id) => `${id}.pdf`);
  const { error } = await supabaseAdmin.storage.from(DIVERSIONS_BUCKET).remove(paths);
  if (error) console.warn("Diversion PDF storage cleanup error:", error);
};

export const getDiversionsData = async () => {
  const client = requireDb();
  const { data, error } = await client.from('diversions').select('*');
  if (error) throw error;
  return (data ?? []).map(toPublicDiversion);
};

export const saveDiversionsData = async (data: any) => {
  const client = requireDb();
  const normalized = Array.isArray(data) ? data.map(toPublicDiversion) : [];
  const incomingIds = new Set(normalized.map((d) => String(d.id)));

  const { data: existing, error: fetchError } = await client.from('diversions').select('id');
  if (fetchError) throw fetchError;

  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await client.from('diversions').delete().in('id', idsToDelete);
    if (deleteError) throw deleteError;
    // Best-effort: also remove the PDFs from Storage.
    await removeDiversionPdfs(idsToDelete);
  }

  if (normalized.length > 0) {
    const { error: upsertError } = await client.from('diversions').upsert(normalized.map(toDatabaseDiversion));
    if (upsertError) throw upsertError;
  }
};

// --- Services ---

export const getServicesData = async () => {
  const client = requireDb();
  const { data, error } = await client.from('services').select('*');
  if (error) throw error;
  return data ?? [];
};

export const saveServicesData = async (data: any) => {
  const client = requireDb();
  // Replace-all semantics: drop then insert. Upsert fallback if delete fails
  // (for example when RLS policies prevent delete on an empty table).
  const { error: deleteError } = await client.from('services').delete().neq('id', '0');
  if (deleteError) {
    const { error: upsertError } = await client.from('services').upsert(data);
    if (upsertError) throw upsertError;
    return;
  }
  if (data.length > 0) {
    const { error: insertError } = await client.from('services').insert(data);
    if (insertError) throw insertError;
  }
};

// --- Updates ---

export const getUpdatesData = async () => {
  const client = requireDb();
  const { data, error } = await client.from('updates').select('*');
  if (error) throw error;
  return (data ?? []).map(toPublicUpdate);
};

export const saveUpdatesData = async (data: any) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicUpdate) : [];

  const incomingIds = new Set(normalizedData.map((u) => String(u.id)));
  const { data: existing, error: fetchError } = await client.from('updates').select('id');
  if (fetchError) throw fetchError;

  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await client.from('updates').delete().in('id', idsToDelete);
    if (deleteError) throw deleteError;
  }

  const payloadWithoutUrgent = normalizedData.map((update) => ({
    id: String(update.id),
    date: String(update.date || ""),
    title: update.title || "",
    category: update.category || "algemeen",
    content: update.content || "",
  }));
  if (payloadWithoutUrgent.length > 0) {
    const { error } = await client.from('updates').upsert(payloadWithoutUrgent);
    if (error) throw error;
  }

  // Best-effort: persist the urgent flag only when the production schema supports it.
  if (normalizedData.some((update) => Boolean(update.isUrgent))) {
    const lowerCasePayload = normalizedData.map(toDatabaseUpdate);
    const camelCasePayload = normalizedData.map((update) => ({
      ...payloadWithoutUrgent.find((item) => item.id === String(update.id)),
      isUrgent: Boolean(update.isUrgent),
    }));

    let urgentError = (await client.from('updates').upsert(lowerCasePayload)).error;
    if (urgentError && /isurgent/i.test(String(urgentError.message || ""))) {
      urgentError = (await client.from('updates').upsert(camelCasePayload)).error;
    }
    if (urgentError) {
      console.warn("Urgent flag for updates kon niet worden opgeslagen. Update zelf is wel bewaard.", urgentError);
    }
  }
};

// --- Swaps ---

export const getSwapsData = async () => {
  const client = requireDb();
  const { data, error } = await client.from('swaps').select('*');
  if (error) throw error;
  return (data ?? []).map(toPublicSwap);
};

export const saveSwapsData = async (data: any) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicSwap) : [];
  const { error } = await client.from('swaps').upsert(normalizedData.map(toDatabaseSwap));
  if (error) throw error;
};

// --- Leave ---

export const getLeaveData = async () => {
  const client = requireDb();
  const { data, error } = await client.from('leave').select('*');
  if (error) throw error;
  return (data ?? []).map(toPublicLeave);
};

export const saveLeaveData = async (data: any) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicLeave) : [];
  const { error } = await client.from('leave').upsert(normalizedData.map(toDatabaseLeave));
  if (error) throw error;
};
