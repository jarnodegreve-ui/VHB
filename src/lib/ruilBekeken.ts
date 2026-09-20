import { apiFetch } from './api';
import { isOnlineNu } from './useOnline';

/**
 * "De collega heeft de aanvraag gezien" (Jarno 20-09). Zodra de aangezochte
 * collega een nog onbeantwoorde dienstruil echt in beeld heeft, meldt de client
 * dat één keer aan de server (`POST /api/swaps/:id/bekeken`); de aanvrager en
 * de planning lezen het daarna in het verloop van de ruil.
 *
 * Fire-and-forget: de registratie is een waarneming, geen handeling van de
 * chauffeur. Ze mag het scherm nooit storen, toont nooit een fout en geeft in
 * onderhoudsmodus geen toast (`stil`). De server is idempotent; hier vuurt
 * elke ruil hoogstens één keer per sessie.
 */
const gemeld = new Set<string>();

export function meldRuilBekeken(swapId: string): void {
  if (!swapId || gemeld.has(swapId)) return;
  // Offline niets onthouden: dan telt een volgend moment mét bereik nog.
  if (!isOnlineNu()) return;
  gemeld.add(swapId);
  void apiFetch(`/api/swaps/${encodeURIComponent(swapId)}/bekeken`, { method: 'POST', stil: true }).catch(() => undefined);
}

/** Alleen voor tests. */
export function _resetRuilBekekenVoorTests(): void {
  gemeld.clear();
}

/** Deel van het element dat in beeld moet staan, en hoe lang. Een kaart die
 *  bij het scrollen voorbijschiet is niet "bekeken". */
const ZICHTBAAR_DEEL = 0.4;
const VERBLIJF_MS = 800;

/**
 * Roept `klaar` één keer aan zodra `el` lang genoeg zichtbaar is in een
 * zichtbaar tabblad. Geeft de opruimfunctie terug. Zonder IntersectionObserver
 * (oude webview) telt het openen van het scherm zelf.
 */
export function bewaakInBeeld(el: Element, klaar: () => void, verblijfMs = VERBLIJF_MS): () => void {
  let timer: number | undefined;
  let inBeeld = false;
  let gedaan = false;
  const stopTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  const weeg = () => {
    stopTimer();
    if (gedaan || !inBeeld || document.visibilityState !== 'visible') return;
    timer = window.setTimeout(() => {
      gedaan = true;
      opruimen();
      klaar();
    }, verblijfMs);
  };
  const waarnemer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        inBeeld = entries[entries.length - 1]?.isIntersecting ?? false;
        weeg();
      }, { threshold: ZICHTBAAR_DEEL })
    : null;
  const opruimen = () => {
    stopTimer();
    waarnemer?.disconnect();
    document.removeEventListener('visibilitychange', weeg);
  };
  document.addEventListener('visibilitychange', weeg);
  if (waarnemer) waarnemer.observe(el);
  else {
    inBeeld = true;
    weeg();
  }
  return opruimen;
}
