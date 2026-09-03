import { z } from 'zod';
import { optioneel, verplichteTekst } from './basis.js';

/**
 * Update (nieuwsbericht) — spiegel van `Update` (src/types.ts); de API kent
 * er geen eigen interface voor (toPublicUpdate in api/helpers.ts).
 * `date` is vrije tekst: de UI schrijft een nl-BE-datum ('3/9/2026'),
 * oudere rijen een ISO-dag — beide blijven geldig.
 */

/** Historisch veld — de UI kent geen categorieën meer (#241). */
export const UPDATE_CATEGORIEEN = ['algemeen', 'veiligheid', 'technisch'] as const;

const updateVelden = {
  id: verplichteTekst('Id ontbreekt'),
  date: verplichteTekst('Datum ontbreekt'),
  title: verplichteTekst('Vul een titel in'),
  content: verplichteTekst('Schrijf een bericht'),
  category: optioneel(z.enum(UPDATE_CATEGORIEEN, { error: 'Onbekende categorie' })),
  isUrgent: optioneel(z.boolean()),
};

export const updateSchema = z.object(updateVelden);
export type GevalideerdeUpdate = z.output<typeof updateSchema>;

export const updateLijstSchema = z.array(updateSchema);

/** Server-invoer voor PUT/:id en POST …/one: het id komt uit de URL of wordt gegenereerd. */
export const updateBodySchema = z.object({ ...updateVelden, id: optioneel(z.string().trim()) });
