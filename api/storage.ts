import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import type {
  ActivityLogRecord,
  ActivityLogRow,
  AppUser,
  AuthenticatedRequest,
  IncomingUser,
  PlanningCodeRecord,
  PlanningMatrixImportHistoryRecord,
  PlanningMatrixImportHistoryRow,
  PlanningMatrixRow,
  ServiceRecord,
  ShiftRecord,
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
  toDatabaseService,
  toDatabaseSwap,
  toDatabaseUpdate,
  toDatabaseUser,
  toLookupToken,
  toPublicDiversion,
  toPublicLeave,
  toPublicPlanningCode,
  toPublicService,
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

// Herkent een rpc-fout die betekent "deze Postgres-functie bestaat niet"
// (de transactionele replace-SQL is nog niet gedraaid). ENKEL dan vallen we
// terug op het JS-pad. Bij een échte fout NIET terugvallen: de transactie is
// dan al teruggerold (tabel intact) en delete+insert zou alsnog kunnen wissen.
const isMissingDbFunction = (error: any): boolean =>
  error?.code === "PGRST202" ||
  /could not find the function|function .*does not exist|schema cache/i.test(String(error?.message ?? ""));

// Supabase/PostgREST cap'pt by default op 1000 rijen per response. Voor
// tabellen die door de tijd groeien (planning, matrix_rows, leave, ...)
// MOETEN we expliciet paginëren — anders raakt elke caller stilletjes
// data kwijt zodra de tabel de cap overschrijdt. Dat was de oorzaak van
// het "eind mei verdwijnt"-incident.
const PAGE_SIZE = 1000;
const paginatedFetch = async <T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> => {
  const all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
};

// --- Planning ---

// Optionele filters laten de /api/planning-endpoint één maand of één
// chauffeur ophalen i.p.v. de hele tabel — scheelt drastisch in
// data-overdracht voor mobile-clients en de maandprint.
export type PlanningFilters = { driverId?: string; monthIso?: string };

export const getPlanningData = async (filters?: PlanningFilters) => {
  const client = requireDb();
  return paginatedFetch((from, to) => {
    let q = client.from('planning').select('*').order('id', { ascending: true });
    if (filters?.driverId) {
      q = q.eq('driverId', filters.driverId);
    }
    if (filters?.monthIso && /^\d{4}-\d{2}$/.test(filters.monthIso)) {
      // date is text; gebruik string-prefix-match in ISO-formaat
      q = q.like('date', `${filters.monthIso}-%`);
    }
    return q.range(from, to);
  });
};

export const savePlanningData = async (data: any) => {
  const client = requireDb();
  if (!Array.isArray(data)) {
    throw new Error("Ongeldige planning-data: een array van diensten verwacht.");
  }
  // Volledige wipe gaat bewust NIET via dit pad (zie clearPlanningData +
  // de admin-check in de handler) — een per ongeluk lege payload mag de
  // planning nooit stil wissen.
  if (data.length === 0) return;
  // Replace-semantiek: eerst upserten, daarna pas de ontbrekende rijen
  // verwijderen. Faalt de delete, dan staan er hooguit extra rijen — nooit
  // een (deels) lege tabel.
  const incomingIds = new Set(data.map((s: any) => String(s.id)));
  const { data: existing, error: fetchError } = await client.from('planning').select('id');
  if (fetchError) throw fetchError;
  const { error } = await client.from('planning').upsert(data);
  if (error) throw error;
  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));
  if (idsToDelete.length > 0) {
    const { error: deleteError } = await client.from('planning').delete().in('id', idsToDelete);
    if (deleteError) throw deleteError;
  }
};

/** Eén shift gericht opzoeken (eigendoms-checks bij dienstruil). */
export const getShiftById = async (id: string): Promise<{ id: string; driverId: string } | null> => {
  if (!id) return null;
  const client = requireDb();
  const { data, error } = await client.from('planning').select('id, driverId').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: String((data as any).id), driverId: String((data as any).driverId ?? '') };
};

/** Volledige planning wissen — alleen voor de expliciete admin-actie. */
export const clearPlanningData = async () => {
  const client = requireDb();
  const { error } = await client.from('planning').delete().neq('id', '__never_match__');
  if (error) throw error;
};

export const replacePlanningData = async (data: ShiftRecord[]) => {
  const client = requireDb();
  // Veiligheid: weiger de planning te wissen met een lege/ongeldige set.
  // replacePlanningData wist ALLE planning en zet er de nieuwe set voor in de
  // plaats; dit wordt enkel door import/sync aangeroepen, die altijd rijen
  // horen te produceren. De empty-check stond vroeger impliciet ná de delete
  // (insert enkel bij length>0) → een lege set wiste stil de hele planning.
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Lege planning-set geweigerd: dit zou alle planning wissen. Een import/sync hoort diensten te bevatten.");
  }
  // Voorkeur: atomair via de Postgres-functie (delete+insert in één
  // transactie) — geen leeg-tabel-venster als de insert zou falen.
  const { error: rpcError } = await client.rpc('replace_planning', { rows: data });
  if (!rpcError) return;
  if (!isMissingDbFunction(rpcError)) throw rpcError;
  // Functie bestaat (nog) niet → veilig JS-pad met de empty-guard hierboven.
  const { error: deleteError } = await client.from('planning').delete().neq('id', '__never__');
  if (deleteError) throw deleteError;
  const { error: insertError } = await client.from('planning').insert(data);
  if (insertError) throw insertError;
};

// --- Planning matrix rows ---

export const getPlanningMatrixRows = async (): Promise<PlanningMatrixRow[]> => {
  const client = requireDb();
  return paginatedFetch<PlanningMatrixRow>((from, to) =>
    client
      .from('planning_matrix_rows')
      .select('*')
      .order('source_date', { ascending: true })
      .range(from, to),
  );
};

// Replace-semantiek: wis alle bestaande rijen, dan insert. Vroeger werd
// `upsert` gebruikt op `id`, maar omdat de ID-vorming verschilde tussen
// CSV- en XLSX-imports (verschillende rij-nummering), stapelden oude
// imports zich op als "ghost rows". Dat veroorzaakte 549 extra rijen
// over 549 ghost-datums. Nu maakt elke import schoon werk.
export const savePlanningMatrixRows = async (rows: PlanningMatrixRow[]) => {
  const client = requireDb();
  // Veiligheid: nooit wissen op een lege set — dat zou de volledige
  // matrixplanning wegvegen. De empty-check stond vroeger ná de delete, dus
  // een lege import wiste eerst alles en stopte dan (data-verlies).
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Lege matrix-set geweigerd: dit zou de volledige matrixplanning wissen.");
  }
  // Voorkeur: atomair via de Postgres-functie; val enkel terug op het JS-pad
  // als die functie nog niet bestaat (SQL niet gedraaid).
  const { error: rpcError } = await client.rpc('replace_planning_matrix_rows', { rows });
  if (!rpcError) return;
  if (!isMissingDbFunction(rpcError)) throw rpcError;
  const { error: deleteError } = await client.from('planning_matrix_rows').delete().neq('id', '__never__');
  if (deleteError) throw deleteError;
  const { error: insertError } = await client.from('planning_matrix_rows').insert(rows);
  if (insertError) throw insertError;
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
  entityType:
    "entityType" in row ? row.entityType ?? null : (row as ActivityLogRow).entity_type ?? null,
  entityId:
    "entityId" in row ? row.entityId ?? null : (row as ActivityLogRow).entity_id ?? null,
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

/**
 * Per-entity geschiedenis: alle activity-log entries voor één specifieke
 * entity (bv. één service, één swap). Wordt gebruikt door de "Geschiedenis"-
 * modal vanuit admin-views.
 */
export const getEntityHistory = async (
  entityType: NonNullable<ActivityLogRecord["entityType"]>,
  entityId: string,
): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(200);
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
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
  };
  const { error } = await client.from("activity_log").insert(row);
  if (error) console.error("Supabase error saving activity log:", error);
};

export const logActivity = async (
  req: AuthenticatedRequest,
  category: ActivityLogRecord["category"],
  action: string,
  details: string,
  entity?: { type: NonNullable<ActivityLogRecord["entityType"]>; id: string },
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
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
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

/**
 * Structureel diff van service-changes — geeft per categorie de records terug
 * (i.p.v. alleen een summary-string). Gebruikt door de API om per-service
 * activity-log entries te schrijven met entity_id, zodat we per-service
 * wijzigingsgeschiedenis kunnen tonen.
 */
export const diffServiceChanges = (
  previousServices: ServiceRecord[],
  nextServices: ServiceRecord[],
): { added: ServiceRecord[]; removed: ServiceRecord[]; changed: ServiceRecord[] } => {
  const previousById = new Map(previousServices.map((service): [string, ServiceRecord] => [String(service.id), service]));
  const nextById = new Map(nextServices.map((service): [string, ServiceRecord] => [String(service.id), service]));

  const added = nextServices.filter((service) => !previousById.has(String(service.id)));
  const removed = previousServices.filter((service) => !nextById.has(String(service.id)));
  const changed = nextServices.filter((service) => {
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
  });

  return { added, removed, changed };
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

/** Structurele diff per omleiding voor per-entity audit-logging. */
export const diffDiversionChanges = (previousDiversions: any[], nextDiversions: any[]) => {
  const previousById = new Map(previousDiversions.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextDiversions.map((item): [string, any] => [String(item.id), item]));
  const added = nextDiversions.filter((item) => !previousById.has(String(item.id)));
  const removed = previousDiversions.filter((item) => !nextById.has(String(item.id)));
  const changed = nextDiversions.filter((item) => {
    const previous = previousById.get(String(item.id));
    return previous && (
      previous.title !== item.title ||
      previous.description !== item.description ||
      previous.startDate !== item.startDate ||
      previous.endDate !== item.endDate ||
      previous.severity !== item.severity ||
      previous.line !== item.line ||
      previous.pdfUrl !== item.pdfUrl
    );
  });
  return { added, removed, changed };
};

/** Structurele diff per update voor per-entity audit-logging. */
export const diffUpdateChanges = (previousUpdates: any[], nextUpdates: any[]) => {
  const previousById = new Map(previousUpdates.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextUpdates.map((item): [string, any] => [String(item.id), item]));
  const added = nextUpdates.filter((item) => !previousById.has(String(item.id)));
  const removed = previousUpdates.filter((item) => !nextById.has(String(item.id)));
  const changed = nextUpdates.filter((item) => {
    const previous = previousById.get(String(item.id));
    return previous && (
      previous.title !== item.title ||
      previous.content !== item.content ||
      previous.category !== item.category ||
      Boolean(previous.isUrgent) !== Boolean(item.isUrgent)
    );
  });
  return { added, removed, changed };
};

/** Structurele diff per gebruiker voor per-entity audit-logging. */
export const diffUserChanges = (previousUsers: AppUser[], nextUsers: IncomingUser[]) => {
  const normalizedNextUsers = nextUsers.map(sanitizeIncomingUser);
  const previousById = new Map(previousUsers.map((user): [string, AppUser] => [String(user.id), user]));
  const nextById = new Map(normalizedNextUsers.map((user): [string, AppUser] => [String(user.id), user]));

  const added = normalizedNextUsers.filter((user) => !previousById.has(String(user.id)));
  const removed = previousUsers.filter((user) => !nextById.has(String(user.id)));
  const changed = normalizedNextUsers
    .filter((user) => {
      const previous = previousById.get(String(user.id));
      if (!previous) return false;
      return (
        previous.name !== user.name ||
        previous.role !== user.role ||
        previous.employeeId !== user.employeeId ||
        previous.phone !== user.phone ||
        previous.email !== user.email ||
        previous.verlofBudget !== user.verlofBudget ||
        Boolean(previous.isActive ?? true) !== Boolean(user.isActive ?? true)
      );
    })
    .map((user) => {
      const previous = previousById.get(String(user.id))!;
      const fields: string[] = [];
      if (previous.name !== user.name) fields.push(`naam: ${previous.name}→${user.name}`);
      if (previous.role !== user.role) fields.push(`rol: ${previous.role}→${user.role}`);
      if (previous.employeeId !== user.employeeId) fields.push(`employeeId: ${previous.employeeId}→${user.employeeId}`);
      if (previous.phone !== user.phone) fields.push(`telefoon`);
      if (previous.email !== user.email) fields.push(`email`);
      if (previous.verlofBudget !== user.verlofBudget) fields.push(`verlofBudget: ${previous.verlofBudget ?? 'standaard'}→${user.verlofBudget ?? 'standaard'}`);
      if (Boolean(previous.isActive ?? true) !== Boolean(user.isActive ?? true)) {
        fields.push(`status: ${previous.isActive === false ? 'inactief' : 'actief'}→${user.isActive === false ? 'inactief' : 'actief'}`);
      }
      return { user, fields };
    });

  return { added, removed, changed };
};

/** Structurele diff per planning-code voor per-entity audit-logging. */
export const diffPlanningCodeChanges = (
  previousCodes: PlanningCodeRecord[],
  nextCodes: PlanningCodeRecord[],
) => {
  const previousByCode = new Map(previousCodes.map((c): [string, PlanningCodeRecord] => [toLookupToken(c.code), c]));
  const nextByCode = new Map(nextCodes.map((c): [string, PlanningCodeRecord] => [toLookupToken(c.code), c]));
  const added = nextCodes.filter((c) => !previousByCode.has(toLookupToken(c.code)));
  const removed = previousCodes.filter((c) => !nextByCode.has(toLookupToken(c.code)));
  const changed = nextCodes.filter((c) => {
    const previous = previousByCode.get(toLookupToken(c.code));
    return previous && (
      previous.category !== c.category ||
      previous.description !== c.description ||
      previous.countsAsShift !== c.countsAsShift ||
      previous.isPaidAbsence !== c.isPaidAbsence ||
      previous.isDayOff !== c.isDayOff
    );
  });
  return { added, removed, changed };
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

const isValidHHMM = (v?: string) => !!v && /^\d{1,2}:\d{2}$/.test(v.trim());
const validSegment = (start: string | undefined, end: string | undefined, segment: number) =>
  isValidHHMM(start) && isValidHHMM(end)
    ? { startTime: start as string, endTime: end as string, segment }
    : null;

export const getServiceSegments = (service: ServiceRecord) => (
  [
    validSegment(service.startTime, service.endTime, 1),
    validSegment(service.startTime2, service.endTime2, 2),
    validSegment(service.startTime3, service.endTime3, 3),
  ].filter(Boolean) as Array<{ startTime: string; endTime: string; segment: number }>
);

export const buildPlanningFromMatrix = async (inputRows?: PlanningMatrixRow[]) => {
  const [users, services, planningCodes] = await Promise.all([
    getUsersData(),
    getServicesData(),
    getPlanningCodesData(),
  ]);
  const rows = inputRows ?? await getPlanningMatrixRows();

  // Volgorde-onafhankelijke naam-key zodat 'Pascal Duysburgh' en
  // 'Duysburgh Pascal' beide naar dezelfde gebruiker matchen.
  const sortedNameToken = (name: string) =>
    toLookupToken(name)
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(" ");
  const usersByName = new Map<string, AppUser>();
  for (const u of users) {
    usersByName.set(toLookupToken(u.name), u);
    usersByName.set(sortedNameToken(u.name), u);
  }
  const servicesByNumber = new Map(
    (services as ServiceRecord[]).map((service): [string, ServiceRecord] => [toLookupToken(service.serviceNumber), service]),
  );
  const planningCodesByCode = new Map(planningCodes.map((code): [string, PlanningCodeRecord] => [toLookupToken(code.code), code]));

  const generatedShifts: ShiftRecord[] = [];
  const unknownCodes = new Set<string>();
  const unmatchedDrivers = new Set<string>();
  // Services die WEL matchen op nummer maar GEEN valid HH:MM-segmenten
  // bevatten (bijv. omdat alle startTime/endTime velden leeg zijn) —
  // voorheen telden die als "matched" maar produceerden 0 planning-rijen.
  // Dit is precies de silent gap waar het Yves-incident door ontstond.
  const servicesWithoutSegments = new Set<string>();
  // Per-chauffeur counters voor de preview-breakdown.
  const perDriver = new Map<
    string,
    {
      driverName: string;
      driverId: string;
      daysWithCode: number;
      shiftsGenerated: number;
      servicesMatched: number;
      absences: number;
      servicesWithoutSegments: number;
    }
  >();
  const bumpDriver = (driver: AppUser, name: string) => {
    let entry = perDriver.get(driver.id);
    if (!entry) {
      entry = {
        driverName: driver.name || name,
        driverId: driver.id,
        daysWithCode: 0,
        shiftsGenerated: 0,
        servicesMatched: 0,
        absences: 0,
        servicesWithoutSegments: 0,
      };
      perDriver.set(driver.id, entry);
    }
    return entry;
  };
  let matchedServices = 0;
  let skippedAbsences = 0;

  for (const row of rows) {
    for (const [driverName, rawCode] of Object.entries(row.assignments || {}) as Array<[string, string]>) {
      const driver =
        usersByName.get(toLookupToken(driverName)) ||
        usersByName.get(sortedNameToken(driverName));
      if (!driver) {
        unmatchedDrivers.add(driverName);
        continue;
      }

      const driverStats = bumpDriver(driver, driverName);
      driverStats.daysWithCode += 1;

      const normalizedCode = toLookupToken(rawCode);
      const matchedService = servicesByNumber.get(normalizedCode);
      if (matchedService) {
        const segments = getServiceSegments(matchedService);
        if (segments.length === 0) {
          // Service-nummer matcht maar bevat geen HH:MM-segmenten. Niet
          // stil voorbij laten gaan: vlag voor de preview-waarschuwing.
          servicesWithoutSegments.add(matchedService.serviceNumber);
          driverStats.servicesWithoutSegments += 1;
        }
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
          driverStats.shiftsGenerated += 1;
        }
        matchedServices += 1;
        driverStats.servicesMatched += 1;
        continue;
      }

      const matchedCode = planningCodesByCode.get(normalizedCode);
      if (matchedCode) {
        if (!matchedCode.isDayOff && !matchedCode.countsAsShift) {
          skippedAbsences += 1;
        }
        driverStats.absences += 1;
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
      servicesWithoutSegments: Array.from(servicesWithoutSegments).sort(),
      perDriver: Array.from(perDriver.values()).sort((a, b) => a.driverName.localeCompare(b.driverName)),
    },
  };
};

// --- Users ---

export const getUsersData = async (): Promise<AppUser[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('users').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicUser);
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

/** Gericht sessie-metadata bijwerken — alléén de eigen rij.
 * Voorheen liep elke login/logout via saveUsersData (replace-all incl.
 * Supabase-auth-sync): gelijktijdige logins raceten met elkaar én met
 * admin-bewerkingen (een net verwijderde gebruiker kon zo terugkomen). */
export const updateUserSessionMeta = async (
  userId: string,
  fields: { lastLogin?: string; activeSessions?: number },
) => {
  const client = requireDb();
  const patch: Record<string, unknown> = {};
  if (fields.lastLogin !== undefined) patch.lastlogin = fields.lastLogin;
  if (fields.activeSessions !== undefined) patch.activesessions = fields.activeSessions;
  if (Object.keys(patch).length === 0) return;
  const { error } = await client.from('users').update(patch).eq('id', String(userId));
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
  const rows = await paginatedFetch((from, to) =>
    client.from('diversions').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicDiversion);
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
  const rows = await paginatedFetch((from, to) =>
    client.from('services').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicService);
};

export const saveServicesData = async (data: any) => {
  const client = requireDb();
  const normalized = Array.isArray(data) ? data.map(toPublicService) : [];
  const rows = normalized.map(toDatabaseService);
  // Replace-semantiek zónder leeg-tabel-venster: eerst upserten, daarna pas
  // de ontbrekende rijen verwijderen. Het oude delete-alles-dan-insert kon
  // bij een insert-fout (netwerk/constraint/timeout) een lege dienstentabel
  // achterlaten — en daarmee elke volgende matrix-import breken.
  const incomingIds = new Set(rows.map((r: any) => String(r.id)));
  const { data: existing, error: fetchError } = await client.from('services').select('id');
  if (fetchError) throw fetchError;
  if (rows.length > 0) {
    const { error: upsertError } = await client.from('services').upsert(rows);
    if (upsertError) throw upsertError;
  }
  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));
  if (idsToDelete.length > 0) {
    const { error: deleteError } = await client.from('services').delete().in('id', idsToDelete);
    if (deleteError) throw deleteError;
  }
};

// --- Updates ---

export const getUpdatesData = async () => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('updates').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicUpdate);
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
  const rows = await paginatedFetch((from, to) =>
    client.from('swaps').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicSwap);
};

export const saveSwapsData = async (data: any, idsToDelete: string[] = []) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicSwap) : [];
  if (normalizedData.length > 0) {
    const { error } = await client.from('swaps').upsert(normalizedData.map(toDatabaseSwap));
    if (error) throw error;
  }
  // Intrekkingen: gevalideerd door de handler (zie POST /api/swaps).
  if (idsToDelete.length > 0) {
    const { error } = await client.from('swaps').delete().in('id', idsToDelete.map(String));
    if (error) throw error;
  }
};

// --- Leave ---

export const getLeaveData = async () => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('leave').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicLeave);
};

export const saveLeaveData = async (data: any, idsToDelete: string[] = []) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicLeave) : [];
  if (normalizedData.length > 0) {
    const { error } = await client.from('leave').upsert(normalizedData.map(toDatabaseLeave));
    if (error) throw error;
  }
  // Intrekkingen: de handler valideert scope + status; hier alleen uitvoeren.
  // Zonder dit was 'aanvraag intrekken' een stille no-op (upsert raakt
  // ontbrekende rijen niet) en kwam de aanvraag na refresh terug.
  if (idsToDelete.length > 0) {
    const { error } = await client.from('leave').delete().in('id', idsToDelete.map(String));
    if (error) throw error;
  }
};

// --- Coverage expectations (verwachte diensten per dag-type) ---
// Vereist een tabel `coverage_expectations (day_type text primary key,
// service_numbers text[])`. Als die (nog) niet bestaat geven we leeg terug
// zodat de app niet crasht vóór de migratie gedraaid is.
export const getCoverageExpectations = async (): Promise<Record<string, string[]>> => {
  const client = requireDb();
  const { data, error } = await client.from('coverage_expectations').select('*');
  if (error) {
    // Alleen 'tabel bestaat (nog) niet' tolereren — andere fouten (netwerk,
    // permissies) doorgooien, anders lijkt een transiente fout op een lege
    // config en kan een goedbedoelde save de echte config overschrijven.
    const missingTable = (error as any).code === '42P01' || /does not exist|relation .* not/i.test(error.message || '');
    if (missingTable) {
      console.warn('coverage_expectations niet beschikbaar (migratie gedraaid?):', error.message);
      return {};
    }
    throw error;
  }
  const map: Record<string, string[]> = {};
  for (const row of data || []) {
    const dayType = String((row as any).day_type ?? '').trim();
    if (!dayType) continue;
    const raw = (row as any).service_numbers;
    map[dayType] = Array.isArray(raw) ? raw.map((s: any) => String(s)) : [];
  }
  return map;
};

// Replace-semantiek: de hele dekkings-config wordt telkens volledig
// meegestuurd, dus wis eerst alles en zet dan de nieuwe set. Zo verdwijnen
// verwijderde dag-types ook echt (een upsert liet "ghost"-rijen staan).
export const saveCoverageExpectations = async (map: Record<string, string[]>) => {
  const client = requireDb();
  const rows = Object.entries(map || {}).map(([day_type, service_numbers]) => ({
    day_type: String(day_type),
    service_numbers: Array.isArray(service_numbers) ? service_numbers.map((s) => String(s)) : [],
  }));
  const { error: deleteError } = await client.from('coverage_expectations').delete().neq('day_type', '__never_match__');
  if (deleteError) throw deleteError;
  if (rows.length === 0) return;
  const { error: insertError } = await client.from('coverage_expectations').insert(rows);
  if (insertError) throw insertError;
};
