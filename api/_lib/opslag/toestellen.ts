import type { DeviceStatus, UserDevice } from "../../types.js";
import { paginatedFetch, requireDb } from "./basis.js";
import { isMissingColumnError } from "./fouten.js";

// --- Toestel-whitelist (user_devices) ---
// Server-only tabel (RLS aan, geen policies, snake_case) — zie
// supabase/user_devices.sql. Eerste toestel van een chauffeur = auto-approved,
// elk volgend toestel = pending tot de admin goedkeurt. Planner/admin-
// toestellen zijn altijd approved (alleen zichtbaarheid, nooit uitsluiting).
// De types zelf staan in api/types.ts (AuthenticatedRequest.device verwijst ernaar).

const toPublicDevice = (row: any): UserDevice => ({
  userId: String(row.user_id),
  deviceToken: String(row.device_token),
  name: String(row.name ?? 'Onbekend toestel'),
  status: row.status as DeviceStatus,
  createdAt: String(row.created_at),
  lastSeenAt: String(row.last_seen_at),
  approvedAt: row.approved_at ? String(row.approved_at) : null,
  approvedBy: row.approved_by ? String(row.approved_by) : null,
  sessionId: row.session_id ? String(row.session_id) : null,
});

/**
 * De kolom session_id komt uit 2026-09-09_user_devices_sessie.sql. Draait die
 * migratie nog niet, dan mag een deploy niet de hele toestelregistratie
 * breken: bij een "kolom bestaat niet"-fout (isMissingColumnError hierboven)
 * werken we verder zonder sessiebinding, de header-gate blijft dan de enige
 * laag. Niet voorgoed per warme instantie: na vijf minuten proberen we het
 * opnieuw, zodat de migratie ook zonder nieuwe deploy vanzelf gaat gelden.
 */
const SESSIE_KOLOM_HERKANS_MS = 5 * 60_000;
let sessieKolomOntbreektSinds: number | null = null;
const sessieKolomBruikbaar = (): boolean =>
  sessieKolomOntbreektSinds === null || Date.now() - sessieKolomOntbreektSinds > SESSIE_KOLOM_HERKANS_MS;
const meldSessieKolomOntbreekt = (error: unknown) => {
  sessieKolomOntbreektSinds = Date.now();
  console.error('user_devices.session_id ontbreekt, migratie 2026-09-09_user_devices_sessie.sql nog niet gedraaid:', error);
};

export const getDevice = async (userId: string, deviceToken: string): Promise<UserDevice | null> => {
  const client = requireDb();
  const { data, error } = await client
    .from('user_devices')
    .select('*')
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken))
    .maybeSingle();
  if (error) throw error;
  return data ? toPublicDevice(data) : null;
};

/**
 * Registreert een toestel (of raakt een bestaand toestel aan). Geeft de rij
 * terug + of hij nieuw was. `autoApprove` bepaalt de status van een níeuw
 * toestel; een bestaand toestel behoudt zijn status (een revoked toestel
 * kan zichzelf dus niet her-registreren naar pending/approved).
 */
export const registerDevice = async (
  userId: string,
  deviceToken: string,
  name: string,
  autoApprove: boolean,
  // Optioneel: de aanroeper heeft de toestellen van deze gebruiker net al
  // opgehaald (listDevicesForUser) en geeft de gevonden rij (of null) mee;
  // dat spaart hier een lezing. undefined = zelf opzoeken, zoals vroeger.
  bekend?: UserDevice | null,
  // De session_id-claim uit het geverifieerde JWT van deze aanmelding (of
  // null): komt op de toestelrij zodat de gate een ingetrokken toestel ook
  // zonder de client-header herkent.
  sessionId?: string | null,
): Promise<{ device: UserDevice; created: boolean }> => {
  const client = requireDb();
  const existing = bekend !== undefined ? bekend : await getDevice(userId, deviceToken);
  if (existing) {
    // Bij elke aanmelding de actuele sessie vastleggen: alleen zo kan de gate
    // een ingetrokken toestel herkennen zonder de client-header.
    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
    if (sessieKolomBruikbaar() && sessionId) patch.session_id = sessionId;
    let { error } = await client
      .from('user_devices')
      .update(patch)
      .eq('user_id', String(userId))
      .eq('device_token', String(deviceToken));
    if (error && isMissingColumnError(error) && 'session_id' in patch) {
      meldSessieKolomOntbreekt(error);
      delete patch.session_id;
      ({ error } = await client
        .from('user_devices')
        .update(patch)
        .eq('user_id', String(userId))
        .eq('device_token', String(deviceToken)));
    }
    if (error) throw error;
    return { device: { ...existing, sessionId: 'session_id' in patch ? String(patch.session_id) : existing.sessionId }, created: false };
  }
  const row: Record<string, unknown> = {
    user_id: String(userId),
    device_token: String(deviceToken),
    name: name || 'Onbekend toestel',
    status: (autoApprove ? 'approved' : 'pending') as DeviceStatus,
    approved_at: autoApprove ? new Date().toISOString() : null,
    approved_by: autoApprove ? 'auto' : null,
    ...(sessieKolomBruikbaar() && sessionId ? { session_id: sessionId } : {}),
  };
  // Race (dubbele boot-call): bij een PK-conflict is de rij er al — negeren
  // en de bestaande status teruggeven i.p.v. een 500.
  // insert + de rij meteen terug (één trip i.p.v. insert en dan opnieuw lezen).
  let { data: inserted, error } = await client.from('user_devices').insert(row).select('*').maybeSingle();
  if (error && isMissingColumnError(error) && 'session_id' in row) {
    meldSessieKolomOntbreekt(error);
    delete row.session_id;
    ({ data: inserted, error } = await client.from('user_devices').insert(row).select('*').maybeSingle());
  }
  if (error) {
    if ((error as any).code === '23505') {
      const raced = await getDevice(userId, deviceToken);
      if (raced) return { device: raced, created: false };
    }
    throw error;
  }
  const device = inserted ? toPublicDevice(inserted) : await getDevice(userId, deviceToken);
  if (!device) throw new Error('Toestel-registratie niet teruggevonden.');
  return { device, created: true };
};

/** De toestellen van één gebruiker (hooguit MAX_DEVICES_PER_USER rijen): de
 *  registratie hoeft daarvoor niet de hele tabel te lezen. */
export const listDevicesForUser = async (userId: string): Promise<UserDevice[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('user_devices').select('*').eq('user_id', String(userId)).order('created_at', { ascending: false }).order('device_token', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicDevice);
};

export const listAllDevices = async (): Promise<UserDevice[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('user_devices').select('*').order('created_at', { ascending: false }).range(from, to),
  );
  return rows.map(toPublicDevice);
};

/**
 * De sessies die bij een ingetrokken toestel horen. De gate gebruikt dit om
 * een verzoek te blokkeren op basis van het (geverifieerde) JWT in plaats van
 * de X-Device-Token-header, die een aanvaller simpelweg kan weglaten.
 * Ingetrokken toestellen zijn zeldzaam, dus dit is een korte lijst.
 */
export const listRevokedSessionIds = async (): Promise<string[]> => {
  if (!sessieKolomBruikbaar()) return [];
  const client = requireDb();
  const { data, error } = await client
    .from('user_devices')
    .select('session_id')
    .eq('status', 'revoked')
    .not('session_id', 'is', null);
  if (error) {
    if (isMissingColumnError(error)) {
      meldSessieKolomOntbreekt(error);
      return [];
    }
    throw error;
  }
  return (data ?? []).map((r: any) => String(r.session_id)).filter(Boolean);
};

export const setDeviceStatus = async (
  userId: string,
  deviceToken: string,
  status: DeviceStatus,
  actorId: string,
): Promise<void> => {
  const client = requireDb();
  const patch: Record<string, unknown> = { status };
  if (status === 'approved') {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = String(actorId);
  }
  const { error } = await client
    .from('user_devices')
    .update(patch)
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken));
  if (error) throw error;
};

export const renameDevice = async (userId: string, deviceToken: string, name: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('user_devices')
    .update({ name: name || 'Onbekend toestel' })
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken));
  if (error) throw error;
};

/** Verwijdert een toestel-registratie volledig (schrappen uit de lijst). */
export const deleteDevice = async (userId: string, deviceToken: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('user_devices')
    .delete()
    .eq('user_id', String(userId))
    .eq('device_token', String(deviceToken));
  if (error) throw error;
};

/** Alle toestellen van één gebruiker op 'revoked' (uitdienst-flow). Geeft
 *  het aantal toestellen dat écht van status veranderde, zodat een tweede
 *  aanroep 0 meldt. Rijen blijven staan (auditspoor in Toestellen). */
export const revokeAllDevices = async (userId: string): Promise<number> => {
  const client = requireDb();
  const { data, error } = await client
    .from('user_devices')
    .update({ status: 'revoked' satisfies DeviceStatus })
    .eq('user_id', String(userId))
    .neq('status', 'revoked')
    .select('device_token');
  if (error) throw error;
  return (data ?? []).length;
};
