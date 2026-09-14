import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DUR, EASE } from '../lib/motion';

/**
 * Skelet → inhoud zonder knip. Twee stukken:
 *
 * `Verwissel`: cross-fade tussen skelet en inhoud (alleen opacity: skelet
 * uit op DUR.fast, inhoud in op DUR.base, EASE). Het skelet blijft minstens
 * ±180 ms staan zodat een snelle cache-hit niet flikkert (skelet één frame
 * zien en weer weg is erger dan 180 ms wachten). De wrapper is een gewone
 * div zonder padding/marge, dus geen hoogte- of CLS-effect van zichzelf.
 *
 * `SchermInloop`: de inloop van een héél scherm bij een route-wissel
 * (opacity 0 → 1, y 4 → 0 op DUR.base/EASE). Alleen transform/opacity, de
 * eindstaat is exact de gewone layout. Slaat zichzelf over wanneer de View
 * Transition het al doet (`overgangActief()`, src/lib/overgang.ts) of bij
 * prefers-reduced-motion. Zo krijgen Safari/iOS zonder
 * `startViewTransition` toch dezelfde beweging als Chrome.
 */
export function Verwissel({
  laden,
  skelet,
  children,
  minimaalMs = 180,
}: {
  laden: boolean;
  skelet: ReactNode;
  children: ReactNode;
  /** Minimale weergeeftijd van het skelet zodra het getoond is. */
  minimaalMs?: number;
}) {
  const reduced = useReducedMotion();
  const toonSkelet = useMinimaleWeergave(laden, minimaalMs);
  const uit = { duration: reduced ? 0 : DUR.fast, ease: EASE };
  const inn = { duration: reduced ? 0 : DUR.base, ease: EASE };
  return (
    <AnimatePresence mode="wait" initial={false}>
      {toonSkelet ? (
        <motion.div key="skelet" exit={{ opacity: 0 }} transition={uit}>
          {skelet}
        </motion.div>
      ) : (
        <motion.div key="inhoud" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={inn}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** `laden` met een minimale aan-tijd: zodra het skelet zichtbaar werd,
 *  blijft het minstens `minimaalMs` staan. Begint `laden` op false, dan is
 *  er nooit een skelet en dus ook geen wachttijd. */
function useMinimaleWeergave(laden: boolean, minimaalMs: number) {
  const [toon, setToon] = useState(laden);
  const sinds = useRef(laden ? performance.now() : 0);
  useEffect(() => {
    if (laden) {
      sinds.current = performance.now();
      setToon(true);
      return;
    }
    const rest = minimaalMs - (performance.now() - sinds.current);
    if (rest <= 0) {
      setToon(false);
      return;
    }
    const t = window.setTimeout(() => setToon(false), rest);
    return () => window.clearTimeout(t);
  }, [laden, minimaalMs]);
  return toon;
}

export function SchermInloop({ children }: { children: ReactNode }) {
  // Bewust een CSS-animatie (keyframes `view-in` in index.css) en geen
  // motion-`initial`/`animate`: wanneer het scherm bij het mounten nog op zijn
  // lazy chunk wacht (Suspense), start motion de animatie niet en blijft het
  // scherm op opacity 0 staan (gezien op Omleidingen/Updates/Contacten/
  // Dienstruil, 14-09). Een CSS-animatie loopt altijd bij het invoegen van het
  // element. `html.vt-route .view-in { animation: none }` slaat hem over als
  // de view transition al beweegt, en prefers-reduced-motion zet hem uit.
  // De key zit bij de aanroeper (per scherm).
  return <div className="view-in">{children}</div>;
}
