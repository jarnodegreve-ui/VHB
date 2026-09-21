import { z } from './zod.js';
import { optioneel, verplichteTekst } from './basis.js';

/**
 * Update (nieuwsbericht) — spiegel van `Update` (src/types.ts); de API kent
 * er geen eigen interface voor (toPublicUpdate in api/helpers.ts).
 * `date` is vrije tekst: de UI schrijft een nl-BE-datum ('3/9/2026'),
 * oudere rijen een ISO-dag — beide blijven geldig.
 */

/** Historisch veld — de UI kent geen categorieën meer (#241). */
export const UPDATE_CATEGORIEEN = ['algemeen', 'veiligheid', 'technisch'] as const;

/** Hoogstens twee PDF's per update (keuze Jarno 21-09). */
export const MAX_UPDATE_BIJLAGEN = 2;

/**
 * Eén PDF-bijlage. `slot` is 1 of 2 en bepaalt de plek in de bucket
 * (`<update-id>-<slot>.pdf`); de URL staat er bewust niet in, die wordt per
 * request ondertekend, zoals bij de omleidingen. De server negeert wat de
 * client hier stuurt en leidt de lijst af uit Storage.
 */
export const updateBijlageSchema = z.object({
  slot: z.number().int().min(1).max(MAX_UPDATE_BIJLAGEN),
  filename: verplichteTekst('Bestandsnaam ontbreekt'),
  sizeBytes: optioneel(z.number().int().nonnegative()),
  /** Alleen in het antwoord van de server; ondertekend en tijdelijk. */
  url: optioneel(z.string()),
});
export type UpdateBijlage = z.output<typeof updateBijlageSchema>;

const updateVelden = {
  id: verplichteTekst('Id ontbreekt'),
  date: verplichteTekst('Datum ontbreekt'),
  title: verplichteTekst('Vul een titel in'),
  content: verplichteTekst('Schrijf een bericht'),
  category: optioneel(z.enum(UPDATE_CATEGORIEEN, { error: 'Onbekende categorie' })),
  isUrgent: optioneel(z.boolean()),
  // Zoals pdfUrl bij een omleiding: alleen geaccepteerd omdat het formulier
  // het record heen en terug stuurt. De server leest de waarheid uit Storage.
  bijlagen: optioneel(z.array(updateBijlageSchema).max(MAX_UPDATE_BIJLAGEN)),
  /** Bijlage meteen ingebed tonen bij het openklappen van de update. */
  bijlagenTonen: optioneel(z.boolean()),
};

export const updateSchema = z.object(updateVelden);
export type GevalideerdeUpdate = z.output<typeof updateSchema>;

export const updateLijstSchema = z.array(updateSchema);

/** Server-invoer voor PUT/:id en POST …/one: het id komt uit de URL of wordt gegenereerd. */
export const updateBodySchema = z.object({ ...updateVelden, id: optioneel(z.string().trim()) });
