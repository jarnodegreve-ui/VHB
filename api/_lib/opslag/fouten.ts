import { db } from "../../db.js";
import { requireDb } from "./basis.js";

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
export const isMissingColumnError = (err: unknown): boolean => {
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
  const summary = { clientErrors: 0, activityLog: 0, planningNotes: 0, pushSubscriptions: 0, meldingen: 0, aanwezigheid: 0, mailLog: 0 };
  if (!db) return summary;
  const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    // Verzendlog van de mails: zelfde bewaartermijn als het auditlog (het is
    // een bewijs dat er verstuurd is, geen inhoud); anders groeit het eeuwig
    // met tientallen rijen per dag.
    const { count, error } = await db
      .from("mail_log")
      .delete({ count: "exact" })
      .lt("verzonden_op", cutoff(opts.logDays));
    if (!error) summary.mailLog = count ?? 0;
  } catch {
    // tabel ontbreekt (migratie niet gedraaid) — bewust stil
  }
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
