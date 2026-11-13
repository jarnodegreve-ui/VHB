import { tijdvak } from './format';
import { normalizePlanningToken } from './planning';
import type { MonthPlanning } from './monthPlanning';
import type { Shift } from '../types';

/**
 * De uren van een dienst in Dienstruil (ronde 6, 11-11, punt 12). Wie een ruil
 * voorgesteld krijgt, zag bij de dienst die hij zou krijgen geen uren: die
 * dienst staat niet in zijn eigen planning. Het maandbord (GET
 * /api/month-planning) is voor elke rol leesbaar en draagt per cel de tijden
 * van de dienst op díe dag, met het dagtype en de dienstregelingversie van die
 * dag al verwerkt (api/_lib/celWaarheid.ts). Hier wordt alleen gelezen wat het
 * bord zegt: nooit zelf rekenen, nooit raden.
 *
 * Bewust klein gehouden: Dienstruil zit in de warmup van de chauffeur.
 */

/** Het bord per maand ('JJJJ-MM') zoals het dit bezoek binnenkwam: de cellen,
 *  of geen ingang zolang het laadt en niets bruikbaars als het mislukte. */
export type BordPerMaand = Record<string, MonthPlanning['cells'] | null | undefined>;

/** Eén deel zoals het bord het geeft: "06:45–10:00" of "06:45–10:00 (loop 4500)". */
const DEEL = /^\s*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})(?:\s*\(loop[^)]*\))?\s*$/;

/**
 * De tijdvakken van dienst `code` op `datum` uit de cel van `persoonId`, één
 * per deel en zonder loopnummer: ["06:45–10:00", "15:45–19:35"]. Null zodra
 * iets niet zeker is: het bord van die maand is er niet (laadt nog, mislukt,
 * onverwachte vorm), die persoon heeft die dag geen cel, de cel draagt een
 * andere code (ook een samengestelde zoals "4101/4205": de tijden van een cel
 * zijn niet per dienst te splitsen) of geen dienst, of een deel is niet te
 * lezen. Dan toont het scherm niets.
 */
export function dienstUrenOpBord(bord: BordPerMaand, persoonId: unknown, datum: unknown, code: unknown): string[] | null {
  const dag = String(datum ?? '');
  const gevraagd = normalizePlanningToken(code);
  // `any`: wat van de server komt is hier nog niets; elke stap hieronder toetst zelf.
  const cel = (bord[dag.slice(0, 7)] as any)?.[String(persoonId ?? '')]?.[dag];
  if (!gevraagd || !cel || cel.kind !== 'service' || normalizePlanningToken(cel.code) !== gevraagd) return null;
  if (!Array.isArray(cel.segments) || cel.segments.length === 0) return null;
  const uren: string[] = [];
  for (const deel of cel.segments) {
    const m = typeof deel === 'string' ? DEEL.exec(deel) : null;
    if (!m) return null;
    uren.push(tijdvak(m[1], m[2]));
  }
  return uren;
}

/**
 * Dezelfde vorm uit de eigen planning: de tijdvakken van alle delen van dienst
 * `code` die `persoonId` op `datum` rijdt, vroegste eerst. Voor de dienst die
 * de kijker zelf afgeeft: die staat in zijn eigen planning, daar is het bord
 * niet voor nodig. Null als hij die dienst die dag niet (meer) heeft.
 */
export function dienstUrenUitPlanning(shifts: readonly Shift[], persoonId: unknown, datum: unknown, code: unknown): string[] | null {
  const gevraagd = normalizePlanningToken(code);
  // Als tekst gesorteerd staat het vroegste deel vooraan ("06:45–…" vóór "15:45–…").
  const uren = shifts
    .filter((s) => gevraagd && String(s.driverId) === String(persoonId) && s.date === datum && normalizePlanningToken(s.line) === gevraagd)
    .map((s) => tijdvak(s.startTime, s.endTime))
    .sort();
  return uren.length ? uren : null;
}
