/** Wachtwoordminimum — één bron voor client én server: shared/schemas
 *  (constanten.ts, zod-vrij zodat het loginscherm zod niet meelaadt; het
 *  gebruikersschema in user.ts hanteert hetzelfde getal). 10 i.p.v. 6: het
 *  wachtwoord alleen geeft toegang tot Supabase Auth (controle-ronde 27-08,
 *  bevinding 32). */
export { WACHTWOORD_MIN } from '../../shared/schemas/constanten';
import { WACHTWOORD_MIN } from '../../shared/schemas/constanten';
export const WACHTWOORD_HINT = `Minstens ${WACHTWOORD_MIN} tekens`;

/** De volledige regel, als zin onder het veld (07-10: genodigden zagen
 *  alleen de placeholder, die verdwijnt zodra je typt, en gingen hoofdletters
 *  en cijfers zoeken die niet gevraagd worden). De lengte is de enige eis. */
export const WACHTWOORD_REGEL = `Minstens ${WACHTWOORD_MIN} tekens. Hoofdletters, cijfers of leestekens hoeven niet.`;

/** Wat er onder het veld staat terwijl iemand typt: de regel zolang het veld
 *  leeg is, daarna hoeveel tekens er nog bij moeten, tot het lang genoeg is. */
export function wachtwoordVoortgang(waarde: string): { tekst: string; klaar: boolean } {
  const lengte = waarde.length;
  if (lengte === 0) return { tekst: WACHTWOORD_REGEL, klaar: false };
  const tekort = WACHTWOORD_MIN - lengte;
  if (tekort > 0) return { tekst: `Nog ${tekort} ${tekort === 1 ? 'teken' : 'tekens'}.`, klaar: false };
  return { tekst: `Lang genoeg: ${lengte} tekens.`, klaar: true };
}
