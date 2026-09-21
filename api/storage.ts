import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import type {
  ActivityLogRecord,
  ActivityLogRow,
  AppUser,
  AuthenticatedRequest,
  IncomingUser,
  MeldingRecord,
  PlanningCodeRecord,
  PlanningMatrixImportHistoryRecord,
  PlanningMatrixImportHistoryRow,
  PlanningMatrixRow,
  ServiceRecord,
  ShiftRecord,
  SwapRecord,
  AppUserIntern,
  DeviceStatus,
  UserDevice,
} from "./types.js";
import { RUIL_BEKEKEN_ACTIE } from "../shared/ruilVerloop.js";
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
  maandGrenzen,
  toDatabaseSwap,
  toDatabaseUpdate,
  toDatabaseUser,
  sortedNameToken,
  toLookupToken,
  toPublicDiversion,
  toPublicLeave,
  toPublicPlanningCode,
  toPublicService,
  toPublicSwap,
  toPublicUpdate,
  toPublicUser,
} from "./helpers.js";
import { hoortBijSessie, type AanwezigheidLocatie } from "./_lib/aanwezigheid.js";
import { db, supabaseAdmin } from "./db.js";
import type { DashboardVoorkeuren } from "../shared/schemas/dashboardVoorkeuren.js";
import type { MeldingInvoer } from "./_lib/meldingen.js";

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
// Hoeveel vervolgpagina's tegelijk: ruim voor wat we hebben (planning = 3
// pagina's), maar begrensd zodat een grote tabel de pool niet leegtrekt.
const PAGINA_PARALLEL = 6;

/** Derde argument van de query-bouwer: geef het door aan `.select(kolommen,
 *  telling)`. Alleen de eerste pagina krijgt het mee (count: 'exact'). */
export type PaginaTelling = { count: "exact" };
type PaginaAntwoord<T> = { data: T[] | null; error: any; count?: number | null };

// Geëxporteerd zodat ook de losse opslagmodules (api/_lib/loonStorage.ts)
// dezelfde paginering gebruiken in plaats van een eigen limit.
//
// PARALLEL (ronde 3, 19-09): de pagina's kwamen strikt na elkaar, dus een
// tabel van 3 pagina's kostte 3 roundtrips achter elkaar. Een bouwer die het
// derde argument doorgeeft aan `.select('*', telling)` krijgt op de eerste
// pagina het exacte totaal terug; de overige pagina's gaan dan gelijktijdig
// weg en worden in dezelfde volgorde aaneengezet. Klopt het totaal achteraf
// niet met de telling (de tabel wijzigde tussendoor), dan begint de oude
// seriële lus opnieuw: die is traag maar stopt pas op een niet-volle pagina.
// Bouwers zonder telling (of met `max`) blijven serieel, exact zoals vroeger.
// Voorwaarde voor beide paden: een stabiele, unieke sortering in de bouwer.
export const paginatedFetch = async <T = any>(
  buildQuery: (from: number, to: number, telling?: PaginaTelling) => PromiseLike<PaginaAntwoord<T>>,
  max?: number,
): Promise<T[]> => {
  const serieel = async (all: T[], vanaf: number): Promise<T[]> => {
    let from = vanaf;
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

  const eerste = await buildQuery(0, PAGE_SIZE - 1, { count: "exact" });
  if (eerste.error) throw eerste.error;
  const eersteBatch = (eerste.data ?? []) as T[];
  if (max !== undefined && eersteBatch.length >= max) return eersteBatch.slice(0, max);
  if (eersteBatch.length < PAGE_SIZE) return eersteBatch;

  const totaal = typeof eerste.count === "number" && Number.isFinite(eerste.count) ? eerste.count : null;
  if (totaal === null || max !== undefined || totaal <= PAGE_SIZE) {
    return serieel([...eersteBatch], PAGE_SIZE);
  }

  const paginas = Math.ceil(totaal / PAGE_SIZE);
  const rest: T[][] = [];
  for (let start = 1; start < paginas; start += PAGINA_PARALLEL) {
    const nummers = Array.from({ length: Math.min(PAGINA_PARALLEL, paginas - start) }, (_, i) => start + i);
    const antwoorden = await Promise.all(nummers.map((n) => buildQuery(n * PAGE_SIZE, n * PAGE_SIZE + PAGE_SIZE - 1)));
    for (const a of antwoorden) {
      if (a.error) throw a.error;
      rest.push((a.data ?? []) as T[]);
    }
  }
  const all = [...eersteBatch];
  for (const batch of rest) all.push(...batch);
  // Elke pagina behalve de laatste hoort vol te zijn en het totaal hoort te
  // kloppen; anders is de tabel tussendoor gewijzigd → opnieuw, serieel.
  const middenVol = rest.slice(0, -1).every((b) => b.length === PAGE_SIZE);
  if (all.length !== totaal || !middenVol) return serieel([], 0);
  return all;
};

const isEchteIsoDag = (v: unknown): boolean => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// --- Planning ---

// Optionele filters laten de /api/planning-endpoint één maand of één
// chauffeur ophalen i.p.v. de hele tabel — scheelt drastisch in
// data-overdracht voor mobile-clients en de maandprint.
export type PlanningFilters = { driverId?: string; monthIso?: string };

export const getPlanningData = async (filters?: PlanningFilters) => {
  const client = requireDb();
  // Telling doorgeven: planning is meerdere pagina's, die gaan dan parallel.
  return paginatedFetch((from, to, telling) => {
    let q = client.from('planning').select('*', telling).order('id', { ascending: true });
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

/**
 * Tot wanneer reikt de planning in het portaal? De geïmporteerde matrix is de
 * bron: die bepaalt tot welke dag de planning bekend is, ook als er op de
 * laatste dagen toevallig niemand rijdt. Staat de matrix er (nog) niet, dan
 * valt hij terug op de laatste dag waarvoor een dienst is opgebouwd.
 *
 * Eén rij, op de bestaande index `planning_matrix_rows_source_date_idx`.
 * null = geen planning (leeg portaal, of de tabel bestaat nog niet).
 */
export const getPlanningHorizon = async (): Promise<string | null> => {
  const client = requireDb();
  const uitMatrix = await client
    .from('planning_matrix_rows')
    .select('source_date')
    .order('source_date', { ascending: false })
    .limit(1);
  const matrixDag = String(uitMatrix.data?.[0]?.source_date ?? '').slice(0, 10);
  if (!uitMatrix.error && /^\d{4}-\d{2}-\d{2}$/.test(matrixDag)) return matrixDag;
  // `planning.date` is een tekstkolom in ISO-vorm: lexicografisch sorteren
  // geeft daar dezelfde volgorde als chronologisch.
  const uitPlanning = await client
    .from('planning')
    .select('date')
    .order('date', { ascending: false })
    .limit(1);
  if (uitPlanning.error) throw uitPlanning.error;
  const planningDag = String(uitPlanning.data?.[0]?.date ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(planningDag) ? planningDag : null;
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
  const existing = await paginatedFetch((from, to, telling) =>
    client.from('planning').select('id', telling).order('id', { ascending: true }).range(from, to),
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

/**
 * Eén shift gericht opzoeken (eigendoms-checks bij dienstruil). `date` en
 * `line` horen erbij sinds de overname-check en de planning-doorvoer: de
 * server moet weten op welke dag en om welk dienstnummer het gaat.
 */
export const getShiftById = async (id: string): Promise<{ id: string; driverId: string; date: string; line: string } | null> => {
  if (!id) return null;
  const client = requireDb();
  const { data, error } = await client.from('planning').select('id, driverId, date, line').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String((data as any).id),
    driverId: String((data as any).driverId ?? ''),
    date: String((data as any).date ?? ''),
    line: String((data as any).line ?? ''),
  };
};

/**
 * Alle planning-rijen van één dag — voor de handmatige admin-dienstwissel:
 * eigendoms-check (staat de dienst nog op de huidige chauffeur?) en
 * conflict-check (heeft de nieuwe chauffeur die dag al een dienst?).
 */
export const getShiftsOnDate = async (date: string): Promise<Array<{ id: string; driverId: string; date: string; line: string }>> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('planning').select('id, driverId, date, line').eq('date', date).order('id', { ascending: true }).range(from, to),
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    driverId: String(r.driverId ?? ''),
    date: String(r.date ?? ''),
    line: String(r.line ?? ''),
  }));
};

/**
 * Assignments van één matrix-rij vervangen — voor het toewijzen van een
 * onbemande dienst vanuit Dekking. De matrix is de bron waaruit elke
 * heropbouw de planning genereert: door dáár te schrijven overleeft de
 * toewijzing "opnieuw opbouwen". Een nieuwe Excel-import vervangt de matrix
 * en dus ook deze toewijzing — bewust: de nieuwe Excel is dan de waarheid en
 * het gat verschijnt gewoon weer in de dekking.
 */
export const saveMatrixRowAssignments = async (rowId: string, assignments: Record<string, string>): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('planning_matrix_rows')
    .update({ assignments })
    .eq('id', String(rowId));
  if (error) throw error;
};

/** Losse planning-rijen toevoegen (upsert op id) — de dienstblokken van een
 *  zojuist toegewezen dienst, zonder de rest van de planning aan te raken. */
export const insertPlanningRows = async (rows: ShiftRecord[]): Promise<void> => {
  if (rows.length === 0) return;
  const client = requireDb();
  const { error } = await client.from('planning').upsert(rows);
  if (error) throw error;
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

/**
 * Stand van `planning_version` (supabase/2026-08-02_planning_version.sql): de
 * teller die een statement-trigger ophoogt bij élke schrijfactie op planning
 * of matrix (import, heropbouw, ruil-doorvoer). De heropbouw leest hem vóór
 * het rekenen en vlak vóór het vervangen: verschilt hij, dan schreef iemand
 * anders intussen en zou de verse set die wijziging overschrijven. null = niet
 * te lezen (tabel ontbreekt, geen db): de aanroeper slaat de controle dan
 * over, zoals vóór deze vangrail.
 */
export const getPlanningVersion = async (): Promise<number | null> => {
  try {
    const client = requireDb();
    const { data, error } = await client.from('planning_version').select('version').limit(1).maybeSingle();
    if (error) return null;
    const versie = Number((data as { version?: unknown } | null)?.version);
    return Number.isFinite(versie) ? versie : null;
  } catch {
    return null;
  }
};

// --- Planning matrix rows ---

/**
 * Matrixrijen, standaard de volledige historiek.
 *
 * `month` ("JJJJ-MM") begrenst de lezing tot die kalendermaand. Aanroepers die
 * tóch alleen die maand gebruiken (het maandbord, de dagafsluiting) lazen
 * anders elke keer álles: de matrix dekte op 18-09 vier maanden (131 rijen,
 * 141 kB) en groeit met elke ET-import, terwijl de maand er daarna in het
 * geheugen uit gefilterd werd (`berekenCelWaarheid` → monthRows). De rem zit
 * dus op de verkeerde plek: het verkeer Supabase → functie groeide mee met de
 * leeftijd van het portaal, en het maandbord doet per keer twee van deze
 * aanroepen (het tweewekenvenster valt bijna altijd over een maandgrens).
 * Gebruikt de bestaande index `planning_matrix_rows_source_date_idx`.
 */
export const getPlanningMatrixRows = async (opts?: { month?: string; van?: string; tot?: string }): Promise<PlanningMatrixRow[]> => {
  const client = requireDb();
  // Alleen een welgevormde maand filtert; alles anders leest de hele matrix,
  // zodat een tikfout nooit stil een halflege planning oplevert.
  // `van`/`tot` (ronde 3): zelfde idee voor een dagvenster, bv. de dekking
  // over [from, to]. Beide moeten een échte ISO-dag zijn (source_date is een
  // date-kolom: een ongeldige waarde zou daar een fout geven waar de
  // JS-filter vroeger gewoon niets vond); anders geen grens.
  const grens = maandGrenzen(String(opts?.month ?? ''))
    ?? (isEchteIsoDag(opts?.van) && isEchteIsoDag(opts?.tot) ? { van: String(opts!.van), tot: String(opts!.tot) } : null);
  return paginatedFetch<PlanningMatrixRow>((from, to) => {
    let q = client
      .from('planning_matrix_rows')
      .select('*')
      .order('source_date', { ascending: true })
      .range(from, to);
    if (grens) q = q.gte('source_date', grens.van).lte('source_date', grens.tot);
    return q;
  });
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
 * Periode-import: matrix + afgeleide planning atomair vervangen, maar ALLEEN
 * binnen het datumbereik van het aangeleverde bestand (RPC
 * replace_planning_and_matrix_periode leidt dat bereik zelf af uit min/max
 * source_date). Alles buiten het bereik blijft staan — zo kunnen twee
 * aansluitende maandplanningen ("actueel" en "vanaf september") naast elkaar
 * bestaan. Een lege shifts-set is toegestaan (import met enkel verlof-/
 * afwezigheidscodes): de planning binnen het bereik wordt dan bewust geleegd.
 *
 * Fallback zolang de RPC niet bestaat (migratie nog niet gedraaid): zelfde
 * periode-semantiek, maar niet-atomisch (losse delete/insert-calls). Bewust
 * NIET terugvallen op de oude alles-wissende replaces — de UI belooft
 * intussen dat de rest blijft staan.
 */
export const replacePlanningAndMatrix = async (rows: PlanningMatrixRow[], shifts: ShiftRecord[]) => {
  const client = requireDb();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Lege matrix-set geweigerd: er valt geen periode uit af te leiden.");
  }
  const { error: rpcError } = await client.rpc('replace_planning_and_matrix_periode', {
    matrix_rows: rows,
    shifts: Array.isArray(shifts) ? shifts : [],
  });
  if (!rpcError) return;
  if (!isMissingDbFunction(rpcError)) throw rpcError;
  console.warn('replace_planning_and_matrix_periode ontbreekt (migratie niet gedraaid?), val terug op het niet-atomische periode-pad.');
  const dates = rows.map((r) => String(r.source_date)).filter(Boolean).sort();
  const spanStart = dates[0];
  const spanEnd = dates[dates.length - 1];
  if (!spanStart || !spanEnd) {
    throw new Error("Matrixrijen zonder geldige source_date, periode niet af te leiden.");
  }
  const { error: matrixDeleteError } = await client
    .from('planning_matrix_rows').delete().gte('source_date', spanStart).lte('source_date', spanEnd);
  if (matrixDeleteError) throw matrixDeleteError;
  const { error: matrixInsertError } = await client.from('planning_matrix_rows').insert(rows);
  if (matrixInsertError) throw matrixInsertError;
  const { error: planningDeleteError } = await client
    .from('planning').delete().gte('date', spanStart).lte('date', spanEnd);
  if (planningDeleteError) throw planningDeleteError;
  if (Array.isArray(shifts) && shifts.length > 0) {
    const { error: planningInsertError } = await client.from('planning').insert(shifts);
    if (planningInsertError) throw planningInsertError;
  }
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
  // De nieuwe velden zijn optioneel in béide vormen, dus `in`-narrowing werkt
  // hier niet — lees beide spellingen via een brede cast.
  filename: row.filename ?? null,
  importedBy: (row as PlanningMatrixImportHistoryRecord).importedBy ?? (row as PlanningMatrixImportHistoryRow).imported_by ?? null,
  periodStart: (row as PlanningMatrixImportHistoryRecord).periodStart ?? (row as PlanningMatrixImportHistoryRow).period_start ?? null,
  periodEnd: (row as PlanningMatrixImportHistoryRecord).periodEnd ?? (row as PlanningMatrixImportHistoryRow).period_end ?? null,
  fileStart: (row as PlanningMatrixImportHistoryRecord).fileStart ?? (row as PlanningMatrixImportHistoryRow).file_start ?? null,
  fileEnd: (row as PlanningMatrixImportHistoryRecord).fileEnd ?? (row as PlanningMatrixImportHistoryRow).file_end ?? null,
  snapshotPath: (row as PlanningMatrixImportHistoryRecord).snapshotPath ?? (row as PlanningMatrixImportHistoryRow).snapshot_path ?? null,
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
    filename: entry.filename ?? null,
    imported_by: entry.importedBy ?? null,
    period_start: entry.periodStart ?? null,
    period_end: entry.periodEnd ?? null,
    file_start: entry.fileStart ?? null,
    file_end: entry.fileEnd ?? null,
    snapshot_path: entry.snapshotPath ?? null,
  };
  const { error } = await client.from('planning_matrix_import_history').insert(historyRow);
  // Niet gooien: de import zelf is op dit punt al geslaagd. Wel eerlijk
  // teruggeven, zodat de route de planner kan waarschuwen dat er geen
  // herstelpunt is — voorheen bleef dit een console.error en meldde de
  // import gewoon succes (controle-ronde 27-08, bevinding 25).
  if (error) {
    console.error("Supabase error saving planning matrix history:", error);
    return false;
  }
  return true;
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
  opts?: { sinceIso?: string | null; max?: number; metRuilBekeken?: boolean },
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
  //
  // Zelfde redenering voor "Dienstruil bekeken" (de collega kreeg een aanvraag
  // in beeld): een waarneming, geen beheeractie. Ze voedt het verloop van de
  // ruil (getSwapVerloopRegels) en hoort niet als ruis tussen de handelingen
  // op het scherm Activiteit. Alleen de back-up vraagt ze wél mee op.
  const sinceIso = opts?.sinceIso ?? null;
  const max = Math.max(1, opts?.max ?? 100);
  const rows = await paginatedFetch<ActivityLogRow>((from, to) => {
    let q = client
      .from("activity_log")
      .select("*")
      .or("category.neq.auth,and(action.neq.Aangemeld,action.neq.Actief)");
    if (!opts?.metRuilBekeken) q = q.neq("action", RUIL_BEKEKEN_ACTIE);
    q = q
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
  // Gepagineerd, net als getActivityLog: PostgREST kapt élke select op
  // 1.000 rijen, dus .limit(3000) leverde er nooit meer dan 1.000 — de
  // oudste dagen van het aanwezigheidsoverzicht vielen dan stil weg
  // (controle-ronde 27-08, bevinding 24). Fouten gooien i.p.v. [] — een lege
  // lijst is niet te onderscheiden van "niemand meldde zich aan".
  const rows = await paginatedFetch<ActivityLogRow>((from, to) =>
    client
      .from("activity_log")
      .select("*")
      .eq("category", "auth")
      .in("action", ["Aangemeld", "Actief"])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(from, Math.min(to, limit - 1)),
  limit);
  return rows.map(toPublicActivityLog);
};

/** Tijdstip (ISO) van het meest recente auth-event ('Aangemeld' of 'Actief')
 *  van één gebruiker — voor de éénmaal-per-dag-dedup van het 'Actief'-event
 *  bij sessie-herstel. null = nog geen auth-event bekend. */
/** Laatste aanmeldingen van één gebruiker (Instellingen › Beveiliging). */
export const getRecentLogins = async (userId: string, max = 8): Promise<Array<{ at: string; action: string }>> => {
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("created_at, action")
    .eq("category", "auth")
    .in("action", ["Aangemeld", "Actief"])
    .eq("entity_type", "user")
    .eq("entity_id", userId)
    .order("created_at", { ascending: false })
    .limit(max);
  if (error || !data) return [];
  return (data as Array<{ created_at: string; action: string }>).map((r) => ({ at: r.created_at, action: r.action }));
};

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

/** Zoveel id's gaan hoogstens in één `in.(...)`-filter (100 uuid's is ±4 kB querystring). */
const IN_FILTER_MAX = 100;
const inStukken = <T,>(lijst: readonly T[], grootte: number): T[][] =>
  Array.from({ length: Math.ceil(lijst.length / grootte) }, (_, i) => lijst.slice(i * grootte, (i + 1) * grootte));

/** Activiteitenlog van een reeks dienstruilen, oudste eerst — het verloop
 *  dat het weekoverzicht per wissel afdrukt. Eén query i.p.v. één per wissel:
 *  een drukke week telt al snel 20 wissels. Zonder "Dienstruil bekeken": het
 *  blad is een bewijsstuk van wat er gedaan is, niet van wie wanneer keek. */
export const getSwapHistories = async (
  swapIds: string[],
): Promise<Record<string, ActivityLogRecord[]>> => {
  const ids = [...new Set(swapIds.map((id) => String(id)).filter(Boolean))];
  if (ids.length === 0) return {};
  const client = requireDb();
  // In stukken van 100 id's: PostgREST zet `in.(...)` in de querystring, en
  // sinds het overzicht een jaar mag beslaan (rapportgrens) past een drukke
  // periode niet meer in één URL. Per stuk oudste eerst; de groepering per
  // wissel hieronder houdt die volgorde.
  const stukken = await Promise.all(inStukken(ids, IN_FILTER_MAX).map((deel) =>
    paginatedFetch<ActivityLogRow>((from, to) =>
      client
        .from("activity_log")
        .select("*")
        .eq("entity_type", "swap")
        .in("entity_id", deel)
        .neq("action", RUIL_BEKEKEN_ACTIE)
        .order("created_at", { ascending: true })
        .range(from, to),
    deel.length * 40)));
  const rows = stukken.flat();
  const perSwap: Record<string, ActivityLogRecord[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const row of rows) {
    const entry = toPublicActivityLog(row);
    const id = String(entry.entityId ?? "");
    if (perSwap[id]) perSwap[id].push(entry);
  }
  return perSwap;
};

/** Boven dit aantal ruilen gaat het id-filter niet meer in de URL (PostgREST
 *  zet `in.(...)` in de querystring; 100 uuid's is ±4 kB) en lezen we alle
 *  ruil-logregels in één keer. Dat zijn er enkele per ruil. */
const VERLOOP_ID_FILTER_MAX = 100;

export type SwapVerloopLogRegel = Pick<ActivityLogRecord, "createdAt" | "action" | "actorRole" | "actorName" | "details">;

/**
 * De logregels waaruit het verloop per persoon wordt afgeleid
 * (shared/ruilVerloop.ts), voor ALLE gevraagde ruilen in één query, gegroepeerd
 * per ruil-id en oudste eerst. `swapIds` weglaten = elke ruil (staf). Alleen
 * de kolommen die de afleiding nodig heeft.
 */
export const getSwapVerloopRegels = async (swapIds?: string[]): Promise<Record<string, SwapVerloopLogRegel[]>> => {
  const ids = swapIds ? [...new Set(swapIds.map((id) => String(id)).filter(Boolean))] : null;
  if (ids && ids.length === 0) return {};
  const metFilter = !!ids && ids.length <= VERLOOP_ID_FILTER_MAX;
  const client = requireDb();
  type Rij = Pick<ActivityLogRow, "id" | "created_at" | "action" | "actor_role" | "actor_name" | "details" | "entity_id">;
  const rows = await paginatedFetch<Rij>((from, to) => {
    let q = client
      .from("activity_log")
      .select("id, created_at, action, actor_role, actor_name, details, entity_id")
      .eq("entity_type", "swap");
    if (metFilter) q = q.in("entity_id", ids!);
    // Unieke sortering (created_at + id), anders kan een paginagrens een regel
    // overslaan of dubbel geven.
    return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });
  const gevraagd = ids ? new Set(ids) : null;
  const perSwap: Record<string, SwapVerloopLogRegel[]> = {};
  for (const row of rows) {
    const id = String(row.entity_id ?? "");
    if (!id || (gevraagd && !gevraagd.has(id))) continue;
    (perSwap[id] ??= []).push({
      createdAt: row.created_at,
      action: row.action,
      actorRole: row.actor_role,
      actorName: row.actor_name,
      details: row.details,
    });
  }
  return perSwap;
};

/** Log-regels die een dienstwissel écht doorvoeren, binnen [vanIso, totIso).
 *  Dit is het antwoord op "welke wissels zijn die week uitgevoerd": niet de
 *  wissels die díe week in de planning stonden, maar de wissels die in dat
 *  venster in het portaal zijn doorgevoerd — goedkeuring van een ruil én de
 *  handmatige wissels van de planning. Oudste eerst (chronologisch, zoals het
 *  klassement ze wil). */
export const getSwapExecutions = async (
  vanIso: string,
  totIso: string,
  acties: string[],
): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  const rows = await paginatedFetch<ActivityLogRow>((from, to) =>
    client
      .from("activity_log")
      .select("*")
      .eq("entity_type", "swap")
      .in("action", acties)
      .gte("created_at", vanIso)
      .lt("created_at", totIso)
      .order("created_at", { ascending: true })
      .range(from, to),
  // Vangnet, geen verwachting: het venster is hoogstens 366 dagen en VHB voert
  // enkele wissels per week door.
  5000);
  return rows.map(toPublicActivityLog);
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

/** Tekstvelden vergelijken zoals ze bedoeld zijn: een lege telefoon uit het
 *  formulier ('') en een NULL uit de database zijn hetzelfde. Zonder deze
 *  gelijkstelling logde elke opslag van de gebruikerslijst "telefoon" voor
 *  iedereen zonder nummer (1.283× "Gebruiker gewijzigd" in 60 dagen,
 *  gezien 08-09-2026). */
const anders = (a: unknown, b: unknown): boolean => String(a ?? '').trim() !== String(b ?? '').trim();

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
        anders(previous.name, user.name) ||
        previous.role !== user.role ||
        anders(previous.employeeId, user.employeeId) ||
        anders(previous.phone, user.phone) ||
        anders(previous.email, user.email) ||
        previous.verlofBudget !== user.verlofBudget ||
        Boolean(previous.isActive ?? true) !== Boolean(user.isActive ?? true)
      );
    })
    .map((user) => {
      const previous = previousById.get(String(user.id))!;
      const fields: string[] = [];
      if (anders(previous.name, user.name)) fields.push(`naam: ${previous.name}→${user.name}`);
      if (previous.role !== user.role) fields.push(`rol: ${previous.role}→${user.role}`);
      if (anders(previous.employeeId, user.employeeId)) fields.push(`employeeId: ${previous.employeeId}→${user.employeeId}`);
      if (anders(previous.phone, user.phone)) fields.push(`telefoon`);
      if (anders(previous.email, user.email)) fields.push(`email`);
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
  return bouwPlanningUitMatrix({ rows, users, services: services as ServiceRecord[], planningCodes });
};

/**
 * Pure kern van de planning-opbouw (matrix × dienstoverzicht × codes →
 * planning-rijen + samenvatting). Losgetrokken van de data-fetches zodat het
 * integratieharnas de échte opbouw draait op zijn in-memory store — de
 * keten-bugs (wegvallende chauffeurs, segmenten, absences) zaten hier, niet
 * in de fetches.
 */
export const bouwPlanningUitMatrix = ({ rows, users, services, planningCodes }: {
  rows: PlanningMatrixRow[];
  users: AppUser[];
  services: ServiceRecord[];
  planningCodes: PlanningCodeRecord[];
}) => {
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
        unmatchedDrivers.add(`${driverName} (ambigu: meerdere gebruikers met deze naam, maak de namen uniek in gebruikersbeheer)`);
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
          // LET OP: driver.id hierin is de chauffeur uit de MATRIX, en die
          // blijft in de id staan ook nadat een goedgekeurde ruil de rij naar
          // een collega verhuisde (movePlanningRows wijzigt alleen de kolom
          // driverId). De id is dus geen betrouwbare eigenaar-bron — lees
          // altijd de kolom.
          //
          // Bewust niet herschreven bij een doorvoer: swaps.shiftId verwijst
          // naar deze id, dus hernoemen zou bestaande ruilen laten dangelen.
          // De exclusiviteitscheck bij goedkeuren keek hier vroeger wél naar
          // en blokkeerde daardoor elke dóórgeef-ketting; die kijkt sinds
          // 01-08-2026 naar de huidige eigenaar (staleApprovalError).
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

/** Het e-mailadres hoort in Supabase Auth al bij een ánder account dan dat
 *  van dit profiel. De routes vertalen dit naar een 409 (conflict: "email")
 *  — vroeger werd het profiel dan stil aan dat vreemde account gekoppeld
 *  (controle 05-09, nr. 29). */
export class EmailInGebruikError extends Error {
  constructor(public readonly email: string) {
    super("Dit e-mailadres is al in gebruik bij een ander account.");
    this.name = "EmailInGebruikError";
  }
}

export const getUsersData = async (): Promise<AppUserIntern[]> => {
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

  const currentUsers = await getUsersData();
  const currentById = new Map<string, AppUser>(currentUsers.map((user): [string, AppUser] => [String(user.id), user]));
  // Sessie-velden (lastLogin/activeSessions) zijn server-eigendom: ze worden
  // per login/logout gericht bijgewerkt (updateUserSessionMeta/
  // bumpActiveSessions). Wat de client meestuurt is een momentopname van
  // uren geleden en werd bij elke save teruggeschreven — na een 409 zelfs
  // de stand van vóór de refetch (controle-ronde 27-08). Bestaande rijen
  // houden hun DB-waarde; nieuwe rijen starten schoon.
  const sanitizedUsers = incomingUsers.map((user) => {
    const sanitized = sanitizeIncomingUser(user);
    const previous = currentById.get(sanitized.id);
    return previous
      ? { ...sanitized, lastLogin: previous.lastLogin, activeSessions: previous.activeSessions }
      : { ...sanitized, lastLogin: undefined, activeSessions: 0 };
  });
  if (countAdmins(sanitizedUsers) === 0) {
    throw new Error("Er moet minstens 1 actieve admin overblijven.");
  }
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

  // Vangrail (controle 05-09, nr. 29), vóór élke write: een adres waar in
  // Supabase Auth al een account op staat mag een profiel niet stil aan dat
  // account koppelen — dat gaf iemand anders' login toegang tot dit profiel.
  //  - Bestaand profiel dat van adres wisselt: het account op het nieuwe
  //    adres moet zijn éigen account zijn (authid, of bij gebrek daaraan het
  //    account op het oude adres); anders is het van iemand anders.
  //  - Nieuw profiel: een Auth-account op dat adres mag alleen als geen
  //    ander profiel eraan gekoppeld is (verweesd account → koppelen mag,
  //    zoals bij het aanmaken van profielen voor bestaande accounts).
  // De routes vangen dubbele adressen in de users-tabel zelf; dit is de
  // Auth-kant, die daar niet zichtbaar is. Hier en niet in de lus verderop,
  // omdat de tabel anders al het nieuwe adres had terwijl Auth nog het oude hield.
  for (const sanitizedUser of sanitizedUsers) {
    const currentEmail = normalizeEmail(sanitizedUser.email);
    const authOpAdres = currentEmail ? authUsersByEmail.get(currentEmail) : undefined;
    if (!currentEmail || !authOpAdres) continue;
    const previousUser = currentById.get(String(sanitizedUser.id)) as AppUserIntern | undefined;
    const previousEmail = normalizeEmail(previousUser?.email);
    const eigenAuthId = previousUser?.authId ?? (previousEmail ? authUsersByEmail.get(previousEmail)?.id : undefined);
    const adresWisselt = Boolean(previousUser) && previousEmail !== currentEmail;
    const vanAnderProfiel = currentUsers.some((u) => String(u.id) !== String(sanitizedUser.id) && u.authId === authOpAdres.id);
    if ((adresWisselt && authOpAdres.id !== eigenAuthId) || (!previousUser && vanAnderProfiel)) {
      throw new EmailInGebruikError(currentEmail);
    }
  }

  // DB-writes EERST. De Auth-mutaties hieronder zijn onomkeerbaar; door de
  // database vooraf te schrijven faalt een DB-fout vóór er ook maar één
  // Auth-account is aangemaakt of verwijderd (geen weeskonten / verweesde
  // profielen door een halverwege gefaalde write).
  if (removedUserIds.length > 0) {
    const { error } = await client.from('users').delete().in('id', removedUserIds);
    if (error) throw error;
  }
  // Bestaande rijen zónder de sessie-kolommen upserten, zodat een login die
  // tussen het lezen hierboven en dit schrijven in valt niet alsnog
  // overschreven wordt; nieuwe rijen mét (schone) sessie-kolommen. Twee
  // upserts, want PostgREST eist per batch identieke sleutels.
  const SESSIE_KOLOMMEN = new Set(['lastlogin', 'activesessions']);
  const bestaandeRijen = sanitizedUsers
    .filter((user) => currentById.has(String(user.id)))
    .map((user) => Object.fromEntries(Object.entries(toDatabaseUser(user)).filter(([kolom]) => !SESSIE_KOLOMMEN.has(kolom))));
  const nieuweRijen = sanitizedUsers
    .filter((user) => !currentById.has(String(user.id)))
    .map(toDatabaseUser);
  for (const rijen of [bestaandeRijen, nieuweRijen]) {
    if (rijen.length === 0) continue;
    const { error } = await client.from('users').upsert(rijen);
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
      if (!sanitizedUser.isActive && data.user) await zetAuthBan(data.user.id, true);
      if (data.user) await koppelAuthIdStil(String(sanitizedUser.id), data.user.id);
      continue;
    }

    // Profiel hoort bij dít Auth-account (nieuw gekoppeld, of admin wees een
    // adres toe waar al een Auth-account op stond) — koppeling meteen
    // vastleggen, anders liep de sessie-identiteit (authid) achter (SQL-review 05-09).
    if ((previousUser as AppUserIntern | undefined)?.authId !== currentAuthUser.id) {
      await koppelAuthIdStil(String(sanitizedUser.id), currentAuthUser.id);
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

    // Pauzeren/heractiveren doorzetten naar Supabase Auth. "Pauzeer" zette
    // alleen users.isactive; het Auth-account kon blijven inloggen en via
    // PostgREST (anon-key + eigen JWT) rechtstreeks lezen, buiten de API en
    // de toestel-whitelist om (controle-ronde 27-08, bevinding 1 — de
    // RLS-kant zit in supabase/2026-08-28_rls_inactieve_gebruikers.sql).
    // Reconciliatie op de wérkelijke ban-staat, niet op de overgang: zo
    // raken accounts die vóór deze fix gepauzeerd werden bij de
    // eerstvolgende save alsnog geband.
    const bannedUntil = (currentAuthUser as { banned_until?: string | null }).banned_until;
    const isGebannen = Boolean(bannedUntil) && new Date(String(bannedUntil)).getTime() > Date.now();
    if (isGebannen !== !sanitizedUser.isActive) await zetAuthBan(currentAuthUser.id, !sanitizedUser.isActive);
  }
  // (DB-delete + DB-upsert zijn hierboven al uitgevoerd, vóór de Auth-mutaties.)
  return { createdAccounts };
};

/** Auth-account (de)blokkeren. Een ban van 100 jaar is Supabase's manier om
 *  een account uit te zetten zonder het te verwijderen; "none" heft hem op.
 *  Bestaande access-tokens lopen nog hooguit een uur door — de RLS-policies
 *  vangen die periode op. */
const zetAuthBan = async (authUserId: string, gebannen: boolean) => {
  if (!supabaseAdmin) throw new Error("Supabase-admin niet geconfigureerd.");
  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, { ban_duration: gebannen ? "876000h" : "none" });
  if (error) throw error;
};

/** Gericht sessie-metadata bijwerken — alléén de eigen rij.
 * Voorheen liep elke login/logout via saveUsersData (replace-all incl.
 * Supabase-auth-sync): gelijktijdige logins raceten met elkaar én met
 * admin-bewerkingen (een net verwijderde gebruiker kon zo terugkomen). */
/** Koppel een profiel aan zijn Supabase Auth-uid (eerste keer dat de
 *  gebruiker met dit account aanmeldt). Daarna geldt de uid als identiteit. */
export const koppelAuthId = async (userId: string, authId: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from('users').update({ authid: authId }).eq('id', String(userId));
  if (error) throw error;
};

/** Zelfde, maar best-effort: vóór migratie 2026-09-05_users_authid.sql
 *  bestaat de kolom niet en mag een gebruikers-save daar niet op falen. */
let koppelStilGemeld = false;
const koppelAuthIdStil = async (userId: string, authId: string): Promise<void> => {
  try {
    await koppelAuthId(userId, authId);
  } catch (err: any) {
    if (!koppelStilGemeld) {
      koppelStilGemeld = true;
      console.error("[users] authid koppelen mislukt (migratie users.authid gedraaid?):", err?.message ?? err);
    }
  }
};

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

/** Eigen dashboardindeling opslaan (users.dashboardvoorkeuren, jsonb —
 *  2026-09-06_meldingen.sql). Alleen deze kolom; de gebruikers-save
 *  (toDatabaseUser) raakt hem niet aan. Gooit door: de route vertaalt een
 *  ontbrekende kolom naar een duidelijke 503 met de migratienaam. */
export const updateUserDashboardVoorkeuren = async (userId: string, voorkeuren: DashboardVoorkeuren): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from('users').update({ dashboardvoorkeuren: voorkeuren }).eq('id', String(userId));
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

// null = nog niet geprobeerd; false = kolom `location` bestaat (nog) niet.
let diversionsMetLocation: boolean | null = null;
const zonderLocation = ({ location: _l, ...rest }: ReturnType<typeof toDatabaseDiversion>) => rest;

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
    const rows = normalized.map(toDatabaseDiversion);
    let { error: upsertError } = diversionsMetLocation === false
      ? await client.from('diversions').upsert(rows.map(zonderLocation))
      : await client.from('diversions').upsert(rows);
    // Migratie 2026-09-10_diversions_location.sql nog niet gedraaid: één
    // mislukte upsert, daarna schrijven we (per warme lambda) zonder `location`.
    if (upsertError && diversionsMetLocation !== false && isMissingColumnError(upsertError)) {
      diversionsMetLocation = false;
      ({ error: upsertError } = await client.from('diversions').upsert(rows.map(zonderLocation)));
    } else if (!upsertError) {
      diversionsMetLocation = true;
    }
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

const BACKUPS_BUCKET = "backups";
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

// --- Herstelpunten vóór een matrix-import ---
//
// Vóór elke bevestigde import gaat de volledige stand van matrix + planning
// als JSON de backups-bucket in. Terugzetten = integraal vervangen door die
// stand — daarvoor bestaan de losse full-replace-paden nog precies.

const SNAPSHOT_PREFIX = 'import-herstelpunt-';
const SNAPSHOT_BEWAREN = 5;

export type ImportSnapshot = {
  createdAt: string;
  matrixRows: PlanningMatrixRow[];
  planning: ShiftRecord[];
};

export const storeImportSnapshot = async (snapshot: ImportSnapshot): Promise<string> => {
  if (!supabaseAdmin) {
    throw new Error('Herstelpunten vereisen de service-role client (SUPABASE_SERVICE_ROLE_KEY).');
  }
  const filename = `${SNAPSHOT_PREFIX}${snapshot.createdAt.replace(/[:.]/g, '-')}.json`;
  const body = JSON.stringify(snapshot);
  const upload = () =>
    supabaseAdmin.storage.from(BACKUPS_BUCKET).upload(filename, Buffer.from(body, 'utf8'), {
      contentType: 'application/json',
      upsert: true,
    });
  let { error } = await upload();
  if (error && /bucket.*not.*found/i.test(error.message ?? '')) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(BACKUPS_BUCKET, { public: false });
    if (createError) throw new Error(`Backups-bucket aanmaken mislukt: ${createError.message}`);
    ({ error } = await upload());
  }
  if (error) throw new Error(`Herstelpunt uploaden mislukt: ${error.message}`);

  // Alleen de laatste SNAPSHOT_BEWAREN herstelpunten bewaren — de namen
  // bevatten de ISO-timestamp, dus alfabetisch sorteren = chronologisch.
  const { data: files } = await supabaseAdmin.storage.from(BACKUPS_BUCKET).list(undefined, { limit: 1000 });
  const snapshots = (files ?? [])
    .map((f: any) => f.name as string)
    .filter((name) => name.startsWith(SNAPSHOT_PREFIX))
    .sort();
  const teVerwijderen = snapshots.slice(0, Math.max(0, snapshots.length - SNAPSHOT_BEWAREN));
  if (teVerwijderen.length > 0) {
    await supabaseAdmin.storage.from(BACKUPS_BUCKET).remove(teVerwijderen);
  }
  return filename;
};

export const getImportSnapshot = async (path: string): Promise<ImportSnapshot | null> => {
  if (!supabaseAdmin) {
    throw new Error('Herstelpunten vereisen de service-role client (SUPABASE_SERVICE_ROLE_KEY).');
  }
  const { data, error } = await supabaseAdmin.storage.from(BACKUPS_BUCKET).download(path);
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text());
    if (!Array.isArray(parsed?.matrixRows) || !Array.isArray(parsed?.planning)) return null;
    return parsed as ImportSnapshot;
  } catch {
    return null;
  }
};

/** Volledige terugzet naar een herstelpunt. Niet-atomisch (twee losse
 *  full-replaces) — acceptabel voor een bewuste admin-hersteldaad; de
 *  matrix gaat eerst zodat een halve terugzet bij de volgende heropbouw
 *  herstelbaar blijft. Lege planning in het herstelpunt = bewust wissen. */
export const restorePlanningAndMatrixSnapshot = async (snapshot: ImportSnapshot) => {
  await savePlanningMatrixRows(snapshot.matrixRows);
  if (snapshot.planning.length > 0) {
    await replacePlanningData(snapshot.planning);
  } else {
    await clearPlanningData();
  }
};

/** Laatste back-up teruglezen — voor de maandelijkse restore-proef. */
export const getLatestBackup = async (): Promise<{ filename: string; body: string } | null> => {
  if (!supabaseAdmin) {
    throw new Error("Back-ups vereisen de service-role client (SUPABASE_SERVICE_ROLE_KEY).");
  }
  const { data: files, error } = await supabaseAdmin.storage.from(BACKUPS_BUCKET).list(undefined, { limit: 1000 });
  if (error) throw new Error(`Back-uplijst ophalen mislukt: ${error.message}`);
  const names = (files ?? [])
    .map((f: any) => f.name as string)
    .filter((n) => /^vhb-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort();
  const newest = names[names.length - 1];
  if (!newest) return null;
  const { data, error: dlError } = await supabaseAdmin.storage.from(BACKUPS_BUCKET).download(newest);
  if (dlError || !data) throw new Error(`Back-up downloaden mislukt: ${dlError?.message ?? "leeg"}`);
  return { filename: newest, body: await data.text() };
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
  /** Eerste keer geopend door de chauffeur; null = nog niet geopend. */
  openedAt?: string | null;
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
  openedAt: row.opened_at ?? null,
});

/** Alle documenten (userId undefined, admin-pad), of alleen die van één
 *  gebruiker. Een LEGE string is geen "alles" maar "niets" — fail-closed
 *  tegen een ontbrekende gebruikers-id op het aanroepende pad. */
export const listUserDocuments = async (userId?: string): Promise<UserDocumentRecord[]> => {
  if (userId !== undefined && !userId) return [];
  const client = requireDb();
  // Gepagineerd i.p.v. .limit(500): onthaal-kopieën plus maandelijkse
  // loonbrieven passeren die grens binnen een jaar, en dan verloren de
  // admin-lijst en de back-up stil de oudste documenten (controle-ronde
  // 27-08, bevinding 26).
  const rows = await paginatedFetch<any>((from, to) => {
    let query = client.from("user_documents").select("*").order("uploaded_at", { ascending: false }).range(from, to);
    if (userId) query = query.eq("user_id", userId);
    return query;
  });
  return rows.map(mapUserDocumentRow);
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

/** Leesbevestiging: zet opened_at bij de EERSTE keer openen (daarna vast —
 *  "wanneer zag hij het voor het eerst" is de vraag bij discussies).
 *  Best-effort: zolang de opened_at-migratie niet gedraaid is, mag dit het
 *  openen zelf nooit breken. */
export const markUserDocumentOpened = async (id: string, userId: string): Promise<void> => {
  if (!db) return;
  try {
    await db
      .from("user_documents")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", String(userId))
      .is("opened_at", null);
  } catch {
    // kolom ontbreekt of update faalt — bewust stil
  }
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
/** Onthaal-documenten (categorie "Onthaal") automatisch klaarzetten voor een
 *  nieuwe chauffeur: per bestandsnaam de recentste versie die een collega al
 *  kreeg, gekopieerd in de bucket — zo krijgt elke nieuwkomer de
 *  onthaalbrochure zonder dat de planner eraan moet denken. Best-effort:
 *  geen Onthaal-documenten of geen service-role = no-op. */
export const kopieerOnthaalDocumentenNaar = async (userId: string): Promise<number> => {
  if (!supabaseAdmin) return 0;
  const client = requireDb();
  const { data, error } = await client
    .from("user_documents")
    .select("*")
    .ilike("category", "onthaal")
    .order("uploaded_at", { ascending: false })
    .limit(200);
  if (error || !data || data.length === 0) return 0;
  const { data: eigen } = await client.from("user_documents").select("filename").eq("user_id", String(userId));
  const heeftAl = new Set((eigen ?? []).map((r: any) => String(r.filename ?? "").toLowerCase()));
  // Nieuwste versie per bestandsnaam wint (de query is aflopend gesorteerd).
  const perBestand = new Map<string, any>();
  for (const row of data) {
    const key = String(row.filename ?? "").toLowerCase();
    if (key && !perBestand.has(key)) perBestand.set(key, row);
  }
  let done = 0;
  for (const row of perBestand.values()) {
    const key = String(row.filename ?? "").toLowerCase();
    if (heeftAl.has(key) || String(row.user_id) === String(userId)) continue;
    const safeName = String(row.filename).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
    const doelPath = `${userId}/${crypto.randomUUID()}-${safeName}`;
    const { error: copyError } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).copy(String(row.storage_path), doelPath);
    if (copyError) {
      console.error(`[onthaal-docs] kopie voor ${userId} mislukt:`, copyError.message);
      continue;
    }
    await insertUserDocument({
      userId: String(userId),
      filename: String(row.filename),
      storagePath: doelPath,
      category: row.category ?? "Onthaal",
      sizeBytes: row.size_bytes ?? null,
      uploadedBy: "automatisch (onthaal)",
    });
    done++;
  }
  return done;
};

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
  // Context sinds 2026-09-06 (supabase/2026-09-06_client_errors_groepen.sql);
  // zonder die migratie vallen we terug op de basiskolommen.
  fingerprint?: string;
  release?: string;
  view?: string;
  role?: string;
  online?: boolean;
  breadcrumbs?: unknown;
  topFrame?: string;
};

/** Herkent "kolom bestaat niet" (migratie niet gedraaid): Postgres 42703,
 *  PostgREST PGRST204 (schema-cache kent de kolom niet). */
const isMissingColumnError = (err: unknown): boolean => {
  const code = String((err as { code?: unknown })?.code ?? "");
  const msg = String((err as { message?: unknown })?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || /column .* does not exist/.test(msg) || /could not find the .* column/.test(msg);
};

// Per warme lambda onthouden of de contextkolommen bestaan; null = nog niet
// geprobeerd. Zo kost de terugval op het basisschema één mislukte insert.
let clientErrorsUitgebreid: boolean | null = null;

/** Best-effort: de `client_errors`-tabel is optioneel — zonder tabel (of
 *  zonder db) blijft de console.error in de route-handler het vangnet
 *  (zichtbaar in de Vercel-functielogs). Mag zelf nooit throwen. */
export const logClientError = async (entry: ClientErrorEntry) => {
  if (!db) return;
  const basis = {
    message: entry.message,
    stack: entry.stack || null,
    source: entry.source || null,
    url: entry.url || null,
    user_agent: entry.userAgent || null,
    user_id: entry.userId || null,
  };
  const context = {
    fingerprint: entry.fingerprint || null,
    release: entry.release || null,
    view: entry.view || null,
    role: entry.role || null,
    online: typeof entry.online === "boolean" ? entry.online : null,
    breadcrumbs: Array.isArray(entry.breadcrumbs) ? entry.breadcrumbs : null,
    top_frame: entry.topFrame || null,
  };
  try {
    if (clientErrorsUitgebreid !== false) {
      const { error } = await db.from("client_errors").insert({ ...basis, ...context });
      if (!error) {
        clientErrorsUitgebreid = true;
        return;
      }
      if (!isMissingColumnError(error)) return; // tabel ontbreekt of andere fout, stil
      clientErrorsUitgebreid = false;
    }
    await db.from("client_errors").insert(basis);
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
  fingerprint: row.fingerprint ?? undefined,
  release: row.release ?? undefined,
  view: row.view ?? undefined,
  role: row.role ?? undefined,
  online: typeof row.online === "boolean" ? row.online : undefined,
  breadcrumbs: row.breadcrumbs ?? undefined,
  topFrame: row.top_frame ?? undefined,
});

// --- Status per foutgroep (client_error_status) ---
// Server-only tabel uit supabase/2026-09-06_client_errors_groepen.sql.
// `getClientErrorStatuses` geeft null zolang de tabel ontbreekt (probe): de
// API toont dan groepen zonder statusacties i.p.v. te crashen.

export type ClientErrorStatusRecord = {
  fingerprint: string;
  status: "open" | "opgelost" | "genegeerd";
  release: string | null;
  bijgewerktOp: string | null;
  door: string | null;
};

const mapClientErrorStatusRow = (row: any): ClientErrorStatusRecord => ({
  fingerprint: String(row.fingerprint),
  status: row.status,
  release: row.release ?? null,
  bijgewerktOp: row.bijgewerkt_op ?? null,
  door: row.door ?? null,
});

export const getClientErrorStatuses = async (): Promise<Map<string, ClientErrorStatusRecord> | null> => {
  if (!db) return null;
  try {
    const { data, error } = await db.from("client_error_status").select("*").limit(5000);
    if (error) return null;
    return new Map((data ?? []).map((r: any) => [String(r.fingerprint), mapClientErrorStatusRow(r)]));
  } catch {
    return null;
  }
};

/** Upsert; gooit wanneer de tabel ontbreekt (de route vertaalt dat naar 503). */
export const setClientErrorStatus = async (record: ClientErrorStatusRecord): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from("client_error_status").upsert({
    fingerprint: record.fingerprint,
    status: record.status,
    release: record.release,
    bijgewerkt_op: record.bijgewerktOp ?? new Date().toISOString(),
    door: record.door,
  });
  if (error) throw error;
};

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
export const pruneOldRecords = async (opts: { errorDays: number; logDays: number; noteDays: number; meldingDays: number; aanwezigheidDays: number }) => {
  const summary = { clientErrors: 0, activityLog: 0, planningNotes: 0, pushSubscriptions: 0, meldingen: 0, aanwezigheid: 0 };
  if (!db) return summary;
  const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    // Aanwezigheid is een waarneming van dagelijks gebruik, geen bewijsstuk.
    // Het overzicht kijkt hoogstens 90 dagen terug, dus alles daarvóór is
    // dode ballast; zonder deze regel groeit de tabel eeuwig door met enkele
    // tientallen rijen per dag.
    const { count, error } = await db
      .from("user_presence")
      .delete({ count: "exact" })
      .lt("last_seen_at", cutoff(opts.aanwezigheidDays));
    if (!error) summary.aanwezigheid = count ?? 0;
  } catch {
    // tabel ontbreekt (migratie niet gedraaid) — bewust stil
  }
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
    // Statussen volgen dezelfde retentie als de fouten zelf, behalve
    // 'genegeerd': die moet een terugkerende ruisfout blijven onderdrukken.
    await db
      .from("client_error_status")
      .delete()
      .neq("status", "genegeerd")
      .lt("bijgewerkt_op", cutoff(opts.errorDays));
  } catch {
    // tabel ontbreekt (migratie niet gedraaid) — bewust stil
  }
  try {
    // Dienstwissels blijven staan, hoe oud ook (Jarno 18-09): hun logregels
    // zijn de enige bron van "wanneer is deze wissel uitgevoerd en door wie",
    // en het wekelijkse ruiloverzicht is een bewijsstuk voor het klassement.
    // Het kost niets: het gaat om enkele regels per week, tegenover duizenden
    // per week voor de rest van het log.
    const { count, error } = await db
      .from("activity_log")
      .delete({ count: "exact" })
      .lt("created_at", cutoff(opts.logDays))
      .or("entity_type.is.null,entity_type.neq.swap");
    if (!error) summary.activityLog = count ?? 0;
  } catch {
    // idem
  }
  try {
    // Dienstnotities zijn operationeel ("neem bus 412") — na de rit zijn ze
    // waardeloos; de datumkolom is een ISO-dag dus lexicografisch vergelijkbaar.
    const { count, error } = await db
      .from("planning_notes")
      .delete({ count: "exact" })
      .lt("date", cutoff(opts.noteDays).slice(0, 10));
    if (!error) summary.planningNotes = count ?? 0;
  } catch {
    // idem
  }
  try {
    // Meldingen (meldingencentrum) zijn na drie maanden geschiedenis: wie ze
    // toen niet las, leest ze nu ook niet meer. Gelezen of niet maakt niet uit.
    const { count, error } = await db
      .from("meldingen")
      .delete({ count: "exact" })
      .lt("created_at", cutoff(opts.meldingDays));
    if (!error) summary.meldingen = count ?? 0;
  } catch {
    // tabel ontbreekt (migratie 2026-09-06 nog niet gedraaid) — bewust stil
  }
  try {
    // Push-abonnementen van verwijderde gebruikers. NIET op leeftijd prunen:
    // een abonnement wordt alleen bij het aanzetten geregistreerd, dus een oud
    // abonnement kan nog springlevend zijn (dode endpoints ruimt sendPushToUsers
    // al op via 404/410).
    const { data: userRows } = await db.from("users").select("id");
    const userIds = new Set((userRows ?? []).map((r: any) => String(r.id)));
    if (userIds.size > 0) {
      const { data: subRows } = await db.from("push_subscriptions").select("endpoint, user_id");
      const orphaned = (subRows ?? []).filter((r: any) => !userIds.has(String(r.user_id))).map((r: any) => r.endpoint);
      if (orphaned.length > 0) {
        const { count, error } = await db
          .from("push_subscriptions")
          .delete({ count: "exact" })
          .in("endpoint", orphaned);
        if (!error) summary.pushSubscriptions = count ?? 0;
      }
    }
  } catch {
    // idem
  }
  return summary;
};

// --- Meldingen (meldingencentrum, 2026-09-06_meldingen.sql) ---

const toPublicMelding = (row: any): MeldingRecord => ({
  id: String(row.id),
  titel: String(row.titel ?? ""),
  tekst: row.tekst ? String(row.tekst) : undefined,
  soort: row.soort,
  doel: row.doel ? String(row.doel) : undefined,
  createdAt: String(row.created_at ?? ""),
  gelezenOp: row.gelezen_op ? String(row.gelezen_op) : undefined,
});

/** Eén melding per ontvanger bewaren. Gooit door (de push-laag vangt het:
 *  een ontbrekende tabel mag een verlofbeslissing niet laten falen). */
export const bewaarMeldingen = async (userIds: string[], melding: MeldingInvoer): Promise<number> => {
  const ontvangers = [...new Set(userIds.map(String).filter(Boolean))];
  if (ontvangers.length === 0) return 0;
  const client = requireDb();
  const rijen = ontvangers.map((userId) => ({
    user_id: userId,
    titel: melding.titel,
    tekst: melding.tekst,
    soort: melding.soort,
    doel: melding.doel,
  }));
  const { error } = await client.from('meldingen').insert(rijen);
  if (error) throw error;
  return rijen.length;
};

/** Eigen meldingen, nieuwste eerst, hooguit `max` (de app toont er 100). */
export const getMeldingen = async (userId: string, max = 100): Promise<MeldingRecord[]> => {
  const client = requireDb();
  const { data, error } = await client
    .from('meldingen')
    .select('id, titel, tekst, soort, doel, created_at, gelezen_op')
    .eq('user_id', String(userId))
    .order('created_at', { ascending: false })
    .limit(max);
  if (error) throw error;
  return (data ?? []).map(toPublicMelding);
};

/** Aantal ongelezen meldingen van een gebruiker (over álle rijen, niet
 *  alleen de getoonde 100 — de badge moet kloppen). */
export const telOngelezenMeldingen = async (userId: string): Promise<number> => {
  const client = requireDb();
  const { count, error } = await client
    .from('meldingen')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', String(userId))
    .is('gelezen_op', null);
  if (error) throw error;
  return count ?? 0;
};

/** Gelezen markeren: de gegeven ids (alleen eigen rijen) of, zonder ids,
 *  alles wat nog ongelezen is. Geeft het aantal bijgewerkte rijen. */
export const markeerMeldingenGelezen = async (userId: string, ids?: string[]): Promise<number> => {
  const client = requireDb();
  let q = client
    .from('meldingen')
    .update({ gelezen_op: new Date().toISOString() }, { count: 'exact' })
    .eq('user_id', String(userId))
    .is('gelezen_op', null);
  if (ids && ids.length > 0) q = q.in('id', ids.map(String));
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
};

/** Verwijderen: alleen eigen rijen (user_id in de query, dus andermans ids
 *  doen niets). Geeft het aantal verwijderde rijen. */
export const verwijderMeldingen = async (userId: string, ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const client = requireDb();
  const { count, error } = await client
    .from('meldingen')
    .delete({ count: 'exact' })
    .eq('user_id', String(userId))
    .in('id', ids.map(String));
  if (error) throw error;
  return count ?? 0;
};

// --- Updates ---

export const getUpdatesData = async () => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('updates').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicUpdate);
};

export const UPDATE_BIJLAGEN_BUCKET = "update-bijlagen";

/** Sleutel in de bucket: één vaste plek per update en slot, dus opnieuw
 *  uploaden overschrijft en laat niets rondslingeren. */
export const updateBijlagePad = (updateId: string, slot: number) => `${updateId}-${slot}.pdf`;

/** PDF wegschrijven op de vaste plek van deze update en dit slot; opnieuw
 *  uploaden vervangt het vorige bestand. */
export const uploadUpdateBijlage = async (updateId: string, slot: number, buffer: Buffer): Promise<void> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const { error } = await supabaseAdmin.storage
    .from(UPDATE_BIJLAGEN_BUCKET)
    .upload(updateBijlagePad(updateId, slot), buffer, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
};

/** Eén bijlage weghalen. "Not found" is geen fout: dan stond er al niets. */
export const verwijderUpdateBijlage = async (updateId: string, slot: number): Promise<void> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const { error } = await supabaseAdmin.storage
    .from(UPDATE_BIJLAGEN_BUCKET)
    .remove([updateBijlagePad(updateId, slot)]);
  if (error && !/not.?found/i.test(String(error.message || ""))) throw error;
};

/** Tijdelijke, ondertekende URL van één bijlage; undefined als het bestand er
 *  niet (meer) is. De bucket is privé, dus dit is de enige weg naar het PDF. */
export const UPDATE_BIJLAGE_URL_TTL_SEC = 60 * 60 * 12;
export const ondertekenUpdateBijlage = async (updateId: string, slot: number): Promise<string | undefined> => {
  if (!db) return undefined;
  try {
    const { data } = await db.storage
      .from(UPDATE_BIJLAGEN_BUCKET)
      .createSignedUrl(updateBijlagePad(updateId, slot), UPDATE_BIJLAGE_URL_TTL_SEC);
    return data?.signedUrl || undefined;
  } catch {
    return undefined;
  }
};

/** De bijlagenlijst van één update bijwerken (alleen deze kolom). */
export const zetUpdateBijlagen = async (
  updateId: string,
  bijlagen: Array<{ slot: number; filename: string; sizeBytes?: number }>,
): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('updates')
    .update({ bijlagen: bijlagen.length > 0 ? bijlagen : null })
    .eq('id', String(updateId));
  if (error) throw error;
};

/** Bestanden van verwijderde updates opruimen; best-effort, zoals bij de
 *  omleidingen: een achtergebleven PDF mag een delete niet laten mislukken. */
export const verwijderUpdateBijlagen = async (updateIds: string[]): Promise<void> => {
  if (!supabaseAdmin || updateIds.length === 0) return;
  const paden = updateIds.flatMap((id) => [updateBijlagePad(id, 1), updateBijlagePad(id, 2)]);
  const { error } = await supabaseAdmin.storage.from(UPDATE_BIJLAGEN_BUCKET).remove(paden);
  // "not found" is de normale uitkomst voor een update zonder bijlage.
  if (error && !/not.?found/i.test(String(error.message || ""))) {
    console.warn("Opruimen van update-bijlagen is mislukt:", error);
  }
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
  // De kolom `bijlagen` staat er bewust NIET bij: die wordt alleen door de
  // upload- en verwijderroute geschreven (Storage is de bron). Een upsert
  // noemt hier alleen de kolommen hierboven, dus een gewone save laat de
  // bijlagen van een update met rust.
  const payloadMetTonen = payloadWithoutUrgent.map((rij, i) => ({
    ...rij,
    bijlagen_tonen: Boolean(normalizedData[i]?.bijlagenTonen),
  }));
  // Eerst upserten, dan pas de ontbrekende rijen verwijderen — faalt de
  // upsert, dan zijn er nog geen records verloren.
  if (payloadWithoutUrgent.length > 0) {
    // Zonder de migratie van 21-09 bestaat `bijlagen_tonen` nog niet; dan
    // schrijven we de update gewoon zonder dat vinkje weg.
    let { error } = await client.from('updates').upsert(payloadMetTonen);
    if (error && /bijlagen_tonen/i.test(String(error.message || ""))) {
      ({ error } = await client.from('updates').upsert(payloadWithoutUrgent));
    }
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

/** Ids van de updates die één gebruiker al las (voor de knop- en markeerstaat in de client). */
export const getUpdateReadIdsForUser = async (userId: string): Promise<string[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('update_reads').select('update_id').eq('user_id', String(userId)).order('update_id').range(from, to),
  );
  return rows.map((row) => String((row as any).update_id));
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
  // .order() verplicht bij paginering: zonder een stabiele sortering is de
  // PostgREST-volgorde ongedefinieerd en kunnen rijen bij >1.000 records
  // (±50 updates × 20 chauffeurs) dubbel of niet in een pagina belanden —
  // dan klopt de "N gelezen"-teller stil niet meer.
  const rows = await paginatedFetch((from, to) =>
    client.from('update_reads').select('update_id, user_id').order('update_id').range(from, to),
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

// De types zelf staan in api/types.ts (AuthenticatedRequest.device verwijst ernaar).
export type { DeviceStatus, UserDevice };

const toPublicDevice = (row: any): UserDevice => ({
  userId: String(row.user_id),
  deviceToken: String(row.device_token),
  name: String(row.name ?? 'Onbekend toestel'),
  status: row.status as DeviceStatus,
  createdAt: String(row.created_at),
  lastSeenAt: String(row.last_seen_at),
  approvedAt: row.approved_at ? String(row.approved_at) : null,
  approvedBy: row.approved_by ? String(row.approved_by) : null,
  sessionId: row.session_id ? String(row.session_id) : null,
});

/**
 * De kolom session_id komt uit 2026-09-09_user_devices_sessie.sql. Draait die
 * migratie nog niet, dan mag een deploy niet de hele toestelregistratie
 * breken: bij een "kolom bestaat niet"-fout (isMissingColumnError hierboven)
 * werken we verder zonder sessiebinding, de header-gate blijft dan de enige
 * laag. Niet voorgoed per warme instantie: na vijf minuten proberen we het
 * opnieuw, zodat de migratie ook zonder nieuwe deploy vanzelf gaat gelden.
 */
const SESSIE_KOLOM_HERKANS_MS = 5 * 60_000;
let sessieKolomOntbreektSinds: number | null = null;
const sessieKolomBruikbaar = (): boolean =>
  sessieKolomOntbreektSinds === null || Date.now() - sessieKolomOntbreektSinds > SESSIE_KOLOM_HERKANS_MS;
const meldSessieKolomOntbreekt = (error: unknown) => {
  sessieKolomOntbreektSinds = Date.now();
  console.error('user_devices.session_id ontbreekt, migratie 2026-09-09_user_devices_sessie.sql nog niet gedraaid:', error);
};

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
  // Optioneel: de aanroeper heeft de toestellen van deze gebruiker net al
  // opgehaald (listDevicesForUser) en geeft de gevonden rij (of null) mee;
  // dat spaart hier een lezing. undefined = zelf opzoeken, zoals vroeger.
  bekend?: UserDevice | null,
  // De session_id-claim uit het geverifieerde JWT van deze aanmelding (of
  // null): komt op de toestelrij zodat de gate een ingetrokken toestel ook
  // zonder de client-header herkent.
  sessionId?: string | null,
): Promise<{ device: UserDevice; created: boolean }> => {
  const client = requireDb();
  const existing = bekend !== undefined ? bekend : await getDevice(userId, deviceToken);
  if (existing) {
    // Bij elke aanmelding de actuele sessie vastleggen: alleen zo kan de gate
    // een ingetrokken toestel herkennen zonder de client-header.
    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
    if (sessieKolomBruikbaar() && sessionId) patch.session_id = sessionId;
    let { error } = await client
      .from('user_devices')
      .update(patch)
      .eq('user_id', String(userId))
      .eq('device_token', String(deviceToken));
    if (error && isMissingColumnError(error) && 'session_id' in patch) {
      meldSessieKolomOntbreekt(error);
      delete patch.session_id;
      ({ error } = await client
        .from('user_devices')
        .update(patch)
        .eq('user_id', String(userId))
        .eq('device_token', String(deviceToken)));
    }
    if (error) throw error;
    return { device: { ...existing, sessionId: 'session_id' in patch ? String(patch.session_id) : existing.sessionId }, created: false };
  }
  const row: Record<string, unknown> = {
    user_id: String(userId),
    device_token: String(deviceToken),
    name: name || 'Onbekend toestel',
    status: (autoApprove ? 'approved' : 'pending') as DeviceStatus,
    approved_at: autoApprove ? new Date().toISOString() : null,
    approved_by: autoApprove ? 'auto' : null,
    ...(sessieKolomBruikbaar() && sessionId ? { session_id: sessionId } : {}),
  };
  // Race (dubbele boot-call): bij een PK-conflict is de rij er al — negeren
  // en de bestaande status teruggeven i.p.v. een 500.
  // insert + de rij meteen terug (één trip i.p.v. insert en dan opnieuw lezen).
  let { data: inserted, error } = await client.from('user_devices').insert(row).select('*').maybeSingle();
  if (error && isMissingColumnError(error) && 'session_id' in row) {
    meldSessieKolomOntbreekt(error);
    delete row.session_id;
    ({ data: inserted, error } = await client.from('user_devices').insert(row).select('*').maybeSingle());
  }
  if (error) {
    if ((error as any).code === '23505') {
      const raced = await getDevice(userId, deviceToken);
      if (raced) return { device: raced, created: false };
    }
    throw error;
  }
  const device = inserted ? toPublicDevice(inserted) : await getDevice(userId, deviceToken);
  if (!device) throw new Error('Toestel-registratie niet teruggevonden.');
  return { device, created: true };
};

/** De toestellen van één gebruiker (hooguit MAX_DEVICES_PER_USER rijen): de
 *  registratie hoeft daarvoor niet de hele tabel te lezen. */
export const listDevicesForUser = async (userId: string): Promise<UserDevice[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('user_devices').select('*').eq('user_id', String(userId)).order('created_at', { ascending: false }).order('device_token', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicDevice);
};

export const listAllDevices = async (): Promise<UserDevice[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('user_devices').select('*').order('created_at', { ascending: false }).range(from, to),
  );
  return rows.map(toPublicDevice);
};

/**
 * De sessies die bij een ingetrokken toestel horen. De gate gebruikt dit om
 * een verzoek te blokkeren op basis van het (geverifieerde) JWT in plaats van
 * de X-Device-Token-header, die een aanvaller simpelweg kan weglaten.
 * Ingetrokken toestellen zijn zeldzaam, dus dit is een korte lijst.
 */
export const listRevokedSessionIds = async (): Promise<string[]> => {
  if (!sessieKolomBruikbaar()) return [];
  const client = requireDb();
  const { data, error } = await client
    .from('user_devices')
    .select('session_id')
    .eq('status', 'revoked')
    .not('session_id', 'is', null);
  if (error) {
    if (isMissingColumnError(error)) {
      meldSessieKolomOntbreekt(error);
      return [];
    }
    throw error;
  }
  return (data ?? []).map((r: any) => String(r.session_id)).filter(Boolean);
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

/** Alle toestellen van één gebruiker op 'revoked' (uitdienst-flow). Geeft
 *  het aantal toestellen dat écht van status veranderde, zodat een tweede
 *  aanroep 0 meldt. Rijen blijven staan (auditspoor in Toestellen). */
export const revokeAllDevices = async (userId: string): Promise<number> => {
  const client = requireDb();
  const { data, error } = await client
    .from('user_devices')
    .update({ status: 'revoked' satisfies DeviceStatus })
    .eq('user_id', String(userId))
    .neq('status', 'revoked')
    .select('device_token');
  if (error) throw error;
  return (data ?? []).length;
};

// --- Swaps ---

/** Waarde veilig in een PostgREST `or=(...)`-filter: tussen dubbele
 *  aanhalingstekens, met \\ en " ge-escaped (komma's, punten en haakjes in een
 *  id breken de filtersyntaxis anders). */
const orWaarde = (v: string) => `"${String(v).replace(/[\\"]/g, "\\$&")}"`;

/**
 * `betrokkenUserId`: alleen de wissels waar die gebruiker aanvrager ÓF
 * aangezochte collega is, gefilterd in de query i.p.v. de hele (groeiende)
 * tabel op te halen en in JS te filteren. Kolommen zijn hier lowercase
 * (requesterid/targetdriverid, zie supabase/setup_security.sql); dezelfde
 * voorwaarde als de RLS-policy swaps_read_involved_or_staff.
 */
export const getSwapsData = async (filters?: { betrokkenUserId?: string }) => {
  const client = requireDb();
  const betrokken = filters?.betrokkenUserId ? String(filters.betrokkenUserId) : null;
  const rows = await paginatedFetch((from, to) => {
    let q = client.from('swaps').select('*');
    if (betrokken) q = q.or(`requesterid.eq.${orWaarde(betrokken)},targetdriverid.eq.${orWaarde(betrokken)}`);
    return q.order('id', { ascending: true }).range(from, to);
  });
  return rows.map(toPublicSwap);
};

/** Alleen de gevraagde wissels — het weekoverzicht heeft er een handvol nodig
 *  en hoefde daarvoor niet de hele tabel te lezen. */
/** Eerste en laatste dag waarvoor er planning geïmporteerd is (grenzen van
 *  planning_matrix_rows). De maandplanning stopt daarop: voorbij de import is
 *  er niets te zien en een leeg bord leest als "er staat niemand ingepland"
 *  in plaats van "hier is nog niets geïmporteerd" (Jarno 18-09). */
export const getPlanningMatrixGrenzen = async (): Promise<{ eerste: string | null; laatste: string | null }> => {
  const client = requireDb();
  const rand = async (ascending: boolean) => {
    const { data, error } = await client
      .from('planning_matrix_rows')
      .select('source_date')
      .order('source_date', { ascending })
      .limit(1);
    if (error) throw error;
    const rij = (data ?? [])[0] as { source_date?: string } | undefined;
    return rij?.source_date ? String(rij.source_date) : null;
  };
  const [eerste, laatste] = await Promise.all([rand(true), rand(false)]);
  return { eerste, laatste };
};

export const getSwapsByIds = async (ids: string[]) => {
  const unieke = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
  if (unieke.length === 0) return [];
  const client = requireDb();
  const stukken = await Promise.all(inStukken(unieke, IN_FILTER_MAX).map((deel) =>
    paginatedFetch((from, to) => client.from('swaps').select('*').in('id', deel).range(from, to), deel.length)));
  return stukken.flat().map(toPublicSwap);
};

export const saveSwapsData = async (data: any, idsToDelete: string[] = [], opties: { alleenPending?: boolean } = {}) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicSwap) : [];
  if (normalizedData.length > 0) {
    const { error } = await client.from('swaps').upsert(normalizedData.map(toDatabaseSwap));
    if (error) throw error;
  }
  // Intrekkingen: gevalideerd door de handler (zie POST /api/swaps).
  // alleenPending (chauffeur-pad): zelfde race-afdichting als saveLeaveData.
  if (idsToDelete.length > 0) {
    let q = client.from('swaps').delete().in('id', idsToDelete.map(String));
    if (opties.alleenPending) q = q.eq('status', 'pending');
    const { error } = await q;
    if (error) throw error;
  }
};

/**
 * Gezien-bevestiging van de ontvangende chauffeur op een doorgevoerde wissel.
 * Directe kolom-update (niet via saveSwapsData): het bevestig-endpoint is de
 * enige schrijver en de array-route behoudt altijd de opgeslagen waarde.
 */
export const markSwapTargetSeen = async (swapId: string, seenAtIso: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('swaps')
    .update({ target_seen_at: seenAtIso })
    .eq('id', String(swapId));
  if (error) throw error;
};

// --- Planning-doorvoer van goedgekeurde ruilen -------------------------------
//
// Een goedgekeurde ruil/overname wordt direct in de planning doorgevoerd:
// de aangeboden dienst verhuist naar de collega en (bij een 1-op-1 ruil met
// een dienst als tegenprestatie) de terugdienst naar de aanvrager. De sleutel
// is (datum, dienstnummer, chauffeur) — bewust NIET de planning-rij-id, want
// die wordt bij elke heropbouw opnieuw gevormd. Annuleren draait de wissel
// om; de heropbouw past goedgekeurde ruilen opnieuw toe via de pure functie.

export type SwapCarryFields = Pick<SwapRecord, 'requesterId' | 'targetDriverId' | 'swapType' | 'returnDate' | 'returnCode' | 'shiftDate' | 'shiftLine'>;

/** Heeft deze ruil een dienst als tegenprestatie (1-op-1, geen vrije dag)? */
const swapHasReturnShift = (swap: SwapCarryFields) =>
  swap.swapType !== 'overname' &&
  !!swap.returnDate &&
  !!swap.returnCode &&
  String(swap.returnCode).toLowerCase() !== 'vrij';

/** Raakt deze ruil een kalenderdag binnen [van, tot]? Beide benen tellen:
 *  bij een 1-op-1-ruil kan de aangeboden dienst vóór het bereik liggen en
 *  de terugdienst erin (maandoverschrijdende ruil). De heropbouw-replay
 *  filterde alleen op shiftDate, waardoor het terugbeen bij een
 *  periode-import stil op de collega terugviel terwijl de maandplanning-
 *  overlay hem bij de aanvrager toonde (controle-ronde 27-08, bevinding 7).
 *  Zonder shiftDate (legacy-ruil) blijft hij relevant — de replay telt hem
 *  dan als niet-toepasbaar, zoals voorheen. */
export const swapRaaktBereik = (swap: SwapCarryFields, bereik: { van: string; tot: string }): boolean => {
  const aangeboden = String(swap.shiftDate ?? '');
  if (!aangeboden || (aangeboden >= bereik.van && aangeboden <= bereik.tot)) return true;
  if (!swapHasReturnShift(swap)) return false;
  const terug = String(swap.returnDate);
  return terug >= bereik.van && terug <= bereik.tot;
};

/**
 * Pure variant voor de heropbouw: past goedgekeurde ruilen toe op een
 * in-memory rijenset (muteert de rijen in place, volgorde van `swaps` =
 * toepassingsvolgorde; roep aan met decidedAt-oplopend zodat een latere
 * ruil op het resultaat van een eerdere werkt).
 */
export const applySwapsToPlanningRows = (
  rows: Array<Pick<ShiftRecord, 'date' | 'line' | 'driverId'>>,
  swaps: SwapCarryFields[],
): { applied: number; skipped: number; alVerwerkt: number } => {
  let applied = 0;
  let skipped = 0;
  // De planner had de ruil al in de Excel verwerkt (voorlopig de werkwijze,
  // Jarno 12-09): de dienst staat vers op de ontvanger, er valt niets te
  // verhuizen. Apart geteld, zodat het importlogje dit niet als "niet
  // toepasbaar" meldt — dat woord hoort een échte mismatch te betekenen
  // (dienst intussen handmatig verlegd).
  let alVerwerkt = 0;
  for (const swap of swaps) {
    const target = String(swap.targetDriverId ?? '');
    if (!swap.shiftDate || !swap.shiftLine || !target) {
      // Legacy-ruil van vóór de shift_info-migratie (of backfill vond de rij
      // niet meer): niet toepasbaar, telt als overgeslagen.
      skipped++;
      continue;
    }
    let touched = false;
    let alBijOntvanger = false;
    const verhuis = (date: string, line: string, van: string, naar: string) => {
      for (const row of rows) {
        if (row.date !== date || String(row.line) !== line) continue;
        if (String(row.driverId) === van) {
          row.driverId = naar;
          touched = true;
        } else if (String(row.driverId) === naar) {
          alBijOntvanger = true;
        }
      }
    };
    verhuis(swap.shiftDate, String(swap.shiftLine), String(swap.requesterId), target);
    if (swapHasReturnShift(swap)) verhuis(String(swap.returnDate), String(swap.returnCode), target, String(swap.requesterId));
    if (touched) applied++;
    else if (alBijOntvanger) alVerwerkt++;
    else skipped++;
  }
  return { applied, skipped, alVerwerkt };
};

/**
 * Voert één richting van de wissel uit in de database. Geeft het aantal
 * geraakte rijen terug zodat de route kan waarschuwen (0 = de dienst staat
 * niet (meer) zo in de planning — bv. handmatig al aangepast).
 */
const movePlanningRows = async (date: string, line: string, fromDriverId: string, toDriverId: string): Promise<number> => {
  const client = requireDb();
  const { data, error } = await client
    .from('planning')
    .update({ driverId: toDriverId })
    .eq('date', date)
    .eq('line', line)
    .eq('driverId', fromDriverId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
};

export type SwapCarryResult = {
  offeredMoved: number;
  returnMoved: number | null; // null = geen dienst-tegenprestatie (overname of vrije dag)
};

/** Goedgekeurde ruil doorvoeren in de planning. */
export const applySwapToPlanning = async (swap: SwapCarryFields): Promise<SwapCarryResult | null> => {
  const target = String(swap.targetDriverId ?? '');
  if (!swap.shiftDate || !swap.shiftLine || !target) return null;
  const offeredMoved = await movePlanningRows(swap.shiftDate, String(swap.shiftLine), String(swap.requesterId), target);
  let returnMoved: number | null = null;
  if (swapHasReturnShift(swap)) {
    returnMoved = await movePlanningRows(String(swap.returnDate), String(swap.returnCode), target, String(swap.requesterId));
  }
  return { offeredMoved, returnMoved };
};

/** Geannuleerde (eerder goedgekeurde) ruil terugdraaien in de planning. */
export const revertSwapFromPlanning = async (swap: SwapCarryFields): Promise<SwapCarryResult | null> => {
  const target = String(swap.targetDriverId ?? '');
  if (!swap.shiftDate || !swap.shiftLine || !target) return null;
  const offeredMoved = await movePlanningRows(swap.shiftDate, String(swap.shiftLine), target, String(swap.requesterId));
  let returnMoved: number | null = null;
  if (swapHasReturnShift(swap)) {
    returnMoved = await movePlanningRows(String(swap.returnDate), String(swap.returnCode), String(swap.requesterId), target);
  }
  return { offeredMoved, returnMoved };
};

/** Staat de wissel van deze ruil al in de planning? 'doorgevoerd' = de
 *  aangeboden dienst staat bij de collega (en de eventuele terugdienst bij
 *  de aanvrager), 'niet_doorgevoerd' = nog bij de aanvrager, 'onbekend' =
 *  verlegd/verdwenen of geen dienst-info. Hiermee wordt goedkeuren
 *  idempotent en kan afwijzen een halve doorvoer (planning al gewisseld,
 *  status nooit opgeslagen) terugdraaien — controle-ronde 27-08, bevinding 8. */
export const swapToestandInPlanning = async (swap: SwapCarryFields): Promise<'doorgevoerd' | 'niet_doorgevoerd' | 'onbekend'> => {
  const target = String(swap.targetDriverId ?? '');
  const requester = String(swap.requesterId);
  if (!swap.shiftDate || !swap.shiftLine || !target) return 'onbekend';
  const client = requireDb();
  const { data, error } = await client.from('planning').select('driverId').eq('date', swap.shiftDate).eq('line', String(swap.shiftLine));
  if (error) throw error;
  const chauffeurs = new Set((data ?? []).map((r: any) => String(r.driverId)));
  if (chauffeurs.has(requester)) return 'niet_doorgevoerd';
  if (!chauffeurs.has(target)) return 'onbekend';
  if (!swapHasReturnShift(swap)) return 'doorgevoerd';
  const { data: terug, error: terugError } = await client.from('planning').select('driverId').eq('date', String(swap.returnDate)).eq('line', String(swap.returnCode));
  if (terugError) throw terugError;
  return (terug ?? []).some((r: any) => String(r.driverId) === requester) ? 'doorgevoerd' : 'onbekend';
};

// --- Leave ---

export const getLeaveData = async (filters?: { endOnOrAfter?: string; userId?: string }) => {
  const client = requireDb();
  // Optioneel afkappen op einddatum: lezers die alleen actuele/toekomstige
  // afwezigheid nodig hebben (maandplanning-overlay, dekking, availability)
  // hoeven de volledige, onbegrensd groeiende historiek niet mee te slepen.
  const endOnOrAfter = filters?.endOnOrAfter && /^\d{4}-\d{2}-\d{2}$/.test(filters.endOnOrAfter)
    ? filters.endOnOrAfter
    : null;
  const userId = filters?.userId ? String(filters.userId) : null;
  const rows = await paginatedFetch((from, to) => {
    let q = client.from('leave').select('*');
    if (endOnOrAfter) q = q.gte('enddate', endOnOrAfter);
    // Alleen het verlof van één gebruiker (GET /api/leave voor niet-staf):
    // filter in de query i.p.v. de hele historiek ophalen. Kolom = lowercase.
    if (userId) q = q.eq('userid', userId);
    return q.order('id', { ascending: true }).range(from, to);
  });
  return rows.map(toPublicLeave);
};

export const saveLeaveData = async (data: any, idsToDelete: string[] = [], opties: { alleenPending?: boolean } = {}) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicLeave) : [];
  if (normalizedData.length > 0) {
    const { error } = await client.from('leave').upsert(normalizedData.map(toDatabaseLeave));
    if (error) throw error;
  }
  // Intrekkingen: de handler valideert scope + status; hier alleen uitvoeren.
  // Zonder dit was 'aanvraag intrekken' een stille no-op (upsert raakt
  // ontbrekende rijen niet) en kwam de aanvraag na refresh terug.
  // alleenPending (chauffeur-pad): de handler toetste 'pending' op een
  // snapshot; keurt een planner de aanvraag tussen die read en deze delete
  // goed, dan mag de intrekking hem niet meer raken. De voorwaarde zit
  // daarom in dezelfde databaseoperatie (security-audit 07-09, bevinding 7).
  if (idsToDelete.length > 0) {
    let q = client.from('leave').delete().in('id', idsToDelete.map(String));
    if (opties.alleenPending) q = q.eq('status', 'pending');
    const { error } = await q;
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

// === Vervaldata (Code 95 / medische schifting) ===
// Eén rij per gebruiker+soort; beheer door planner/admin via de API.
export type UserExpiryRecord = {
  userId: string;
  soort: string;
  validUntil: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const getUserExpiries = async (): Promise<UserExpiryRecord[]> => {
  const client = requireDb();
  const { data, error } = await client.from('user_expiries').select('*');
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    userId: String(r.user_id),
    soort: String(r.soort),
    validUntil: String(r.valid_until),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
    updatedBy: r.updated_by ? String(r.updated_by) : null,
  }));
};

export const saveUserExpiry = async (rec: { userId: string; soort: string; validUntil: string; updatedBy: string | null }): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from('user_expiries').upsert({
    user_id: String(rec.userId),
    soort: rec.soort,
    valid_until: rec.validUntil,
    updated_by: rec.updatedBy,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
};

export const deleteUserExpiry = async (userId: string, soort: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from('user_expiries').delete().eq('user_id', String(userId)).eq('soort', soort);
  if (error) throw error;
};

// --- Aanwezigheid (wie was wanneer actief op het portaal) ---

/** Eén aaneengesloten periode waarin iemand het portaal in de voorgrond had. */
export type AanwezigheidSessie = {
  userId: string;
  rol: string | null;
  /** ISO-tijdstip waarop deze sessie begon. */
  van: string;
  /** ISO-tijdstip van het laatste teken van leven in deze sessie. */
  tot: string;
  /** Plaats van aanmelden (2026-09-20_user_presence_locatie.sql), afgeleid
   *  van het IP-adres; null = onbekend (lokaal, oude rij, migratie mist). */
  land: string | null;
  regio: string | null;
  stad: string | null;
  /** false = de rij heeft de plaatskolommen niet: de migratie moet nog. */
  locatieBekend: boolean;
};

const tekstOfNull = (w: unknown): string | null => (typeof w === 'string' && w.trim() ? w : null);

const toPublicAanwezigheid = (row: Record<string, unknown>): AanwezigheidSessie => ({
  userId: String(row.user_id ?? ''),
  rol: (row.role as string | null) ?? null,
  van: String(row.started_at ?? ''),
  tot: String(row.last_seen_at ?? ''),
  land: tekstOfNull(row.land),
  regio: tekstOfNull(row.regio),
  stad: tekstOfNull(row.stad),
  // select('*') levert de sleutel alleen wanneer de kolom bestaat.
  locatieBekend: 'land' in row,
});

// Per warme lambda onthouden dat de plaatskolommen ontbreken (zelfde patroon
// als clientErrorsUitgebreid en diversionsMetLocation), maar met een
// houdbaarheid: een instantie kan uren warm blijven, en Jarno draait de
// migratie wanneer het hem past. Na dit venster probeert ze het opnieuw, zodat
// de plaats vanzelf begint te lopen zonder nieuwe deploy. Kost in de tussentijd
// één mislukte schrijfactie per instantie per venster.
const LOCATIE_HERKANS_MS = 10 * 60 * 1000;
let presenceLocatieMistSinds: number | null = null;

/** Alleen voor tests: de onthouden kolomstand vergeten. */
export const vergeetPresenceLocatie = () => { presenceLocatieMistSinds = null; };

/**
 * Eén schrijfactie op user_presence, eerst mét en zo nodig zonder de plaats.
 *
 * De plaats is bijzaak, de aanwezigheid is de waarneming: wát er ook misgaat
 * met de plaatskolommen (migratie nog niet gedraaid, een waarde die de
 * check-constraint weigert), dezelfde schrijfactie gaat meteen opnieuw zonder
 * plaats. Alleen een ontbrekende kolom wordt onthouden; elke andere fout kan
 * aan die ene waarde liggen en mag de volgende poging niet uitschakelen.
 */
const schrijfMetLocatie = async (
  locatie: AanwezigheidLocatie | null | undefined,
  schrijf: (plaats: Record<string, string | null>) => PromiseLike<{ error: unknown }>,
): Promise<void> => {
  const kolommenMissen = presenceLocatieMistSinds !== null && Date.now() - presenceLocatieMistSinds < LOCATIE_HERKANS_MS;
  if (locatie && !kolommenMissen) {
    const { error } = await schrijf({ land: locatie.land, regio: locatie.regio, stad: locatie.stad });
    if (!error) {
      presenceLocatieMistSinds = null;
      return;
    }
    if (isMissingColumnError(error)) presenceLocatieMistSinds = Date.now();
  }
  const { error } = await schrijf({});
  if (error) throw error;
};

/**
 * Teken van leven van één gebruiker vastleggen: de lopende sessie oprekken,
 * of er een nieuwe beginnen als het langer dan SESSIE_GAT_MS stil was.
 *
 * Best-effort en bewust stil: de aanroeper (auth-middleware) doet dit
 * fire-and-forget, dus een mislukking mag nooit een request raken. Ontbreekt
 * de tabel (migratie niet gedraaid), dan gebeurt er simpelweg niets.
 *
 * Twee queries, maar hoogstens één keer per gebruiker per 5 minuten: de rem
 * zit in magSchrijven() vóór deze functie wordt aangeroepen.
 *
 * `locatie` (stad, regio, land uit de Vercel-headers) reist mee op dezelfde
 * schrijfactie. Bestaan de kolommen nog niet, dan valt de schrijfactie stil
 * terug op het gedrag van vóór 20-09; zie schrijfMetLocatie.
 */
export const noteerAanwezigheid = async (
  userId: string,
  rol: string | null,
  opties: { nu?: Date; locatie?: AanwezigheidLocatie | null } = {},
): Promise<void> => {
  const client = requireDb();
  const nu = opties.nu ?? new Date();
  const { locatie } = opties;
  const nuIso = nu.toISOString();
  const { data, error } = await client
    .from('user_presence')
    .select('id, last_seen_at')
    .eq('user_id', String(userId))
    .order('last_seen_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const jongste = (data ?? [])[0] as { id: string; last_seen_at: string } | undefined;
  if (jongste && hoortBijSessie(jongste.last_seen_at, nu.getTime())) {
    // De plaats gaat mee in dezelfde update: wisselt iemand binnen een sessie
    // van netwerk, dan wint de laatste waarde. Zonder plaats (null) blijft
    // staan wat er stond; een ontbrekende header wist niets.
    await schrijfMetLocatie(locatie, (plaats) => client
      .from('user_presence')
      .update({ last_seen_at: nuIso, role: rol, ...plaats })
      .eq('id', jongste.id));
    return;
  }
  await schrijfMetLocatie(locatie, (plaats) => client
    .from('user_presence')
    .insert({ user_id: String(userId), role: rol, started_at: nuIso, last_seen_at: nuIso, ...plaats }));
};

/**
 * Alle sessies die ná `sinceIso` nog liepen, nieuwste eerst. Gepagineerd om
 * dezelfde reden als het auditlogboek: PostgREST kapt elke select op 1.000
 * rijen, en bij enkele tientallen sessies per dag zit een maand daar dicht bij.
 *
 * Gooit bij een échte fout (een lege lijst is niet te onderscheiden van
 * "niemand was actief"); de route vangt een ontbrekende tabel apart af en
 * meldt dan welke migratie nog moet draaien.
 */
export const getAanwezigheid = async (sinceIso: string, limit = 5000): Promise<AanwezigheidSessie[]> => {
  const client = requireDb();
  const rows = await paginatedFetch<Record<string, unknown>>((from, to) =>
    client
      .from('user_presence')
      .select('*')
      .gte('last_seen_at', sinceIso)
      .order('last_seen_at', { ascending: false })
      .range(from, Math.min(to, limit - 1)),
  limit);
  return rows.map(toPublicAanwezigheid);
};
