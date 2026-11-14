import { useCallback, useSyncExternalStore } from 'react';

/**
 * De grens van Tailwinds `md` (48rem) als mediaquery, letterlijk zoals de
 * gebouwde CSS haar stelt. Een keuze in JS op deze query valt dus altijd samen
 * met de `md:`-klassen, ook als de browser een andere standaardletter heeft:
 * dan verschilt 48rem van 768px, en een keuze op `useMinWidth(768)` naast een
 * verberging in CSS kon dan allebei verbergen. Een constante in dit bestand en
 * niet in een scherm, zodat de e2e ze kan importeren zonder een scherm te laden
 * (e2e/maandplanning-weergave.spec.ts toetst ze tegen de gebouwde CSS).
 */
export const MD_QUERY = '(min-width: 48rem)';

/**
 * `true` zolang de mediaquery `query` geldt (matchMedia, live). Voor layouts
 * die per breedte een ándere DOM renderen in plaats van alleen CSS te
 * wisselen, zodat elk formaat één versie rendert. Server/eerste render:
 * false (mobile-first).
 */
export function useMedia(query: string) {
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/**
 * `true` zodra de viewport minstens `px` breed is (matchMedia, live). Voor
 * layouts die op desktop een ándere DOM renderen (master-detail, lijst +
 * kalender naast elkaar) i.p.v. alleen CSS te wisselen, zo rendert elk
 * formaat één versie. Server/eerste render: false (mobile-first). Wie de
 * grens van een `md:`-klasse volgt, gebruikt `useMedia(MD_QUERY)`: die staat
 * in rem, deze in px.
 */
export function useMinWidth(px: number) {
  return useMedia(`(min-width: ${px}px)`);
}
