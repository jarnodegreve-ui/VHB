import type { Shift } from '../types';
import { normalizePlanningToken } from './planning';

/**
 * Hulpjes voor de dienstruil-wizard. Een gesplitste dienst (bv. 2104 in een
 * ochtend- en een namiddagdeel) staat als meerdere planning-rijen met
 * dezelfde (dag, dienstcode). Voor de chauffeur is dat één dienst, en de
 * doorvoer van een ruil verhuist ook alle rijen met die (dag, code).
 *
 * De wizard behandelde die rijen als losse diensten. Gevolg (melding Jarno
 * 16-09, wissel voor vr 18-09): stap 3 zag het tweede deel van de eigen
 * dienst als "jij rijdt die dag al" en zette de dienst van de collega op
 * dezelfde dag bij "niet mogelijk", zodat een 1-op-1 ruil op dezelfde dag
 * voor iedereen met een gesplitste dienst dood liep.
 */

/** Sleutel van de dienst waar een planning-rij toe behoort. */
export const dienstSleutel = (s: Pick<Shift, 'date' | 'line'>) => `${s.date}|${normalizePlanningToken(s.line)}`;

export type DienstGroep = Shift & { delen: number };

/**
 * Eén kaart per dienst i.p.v. één per deel: het vroegste deel blijft de
 * drager (id, start), het einde wordt het einde van het laatste deel.
 * Invoer mag ongesorteerd zijn; uitvoer is chronologisch.
 */
export const groepeerPerDienst = (shifts: Shift[]): DienstGroep[] => {
  const per = new Map<string, DienstGroep>();
  for (const s of shifts) {
    const key = dienstSleutel(s);
    const bestaand = per.get(key);
    if (!bestaand) {
      per.set(key, { ...s, delen: 1 });
      continue;
    }
    bestaand.delen += 1;
    if (String(s.startTime) < String(bestaand.startTime)) {
      bestaand.id = s.id;
      bestaand.startTime = s.startTime;
    }
    if (String(s.endTime) > String(bestaand.endTime)) bestaand.endTime = s.endTime;
  }
  return [...per.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)),
  );
};

/**
 * Welke eigen dienst botst met een tegenprestatie op `date`? De delen van de
 * aangeboden dienst tellen niet mee (die geeft de aanvrager net weg); een
 * ándere eigen dienst op die dag wel. Geeft de dienstcode terug, of undefined.
 */
export const eigenDienstOp = (
  shifts: Shift[],
  userId: string,
  date: string,
  aangeboden: Pick<Shift, 'date' | 'line'> | undefined,
): string | undefined => {
  const aangebodenKey = aangeboden ? dienstSleutel(aangeboden) : null;
  const andere = shifts.find(
    (s) => String(s.driverId) === String(userId) && s.date === date && dienstSleutel(s) !== aangebodenKey,
  );
  return andere ? String(andere.line || '?').trim() : undefined;
};
