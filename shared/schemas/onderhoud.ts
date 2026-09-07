import { z } from 'zod';
import { optioneel } from './basis.js';

/**
 * Onderhoudsmodus (verbeterronde 07-09, nr. 4): één app_settings-sleutel
 * `onderhoud` die de beheerder in Instellingen › Beheer zet. Zolang `actief`
 * staat, toont de schil (en het loginscherm) een rustige banner met `tekst`;
 * met `schrijfblok` beantwoordt de API elke schrijfactie van niet-admins met
 * 503 (code 'onderhoud'). `tot` is optioneel: daarna geldt de modus vanzelf
 * niet meer (zie api/_lib/onderhoudRegels.ts).
 *
 * Eén schema voor het formulier én de body van PUT /api/onderhoud.
 */
export const ONDERHOUD_TEKST_MAX = 240;
export const ONDERHOUD_STANDAARD_TEKST = 'Het portaal is even in onderhoud. Bekijken kan, sommige onderdelen werken tijdelijk niet.';

export const onderhoudSchema = z.object({
  actief: z.boolean({ error: 'Kies aan of uit' }),
  tekst: z.string({ error: 'Vul een tekst in' }).trim().max(ONDERHOUD_TEKST_MAX, `Hooguit ${ONDERHOUD_TEKST_MAX} tekens`).default(''),
  schrijfblok: z.boolean({ error: 'Kies aan of uit' }).default(false),
  /** Einde van het onderhoud (ISO-tijdstip met zone); daarna telt `actief` niet meer. */
  tot: optioneel(z.iso.datetime({ offset: true, error: 'Ongeldig tijdstip' })),
});

export type Onderhoud = z.output<typeof onderhoudSchema>;

/** Body van PUT /api/onderhoud (admin). */
export const onderhoudBodySchema = onderhoudSchema;

export const GEEN_ONDERHOUD: Onderhoud = { actief: false, tekst: '', schrijfblok: false };

/** Onbekende invoer (db-jsonb, API-antwoord) → geldige instelling, anders "geen onderhoud". */
export const parseOnderhoud = (waarde: unknown): Onderhoud => {
  const r = onderhoudSchema.safeParse(waarde);
  return r.success ? r.data : GEEN_ONDERHOUD;
};

/** Wat het loginscherm (zonder sessie) mag zien: GET /api/onderhoud/publiek. */
export type OnderhoudPubliek = Pick<Onderhoud, 'actief' | 'tekst'>;
