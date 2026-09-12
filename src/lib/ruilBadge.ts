import type { SwapRequest, User } from '../types';
import { HANDMATIGE_WISSEL_PREFIX } from '../../shared/schemas/constanten';

/**
 * "Geruild met X" op de eigen diensten in rooster en Mijn dag (vraag Jarno
 * 12-09). Tot nu toe zag een chauffeur een doorgevoerde ruil alleen in de
 * maandplanning; in zijn eigen rooster stond de overgenomen dienst als een
 * gewone dienst, verwarrend voor wie de wissel uitvoerde.
 *
 * Matcht op datum + dienstnummer, bewust niet op de planning-rij-id: die
 * wordt bij elke import opnieuw gevormd (op naam van de chauffeur uit de
 * Excel), dus een id-koppeling breekt zodra de planner de ruil ook in de
 * Excel verwerkt. Hetzelfde principe als de maandplanning-overlay en de
 * import-replay aan de serverkant.
 */
export type RuilBadge = {
  /** ruil = 1-op-1 tussen collega's, overname = zonder tegenprestatie, handmatig = door beheer overgezet. */
  soort: 'ruil' | 'overname' | 'handmatig';
  /** Naam van de collega aan de andere kant van de wissel. */
  met: string;
  swapId: string;
};

export const ruilBadgeLabel = (b: RuilBadge): string =>
  b.soort === 'ruil' ? `Geruild met ${b.met}` : b.soort === 'overname' ? `Overgenomen van ${b.met}` : `Overgezet van ${b.met}`;

/** Sleutel per dienst: datum + genormaliseerd dienstnummer. */
export const ruilSleutel = (date: string, line: string): string => `${date}__${String(line ?? '').trim().toLowerCase()}`;

/**
 * Per (datum, dienstnummer): de doorgevoerde ruil die die dienst bij
 * `userId` bracht. Alleen 'approved' en 'completed' tellen; een lopende
 * aanvraag heeft zijn eigen badge. In beslisvolgorde, zodat bij een ketting
 * (A→B, daarna B→C) de laatste wissel het label bepaalt.
 */
export function geruildeDiensten(
  userId: string,
  swaps: readonly SwapRequest[],
  users: ReadonlyArray<Pick<User, 'id' | 'name'>>,
): Map<string, RuilBadge> {
  const naam = (id: string | undefined) => users.find((u) => String(u.id) === String(id))?.name ?? 'een collega';
  const map = new Map<string, RuilBadge>();
  const doorgevoerd = swaps
    .filter((s) => s.status === 'approved' || s.status === 'completed')
    .sort((a, b) => String(a.decidedAt ?? '').localeCompare(String(b.decidedAt ?? '')));
  for (const sw of doorgevoerd) {
    const handmatig = String(sw.reason ?? '').startsWith(HANDMATIGE_WISSEL_PREFIX);
    const soort: RuilBadge['soort'] = handmatig ? 'handmatig' : sw.swapType === 'overname' ? 'overname' : 'ruil';
    // De aangeboden dienst kwam bij de collega terecht.
    if (String(sw.targetDriverId) === String(userId) && sw.shiftDate && sw.shiftLine) {
      map.set(ruilSleutel(sw.shiftDate, sw.shiftLine), { soort, met: naam(sw.requesterId), swapId: sw.id });
    }
    // De terugdienst van een 1-op-1-ruil kwam bij de aanvrager terecht.
    const terug = String(sw.returnCode ?? '').trim();
    if (String(sw.requesterId) === String(userId) && soort === 'ruil' && sw.returnDate && terug && terug.toLowerCase() !== 'vrij') {
      map.set(ruilSleutel(sw.returnDate, terug), { soort: 'ruil', met: naam(sw.targetDriverId), swapId: sw.id });
    }
  }
  return map;
}
