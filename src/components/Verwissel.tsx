import { useEffect, useRef, useState, type AnimationEvent, type ReactNode } from 'react';
import { DUR, verminderdeBeweging } from '../lib/motion';
import { overgangActief } from '../lib/overgang';

/**
 * Skelet → inhoud zonder knip. Twee stukken:
 *
 * `Verwissel`: skelet uit (opacity, DUR.fast) en dan de inhoud in (opacity,
 * DUR.base), als CSS-animaties (`fade-uit`/`fade-in` in index.css) en niet
 * met motion (sinds 14-10, verbeterronde punt 10): de inhoud is op Mijn dag
 * het eerste beeld, en een motion-`initial` van opacity 0 wacht op de
 * animatiebundel vóór hij ooit zichtbaar wordt. Een CSS-animatie loopt bij
 * het invoegen van het element. Het skelet blijft minstens ±180 ms staan
 * zodat een snelle cache-hit niet flikkert (skelet één frame zien en weer
 * weg is erger dan 180 ms wachten). Begint het scherm zonder skelet, dan
 * staat de inhoud er meteen, zonder inloop. De wrapper is een gewone div
 * zonder padding/marge, dus geen hoogte- of CLS-effect van zichzelf.
 *
 * `SchermInloop`: de inloop van een héél scherm bij een route-wissel
 * (opacity 0 → 1, y 4 → 0 op DUR.base/EASE). Alleen transform/opacity, de
 * eindstaat is exact de gewone layout. Slaat zichzelf over wanneer de View
 * Transition het al doet (`overgangActief()` bij het mounten, src/lib/
 * overgang.ts) of bij prefers-reduced-motion. Zo krijgen Safari/iOS zonder
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
  const toonSkelet = useMinimaleWeergave(laden, minimaalMs);
  // Drie fasen: skelet, skelet dat uitfadet, inhoud. De ref draagt de fase
  // die de effecten lezen; de state tekent.
  const [fase, setFaseState] = useState<Fase>(() => (toonSkelet ? 'skelet' : 'inhoud'));
  const faseRef = useRef<Fase>(fase);
  // Alleen een inhoud die ná een skelet komt loopt in; de eerste render
  // zonder skelet staat er meteen.
  const inloopRef = useRef(false);
  const zetFase = (volgende: Fase) => {
    if (volgende === 'inhoud' && faseRef.current !== 'inhoud') inloopRef.current = true;
    faseRef.current = volgende;
    setFaseState(volgende);
  };

  useEffect(() => {
    if (toonSkelet) {
      if (faseRef.current !== 'skelet') zetFase('skelet');
      return;
    }
    if (faseRef.current !== 'skelet') return;
    if (verminderdeBeweging()) {
      zetFase('inhoud');
      return;
    }
    zetFase('skelet-uit');
    // Vangnet als animationend uitblijft (verborgen tabblad, skelet zonder
    // kader): iets later dan de animatie zelf, nooit langer.
    const t = window.setTimeout(() => {
      if (faseRef.current === 'skelet-uit') zetFase('inhoud');
    }, DUR.fast * 1000 + 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toonSkelet]);

  const naUitfaden = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.animationName !== 'vhb-fade-uit') return;
    if (faseRef.current === 'skelet-uit') zetFase('inhoud');
  };

  if (fase === 'inhoud') {
    return <div className={inloopRef.current ? 'fade-in' : undefined}>{children}</div>;
  }
  return (
    <div className={fase === 'skelet-uit' ? 'fade-uit' : undefined} onAnimationEnd={naUitfaden}>
      {skelet}
    </div>
  );
}

type Fase = 'skelet' | 'skelet-uit' | 'inhoud';

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
  // element; prefers-reduced-motion zet hem uit.
  //
  // Of hij loopt, wordt één keer beslist, bij het mounten: beweegt de view
  // transition al (`overgangActief()`), dan komt de klasse er niet op. Die
  // keuze mag daarna niet meer omslaan. Vroeger zette een CSS-regel op
  // `html.vt-route` de animatie uit, maar zodra die klasse na de overgang
  // verdween gold de animatie opnieuw en startte ze alsnog: elk scherm fadede
  // een tweede keer in (gemeten 21-09, frame voor frame, op elke wissel).
  // De key zit bij de aanroeper (per scherm), dus elk scherm beslist opnieuw.
  const [inloop] = useState(() => !overgangActief());
  return <div className={inloop ? 'view-in' : undefined}>{children}</div>;
}
