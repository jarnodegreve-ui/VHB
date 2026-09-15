import type { User } from '../types';

/**
 * Contextuele uitwegen bij waarschuwingen zonder actie (next-level 2, punt
 * 17): een planner zonder adminrecht kan een admin vragen, een admin krijgt
 * de directe link. Geen schema, geen wachtstatus; alleen navigatie en mail.
 */

/** Actieve admins met een e-mailadres, voor "Vraag een admin". */
export const adminsMetMail = (users: readonly User[]): User[] =>
  users.filter((u) => u.role === 'admin' && u.isActive !== false && !!u.email?.trim());

/** mailto: naar alle admins met vooringevulde tekst; undefined zonder adressen. */
export function adminMailto(users: readonly User[], onderwerp: string, tekst: string): string | undefined {
  const adressen = adminsMetMail(users).map((u) => u.email!.trim());
  if (adressen.length === 0) return undefined;
  const q = new URLSearchParams({ subject: onderwerp, body: tekst });
  // URLSearchParams codeert spaties als '+', mailclients lezen dat letterlijk.
  return `mailto:${adressen.join(',')}?${q.toString().replace(/\+/g, '%20')}`;
}

/** Route-parameters voor /maandplanning/<yyyy-mm>/<yyyy-mm-dd>. Werkt de
 *  dagparameter nog niet, dan leest CapacityView alleen de maand. */
export const maandplanningParams = (datumIso: string): string[] => [datumIso.slice(0, 7), datumIso.slice(0, 10)];

/** Tekst voor de admin-mail na een ziekmelding: welke diensten nog op naam staan. */
export function ziekmeldMailTekst(naam: string, diensten: ReadonlyArray<{ date: string; nummer: string }>, origin: string): string {
  const regels = diensten.map((d) => `- ${d.date}: dienst ${d.nummer} (${origin}/maandplanning/${maandplanningParams(d.date).join('/')})`);
  return [`${naam} is ziek gemeld. Deze diensten staan nog op naam en moeten overgezet worden:`, '', ...regels, '', 'Kun jij ze overzetten in de Maandplanning?'].join('\n');
}
