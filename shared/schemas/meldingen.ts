import { z } from 'zod';
import { optioneel } from './basis.js';

/**
 * Meldingencentrum (next-level 2, 06-09-2026): de soorten die de filterchips
 * kennen en de body van POST /api/meldingen/gelezen. Eén bron voor server
 * (validatie) en client (chips, type).
 */
export const MELDING_SOORTEN = ['planning', 'verlof', 'ruil', 'update', 'omleiding', 'document', 'systeem'] as const;
export type MeldingSoort = (typeof MELDING_SOORTEN)[number];

export const meldingSoortSchema = z.enum(MELDING_SOORTEN);

/** Label per soort — chips in de app en de melding-rij. */
export const MELDING_SOORT_LABEL: Record<MeldingSoort, string> = {
  planning: 'Planning',
  verlof: 'Verlof',
  ruil: 'Dienstruil',
  update: 'Updates',
  omleiding: 'Omleidingen',
  document: 'Documenten',
  systeem: 'Systeem',
};

/** Alles gelezen = geen ids; anders de gegeven ids (eigen rijen, server-side gescoped). */
export const meldingenGelezenBodySchema = z.object({
  ids: optioneel(z.array(z.string().trim().min(1).max(64)).max(500)),
});

/** Eén melding zoals GET /api/meldingen ze teruggeeft. */
export const meldingSchema = z.object({
  id: z.string(),
  titel: z.string(),
  tekst: optioneel(z.string()),
  soort: meldingSoortSchema,
  doel: optioneel(z.string()),
  createdAt: z.string(),
  gelezenOp: optioneel(z.string()),
});
export type Melding = z.output<typeof meldingSchema>;
