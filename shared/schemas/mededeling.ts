import { z } from './zod.js';
import { isoDatum, optioneel } from './basis.js';
import { MEDEDELING_TEKST_MAX } from '../mededeling.js';

/**
 * Mededeling voor de chauffeurs (08-10): de body van PUT /api/mededeling
 * (admin) en het formulier op Ritbladen. De zod-vrije lezer en de regel
 * "zichtbaar" staan in shared/mededeling.ts.
 */
export const mededelingSchema = z.object({
  tekst: z.string({ error: 'Vul een tekst in' }).trim().max(MEDEDELING_TEKST_MAX, `Hoogstens ${MEDEDELING_TEKST_MAX} tekens`).default(''),
  tonen: z.boolean({ error: 'Kies aan of uit' }).default(false),
  /** Laatste dag waarop de mededeling nog getoond wordt (JJJJ-MM-DD). */
  tot: optioneel(isoDatum('Kies een geldige dag')),
}).refine((m) => !m.tonen || m.tekst.length > 0, { message: 'Vul een tekst in om de mededeling te tonen', path: ['tekst'] });

export type MededelingBody = z.output<typeof mededelingSchema>;
