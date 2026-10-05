import { MAIL_LOG_NIET_AFGEROND } from "../../../shared/mailLog.js";
import { isMissingTableError } from "../../deviceGate.js";
import { saveActivityLogEntry } from "./activiteit.js";
import { requireDb } from "./basis.js";

// --- Cron-heartbeats -------------------------------------------------------
// Crons falen stil (Vercel-logs die niemand leest): elke geslaagde run
// schrijft een heartbeat in activity_log (category 'system'); de health-
// endpoint markeert heartbeats die ouder zijn dan 2× het interval. Voor
// hoogfrequente crons (OCPI, elke 2-5 min) throttelen we naar max. 1
// heartbeat per uur zodat het log niet volloopt.
// --- Verzendlog van de mails (2026-09-25_mail_log.sql) ---

export interface MailLogRegel {
  soort: string;
  aantal: number;
  gelukt: boolean;
  fout?: string | null;
  door?: string | null;
}

/** Eén regel in het verzendlog; best-effort, en stil zolang de migratie niet
 *  gedraaid is. Nooit inhoud of adressen (zie de migratie). */
export const logMail = async (regel: MailLogRegel): Promise<void> => {
  try {
    const client = requireDb();
    const { error } = await client.from("mail_log").insert({
      soort: regel.soort,
      aantal: regel.aantal,
      gelukt: regel.gelukt,
      fout: regel.fout ? String(regel.fout).slice(0, 500) : null,
      door: regel.door ?? "Systeem",
    });
    if (error && !isMissingTableError(error)) console.warn("[mail-log] schrijven mislukt:", error.message);
  } catch (err) {
    if (!isMissingTableError(err)) console.warn("[mail-log] schrijven mislukt:", err);
  }
};

/**
 * Logregel van een reeks, geschreven VÓÓR de eerste mail vertrekt (nr. 5):
 * `gelukt: false` met de reden "niet afgerond". Breekt de functie onderweg
 * af, dan blijft die regel staan en is de verzending zichtbaar in het
 * verzendlog. Geeft het id voor `rondMailLogAf`, of null als schrijven niet
 * lukte (tabel ontbreekt, database weg): de aanroeper logt dan achteraf één
 * regel met `logMail`, zoals vroeger.
 */
export const startMailLog = async (regel: { soort: string; aantal: number; door?: string | null }): Promise<string | null> => {
  try {
    const client = requireDb();
    const { data, error } = await client
      .from("mail_log")
      .insert({ soort: regel.soort, aantal: regel.aantal, gelukt: false, fout: MAIL_LOG_NIET_AFGEROND, door: regel.door ?? "Systeem" })
      .select("id")
      .single();
    if (error) {
      if (!isMissingTableError(error)) console.warn("[mail-log] schrijven mislukt:", error.message);
      return null;
    }
    return data?.id ? String(data.id) : null;
  } catch (err) {
    if (!isMissingTableError(err)) console.warn("[mail-log] schrijven mislukt:", err);
    return null;
  }
};

/** Werkt de regel van `startMailLog` bij naar het eindresultaat. False als
 *  dat niet lukte; de regel blijft dan als "onderbroken" staan. */
export const rondMailLogAf = async (id: string, uitkomst: { gelukt: boolean; fout?: string | null }): Promise<boolean> => {
  try {
    const client = requireDb();
    const { error } = await client
      .from("mail_log")
      .update({ gelukt: uitkomst.gelukt, fout: uitkomst.fout ? String(uitkomst.fout).slice(0, 500) : null })
      .eq("id", id);
    if (error) {
      console.warn("[mail-log] bijwerken mislukt:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[mail-log] bijwerken mislukt:", err);
    return false;
  }
};

export interface MailLogRij extends MailLogRegel {
  id: string;
  verzondenOp: string;
}

/** De laatste regels van het verzendlog (nieuwste eerst); lege lijst zonder migratie. */
export const getMailLog = async (limit = 200): Promise<MailLogRij[]> => {
  try {
    const client = requireDb();
    const { data, error } = await client
      .from("mail_log")
      .select("id, verzonden_op, soort, aantal, gelukt, fout, door")
      .order("verzonden_op", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      verzondenOp: String(r.verzonden_op),
      soort: String(r.soort),
      aantal: Number(r.aantal) || 0,
      gelukt: Boolean(r.gelukt),
      fout: r.fout ?? null,
      door: r.door ?? null,
    }));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
};

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
