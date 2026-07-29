import { isoDate } from './availability';
import type { Diversion } from '../types';

/** Verlopen = einddatum vóór vandaag; zonder einddatum blijft een omleiding
 *  actief tot ze verwijderd wordt. Gedeeld tussen admin- en chauffeurskant —
 *  de tegel zegt "actieve omleidingen" en moet dat overal ook zijn. */
export const isExpiredDiversion = (d: Pick<Diversion, 'endDate'>): boolean =>
  Boolean(d.endDate && d.endDate < isoDate(new Date()));

export const activeDiversions = <T extends Pick<Diversion, 'endDate'>>(list: T[]): T[] =>
  list.filter((d) => !isExpiredDiversion(d));
