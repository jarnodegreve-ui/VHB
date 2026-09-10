import { isoDate } from './availability';
import { addDagen, relatieveDag } from './datum';
import { formatShortDay } from './format';
import type { Diversion } from '../types';

/** Verlopen = einddatum vóór vandaag; zonder einddatum blijft een omleiding
 *  actief tot ze verwijderd wordt. Gedeeld tussen admin- en chauffeurskant —
 *  de tegel zegt "actieve omleidingen" en moet dat overal ook zijn. */
export const isExpiredDiversion = (d: Pick<Diversion, 'endDate'>, vandaag: string = isoDate(new Date())): boolean =>
  Boolean(d.endDate && d.endDate < vandaag);

export const activeDiversions = <T extends Pick<Diversion, 'endDate'>>(list: T[]): T[] =>
  list.filter((d) => !isExpiredDiversion(d));

type Periode = Pick<Diversion, 'startDate' | 'endDate'>;

/** Waar een omleiding zich vandaag bevindt: al bezig, nog te komen, of voorbij.
 *  Een startdatum in de toekomst is "komend", ook zonder einddatum. */
export type OmleidingsFase = 'lopend' | 'komend' | 'verlopen';

export const omleidingsFase = (d: Periode, vandaag: string = isoDate(new Date())): OmleidingsFase => {
  if (isExpiredDiversion(d, vandaag)) return 'verlopen';
  if (d.startDate && d.startDate > vandaag) return 'komend';
  return 'lopend';
};

const FASE_VOLGORDE: Record<OmleidingsFase, number> = { lopend: 0, komend: 1, verlopen: 2 };

/** Chronologische lijstvolgorde voor chauffeurs én admin (verzoek Jarno 10-09:
 *  "rangschikken op datum"): eerst wat nu loopt, dan wat eraan komt, allebei
 *  op startdatum oplopend; verlopen omleidingen onderaan met de meest recent
 *  verlopen bovenaan, zodat een chauffeur die net een omleiding kwijt is ze
 *  nog snel terugvindt. */
export const sorteerOmleidingen = <T extends Periode>(list: T[], vandaag: string = isoDate(new Date())): T[] =>
  [...list].sort((a, b) => {
    const fa = omleidingsFase(a, vandaag);
    const fb = omleidingsFase(b, vandaag);
    if (fa !== fb) return FASE_VOLGORDE[fa] - FASE_VOLGORDE[fb];
    if (fa === 'verlopen') return String(b.endDate || '').localeCompare(String(a.endDate || ''));
    const s = String(a.startDate || '').localeCompare(String(b.startDate || ''));
    if (s !== 0) return s;
    return String(a.endDate || '').localeCompare(String(b.endDate || ''));
  });

/** Korte dag met jaartal enkel als het niet dit jaar is: "ma 8 sep", "ma 8 dec 2027". */
const kort = (iso: string, vandaag: string): string => {
  const dag = formatShortDay(iso);
  const jaar = String(iso).slice(0, 4);
  return jaar && jaar !== vandaag.slice(0, 4) ? `${dag} ${jaar}` : dag;
};

/** Periode in één regel voor lijstrijen: "ma 8 sep t/m vr 19 sep", of
 *  "Vanaf ma 8 sep" zonder einddatum. */
export const omleidingsPeriode = (d: Periode, vandaag: string = isoDate(new Date())): string => {
  if (!d.startDate) return d.endDate ? `Tot en met ${kort(d.endDate, vandaag)}` : '';
  if (!d.endDate) return `Vanaf ${kort(d.startDate, vandaag)}`;
  if (d.endDate === d.startDate) return kort(d.startDate, vandaag);
  return `${kort(d.startDate, vandaag)} t/m ${kort(d.endDate, vandaag)}`;
};

const dagenTussen = (vanIso: string, totIso: string): number =>
  Math.round((new Date(`${totIso}T00:00:00`).getTime() - new Date(`${vanIso}T00:00:00`).getTime()) / 86400000);

/** Tijdsgevoel naast de periode, zodat een chauffeur niet hoeft te rekenen:
 *  "start morgen", "start over 5 dagen", "nog 14 dagen", "laatste dag vandaag".
 *  Leeg voor verlopen omleidingen en lopende zonder einddatum. */
export const omleidingsTijdshint = (d: Periode, vandaag: string = isoDate(new Date())): string => {
  const fase = omleidingsFase(d, vandaag);
  if (fase === 'komend') return `start ${relatieveDag(d.startDate, vandaag)}`;
  if (fase === 'lopend' && d.endDate) {
    const rest = dagenTussen(vandaag, d.endDate);
    if (rest <= 0) return 'laatste dag vandaag';
    if (rest === 1) return 'laatste dag morgen';
    return `nog ${rest} dagen`;
  }
  return '';
};

/** Verlopen omleidingen blijven zoveel dagen zichtbaar voor chauffeurs; daarna
 *  vallen ze uit de lijst (het beheer ziet ze wel nog). */
export const VERLOPEN_ZICHTBAAR_DAGEN = 30;

export const isRecentGenoeg = (d: Periode, vandaag: string = isoDate(new Date())): boolean =>
  !d.endDate || d.endDate >= addDagen(vandaag, -VERLOPEN_ZICHTBAAR_DAGEN);

/** Gesorteerd én verdeeld in de drie fases, voor secties in de lijst. */
export const groepeerOmleidingen = <T extends Periode>(list: T[], vandaag: string = isoDate(new Date())): Record<OmleidingsFase, T[]> => {
  const groepen: Record<OmleidingsFase, T[]> = { lopend: [], komend: [], verlopen: [] };
  for (const d of sorteerOmleidingen(list, vandaag)) groepen[omleidingsFase(d, vandaag)].push(d);
  return groepen;
};
