import { MAX_UPDATE_BIJLAGEN } from "../../../shared/schemas/update.js";
import { toDatabaseUpdate, toPublicUpdate } from "../../helpers.js";
import { db, supabaseAdmin } from "../../db.js";
import { verwijderInStukken } from "./activiteit.js";
import { paginatedFetch, requireDb } from "./basis.js";
import { bestandenVanRecord } from "./omleidingen.js";

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
  bijlagen: Array<{ slot: number; filename: string; sizeBytes?: number; uploadedAt?: string }>,
): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('updates')
    .update({ bijlagen: bijlagen.length > 0 ? bijlagen : null })
    .eq('id', String(updateId));
  if (error) throw error;
};

/** Welke PDF's van deze update hangen er nu echt in Storage? Voor het
 *  herstel na "Ongedaan maken", zoals bestaandeDiversionBijlagen. */
export const bestaandeUpdateBijlagen = async (updateId: string): Promise<Array<{ slot: number; sizeBytes?: number; uploadedAt?: string }>> => {
  const bestanden = await bestandenVanRecord(UPDATE_BIJLAGEN_BUCKET, updateId);
  const nummers = Array.from({ length: MAX_UPDATE_BIJLAGEN }, (_, i) => i + 1);
  return nummers.flatMap((slot) => {
    const gevonden = bestanden.get(updateBijlagePad(updateId, slot));
    return gevonden ? [{ slot, ...gevonden }] : [];
  });
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

  await verwijderInStukken(client, 'updates', 'id', idsToDelete);

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
