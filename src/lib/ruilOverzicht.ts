import { addDagen } from './datum';
import { maandagVan } from './roosterUren';

/**
 * Het ruiloverzicht (printblad) met een vrije periode op de datum van de
 * dienst (Jarno 16-10, was één week op het moment van doorvoeren). Eén plek
 * voor de standaard, de controle en de URL, gedeeld door Dienstruil, de
 * catalogus in Rapporten en het printscherm.
 */

export type RuilPeriode = { van: string; tot: string };

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;

/** De grens van de server (`MAX_PERIODE_DAGEN` in shared/rapporten/periode.ts;
 *  de test houdt ze gelijk). Hier los, want Dienstruil zit in de warmup en die
 *  module sleept de hele periodekiezer van de rapporten mee. */
export const MAX_RUIL_PERIODE_DAGEN = 366;

/** Een bestaande kalenderdag: 2026-02-30 schuift in Date door naar maart en telt dus niet. */
const echteDag = (iso: string): boolean => {
  if (!ISO_DAG.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

const dagenTussen = (van: string, tot: string): number =>
  Math.round((Date.parse(`${tot}T00:00:00Z`) - Date.parse(`${van}T00:00:00Z`)) / 86_400_000) + 1;

/** Standaard: de lopende week, maandag t/m zondag. */
export const standaardRuilPeriode = (vandaag: string): RuilPeriode => {
  const van = maandagVan(vandaag);
  return { van, tot: addDagen(van, 6) };
};

/** Waarom deze periode niet kan, of null. Zelfde grens als de server (366 dagen). */
export const ruilPeriodeFout = ({ van, tot }: RuilPeriode): string | null => {
  if (!echteDag(van) || !echteDag(tot)) return 'Kies een begin- en een einddatum.';
  if (tot < van) return 'De einddatum ligt vóór de begindatum.';
  if (dagenTussen(van, tot) > MAX_RUIL_PERIODE_DAGEN) return `De periode mag hoogstens ${MAX_RUIL_PERIODE_DAGEN} dagen beslaan.`;
  return null;
};

export const ruilOverzichtQuery = ({ van, tot }: RuilPeriode): URLSearchParams =>
  new URLSearchParams({ 'ruiloverzicht-van': van, 'ruiloverzicht-tot': tot });

/**
 * De periode uit de adresbalk van het printscherm, of null. Een link van vóór
 * 16-10 (`?ruiloverzicht-week=<dag>`) geeft de week van die dag.
 */
export const ruilPeriodeUitUrl = (params: URLSearchParams): RuilPeriode | null => {
  const van = params.get('ruiloverzicht-van');
  const tot = params.get('ruiloverzicht-tot');
  if (van !== null || tot !== null) {
    const periode = { van: van ?? '', tot: tot ?? '' };
    return ruilPeriodeFout(periode) ? null : periode;
  }
  const week = params.get('ruiloverzicht-week');
  return week && ISO_DAG.test(week) ? standaardRuilPeriode(week) : null;
};
