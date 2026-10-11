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

export type VerlofLimieten = z.output<typeof verlofLimietenSchema> & {
  /** Per 'JJJJ-MM-DD' het maximum uit de dagtypekalender (11-10): de server
   *  voegt het toe aan GET /api/verlof/limieten en de bezetting; een PUT
   *  schrijft het nooit (de kalender is de bron, het schema laat het vallen).
   *  Wint van de periodes. Bewust buiten het zod-schema: z.record zou de
   *  zod-vendor-chunk in de staf-warmup ±1,2 kB zwaarder maken. */
  perDag?: Record<string, number>;
};

/** `perDag` uit een db- of API-waarde: alleen echte ISO-dagen met een geheel getal van 0 tot 200. */
const leesPerDag = (raw: unknown): Record<string, number> | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const uit: Record<string, number> = {};
  for (const [dag, max] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dag) && typeof max === 'number' && Number.isInteger(max) && max >= 0 && max <= 200) uit[dag] = max;
  }
  return Object.keys(uit).length > 0 ? uit : undefined;
};

/** De oude vaste grens (VOLZET_VANAF = 2 in de verlofkalender). */
export const STANDAARD_VERLOF_LIMIETEN: VerlofLimieten = { standaard: 2, periodes: [] };

/** Onbekende invoer (db-jsonb) → geldige limieten, anders de standaard. */
export const parseVerlofLimieten = (waarde: unknown): VerlofLimieten => {
  const r = verlofLimietenSchema.safeParse(waarde);
  if (!r.success) return STANDAARD_VERLOF_LIMIETEN;
  const perDag = leesPerDag((waarde as { perDag?: unknown } | null)?.perDag);
  return perDag ? { ...r.data, perDag } : r.data;
};

/** Hoeveel chauffeurs mogen op deze dag ('YYYY-MM-DD') tegelijk vrij zijn? */
export const limietVoorDag = (limieten: VerlofLimieten, dagIso: string): number => {
  const eigen = limieten.perDag?.[dagIso];
  if (typeof eigen === 'number') return eigen;
  const periode = limieten.periodes.find((p) => p.van <= dagIso && dagIso <= p.tot);
  return periode ? periode.max : limieten.standaard;
};

/** Periodes gesorteerd op startdatum, dan naam; zo is "eerste wint" voorspelbaar. */
export const sorteerPeriodes = (periodes: VerlofLimietPeriode[]): VerlofLimietPeriode[] =>
  [...periodes].sort((a, b) => a.van.localeCompare(b.van) || a.naam.localeCompare(b.naam, 'nl'));
