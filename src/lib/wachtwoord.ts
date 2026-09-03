/** Wachtwoordminimum — één bron voor client én server: shared/schemas
 *  (constanten.ts, zod-vrij zodat het loginscherm zod niet meelaadt; het
 *  gebruikersschema in user.ts hanteert hetzelfde getal). 10 i.p.v. 6: het
 *  wachtwoord alleen geeft toegang tot Supabase Auth (controle-ronde 27-08,
 *  bevinding 32). */
export { WACHTWOORD_MIN } from '../../shared/schemas/constanten';
import { WACHTWOORD_MIN } from '../../shared/schemas/constanten';
export const WACHTWOORD_HINT = `Minstens ${WACHTWOORD_MIN} tekens`;
