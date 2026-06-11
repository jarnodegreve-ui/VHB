import { useEffect, useRef, useState } from 'react';

/**
 * CountUp — minimalistische animated counter voor dashboard-statistieken.
 * Telt met ease-out cubic van de vorige getoonde waarde naar de nieuwe.
 * Respecteert prefers-reduced-motion en is SSR-safe.
 */
export function CountUp({
  value,
  duration = 700,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  // Start op 0 zodat de mount-animatie van 0 naar value telt
  const [shown, setShown] = useState(() => (Number.isFinite(value) ? 0 : value));
  // Startpunt van de volgende animatie = wat er nu op het scherm staat
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (typeof window === 'undefined' || !Number.isFinite(value)) {
      setShown(value);
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  }, [value, duration]);

  return <span className={className}>{Number.isFinite(shown) ? Math.round(shown) : shown}</span>;
}
