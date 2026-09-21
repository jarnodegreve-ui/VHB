import { db } from "../../db.js";
import type { RapportMedewerker } from "./personeel.js";

/**
 * De medewerkers voor een rapport. Bewust een eigen query met een expliciete
 * kolomlijst in plaats van `getUsersData()` (select *): een rapport heeft geen
 * wachtwoord-, auth- of sessievelden nodig, dus ze worden ook niet gelezen.
 * src/rapportPersoneel.test.ts bewaakt de lijst.
 */
export const RAPPORT_MEDEWERKER_KOLOMMEN = "id, name, role, phone, email, employeeid, section, startdate, isactive, showincontacts";

export const naarRapportMedewerker = (r: Record<string, unknown>): RapportMedewerker => ({
  id: String(r.id),
  name: String(r.name ?? ""),
  role: String(r.role ?? ""),
  phone: (r.phone as string | null) ?? null,
  email: (r.email as string | null) ?? null,
  employeeId: (r.employeeid as string | null) ?? null,
  section: (r.section as string | null) ?? null,
  startDate: (r.startdate as string | null) ?? null,
  isActive: r.isactive !== false,
  showInContacts: r.showincontacts !== false,
});

export const getRapportMedewerkers = async (): Promise<RapportMedewerker[]> => {
  if (!db) throw new Error("Supabase is niet geconfigureerd. Stel SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in als env vars.");
  const { data, error } = await db.from("users").select(RAPPORT_MEDEWERKER_KOLOMMEN).order("id", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(naarRapportMedewerker);
};
