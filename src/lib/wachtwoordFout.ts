import { WACHTWOORD_MIN } from '../../shared/schemas/constanten';

/** Eigen module, niet in wachtwoord.ts: dat zit via het loginscherm in de
 *  startbundel, en deze vertaling is alleen nodig in de luie schermen die een
 *  wachtwoord zetten (uitnodiging, wachtwoord wijzigen). */

/** Supabase weigert een wachtwoord met code `weak_password` en zegt in
 *  `reasons` waarom (length, characters, pwned). De eigen melding van
 *  Supabase is Engels; dit zet ze om naar wat de persoon kan doen. Geeft
 *  null voor elke andere fout. */
export function wachtwoordZwakFout(fout: unknown): string | null {
  if (!fout || typeof fout !== 'object') return null;
  const { code, reasons } = fout as { code?: string; reasons?: unknown };
  if (code !== 'weak_password') return null;
  const redenen = Array.isArray(reasons) ? (reasons as string[]) : [];
  if (redenen.includes('pwned')) return 'Dit wachtwoord is bekend uit een datalek. Kies een ander wachtwoord.';
  if (redenen.includes('characters')) return 'Dit wachtwoord moet ook letters en cijfers bevatten.';
  return `Dit wachtwoord is te zwak. Kies er een van minstens ${WACHTWOORD_MIN} tekens.`;
}
