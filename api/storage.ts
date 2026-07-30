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
export const isMissingDbFunction = (error: any): boolean =>
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
  max?: number,
): Promise<T[]> => {
  const all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    all.push(...batch);
    if (max !== undefined && all.length >= max) return all.slice(0, max);
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
  // Gepagineerd ophalen: een ongepagineerde select('id') cap't op 1000 rijen,
  // waardoor planning >1000 shifts stale rijen liet staan na import/herstel.
  const existing = await paginatedFetch((from, to) =>
    client.from('planning').select('id').order('id', { ascending: true }).range(from, to),
  );
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
const savePlanningMatrixRows = async (rows: PlanningMatrixRow[]) => {
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

/**
 * Atomische import: matrix + afgeleide planning in ÉÉN transactie vervangen
 * (RPC replace_planning_and_matrix). Voorheen waren dit twee losse replaces:
 * faalde de tweede, dan toonde de Maandplanning (matrix) een andere maand dan
 * de roosters (planning) — skew. Een lege shifts-set is toegestaan (import
 * met enkel verlof-/afwezigheidscodes): de planning volgt de matrix en wordt
 * dan bewust mee geleegd.
 *
 * Fallback zolang de RPC niet bestaat (migratie nog niet gedraaid): het oude
 * sequentiële pad — mét de oude beperking dat een lege shifts-set geweigerd
 * wordt, omdat het niet-atomische pad een wipe niet veilig kan garanderen.
 */
export const replacePlanningAndMatrix = async (rows: PlanningMatrixRow[], shifts: ShiftRecord[]) => {
  const client = requireDb();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Lege matrix-set geweigerd: dit zou de volledige matrixplanning wissen.");
  }
  const { error: rpcError } = await client.rpc('replace_planning_and_matrix', {
    matrix_rows: rows,
    shifts: Array.isArray(shifts) ? shifts : [],
  });
  if (!rpcError) return;
  if (!isMissingDbFunction(rpcError)) throw rpcError;
  console.warn('replace_planning_and_matrix ontbreekt (migratie niet gedraaid?) — val terug op het niet-atomische pad.');
  await savePlanningMatrixRows(rows);
  await replacePlanningData(shifts);
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

const toPublicPlanningMatrixHistory = (row: PlanningMatrixImportHistoryRow | PlanningMatrixImportHistoryRecord): PlanningMatrixImportHistoryRecord => ({
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

const toPublicActivityLog = (row: ActivityLogRow | ActivityLogRecord): ActivityLogRecord => ({
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

export const getActivityLog = async (
  opts?: { sinceIso?: string | null; max?: number },
): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  // Aanwezigheids-events ('auth' / 'Aangemeld' + 'Actief') worden bewust uit
  // het auditspoor gefilterd: ze zijn hoog-volume en zouden het venster
  // vullen, waardoor de echte beheeracties verdwijnen. Ze komen via
  // getLoginActivity() in een eigen overzicht.
  //
  // sinceIso/max i.p.v. een vaste .limit(100): de UI beloofde "30 dagen" en
  // "Alles" terwijl de server nooit meer dan 100 rijen gaf — filters en
  // CSV-export logen daarmee stil (en de back-up bevatte max 100 regels).
  const sinceIso = opts?.sinceIso ?? null;
  const max = Math.max(1, opts?.max ?? 100);
  const rows = await paginatedFetch<ActivityLogRow>((from, to) => {
    let q = client
      .from("activity_log")
      .select("*")
      .or("category.neq.auth,and(action.neq.Aangemeld,action.neq.Actief)")
      .order("created_at", { ascending: false })
      .range(from, Math.min(to, max - 1));
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  }, max);
  return rows.map(toPublicActivityLog);
};

/** Aanwezigheids-events sinds een ISO-tijdstip — voor het overzicht "wie
 *  wanneer + per-dag actieve gebruikers". Omvat zowel echte aanmeldingen
 *  ('Aangemeld') als het dagelijkse sessie-herstel-event ('Actief'), zodat
 *  ook gebruikers met een lopende PWA-sessie meetellen als actief. */
export const getLoginActivity = async (sinceIso: string, limit = 3000): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("*")
    .eq("category", "auth")
    .in("action", ["Aangemeld", "Actief"])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  // Fouten doorgeven i.p.v. [] — een lege lijst is niet te onderscheiden van
  // "niemand meldde zich aan" en verstopte DB-problemen voor de admin.
  if (error) throw error;
  return ((data ?? []) as ActivityLogRow[]).map(toPublicActivityLog);
};

/** Tijdstip (ISO) van het meest recente auth-event ('Aangemeld' of 'Actief')
 *  van één gebruiker — voor de éénmaal-per-dag-dedup van het 'Actief'-event
 *  bij sessie-herstel. null = nog geen auth-event bekend. */
export const getLatestAuthEventAt = async (userId: string): Promise<string | null> => {
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("created_at")
    .eq("category", "auth")
    .in("action", ["Aangemeld", "Actief"])
    .eq("entity_type", "user")
    .eq("entity_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return (data[0] as { created_at: string }).created_at;
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

const saveActivityLogEntry = async (entry: ActivityLogRecord) => {
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
      previous.endTime3 !== service.endTime3 ||
      previous.loopnr !== service.loopnr ||
      previous.loopnr2 !== service.loopnr2 ||
      previous.loopnr3 !== service.loopnr3
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
        previous.endDate !== item.endDate
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

// Zelfde regels als de gedeelde client-validator (shiftTime.isValidBusvakTime):
// uur 0–47 (busvak), minuten 0–59. De oude regex accepteerde "08:75"/"99:00",
// die vervolgens per component anders geïnterpreteerd werden.
const isValidHHMM = (v?: string) => {
  if (!v) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return false;
  return Number(m[1]) <= 47 && Number(m[2]) <= 59;
};
const validSegment = (start: string | undefined, end: string | undefined, segment: number) =>
  isValidHHMM(start) && isValidHHMM(end)
    ? { startTime: start as string, endTime: end as string, segment }
    : null;

export const getServiceSegments = (service: ServiceRecord) => (
  [
    { seg: validSegment(service.startTime, service.endTime, 1), loopnr: service.loopnr },
    { seg: validSegment(service.startTime2, service.endTime2, 2), loopnr: service.loopnr2 },
    { seg: validSegment(service.startTime3, service.endTime3, 3), loopnr: service.loopnr3 },
  ]
    .filter((x) => x.seg !== null)
    // Loopnummer hoort bij het blok: een loop is het deel van de dienst waar
    // bepaalde ritten onder vallen, dus het reist mee naar de planning-rij.
    .map((x) => ({ ...(x.seg as { startTime: string; endTime: string; segment: number }), loopnr: String(x.loopnr ?? '').trim() }))
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
  // Botsings-detectie: twee verschillende gebruikers die op dezelfde
  // naam-sleutel uitkomen (zelfde naam, of "Jan Karel" vs "Karel Jan" via de
  // gesorteerde token). Voorheen was dit laatste-wint → alle diensten van
  // beide kolommen belandden stil bij één van de twee. Ambigue sleutels
  // matchen nu bewust NIET meer en verschijnen als unmatched in de preview.
  const usersByName = new Map<string, AppUser>();
  const ambiguousNameKeys = new Set<string>();
  const addNameKey = (key: string, u: AppUser) => {
    if (!key) return;
    const existing = usersByName.get(key);
    if (existing && String(existing.id) !== String(u.id)) {
      ambiguousNameKeys.add(key);
      usersByName.delete(key);
      return;
    }
    if (!ambiguousNameKeys.has(key)) usersByName.set(key, u);
  };
  for (const u of users) {
    addNameKey(toLookupToken(u.name), u);
    addNameKey(sortedNameToken(u.name), u);
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
      const nameKey = toLookupToken(driverName);
      const sortedKey = sortedNameToken(driverName);
      if (ambiguousNameKeys.has(nameKey) || ambiguousNameKeys.has(sortedKey)) {
        unmatchedDrivers.add(`${driverName} (ambigu: meerdere gebruikers met deze naam — maak de namen uniek in gebruikersbeheer)`);
        continue;
      }
      const driver = usersByName.get(nameKey) || usersByName.get(sortedKey);
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
            loopnr: segment.loopnr,
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

export const saveUsersData = async (incomingUsers: IncomingUser[]): Promise<{ createdAccounts: Array<{ email: string; name: string }> }> => {
  // Nieuw aangemaakte Auth-accounts (e-mail + naam) gaan terug naar de route,
  // die er een welkomstmail met wachtwoord-instel-link voor verstuurt.
  const createdAccounts: Array<{ email: string; name: string }> = [];
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
    ((authPage?.users ?? []) as SupabaseAuthUser[])
      .filter((user) => user.email)
      .map((user): [string, SupabaseAuthUser] => [normalizeEmail(user.email) as string, user]),
  );

  const removedUserIds = currentUsers
    .map((user) => String(user.id))
    .filter((id) => !incomingIds.has(id));

  // DB-writes EERST. De Auth-mutaties hieronder zijn onomkeerbaar; door de
  // database vooraf te schrijven faalt een DB-fout vóór er ook maar één
  // Auth-account is aangemaakt of verwijderd (geen weeskonten / verweesde
  // profielen door een halverwege gefaalde write).
  if (removedUserIds.length > 0) {
    const { error } = await client.from('users').delete().in('id', removedUserIds);
    if (error) throw error;
  }
  const databaseUsers = sanitizedUsers.map(toDatabaseUser);
  {
    const { error } = await client.from('users').upsert(databaseUsers);
    if (error) throw error;
  }

  // Daarna pas de Auth-kant. Verwijderde gebruikers: bijhorend Auth-account weg.
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
      createdAccounts.push({ email: currentEmail, name: sanitizedUser.name });
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
  // (DB-delete + DB-upsert zijn hierboven al uitgevoerd, vóór de Auth-mutaties.)
  return { createdAccounts };
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

/** Verhoog/verlaag de activeSessions-teller ATOMAIR via een Postgres-RPC.
 *  Voorkomt de lost-update-race wanneer meerdere mensen ~tegelijk in/uitloggen
 *  (read-modify-write op de gecachte waarde telde mis). Valt terug op een
 *  read-modify-write zolang de RPC nog niet in de DB staat (zie
 *  supabase/active_sessions_rpc.sql). */
export const bumpActiveSessions = async (userId: string, delta: number) => {
  const client = requireDb();
  const { error } = await client.rpc('bump_active_sessions', { uid: String(userId), delta });
  if (!error) return;
  if (!isMissingDbFunction(error)) throw error;
  // Fallback (migratie nog niet gedraaid): niet-atomair, maar functioneel.
  const { data } = await client.from('users').select('activesessions').eq('id', String(userId)).maybeSingle();
  const current = Number((data as any)?.activesessions ?? 0);
  await client.from('users').update({ activesessions: Math.max(0, current + delta) }).eq('id', String(userId));
};

// --- Diversions ---

export const DIVERSIONS_BUCKET = "diversions";

const removeDiversionPdfs = async (diversionIds: string[]) => {
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

  const existing = await paginatedFetch((from, to) =>
    client.from('diversions').select('id').order('id', { ascending: true }).range(from, to),
  );

  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));

  // Eerst upserten, dan pas verwijderen: faalt de upsert, dan zijn er nog géén
  // rijen (en PDF's) onomkeerbaar weggegooid. Andersom verloor je bij een
  // upsert-fout de zojuist verwijderde records.
  if (normalized.length > 0) {
    const { error: upsertError } = await client.from('diversions').upsert(normalized.map(toDatabaseDiversion));
    if (upsertError) throw upsertError;
  }

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await client.from('diversions').delete().in('id', idsToDelete);
    if (deleteError) throw deleteError;
    // Best-effort: also remove the PDFs from Storage (pas ná geslaagde delete).
    await removeDiversionPdfs(idsToDelete);
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
  const existing = await paginatedFetch((from, to) =>
    client.from('services').select('id').order('id', { ascending: true }).range(from, to),
  );
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

// --- Back-ups (Supabase Storage) ---

export const BACKUPS_BUCKET = "backups";
const BACKUP_RETENTION_DAYS = 30;

/** Slaat een back-up-JSON op in de (private) backups-bucket en ruimt
 *  bestanden ouder dan de retentietermijn op. Maakt de bucket aan bij de
 *  eerste run. Gooit bij falen — de cron-route logt en rapporteert dat. */
export const storeBackup = async (filename: string, body: string): Promise<{ removedOld: number }> => {
  if (!supabaseAdmin) {
    throw new Error("Back-ups vereisen de service-role client (SUPABASE_SERVICE_ROLE_KEY).");
  }

  const upload = () =>
    supabaseAdmin.storage.from(BACKUPS_BUCKET).upload(filename, Buffer.from(body, "utf8"), {
      contentType: "application/json",
      upsert: true,
    });

  let { error } = await upload();
  if (error && /bucket.*not.*found/i.test(error.message ?? "")) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(BACKUPS_BUCKET, { public: false });
    if (createError) throw new Error(`Backups-bucket aanmaken mislukt: ${createError.message}`);
    ({ error } = await upload());
  }
  if (error) throw new Error(`Back-up uploaden mislukt: ${error.message}`);

  // Retentie: verwijder back-ups ouder dan BACKUP_RETENTION_DAYS (datum uit
  // de bestandsnaam, niet uit metadata — namen zijn de bron van waarheid).
  let removedOld = 0;
  const { data: files } = await supabaseAdmin.storage.from(BACKUPS_BUCKET).list(undefined, { limit: 1000 });
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const oldFiles = (files ?? [])
    .map((f: any) => f.name as string)
    .filter((name) => {
      const m = name.match(/^vhb-backup-(\d{4}-\d{2}-\d{2})\.json$/);
      return m ? new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff : false;
    });
  if (oldFiles.length > 0) {
    const { error: removeError } = await supabaseAdmin.storage.from(BACKUPS_BUCKET).remove(oldFiles);
    if (!removeError) removedOld = oldFiles.length;
  }
  return { removedOld };
};

// --- Documenten per gebruiker (attesten, reglement, loonbrieven) ---

export const DOCUMENTS_BUCKET = "user-documents";

export type UserDocumentRecord = {
  id: string;
  userId: string;
  filename: string;
  storagePath: string;
  category?: string | null;
  sizeBytes?: number | null;
  uploadedAt: string;
  uploadedBy?: string | null;
};

const mapUserDocumentRow = (row: any): UserDocumentRecord => ({
  id: String(row.id),
  userId: String(row.user_id),
  filename: row.filename,
  storagePath: row.storage_path,
  category: row.category ?? null,
  sizeBytes: row.size_bytes ?? null,
  uploadedAt: row.uploaded_at,
  uploadedBy: row.uploaded_by ?? null,
});

/** Alle documenten (userId undefined, admin-pad), of alleen die van één
 *  gebruiker. Een LEGE string is geen "alles" maar "niets" — fail-closed
 *  tegen een ontbrekende gebruikers-id op het aanroepende pad. */
export const listUserDocuments = async (userId?: string): Promise<UserDocumentRecord[]> => {
  if (userId !== undefined && !userId) return [];
  const client = requireDb();
  let query = client.from("user_documents").select("*").order("uploaded_at", { ascending: false }).limit(500);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapUserDocumentRow);
};

export const getUserDocument = async (id: string): Promise<UserDocumentRecord | null> => {
  const client = requireDb();
  const { data, error } = await client.from("user_documents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapUserDocumentRow(data) : null;
};

export const insertUserDocument = async (doc: Omit<UserDocumentRecord, "id" | "uploadedAt">): Promise<UserDocumentRecord> => {
  const client = requireDb();
  const { data, error } = await client
    .from("user_documents")
    .insert({
      user_id: doc.userId,
      filename: doc.filename,
      storage_path: doc.storagePath,
      category: doc.category ?? null,
      size_bytes: doc.sizeBytes ?? null,
      uploaded_by: doc.uploadedBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapUserDocumentRow(data);
};

export const deleteUserDocument = async (id: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from("user_documents").delete().eq("id", id);
  if (error) throw error;
};

/** Metadata van het huidige ritblad (id='current') — voor de back-up. */
export const getRitblaadjeMeta = async (): Promise<unknown | null> => {
  if (!db) return null;
  try {
    const { data, error } = await db.from("ritblaadje").select("*").eq("id", "current").maybeSingle();
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
};

/** Ruimt alle documenten van één gebruiker op: eerst de storage-bestanden,
 *  dan de metadata-rijen. Wordt aangeroepen bij het verwijderen van een
 *  gebruiker zodat er geen wees-bestanden/rijen achterblijven. Best-effort. */
export const deleteAllDocumentsForUser = async (userId: string): Promise<number> => {
  if (!db) return 0;
  try {
    const { data, error } = await db.from("user_documents").select("id,storage_path").eq("user_id", userId);
    if (error || !data || data.length === 0) return 0;
    const paths = data.map((d: any) => d.storage_path).filter(Boolean);
    if (supabaseAdmin && paths.length > 0) {
      const { error: rmErr } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(paths);
      if (rmErr) console.warn(`[documenten] storage-opruiming voor ${userId} deels mislukt:`, rmErr.message);
    }
    const { error: delErr } = await db.from("user_documents").delete().eq("user_id", userId);
    if (delErr) throw delErr;
    return data.length;
  } catch (err) {
    console.error(`[documenten] opruimen voor verwijderde gebruiker ${userId} mislukt:`, err);
    return 0;
  }
};

// --- Client errors ---

export type ClientErrorEntry = {
  message: string;
  stack?: string;
  source?: string;
  url?: string;
  userAgent?: string;
  userId?: string;
};

/** Best-effort: de `client_errors`-tabel is optioneel — zonder tabel (of
 *  zonder db) blijft de console.error in de route-handler het vangnet
 *  (zichtbaar in de Vercel-functielogs). Mag zelf nooit throwen. */
export const logClientError = async (entry: ClientErrorEntry) => {
  if (!db) return;
  try {
    await db.from("client_errors").insert({
      message: entry.message,
      stack: entry.stack || null,
      source: entry.source || null,
      url: entry.url || null,
      user_agent: entry.userAgent || null,
      user_id: entry.userId || null,
    });
  } catch {
    // tabel ontbreekt of insert faalt — bewust stil
  }
};

const mapClientErrorRow = (row: any) => ({
  id: row.id,
  createdAt: row.created_at,
  message: row.message,
  stack: row.stack ?? undefined,
  source: row.source ?? undefined,
  url: row.url ?? undefined,
  userAgent: row.user_agent ?? undefined,
  userId: row.user_id ?? undefined,
});

export const getClientErrors = async (limit = 100) => {
  if (!db) return [];
  try {
    const { data, error } = await db
      .from("client_errors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map(mapClientErrorRow);
  } catch {
    return [];
  }
};

/** Fouten sinds een ISO-tijdstip (voor de periodieke alert-digest). */
export const getClientErrorsSince = async (sinceIso: string, limit = 1000) => {
  if (!db) return [];
  try {
    const { data, error } = await db
      .from("client_errors")
      .select("*")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map(mapClientErrorRow);
  } catch {
    return [];
  }
};

/**
 * Retentie-opruiming (draait in de nachtcron, ná het maken van de back-up
 * zodat de back-up van die nacht de volledige historiek nog bevat):
 * client_errors ouder dan `errorDays` en activity_log ouder dan `logDays`
 * verwijderen. Best-effort per tabel — een ontbrekende tabel of fout mag de
 * back-upcron nooit laten falen.
 */
export const pruneOldRecords = async (opts: { errorDays: number; logDays: number }) => {
  const summary = { clientErrors: 0, activityLog: 0 };
  if (!db) return summary;
  const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const { count, error } = await db
      .from("client_errors")
      .delete({ count: "exact" })
      .lt("created_at", cutoff(opts.errorDays));
    if (!error) summary.clientErrors = count ?? 0;
  } catch {
    // tabel ontbreekt of delete faalt — bewust stil
  }
  try {
    const { count, error } = await db
      .from("activity_log")
      .delete({ count: "exact" })
      .lt("created_at", cutoff(opts.logDays));
    if (!error) summary.activityLog = count ?? 0;
  } catch {
    // idem
  }
  return summary;
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
  const existing = await paginatedFetch((from, to) =>
    client.from('updates').select('id').order('id', { ascending: true }).range(from, to),
  );

  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));

  const payloadWithoutUrgent = normalizedData.map((update) => ({
    id: String(update.id),
    date: String(update.date || ""),
    title: update.title || "",
    category: update.category || "algemeen",
    content: update.content || "",
  }));
  // Eerst upserten, dan pas de ontbrekende rijen verwijderen — faalt de
  // upsert, dan zijn er nog geen records verloren.
  if (payloadWithoutUrgent.length > 0) {
    const { error } = await client.from('updates').upsert(payloadWithoutUrgent);
    if (error) throw error;
  }

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await client.from('updates').delete().in('id', idsToDelete);
    if (deleteError) throw deleteError;
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

// --- Leesbevestigingen op updates ---
// Server-only tabel (RLS aan, geen policies) met snake_case-kolommen — zie
// supabase/update_reads.sql. Eén rij per (update, gebruiker).

/** Markeert de gegeven updates als gelezen door één gebruiker (idempotent upsert). */
export const markUpdatesRead = async (userId: string, updateIds: string[]) => {
  const client = requireDb();
  const uid = String(userId);
  const rows = Array.from(new Set(updateIds.map((id) => String(id))))
    .filter(Boolean)
    .map((updateId) => ({ update_id: updateId, user_id: uid }));
  if (rows.length === 0) return;
  // ignoreDuplicates: al-gelezen combinaties overschrijven read_at niet (de
  // eerste-gelezen-tijd blijft staan) en botsen niet op de primary key.
  const { error } = await client
    .from('update_reads')
    .upsert(rows, { onConflict: 'update_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
};

/**
 * Aantal unieke lezers per update-id (voor de planner-teller). Met
 * `allowedUserIds` tellen alleen reads van die gebruikers mee — de route geeft
 * hier de actieve-chauffeurs-set door zodat planner/admin-reads of reads van
 * inmiddels-inactieve gebruikers de teller niet flatteren.
 */
export const getUpdateReadCounts = async (
  allowedUserIds?: Set<string>,
): Promise<Record<string, number>> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('update_reads').select('update_id, user_id').range(from, to),
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (allowedUserIds && !allowedUserIds.has(String((row as any).user_id))) continue;
    const id = String((row as any).update_id);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
};

// --- Toestel-whitelist (user_devices) ---
// Server-only tabel (RLS aan, geen policies, snake_case) — zie
// supabase/user_devices.sql. Eerste toestel van een chauffeur = auto-approved,
// elk volgend toestel = pending tot de admin goedkeurt. Planner/admin-
// toestellen zijn altijd approved (alleen zichtbaarheid, nooit uitsluiting).

export type DeviceStatus = 'approved' | 'pending' | 'revoked';

export type UserDevice = {
  userId: string;
  deviceToken: string;
  name: string;
  status: DeviceStatus;
  createdAt: string;
  lastSeenAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
};

const toPublicDevice = (row: any): UserDevice => ({
  userId: String(row.user_id),
  deviceToken: String(row.device_token),
  name: String(row.name ?? 'Onbekend toestel'),
  status: row.status as DeviceStatus,
  createdAt: String(row.created_at),
  lastSeenAt: String(row.last_seen_at),
  approvedAt: row.approved_at ? String(row.approved_at) : null,
  approvedBy: row.approved_by ? String(row.approved_by) : null,
});

export const getDevice = async (userId: string, deviceToken: string): Promise<UserDevice | null> => {
  const client = requireDb();
  const { data, error } = await client
    .from('user_devices')
    .select('*')
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken))
    .maybeSingle();
  if (error) throw error;
  return data ? toPublicDevice(data) : null;
};

/**
 * Registreert een toestel (of raakt een bestaand toestel aan). Geeft de rij
 * terug + of hij nieuw was. `autoApprove` bepaalt de status van een níeuw
 * toestel; een bestaand toestel behoudt zijn status (een revoked toestel
 * kan zichzelf dus niet her-registreren naar pending/approved).
 */
export const registerDevice = async (
  userId: string,
  deviceToken: string,
  name: string,
  autoApprove: boolean,
): Promise<{ device: UserDevice; created: boolean }> => {
  const client = requireDb();
  const existing = await getDevice(userId, deviceToken);
  if (existing) {
    const { error } = await client
      .from('user_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('user_id', String(userId))
      .eq('device_token', String(deviceToken));
    if (error) throw error;
    return { device: existing, created: false };
  }
  const row = {
    user_id: String(userId),
    device_token: String(deviceToken),
    name: name || 'Onbekend toestel',
    status: (autoApprove ? 'approved' : 'pending') as DeviceStatus,
    approved_at: autoApprove ? new Date().toISOString() : null,
    approved_by: autoApprove ? 'auto' : null,
  };
  // Race (dubbele boot-call): bij een PK-conflict is de rij er al — negeren
  // en de bestaande status teruggeven i.p.v. een 500.
  const { error } = await client.from('user_devices').insert(row);
  if (error) {
    if ((error as any).code === '23505') {
      const raced = await getDevice(userId, deviceToken);
      if (raced) return { device: raced, created: false };
    }
    throw error;
  }
  const device = await getDevice(userId, deviceToken);
  if (!device) throw new Error('Toestel-registratie niet teruggevonden.');
  return { device, created: true };
};

/** Heeft deze gebruiker al één of meer toestellen? (bepaalt auto-approve) */
export const userHasDevices = async (userId: string): Promise<boolean> => {
  const client = requireDb();
  const { count, error } = await client
    .from('user_devices')
    .select('device_token', { count: 'exact', head: true })
    .eq('user_id', String(userId));
  if (error) throw error;
  return (count ?? 0) > 0;
};

export const listAllDevices = async (): Promise<UserDevice[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('user_devices').select('*').order('created_at', { ascending: false }).range(from, to),
  );
  return rows.map(toPublicDevice);
};

export const setDeviceStatus = async (
  userId: string,
  deviceToken: string,
  status: DeviceStatus,
  actorId: string,
): Promise<void> => {
  const client = requireDb();
  const patch: Record<string, unknown> = { status };
  if (status === 'approved') {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = String(actorId);
  }
  const { error } = await client
    .from('user_devices')
    .update(patch)
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken));
  if (error) throw error;
};

export const renameDevice = async (userId: string, deviceToken: string, name: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('user_devices')
    .update({ name: name || 'Onbekend toestel' })
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken));
  if (error) throw error;
};

/** Verwijdert een toestel-registratie volledig (schrappen uit de lijst). */
export const deleteDevice = async (userId: string, deviceToken: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('user_devices')
    .delete()
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken));
  if (error) throw error;
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
  // Upsert-dan-delete (day_type is primary key): eerst de nieuwe waarden
  // wegschrijven, dán pas de dag-types die niet meer voorkomen verwijderen.
  // De oude delete-dan-insert liet bij een insert-fout de HELE dekkings-
  // configuratie (dag-types + uitzonderingen) verdwijnen.
  if (rows.length > 0) {
    const { error: upsertError } = await client.from('coverage_expectations').upsert(rows);
    if (upsertError) throw upsertError;
  }
  const keep = new Set(rows.map((r) => r.day_type));
  const { data: existing, error: selectError } = await client.from('coverage_expectations').select('day_type');
  if (selectError) throw selectError;
  const toDelete = (existing ?? []).map((r: any) => String(r.day_type)).filter((dt) => !keep.has(dt));
  if (toDelete.length > 0) {
    const { error: deleteError } = await client.from('coverage_expectations').delete().in('day_type', toDelete);
    if (deleteError) throw deleteError;
  }
};

// --- Restore vanuit een back-up-bestand ---

export type RestorableCollections = {
  users?: any[];
  planning?: any[];
  services?: any[];
  diversions?: any[];
  updates?: any[];
  leave?: any[];
  swaps?: any[];
  planningCodes?: any[];
  planningMatrixRows?: any[];
  coverageExpectations?: Record<string, string[]>;
};

/**
 * Structurele integriteitscheck op een backup-payload — draait in de back-up-
 * cron ná het opbouwen. GEEN echte restore naar een sandbox (dat vereist een
 * wegwerp-DB), maar vangt wél een kapotte/onvolledige export: ontbrekende of
 * niet-array-collecties, een lege gebruikerslijst, géén admin (dan zou een
 * restore geweigerd worden), of niet-serialiseerbare data. Bij problemen alert
 * de cron zodat een stille lege back-up niet pas bij een echte ramp opvalt.
 */
export const checkBackupIntegrity = (
  payload: { collections?: Record<string, unknown> } & Record<string, unknown>,
): { ok: boolean; issues: string[] } => {
  const issues: string[] = [];
  const c = payload?.collections;
  if (!c || typeof c !== "object") {
    return { ok: false, issues: ["collections ontbreekt of is geen object"] };
  }
  const arrayKeys = ["users", "planning", "services", "diversions", "updates", "leave", "swaps", "planningCodes", "planningMatrixRows", "activityLog"];
  for (const k of arrayKeys) {
    if (!Array.isArray((c as Record<string, unknown>)[k])) issues.push(`collectie '${k}' ontbreekt of is geen lijst`);
  }
  const cov = (c as Record<string, unknown>).coverageExpectations;
  if (typeof cov !== "object" || cov === null || Array.isArray(cov)) {
    issues.push("collectie 'coverageExpectations' ontbreekt of is geen object");
  }
  const users = Array.isArray((c as Record<string, unknown>).users) ? ((c as Record<string, unknown>).users as any[]) : [];
  if (users.length === 0) issues.push("geen gebruikers in de back-up");
  else if (!users.some((u) => u?.role === "admin")) issues.push("geen admin-account in de back-up (een restore zou geweigerd worden)");
  // Serialisatie-round-trip: bewijst dat de payload parse-/schrijfbaar is.
  try {
    const rt = JSON.parse(JSON.stringify(payload)) as { collections?: { users?: unknown[] } };
    if (!Array.isArray(rt?.collections?.users) || rt.collections!.users!.length !== users.length) {
      issues.push("serialisatie-round-trip komt niet overeen");
    }
  } catch {
    issues.push("payload is niet serialiseerbaar/parseerbaar");
  }
  return { ok: issues.length === 0, issues };
};

/** De collecties die een restore overschrijft. De audit-log
 *  (activityLog) en de import-historiek blijven bewust ongemoeid: dat is
 *  geschiedenis, geen state — anders zou de restore z'n eigen spoor wissen. */
/**
 * Zet alle operationele collecties terug naar de inhoud van een back-up.
 * Volgorde bewust: eerst users (de min-1-admin-vangrail mag niet door een
 * lege set vallen), dan de rest. Per collectie wordt vervangen via dezelfde
 * save-paden als de gewone flows. Geeft per collectie het aantal records terug.
 */
export const restoreFromBackup = async (collections: RestorableCollections): Promise<Record<string, number>> => {
  const summary: Record<string, number> = {};

  // Restore is niet transactioneel (meerdere tabellen). Bij een fout halverwege
  // hangen we de tot dan toe geslaagde collecties aan de error, zodat de route
  // dat kan loggen en terugmelden (de admin weet dan wat al toegepast is).
  try {
  if (Array.isArray(collections.users)) {
    await saveUsersData(collections.users);
    summary.users = collections.users.length;
  }
  if (Array.isArray(collections.planning)) {
    // Planning wordt rechtstreeks opgeslagen (geen public/db-conversie).
    // Niet-leeg → replace-semantiek; leeg → bewust volledig wissen (restore
    // is een expliciete, bevestigde admin-actie, dus faithful terugzetten).
    if (collections.planning.length > 0) await savePlanningData(collections.planning);
    else await clearPlanningData();
    summary.planning = collections.planning.length;
  }
  if (Array.isArray(collections.services)) {
    await saveServicesData(collections.services);
    summary.services = collections.services.length;
  }
  if (Array.isArray(collections.diversions)) {
    await saveDiversionsData(collections.diversions);
    summary.diversions = collections.diversions.length;
  }
  if (Array.isArray(collections.updates)) {
    await saveUpdatesData(collections.updates);
    summary.updates = collections.updates.length;
  }
  if (Array.isArray(collections.planningCodes)) {
    await savePlanningCodesData(collections.planningCodes as PlanningCodeRecord[]);
    summary.planningCodes = collections.planningCodes.length;
  }
  if (Array.isArray(collections.leave)) {
    const existing = await getLeaveData();
    const keep = new Set(collections.leave.map((l: any) => String(l.id)));
    const idsToDelete = existing.map((l) => String(l.id)).filter((id) => !keep.has(id));
    await saveLeaveData(collections.leave, idsToDelete);
    summary.leave = collections.leave.length;
  }
  if (Array.isArray(collections.swaps)) {
    const existing = await getSwapsData();
    const keep = new Set(collections.swaps.map((s: any) => String(s.id)));
    const idsToDelete = existing.map((s) => String(s.id)).filter((id) => !keep.has(id));
    await saveSwapsData(collections.swaps, idsToDelete);
    summary.swaps = collections.swaps.length;
  }
  // Matrix-rijen alleen terugzetten als er iets in zit (de save weigert een
  // lege set om dataverlies te voorkomen).
  if (Array.isArray(collections.planningMatrixRows) && collections.planningMatrixRows.length > 0) {
    await savePlanningMatrixRows(collections.planningMatrixRows as PlanningMatrixRow[]);
    summary.planningMatrixRows = collections.planningMatrixRows.length;
  }
  if (collections.coverageExpectations && typeof collections.coverageExpectations === 'object') {
    await saveCoverageExpectations(collections.coverageExpectations);
    summary.coverageExpectations = Object.keys(collections.coverageExpectations).length;
  }

  return summary;
  } catch (err: any) {
    if (err && typeof err === 'object') err.appliedSoFar = summary;
    throw err;
  }
};

// --- Cron-heartbeats -------------------------------------------------------
// Crons falen stil (Vercel-logs die niemand leest): elke geslaagde run
// schrijft een heartbeat in activity_log (category 'system'); de health-
// endpoint markeert heartbeats die ouder zijn dan 2× het interval. Voor
// hoogfrequente crons (OCPI, elke 2-5 min) throttelen we naar max. 1
// heartbeat per uur zodat het log niet volloopt.
export const logCronHeartbeat = async (name: string, details: string, minIntervalMin = 0) => {
  try {
    const client = requireDb();
    const action = `Cron geslaagd: ${name}`;
    if (minIntervalMin > 0) {
      const { data } = await client
        .from("activity_log")
        .select("created_at")
        .eq("action", action)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const last = data?.created_at ? Date.parse(String(data.created_at)) : 0;
      if (last && Date.now() - last < minIntervalMin * 60 * 1000) return;
    }
    await saveActivityLogEntry({
      id: `${Date.now()}-cron-${name}`,
      createdAt: new Date().toISOString(),
      actorName: "Systeem (cron)",
      actorRole: "admin",
      category: "system",
      action,
      details,
    });
  } catch (err) {
    // Heartbeat mag een cron nooit laten falen.
    console.error(`Heartbeat voor cron '${name}' kon niet geschreven worden:`, err);
  }
};

export const getCronHeartbeats = async (names: string[]): Promise<Record<string, string | null>> => {
  const client = requireDb();
  const out: Record<string, string | null> = {};
  for (const name of names) {
    const { data } = await client
      .from("activity_log")
      .select("created_at")
      .eq("action", `Cron geslaagd: ${name}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    out[name] = data?.created_at ? String(data.created_at) : null;
  }
  return out;
};

// --- App-instellingen (supabase/2026-07-30_app_settings.sql) ---
// Kleine key/value-laag; RLS zonder policies, dus alleen bereikbaar via de
// service-role. Eerste gebruiker: de toestel-whitelist-schakelaar.

export const getAppSetting = async <T = unknown>(key: string): Promise<T | null> => {
  const client = requireDb();
  const { data, error } = await client
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return (data?.value ?? null) as T | null;
};

export const setAppSetting = async (key: string, value: unknown): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
};

// --- Dienstnotities (supabase/2026-07-30_planning_notes.sql) ---
// Eigen tabel op (driver_id, date): overleeft "Planning opnieuw opbouwen",
// dat de planning-tabel volledig vervangt.

export type PlanningNoteRow = { driver_id: string; date: string; note: string; updated_by: string | null; updated_at: string };

export const getPlanningNotes = async (
  opts: { fromIso: string; toIso: string; driverId?: string },
): Promise<Array<{ driverId: string; date: string; note: string }>> => {
  const client = requireDb();
  let q = client
    .from('planning_notes')
    .select('driver_id,date,note')
    .gte('date', opts.fromIso)
    .lte('date', opts.toIso);
  if (opts.driverId) q = q.eq('driver_id', String(opts.driverId));
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as PlanningNoteRow[]).map((r) => ({ driverId: String(r.driver_id), date: r.date, note: r.note }));
};

export const upsertPlanningNote = async (driverId: string, date: string, note: string, updatedBy: string | null): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('planning_notes')
    .upsert({ driver_id: String(driverId), date, note, updated_by: updatedBy, updated_at: new Date().toISOString() });
  if (error) throw error;
};

export const deletePlanningNote = async (driverId: string, date: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('planning_notes')
    .delete()
    .eq('driver_id', String(driverId))
    .eq('date', date);
  if (error) throw error;
};
