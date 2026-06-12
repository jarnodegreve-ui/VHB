import { useEffect, useRef } from 'react';

/**
 * useCursorGlow — track muispositie binnen het element en update CSS-vars
 * --mx / --my (in %). Combineer met de .cursor-glow CSS-utility die een
 * radial-gradient rendert op die positie. Premium "metallic glass" feel.
 *
 * Performance: één rAF per frame, geen re-renders. Geen-op als gebruiker
 * `prefers-reduced-motion` heeft staan.
 */
export function useCursorGlow<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        el.style.setProperty('--mx', `${x}%`);
        el.style.setProperty('--my', `${y}%`);
      });
    };

    el.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}


/**
 * useParallaxScroll — schrijft de huidige scrollY naar
 * document.documentElement als --scroll-y CSS-var. Elementen met
 * .parallax-bg gebruiken deze om trager te bewegen dan content.
 *
 * Bewust globaal — één listener voor alle parallax-elementen.
 */
export function useParallaxScroll() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--scroll-y', `${window.scrollY}px`);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // Init
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
}

/**
 * Dagdeel-greeting in NL.
 */
export function getDaypartGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return 'Goedenacht';
  if (h < 12) return 'Goedemorgen';
  if (h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}
