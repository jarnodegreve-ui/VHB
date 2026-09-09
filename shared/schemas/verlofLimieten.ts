import { z } from './zod.js';
import { isoDatum } from './basis.js';

/**
 * Verloflimieten (verzoek Jarno 09-09): hoeveel chauffeurs er tegelijk met
 * goedgekeurd verlof mogen zijn. In een schoolperiode ligt dat lager dan in
 * de zomervakantie, dus naast een standaardwaarde zijn er uitzonderings-
 * periodes met een eigen maximum. Opgeslagen als één jsonb-waarde in
 * app_settings (sleutel VERLOF_LIMIETEN_KEY), gelezen via GET
 * /api/verlof/limieten (alle rollen, want de kalenderkleuring gebruikt het),
 * geschreven via PUT /api/verlof/limieten (admin).
 *
 * Ziekte telt nergens mee in deze bezetting; dat was al zo in de kalender.
 */
export const VERLOF_LIMIETEN_KEY = 'verlof_limieten';

const limiet = z.number().int('Gebruik een geheel getal').min(0, 'Minimum 0').max(200, 'Maximum 200');

export const verlofLimietPeriodeSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    naam: z.string().trim().min(1, 'Geef de periode een naam').max(60, 'Maximum 60 tekens'),
    van: isoDatum('Ongeldige startdatum'),
    tot: isoDatum('Ongeldige einddatum'),
    max: limiet,
  })
  .refine((p) => p.tot >= p.van, { message: 'De einddatum ligt vóór de startdatum', path: ['tot'] });

export type VerlofLimietPeriode = z.output<typeof verlofLimietPeriodeSchema>;

export const verlofLimietenSchema = z.object({
  /** Geldt op elke dag die in geen enkele periode valt. */
  standaard: limiet.default(2),
  /** Uitzonderingsperiodes; bij overlap wint de eerste in de lijst (de
   *  editor sorteert op startdatum, dus de vroegst beginnende). */
  periodes: z.array(verlofLimietPeriodeSchema).max(100, 'Maximum 100 periodes').default([]),
});

export type VerlofLimieten = z.output<typeof verlofLimietenSchema>;

/** De oude vaste grens (VOLZET_VANAF = 2 in de verlofkalender). */
export const STANDAARD_VERLOF_LIMIETEN: VerlofLimieten = { standaard: 2, periodes: [] };

/** Onbekende invoer (db-jsonb) → geldige limieten, anders de standaard. */
export const parseVerlofLimieten = (waarde: unknown): VerlofLimieten => {
  const r = verlofLimietenSchema.safeParse(waarde);
  return r.success ? r.data : STANDAARD_VERLOF_LIMIETEN;
};

/** Hoeveel chauffeurs mogen op deze dag ('YYYY-MM-DD') tegelijk vrij zijn? */
export const limietVoorDag = (limieten: VerlofLimieten, dagIso: string): number => {
  const periode = limieten.periodes.find((p) => p.van <= dagIso && dagIso <= p.tot);
  return periode ? periode.max : limieten.standaard;
};

/** Periodes gesorteerd op startdatum, dan naam; zo is "eerste wint" voorspelbaar. */
export const sorteerPeriodes = (periodes: VerlofLimietPeriode[]): VerlofLimietPeriode[] =>
  [...periodes].sort((a, b) => a.van.localeCompare(b.van) || a.naam.localeCompare(b.naam, 'nl'));
