import { isToestelGeblokkeerd } from '../lib/api';

/**
 * Wanneer een laadfout géén "Kon … niet laden"-toast mag geven.
 *
 * Een toestel dat op goedkeuring wacht (of ingetrokken is) krijgt op elke
 * call een 403 device_*; het toestel-wachtscherm is dan de melding. Zonder
 * deze poort stapelden de laadpaden rode toasts ("Controleer je
 * verbinding", wat niet klopt) die na de goedkeuring allemaal tegelijk
 * verschenen en ook in de foutenlog belandden. Idem na een beëindigde
 * sessie: het inlogscherm draagt de reden.
 */
export function laadfoutOnderdrukt(
  staat: { sessieBeeindigd: boolean; toestelGeblokkeerd: boolean },
  fout?: unknown,
): boolean {
  return staat.sessieBeeindigd || staat.toestelGeblokkeerd || isToestelGeblokkeerd(fout);
}
