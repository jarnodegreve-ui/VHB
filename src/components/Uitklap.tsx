import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '../lib/ui';
import { DUR } from '../lib/motion';

/**
 * Uitklap: inhoud die open- en dichtklapt mét beweging i.p.v. in één frame
 * (golf 2, punt 9). Eén recept voor alle accordions in de app:
 *
 * - De buitenkant is een grid met één rij die van `0fr` naar `1fr` gaat, de
 *   enige manier om naar een `auto`-hoogte te animeren zonder JS-meting;
 *   de binnenkant vervaagt mee. Open op DUR.base, dicht op DUR.fast, beide
 *   op `--ease-standard` (CSS-variabelen uit index.css, dus geen extra
 *   stylesheet nodig). Alleen `grid-template-rows` en `opacity` bewegen.
 * - `overflow: hidden` staat alleen tijdens de beweging en zolang de inhoud
 *   dicht is; eenmaal open komt het vrij (`onTransitionEnd`), zodat ringen,
 *   schaduwen en popovers in de inhoud niet worden afgeknipt.
 * - Dicht = `inert` + `aria-hidden`: niet focusbaar, niet voor te lezen; de
 *   `aria-expanded` op de kop blijft bij de aanroeper.
 * - De inhoud wordt pas gemonteerd bij de eerste keer openen (lijsten met
 *   een uitklaprij per item zouden anders alles vooraf renderen) en blijft
 *   daarna staan, zodat het dichtklappen iets heeft om te tonen.
 * - Reduced motion: geen transitie, wel dezelfde eindtoestand.
 *
 * `uitklapChevron(open, graden)` geeft de klassen voor het pijltje in de kop,
 * met dezelfde duur per richting als het paneel.
 */
export function Uitklap({ open, children, id, className, innerClassName, style }: {
  open: boolean;
  children: ReactNode;
  /** Voor `aria-controls` op de kop. */
  id?: string;
  className?: string;
  /** Klassen op de binnenste laag (zelden nodig; padding hoort bij de inhoud zelf). */
  innerClassName?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const [bezig, setBezig] = useState(false);
  const [ooitOpen, setOoitOpen] = useState(open);
  const vorige = useRef(open);
  const timer = useRef<number | undefined>(undefined);

  // useLayoutEffect: de klem (overflow hidden) moet er staan vóór de eerste
  // geschilderde frame van de beweging, anders steekt de inhoud één frame uit.
  useLayoutEffect(() => {
    if (open) setOoitOpen(true);
    if (vorige.current === open) return;
    vorige.current = open;
    if (reduced) return;
    setBezig(true);
    // Vangnet: transitionend blijft uit als het element intussen display:none
    // kreeg (bv. een dichtgeklapte zijbalk) of de inhoud leeg was.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBezig(false), (open ? DUR.base : DUR.fast) * 1000 + 80);
    return () => window.clearTimeout(timer.current);
  }, [open, reduced]);

  const duur = open ? 'var(--duration-base)' : 'var(--duration-fast)';
  const klem = bezig || !open;
  const einde = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setBezig(false);
  };

  return (
    <div
      id={id}
      className={cn('grid', className)}
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: reduced ? 'none' : `grid-template-rows ${duur} var(--ease-standard)`,
        ...style,
      }}
      onTransitionEnd={einde}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
    >
      <div
        className={cn('min-h-0', klem && 'overflow-hidden', innerClassName)}
        style={{
          opacity: open ? 1 : 0,
          transition: reduced ? 'none' : `opacity ${duur} var(--ease-standard)`,
        }}
      >
        {ooitOpen ? children : null}
      </div>
    </div>
  );
}

/**
 * Klassen voor de chevron in een uitklapkop: draait 180° (ChevronDown) of
 * 90° (ChevronRight) mee, op dezelfde duur per richting als het paneel
 * (DUR.base open, DUR.fast dicht) en de standaard-easing.
 */
export function uitklapChevron(open: boolean, graden: 90 | 180 = 180, className?: string) {
  return cn(
    'transition-transform',
    open ? cn('duration-base', graden === 90 ? 'rotate-90' : 'rotate-180') : 'duration-fast',
    className,
  );
}
