/**
 * De Lijn-typedagkalender: elke datum valt in één van vier regelingen die
 * bepalen welke dienstregeling er rijdt. Feestdagen rijden zondagsdienst en
 * zitten dus in het type verwerkt (verzoek Jarno 30/07).
 *
 *  - 'schooldag'     ma–vr buiten de schoolvakanties
 *  - 'vakantiedag'   ma–vr binnen een Vlaamse schoolvakantie
 *  - 'zaterdag'      zaterdag (tenzij feestdag)
 *  - 'zon-feestdag'  zondag én elke wettelijke feestdag, ongeacht de weekdag
 *
 * Feestdagen worden berekend (vaste data + de Pasen-afgeleiden via de
 * Gauss-computus), de schoolvakanties zijn een dataset.
 *
 * ONDERHOUD: vul VLAAMSE_SCHOOLVAKANTIES jaarlijks aan zodra Onderwijs
 * Vlaanderen de kalender publiceert (zomer is altijd 1/7–31/8; herfst de
 * week met 1 november; kerst twee weken rond de jaarwissel; krokus en
 * paasvakantie schuiven met Pasen mee).
 */

import { addDays, isoDate } from './datum';

type Typedag = 'schooldag' | 'vakantiedag' | 'zaterdag' | 'zon-feestdag';

/** Gauss-computus: paaszondag voor een gegeven jaar (westerse kalender). */
const paaszondag = (jaar: number): Date => {
  const a = jaar % 19;
  const b = Math.floor(jaar / 100);
  const c = jaar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maand = Math.floor((h + l - 7 * m + 114) / 31); // 3 = maart, 4 = april
  const dag = ((h + l - 7 * m + 114) % 31) + 1;
  // Lokale middernacht, zodat isoDate/addDays (lokale kalender, DST-veilig)
  // er rechtstreeks op kunnen rekenen.
  return new Date(jaar, maand - 1, dag);
};

/** Wettelijke Belgische feestdagen van een jaar, als iso → naam. */
export const feestdagenVanJaar = (jaar: number): Record<string, string> => {
  const pasen = paaszondag(jaar);
  return {
    [`${jaar}-01-01`]: 'Nieuwjaar',
    [isoDate(addDays(pasen, 1))]: 'Paasmaandag',
    [`${jaar}-05-01`]: 'Dag van de Arbeid',
    [isoDate(addDays(pasen, 39))]: 'O.L.H. Hemelvaart',
    [isoDate(addDays(pasen, 50))]: 'Pinkstermaandag',
    [`${jaar}-07-21`]: 'Nationale feestdag',
    [`${jaar}-08-15`]: 'O.L.V. Hemelvaart',
    [`${jaar}-11-01`]: 'Allerheiligen',
    [`${jaar}-11-11`]: 'Wapenstilstand',
    [`${jaar}-12-25`]: 'Kerstmis',
  };
};

const feestdagCache = new Map<number, Record<string, string>>();
const feestdagenCached = (jaar: number): Record<string, string> => {
  let f = feestdagCache.get(jaar);
  if (!f) {
    f = feestdagenVanJaar(jaar);
    feestdagCache.set(jaar, f);
  }
  return f;
};

/** Naam van de feestdag op deze datum, of null. */
export const feestdagNaam = (iso: string): string | null =>
  feestdagenCached(Number(iso.slice(0, 4)))[iso] ?? null;

export type Schoolvakantie = { naam: string; van: string; tot: string };

/** Vlaamse schoolvakanties als van-t/m-periodes (inclusief), mét naam. Dit is
 *  dé dataset: de kalender-voorzet voor de dekking (schoolkalender.ts) leidt
 *  hieruit af — er stond een tweede, handmatige kopie die al uiteenliep
 *  (controle-ronde 27-08, bevinding 20).
 *  Bron: Onderwijs Vlaanderen. 2027 paas-/krokusdata controleren zodra de
 *  officiële kalender vaststaat. */
export const VLAAMSE_SCHOOLVAKANTIES: Schoolvakantie[] = [
  { naam: 'Kerstvakantie', van: '2025-12-22', tot: '2026-01-04' },
  { naam: 'Krokusvakantie', van: '2026-02-16', tot: '2026-02-22' },
  { naam: 'Paasvakantie', van: '2026-04-06', tot: '2026-04-19' },
  { naam: 'Zomervakantie', van: '2026-07-01', tot: '2026-08-31' },
  { naam: 'Herfstvakantie', van: '2026-11-02', tot: '2026-11-08' },
  { naam: 'Kerstvakantie', van: '2026-12-21', tot: '2027-01-03' },
  { naam: 'Krokusvakantie', van: '2027-02-08', tot: '2027-02-14' }, // Aswoensdag 10/02
  { naam: 'Paasvakantie', van: '2027-03-29', tot: '2027-04-11' }, // Pasen 28/03 — controleren
  { naam: 'Zomervakantie', van: '2027-07-01', tot: '2027-08-31' },
  { naam: 'Herfstvakantie', van: '2027-11-01', tot: '2027-11-07' },
  { naam: 'Kerstvakantie', van: '2027-12-20', tot: '2028-01-02' },
];

export const isSchoolvakantie = (iso: string): boolean =>
  VLAAMSE_SCHOOLVAKANTIES.some((v) => iso >= v.van && iso <= v.tot);

/** Het De Lijn-typedag-type voor een iso-datum (YYYY-MM-DD). */
export const typedag = (iso: string): Typedag => {
  if (feestdagNaam(iso)) return 'zon-feestdag';
  // Weekdag UTC-veilig uit de datum-string (geen lokale-tijd-verrassingen).
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (dow === 0) return 'zon-feestdag';
  if (dow === 6) return 'zaterdag';
  return isSchoolvakantie(iso) ? 'vakantiedag' : 'schooldag';
};

/** Korte label/tooltip voor UI-markering. */
export const typedagLabel = (iso: string): { kort: string; titel: string } | null => {
  const feest = feestdagNaam(iso);
  if (feest) return { kort: 'F', titel: `${feest} — zon-/feestdagregeling` };
  switch (typedag(iso)) {
    case 'vakantiedag':
      return { kort: 'V', titel: 'Schoolvakantie — vakantieregeling' };
    default:
      return null; // gewone school-/za-/zo-dagen krijgen geen extra markering
  }
};
