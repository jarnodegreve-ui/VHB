import { db, supabaseAdmin } from "../../db.js";
import { paginatedFetch, requireDb } from "./basis.js";

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
