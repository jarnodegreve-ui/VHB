import { db } from "../db.js";
import type { Bevinding, Segment } from "../../shared/dienst.js";
import type { ImportETWaarschuwing } from "../../shared/dienst/importET.js";

/**
 * Opslag van de dienstopbouw (fase C): service_segment_imports,
 * service_segments en dagtype_codes. API-only via de service role.
 */
const requireDb = () => {
  if (!db) throw new Error("Supabase is niet geconfigureerd. Stel SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in als env vars.");
  return db;
};

export const DIENST_MIGRATIE = "supabase/2026-09-13_service_segments.sql";

const str = (v: unknown) => String(v ?? "");
const strOfNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const numOfNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export type SegmentImport = {
  id: string;
  createdAt: string;
  importedBy: string | null;
  filename: string | null;
  rijen: number;
  diensten: number;
  dagtypes: string[];
  waarschuwingen: ImportETWaarschuwing[];
  bevindingen: Bevinding[];
  actief: boolean;
  actiefSinds: string | null;
};

export const toSegmentImport = (r: any): SegmentImport => ({
  id: str(r.id),
  createdAt: str(r.created_at),
  importedBy: strOfNull(r.imported_by),
  filename: strOfNull(r.filename),
  rijen: Number(r.rijen ?? 0),
  diensten: Number(r.diensten ?? 0),
  dagtypes: Array.isArray(r.dagtypes) ? r.dagtypes.map(String) : [],
  waarschuwingen: Array.isArray(r.waarschuwingen) ? r.waarschuwingen : [],
  bevindingen: Array.isArray(r.bevindingen) ? r.bevindingen : [],
  actief: Boolean(r.actief),
  actiefSinds: strOfNull(r.actief_sinds),
});

export const toDatabaseSegmentImport = (i: { importedBy: string | null; filename: string | null; rijen: number; diensten: number; dagtypes: string[]; waarschuwingen: ImportETWaarschuwing[]; bevindingen: Bevinding[] }) => ({
  imported_by: i.importedBy,
  filename: i.filename,
  rijen: i.rijen,
  diensten: i.diensten,
  dagtypes: i.dagtypes,
  waarschuwingen: i.waarschuwingen,
  bevindingen: i.bevindingen,
  actief: false,
});

export const toSegment = (r: any): Segment & { id: string; importId: string } => ({
  id: str(r.id),
  importId: str(r.import_id),
  serviceNumber: str(r.service_number),
  dagtypeCode: str(r.dagtype_code),
  volgorde: Number(r.volgorde ?? 0),
  type: r.type,
  startMin: Number(r.start_min ?? 0),
  eindeMin: Number(r.einde_min ?? 0),
  duurMin: Number(r.duur_min ?? 0),
  loop: strOfNull(r.loop),
  internLoop: strOfNull(r.intern_loop),
  lijn: strOfNull(r.lijn),
  variant: strOfNull(r.variant),
  rit: strOfNull(r.rit),
  voertuig: strOfNull(r.voertuig),
  vertrek: strOfNull(r.vertrek),
  vertrekCode: strOfNull(r.vertrek_code),
  aankomst: strOfNull(r.aankomst),
  aankomstCode: strOfNull(r.aankomst_code),
  afstandKm: numOfNull(r.afstand_km),
  atTijd: strOfNull(r.at_tijd),
  vtTijd: strOfNull(r.vt_tijd),
});

/** Kolommen die de API schrijft — bewaakt door src/schemaContract.test.ts. */
export const toDatabaseSegment = (importId: string, s: Segment) => ({
  import_id: importId,
  service_number: s.serviceNumber,
  dagtype_code: s.dagtypeCode,
  volgorde: s.volgorde,
  type: s.type,
  start_min: s.startMin,
  einde_min: s.eindeMin,
  duur_min: s.duurMin,
  loop: s.loop,
  intern_loop: s.internLoop,
  lijn: s.lijn,
  variant: s.variant,
  rit: s.rit,
  voertuig: s.voertuig,
  vertrek: s.vertrek,
  vertrek_code: s.vertrekCode,
  aankomst: s.aankomst,
  aankomst_code: s.aankomstCode,
  afstand_km: s.afstandKm,
  at_tijd: s.atTijd,
  vt_tijd: s.vtTijd,
});

export const getImports = async (): Promise<SegmentImport[]> => {
  const { data, error } = await requireDb().from("service_segment_imports").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []).map(toSegmentImport);
};

export const getImport = async (id: string): Promise<SegmentImport | null> => {
  const { data, error } = await requireDb().from("service_segment_imports").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toSegmentImport(data) : null;
};

export const getActieveImport = async (): Promise<SegmentImport | null> => {
  const { data, error } = await requireDb().from("service_segment_imports").select("*").eq("actief", true).maybeSingle();
  if (error) throw error;
  return data ? toSegmentImport(data) : null;
};

export const createImport = async (i: Parameters<typeof toDatabaseSegmentImport>[0], segments: Segment[]): Promise<SegmentImport> => {
  const client = requireDb();
  const { data, error } = await client.from("service_segment_imports").insert(toDatabaseSegmentImport(i)).select("*").single();
  if (error) throw error;
  const imp = toSegmentImport(data);
  // In stukken van 500 (PostgREST-limiet op de body); bij een fout de import weer weghalen (cascade).
  try {
    for (let n = 0; n < segments.length; n += 500) {
      const { error: e2 } = await client.from("service_segments").insert(segments.slice(n, n + 500).map((s) => toDatabaseSegment(imp.id, s)));
      if (e2) throw e2;
    }
  } catch (err) {
    await client.from("service_segment_imports").delete().eq("id", imp.id);
    throw err;
  }
  return imp;
};

export const activeerImport = async (id: string): Promise<SegmentImport | null> => {
  const client = requireDb();
  const { error: e1 } = await client.from("service_segment_imports").update({ actief: false }).eq("actief", true);
  if (e1) throw e1;
  const { data, error } = await client.from("service_segment_imports").update({ actief: true, actief_sinds: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? toSegmentImport(data) : null;
};

export const deleteImport = async (id: string): Promise<boolean> => {
  const { error, count } = await requireDb().from("service_segment_imports").delete({ count: "exact" }).eq("id", id).eq("actief", false);
  if (error) throw error;
  return (count ?? 0) > 0;
};

export const getSegments = async (importId: string, filter: { serviceNumber?: string; dagtypeCode?: string } = {}): Promise<Array<Segment & { id: string; importId: string }>> => {
  let q = requireDb().from("service_segments").select("*").eq("import_id", importId).order("dagtype_code").order("service_number").order("volgorde").limit(10000);
  if (filter.serviceNumber) q = q.eq("service_number", filter.serviceNumber);
  if (filter.dagtypeCode) q = q.eq("dagtype_code", filter.dagtypeCode);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toSegment);
};

export type DagtypeCode = { code: string; omschrijving: string; periode: string | null; aantalPerJaar: number | null; portaalDagtype: string | null };

export const toDagtypeCode = (r: any): DagtypeCode => ({
  code: str(r.code),
  omschrijving: str(r.omschrijving),
  periode: strOfNull(r.periode),
  aantalPerJaar: numOfNull(r.aantal_per_jaar),
  portaalDagtype: strOfNull(r.portaal_dagtype),
});

export const toDatabaseDagtypeCodePatch = (b: { portaalDagtype: string | null }) => ({ portaal_dagtype: b.portaalDagtype, updated_at: new Date().toISOString() });

export const getDagtypeCodes = async (): Promise<DagtypeCode[]> => {
  const { data, error } = await requireDb().from("dagtype_codes").select("*").order("code");
  if (error) throw error;
  return (data ?? []).map(toDagtypeCode);
};

export const patchDagtypeCode = async (code: string, b: { portaalDagtype: string | null }): Promise<DagtypeCode | null> => {
  const { data, error } = await requireDb().from("dagtype_codes").update(toDatabaseDagtypeCodePatch(b)).eq("code", code).select("*").maybeSingle();
  if (error) throw error;
  return data ? toDagtypeCode(data) : null;
};
