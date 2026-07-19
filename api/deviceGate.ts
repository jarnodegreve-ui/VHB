import type { Role } from "./types.js";

// --- Toestel-whitelist: pure beslissingslogica (zie supabase/user_devices.sql
// + api/middleware.ts voor de wiring) ---
// Bewust een eigen module zónder db/express-afhankelijkheden, zodat de gate-
// logica los te unit-testen is (src/deviceGate.test.ts).

// Bereikbaar vanaf een niet-goedgekeurd toestel: de registratie zelf en de
// sessie-boekhouding bij login/logout.
export const DEVICE_GATE_EXEMPT = new Set(["/api/devices/register", "/api/auth/session"]);

export type DeviceGateVerdict = {
  allow: boolean;
  status?: number;
  body?: { error: string; code: string };
};

/**
 * Herkent de fout "de user_devices-tabel bestaat nog niet" (migratie niet
 * gedraaid). Alléén dan mag de gate fail-open; elke andere DB-fout is
 * fail-closed. Postgres: 42P01 (undefined_table); PostgREST: PGRST205
 * (schema-cache kent de tabel niet).
 */
export const isMissingTableError = (err: unknown): boolean => {
  const code = String((err as { code?: unknown })?.code ?? "");
  const msg = String((err as { message?: unknown })?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .* does not exist/.test(msg) ||
    /could not find the table/.test(msg)
  );
};

/** Pure beslissingsfunctie: mag deze (rol, pad, toestel) door de gate? */
export const evaluateDeviceGate = (
  role: Role,
  path: string,
  device: { status: string } | null,
): DeviceGateVerdict => {
  if (role !== "chauffeur") return { allow: true };
  if (DEVICE_GATE_EXEMPT.has(path)) return { allow: true };
  if (!device) {
    return {
      allow: false,
      status: 403,
      body: { error: "Dit toestel is niet geregistreerd voor dit account.", code: "device_unknown" },
    };
  }
  if (device.status === "approved") return { allow: true };
  if (device.status === "revoked") {
    return {
      allow: false,
      status: 403,
      body: { error: "Dit toestel is geblokkeerd voor dit account.", code: "device_revoked" },
    };
  }
  return {
    allow: false,
    status: 403,
    body: { error: "Dit toestel wacht op goedkeuring door de planning.", code: "device_pending" },
  };
};
