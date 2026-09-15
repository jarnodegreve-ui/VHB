/**
 * Telregels van de verlofbezetting (de verloflimiet per dag), gedeeld door
 * client én server. Stond in src/types.ts, maar sinds GET /api/leave/bezetting
 * telt ook de server per dag mee: beide kanten moeten exact dezelfde regels
 * gebruiken, anders ziet een chauffeur andere kalenderkleuren dan de planner.
 * src/types.ts her-exporteert deze functies, bestaande imports blijven werken.
 */

/** Rijdend personeel: heeft diensten, staat in de planning en telt mee in
 *  de verlofbezetting. Een technieker niet. */
export const isRijdend = (role: string): boolean => role === 'chauffeur';

/** Flexi-job (sectie “Flexi” in gebruikersbeheer; de import mapt alles met
 *  “flex” daarop). Een flexi vult in, dus zijn verlof bezet geen vaste
 *  dienst. */
export const isFlexi = (section?: string | null): boolean =>
  String(section ?? '').trim().toLowerCase().startsWith('flex');

/** Telt deze persoon mee in de verlofbezetting (de verloflimiet per dag)?
 *  Rijdend personeel wél, een technieker niet (Jarno 09-09) en een
 *  flexi-job evenmin (Jarno 14-09): die vult in, dus zijn vrije dag maakt
 *  de dag niet voller. */
export const teltInVerlofbezetting = (u: { role: string; section?: string | null }): boolean =>
  isRijdend(u.role) && !isFlexi(u.section);
