import type {
  PlanningCodeRecord,
  PlanningMatrixImportHistoryRecord,
  PlanningMatrixImportHistoryRow,
  PlanningMatrixRow,
  ShiftRecord,
} from "../../types.js";
import { toDatabasePlanningCode, maandGrenzen, toPublicPlanningCode } from "../../helpers.js";
import { supabaseAdmin } from "../../db.js";
import { verwijderInStukken } from "./activiteit.js";
import { BACKUPS_BUCKET } from "./backups.js";
import { isEchteIsoDag, isMissingDbFunction, paginatedFetch, requireDb } from "./basis.js";

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
  await verwijderInStukken(client, 'planning', 'id', idsToDelete);
};

/**
 * Eén shift gericht opzoeken (eigendoms-checks bij dienstruil). `date` en
 * `line` horen erbij sinds de overname-check en de planning-doorvoer: de
 * server moet weten op welke dag en om welk dienstnummer het gaat.
 */
export const getShiftById = async (id: string): Promise<{ id: string; driverId: string; date: string; line: string; endTime: string } | null> => {
  if (!id) return null;
  const client = requireDb();
  const { data, error } = await client.from('planning').select('id, driverId, date, line, endTime').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String((data as any).id),
    driverId: String((data as any).driverId ?? ''),
    date: String((data as any).date ?? ''),
    line: String((data as any).line ?? ''),
    endTime: String((data as any).endTime ?? ''),
  };
};

/**
 * Alle planning-rijen van één dag — voor de handmatige admin-dienstwissel:
 * eigendoms-check (staat de dienst nog op de huidige chauffeur?) en
 * conflict-check (heeft de nieuwe chauffeur die dag al een dienst?).
 */
export const getShiftsOnDate = async (date: string): Promise<Array<{ id: string; driverId: string; date: string; line: string; endTime: string }>> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('planning').select('id, driverId, date, line, endTime').eq('date', date).order('id', { ascending: true }).range(from, to),
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    driverId: String(r.driverId ?? ''),
    date: String(r.date ?? ''),
    line: String(r.line ?? ''),
    endTime: String(r.endTime ?? ''),
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

  await verwijderInStukken(client, 'planning_codes', 'code', removedCodes);

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
  // Lokale const: de null-check hierboven geldt niet meer binnen de closures.
  const admin = supabaseAdmin;
  const filename = `${SNAPSHOT_PREFIX}${snapshot.createdAt.replace(/[:.]/g, '-')}.json`;
  const body = JSON.stringify(snapshot);
  const upload = () =>
    admin.storage.from(BACKUPS_BUCKET).upload(filename, Buffer.from(body, 'utf8'), {
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
