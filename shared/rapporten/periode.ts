/**
 * Periode-rekenkunde voor de rapporten, op zone-loze ISO-dagen ('JJJJ-MM-DD').
 * Alles rekent in UTC op de cijfers van de string zelf, nooit op een lokale
 * Date: "deze maand" is in Brussel en op de server (UTC) dezelfde periode, en
 * de overgang naar zomertijd kost geen dag. Alleen `vandaag` komt van buiten
 * (de client geeft zijn lokale kalenderdag door).
 */

export type Periode = { van: string; tot: string };
export type PeriodeKeuze = 'deze-maand' | 'vorige-maand' | 'dit-kwartaal' | 'dit-jaar' | 'vrij';

export const PERIODE_KEUZES: ReadonlyArray<{ waarde: PeriodeKeuze; label: string }> = [
  { waarde: 'deze-maand', label: 'Deze maand' },
  { waarde: 'vorige-maand', label: 'Vorige maand' },
  { waarde: 'dit-kwartaal', label: 'Dit kwartaal' },
  { waarde: 'dit-jaar', label: 'Dit jaar' },
  { waarde: 'vrij', label: 'Vrije periode' },
];

/** Langste periode die een rapport in één keer mag opvragen (een schrikkeljaar past net). */
export const MAX_PERIODE_DAGEN = 366;

const ISO_DAG = /^(\d{4})-(\d{2})-(\d{2})$/;

const twee = (n: number) => String(n).padStart(2, '0');
const uitUtc = (d: Date): string => `${d.getUTCFullYear()}-${twee(d.getUTCMonth() + 1)}-${twee(d.getUTCDate())}`;

/** Echte kalenderdag? ('2026-02-30' en '2026-13-01' vallen af.) */
export const isIsoDag = (waarde: unknown): waarde is string => {
  if (typeof waarde !== 'string') return false;
  const m = ISO_DAG.exec(waarde);
  if (!m) return false;
  const [j, mnd, dag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(j, mnd - 1, dag));
  return d.getUTCFullYear() === j && d.getUTCMonth() === mnd - 1 && d.getUTCDate() === dag;
};

const delen = (iso: string): [number, number, number] => {
  const m = ISO_DAG.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [1970, 1, 1];
};

/** Eerste en laatste dag van een maand (maand 1–12; schuift over jaargrenzen). */
const maandPeriode = (jaar: number, maand: number): Periode => ({
  van: uitUtc(new Date(Date.UTC(jaar, maand - 1, 1))),
  tot: uitUtc(new Date(Date.UTC(jaar, maand, 0))),
});

export const jaarPeriode = (jaar: number): Periode => ({ van: `${jaar}-01-01`, tot: `${jaar}-12-31` });

/** De periode van een snelkeuze, gerekend vanaf `vandaag`. 'vrij' heeft geen eigen periode. */
export const periodeVoor = (keuze: Exclude<PeriodeKeuze, 'vrij'>, vandaag: string): Periode => {
  const [jaar, maand] = delen(vandaag);
  switch (keuze) {
    case 'deze-maand': return maandPeriode(jaar, maand);
    case 'vorige-maand': return maandPeriode(jaar, maand - 1);
    case 'dit-kwartaal': {
      const eersteMaand = Math.floor((maand - 1) / 3) * 3 + 1;
      return { van: maandPeriode(jaar, eersteMaand).van, tot: maandPeriode(jaar, eersteMaand + 2).tot };
    }
    case 'dit-jaar': return jaarPeriode(jaar);
  }
};

/** Welke snelkeuze hoort bij deze datums? Geen enkele = 'vrij'. */
export const herkenPeriode = (periode: Periode, vandaag: string): PeriodeKeuze => {
  for (const keuze of ['deze-maand', 'vorige-maand', 'dit-kwartaal', 'dit-jaar'] as const) {
    const p = periodeVoor(keuze, vandaag);
    if (p.van === periode.van && p.tot === periode.tot) return keuze;
  }
  return 'vrij';
};

/** Aantal kalenderdagen, begin en einde meegeteld; 0 bij een ongeldige of omgekeerde periode. */
export const dagenInPeriode = ({ van, tot }: Periode): number => {
  if (!isIsoDag(van) || !isIsoDag(tot) || tot < van) return 0;
  const [vj, vm, vd] = delen(van);
  const [tj, tm, td] = delen(tot);
  return Math.round((Date.UTC(tj, tm - 1, td) - Date.UTC(vj, vm - 1, vd)) / 86_400_000) + 1;
};

/** Reden waarom een periode niet kan, of null als ze geldig is. */
export const periodeFout = (periode: Partial<Periode>): { veld: 'van' | 'tot'; tekst: string } | null => {
  if (!isIsoDag(periode.van)) return { veld: 'van', tekst: 'Kies een begindatum' };
  if (!isIsoDag(periode.tot)) return { veld: 'tot', tekst: 'Kies een einddatum' };
  if (periode.tot < periode.van) return { veld: 'tot', tekst: 'De einddatum ligt voor de begindatum' };
  if (dagenInPeriode({ van: periode.van, tot: periode.tot }) > MAX_PERIODE_DAGEN) return { veld: 'tot', tekst: `Kies een periode van hoogstens ${MAX_PERIODE_DAGEN} dagen` };
  return null;
};

/**
 * Een bron begint zelden precies op de eerste dag van de gevraagde periode
 * (het eerste verlof van het jaar valt op 5 januari, niet op 1 januari). Pas
 * als de periode meer dan een maand vóór de eerste gegevens begint, noemen we
 * dat "deels zonder gegevens"; anders zou die regel boven bijna elk rapport staan.
 */
export const DEELS_MARGE_DAGEN = 31;

/**
 * Hoe ligt de gevraagde periode tegenover wat de bron heeft?
 *  - 'geen-bron'  er is nog niets geregistreerd
 *  - 'buiten'     de periode valt volledig vóór of na de gegevens
 *  - 'deels'      de periode begint ruim (meer dan DEELS_MARGE_DAGEN) vóór de
 *                 eerste gegevens; de rest overlapt
 *  - 'binnen'     niets aan de hand
 * Een periode die verder loopt dan de laatste gegevens is geen 'deels': elke
 * lopende maand eindigt in de toekomst, dat is geen ontbrekende data.
 */
export type BereikToestand = 'geen-bron' | 'buiten' | 'deels' | 'binnen';
export const bereikToestand = (periode: Periode, bereik: Periode | null): BereikToestand => {
  if (!bereik) return 'geen-bron';
  if (periode.tot < bereik.van || periode.van > bereik.tot) return 'buiten';
  if (periode.van >= bereik.van) return 'binnen';
  // dagenInPeriode telt beide randen mee: van 01/01 tot 05/01 = 5, het gat is 4.
  return dagenInPeriode({ van: periode.van, tot: bereik.van }) - 1 > DEELS_MARGE_DAGEN ? 'deels' : 'binnen';
};
