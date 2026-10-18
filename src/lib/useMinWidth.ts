import { useCallback, useSyncExternalStore } from 'react';

/**
 * `true` zodra de viewport minstens `px` breed is (matchMedia, live). Voor
 * layouts die op desktop een ándere DOM renderen (master-detail, lijst +
 * kalender naast elkaar) i.p.v. alleen CSS te wisselen — zo rendert elk
 * formaat één versie. Server/eerste render: false (mobile-first).
 */
export function useMinWidth(px: number) {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback((cb: () => void) => {
    if (!kanMeten()) return () => {};
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => kanMeten() && window.matchMedia(query).matches, () => false);
}

// Zonder matchMedia (jsdom in de unit-tests) geldt hetzelfde als op de
// server: mobile-first. Sinds Modal en SlideOver de hook gebruiken (Apple-
// review 17-10) rendert bijna elke test hem.
const kanMeten = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
