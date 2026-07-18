import { useEffect, useRef, useState, type RefObject } from 'react';

const THRESHOLD = 70; // px slepen om te verversen
const MAX_PULL = 110; // visuele cap

/**
 * Pull-to-refresh voor de geïnstalleerde PWA. Sleep omlaag vanaf de bovenkant
 * van de scroll-container → `onRefresh()`. Alleen op touch; op de desktop
 * (geen touch) gebeurt er niets. `pull` (0..MAX_PULL) en `refreshing` sturen
 * de indicator aan.
 */
export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown> | void,
) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  // onRefresh in een ref zodat de listeners niet elke render herbinden.
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof window === 'undefined' || !('ontouchstart' in window)) return;

    const onStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0 && !refreshing) {
        startY.current = e.touches[0].clientY;
        active.current = false;
      } else {
        startY.current = null;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) { setPull(0); active.current = false; return; }
      // Alleen kapen zolang we bovenaan staan; anders gewoon scrollen.
      if (el.scrollTop > 0) { startY.current = null; setPull(0); return; }
      active.current = true;
      // Wrijvingscurve: voelt elastisch, cap op MAX_PULL.
      const resisted = Math.min(MAX_PULL, delta * 0.5);
      setPull(resisted);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = async () => {
      if (!active.current) { setPull(0); startY.current = null; return; }
      active.current = false;
      startY.current = null;
      if (pull >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        try { await refreshRef.current(); } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef, pull, refreshing]);

  return { pull, refreshing, threshold: THRESHOLD };
}
