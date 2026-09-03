import { z } from 'zod';
import { isoDatum, optioneel, verplichteTekst } from './basis.js';

/**
 * Omleiding — spiegel van `DiversionRecord` (api/types.ts) en `Diversion`
 * (src/types.ts). Einddatum is optioneel (leeg = tot hij verwijderd wordt)
 * maar mag niet vóór de startdatum liggen.
 */

const diversionVelden = {
  id: verplichteTekst('Id ontbreekt'),
  line: verplichteTekst('Vul een lijn in'),
  title: verplichteTekst('Vul een titel in'),
  description: verplichteTekst('Vul een omschrijving in'),
  startDate: isoDatum('Vul een startdatum in als JJJJ-MM-DD'),
  endDate: optioneel(isoDatum('Vul een einddatum in als JJJJ-MM-DD')),
  pdfUrl: optioneel(z.string()),
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
