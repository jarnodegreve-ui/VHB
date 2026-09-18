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

/** De kale reden van een handmatige wissel: `reason` draagt daar het voorvoegsel
 *  "Handmatige wissel door <naam>, " en dat is dubbelop waar het scherm of het
 *  blad zelf al toont dat het handmatig ging en door wie (Jarno 18-09). Een
 *  gewone ruilreden komt ongewijzigd terug. */
export const kaleReden = (reason: string | undefined | null): string => {
  const tekst = String(reason ?? '').trim();
  if (!tekst.startsWith(HANDMATIGE_WISSEL_PREFIX)) return tekst;
  // Na het voorvoegsel staat "<naam>, <reden>"; zonder komma bleef alleen de naam over.
  const naDeNaam = tekst.slice(HANDMATIGE_WISSEL_PREFIX.length).split(/,\s*/);
  return naDeNaam.slice(1).join(', ').trim();
};

/** Sleutel per dienst: datum + genormaliseerd dienstnummer. */
export const ruilSleutel = (date: string, line: string): string => `${date}__${String(line ?? '').trim().toLowerCase()}`;

/**
 * Per (datum, dienstnummer): de doorgevoerde ruil die die dienst bij
 * `userId` bracht. Alleen 'approved' en 'completed' tellen; een lopende
 * aanvraag heeft zijn eigen badge. In beslisvolgorde, zodat bij een ketting
 * (A→B, daarna B→C) de laatste wissel het label bepaalt.
 *
 * Memo-vriendelijk (punt 19, 15-09): zuiver in (userId, swaps, users), en
 * met een enkelvoudige cache op referentie. Mijn dag riep dit elke minuut
 * ongememoiseerd aan (setInterval voor de klok) met `users.find` in een lus;
 * sinds de datalaag stabiele array-referenties teruggeeft, is de tweede
 * aanroep met dezelfde invoer nu O(1). Namen via een Map i.p.v. find.
 * Het resultaat is dezelfde Map-instantie: niet muteren bij de aanroeper.
 */
let laatste: { userId: string; swaps: readonly SwapRequest[]; users: ReadonlyArray<Pick<User, 'id' | 'name'>>; map: Map<string, RuilBadge> } | null = null;

export function geruildeDiensten(
  userId: string,
  swaps: readonly SwapRequest[],
  users: ReadonlyArray<Pick<User, 'id' | 'name'>>,
): Map<string, RuilBadge> {
  if (laatste && laatste.userId === userId && laatste.swaps === swaps && laatste.users === users) return laatste.map;
  const map = berekenGeruildeDiensten(userId, swaps, users);
  laatste = { userId, swaps, users, map };
  return map;
}

function berekenGeruildeDiensten(
  userId: string,
  swaps: readonly SwapRequest[],
  users: ReadonlyArray<Pick<User, 'id' | 'name'>>,
): Map<string, RuilBadge> {
  const namen = new Map<string, string>();
  for (const u of users) namen.set(String(u.id), u.name);
  const naam = (id: string | undefined) => namen.get(String(id)) ?? 'een collega';
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
