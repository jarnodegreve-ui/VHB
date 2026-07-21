import type express from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
import { authenticate, requireRole, isCronAuthorized } from "./middleware.js";
import { logCronHeartbeat } from "./storage.js";
import type { AuthenticatedRequest } from "./types.js";

/**
 * OCPI 2.2.1 — eMSP/receiver-kant, read-only monitoring van ChargEye (CPO).
 *
 * Stap 1 (dit bestand): de credentials-handshake (Token A → Token C) plus de
 * OCPI-endpoints die wij zelf moeten hosten zodat de CPO ons kan ontdekken.
 * De data-sync (locations/sessions/cdrs) komt in een latere stap; die leest
 * de hier opgeslagen Token C + endpoint-URL's uit ocpi_registration.
 *
 * Veldnamen volgen exact de OCPI 2.2.1-spec (Versions, Credentials modules).
 */

// ---- Config (alles via env, nooit hardcoded) ----
const CPO_VERSIONS_URL = (process.env.OCPI_CPO_VERSIONS_URL || "").trim();
const TOKEN_A = (process.env.OCPI_TOKEN_A || "").trim();
const PARTY_ID = (process.env.OCPI_PARTY_ID || "VHB").trim().toUpperCase();
const COUNTRY_CODE = (process.env.OCPI_COUNTRY_CODE || "BE").trim().toUpperCase();
const PUBLIC_BASE = (process.env.OCPI_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const OUR_OCPI_BASE = `${PUBLIC_BASE}/api/ocpi`;
const OUR_VERSIONS_URL = `${OUR_OCPI_BASE}/versions`;
const OUR_BUSINESS_NAME = (process.env.OCPI_BUSINESS_NAME || "VHB Portaal").trim();

// ---- OCPI helpers ----
// 2.2.1: het token gaat base64-gecodeerd in de Authorization-header als
// "Token <base64>". (2.1.1 gebruikte plain; we tolereren beide bij inkomende
// checks.)
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Timing-veilige stringvergelijking (hasht beide kanten zodat lengte/inhoud
 *  niet via de vergelijkingsduur lekken). */
const safeEqual = (a: string, b: string): boolean => {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
};

/** SSRF-guard voor URL's die uit een (extern) OCPI-credentials-object komen:
 *  alleen https naar een publieke host — geen loopback/link-local/private/
 *  metadata-adressen die de server naar zichzelf/interne diensten laten fetchen. */
const isSafeExternalHttpsUrl = (raw: string): boolean => {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  // IPv6-brackets ([::1] → ::1) en een trailing dot (localhost. → localhost)
  // strippen — anders zijn de checks hieronder dode code en glipt IPv6-
  // loopback/link-local of een trailing-dot-host er alsnog doorheen.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (host === "0.0.0.0" || host === "169.254.169.254" || host === "::1" || host === "::") return false;
  if (host.startsWith("::ffff:")) return false; // IPv4-mapped IPv6 (bv. ::ffff:169.254.169.254)
  if (/^(127\.|10\.|169\.254\.|192\.168\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^(fe80:|fc00:|fd00:)/i.test(host)) return false;
  return true;
};
const authHeader = (token: string) => `Token ${b64(token)}`;

const nowIso = () => new Date().toISOString();
const ocpiEnvelope = (data: unknown, status_code = 1000, status_message = "Success") => ({
  data,
  status_code,
  status_message,
  timestamp: nowIso(),
});
const ocpiError = (status_code: number, status_message: string) => ({
  status_code,
  status_message,
  timestamp: nowIso(),
});

const randomToken = () => randomBytes(32).toString("base64url");

type OcpiRegistration = {
  our_token_b: string | null;
  cpo_token_c: string | null;
  cpo_party_id: string | null;
  cpo_country_code: string | null;
  cpo_endpoints: Array<{ identifier: string; role?: string; url: string }> | null;
  ocpi_version: string | null;
  registered_at: string | null;
};

// ---- Opslag (service-role; ocpi_registration heeft RLS dicht) ----
export const getOcpiRegistration = async (): Promise<OcpiRegistration | null> => {
  if (!db) return null;
  try {
    const { data, error } = await db.from("ocpi_registration").select("*").eq("id", "default").maybeSingle();
    if (error) return null;
    return (data as OcpiRegistration) ?? null;
  } catch {
    return null;
  }
};

const saveOcpiRegistration = async (reg: Partial<OcpiRegistration>) => {
  if (!db) throw new Error("Database niet geconfigureerd.");
  const { error } = await db.from("ocpi_registration").upsert({ id: "default", ...reg, updated_at: nowIso() });
  if (error) throw new Error(`OCPI-registratie opslaan mislukt: ${error.message}`);
};

// ---- OCPI-client (fetch wrapper) ----
class OcpiError extends Error {}

const ocpiFetch = async (url: string, token: string, init?: { method?: string; body?: unknown }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: authHeader(token),
        Accept: "application/json",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* niet-JSON */ }
    if (!res.ok) {
      throw new OcpiError(`OCPI HTTP ${res.status} bij ${url}: ${text.slice(0, 200)}`);
    }
    if (json && typeof json.status_code === "number" && json.status_code !== 1000) {
      throw new OcpiError(`OCPI status ${json.status_code} (${json.status_message ?? "?"}) bij ${url}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Voer de uitgaande credentials-handshake uit tegen ChargEye met Token A en
 * sla het resultaat (Token C + endpoints) op. Idempotent: opnieuw draaien
 * registreert opnieuw en overschrijft de opgeslagen rij.
 */
export const registerWithCpo = async (): Promise<{ version: string; cpoPartyId: string | null; endpoints: number }> => {
  if (!CPO_VERSIONS_URL) throw new Error("OCPI_CPO_VERSIONS_URL ontbreekt in de omgeving.");
  if (!TOKEN_A) throw new Error("OCPI_TOKEN_A ontbreekt in de omgeving.");
  if (!PUBLIC_BASE) throw new Error("OCPI_PUBLIC_BASE_URL ontbreekt (nodig zodat de CPO ons kan bereiken).");

  // 1) Versions ophalen met Token A → kies 2.2.1 (val terug op 2.2.x).
  const versions = await ocpiFetch(CPO_VERSIONS_URL, TOKEN_A);
  const versionList: Array<{ version: string; url: string }> = versions?.data ?? [];
  const chosen = versionList.find((v) => v.version === "2.2.1")
    ?? versionList.find((v) => String(v.version).startsWith("2.2"));
  if (!chosen) throw new Error(`ChargEye biedt geen OCPI 2.2.x aan (gevonden: ${versionList.map((v) => v.version).join(", ") || "geen"}).`);

  // 2) Version-details ophalen → credentials-endpoint zoeken.
  const detailsA = await ocpiFetch(chosen.url, TOKEN_A);
  const endpointsA: Array<{ identifier: string; role?: string; url: string }> = detailsA?.data?.endpoints ?? [];
  const credEndpoint = endpointsA.find((e) => e.identifier === "credentials");
  if (!credEndpoint) throw new Error("Geen 'credentials'-endpoint in ChargEye's version-details.");

  // 3) Onze credentials POST'en met Token A. Wij genereren Token B (waarmee de
  //    CPO óns mag bellen). 2.2.1 credentials-object: token, url, roles[].
  const ourTokenB = randomToken();
  // BELANGRIJK: Token B eerst opslaan. Tijdens de POST hieronder haalt de CPO
  // synchroon ónze versions/version-details op, geauthenticeerd met deze Token B.
  // Staat hij nog niet in de DB, dan geeft ocpiAuth 401 en meldt de CPO
  // "unable to reach versions endpoint" (OCPI-status 3001).
  await saveOcpiRegistration({ our_token_b: ourTokenB, ocpi_version: chosen.version });
  const ourCredentials = {
    token: ourTokenB,
    url: OUR_VERSIONS_URL,
    roles: [
      {
        role: "EMSP",
        party_id: PARTY_ID,
        country_code: COUNTRY_CODE,
        business_details: { name: OUR_BUSINESS_NAME },
      },
    ],
  };
  const credResp = await ocpiFetch(credEndpoint.url, TOKEN_A, { method: "POST", body: ourCredentials });
  const cpoCreds = credResp?.data;
  const tokenC: string | undefined = cpoCreds?.token;
  if (!tokenC) throw new Error("ChargEye gaf geen Token C terug in de credentials-respons.");
  const cpoRole = Array.isArray(cpoCreds?.roles) ? cpoCreds.roles[0] : undefined;

  // 4) Met Token C de definitieve endpoints ophalen (Sender: locations/sessions/cdrs).
  const detailsC = await ocpiFetch(chosen.url, tokenC);
  const cpoEndpoints: Array<{ identifier: string; role?: string; url: string }> = detailsC?.data?.endpoints ?? [];

  // 5) Opslaan.
  await saveOcpiRegistration({
    our_token_b: ourTokenB,
    cpo_token_c: tokenC,
    cpo_party_id: cpoRole?.party_id ?? null,
    cpo_country_code: cpoRole?.country_code ?? null,
    cpo_endpoints: cpoEndpoints,
    ocpi_version: chosen.version,
    registered_at: nowIso(),
  });

  return { version: chosen.version, cpoPartyId: cpoRole?.party_id ?? null, endpoints: cpoEndpoints.length };
};

// ============================================================================
// Stap 3 — type-veilige OCPI-client (Sender-kant pollen met Token C).
// Velden volgen de OCPI 2.2.1-spec; [k: string]: unknown houdt de rest open
// (de sync bewaart het volledige object als `raw`).
// ============================================================================

export type OcpiGeoLocation = { latitude: string; longitude: string };
export type OcpiPrice = { excl_vat?: number; incl_vat?: number };

export interface OcpiConnector {
  id: string;
  standard?: string;
  format?: string;
  power_type?: string;
  max_voltage?: number;
  max_amperage?: number;
  max_electric_power?: number;
  last_updated?: string;
  [k: string]: unknown;
}
export interface OcpiEvse {
  uid: string;
  evse_id?: string;
  status?: string;
  physical_reference?: string;
  connectors?: OcpiConnector[];
  last_updated?: string;
  [k: string]: unknown;
}
export interface OcpiLocation {
  country_code: string;
  party_id: string;
  id: string;
  name?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  coordinates?: OcpiGeoLocation;
  time_zone?: string;
  publish?: boolean;
  evses?: OcpiEvse[];
  last_updated?: string;
  [k: string]: unknown;
}
export interface OcpiSession {
  country_code: string;
  party_id: string;
  id: string;
  status?: string;
  start_date_time?: string;
  end_date_time?: string;
  kwh?: number;
  currency?: string;
  total_cost?: OcpiPrice;
  location_id?: string;
  evse_uid?: string;
  connector_id?: string;
  auth_method?: string;
  last_updated?: string;
  [k: string]: unknown;
}
export interface OcpiCdr {
  country_code: string;
  party_id: string;
  id: string;
  session_id?: string;
  start_date_time?: string;
  end_date_time?: string;
  total_energy?: number;
  total_time?: number;
  total_cost?: OcpiPrice;
  currency?: string;
  auth_method?: string;
  cdr_location?: { evse_uid?: string; connector_id?: string; [k: string]: unknown };
  last_updated?: string;
  [k: string]: unknown;
}

/** Parseer de OCPI-paginatie: de URL bij rel="next" in de Link-header. */
export const parseNextLink = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(part.trim());
    if (m) return m[1];
  }
  return null;
};

const withParams = (url: string, params: Record<string, string | undefined>): string => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") u.searchParams.set(k, v);
  }
  if (!u.searchParams.has("limit")) u.searchParams.set("limit", "100");
  return u.toString();
};

/** GET alle pagina's: volgt de Link-header (rel="next") tot er geen meer is. */
const ocpiGetAll = async <T>(startUrl: string, token: string): Promise<T[]> => {
  const items: T[] = [];
  let url: string | null = startUrl;
  let guard = 0;
  while (url && guard++ < 500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: authHeader(token), Accept: "application/json" }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) throw new OcpiError(`OCPI HTTP ${res.status} bij ${url}: ${text.slice(0, 200)}`);
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* niet-JSON */ }
    if (json && typeof json.status_code === "number" && json.status_code !== 1000) {
      throw new OcpiError(`OCPI status ${json.status_code} (${json.status_message ?? "?"}) bij ${url}`);
    }
    if (Array.isArray(json?.data)) items.push(...(json.data as T[]));
    url = parseNextLink(res.headers.get("Link") ?? res.headers.get("link"));
  }
  return items;
};

const requireRegistration = async (): Promise<OcpiRegistration> => {
  const reg = await getOcpiRegistration();
  if (!reg?.cpo_token_c) {
    throw new Error("OCPI: nog niet geregistreerd (geen Token C). Voer eerst de handshake uit.");
  }
  return reg;
};

/** Zoek de Sender-endpoint-URL van de CPO voor een module (locations/sessions/cdrs). */
const resolveSenderEndpoint = (reg: OcpiRegistration, identifier: string): string | null => {
  const eps = reg.cpo_endpoints ?? [];
  const sender = eps.find((e) => e.identifier === identifier && (e.role ?? "").toUpperCase() === "SENDER");
  return (sender ?? eps.find((e) => e.identifier === identifier))?.url ?? null;
};

export const fetchLocations = async (): Promise<OcpiLocation[]> => {
  const reg = await requireRegistration();
  const url = resolveSenderEndpoint(reg, "locations");
  if (!url) throw new Error("OCPI: geen 'locations' Sender-endpoint bij de CPO.");
  return ocpiGetAll<OcpiLocation>(withParams(url, {}), reg.cpo_token_c!);
};

export const fetchSessions = async (opts: { dateFrom?: string; dateTo?: string } = {}): Promise<OcpiSession[]> => {
  const reg = await requireRegistration();
  const url = resolveSenderEndpoint(reg, "sessions");
  if (!url) throw new Error("OCPI: geen 'sessions' Sender-endpoint bij de CPO.");
  return ocpiGetAll<OcpiSession>(withParams(url, { date_from: opts.dateFrom, date_to: opts.dateTo }), reg.cpo_token_c!);
};

export const fetchCdrs = async (opts: { dateFrom?: string; dateTo?: string } = {}): Promise<OcpiCdr[]> => {
  const reg = await requireRegistration();
  const url = resolveSenderEndpoint(reg, "cdrs");
  if (!url) throw new Error("OCPI: geen 'cdrs' Sender-endpoint bij de CPO.");
  return ocpiGetAll<OcpiCdr>(withParams(url, { date_from: opts.dateFrom, date_to: opts.dateTo }), reg.cpo_token_c!);
};

// ============================================================================
// Stap 4 — sync-laag: client → upsert naar Supabase. Per-module foutafhandeling
// zodat één fout de rest niet meesleurt; idempotent via upsert op de PK's.
// ============================================================================

export type OcpiSyncSummary = {
  locations: number;
  evses: number;
  connectors: number;
  sessions: number;
  cdrs: number;
  errors: string[];
};

const toTs = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const toNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Upsert in brokken (PostgREST/payload-veilig); idempotent op de opgegeven PK.
const upsertChunked = async (table: string, rows: any[], onConflict: string): Promise<number> => {
  if (!db || rows.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    written += chunk.length;
  }
  return written;
};

const syncLocations = async (summary: OcpiSyncSummary): Promise<void> => {
  const locations = await fetchLocations();
  const locRows: any[] = [];
  const evseRows: any[] = [];
  const connRows: any[] = [];
  for (const loc of locations) {
    try {
      locRows.push({
        country_code: loc.country_code, party_id: loc.party_id, id: loc.id,
        name: loc.name ?? null, address: loc.address ?? null, city: loc.city ?? null,
        postal_code: loc.postal_code ?? null, country: loc.country ?? null,
        latitude: loc.coordinates?.latitude ?? null, longitude: loc.coordinates?.longitude ?? null,
        time_zone: loc.time_zone ?? null, publish: typeof loc.publish === "boolean" ? loc.publish : null,
        last_updated: toTs(loc.last_updated), raw: loc, synced_at: nowIso(),
      });
      for (const evse of loc.evses ?? []) {
        evseRows.push({
          uid: evse.uid, evse_id: evse.evse_id ?? null,
          location_country_code: loc.country_code, location_party_id: loc.party_id, location_id: loc.id,
          status: evse.status ?? null, physical_reference: evse.physical_reference ?? null,
          last_updated: toTs(evse.last_updated), raw: evse, synced_at: nowIso(),
        });
        for (const conn of evse.connectors ?? []) {
          connRows.push({
            evse_uid: evse.uid, id: conn.id, standard: conn.standard ?? null, format: conn.format ?? null,
            power_type: conn.power_type ?? null, max_voltage: toNum(conn.max_voltage), max_amperage: toNum(conn.max_amperage),
            max_electric_power: toNum(conn.max_electric_power), last_updated: toTs(conn.last_updated), raw: conn, synced_at: nowIso(),
          });
        }
      }
    } catch (e: any) {
      summary.errors.push(`location ${loc?.id}: ${e?.message ?? e}`);
    }
  }
  summary.locations += await upsertChunked("ocpi_locations", locRows, "country_code,party_id,id");
  summary.evses += await upsertChunked("ocpi_evses", evseRows, "uid");
  summary.connectors += await upsertChunked("ocpi_connectors", connRows, "evse_uid,id");
};

const syncSessions = async (summary: OcpiSyncSummary, opts: { dateFrom?: string } = {}): Promise<void> => {
  const dateFrom = opts.dateFrom ?? new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const sessions = await fetchSessions({ dateFrom });
  const rows = sessions.map((s) => ({
    country_code: s.country_code, party_id: s.party_id, id: s.id, status: s.status ?? null,
    start_date_time: toTs(s.start_date_time), end_date_time: toTs(s.end_date_time),
    kwh: toNum(s.kwh), currency: s.currency ?? null,
    total_cost_excl_vat: toNum(s.total_cost?.excl_vat), total_cost_incl_vat: toNum(s.total_cost?.incl_vat),
    location_id: s.location_id ?? null, evse_uid: s.evse_uid ?? null, connector_id: s.connector_id ?? null,
    auth_method: s.auth_method ?? null, last_updated: toTs(s.last_updated), raw: s, synced_at: nowIso(),
  }));
  summary.sessions += await upsertChunked("ocpi_sessions", rows, "country_code,party_id,id");
};

const syncCdrs = async (summary: OcpiSyncSummary, opts: { dateFrom?: string } = {}): Promise<void> => {
  const dateFrom = opts.dateFrom ?? new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString();
  const cdrs = await fetchCdrs({ dateFrom });
  const rows = cdrs.map((c) => {
    const loc = (c.cdr_location ?? {}) as { id?: string; evse_uid?: string; connector_id?: string };
    return {
      country_code: c.country_code, party_id: c.party_id, id: c.id, session_id: c.session_id ?? null,
      start_date_time: toTs(c.start_date_time), end_date_time: toTs(c.end_date_time),
      total_energy: toNum(c.total_energy), total_time: toNum(c.total_time),
      total_cost_excl_vat: toNum(c.total_cost?.excl_vat), total_cost_incl_vat: toNum(c.total_cost?.incl_vat),
      currency: c.currency ?? null, auth_method: c.auth_method ?? null,
      location_id: loc.id ?? null, evse_uid: loc.evse_uid ?? null, connector_id: loc.connector_id ?? null,
      last_updated: toTs(c.last_updated), raw: c, synced_at: nowIso(),
    };
  });
  summary.cdrs += await upsertChunked("ocpi_cdrs", rows, "country_code,party_id,id");
};

/**
 * Draai de OCPI-sync. Elke module heeft eigen foutafhandeling: een fout (bv. een
 * onbereikbare pal of een DB-hapering) wordt in `errors` gezet maar laat de
 * andere modules gewoon doorlopen. Niet-geregistreerd → vroege, nette return.
 */
export const runOcpiSync = async (
  parts: { locations?: boolean; sessions?: boolean; cdrs?: boolean } = { locations: true, sessions: true, cdrs: true },
): Promise<OcpiSyncSummary> => {
  const summary: OcpiSyncSummary = { locations: 0, evses: 0, connectors: 0, sessions: 0, cdrs: 0, errors: [] };
  const reg = await getOcpiRegistration();
  if (!reg?.cpo_token_c) {
    summary.errors.push("OCPI nog niet geregistreerd (geen Token C).");
    return summary;
  }
  if (parts.locations) {
    try { await syncLocations(summary); } catch (e: any) { summary.errors.push(`locations: ${e?.message ?? e}`); }
  }
  if (parts.sessions) {
    try { await syncSessions(summary); } catch (e: any) { summary.errors.push(`sessions: ${e?.message ?? e}`); }
  }
  if (parts.cdrs) {
    try { await syncCdrs(summary); } catch (e: any) { summary.errors.push(`cdrs: ${e?.message ?? e}`); }
  }
  return summary;
};

// ---- Auth voor ÓNZE gehoste OCPI-endpoints ----
// Geldig is: Token A (tijdens registratie) of onze Token B (daarna). De CPO
// stuurt 'Token <base64>'; we vergelijken zowel base64 als plain (2.1.1).
const presentedToken = (req: express.Request): string | null => {
  const m = /^Token\s+(.+)$/i.exec(String(req.headers.authorization || "").trim());
  return m ? m[1].trim() : null;
};
const ocpiAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const presented = presentedToken(req);
  if (!presented) return res.status(401).json(ocpiError(2001, "Ontbrekende of ongeldige Authorization-header."));
  const reg = await getOcpiRegistration();
  const valid = [TOKEN_A, reg?.our_token_b].filter(Boolean) as string[];
  const ok = valid.some((t) => safeEqual(presented, b64(t)) || safeEqual(presented, t));
  if (!ok) return res.status(401).json(ocpiError(2001, "Ongeldig OCPI-token."));
  next();
};

/** Mount alle OCPI-routes op de bestaande Express-app. */
export const mountOcpiRoutes = (app: express.Express) => {
  // --- Door ons gehoste endpoints (de CPO bevraagt deze tijdens de handshake) ---

  // Versions: lijst van door ons ondersteunde OCPI-versies.
  app.get("/api/ocpi/versions", ocpiAuth, (_req, res) => {
    res.json(ocpiEnvelope([{ version: "2.2.1", url: `${OUR_OCPI_BASE}/2.2.1` }]));
  });

  // Version-details: welke modules wij hosten. Als pull-only eMSP volstaat
  // 'credentials' (we pollen zelf locations/sessions/cdrs bij de CPO).
  app.get("/api/ocpi/2.2.1", ocpiAuth, (_req, res) => {
    res.json(ocpiEnvelope({
      version: "2.2.1",
      endpoints: [
        { identifier: "credentials", role: "RECEIVER", url: `${OUR_OCPI_BASE}/2.2.1/credentials` },
      ],
    }));
  });

  // Credentials-endpoint: stelt de CPO in staat óns te registreren / zijn
  // credentials naar ons te sturen. We bewaren zijn token (Token C) + endpoints
  // en antwoorden met ons eigen credentials-object (onze Token B).
  app.post("/api/ocpi/2.2.1/credentials", ocpiAuth, async (req, res) => {
    try {
      const incoming = req.body ?? {};
      const cpoToken: string | undefined = incoming?.token;
      const cpoVersionsUrl: string | undefined = incoming?.url;
      const cpoRole = Array.isArray(incoming?.roles) ? incoming.roles[0] : undefined;

      let cpoEndpoints: Array<{ identifier: string; role?: string; url: string }> = [];
      // SSRF-guard: alleen een publieke https-URL ophalen (de url komt uit een
      // extern credentials-object). Faalt de guard, dan slaan we het token toch
      // op maar halen we de endpoints niet blind op.
      if (cpoToken && cpoVersionsUrl && isSafeExternalHttpsUrl(cpoVersionsUrl)) {
        // Hun version-details ophalen met hun token om de Sender-endpoints te leren.
        try {
          const versions = await ocpiFetch(cpoVersionsUrl, cpoToken);
          const v = (versions?.data ?? []).find((x: any) => String(x.version).startsWith("2.2"));
          if (v && typeof v.url === "string" && isSafeExternalHttpsUrl(v.url)) {
            const details = await ocpiFetch(v.url, cpoToken);
            cpoEndpoints = details?.data?.endpoints ?? [];
          }
        } catch { /* best-effort; we slaan minstens het token op */ }
      }

      const existing = await getOcpiRegistration();
      const ourTokenB = existing?.our_token_b ?? randomToken();
      await saveOcpiRegistration({
        our_token_b: ourTokenB,
        cpo_token_c: cpoToken ?? existing?.cpo_token_c ?? null,
        cpo_party_id: cpoRole?.party_id ?? existing?.cpo_party_id ?? null,
        cpo_country_code: cpoRole?.country_code ?? existing?.cpo_country_code ?? null,
        cpo_endpoints: cpoEndpoints.length ? cpoEndpoints : existing?.cpo_endpoints ?? null,
        ocpi_version: "2.2.1",
        registered_at: nowIso(),
      });

      res.json(ocpiEnvelope({
        token: ourTokenB,
        url: OUR_VERSIONS_URL,
        roles: [{ role: "EMSP", party_id: PARTY_ID, country_code: COUNTRY_CODE, business_details: { name: OUR_BUSINESS_NAME } }],
      }));
    } catch (err: any) {
      res.status(500).json(ocpiError(3000, `Credentials verwerken mislukt: ${err?.message ?? err}`));
    }
  });

  // --- Beheer: de uitgaande handshake starten (admin) ---
  app.post("/api/ocpi/register", authenticate, requireRole("admin"), async (_req: AuthenticatedRequest, res) => {
    try {
      const result = await registerWithCpo();
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[ocpi] registratie mislukt:", err?.message ?? err);
      res.status(502).json({ error: "OCPI-registratie mislukt", details: err?.message ?? String(err) });
    }
  });

  // Beheer: huidige registratiestatus (zonder de geheime tokens prijs te geven).
  app.get("/api/ocpi/status", authenticate, requireRole("admin"), async (_req: AuthenticatedRequest, res) => {
    const reg = await getOcpiRegistration();
    res.json({
      registered: Boolean(reg?.cpo_token_c),
      ocpiVersion: reg?.ocpi_version ?? null,
      cpoPartyId: reg?.cpo_party_id ?? null,
      cpoCountryCode: reg?.cpo_country_code ?? null,
      endpoints: (reg?.cpo_endpoints ?? []).map((e) => ({ identifier: e.identifier, role: e.role ?? null })),
      registeredAt: reg?.registered_at ?? null,
      configured: Boolean(CPO_VERSIONS_URL && TOKEN_A && PUBLIC_BASE),
    });
  });

  // Beheer: handmatig synchroniseren (knop in de OCPI-kaart). Standaard alles.
  app.post("/api/ocpi/sync", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const body = (req.body ?? {}) as { locations?: boolean; sessions?: boolean; cdrs?: boolean };
      const parts = (body.locations || body.sessions || body.cdrs)
        ? body
        : { locations: true, sessions: true, cdrs: true };
      const summary = await runOcpiSync(parts);
      res.json({ success: summary.errors.length === 0, ...summary });
    } catch (err: any) {
      console.error("[ocpi] sync mislukt:", err?.message ?? err);
      res.status(500).json({ error: "OCPI-sync mislukt", details: err?.message ?? String(err) });
    }
  });

  // Cron-route (Vercel stuurt Authorization: Bearer ${CRON_SECRET} mee).
  // ?parts=locations|sessions|cdrs|all bepaalt wat er gesynct wordt, zodat
  // verschillende schema's verschillende frequenties kunnen hebben.
  app.get("/api/cron/ocpi-sync", async (req, res) => {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Niet toegestaan." });
    }
    const which = String(req.query.parts ?? "all");
    const parts = which === "all"
      ? { locations: true, sessions: true, cdrs: true }
      : { locations: which === "locations", sessions: which === "sessions", cdrs: which === "cdrs" };
    try {
      const summary = await runOcpiSync(parts);
      if (summary.errors.length) console.warn(`[cron-ocpi:${which}] ${summary.errors.length} fout(en):`, summary.errors.join(" | "));
      else {
        console.log(`[cron-ocpi:${which}] ok`, summary);
        // Heartbeat gethrotteld (max 1/uur): deze cron draait elke 2-5 min
        // en zou anders het activiteitenlog vol schrijven.
        await logCronHeartbeat("ocpi-sync", `Sync ok (${which}).`, 60);
      }
      res.json({ success: summary.errors.length === 0, ...summary });
    } catch (err: any) {
      console.error(`[cron-ocpi:${which}] mislukt:`, err?.message ?? err);
      res.status(500).json({ error: "OCPI-sync mislukt", details: err?.message ?? String(err) });
    }
  });

  // Dashboard-data (stap 5): leest de gesynchroniseerde OCPI-tabellen (service-role)
  // en levert een kant-en-klare payload voor de monitoring-view.
  app.get("/api/ocpi/dashboard", authenticate, requireRole("admin"), async (_req: AuthenticatedRequest, res) => {
    if (!db) return res.status(500).json({ error: "Database niet geconfigureerd." });
    try {
      const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const [locsR, evsesR, connsR, sessR, cdrsR] = await Promise.all([
        db.from("ocpi_locations").select("country_code,party_id,id,name,city").order("name", { ascending: true }),
        db.from("ocpi_evses").select("uid,evse_id,status,location_id"),
        db.from("ocpi_connectors").select("evse_uid,id,standard,power_type,max_electric_power"),
        db.from("ocpi_sessions").select("id,evse_uid,location_id,status,start_date_time,kwh").eq("status", "ACTIVE").order("start_date_time", { ascending: false }),
        db.from("ocpi_cdrs").select("start_date_time,total_energy").gte("start_date_time", since30),
      ]);

      const locRows = (locsR.data ?? []) as any[];
      const evseRows = (evsesR.data ?? []) as any[];
      const connRows = (connsR.data ?? []) as any[];
      const activeSessions = (sessR.data ?? []) as any[];
      const cdrRows = (cdrsR.data ?? []) as any[];

      // Connectors groeperen per EVSE.
      const connByEvse = new Map<string, any[]>();
      for (const c of connRows) {
        const list = connByEvse.get(c.evse_uid) ?? [];
        list.push({ id: c.id, standard: c.standard, power_type: c.power_type, max_electric_power: c.max_electric_power });
        connByEvse.set(c.evse_uid, list);
      }
      // EVSEs groeperen per locatie + statustelling.
      const evsesByLoc = new Map<string, any[]>();
      const statusCounts: Record<string, number> = {};
      for (const e of evseRows) {
        const st = e.status ?? "UNKNOWN";
        statusCounts[st] = (statusCounts[st] ?? 0) + 1;
        const list = evsesByLoc.get(e.location_id) ?? [];
        list.push({ uid: e.uid, evse_id: e.evse_id, status: e.status, connectors: connByEvse.get(e.uid) ?? [] });
        evsesByLoc.set(e.location_id, list);
      }
      const locations = locRows.map((l) => ({
        id: l.id, name: l.name, city: l.city, evses: evsesByLoc.get(l.id) ?? [],
      }));

      // kWh per dag (laatste 30d aanwezig in CDR's).
      const perDay = new Map<string, { kwh: number; sessions: number }>();
      for (const c of cdrRows) {
        const d = String(c.start_date_time ?? "").slice(0, 10);
        if (!d) continue;
        const cur = perDay.get(d) ?? { kwh: 0, sessions: 0 };
        cur.kwh += Number(c.total_energy) || 0;
        cur.sessions += 1;
        perDay.set(d, cur);
      }
      const kwhPerDay = [...perDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, kwh: Math.round(v.kwh * 10) / 10, sessions: v.sessions }));
      const kwh30d = Math.round([...perDay.values()].reduce((a, v) => a + v.kwh, 0) * 10) / 10;

      res.json({
        totals: {
          locations: locRows.length,
          evses: evseRows.length,
          connectors: connRows.length,
          activeSessions: activeSessions.length,
          cdrs30d: cdrRows.length,
          kwh30d,
        },
        statusCounts,
        locations,
        activeSessions,
        kwhPerDay,
      });
    } catch (err: any) {
      console.error("[ocpi] dashboard mislukt:", err?.message ?? err);
      res.status(500).json({ error: "OCPI-dashboard mislukt", details: err?.message ?? String(err) });
    }
  });
};
