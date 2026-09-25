import { z } from './zod.js';
import { isoDatum, optioneel, verplichteTekst } from './basis.js';

/**
 * Omleiding — spiegel van `DiversionRecord` (api/types.ts) en `Diversion`
 * (src/types.ts). Einddatum is optioneel (leeg = tot hij verwijderd wordt)
 * maar mag niet vóór de startdatum liggen.
 */

/** Hoogstens vijf PDF's per omleiding (keuze Jarno 23-09). */
export const MAX_OMLEIDING_BIJLAGEN = 5;

/**
 * Eén PDF-bijlage. `slot` (1 tot 5) bepaalt de plek in de bucket
 * (`<omleiding-id>-<slot>.pdf`); de URL staat er bewust niet in, die wordt
 * per request ondertekend, zoals bij de updates. De server negeert wat de
 * client hier stuurt en leidt de lijst af uit Storage.
 */
export const omleidingBijlageSchema = z.object({
  slot: z.number().int().min(1).max(MAX_OMLEIDING_BIJLAGEN),
  filename: verplichteTekst('Bestandsnaam ontbreekt'),
  sizeBytes: optioneel(z.number().int().nonnegative()),
  /** Alleen in het antwoord van de server; ondertekend en tijdelijk. */
  url: optioneel(z.string()),
});
export type OmleidingBijlage = z.output<typeof omleidingBijlageSchema>;

const diversionVelden = {
  id: verplichteTekst('Id ontbreekt'),
  line: verplichteTekst('Vul een lijn in'),
  // Plaats is optioneel (oudere omleidingen hebben ze niet), maar kort.
  location: optioneel(z.string().trim().max(80, 'Plaats is te lang (max 80 tekens)')),
  title: verplichteTekst('Vul een titel in'),
  description: verplichteTekst('Vul een omschrijving in'),
  startDate: isoDatum('Vul een geldige startdatum in (dd/mm/jjjj)'),
  endDate: optioneel(isoDatum('Vul een geldige einddatum in (dd/mm/jjjj)')),
  // Alleen geaccepteerd omdat het formulier het record heen en terug stuurt;
  // de server negeert de waarde en houdt wat er in Storage hangt (zie
  // metBewaardeBijlagen in api/_lib/communicatieRoutes.ts). Een vrije externe
  // link kan zo nooit als "officiële PDF" bij een omleiding komen (controle
  // 05-09, nr. 28).
  bijlagen: optioneel(z.array(omleidingBijlageSchema).max(MAX_OMLEIDING_BIJLAGEN)),
};

// ISO-dagen vergelijken als tekst is veilig; de guard houdt de regel stil
// zolang een van beide datums zelf al ongeldig is.
const eindNaBegin = (d: { startDate?: string; endDate?: string }) =>
  !d.startDate || !d.endDate || d.endDate >= d.startDate;
const EIND_NA_BEGIN = { path: ['endDate'], message: 'Einddatum ligt vóór begindatum' };

export const diversionSchema = z.object(diversionVelden).refine(eindNaBegin, EIND_NA_BEGIN);
export type GevalideerdeDiversion = z.output<typeof diversionSchema>;

export const diversionLijstSchema = z.array(diversionSchema);

/** Server-invoer voor PUT/:id en POST …/one: het id komt uit de URL of wordt gegenereerd. */
export const diversionBodySchema = z
  .object({ ...diversionVelden, id: optioneel(z.string().trim()) })
  .refine(eindNaBegin, EIND_NA_BEGIN);
