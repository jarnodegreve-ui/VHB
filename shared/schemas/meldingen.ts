import { z } from './zod.js';
import { optioneel } from './basis.js';

/**
 * Meldingencentrum (next-level 2, 06-09-2026): de soorten die de filterchips
 * kennen en de body van POST /api/meldingen/gelezen. Eén bron voor server
 * (validatie) en client (chips, type).
 */
// De soorten en labels wonen zod-vrij in shared/meldingSoorten.ts (de
// startschermen hebben ze nodig zonder zod); hier doorgeëxporteerd zodat
// bestaande imports, ook die van `api/`, gelijk blijven.
import { MELDING_SOORTEN, MELDING_SOORT_LABEL, type MeldingSoort } from '../meldingSoorten.js';
export { MELDING_SOORTEN, MELDING_SOORT_LABEL, type MeldingSoort };

export const meldingSoortSchema = z.enum(MELDING_SOORTEN);

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
