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

export type Inschrijving = { factorId: string; qr: string; geheim: string };

/** Start een nieuwe TOTP-inschrijving. Een eerdere, nooit bevestigde poging
 *  wordt eerst opgeruimd (Supabase laat er maar één per naam toe). */
export const startInschrijving = async (): Promise<Inschrijving> => {
  if (!supabase) throw new Error('Supabase is niet geconfigureerd.');
  const { data: bestaand } = await supabase.auth.mfa.listFactors();
  for (const f of bestaand?.totp ?? []) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'VHB Portaal' });
  if (error || !data) throw new Error(vertaal(error?.message, 'Inschrijven is mislukt. Probeer het opnieuw.'));
  return { factorId: data.id, qr: data.totp.qr_code, geheim: data.totp.secret };
};

/** Code uit de authenticator-app controleren; bij succes staat de sessie op aal2. */
export const bevestigCode = async (factorId: string, code: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is niet geconfigureerd.');
  const schoon = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(schoon)) throw new Error('Vul de zescijferige code uit je authenticator-app in.');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: schoon });
  if (error) throw new Error(vertaal(error.message, 'De code klopt niet of is verlopen. Probeer de volgende code.'));
};

export const schakelUit = async (factorId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is niet geconfigureerd.');
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(vertaal(error.message, 'Uitschakelen is mislukt.'));
};

const vertaal = (bericht: string | undefined, standaard: string): string => {
  const m = (bericht ?? '').toLowerCase();
  if (m.includes('invalid totp') || m.includes('invalid code')) return 'De code klopt niet of is verlopen. Probeer de volgende code.';
  if (m.includes('aal2') || m.includes('insufficient')) return 'Voer eerst je huidige code in voordat je dit wijzigt.';
  if (m.includes('mfa') && m.includes('disabled')) return 'Twee-stapsverificatie staat nog niet aan op de server. Vraag de beheerder.';
  return standaard;
};
