import { toDatabaseService, toPublicService } from "../../helpers.js";
import { verwijderInStukken } from "./activiteit.js";
import { paginatedFetch, requireDb } from "./basis.js";

// --- Services ---

export const getServicesData = async () => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('services').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicService);
};

export const saveServicesData = async (data: any) => {
  const client = requireDb();
  const normalized = Array.isArray(data) ? data.map(toPublicService) : [];
  const rows = normalized.map(toDatabaseService);
  // Replace-semantiek zónder leeg-tabel-venster: eerst upserten, daarna pas
  // de ontbrekende rijen verwijderen. Het oude delete-alles-dan-insert kon
  // bij een insert-fout (netwerk/constraint/timeout) een lege dienstentabel
  // achterlaten — en daarmee elke volgende matrix-import breken.
  const incomingIds = new Set(rows.map((r: any) => String(r.id)));
  const existing = await paginatedFetch((from, to) =>
    client.from('services').select('id').order('id', { ascending: true }).range(from, to),
  );
  if (rows.length > 0) {
    const { error: upsertError } = await client.from('services').upsert(rows);
    if (upsertError) throw upsertError;
  }
  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));
  await verwijderInStukken(client, 'services', 'id', idsToDelete);
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
