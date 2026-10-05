import type { PlanningCodeRecord, PlanningMatrixRow } from "../../types.js";
import { supabaseAdmin } from "../../db.js";
import { saveCoverageExpectations, saveServicesData } from "./diensten.js";
import { saveUsersData } from "./gebruikers.js";
import { saveDiversionsData } from "./omleidingen.js";
import { clearPlanningData, savePlanningCodesData, savePlanningData, savePlanningMatrixRows } from "./planning.js";
import { getSwapsData, saveSwapsData } from "./ruilen.js";
import { saveUpdatesData } from "./updates.js";
import { getLeaveData, saveLeaveData } from "./verlof.js";

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
  // Lokale const: de null-check hierboven geldt niet meer binnen de closures.
  const admin = supabaseAdmin;

  const upload = () =>
    admin.storage.from(BACKUPS_BUCKET).upload(filename, Buffer.from(body, "utf8"), {
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
