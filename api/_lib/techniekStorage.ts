import { db } from "../db.js";
import type {
  Defect, DefectPatch, DefectMeldingBody, Vehicle, VehicleBody, VehicleExpiry, Werkprestatie, WerkprestatieBody,
} from "../../shared/schemas/techniek.js";

/**
 * Opslag voor de techniekmodule (fase A Access-migratie): vehicles,
 * vehicle_defects (gele boek), vehicle_work (dagprestaties) en
 * vehicle_expiries. Alle tabellen zijn snake_case en API-only (RLS zonder
 * policies), dus alles loopt via de service role. Mappers vertalen naar de
 * camelCase-vorm van shared/schemas/techniek.ts.
 */

const requireDb = () => {
  if (!db) throw new Error("Supabase is niet geconfigureerd. Stel SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in als env vars.");
  return db;
};

export const TECHNIEK_MIGRATIE = "supabase/2026-09-13_techniek_voertuigen.sql";

const str = (v: unknown): string => String(v ?? "");
const strOfNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const numOfNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

// --- Vehicles ---

export const toVehicle = (r: any): Vehicle => ({
  id: str(r.id),
  busnr: str(r.busnr),
  kortNr: numOfNull(r.kort_nr),
  nummerplaat: strOfNull(r.nummerplaat),
  chassisnr: strOfNull(r.chassisnr),
  merk: strOfNull(r.merk),
  type: r.type,
  aandrijving: strOfNull(r.aandrijving) as Vehicle["aandrijving"],
  status: r.status ?? "actief",
  inDienst: strOfNull(r.in_dienst),
  uitDienst: strOfNull(r.uit_dienst),
  zitplaatsen: numOfNull(r.zitplaatsen),
  opmerking: strOfNull(r.opmerking),
});

/** Kolommen die de API schrijft — bewaakt door src/schemaContract.test.ts. */
export const toDatabaseVehicle = (v: VehicleBody) => ({
  busnr: v.busnr,
  kort_nr: v.kortNr ?? null,
  nummerplaat: v.nummerplaat ?? null,
  chassisnr: v.chassisnr ?? null,
  merk: v.merk ?? null,
  type: v.type,
  aandrijving: v.aandrijving ?? null,
  status: v.status,
  in_dienst: v.inDienst ?? null,
  uit_dienst: v.uitDienst ?? null,
  zitplaatsen: v.zitplaatsen ?? null,
  opmerking: v.opmerking ?? null,
});

export const getVehicles = async (): Promise<Vehicle[]> => {
  const { data, error } = await requireDb().from("vehicles").select("*").order("kort_nr", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(toVehicle);
};

export const getVehicle = async (id: string): Promise<Vehicle | null> => {
  const { data, error } = await requireDb().from("vehicles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toVehicle(data) : null;
};

export const createVehicle = async (v: VehicleBody): Promise<Vehicle> => {
  const { data, error } = await requireDb().from("vehicles").insert(toDatabaseVehicle(v)).select("*").single();
  if (error) throw error;
  return toVehicle(data);
};

export const updateVehicle = async (id: string, v: VehicleBody): Promise<Vehicle | null> => {
  const { data, error } = await requireDb().from("vehicles").update(toDatabaseVehicle(v)).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? toVehicle(data) : null;
};

/** Verwijderen kan alleen zonder defecten/werk (FK); anders geeft Postgres 23503. */
export const deleteVehicle = async (id: string): Promise<boolean> => {
  const { error, count } = await requireDb().from("vehicles").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
};

export const isForeignKeyError = (err: unknown): boolean => String((err as { code?: unknown })?.code ?? "") === "23503";
export const isUniqueError = (err: unknown): boolean => String((err as { code?: unknown })?.code ?? "") === "23505";

// --- Defecten (gele boek) ---

const DEFECT_SELECT = "*, vehicles!inner(busnr, kort_nr)";

export const toDefect = (r: any): Defect => ({
  id: str(r.id),
  vehicleId: str(r.vehicle_id),
  busnr: str(r.vehicles?.busnr),
  kortNr: numOfNull(r.vehicles?.kort_nr),
  gemeldOp: str(r.gemeld_op),
  gemeldDoor: str(r.gemeld_door),
  werktype: r.werktype,
  omschrijving: str(r.omschrijving),
  status: r.status ?? "open",
  uitgevoerdOp: strOfNull(r.uitgevoerd_op),
  uitgevoerdDoor: strOfNull(r.uitgevoerd_door),
  uitgevoerdWerk: strOfNull(r.uitgevoerd_werk),
  manuren: numOfNull(r.manuren),
  opmerking: strOfNull(r.opmerking),
  updatedAt: strOfNull(r.updated_at) ?? undefined,
});

export const toDatabaseDefect = (d: DefectMeldingBody & { gemeldDoor: string }) => ({
  vehicle_id: d.vehicleId,
  gemeld_door: d.gemeldDoor,
  werktype: d.werktype,
  omschrijving: d.omschrijving,
  status: "open",
});

export const toDatabaseDefectPatch = (p: DefectPatch & { uitgevoerdDoor?: string | null }) => {
  const patch: Record<string, unknown> = {};
  if (p.status !== undefined) patch.status = p.status;
  if (p.uitgevoerdOp !== undefined) patch.uitgevoerd_op = p.uitgevoerdOp;
  if (p.uitgevoerdDoor !== undefined) patch.uitgevoerd_door = p.uitgevoerdDoor;
  if (p.uitgevoerdWerk !== undefined) patch.uitgevoerd_werk = p.uitgevoerdWerk;
  if (p.manuren !== undefined) patch.manuren = p.manuren;
  if (p.opmerking !== undefined) patch.opmerking = p.opmerking;
  if (p.werktype !== undefined) patch.werktype = p.werktype;
  if (p.omschrijving !== undefined) patch.omschrijving = p.omschrijving;
  return patch;
};

export type DefectFilter = {
  status?: "open" | "alles" | "uitgevoerd" | "geannuleerd";
  vehicleId?: string;
  /** Alleen meldingen sinds deze datum (ISO-dag). */
  sinds?: string;
  /** Alleen meldingen van deze melder (chauffeur-scope). */
  gemeldDoor?: string;
  limit?: number;
};

export const getDefecten = async (f: DefectFilter = {}): Promise<Defect[]> => {
  let q = requireDb().from("vehicle_defects").select(DEFECT_SELECT).order("gemeld_op", { ascending: false });
  if (!f.status || f.status === "open") q = q.eq("status", "open");
  else if (f.status !== "alles") q = q.eq("status", f.status);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
  if (f.sinds) q = q.gte("gemeld_op", `${f.sinds}T00:00:00`);
  if (f.gemeldDoor) q = q.eq("gemeld_door", f.gemeldDoor);
  q = q.limit(Math.min(Math.max(f.limit ?? 500, 1), 2000));
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toDefect);
};

export const getDefect = async (id: string): Promise<Defect | null> => {
  const { data, error } = await requireDb().from("vehicle_defects").select(DEFECT_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toDefect(data) : null;
};

export const createDefect = async (d: DefectMeldingBody & { gemeldDoor: string }): Promise<Defect> => {
  const { data, error } = await requireDb().from("vehicle_defects").insert(toDatabaseDefect(d)).select(DEFECT_SELECT).single();
  if (error) throw error;
  return toDefect(data);
};

export const patchDefect = async (id: string, p: DefectPatch & { uitgevoerdDoor?: string | null }): Promise<Defect | null> => {
  const patch = toDatabaseDefectPatch(p);
  if (Object.keys(patch).length === 0) return getDefect(id);
  const { data, error } = await requireDb().from("vehicle_defects").update(patch).eq("id", id).select(DEFECT_SELECT).maybeSingle();
  if (error) throw error;
  return data ? toDefect(data) : null;
};

/** Aantal open meldingen (dashboardtegel, werkvoorraad). */
export const countOpenDefecten = async (): Promise<number> => {
  const { count, error } = await requireDb().from("vehicle_defects").select("id", { count: "exact", head: true }).eq("status", "open");
  if (error) throw error;
  return count ?? 0;
};

// --- Werkprestaties ---

const WORK_SELECT = "*, vehicles(busnr, kort_nr)";

export const toWerkprestatie = (r: any): Werkprestatie => ({
  id: str(r.id),
  datum: str(r.datum),
  mecanicienId: str(r.mecanicien_id),
  vehicleId: strOfNull(r.vehicle_id),
  busnr: strOfNull(r.vehicles?.busnr),
  kortNr: numOfNull(r.vehicles?.kort_nr),
  werkcode: r.werkcode,
  omschrijving: str(r.omschrijving),
  beginTijd: strOfNull(r.begin_tijd),
  eindeTijd: strOfNull(r.einde_tijd),
  werkuren: Number(r.werkuren ?? 0),
  kmstand: numOfNull(r.kmstand),
  defectId: strOfNull(r.defect_id),
  createdAt: strOfNull(r.created_at) ?? undefined,
});

export const toDatabaseWerkprestatie = (w: WerkprestatieBody & { mecanicienId: string }) => ({
  datum: w.datum,
  mecanicien_id: w.mecanicienId,
  vehicle_id: w.vehicleId ?? null,
  werkcode: w.werkcode,
  omschrijving: w.omschrijving,
  begin_tijd: w.beginTijd ?? null,
  einde_tijd: w.eindeTijd ?? null,
  werkuren: w.werkuren,
  kmstand: w.kmstand ?? null,
  defect_id: w.defectId ?? null,
});

export type WerkFilter = { van?: string; tot?: string; mecanicienId?: string; vehicleId?: string; limit?: number };

export const getWerkprestaties = async (f: WerkFilter = {}): Promise<Werkprestatie[]> => {
  let q = requireDb().from("vehicle_work").select(WORK_SELECT).order("datum", { ascending: false }).order("created_at", { ascending: false });
  if (f.van) q = q.gte("datum", f.van);
  if (f.tot) q = q.lte("datum", f.tot);
  if (f.mecanicienId) q = q.eq("mecanicien_id", f.mecanicienId);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
  q = q.limit(Math.min(Math.max(f.limit ?? 1000, 1), 5000));
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toWerkprestatie);
};

export const getWerkprestatie = async (id: string): Promise<Werkprestatie | null> => {
  const { data, error } = await requireDb().from("vehicle_work").select(WORK_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toWerkprestatie(data) : null;
};

export const createWerkprestatie = async (w: WerkprestatieBody & { mecanicienId: string }): Promise<Werkprestatie> => {
  const { data, error } = await requireDb().from("vehicle_work").insert(toDatabaseWerkprestatie(w)).select(WORK_SELECT).single();
  if (error) throw error;
  return toWerkprestatie(data);
};

export const updateWerkprestatie = async (id: string, w: WerkprestatieBody & { mecanicienId: string }): Promise<Werkprestatie | null> => {
  const { data, error } = await requireDb().from("vehicle_work").update(toDatabaseWerkprestatie(w)).eq("id", id).select(WORK_SELECT).maybeSingle();
  if (error) throw error;
  return data ? toWerkprestatie(data) : null;
};

export const deleteWerkprestatie = async (id: string): Promise<boolean> => {
  const { error, count } = await requireDb().from("vehicle_work").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
};

// --- Vervaldata ---

export const toVehicleExpiry = (r: any): VehicleExpiry => ({
  vehicleId: str(r.vehicle_id),
  soort: r.soort,
  validUntil: str(r.valid_until),
  opmerking: strOfNull(r.opmerking),
});

export const getVehicleExpiries = async (vehicleId?: string): Promise<VehicleExpiry[]> => {
  let q = requireDb().from("vehicle_expiries").select("*");
  if (vehicleId) q = q.eq("vehicle_id", vehicleId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toVehicleExpiry);
};

export const toDatabaseVehicleExpiry = (rec: { vehicleId: string; soort: string; validUntil: string; opmerking: string | null; updatedBy: string | null }) => ({
  vehicle_id: rec.vehicleId,
  soort: rec.soort,
  valid_until: rec.validUntil,
  opmerking: rec.opmerking,
  updated_by: rec.updatedBy,
  updated_at: new Date().toISOString(),
});

export const saveVehicleExpiry = async (rec: { vehicleId: string; soort: string; validUntil: string; opmerking: string | null; updatedBy: string | null }): Promise<void> => {
  const { error } = await requireDb().from("vehicle_expiries").upsert(toDatabaseVehicleExpiry(rec));
  if (error) throw error;
};

export const deleteVehicleExpiry = async (vehicleId: string, soort: string): Promise<void> => {
  const { error } = await requireDb().from("vehicle_expiries").delete().eq("vehicle_id", vehicleId).eq("soort", soort);
  if (error) throw error;
};
