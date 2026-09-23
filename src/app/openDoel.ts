import { navigeer, routeUitUrl } from './router';

/**
 * Het doel van een melding openen (`verlof/l1`, `dienstruil/r1`,
 * `updates/u2`), tranche 3C: één history-entry, het record-segment reist mee,
 * zodat het scherm meteen op het item opent en "terug" je naar waar je de
 * melding aantikte brengt. Het meldingenscherm en het paneel onder de bel
 * gebruiken dit allebei; het paneel liet het id eerder vallen. Een doel is
 * altijd een pad in de app (`routeUitUrl` leest alleen het pad), en een id dat
 * niet (meer) bestaat vangt het scherm zelf op (RecordOnbekend).
 */
export function openDoel(doel: string | null | undefined): boolean {
  if (!doel) return false;
  const route = routeUitUrl('/' + doel.replace(/^\/+/, ''));
  if (!route) return false;
  navigeer(route.view, { params: route.params });
  return true;
}
