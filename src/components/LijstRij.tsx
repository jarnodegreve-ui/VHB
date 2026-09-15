import { createContext, useContext, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { DUR, EASE } from '../lib/motion';

/**
 * Lijstmutaties met een lichaam (golf 4, punt 10). De datalaag is
 * optimistisch en verwijderen gaat zonder bevestiging met een undo-toast:
 * een rij verdween tot nu in één frame, de rijen eronder sprongen omhoog en
 * na "Ongedaan maken" sprongen ze weer terug. Eén recept voor alle lijsten
 * die per record schrijven:
 *
 * - `LijstAnimatie` om de gerenderde rijen (géén DOM-element; de `<ul>`,
 *   `<tbody>` of `<div>` blijft van de aanroeper). `initial={false}`: de
 *   eerste render animeert niet, alleen wat later bijkomt of weggaat.
 * - `LijstRij` per rij, met een stabiele `key` op het record-id. Uit =
 *   opacity 0 + 8 px naar rechts + hoogte en marges naar 0 op DUR.fast/EASE
 *   (de rij klapt dicht en de rest schuift mee); in = opacity 0→1 + 4 px van
 *   boven op DUR.base. Na "Ongedaan maken" komt hetzelfde id op zijn eigen
 *   plek terug (de lijst is gesorteerd, de key is het id).
 * - `layout="position"` (alleen translate, geen schaal: ringen en radius
 *   blijven scherp) laat de buren glijden i.p.v. springen, en alleen als de
 *   lijst kleiner is dan 50 rijen én zonder reduced motion; erboven zijn
 *   50+ layout-metingen per mutatie te duur voor wat het oplevert.
 * - Tabelrijen (`as="tr"`): een `<tr>` laat zijn hoogte niet onder de
 *   celinhoud zakken en een layout-transform op rijen breekt de
 *   kolomuitlijning, dus daar alleen opacity + 8 px, zonder hoogte en
 *   zonder `layout` (de rijen eronder springen, maar de rij verdwijnt niet
 *   meer in één frame).
 * - Reduced motion: alles op duur 0, dezelfde eindtoestand.
 *
 * `overflow: hidden` staat alleen tijdens de uitgang (anders knipt het de
 * focusring en de hover-lift van een kaart af).
 */
const LAYOUT_MAX = 50;

const LijstContext = createContext<{ layout: boolean; reduced: boolean }>({ layout: false, reduced: false });

export function LijstAnimatie({ aantal, children }: {
  /** Aantal rijen in de lijst (beslist of de buren met `layout` glijden). */
  aantal: number;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <LijstContext.Provider value={{ layout: !reduced && aantal < LAYOUT_MAX, reduced }}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </LijstContext.Provider>
  );
}

type Tag = 'li' | 'div' | 'tr' | 'section';

type RijProps<T extends Tag> = Omit<HTMLMotionProps<T>, 'initial' | 'animate' | 'exit' | 'layout' | 'transition'> & {
  as?: T;
  children?: ReactNode;
};

export function LijstRij<T extends Tag = 'li'>({ as, children, style, ...rest }: RijProps<T>) {
  const { layout, reduced } = useContext(LijstContext);
  const tag: Tag = as ?? 'li';
  const Comp = motion[tag] as unknown as typeof motion.div;
  const plat = tag === 'tr';
  const uit = { duration: reduced ? 0 : DUR.fast, ease: EASE };
  const inn = { duration: reduced ? 0 : DUR.base, ease: EASE };
  return (
    <Comp
      layout={layout && !plat ? 'position' : undefined}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0, x: 0, transition: inn }}
      exit={plat
        ? { opacity: 0, x: 8, transition: uit }
        : { opacity: 0, x: 8, height: 0, marginTop: 0, marginBottom: 0, overflow: 'hidden', transition: uit }}
      style={style as HTMLMotionProps<'div'>['style']}
      {...(rest as Omit<HTMLMotionProps<'div'>, 'style'>)}
    >
      {children}
    </Comp>
  );
}
