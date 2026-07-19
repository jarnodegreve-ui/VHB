import { useEffect, useRef, useState, type RefObject } from 'react';

const THRESHOLD = 70; // px slepen om te verversen
const MAX_PULL = 110; // visuele cap
const DIR_SLOP = 6; // px voor de richting bepaald wordt (axis-lock)

/**
 * Pull-to-refresh voor de geïnstalleerde PWA. Sleep omlaag vanaf de bovenkant
 * van de scroll-container → `onRefresh()`. Alleen op touch; op de desktop
 * gebeurt er niets.
 *
 * De hook manipuleert de DOM rechtstreeks (container-transform + indicator via
 * refs) i.p.v. per sleep-frame React-state te zetten — anders re-rendert de
 * hele app-monoliet elk frame. `enabled` laat het effect (her)binden zodra de
 * container gemonteerd is (bij de koude start bestaat die nog niet). Axis-lock
 * + een fixed/sticky-overlay-guard voorkomen dat horizontale tabelvegen of
 * modals de sleep kapen.
 */
export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  indicatorRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown> | void,
  enabled = true,
) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busyRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el || typeof window === 'undefined' || !('ontouchstart' in window)) return;

    let startY = 0;
    let startX = 0;
    let tracking = false; // vinger staat bovenaan, richting nog niet bepaald
    let pulling = false; // verticale trek bevestigd → wij kapen
    let pull = 0;

    const iconEl = () => indicatorRef.current?.querySelector<HTMLElement>('[data-ptr-icon]') ?? null;

    const paint = (px: number) => {
      el.style.transition = px > 0 ? 'none' : 'transform 0.2s';
      el.style.transform = px > 0 ? `translateY(${px}px)` : '';
      const ind = indicatorRef.current;
      if (ind) {
        ind.style.opacity = px > 4 ? '1' : '0';
        ind.style.transform = `translateY(${Math.max(0, px - 20)}px)`;
      }
      const ic = iconEl();
      if (ic) ic.style.transform = `rotate(${px * 2.2}deg)`;
    };

    const reset = () => {
      pull = 0;
      tracking = false;
      pulling = false;
      paint(0);
    };

    const onStart = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || el.scrollTop > 0) {
        tracking = false;
        return;
      }
      // Niet kapen binnen een overlay/modal die als fixed/sticky-laag in de
      // container zit (de niet-geportalde beheer-modals).
      let node = e.target as HTMLElement | null;
      while (node && node !== el) {
        const pos = window.getComputedStyle(node).position;
        if (pos === 'fixed' || pos === 'sticky') {
          tracking = false;
          return;
        }
        node = node.parentElement;
      }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      tracking = true;
      pulling = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking || busyRef.current) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!pulling) {
        // Axis-lock: pas kapen als de beweging duidelijk verticaal-omlaag is.
        // Horizontaal (tabel pannen) of omhoog → loslaten, geen kaping.
        if (Math.abs(dy) < DIR_SLOP && Math.abs(dx) < DIR_SLOP) return;
        if (Math.abs(dx) >= Math.abs(dy) || dy <= 0) {
          tracking = false;
          return;
        }
        pulling = true;
      }
      if (el.scrollTop > 0) {
        reset();
        return;
      }
      // Wrijvingscurve: voelt elastisch, cap op MAX_PULL.
      pull = Math.min(MAX_PULL, dy * 0.5);
      paint(pull);
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = async () => {
      if (!pulling) {
        if (tracking) reset();
        return;
      }
      const reached = pull >= THRESHOLD;
      tracking = false;
      pulling = false;
      if (!reached) {
        reset();
        return;
      }
      busyRef.current = true;
      setRefreshing(true);
      // Op de drempel laten staan tijdens het verversen; icoon spint via de
      // animate-spin-klasse (inline rotate weghalen zodat die niet botst).
      el.style.transition = 'transform 0.2s';
      el.style.transform = `translateY(${THRESHOLD}px)`;
      const ind = indicatorRef.current;
      if (ind) {
        ind.style.opacity = '1';
        ind.style.transform = `translateY(${THRESHOLD - 20}px)`;
      }
      const ic = iconEl();
      if (ic) ic.style.transform = '';
      try {
        await refreshRef.current();
      } finally {
        busyRef.current = false;
        setRefreshing(false);
        reset();
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
      el.style.transform = '';
      el.style.transition = '';
    };
  }, [scrollRef, indicatorRef, enabled]);

  return { refreshing };
}
