/**
 * Zod-vrije constanten van de gedeelde contracten. Apart bestand zodat het
 * loginscherm (src/lib/wachtwoord.ts) het minimum kan tonen zonder zod in de
 * hoofdbundel te trekken (±25 kB gzip); de schemas zelf laden lazy mee met
 * de beheerschermen.
 */

/** Wachtwoordminimum (client én server). 10 i.p.v. 6: het wachtwoord alleen
 *  geeft toegang tot Supabase Auth (controle-ronde 27-08, bevinding 32).
 *  Supabase' eigen minimum staat in het dashboard (Auth → Password) en hoort
 *  hier niet onder te liggen. */
export const WACHTWOORD_MIN = 10;

export const ROLLEN = ['chauffeur', 'planner', 'admin'] as const;

// --- Onderhoudsmodus (shared/schemas/onderhoud.ts) ---
// Zod-vrij, want de schil (useOnderhoud, OnderhoudBanner) en het loginscherm
// lezen deze; alleen het beheerscherm (lazy) gebruikt het schema zelf.
import type { Onderhoud } from './onderhoud.js';

export const ONDERHOUD_TEKST_MAX = 240;
export const ONDERHOUD_STANDAARD_TEKST = 'Het portaal is even in onderhoud. Bekijken kan, sommige onderdelen werken tijdelijk niet.';
export const GEEN_ONDERHOUD: Onderhoud = { actief: false, tekst: '', schrijfblok: false };
