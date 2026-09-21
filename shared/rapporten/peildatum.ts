import { isIsoDag } from './periode.js';

/**
 * Rekenen tegenover een peildatum, op zone-loze ISO-dagen ('JJJJ-MM-DD') en
 * volledig in UTC op de cijfers van de string: leeftijd van een voertuig,
 * anciënniteit, resterende dagen tot een vervaldatum, doorlooptijd van een
 * defect. De peildatum zelf komt van buiten (de server geeft zijn kalenderdag
 * in Brussel door), dus dezelfde invoer geeft in elke tijdzone hetzelfde
 * cijfer.
 */

const MS_PER_DAG = 86_400_000;

const dagNr = (iso: string): number => {
  const [j, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(j, m - 1, d) / MS_PER_DAG;
};

/** De ISO-dag vooraan in een datum of tijdstip ('2026-09-21T08:00:00Z' → '2026-09-21'), of null als er geen echte dag staat. */
export const isoDagVan = (waarde: unknown): string | null => {
  if (typeof waarde !== 'string') return null;
  const dag = waarde.slice(0, 10);
  return isIsoDag(dag) ? dag : null;
};

/**
 * De kalenderdag in België van een tijdstip ('2026-09-18T22:30:00Z' →
 * '2026-09-19'): een melding van 00:30 hoort bij de dag waarop ze in de
 * garage binnenkwam, niet bij de UTC-dag van de server. Een kale ISO-dag
 * blijft wat hij is; null bij iets wat geen tijdstip is.
 */
export const brusselseDag = (waarde: unknown): string | null => {
  if (typeof waarde !== 'string' || !waarde) return null;
  if (waarde.length <= 10) return isoDagVan(waarde);
  const d = new Date(waarde);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
};

/** Kalenderdagen van `van` tot `tot` (tot − van): morgen = 1, gisteren = −1. Null bij een ongeldige dag. */
export const dagenTussen = (van: string | null | undefined, tot: string | null | undefined): number | null => {
  const a = isoDagVan(van);
  const b = isoDagVan(tot);
  return a && b ? Math.round(dagNr(b) - dagNr(a)) : null;
};

/** De verjaardag van `iso` in `jaar`, als dagnummer. 29 februari valt in een gewoon jaar op 1 maart (Date.UTC schuift door). */
const verjaardag = (iso: string, jaar: number): number => {
  const [, m, d] = iso.split('-').map(Number);
  return Date.UTC(jaar, m - 1, d) / MS_PER_DAG;
};

/**
 * Jaren tussen twee dagen als kommagetal, op één decimaal: volle jaren plus
 * het deel van het lopende jaar (van verjaardag tot verjaardag, dus een
 * schrikkeljaar telt 366 dagen). Null zonder geldige begindatum of als die
 * na de peildatum ligt: een voertuig dat nog niet in dienst is heeft geen
 * leeftijd.
 */
export const jarenTussen = (van: string | null | undefined, peildatum: string): number | null => {
  const begin = isoDagVan(van);
  const eind = isoDagVan(peildatum);
  if (!begin || !eind || begin > eind) return null;
  const eindNr = dagNr(eind);
  let jaar = Number(eind.slice(0, 4));
  if (verjaardag(begin, jaar) > eindNr) jaar -= 1;
  const vorige = verjaardag(begin, jaar);
  const volgende = verjaardag(begin, jaar + 1);
  const jaren = jaar - Number(begin.slice(0, 4)) + (eindNr - vorige) / (volgende - vorige);
  return Math.round(jaren * 10) / 10;
};

/** Toestand van een vervaldatum tegenover de peildatum. */
export type VervalStatus = 'vervallen' | 'binnenkort' | 'in_orde' | 'geen_datum';
/** Tot en met zoveel dagen vooraf heet een vervaldatum "binnenkort" (de eerste herinnering van de dagelijkse digest valt ook op 90 dagen). */
export const BINNENKORT_DAGEN = 90;

export const vervalStatus = (resterend: number | null): VervalStatus =>
  resterend === null ? 'geen_datum' : resterend < 0 ? 'vervallen' : resterend <= BINNENKORT_DAGEN ? 'binnenkort' : 'in_orde';

export const VERVAL_STATUS_LABEL: Record<VervalStatus, string> = {
  vervallen: 'Vervallen',
  binnenkort: 'Binnenkort',
  in_orde: 'In orde',
  geen_datum: 'Geen datum',
};

/** De keuzes van een termijnfilter ("vervalt binnen …"); `alles` is de standaard. */
export const TERMIJN_KEUZES = ['alles', '30', '60', '90'] as const;
export type TermijnKeuze = (typeof TERMIJN_KEUZES)[number];

/**
 * Past een vervaldatum in de gekozen termijn? "Binnen 30 dagen" is alles wat
 * uiterlijk over 30 dagen vervalt, dus ook wat al vervallen is: dat is het
 * dringendste. Zonder datum (null) hoort een rij er altijd bij: een
 * ontbrekende datum is net wat er gezien moet worden.
 */
export const pastInTermijn = (resterend: number | null, termijn: string | undefined): boolean => {
  if (resterend === null || !termijn || termijn === 'alles') return true;
  const grens = Number(termijn);
  return Number.isFinite(grens) ? resterend <= grens : true;
};
