import { addDays, isoDate } from './availability';
import { serviceNumberOf } from './format';
import type { LeaveRequest, Shift } from '../types';

/**
 * Mijn week (verbeterronde 4, punt 3): de komende dagen van één chauffeur als
 * rij dagcellen op Mijn dag. Puur en getest; het scherm tekent alleen.
 *
 * Een dag is een dienst zodra er een dienst-deel op staat, ook als er verlof
 * op ligt (dat conflict toont het rooster; hier telt wat er gereden wordt).
 * Buiten de planningshorizon weten we niets: geen dienst betekent daar niet
 * "vrij" maar "nog niet gepland", dezelfde regel als het rooster.
 */
export type WeekDagSoort = 'dienst' | 'verlof' | 'ziek' | 'vrij' | 'onbekend';

export type WeekDag = {
  datum: string;
  soort: WeekDagSoort;
  /** Unieke dienstnummers van de dag, in volgorde van start. */
  dienstnummers: string[];
  start: string | null;
  einde: string | null;
  delen: number;
};

export const MIJN_WEEK_DAGEN = 7;

export function bouwMijnWeek({ vanaf, shifts, leaves = [], planningTot = null, dagen = MIJN_WEEK_DAGEN }: {
  /** Eerste dag van de strook (ISO), normaal vandaag. */
  vanaf: string;
  /** Alleen de diensten van deze chauffeur. */
  shifts: readonly Shift[];
  /** Alleen de aanvragen van deze chauffeur. */
  leaves?: readonly Pick<LeaveRequest, 'startDate' | 'endDate' | 'type' | 'status'>[];
  /** Laatste dag waarvoor er planning in het portaal staat. */
  planningTot?: string | null;
  dagen?: number;
}): WeekDag[] {
  const laatsteEigen = shifts.reduce<string | null>((m, s) => (m === null || s.date > m ? s.date : m), null);
  const horizon = [planningTot, laatsteEigen].filter((d): d is string => !!d).sort().pop() ?? null;
  const start = new Date(`${vanaf}T00:00:00`);

  return Array.from({ length: dagen }, (_, i) => {
    const datum = isoDate(addDays(start, i));
    const vanDeDag = shifts.filter((s) => s.date === datum).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (vanDeDag.length > 0) {
      return {
        datum,
        soort: 'dienst' as const,
        dienstnummers: [...new Set(vanDeDag.map((s) => serviceNumberOf(s)).filter((n) => n !== '--'))],
        start: vanDeDag[0].startTime,
        einde: vanDeDag[vanDeDag.length - 1].endTime,
        delen: vanDeDag.length,
      };
    }
    const leeg = { datum, dienstnummers: [], start: null, einde: null, delen: 0 };
    const afwezig = leaves.find((l) => l.status === 'approved' && l.startDate <= datum && l.endDate >= datum);
    if (afwezig) return { ...leeg, soort: afwezig.type === 'ziekte' ? 'ziek' as const : 'verlof' as const };
    return { ...leeg, soort: horizon !== null && datum <= horizon ? 'vrij' as const : 'onbekend' as const };
  });
}

const SOORT_WOORD: Record<Exclude<WeekDagSoort, 'dienst'>, string> = {
  verlof: 'verlof',
  ziek: 'ziek',
  vrij: 'vrij',
  onbekend: 'nog niet gepland',
};

/** Eén zin per dag voor schermlezers: "dienst 2101, 05:30 tot 13:45". */
export function weekDagZin(dag: WeekDag): string {
  if (dag.soort !== 'dienst') return SOORT_WOORD[dag.soort];
  const nummer = dag.dienstnummers.length > 0 ? `dienst ${dag.dienstnummers.join(' en ')}` : 'dienst';
  const delen = dag.delen > 1 ? `, ${dag.delen} delen` : '';
  return `${nummer}, ${dag.start} tot ${dag.einde}${delen}`;
}
