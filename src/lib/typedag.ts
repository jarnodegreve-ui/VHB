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

import { feestdagNaam, feestdagenVanJaar } from '../../shared/wettelijkeFeestdagen';

type Typedag = 'schooldag' | 'vakantiedag' | 'zaterdag' | 'zon-feestdag';

// De feestdagberekening zelf staat in shared/wettelijkeFeestdagen.ts (de
// verlofsaldo-telling draait ook op de server); hier doorgeëxporteerd zodat
// bestaande imports blijven werken.
export { feestdagNaam, feestdagenVanJaar };

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
  { naam: 'Paasvakantie', van: '2027-03-29', tot: '2027-04-11' }, // Pasen 28/03, controleren
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
  if (feest) return { kort: 'F', titel: `${feest}, zon-/feestdagregeling` };
  switch (typedag(iso)) {
    case 'vakantiedag':
      return { kort: 'V', titel: 'Schoolvakantie, vakantieregeling' };
    default:
      return null; // gewone school-/za-/zo-dagen krijgen geen extra markering
  }
};
