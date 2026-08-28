/** Wachtwoordminimum — gespiegeld in api/index.ts (WACHTWOORD_MIN). 10 i.p.v.
 *  6: het wachtwoord alleen geeft toegang tot Supabase Auth (controle-ronde
 *  27-08, bevinding 32). */
export const WACHTWOORD_MIN = 10;
export const WACHTWOORD_HINT = `Minstens ${WACHTWOORD_MIN} tekens`;
