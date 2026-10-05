import type { MeldingRecord } from "../../types.js";
import type { MeldingInvoer } from "../meldingen.js";
import { requireDb } from "./basis.js";

// --- Meldingen (meldingencentrum, 2026-09-06_meldingen.sql) ---

const toPublicMelding = (row: any): MeldingRecord => ({
  id: String(row.id),
  titel: String(row.titel ?? ""),
  tekst: row.tekst ? String(row.tekst) : undefined,
  soort: row.soort,
  doel: row.doel ? String(row.doel) : undefined,
  createdAt: String(row.created_at ?? ""),
  gelezenOp: row.gelezen_op ? String(row.gelezen_op) : undefined,
});

/** Eén melding per ontvanger bewaren. Gooit door (de push-laag vangt het:
 *  een ontbrekende tabel mag een verlofbeslissing niet laten falen). */
export const bewaarMeldingen = async (userIds: string[], melding: MeldingInvoer): Promise<number> => {
  const ontvangers = [...new Set(userIds.map(String).filter(Boolean))];
  if (ontvangers.length === 0) return 0;
  const client = requireDb();
  const rijen = ontvangers.map((userId) => ({
    user_id: userId,
    titel: melding.titel,
    tekst: melding.tekst,
    soort: melding.soort,
    doel: melding.doel,
  }));
  const { error } = await client.from('meldingen').insert(rijen);
  if (error) throw error;
  return rijen.length;
};

/** Eigen meldingen, nieuwste eerst, hooguit `max` (de app toont er 100). */
export const getMeldingen = async (userId: string, max = 100): Promise<MeldingRecord[]> => {
  const client = requireDb();
  const { data, error } = await client
    .from('meldingen')
    .select('id, titel, tekst, soort, doel, created_at, gelezen_op')
    .eq('user_id', String(userId))
    .order('created_at', { ascending: false })
    .limit(max);
  if (error) throw error;
  return (data ?? []).map(toPublicMelding);
};

/** Aantal ongelezen meldingen van een gebruiker (over álle rijen, niet
 *  alleen de getoonde 100 — de badge moet kloppen). */
export const telOngelezenMeldingen = async (userId: string): Promise<number> => {
  const client = requireDb();
  const { count, error } = await client
    .from('meldingen')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', String(userId))
    .is('gelezen_op', null);
  if (error) throw error;
  return count ?? 0;
};

/** Gelezen markeren: de gegeven ids (alleen eigen rijen) of, zonder ids,
 *  alles wat nog ongelezen is. Geeft het aantal bijgewerkte rijen. */
export const markeerMeldingenGelezen = async (userId: string, ids?: string[]): Promise<number> => {
  const client = requireDb();
  let q = client
    .from('meldingen')
    .update({ gelezen_op: new Date().toISOString() }, { count: 'exact' })
    .eq('user_id', String(userId))
    .is('gelezen_op', null);
  if (ids && ids.length > 0) q = q.in('id', ids.map(String));
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
};

/** Verwijderen: alleen eigen rijen (user_id in de query, dus andermans ids
 *  doen niets). Geeft het aantal verwijderde rijen. */
export const verwijderMeldingen = async (userId: string, ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const client = requireDb();
  const { count, error } = await client
    .from('meldingen')
    .delete({ count: 'exact' })
    .eq('user_id', String(userId))
    .in('id', ids.map(String));
  if (error) throw error;
  return count ?? 0;
};
