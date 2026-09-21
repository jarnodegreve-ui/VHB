/**
 * Periode-rekenkunde voor de rapporten, op zone-loze ISO-dagen ('JJJJ-MM-DD').
 * Alles rekent in UTC op de cijfers van de string zelf, nooit op een lokale
 * Date: "deze maand" is in Brussel en op de server (UTC) dezelfde periode, en
 * de overgang naar zomertijd kost geen dag. Alleen `vandaag` komt van buiten
 * (de client geeft zijn lokale kalenderdag door).
 */

export type Periode = { van: string; tot: string };
export type PeriodeKeuze =
  | 'deze-week' | 'vorige-week' | 'komende-4-weken'
  | 'deze-maand' | 'vorige-maand' | 'volgende-maand' | 'dit-kwartaal' | 'dit-jaar' | 'vrij';
/** Een snelkeuze met een eigen periode (alles behalve 'vrij'). */
export type VastePeriodeKeuze = Exclude<PeriodeKeuze, 'vrij'>;

const KEUZE_LABEL: Record<PeriodeKeuze, string> = {
  'deze-week': 'Deze week',
  'vorige-week': 'Vorige week',
  'komende-4-weken': 'Komende 4 weken',
  'deze-maand': 'Deze maand',
  'vorige-maand': 'Vorige maand',
  'volgende-maand': 'Volgende maand',
  'dit-kwartaal': 'Dit kwartaal',
  'dit-jaar': 'Dit jaar',
  vrij: 'Vrije periode',
};

/**
 * Welke snelkeuzes een periodefilter aanbiedt. Een rapport kijkt terug over
 * maanden (`terug`, de standaard: ziekte, verlof, werken), leest de planning
 * per dag (`dagen`: deze week, vorige week) of kijkt vooruit (`vooruit`:
 * openstaande diensten, waar het verleden niets meer zegt).
 */
export type PeriodeSnelkeuze = 'terug' | 'dagen' | 'vooruit';

const KEUZES_PER_SOORT: Record<PeriodeSnelkeuze, readonly PeriodeKeuze[]> = {
  terug: ['deze-maand', 'vorige-maand', 'dit-kwartaal', 'dit-jaar', 'vrij'],
  dagen: ['deze-week', 'vorige-week', 'deze-maand', 'vorige-maand', 'vrij'],
  vooruit: ['deze-week', 'komende-4-weken', 'deze-maand', 'volgende-maand', 'vrij'],
};

export const periodeKeuzesVoor = (soort: PeriodeSnelkeuze = 'terug'): ReadonlyArray<{ waarde: PeriodeKeuze; label: string }> =>
  KEUZES_PER_SOORT[soort].map((waarde) => ({ waarde, label: KEUZE_LABEL[waarde] }));

/** De snelkeuzes van een rapport dat terugkijkt (de standaard). */
export const PERIODE_KEUZES = periodeKeuzesVoor('terug');

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

/** ISO-dag plus n dagen, op de cijfers van de string (UTC): een zomeruurwissel kost geen dag. */
export const dagPlus = (iso: string, n: number): string => {
  const [j, m, d] = delen(iso);
  return uitUtc(new Date(Date.UTC(j, m - 1, d + n)));
};

/** De maandag van de week waarin deze dag valt (ISO-week: maandag tot en met zondag). */
export const maandagVanWeek = (iso: string): string => {
  const [j, m, d] = delen(iso);
  const weekdag = new Date(Date.UTC(j, m - 1, d)).getUTCDay();
  return dagPlus(iso, -((weekdag + 6) % 7));
};

/** De periode van een snelkeuze, gerekend vanaf `vandaag`. 'vrij' heeft geen eigen periode. */
export const periodeVoor = (keuze: VastePeriodeKeuze, vandaag: string): Periode => {
  const [jaar, maand] = delen(vandaag);
  switch (keuze) {
    case 'deze-week': return { van: maandagVanWeek(vandaag), tot: dagPlus(maandagVanWeek(vandaag), 6) };
    case 'vorige-week': return { van: dagPlus(maandagVanWeek(vandaag), -7), tot: dagPlus(maandagVanWeek(vandaag), -1) };
    // Vandaag en de 27 dagen erna: vier volle weken, te beginnen bij vandaag (gisteren is geen gat meer).
    case 'komende-4-weken': return { van: vandaag, tot: dagPlus(vandaag, 27) };
    case 'volgende-maand': return maandPeriode(jaar, maand + 1);
    case 'deze-maand': return maandPeriode(jaar, maand);
    case 'vorige-maand': return maandPeriode(jaar, maand - 1);
    case 'dit-kwartaal': {
      const eersteMaand = Math.floor((maand - 1) / 3) * 3 + 1;
      return { van: maandPeriode(jaar, eersteMaand).van, tot: maandPeriode(jaar, eersteMaand + 2).tot };
    }
    case 'dit-jaar': return jaarPeriode(jaar);
  }
};

/** Welke snelkeuze (uit de lijst van dit filter) hoort bij deze datums? Geen enkele = 'vrij'. */
export const herkenPeriode = (periode: Periode, vandaag: string, soort: PeriodeSnelkeuze = 'terug'): PeriodeKeuze => {
  for (const keuze of KEUZES_PER_SOORT[soort]) {
    if (keuze === 'vrij') continue;
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

/** Eerste dag van de maand van deze dag. */
export const eersteVanMaand = (iso: string): string => `${iso.slice(0, 7)}-01`;
/** Laatste dag van de maand van deze dag (schrikkeljaren kloppen: dag 0 van de volgende maand, in UTC). */
export const laatsteVanMaand = (iso: string): string => {
  const [j, m] = delen(iso);
  return maandPeriode(j, m).tot;
};
/** Bestaat deze periode uit hele kalendermaanden (van de 1e tot en met de laatste dag)? */
export const isHeleMaanden = ({ van, tot }: Periode): boolean =>
  isIsoDag(van) && isIsoDag(tot) && van === eersteVanMaand(van) && tot === laatsteVanMaand(tot);
/** Rondt een periode af op hele maanden: terug naar de 1e, vooruit naar de laatste dag. */
export const opHeleMaanden = ({ van, tot }: Periode): Periode => ({ van: eersteVanMaand(van), tot: laatsteVanMaand(tot) });

/** De maanden ('JJJJ-MM') die een periode raakt, in volgorde. */
export const maandenInPeriode = ({ van, tot }: Periode): string[] => {
  if (!isIsoDag(van) || !isIsoDag(tot) || tot < van) return [];
  const uit: string[] = [];
  let [j, m] = delen(van);
  const einde = tot.slice(0, 7);
  while (`${j}-${twee(m)}` <= einde) {
    uit.push(`${j}-${twee(m)}`);
    m += 1;
    if (m > 12) { m = 1; j += 1; }
  }
  return uit;
};

/**
 * Reden waarom een periode niet kan, of null als ze geldig is. `heleMaanden`:
 * het rapport telt per kalendermaand (zoals het maandoverzicht), dus een
 * periode die midden in een maand begint of eindigt is daar een fout.
 */
export const periodeFout = (periode: Partial<Periode>, opties: { heleMaanden?: boolean } = {}): { veld: 'van' | 'tot'; tekst: string } | null => {
  if (!isIsoDag(periode.van)) return { veld: 'van', tekst: opties.heleMaanden ? 'Kies een beginmaand' : 'Kies een begindatum' };
  if (!isIsoDag(periode.tot)) return { veld: 'tot', tekst: opties.heleMaanden ? 'Kies een eindmaand' : 'Kies een einddatum' };
  if (periode.tot < periode.van) return { veld: 'tot', tekst: opties.heleMaanden ? 'De eindmaand ligt voor de beginmaand' : 'De einddatum ligt voor de begindatum' };
  if (opties.heleMaanden) {
    if (periode.van !== eersteVanMaand(periode.van)) return { veld: 'van', tekst: 'Dit rapport telt per hele maand: begin op de eerste dag van een maand' };
    if (periode.tot !== laatsteVanMaand(periode.tot)) return { veld: 'tot', tekst: 'Dit rapport telt per hele maand: eindig op de laatste dag van een maand' };
  }
  if (dagenInPeriode({ van: periode.van, tot: periode.tot }) > MAX_PERIODE_DAGEN) return { veld: 'tot', tekst: opties.heleMaanden ? 'Kies hoogstens twaalf maanden' : `Kies een periode van hoogstens ${MAX_PERIODE_DAGEN} dagen` };
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
