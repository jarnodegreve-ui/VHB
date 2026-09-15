import type { Shift } from '../types';
import { normalizePlanningToken, sortedNameToken } from './planning';
import { addDagen } from './datum';

type Kandidaat = { id: string | number; name: string };

/**
 * Rangschikking van vervanger-keuzelijsten (herverdelen, toewijzen, wissel):
 * wie die dag vrij is bovenaan, daarbinnen wie die week (ma–zo) het minst
 * werkte, dan de kortste aaneengesloten reeks rond de dag, dan het laagste
 * maandtotaal, dan naam — zelfde criteria als de advisor server-side
 * (keuze Jarno 19-08). De invalbeurten-teller uit dienstruilen telde eerst
 * mee, maar zolang chauffeurs het portaal amper gebruiken staat die overal
 * op nul; de gewerkte dagen komen uit de geïmporteerde planning zelf.
 */

/** Maandag van de week (ma–zo) waarin `iso` valt. */
const maandagVan = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDagen(iso, -((d.getUTCDay() + 6) % 7));
};

/** Werkdagen per chauffeur uit de planning-lijst. */
export const werkdagenUitShifts = (shifts: Shift[]): Map<string, Set<string>> => {
  const per = new Map<string, Set<string>>();
  for (const s of shifts) {
    if (!s.date) continue;
    const id = String(s.driverId);
    if (!per.has(id)) per.set(id, new Set());
    per.get(id)!.add(s.date);
  }
  return per;
};

export type KandidaatInfo = {
  user: Kandidaat;
  vrij: boolean;
  /** Al gewerkte dagen in de week (ma–zo) van de dag, de dag zelf niet meegeteld. */
  dagenDezeWeek: number;
  /** Aaneengesloten reeks werkdagen als deze dag een werkdag wordt. */
  reeks: number;
  /** Al gewerkte dagen in de kalendermaand van de dag. */
  dagenDezeMaand: number;
};

/**
 * Sorteer kandidaten: vrij eerst, dan minst gewerkt die week, dan kortste
 * reeks, dan laagste maandtotaal, dan naam. `isVrij` bepaalt per gebruiker of
 * hij die dag niets heeft — de aanroeper weet waar die kennis zit
 * (shifts-lijst of maandplanning-cellen); `werkdagen` levert dezelfde bron
 * als set per chauffeur (zie werkdagenUitShifts).
 */
export const rangschikKandidaten = (
  kandidaten: Kandidaat[],
  isVrij: (u: Kandidaat) => boolean,
  werkdagen: Map<string, Set<string>>,
  datum: string,
): KandidaatInfo[] => {
  const maandag = maandagVan(datum);
  const maand = datum.slice(0, 7);
  const info = (user: Kandidaat): KandidaatInfo => {
    const dagen = werkdagen.get(String(user.id)) ?? new Set<string>();
    let week = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDagen(maandag, i);
      if (d !== datum && dagen.has(d)) week++;
    }
    let maandTotaal = 0;
    for (const d of dagen) {
      if (d !== datum && d.slice(0, 7) === maand) maandTotaal++;
    }
    let reeks = 1;
    for (let d = addDagen(datum, -1), g = 0; dagen.has(d) && g < 366; d = addDagen(d, -1), g++) reeks++;
    for (let d = addDagen(datum, 1), g = 0; dagen.has(d) && g < 366; d = addDagen(d, 1), g++) reeks++;
    return { user, vrij: isVrij(user), dagenDezeWeek: week, reeks, dagenDezeMaand: maandTotaal };
  };
  return kandidaten
    .map(info)
    .sort((a, b) =>
      Number(b.vrij) - Number(a.vrij) ||
      a.dagenDezeWeek - b.dagenDezeWeek ||
      a.reeks - b.reeks ||
      a.dagenDezeMaand - b.dagenDezeMaand ||
      a.user.name.localeCompare(b.user.name),
    );
};

/** Optie-label: "Gino De Jaeger · vrij · 2 dagen deze week". Bij nul gewerkte
 *  dagen die week blijft het label kort — de volgorde zegt het al. */
export const kandidaatLabel = (k: KandidaatInfo, metVrij = true): string => {
  const delen = [k.user.name];
  if (metVrij && k.vrij) delen.push('vrij');
  if (k.dagenDezeWeek > 0) delen.push(`${k.dagenDezeWeek} ${k.dagenDezeWeek === 1 ? 'dag' : 'dagen'} deze week`);
  return delen.join(' · ');
};

/** Vrij-op-datum op basis van de planning-lijst (dashboard, Ziekte-blad).
 *  Geef `nietBeschikbaar` (uit nietBeschikbaarUitMatrix) mee zodat ook wie
 *  in de Excel op ZIEK/OPL/... staat niet als vrij telt. */
export const vrijOpDatum = (shifts: Shift[], datum: string, nietBeschikbaar?: ReadonlySet<string>) => {
  const bezet = new Set(shifts.filter((s) => s.date === datum).map((s) => String(s.driverId)));
  return (u: Kandidaat) => !bezet.has(String(u.id)) && !nietBeschikbaar?.has(String(u.id));
};

/** Overname-codes uit de matrix (zelfde lijst als TAKEOVER_CODES op de server). */
const OVERNAME_CODES = new Set(['vrij', 'bv', 'tk', 'ta']);

/**
 * Wie volgens de planningsmatrix die dag niet beschikbaar is: een code die
 * geen overname-code en geen lege cel is (ziek, opl, kv, gar, ...). Zonder
 * portaalregistratie bestond zo iemand niet voor vrijOpDatum en stond hij
 * als "vrij" in de vervangerlijsten (bevinding 15-09). Dienst-codes komen
 * hier ook in terecht; die chauffeurs waren via de planning al bezet.
 */
export const nietBeschikbaarUitMatrix = (
  rows: Array<{ source_date: string; assignments: Record<string, string> }>,
  users: Array<{ id: string | number; name: string }>,
  datum: string,
): Set<string> => {
  const idByToken = new Map<string, string>();
  for (const u of users) {
    idByToken.set(normalizePlanningToken(u.name), String(u.id));
    idByToken.set(sortedNameToken(u.name), String(u.id));
  }
  const uit = new Set<string>();
  for (const row of rows) {
    if (String(row.source_date) !== datum) continue;
    const assignments = row.assignments && typeof row.assignments === 'object' && !Array.isArray(row.assignments) ? row.assignments : {};
    for (const [naam, rawCode] of Object.entries(assignments)) {
      const code = normalizePlanningToken(rawCode);
      if (!code || OVERNAME_CODES.has(code)) continue;
      const id = idByToken.get(normalizePlanningToken(naam)) ?? idByToken.get(sortedNameToken(naam));
      if (id) uit.add(id);
    }
  }
  return uit;
};
