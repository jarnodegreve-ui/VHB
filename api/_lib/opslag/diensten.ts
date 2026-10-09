import { randomUUID } from "node:crypto";
import { brusselsDay, toDatabaseService, toPublicService } from "../../helpers.js";
import type { ServiceRecord } from "../../types.js";
import { hoortBijVersie, oudsteVersie, versieVoorDatum } from "../../../shared/dienstregeling.js";
import { kalenderUitDekking, variantenSchoon, type DagtypeKalender } from "../../../shared/dagtype.js";
import { verwijderInStukken } from "./activiteit.js";
import { paginatedFetch, requireDb } from "./basis.js";
import { isMissingColumnError } from "./fouten.js";
import { MigratieOntbreektError } from "./gebruikers.js";

// --- Dienstregelingversies (fase 1, 08-10) -----------------------------------
//
// Het dienstoverzicht bestaat in versies met een geldig-vanaf-datum
// (public.dienstregelingen); elke dienst hoort bij één versie
// (services."dienstregelingId", null = de oudste versie). Zonder versies
// (de migratie is nog niet gedraaid, of de tabel is leeg) gedraagt alles
// zich als voorheen: één lijst, de hele tabel.

export const DIENSTREGELING_MIGRATIE = "supabase/2026-10-08_dienstregelingen.sql";

// Afwijkende tijden per dagtype (10-10): kolom services.varianten (jsonb).
// Zonder de kolom gaat een save zonder varianten door en geeft een save mét
// varianten een duidelijke fout (zelfde regel als users.verlofbudgetten).
export const VARIANTEN_MIGRATIE = "supabase/2026-10-10_services_varianten.sql";

const zonderVarianten = (rows: Array<Record<string, unknown>>) => rows.map(({ varianten: _weg, ...rest }) => rest);

/** Schrijft rijen mét de kolom `varianten`; ontbreekt die (migratie niet
 *  gedraaid), dan zonder, tenzij een rij er écht een heeft. */
const schrijfMetVarianten = async (
  rows: Array<Record<string, unknown>>,
  schrijf: (rows: Array<Record<string, unknown>>) => PromiseLike<{ error: unknown }>,
) => {
  let { error } = await schrijf(rows);
  // Alleen als het écht om deze kolom gaat; een andere ontbrekende kolom
  // (half gedraaide migratie) blijft zijn eigen fout.
  if (error && isMissingColumnError(error) && /varianten/i.test(String((error as { message?: unknown }).message ?? ""))) {
    if (rows.some((r) => r.varianten != null)) throw new MigratieOntbreektError("services.varianten", VARIANTEN_MIGRATIE);
    ({ error } = await schrijf(zonderVarianten(rows)));
  }
  if (error) throw error;
};

export type DienstregelingRecord = {
  id: string;
  naam: string | null;
  geldigVanaf: string;
  opmerking: string | null;
  createdAt: string;
  createdBy: string | null;
};

/** Welke versie: op id, op de dag waarop ze geldt (standaard vandaag), of
 *  alle versies tegelijk (back-up en herstel). */
export type VersieKeuze = { versieId?: string; datum?: string; alleVersies?: boolean };

export class DienstregelingOnbekend extends Error {
  constructor(id: string) {
    super(`Dienstregelingversie ${id} bestaat niet.`);
    this.name = "DienstregelingOnbekend";
  }
}

const tabelOntbreekt = (err: unknown): boolean => {
  const code = String((err as { code?: unknown })?.code ?? "");
  const msg = String((err as { message?: unknown })?.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || /relation .* does not exist/.test(msg) || /could not find the table/.test(msg);
};

const strOfNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export const toPublicDienstregeling = (r: any): DienstregelingRecord => ({
  id: String(r.id),
  naam: strOfNull(r.naam),
  geldigVanaf: String(r.geldig_vanaf ?? "").slice(0, 10),
  opmerking: strOfNull(r.opmerking),
  createdAt: String(r.created_at ?? ""),
  createdBy: strOfNull(r.created_by),
});

/** Kolommen die de API schrijft, bewaakt door src/schemaContract.test.ts. */
export const toDatabaseDienstregeling = (v: { id?: string; naam: string | null; geldigVanaf: string; opmerking: string | null; createdAt?: string; createdBy: string | null }) => ({
  ...(v.id ? { id: v.id } : {}),
  naam: v.naam,
  geldig_vanaf: v.geldigVanaf,
  opmerking: v.opmerking,
  ...(v.createdAt ? { created_at: v.createdAt } : {}),
  created_by: v.createdBy,
});

const vandaag = () => brusselsDay(new Date().toISOString());

/** Alle versies, oudste eerst. Zonder tabel (migratie nog niet gedraaid): leeg. */
export const getDienstregelingen = async (): Promise<DienstregelingRecord[]> => {
  const { data, error } = await requireDb().from("dienstregelingen").select("*").order("geldig_vanaf", { ascending: true });
  if (error) {
    if (tabelOntbreekt(error)) return [];
    throw error;
  }
  return (data ?? []).map(toPublicDienstregeling);
};

/** De gekozen versie, of null zonder versies. Onbekend id: DienstregelingOnbekend. */
export const kiesVersie = (versies: DienstregelingRecord[], keuze: VersieKeuze): DienstregelingRecord | null => {
  if (versies.length === 0) return null;
  if (keuze.versieId) {
    const v = versies.find((x) => x.id === keuze.versieId);
    if (!v) throw new DienstregelingOnbekend(keuze.versieId);
    return v;
  }
  return versieVoorDatum(versies, keuze.datum ?? vandaag());
};

// --- Services ---

const alleServiceRijen = async (): Promise<ServiceRecord[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('services').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicService);
};

/** Elke dienst van elke versie, met haar `dienstregelingId` (back-up). */
export const getServicesAlle = alleServiceRijen;

/**
 * Het dienstoverzicht van één versie: standaard de versie die vandaag geldt,
 * of die van `datum`, of `versieId`. Zonder versies: de hele tabel.
 */
export const getServicesData = async (keuze: VersieKeuze = {}): Promise<ServiceRecord[]> => {
  const [versies, rijen] = await Promise.all([getDienstregelingen(), alleServiceRijen()]);
  if (keuze.alleVersies) return rijen;
  const versie = kiesVersie(versies, keuze);
  if (!versie) return rijen;
  const oudste = oudsteVersie(versies)?.id ?? null;
  return rijen.filter((s) => hoortBijVersie(s, versie.id, oudste));
};

/** Per versie haar diensten (voor de planning-opbouw per datum en het
 *  versiescherm), plus de lijst van vandaag als terugval. */
export const getServicesPerVersie = async (): Promise<{
  versies: Array<DienstregelingRecord & { services: ServiceRecord[] }>;
  services: ServiceRecord[];
}> => {
  const [versies, rijen] = await Promise.all([getDienstregelingen(), alleServiceRijen()]);
  if (versies.length === 0) return { versies: [], services: rijen };
  const oudste = oudsteVersie(versies)?.id ?? null;
  const perVersie = versies.map((v) => ({ ...v, services: rijen.filter((s) => hoortBijVersie(s, v.id, oudste)) }));
  const huidig = versieVoorDatum(perVersie, vandaag());
  return { versies: perVersie, services: huidig?.services ?? [] };
};

/**
 * Vervangt het dienstoverzicht van één versie (standaard die van vandaag):
 * upsert van de aangeleverde diensten, daarna weg wat van díe versie niet
 * meer meekomt. Diensten van andere versies blijven staan. `alleVersies`
 * (herstel uit een back-up): elke rij houdt haar eigen versie en de hele
 * tabel wordt vervangen.
 */
export const saveServicesData = async (data: any, keuze: VersieKeuze = {}) => {
  const client = requireDb();
  const normalized: ServiceRecord[] = Array.isArray(data) ? data.map(toPublicService) : [];
  const versies = await getDienstregelingen();
  const versie = keuze.alleVersies ? null : kiesVersie(versies, keuze);
  const oudste = oudsteVersie(versies)?.id ?? null;
  const metVersie = versies.length > 0;
  const rows: Array<Record<string, unknown>> = normalized.map((s) => ({
    ...toDatabaseService(s),
    // De kolom alleen schrijven wanneer er versies zijn: tot de migratie
    // gedraaid is, kent de tabel haar niet.
    ...(metVersie ? { dienstregelingId: versie ? versie.id : (s.dienstregelingId ?? null) } : {}),
    varianten: variantenSchoon(s.varianten) ?? null,
  }));
  // Replace-semantiek zónder leeg-tabel-venster: eerst upserten, daarna pas
  // de ontbrekende rijen verwijderen. Het oude delete-alles-dan-insert kon
  // bij een insert-fout (netwerk/constraint/timeout) een lege dienstentabel
  // achterlaten — en daarmee elke volgende matrix-import breken.
  const incomingIds = new Set(rows.map((r: any) => String(r.id)));
  const existing = await paginatedFetch((from, to) =>
    client.from('services').select(metVersie ? 'id,dienstregelingId' : 'id').order('id', { ascending: true }).range(from, to),
  );
  if (rows.length > 0) await schrijfMetVarianten(rows, (r) => client.from('services').upsert(r));
  const idsToDelete = (existing ?? [])
    .filter((row: any) => !incomingIds.has(String(row.id)))
    // Eén versie vervangen: alleen háár rijen opruimen.
    .filter((row: any) => !versie || hoortBijVersie({ dienstregelingId: strOfNull(row.dienstregelingId) }, versie.id, oudste))
    .map((row: any) => String(row.id));
  await verwijderInStukken(client, 'services', 'id', idsToDelete);
};

// --- Versies aanmaken, bijwerken, verwijderen ---

/**
 * Nieuwe versie; met `kopieVanId` komen de diensten van die versie mee
 * (verse ids). Mislukt het kopiëren, dan gaat de versie weer weg (cascade),
 * zodat er nooit een lege versie achterblijft.
 */
export const createDienstregeling = async (invoer: {
  naam: string | null; geldigVanaf: string; opmerking: string | null; createdBy: string | null; kopieVanId: string | null;
}): Promise<DienstregelingRecord> => {
  const client = requireDb();
  const { data, error } = await client.from("dienstregelingen")
    .insert(toDatabaseDienstregeling({ naam: invoer.naam, geldigVanaf: invoer.geldigVanaf, opmerking: invoer.opmerking, createdBy: invoer.createdBy }))
    .select("*").single();
  if (error) throw error;
  const versie = toPublicDienstregeling(data);
  if (invoer.kopieVanId) {
    try {
      const bron = await getServicesData({ versieId: invoer.kopieVanId });
      const rows: Array<Record<string, unknown>> = bron.map((s) => ({
        ...toDatabaseService({ ...s, id: randomUUID() }), dienstregelingId: versie.id, varianten: variantenSchoon(s.varianten) ?? null,
      }));
      for (let n = 0; n < rows.length; n += 500) {
        await schrijfMetVarianten(rows.slice(n, n + 500), (r) => client.from("services").insert(r));
      }
    } catch (err) {
      await client.from("dienstregelingen").delete().eq("id", versie.id);
      throw err;
    }
  }
  return versie;
};

export const updateDienstregeling = async (
  id: string,
  patch: { naam?: string | null; geldigVanaf?: string; opmerking?: string | null },
): Promise<DienstregelingRecord | null> => {
  const velden: Record<string, unknown> = {};
  if (patch.naam !== undefined) velden.naam = patch.naam;
  if (patch.opmerking !== undefined) velden.opmerking = patch.opmerking;
  if (patch.geldigVanaf !== undefined) velden.geldig_vanaf = patch.geldigVanaf;
  const { data, error } = await requireDb().from("dienstregelingen").update(velden).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? toPublicDienstregeling(data) : null;
};

/** Verwijdert de versie én haar diensten (cascade). true = er was er een. */
export const deleteDienstregeling = async (id: string): Promise<boolean> => {
  const { error, count } = await requireDb().from("dienstregelingen").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
};

/** Herstel uit een back-up: de versies uit het bestand erin (upsert), de
 *  andere weg. Vóór de diensten aanroepen (FK), daarna saveServicesData met
 *  `alleVersies`. */
export const herstelDienstregelingen = async (versies: any[]): Promise<number> => {
  const client = requireDb();
  const rows = (Array.isArray(versies) ? versies : [])
    .map((v) => toPublicDienstregeling({ id: v.id, naam: v.naam, geldig_vanaf: v.geldigVanaf ?? v.geldig_vanaf, opmerking: v.opmerking, created_at: v.createdAt ?? v.created_at, created_by: v.createdBy ?? v.created_by }))
    .filter((v) => v.id && /^\d{4}-\d{2}-\d{2}$/.test(v.geldigVanaf))
    .map((v) => toDatabaseDienstregeling({ id: v.id, naam: v.naam, geldigVanaf: v.geldigVanaf, opmerking: v.opmerking, createdAt: v.createdAt || undefined, createdBy: v.createdBy }));
  if (rows.length > 0) {
    const { error } = await client.from("dienstregelingen").upsert(rows);
    if (error) throw error;
  }
  const bestaand = await getDienstregelingen();
  const houden = new Set(rows.map((r) => String(r.id)));
  const weg = bestaand.filter((v) => !houden.has(v.id)).map((v) => v.id);
  await verwijderInStukken(client, "dienstregelingen", "id", weg);
  return rows.length;
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
  await verwijderInStukken(client, 'coverage_expectations', 'day_type', toDelete);
};

// --- Dagtypekalender ----------------------------------------------------------

/** De kalender waarmee `dagtypeVanDag` (shared/dagtype.ts) het De Lijn-dagtype
 *  van een dag afleidt als de planningsmatrix het niet meegeeft: de
 *  weekdag-toewijzing, de periodes en de uitzonderingen van de dekking. */
export const laadDagtypeKalender = async (): Promise<DagtypeKalender> => {
  try {
    return kalenderUitDekking(await getCoverageExpectations());
  } catch (err) {
    // De kalender verfijnt alleen het dagtype van dagen zonder matrixcode; een
    // leesfout op de dekking mag het bord, de opbouw of een ruil niet laten vallen.
    console.warn("Dagtypekalender niet gelezen, standaard weekdagen gebruikt:", (err as { message?: unknown })?.message ?? err);
    return kalenderUitDekking({});
  }
};
