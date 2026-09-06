import { z } from 'zod';

/**
 * Dashboardvoorkeuren — "Dashboard aanpassen" (next-level 2, 06-09-2026):
 * welke tegels een gebruiker verbergt en in welke volgorde hij ze wil.
 * Opgeslagen als jsonb in users.dashboardvoorkeuren, gelezen via /api/me,
 * geschreven via PATCH /api/me/voorkeuren. Eén schema valideert de body
 * server-side én normaliseert wat uit de database of localStorage komt.
 *
 * Tegel-ids zijn korte kebab-case-woorden (bv. 'vandaag', 'open-taken');
 * de catalogus per rol staat client-side (src/lib/dashboardVoorkeuren.ts).
 * Onbekende ids zijn geen fout — de client negeert ze — zodat een tegel die
 * verdwijnt of hernoemt geen opgeslagen voorkeur ongeldig maakt.
 */
const tegelId = z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, 'Ongeldig tegel-id');

export const dashboardVoorkeurenSchema = z.object({
  /** Tegels die de gebruiker verbergt (essentiële tegels negeren dit). */
  verborgen: z.array(tegelId).max(50).default([]),
  /** Gewenste volgorde; ids die ontbreken volgen erna in de standaardvolgorde. */
  volgorde: z.array(tegelId).max(50).default([]),
});

export type DashboardVoorkeuren = z.output<typeof dashboardVoorkeurenSchema>;

/** Body van PATCH /api/me/voorkeuren. */
export const meVoorkeurenBodySchema = z.object({ dashboard: dashboardVoorkeurenSchema });

export const LEGE_DASHBOARD_VOORKEUREN: DashboardVoorkeuren = { verborgen: [], volgorde: [] };

/** Onbekende invoer (db-jsonb, localStorage) → geldige voorkeuren of null. */
export const parseDashboardVoorkeuren = (waarde: unknown): DashboardVoorkeuren | null => {
  const r = dashboardVoorkeurenSchema.safeParse(waarde);
  return r.success ? r.data : null;
};
