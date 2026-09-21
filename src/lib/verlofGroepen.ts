import type { LeaveRequest } from '../types';

/**
 * Historiek per jaar. De lijst van een chauffeur groeit onbegrensd: na een
 * paar jaar stonden er tientallen kaarten onder elkaar in één scrollvak,
 * zonder dat je zag waar het ene jaar ophield (wens Jarno 21-09). Nu één
 * groep per jaar, nieuwste eerst; het lopende jaar staat open, oudere jaren
 * zijn ingeklapt.
 *
 * Het jaar is dat van de startdatum: een verlof van 28/12 tot 03/01 hoort bij
 * het jaar waarin het begon, net zoals het in het saldo van dat jaar telt.
 */
export type VerlofJaarGroep = {
  jaar: string;
  items: LeaveRequest[];
};

export const jaarVan = (r: Pick<LeaveRequest, 'startDate'>): string => String(r.startDate ?? '').slice(0, 4);

export const groepeerPerJaar = (requests: readonly LeaveRequest[]): VerlofJaarGroep[] => {
  const groepen: VerlofJaarGroep[] = [];
  // De lijst komt gesorteerd binnen (nieuwste eerst); we houden die volgorde
  // aan in plaats van zelf te sorteren, zodat de aanroeper baas blijft.
  for (const r of requests) {
    const jaar = jaarVan(r) || 'Onbekend';
    const laatste = groepen[groepen.length - 1];
    if (laatste && laatste.jaar === jaar) laatste.items.push(r);
    else groepen.push({ jaar, items: [r] });
  }
  return groepen;
};
