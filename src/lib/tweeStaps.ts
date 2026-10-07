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

/** Wat de server over de sessie zegt: `beveiliging` bij /api/me en bij de sessiestart. */
export type Beveiliging = { mfaVerplicht?: boolean; aal?: 'aal1' | 'aal2' } | null;

export type TweeStapsBesluit = { stap: TweeStapsStap; factorId: string | null; onzeker: boolean };

/**
 * Eén besluit over de tweede stap uit twee bronnen (07-10, "niets laden vóór
 * aal2"): de status van de client (factor en niveau uit de sessie) en wat de
 * server over de sessie zegt. Is de status leesbaar, dan beslist die zoals
 * altijd. Is ze niet leesbaar terwijl de server de code eist en de sessie nog
 * aal1 is, dan is de stap zeker nodig maar is onbekend of er al een
 * authenticator is: `onzeker`, en het codescherm leest de status dan zelf
 * (TweeStapsScherm). Vroeger gold dan "geen stap" en vertrok de hele
 * laadronde met het aal1-token, die de server verzoek voor verzoek weigerde.
 * Zonder serverinformatie blijft het fail-open: de 403 van de server vangt het.
 */
export const beslisTweeStaps = (status: TweeStapsStatus | null, beveiliging: Beveiliging): TweeStapsBesluit => {
  const verplicht = !!beveiliging?.mfaVerplicht;
  if (status) return { stap: bepaalTweeStapsStap(status, verplicht), factorId: status.factorId, onzeker: false };
  if (verplicht && beveiliging?.aal === 'aal1') return { stap: 'code', factorId: null, onzeker: true };
  return { stap: 'geen', factorId: null, onzeker: false };
};
