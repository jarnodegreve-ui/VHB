import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition, type Variants } from 'motion/react';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';

/**
 * Inhoud die van plaats wisselt mét een richting (golf 4, punt 11): een
 * andere maand, een ander record in het detailpaneel, Vandaag → Morgen. De
 * oude inhoud gaat uit met opacity 0 en `afstand` px in de richting van de
 * wissel (DUR.fast, EASE), de nieuwe komt van de tegenkant binnen
 * (DUR.base, EASE_SPRING: veer in, ease uit). Beide tegelijk (cross-fade,
 * `popLayout`: de vertrekkende inhoud staat even absoluut, de nieuwe neemt
 * meteen de plaats in) — alleen transform en opacity.
 *
 * `richting` 1 = vooruit (volgende maand, item lager in de lijst, Morgen):
 * de oude inhoud vertrekt naar min, de nieuwe komt van plus; −1 omgekeerd.
 * `as` kiest de as: 'x' voor maanden en dagen, 'y' voor een lijstkeuze.
 *
 * `stil` = geen beweging (reduced motion, of een lopende view transition
 * die dezelfde inhoud al verplaatst — anders vechten ze); `uitStil` slaat
 * alleen de uitgang over, voor na een veeg die de oude inhoud al met de
 * vinger wegschoof (useMaandVeeg). `knip` knipt de vertrekkende inhoud op
 * de doos van de nieuwe: voor blokken waarvan de hoogte sterk verschilt,
 * anders spookt de oude inhoud 150 ms over wat eronder staat. Speling voor
 * ringen en focus-outlines: horizontaal en boven via negatieve marge +
 * padding (de ondermarge blijft van `space-y`, dus die niet aanraken),
 * verder `overflow-clip-margin` waar de browser dat kent. Niet nodig
 * binnen een scroll-container.
 */
type Instelling = { richting: 1 | -1; as: 'x' | 'y'; afstand: number; stil: boolean; uitStil: boolean };

const verschuiving = (c: Instelling, px: number): TargetAndTransition => (c.as === 'x' ? { x: px } : { y: px });

const varianten: Variants = {
  in: (c: Instelling) => (c.stil ? { ...verschuiving(c, 0), opacity: 1 } : { ...verschuiving(c, c.richting * c.afstand), opacity: 0 }),
  staat: (c: Instelling) => ({ ...verschuiving(c, 0), opacity: 1, transition: { duration: c.stil ? 0 : DUR.base, ease: EASE_SPRING } }),
  uit: (c: Instelling) => (c.stil || c.uitStil
    ? { opacity: 0, transition: { duration: 0 } }
    : { ...verschuiving(c, -c.richting * c.afstand), opacity: 0, transition: { duration: DUR.fast, ease: EASE } }),
};

export function RichtingWissel({ sleutel, richting, as = 'x', afstand = 4, stil = false, uitStil = false, knip = false, className, innerClassName, children }: {
  /** Identiteit van de inhoud; verandert die, dan wisselt het. */
  sleutel: string | number;
  richting: 1 | -1;
  as?: 'x' | 'y';
  afstand?: number;
  stil?: boolean;
  uitStil?: boolean;
  knip?: boolean;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const c: Instelling = { richting, as, afstand, stil: stil || reduced, uitStil };
  return (
    // relative: popLayout zet de vertrekkende inhoud absoluut in deze doos.
    <div className={cn('relative', knip && '-mx-2 -mt-2 overflow-clip px-2 pt-2 [overflow-clip-margin:8px]', className)}>
      <AnimatePresence mode="popLayout" initial={false} custom={c}>
        <motion.div key={sleutel} custom={c} variants={varianten} initial="in" animate="staat" exit="uit" className={innerClassName}>
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
