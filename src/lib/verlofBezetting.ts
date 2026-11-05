/**
 * Bezetting van een kalenderdag in de verlofkalender (kleuren en titels
 * gekozen door Jarno 08-09): groen = vrij (niemand goedgekeurd afwezig),
 * oranje = deels vrij, rood = volzet. Volzet zodra de verloflimiet van die
 * dag bereikt is. Die limiet was een vaste 2; sinds 09-09 stelt de admin
 * hem in (standaard + uitzonderingsperiodes), zie
 * shared/schemas/verlofLimieten.ts.
 *
 * Een dag met limiet 0 (feestdag, zondag in de dagtypekalender 2027) is geen
 * van de drie: er kan geen verlof op, maar hij is niet "volzet" en al zeker
 * niet "vrij". Die dag kleurde groen zolang niemand verlof had (controle
 * 04-11, punt 36; beslissing: neutraal, "geen verlof mogelijk"). De limiet
 * gaat vóór de telling: ook met een al geregistreerde afwezigheid blijft het
 * "geen verlof mogelijk", niet "volzet".
 */
export type Bezetting = 'geen' | 'vrij' | 'deels' | 'volzet';

export const bezettingVanDag = (afwezig: number, limiet: number): Bezetting => {
  if (limiet <= 0) return 'geen';
  if (afwezig <= 0) return 'vrij';
  return afwezig < limiet ? 'deels' : 'volzet';
};

/** Tekst bij de kleur, voor aria-label, title en legende. */
export const BEZETTING_LABEL: Record<Bezetting, string> = {
  geen: 'geen verlof mogelijk',
  vrij: 'vrij',
  deels: 'deels vrij',
  volzet: 'volzet',
};
