import type { LeaveRequest, Shift } from '../types';
import { serviceNumberOf } from './format';

const DAG_MS = 86_400_000;

/** Een echt bestaande ISO-dag, uitgedrukt in UTC-dagen zodat DST niet meetelt. */
const dagNummer = (iso: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) return null;
  return ms / DAG_MS;
};

const ziektePeriode = (melding: LeaveRequest): { van: number; tot: number } | null => {
  if (melding.type !== 'ziekte' || melding.status !== 'approved') return null;
  const van = dagNummer(melding.startDate);
  const tot = dagNummer(melding.endDate);
  return van === null || tot === null || van > tot ? null : { van, tot };
};

export interface ZiekteMaandInzicht {
  /** Kalendermaand, 1 t/m 12. */
  maand: number;
  kalenderdagen: number;
  /** Afzonderlijke registraties die deze maand raken, geen nieuwe episodes. */
  meldingen: number;
}

export interface ZiekteChauffeurInzicht {
  userId: string;
  kalenderdagen: number;
  meldingen: number;
}

export interface ZiekteJaarInzicht {
  jaar: number;
  /** Laatste meegetelde dag; null als het gekozen jaar nog in de toekomst ligt. */
  totEnMet: string | null;
  /** Som van unieke geregistreerde kalenderdagen per persoon. */
  totaalKalenderdagen: number;
  /** Registraties die het gekozen jaar t/m vandaag raken, geen ziekte-episodes. */
  aantalMeldingen: number;
  maanden: ZiekteMaandInzicht[];
  chauffeurs: ZiekteChauffeurInzicht[];
}

/** Huidig jaar plus alle eerdere jaren met geregistreerde ziekte, nieuwste eerst. */
export function beschikbareZiekteJaren(meldingen: readonly LeaveRequest[], vandaag: string): number[] {
  const peildag = dagNummer(vandaag);
  if (peildag === null) return [];
  const huidigJaar = Number(vandaag.slice(0, 4));
  const jaren = new Set([huidigJaar]);
  for (const melding of meldingen) {
    const periode = ziektePeriode(melding);
    if (!periode || periode.van > peildag) continue;
    const laatsteJaar = Math.min(Number(melding.endDate.slice(0, 4)), huidigJaar);
    for (let jaar = Number(melding.startDate.slice(0, 4)); jaar <= laatsteJaar; jaar++) jaren.add(jaar);
  }
  return [...jaren].sort((a, b) => b - a);
}

/**
 * Geregistreerde ziekte in één kalenderjaar, alleen t/m vandaag. Een dag
 * telt per chauffeur eenmaal, ook bij overlappende meldingen. Weekends en
 * feestdagen tellen mee: dit zijn geen gemiste werkdagen of loongegevens.
 * Meldingen blijven afzonderlijke records; een registratie over twee
 * maanden telt in beide maandkolommen, maar eenmaal in het jaartotaal.
 */
export function berekenZiekteInzicht(meldingen: readonly LeaveRequest[], jaar: number, vandaag: string): ZiekteJaarInzicht {
  const uit: ZiekteJaarInzicht = {
    jaar,
    totEnMet: null,
    totaalKalenderdagen: 0,
    aantalMeldingen: 0,
    maanden: Array.from({ length: 12 }, (_, i) => ({ maand: i + 1, kalenderdagen: 0, meldingen: 0 })),
    chauffeurs: [],
  };
  const jaarTekst = String(jaar).padStart(4, '0');
  const begin = dagNummer(`${jaarTekst}-01-01`);
  const einde = dagNummer(`${jaarTekst}-12-31`);
  const peildag = dagNummer(vandaag);
  if (begin === null || einde === null || peildag === null || begin > peildag) return uit;
  const tot = Math.min(einde, peildag);
  uit.totEnMet = new Date(tot * DAG_MS).toISOString().slice(0, 10);

  const perChauffeur = new Map<string, { dagen: Set<number>; meldingen: number }>();
  const geteldeIds = new Set<string>();
  for (const melding of meldingen) {
    const periode = ziektePeriode(melding);
    if (!periode || geteldeIds.has(melding.id)) continue;
    const van = Math.max(begin, periode.van);
    const laatste = Math.min(tot, periode.tot);
    if (van > laatste) continue;
    geteldeIds.add(melding.id);
    uit.aantalMeldingen++;
    const userId = String(melding.userId);
    const chauffeur = perChauffeur.get(userId) ?? { dagen: new Set<number>(), meldingen: 0 };
    chauffeur.meldingen++;
    const geraakteMaanden = new Set<number>();
    for (let dag = van; dag <= laatste; dag++) {
      const maand = new Date(dag * DAG_MS).getUTCMonth();
      geraakteMaanden.add(maand);
      if (chauffeur.dagen.has(dag)) continue;
      chauffeur.dagen.add(dag);
      uit.maanden[maand].kalenderdagen++;
      uit.totaalKalenderdagen++;
    }
    for (const maand of geraakteMaanden) uit.maanden[maand].meldingen++;
    perChauffeur.set(userId, chauffeur);
  }
  uit.chauffeurs = [...perChauffeur].map(([userId, telling]) => ({
    userId, kalenderdagen: telling.dagen.size, meldingen: telling.meldingen,
  })).sort((a, b) => b.kalenderdagen - a.kalenderdagen || a.userId.localeCompare(b.userId));
  return uit;
}

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
