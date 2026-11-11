import type { LeaveRequest } from '../types';

/**
 * De wachtrij van verlofaanvragen in Verlof (ronde 6, punt 15): twee pure
 * regels over de lijst "Wachtend op goedkeuring". Alleen het scherm Verlof
 * leest dit; de gedeelde beoordeling (src/components/VerlofBeoordeling.tsx)
 * zit in de opwarmset van staf en blijft er daarom buiten.
 */

/**
 * Welke aanvraag opent het beoordelingspaneel na een geslaagde beslissing? De
 * eerstvolgende in de lijst zoals die stond toen de beslisser klikte, voor
 * zover ze nu nog wacht. `null` = er komt er geen meer na: het paneel sluit,
 * zoals vroeger na elke beslissing.
 *
 * - `volgorde`: de id's van de lijst op het moment van de klik, in de volgorde
 *   van het scherm (de aanvraag waarover beslist wordt staat er nog in);
 * - `beslist`: de aanvraag waarover net beslist is;
 * - `wachtend`: de id's die nu nog wachten. De lijst kan intussen gewijzigd
 *   zijn: een collega besliste mee, er kwam een aanvraag bij. Dat de besliste
 *   aanvraag er zelf nog in staat (het scherm is nog niet opnieuw getekend)
 *   of er al uit is, maakt niet uit.
 *
 * Drie bewuste grenzen, alle drie aan de voorzichtige kant:
 * - geen terugloop naar het begin: wie midden in de lijst begon, sloeg de
 *   aanvragen erboven zelf over;
 * - alleen wat bij de klik al in de lijst stond: een aanvraag die tijdens het
 *   wachten op de server binnenkwam, opent nooit vanzelf;
 * - staat de besliste aanvraag niet in de lijst (geopend via een link, niet
 *   in de wachtrij van deze planner), dan is er geen "volgende".
 */
export function volgendeWachtende(volgorde: readonly string[], beslist: string, wachtend: readonly string[]): string | null {
  const plek = volgorde.indexOf(beslist);
  if (plek === -1) return null;
  const wacht = new Set(wachtend);
  return volgorde.slice(plek + 1).find((id) => id !== beslist && wacht.has(id)) ?? null;
}

/** ISO-tekst oplopend; wat ontbreekt komt achteraan. Met < en niet met
 *  localeCompare: een rij zonder aanvraagmoment (oude data) mag het paneel
 *  nooit laten crashen. */
const opVolgorde = (a: string | undefined, b: string | undefined): number => {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
};

/**
 * De andere wachtende aanvragen die de periode van `aanvraag` raken, voor het
 * blok "Ook aangevraagd voor deze periode": wie hier goedkeurt, beslist mee
 * over hen. De oudste aanvraag eerst (wie eerst vroeg, staat bovenaan); bij
 * een gelijk moment de vroegste periode.
 */
export function ookAangevraagd(wachtend: readonly LeaveRequest[], aanvraag: LeaveRequest): LeaveRequest[] {
  return wachtend
    .filter((r) => r.id !== aanvraag.id && r.status === 'pending' && r.startDate <= aanvraag.endDate && r.endDate >= aanvraag.startDate)
    .sort((a, b) => opVolgorde(a.createdAt, b.createdAt) || opVolgorde(a.startDate, b.startDate));
}
