import type { BadgeTone } from '../components/primitives';

/**
 * Pure regels achter de vervalpil (VervalPil): hoe een vervaldatum eruitziet
 * in een tabelcel of kaart. Eén bron voor Vervaldata (chauffeurs) en
 * Voertuigen (keuring, blussers, tachograaf); tot tranche 3B stond dezelfde
 * logica twee keer, in elk scherm een kopie (23-09).
 *
 * Termijnen: verlopen (< 0) rood, binnen 30 dagen amber, binnen 90 dagen
 * oker, daarna groen. Zolang het meer dan 30 dagen is, blijft de pil stil
 * (neutraal vlak met een gekleurd puntje); binnen 30 dagen of verlopen
 * kleurt het hele vlak.
 */

/** Vandaag als ISO-dag in de lokale tijdzone (niet UTC: na 23u zou dat morgen zijn). */
export const vandaagLokaal = (nu = new Date()): string =>
  `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`;

/** Hele dagen van `vandaag` tot `iso` (negatief = verlopen). */
export const dagenTotVerval = (iso: string, vandaag = vandaagLokaal()): number =>
  Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(vandaag)) / 86400000);

export const vervalToon = (dagen: number): BadgeTone =>
  (dagen < 0 ? 'red' : dagen <= 30 ? 'amber' : dagen <= 90 ? 'oker' : 'emerald');

/** Stil = geen gekleurd vlak, alleen het puntje. */
export const vervalStil = (dagen: number): boolean => dagen > 30;

export const vervalDagenTekst = (dagen: number): string =>
  (dagen < 0 ? 'verlopen' : dagen === 0 ? 'vandaag' : `${dagen} d`);

/**
 * Compacte datum ("27 nov 2027"): de lange variant met weekdag maakte de
 * pillen zo breed dat ze op desktop niet in één kolom pasten en per rij op
 * een andere x begonnen. De volledige datum staat in de tooltip.
 */
export const kortVervalDatum = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
};
