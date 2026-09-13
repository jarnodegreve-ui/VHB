import { db } from "../db.js";
import { QUAL_VLAGGEN, loonCodeSleutel, type QualVlag } from "../../shared/loon.js";
import type { DagPrestatie, DagPrestatieBody, LoonCode, LoonCodeBody, LoonMedewerker } from "../../shared/schemas/loon.js";

/**
 * Opslag van de loonmodule (fase B Access-migratie): loon_codes,
 * loon_medewerkers, dag_afsluitingen en dag_prestaties. Snake_case, API-only
 * (RLS zonder policies), alles via de service role.
 */

const requireDb = () => {
  if (!db) throw new Error("Supabase is niet geconfigureerd. Stel SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in als env vars.");
  return db;
};

export const LOON_MIGRATIE = "supabase/2026-09-13_loon_dagafsluiting.sql";

const str = (v: unknown) => String(v ?? "");
const strOfNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const numOfNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

// --- loon_codes ---

const QUAL_KOLOM: Record<QualVlag, string> = {
  qualOngeval: "qual_ongeval",
  qualPanne: "qual_panne",
  qualVerkeersovertreding: "qual_verkeersovertreding",
  qualKlantklacht: "qual_klantklacht",
  qualAdmfout: "qual_admfout",
  qualInterneklacht: "qual_interneklacht",
  qualVertragingDrSchuld: "qual_vertraging_dr_schuld",
  qualRitNtGeredenDrSchuld: "qual_rit_nt_gereden_dr_schuld",
};

export const toLoonCode = (r: any): LoonCode => ({
  code: str(r.code),
  codeWeergave: str(r.code_weergave),
  omschrijving: strOfNull(r.omschrijving),
  dienstType: r.dienst_type,
  inExport: Boolean(r.in_export),
  easypayActiviteit: str(r.easypay_activiteit),
  easypayTypePrest: Number(r.easypay_type_prest ?? 0),
  tik1: strOfNull(r.tik1), tik2: strOfNull(r.tik2), tik3: strOfNull(r.tik3), tik4: strOfNull(r.tik4), tik5: strOfNull(r.tik5), tik6: strOfNull(r.tik6),
  lbRijtijd: numOfNull(r.lb_rijtijd), lbStat100At: numOfNull(r.lb_stat100_at), lbStat100Nat: numOfNull(r.lb_stat100_nat), lbStat50Nat: numOfNull(r.lb_stat50_nat),
  lbOnd: numOfNull(r.lb_ond), lbAndWrk: numOfNull(r.lb_and_wrk), lbNacht: numOfNull(r.lb_nacht),
  bron: r.bron ?? "handmatig",
  updatedAt: strOfNull(r.updated_at) ?? undefined,
});

/** Kolommen die de API schrijft — bewaakt door src/schemaContract.test.ts. */
export const toDatabaseLoonCode = (code: string, b: LoonCodeBody, updatedBy: string | null, bron: 'handmatig' | 'segments' | 'import' = 'handmatig') => ({
  code: loonCodeSleutel(code),
  code_weergave: b.codeWeergave,
  omschrijving: b.omschrijving ?? null,
  dienst_type: b.dienstType,
  in_export: b.inExport,
  easypay_activiteit: b.easypayActiviteit,
  easypay_type_prest: b.easypayTypePrest,
  tik1: b.tik1 ?? null, tik2: b.tik2 ?? null, tik3: b.tik3 ?? null, tik4: b.tik4 ?? null, tik5: b.tik5 ?? null, tik6: b.tik6 ?? null,
  lb_rijtijd: b.lbRijtijd ?? null, lb_stat100_at: b.lbStat100At ?? null, lb_stat100_nat: b.lbStat100Nat ?? null, lb_stat50_nat: b.lbStat50Nat ?? null,
  lb_ond: b.lbOnd ?? null, lb_and_wrk: b.lbAndWrk ?? null, lb_nacht: b.lbNacht ?? null,
  bron,
  updated_by: updatedBy,
});

export const getLoonCodes = async (): Promise<LoonCode[]> => {
  const { data, error } = await requireDb().from("loon_codes").select("*").order("code");
  if (error) throw error;
  return (data ?? []).map(toLoonCode);
};

export const upsertLoonCode = async (code: string, b: LoonCodeBody, updatedBy: string | null, bron: 'handmatig' | 'segments' | 'import' = 'handmatig'): Promise<LoonCode> => {
  const { data, error } = await requireDb().from("loon_codes").upsert(toDatabaseLoonCode(code, b, updatedBy, bron)).select("*").single();
  if (error) throw error;
  return toLoonCode(data);
};

export const deleteLoonCode = async (code: string): Promise<boolean> => {
  const { error, count } = await requireDb().from("loon_codes").delete({ count: "exact" }).eq("code", loonCodeSleutel(code));
  if (error) throw error;
  return (count ?? 0) > 0;
};

// --- loon_medewerkers ---

export const toLoonMedewerker = (r: any): LoonMedewerker => ({
  userId: str(r.user_id),
  easypayNr: numOfNull(r.easypay_nr),
  inExport: r.in_export !== false,
});

export const toDatabaseLoonMedewerker = (userId: string, m: { easypayNr?: number | null; inExport: boolean }, updatedBy: string | null) => ({
  user_id: userId,
  easypay_nr: m.easypayNr ?? null,
  in_export: m.inExport,
  updated_by: updatedBy,
  updated_at: new Date().toISOString(),
});

export const getLoonMedewerkers = async (): Promise<LoonMedewerker[]> => {
  const { data, error } = await requireDb().from("loon_medewerkers").select("*");
  if (error) throw error;
  return (data ?? []).map(toLoonMedewerker);
};

export const upsertLoonMedewerker = async (userId: string, m: { easypayNr?: number | null; inExport: boolean }, updatedBy: string | null): Promise<LoonMedewerker> => {
  const { data, error } = await requireDb().from("loon_medewerkers").upsert(toDatabaseLoonMedewerker(userId, m, updatedBy)).select("*").single();
  if (error) throw error;
  return toLoonMedewerker(data);
};

// --- dag_afsluitingen ---

export type DagAfsluiting = {
  datum: string;
  status: "open" | "afgesloten";
  geopendOp: string;
  geopendDoor: string | null;
  afgeslotenOp: string | null;
  afgeslotenDoor: string | null;
  heropendOp: string | null;
  heropendDoor: string | null;
  heropendReden: string | null;
};

export const toDagAfsluiting = (r: any): DagAfsluiting => ({
  datum: str(r.datum),
  status: r.status === "afgesloten" ? "afgesloten" : "open",
  geopendOp: str(r.geopend_op),
  geopendDoor: strOfNull(r.geopend_door),
  afgeslotenOp: strOfNull(r.afgesloten_op),
  afgeslotenDoor: strOfNull(r.afgesloten_door),
  heropendOp: strOfNull(r.heropend_op),
  heropendDoor: strOfNull(r.heropend_door),
  heropendReden: strOfNull(r.heropend_reden),
});

export const toDatabaseDagAfsluiting = (d: { datum: string; geopendDoor: string | null }) => ({
  datum: d.datum,
  status: "open",
  geopend_door: d.geopendDoor,
});

export const getDagAfsluiting = async (datum: string): Promise<DagAfsluiting | null> => {
  const { data, error } = await requireDb().from("dag_afsluitingen").select("*").eq("datum", datum).maybeSingle();
  if (error) throw error;
  return data ? toDagAfsluiting(data) : null;
};

export const getDagAfsluitingen = async (van: string, tot: string): Promise<DagAfsluiting[]> => {
  const { data, error } = await requireDb().from("dag_afsluitingen").select("*").gte("datum", van).lte("datum", tot).order("datum");
  if (error) throw error;
  return (data ?? []).map(toDagAfsluiting);
};

export const openDag = async (datum: string, geopendDoor: string | null): Promise<DagAfsluiting> => {
  const { data, error } = await requireDb().from("dag_afsluitingen").insert(toDatabaseDagAfsluiting({ datum, geopendDoor })).select("*").single();
  if (error) throw error;
  return toDagAfsluiting(data);
};

export const sluitDag = async (datum: string, door: string | null): Promise<DagAfsluiting | null> => {
  const { data, error } = await requireDb().from("dag_afsluitingen")
    .update({ status: "afgesloten", afgesloten_op: new Date().toISOString(), afgesloten_door: door })
    .eq("datum", datum).select("*").maybeSingle();
  if (error) throw error;
  return data ? toDagAfsluiting(data) : null;
};

export const heropenDag = async (datum: string, door: string | null, reden: string): Promise<DagAfsluiting | null> => {
  const { data, error } = await requireDb().from("dag_afsluitingen")
    .update({ status: "open", heropend_op: new Date().toISOString(), heropend_door: door, heropend_reden: reden })
    .eq("datum", datum).select("*").maybeSingle();
  if (error) throw error;
  return data ? toDagAfsluiting(data) : null;
};

// --- dag_prestaties ---

export const toDagPrestatie = (r: any): DagPrestatie => ({
  id: str(r.id),
  datum: str(r.datum),
  userId: str(r.user_id),
  volgnr: Number(r.volgnr ?? 1),
  planningCode: strOfNull(r.planning_code),
  geredenCode: strOfNull(r.gereden_code),
  overmin: Number(r.overmin ?? 0),
  overminNacht: Number(r.overmin_nacht ?? 0),
  overminExtra: Number(r.overmin_extra ?? 0),
  onvPremie: Boolean(r.onv_premie),
  ...(Object.fromEntries(QUAL_VLAGGEN.map((k) => [k, Boolean(r[QUAL_KOLOM[k]])])) as Record<QualVlag, boolean>),
  opmerking: strOfNull(r.opmerking),
  bewerktOp: strOfNull(r.bewerkt_op),
  bewerktDoor: strOfNull(r.bewerkt_door),
});

export const toDatabaseDagPrestatieNieuw = (p: { datum: string; userId: string; volgnr: number; planningCode: string | null; geredenCode: string | null }) => ({
  datum: p.datum,
  user_id: p.userId,
  volgnr: p.volgnr,
  planning_code: p.planningCode,
  gereden_code: p.geredenCode,
});

export const toDatabaseDagPrestatiePatch = (b: DagPrestatieBody, bewerktDoor: string | null) => {
  const patch: Record<string, unknown> = { bewerkt_op: new Date().toISOString(), bewerkt_door: bewerktDoor };
  if (b.geredenCode !== undefined) patch.gereden_code = b.geredenCode;
  if (b.overmin !== undefined) patch.overmin = b.overmin;
  if (b.overminNacht !== undefined) patch.overmin_nacht = b.overminNacht;
  if (b.overminExtra !== undefined) patch.overmin_extra = b.overminExtra;
  if (b.onvPremie !== undefined) patch.onv_premie = b.onvPremie;
  for (const k of QUAL_VLAGGEN) if (b[k] !== undefined) patch[QUAL_KOLOM[k]] = b[k];
  if (b.opmerking !== undefined) patch.opmerking = b.opmerking;
  return patch;
};

export const getDagPrestaties = async (datum: string): Promise<DagPrestatie[]> => {
  const { data, error } = await requireDb().from("dag_prestaties").select("*").eq("datum", datum).order("volgnr");
  if (error) throw error;
  return (data ?? []).map(toDagPrestatie);
};

export const getDagPrestatiesPeriode = async (van: string, tot: string): Promise<DagPrestatie[]> => {
  const { data, error } = await requireDb().from("dag_prestaties").select("*").gte("datum", van).lte("datum", tot).order("datum").order("volgnr").limit(20000);
  if (error) throw error;
  return (data ?? []).map(toDagPrestatie);
};

export const getDagPrestatie = async (id: string): Promise<DagPrestatie | null> => {
  const { data, error } = await requireDb().from("dag_prestaties").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toDagPrestatie(data) : null;
};

export const insertDagPrestaties = async (rijen: Array<{ datum: string; userId: string; volgnr: number; planningCode: string | null; geredenCode: string | null }>): Promise<DagPrestatie[]> => {
  if (rijen.length === 0) return [];
  const { data, error } = await requireDb().from("dag_prestaties").insert(rijen.map(toDatabaseDagPrestatieNieuw)).select("*");
  if (error) throw error;
  return (data ?? []).map(toDagPrestatie);
};

export const patchDagPrestatie = async (id: string, b: DagPrestatieBody, bewerktDoor: string | null): Promise<DagPrestatie | null> => {
  const { data, error } = await requireDb().from("dag_prestaties").update(toDatabaseDagPrestatiePatch(b, bewerktDoor)).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? toDagPrestatie(data) : null;
};

/** Planning overnemen op onaangeraakte rijen: planning_code en gereden_code gelijkzetten, zonder bewerkt_op te zetten. */
export const zetPlanningCode = async (id: string, code: string | null): Promise<void> => {
  const { error } = await requireDb().from("dag_prestaties").update({ planning_code: code, gereden_code: code }).eq("id", id);
  if (error) throw error;
};

export const deleteDagPrestatie = async (id: string): Promise<boolean> => {
  const { error, count } = await requireDb().from("dag_prestaties").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
};

export const isUniqueError = (err: unknown): boolean => String((err as { code?: unknown })?.code ?? "") === "23505";
