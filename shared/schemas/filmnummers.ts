import { z } from './zod.js';
import { FILMNUMMER_CODE, MAX_FILMNUMMERS, MAX_FILM_LIJN, MAX_FILM_TEKST } from '../filmnummers.js';

/**
 * Body van PUT /api/filmnummers: `{ items: [...] }`, de hele lijst in één keer
 * (een import vervangt de vorige lijst). Types, grenzen en de lezers voor het
 * scherm staan zod-vrij in shared/filmnummers.ts; dit schema rekent met
 * dezelfde grenzen, zodat wat de import doorlaat ook de server passeert.
 */
export const filmnummerSchema = z.object({
  code: z.string({ error: 'Geef een nummer' }).trim().regex(FILMNUMMER_CODE, 'Een filmnummer bestaat uit 1 tot 6 cijfers'),
  lijn: z.preprocess((v) => v ?? '', z.string({ error: 'Ongeldige lijn' }).trim().max(MAX_FILM_LIJN, `Hooguit ${MAX_FILM_LIJN} tekens`)),
  tekst: z.string({ error: 'Geef de bestemming' }).trim().min(1, 'Geef de bestemming').max(MAX_FILM_TEKST, `Hooguit ${MAX_FILM_TEKST} tekens`),
});

/** Nooit leeg: een lege lijst zou alle nummers bij de chauffeurs wissen. */
export const filmnummersSchema = z
  .array(filmnummerSchema)
  .min(1, 'De lijst bevat geen filmnummers')
  .max(MAX_FILMNUMMERS, `Hooguit ${MAX_FILMNUMMERS} filmnummers`);
