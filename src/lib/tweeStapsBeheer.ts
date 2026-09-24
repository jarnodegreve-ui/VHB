/**
 * Inschrijven, code bevestigen en uitschakelen van de twee-stapsverificatie
 * (verbeterronde 07-09, nr. 8). Eigen module (polish P2b, 24-09): alleen de
 * lui geladen schermen (inschrijving, codescherm, Instellingen) gebruiken
 * dit; in src/lib/tweeStaps.ts zat het in de startbundel van iedereen.
 */
import { supabase } from './supabase';

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
  // Status mee, zodat meldSchrijffout (src/lib/fouten.ts) de vervolgstap kiest.
  if (error) throw Object.assign(new Error(vertaal(error.message, 'Uitschakelen is mislukt.')), { status: error.status });
};

const vertaal = (bericht: string | undefined, standaard: string): string => {
  const m = (bericht ?? '').toLowerCase();
  if (m.includes('invalid totp') || m.includes('invalid code')) return 'De code klopt niet of is verlopen. Probeer de volgende code.';
  if (m.includes('aal2') || m.includes('insufficient')) return 'Voer eerst je huidige code in voordat je dit wijzigt.';
  if (m.includes('mfa') && m.includes('disabled')) return 'Twee-stapsverificatie staat nog niet aan op de server. Vraag de beheerder.';
  return standaard;
};
