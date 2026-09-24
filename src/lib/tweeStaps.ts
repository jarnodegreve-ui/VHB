/**
 * Twee-stapsverificatie (TOTP) via Supabase Auth, voor planner en admin
 * (verbeterronde 07-09, nr. 8). Dunne laag rond supabase.auth.mfa met
 * Nederlandse fouten en één zuivere beslisfunctie die App.tsx gebruikt om
 * vóór de app te kiezen: niets, code vragen, of inschrijven.
 *
 * Alles hier is fail-open aan de clientkant: kan de status niet gelezen
 * worden (mock-Supabase in e2e, oude sessie), dan is er geen tussenscherm.
 * De server (MFA_STAF=aan) blijft de autoriteit en antwoordt 403
 * mfa_required, wat App.tsx alsnog naar het codescherm stuurt.
 */
import { supabase } from './supabase';

export type TweeStapsStatus = {
  /** Id van de bevestigde TOTP-factor, of null als er geen is. */
  factorId: string | null;
  /** Huidig niveau van de sessie: 'aal2' = code al ingevoerd. */
  huidig: 'aal1' | 'aal2';
};

export type TweeStapsStap = 'geen' | 'code' | 'inschrijven';

/** Welk tussenscherm hoort bij deze status? Zuiver, unit-getest. */
export const bepaalTweeStapsStap = (status: TweeStapsStatus | null, verplicht: boolean): TweeStapsStap => {
  if (!status) return 'geen';
  if (status.factorId && status.huidig !== 'aal2') return 'code';
  if (!status.factorId && verplicht) return 'inschrijven';
  return 'geen';
};

export const leesTweeStapsStatus = async (): Promise<TweeStapsStatus | null> => {
  if (!supabase) return null;
  try {
    const [{ data: factoren, error: fe }, { data: niveau, error: ne }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (fe || ne) return null;
    const bevestigd = (factoren?.totp ?? []).find((f) => f.status === 'verified');
    return { factorId: bevestigd?.id ?? null, huidig: niveau?.currentLevel === 'aal2' ? 'aal2' : 'aal1' };
  } catch {
    return null;
  }
};
