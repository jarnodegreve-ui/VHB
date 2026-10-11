import { isMissingTableError } from "../../deviceGate.js";
import type { DagtypeKalenderDag } from "../../../shared/dagtypeKalender.js";
import { isEchteIsoDag, paginatedFetch, requireDb } from "./basis.js";

/**
 * Dagtypekalender (11-10): public.dagtype_kalender, één rij per datum met het
 * De Lijn-dagtype en het verlofmaximum (migratie
 * supabase/2026-10-11_dagtype_kalender.sql). Zonder tabel (migratie nog niet
 * gedraaid) leest alles leeg: het portaal valt dan terug op de planningsmatrix
 * en de dekkingsafleiding, zoals vóór 11-10.
 */
export const DAGTYPE_KALENDER_MIGRATIE = "supabase/2026-10-11_dagtype_kalender.sql";

export type DagtypeKalenderRij = DagtypeKalenderDag & { bron: string; updatedAt: string };

const toPublic = (r: any): DagtypeKalenderRij => ({
  datum: String(r.datum ?? "").slice(0, 10),
  typedag: String(r.typedag ?? ""),
  maxVerlof: r.max_verlof === null || r.max_verlof === undefined ? null : Number(r.max_verlof),
  bron: String(r.bron ?? ""),
  updatedAt: String(r.updated_at ?? ""),
});

/** Alle dagen, oplopend; met `van`/`tot` (echte ISO-dagen) alleen dat venster. */
export const getDagtypeKalender = async (opts?: { van?: string; tot?: string }): Promise<DagtypeKalenderRij[]> => {
  const client = requireDb();
  try {
    const rows = await paginatedFetch((from, to) => {
      let q = client.from("dagtype_kalender").select("*").order("datum", { ascending: true });
      if (opts?.van && isEchteIsoDag(opts.van)) q = q.gte("datum", opts.van);
      if (opts?.tot && isEchteIsoDag(opts.tot)) q = q.lte("datum", opts.tot);
      return q.range(from, to);
    });
    return rows.map(toPublic);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
};

/** Upsert op datum: de aangeleverde dagen vervangen hun datum, andere dagen blijven. Geeft het aantal geschreven rijen. */
export const schrijfDagtypeKalender = async (dagen: readonly DagtypeKalenderDag[], bron: "csv" | "hand"): Promise<number> => {
  const client = requireDb();
  const rows = dagen.map((d) => ({ datum: d.datum, typedag: d.typedag, max_verlof: d.maxVerlof, bron, updated_at: new Date().toISOString() }));
  for (let n = 0; n < rows.length; n += 500) {
    const { error } = await client.from("dagtype_kalender").upsert(rows.slice(n, n + 500), { onConflict: "datum" });
    if (error) throw error;
  }
  return rows.length;
};
