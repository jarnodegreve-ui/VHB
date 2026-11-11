import { serviceNumberOf, tijdvak } from './format';
import { parseHHMM } from './shiftTime';
import type { Shift } from '../types';

/**
 * Komende diensten per dag (ronde 6, 11-11) voor het paneel op het
 * chauffeursdashboard. Dat nam de eerste drie planningsrijen, en de planning
 * heeft één rij per dienst-DEEL: een gesplitste dienst (2109 met 06:53–08:23
 * en 13:10–19:15) vulde er twee, zodat er soms maar twee dagen stonden. Hier:
 * de eerstvolgende dagen met een dienst, één per dag. Puur en getest; het
 * scherm tekent alleen. Bewust klein gehouden: het dashboard zit in de warmup
 * van de chauffeur.
 *
 * "Komend" is dezelfde snede als vroeger: een deel telt zolang het nog moet
 * beginnen (start > nu; een busvak-uur boven 24 loopt door naar de dag erna).
 * Van een dienst van vandaag die al begon blijven dus alleen de delen over die
 * nog moeten starten; is er geen meer, dan valt vandaag weg (de Vandaag-tegel
 * erboven toont die dag volledig).
 */
type Deel = Pick<Shift, 'date' | 'startTime' | 'endTime' | 'line'> & { loopnr?: string | null };

/** Eén dag met een dienst: de delen die nog moeten beginnen, op starttijd. */
export type KomendeDag<T extends Deel = Deel> = { datum: string; delen: T[] };

const startMs = (s: Deel): number => {
  const [jaar, maand, dag] = s.date.split('-').map(Number);
  return new Date(jaar, maand - 1, dag, 0, parseHHMM(s.startTime) ?? 0).getTime();
};

export function komendeDienstDagen<T extends Deel>(shifts: readonly T[], nu: Date, aantal = 3): KomendeDag<T>[] {
  const dagen: KomendeDag<T>[] = [];
  // Op start gesorteerd: de dagen staan dus op hun eerstvolgende start, de
  // delen binnen een dag op starttijd.
  for (const s of shifts.filter((d) => startMs(d) > nu.getTime()).sort((a, b) => startMs(a) - startMs(b))) {
    let dag = dagen.find((d) => d.datum === s.date);
    if (!dag) {
      if (dagen.length >= aantal) continue;
      dagen.push(dag = { datum: s.date, delen: [] });
    }
    dag.delen.push(s);
  }
  return dagen;
}

/** De dienstnummers van de dag voor de chip, elk één keer: "2109", of
 *  "2109 / 2304" bij twee diensten op één dag. Leeg zonder nummer. */
export const komendeDagNummers = (dag: KomendeDag): string =>
  [...new Set(dag.delen.map(serviceNumberOf))].filter((n) => n !== '--').join(' / ');

/**
 * De tweede regel van de rij, in stukken die elk heel blijven: de uren van
 * alle delen ("06:45–10:00", "15:45–19:35"), met " · " ertussen te lezen als
 * "06:45–10:00 · 15:45–19:35". Eén deel houdt zijn loopnummer als laatste stuk
 * ("06:12–14:30", "loop 4500"), zoals de rij het vroeger toonde; bij een
 * gesplitste dienst vallen de loopnummers weg (ze staan op het rooster en op
 * Mijn dag).
 *
 * Stukken en geen kant-en-klare tekst: twee tijdvakken zijn 147 tot 150 px
 * breed en de rij biedt er 145 op een telefoon van 375 px en 130 op 360 px.
 * Het scherm laat de regel daarom tussen de stukken omlopen in plaats van de
 * eindtijd af te kappen; binnen een tijdvak breekt ze nooit.
 */
export const komendeDagStukken = (dag: KomendeDag): string[] => {
  const uren = dag.delen.map((d) => tijdvak(d.startTime, d.endTime));
  const loop = dag.delen.length === 1 && dag.delen[0].loopnr;
  return loop ? [...uren, `loop ${loop}`] : uren;
};
