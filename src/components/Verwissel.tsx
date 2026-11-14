import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type ReactNode } from 'react';
import { DUR, verminderdeBeweging } from '../lib/motion';
import { overgangActief } from '../lib/overgang';

/**
 * Skelet → inhoud zonder knip. Twee stukken:
 *
 * `Verwissel`: een cross-fade (ronde 6, punt 3; tot dan eerst het skelet uit
 * en pas daarna de inhoud in, met ±150 ms niets ertussen). Valt `laden` weg,
 * dan staat de inhoud er meteen op haar plaats en komt ze op (`fade-in`,
 * DUR.base), terwijl het skelet er absoluut bovenop vervaagt (`fade-uit`,
 * DUR.fast) en na zijn animationend verdwijnt. CSS-animaties uit index.css
 * en geen motion (sinds 14-10, verbeterronde punt 10): de inhoud is op Mijn
 * dag het eerste beeld, en een motion-`initial` van opacity 0 wacht op de
 * animatiebundel vóór hij ooit zichtbaar wordt. Het skelet blijft minstens
 * ±180 ms staan zodat een snelle cache-hit niet flikkert (skelet één frame
 * zien en weer weg is erger dan 180 ms wachten). Begint het scherm zonder
 * skelet, dan staat de inhoud er meteen, zonder inloop; bij reduced motion
 * ook.
 *
 * Tijdens de overlap krijgt de wrapper alleen `relative`, als anker voor de
 * skeletlaag. Die laag ligt op de doos van de inhoud (`inset-0`), knipt het
 * skelet daarop, vangt geen klik en is aria-hidden: alleen de inhoud is
 * bedienbaar en wordt voorgelezen, en de hoogte is die van de inhoud. Het
 * knippen zit op de laag en niet op de wrapper, zodat schaduw en focusring
 * van de inhoud nooit even wegvallen, en het is een `clip-path`, geen
 * overflow: `overflow-hidden` maakt een scrollcontainer (dan plakt een
 * tabelkop niet meer), en met `overflow-clip` op de laag sprong de pagina in
 * Chromium soms naar boven als je tijdens de overlap een rij opende (Verlof,
 * gescrolde pagina, 5 van 18 runs; met clip-path 0 van 30).
 * Een bovenmarge die in de flow door de wrapper heen viel, valt in de
 * absolute laag niet meer weg; de laag schuift dat verschil terug (gemeten
 * vóór de browser tekent), zodat het skelet niet verspringt. De inhoud staat
 * in een eigen div die de fade-in draagt: een opacity op de wrapper zou het
 * skelet erin meteen mee laten verdwijnen. Na de overlap is de wrapper weer
 * een kale div, zonder position, overflow of transform.
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
  // Drie fasen: skelet, overlap (inhoud komt op, skelet vervaagt erboven),
  // inhoud. De ref draagt de fase die de effecten lezen; de state tekent.
  const [fase, setFaseState] = useState<Fase>(() => (toonSkelet ? 'skelet' : 'inhoud'));
  const faseRef = useRef<Fase>(fase);
  // Alleen een inhoud die ná een skelet komt loopt in; de eerste render
  // zonder skelet staat er meteen.
  const inloopRef = useRef(false);
  // De skeletlaag is in de fase skelet en in de overlap hetzelfde element
  // (geen nieuwe mount, de shimmer loopt door); `boven` = waar zijn eerste
  // element vóór de overlap stond, gemeten vanaf de bovenrand van de laag.
  // Relatief, want wat erboven staat kan in dezelfde render van hoogte
  // wisselen (Beheer › Mails: elke kaart laadt tegelijk); het skelet volgt
  // dan zijn wrapper, zoals de inhoud.
  const laagRef = useRef<HTMLDivElement>(null);
  const boven = useRef(0);
  const zetFase = (volgende: Fase) => {
    if (volgende !== 'skelet') inloopRef.current = true;
    faseRef.current = volgende;
    setFaseState(volgende);
  };

  // Layout-effect: meten, wisselen en de laag plaatsen gebeurt vóór de
  // browser tekent, dus nooit een frame met het skelet op een andere plaats.
  useLayoutEffect(() => {
    if (toonSkelet) {
      if (faseRef.current !== 'skelet') zetFase('skelet');
      return;
    }
    if (faseRef.current !== 'skelet') return;
    if (verminderdeBeweging()) {
      zetFase('inhoud');
      return;
    }
    boven.current = skeletOffset(laagRef.current);
    zetFase('overlap');
    // Vangnet als animationend uitblijft (verborgen tabblad, skelet zonder
    // kader): iets later dan de animatie zelf, nooit langer.
    const t = window.setTimeout(() => {
      if (faseRef.current === 'overlap') zetFase('inhoud');
    }, DUR.fast * 1000 + 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toonSkelet]);

  // De laag schuift met een transform en niet met `top`: dan blijft haar
  // plaats in de layout dezelfde en telt de CLS geen verschuiving van een
  // vak waarvan niets zichtbaars beweegt. `bottom` rekt haar even veel, zodat
  // ze na het schuiven weer precies de doos van de inhoud knipt. Terug naar
  // het skelet (laden komt terug) = weer zonder.
  useLayoutEffect(() => {
    const stijl = laagRef.current?.style;
    if (!stijl) return;
    stijl.transform = stijl.bottom = '';
    if (fase !== 'overlap') return;
    const d = `${boven.current - skeletOffset(laagRef.current)}px`;
    stijl.bottom = d;
    stijl.transform = `translateY(${d})`;
  }, [fase]);

  const naUitfaden = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.animationName !== 'vhb-fade-uit') return;
    if (faseRef.current === 'overlap') zetFase('inhoud');
  };

  const overlap = fase === 'overlap';
  // Vaste plaatsen in de wrapper (inhoud eerst, laag erna), zodat React de
  // inhoud bij het einde van de overlap niet opnieuw mount.
  return (
    <div className={overlap ? 'relative' : undefined}>
      {fase !== 'skelet' && (inloopRef.current ? <div className="fade-in">{children}</div> : children)}
      {fase !== 'inhoud' && (
        <div
          ref={laagRef}
          className={overlap ? 'fade-uit pointer-events-none absolute inset-0 [clip-path:inset(0)]' : undefined}
          aria-hidden={overlap || undefined}
          onAnimationEnd={naUitfaden}
        >
          {skelet}
        </div>
      )}
    </div>
  );
}

type Fase = 'skelet' | 'overlap' | 'inhoud';

/** De bovenrand van het eerste element van het skelet, vanaf die van de
 *  laag. In de flow valt een bovenmarge door de laag (en de wrapper) heen
 *  en is dit 0; in de absolute laag, een eigen blokcontext, niet. */
const skeletOffset = (laag: HTMLElement | null) => {
  const eerste = laag?.firstElementChild;
  return eerste ? eerste.getBoundingClientRect().top - laag!.getBoundingClientRect().top : 0;
};

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
