import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAnimate, useReducedMotion } from 'motion/react';
import { DUR, EASE_SPRING } from '../lib/motion';
import { cn } from '../lib/ui';

/**
 * CountUp — levend getal voor KPI-tegels en teller-badges.
 *
 * - Telt met ease-out cubic van de vorige getoonde waarde naar de nieuwe
 *   (raf, geen setInterval).
 * - Bij een waardewijziging een korte scale-puls (1 → 1,06 → 1) op de veer
 *   (DUR.fast/EASE_SPRING): het cijfer "tikt" zichtbaar om.
 * - `badge`: teller-badge (sidebar, dock, meldingenbel). Toont de waarde
 *   meteen (geen 0 → n-telling, een "0" in een badge is fout) en komt bij
 *   het verschijnen binnen met scale 0,6 → 1: badges bestaan alleen als er
 *   iets te tellen valt, dus mount = "van 0 naar 1".
 * - `format` voor de zichtbare tekst ("9+"); de telling zelf blijft numeriek.
 *
 * Reduced motion via `useReducedMotion` (reactief): geen telling, geen
 * schaal. Puur visueel: aria-labels van de ouder blijven de bron. Het
 * element is inline-block zodat `transform` werkt; dezelfde regelhoogte
 * als de omringende tekst, dus geen layoutverschil.
 */
export function CountUp({
  value,
  duration = 700,
  className,
  badge = false,
  format,
}: {
  value: number;
  duration?: number;
  className?: string;
  /** Teller-badge: waarde meteen tonen, enter-schaal bij verschijnen. */
  badge?: boolean;
  /** Zichtbare weergave van het (afgeronde) getal, bv. `n > 9 ? '9+' : n`. */
  format?: (n: number) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const [scope, animeer] = useAnimate<HTMLSpanElement>();
  // Start op 0 zodat de mount-animatie van 0 naar value telt; een badge
  // toont de waarde meteen.
  const [shown, setShown] = useState(() => (Number.isFinite(value) && !badge ? 0 : value));
  // Startpunt van de volgende animatie = wat er nu op het scherm staat
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const gemount = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !Number.isFinite(value)) {
      setShown(value);
      return;
    }
    const from = shownRef.current;
    if (reduced || from === value || duration <= 0) {
      setShown(value);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  // Schaal: enter (badge) bij mount, puls bij elke latere wijziging.
  useEffect(() => {
    const eerste = !gemount.current;
    gemount.current = true;
    if (reduced || !scope.current) return;
    if (eerste) {
      if (badge) animeer(scope.current, { scale: [0.6, 1] }, { duration: DUR.base, ease: EASE_SPRING });
      return;
    }
    animeer(scope.current, { scale: [1, 1.06, 1] }, { duration: DUR.fast, ease: EASE_SPRING });
    // Alleen op een nieuwe waarde; `reduced`/`badge` wisselen hoort geen puls te geven.
  }, [value]);

  const n = Number.isFinite(shown) ? Math.round(shown) : shown;
  return (
    <span ref={scope} className={cn('inline-block tabular-nums', className)}>
      {format && Number.isFinite(n) ? format(n) : n}
    </span>
  );
}
