import type { LeaveRequest, Shift } from '../types';
import { serviceNumberOf } from './format';
import { dagNummer, ziektePeriode } from '../../shared/ziekteInzicht';

// De rekenkern staat sinds 21-09 in shared/ziekteInzicht.ts (de ziekterapporten
// tellen op de server met dezelfde regels); bestaande imports blijven werken.
export {
  beschikbareZiekteJaren, berekenZiekteInzicht, berekenZiektePeriode,
  type ZiekteChauffeurInzicht, type ZiekteJaarInzicht, type ZiekteMaandInzicht,
} from '../../shared/ziekteInzicht';

/**
 * Diensten die tijdens de melding vanaf vandaag nog op naam staan. Een
 * gesplitste dienst telt eenmaal per datum/code; het vroegste segment blijft.
 * Dit omvat uitsluitend de aangeleverde planning, geen historische uitval.
 */
export function openZiekteDiensten(melding: LeaveRequest, shifts: readonly Shift[], vandaag: string): Shift[] {
  if (!ziektePeriode(melding) || dagNummer(vandaag) === null) return [];
  const vanaf = melding.startDate > vandaag ? melding.startDate : vandaag;
  const perDienst = new Map<string, Shift>();
  for (const shift of shifts) {
    if (String(shift.driverId) !== String(melding.userId) || shift.date < vanaf || shift.date > melding.endDate) continue;
    const sleutel = `${shift.date}|${serviceNumberOf(shift).toLowerCase()}`;
    const bestaand = perDienst.get(sleutel);
    if (!bestaand || String(shift.startTime ?? '') < String(bestaand.startTime ?? '')) perDienst.set(sleutel, shift);
  }
  return [...perDienst.values()].sort((a, b) => a.date.localeCompare(b.date));
}
