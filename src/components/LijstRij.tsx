import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { DUR, EASE } from '../lib/motion';
import { startStand, toonBeslist } from '../lib/beslisteRijen';

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

/**
 * De vasthoudstand na een beslissing (ronde 6, punt 1; rekenkern en
 * loslaatregel in src/lib/beslisteRijen.ts). Een view roept na een GESLAAGDE
 * beslissing (`ok === true`, nooit bij een fout, 409 of 500) `houdVast(id,
 * klik?)` aan, in dezelfde tik als de nieuwe collectie: React tekent ze samen,
 * er is dus geen beeld waarin de rij al weg is. Zolang de stand duurt, staat
 * dat vak (een rij, of een vak dat geen rij is, zoals de voet van een paneel)
 * er met het record zoals het nu in de collectie staat, inert en zonder
 * knoppen; daarna laat het los.
 *
 * `klik` is het event van de beslissing (een React- of DOM-event volstaat,
 * gelezen op het moment van houdVast). Viel het met de aanwijzer (`detail >
 * 0`) in het vak zelf, dan duurt de stand ook tot de aanwijzer dat vak
 * verliet of de vinger ergens anders neerkwam (`startStand`). Met het
 * toetsenbord (`detail` 0), of als de klik in een paneel of een bevestiging
 * viel: alleen de tijd. Stond de focus in het vak (een knop die nu
 * verdwijnt), dan gaat ze naar `bereik` (de lijst zelf, `tabIndex={-1}`),
 * nooit naar een beslisknop; een focus elders blijft waar ze is.
 *
 * Verlaat de gebruiker het scherm, dan stopt elke stand stil: geen klok of
 * luisteraar die doorloopt, geen state na het afbreken, en een houdVast die
 * daarna nog binnenkomt (een antwoord dat te laat kwam) doet niets.
 */
export type BeslisKlik = { detail: number; target: EventTarget | null };

const VAK = 'data-vasthoud-vak';
const GEEN: ReadonlySet<string> = new Set();

export function useVasthouden({ bereik }: {
  /** Waar de focus heen gaat als ze in een vastgehouden vak stond, en waarbinnen het vak gezocht wordt. */
  bereik?: RefObject<HTMLElement | null>;
} = {}) {
  const [vast, setVast] = useState<ReadonlySet<string>>(GEEN);
  const standen = useRef(new Map<string, () => void>());
  const levend = useRef(false);
  useEffect(() => {
    levend.current = true;
    const lopend = standen.current;
    return () => {
      levend.current = false;
      for (const stop of lopend.values()) stop();
      lopend.clear();
    };
  }, []);

  const houdVast = useCallback((sleutel: string, klik?: BeslisKlik) => {
    if (!levend.current) return;
    const wortel = bereik?.current ?? null;
    const metSleutel = (el: Element | null) => (el instanceof HTMLElement && el.getAttribute(VAK) === sleutel ? el : null);
    const viaKlik = klik?.target instanceof Element ? metSleutel(klik.target.closest(`[${VAK}]`)) : null;
    const vak = viaKlik ?? [...(wortel ?? document).querySelectorAll(`[${VAK}]`)].map(metSleutel).find((el) => el) ?? null;
    const actief = document.activeElement;
    if (vak && actief && vak.contains(actief)) wortel?.focus({ preventScroll: true });
    standen.current.get(sleutel)?.();
    standen.current.set(sleutel, startStand({
      aanwijzer: !!viaKlik && (klik?.detail ?? 0) > 0,
      vak: () => (vak && vak.isConnected ? vak.getBoundingClientRect() : null),
      klaar: () => {
        standen.current.delete(sleutel);
        setVast((v) => { const n = new Set(v); n.delete(sleutel); return n; });
      },
    }));
    setVast((v) => (v.has(sleutel) ? v : new Set(v).add(sleutel)));
  }, [bereik]);

  return {
    houdVast,
    /** De sleutels die nu vastgehouden worden. */
    vast,
    isVast: (sleutel: string) => vast.has(sleutel),
    /** Op het element van het vak: herkenning voor de aanwijzerregel, en inert zolang de stand duurt. */
    vak: (sleutel: string, isVast = vast.has(sleutel)) => ({ [VAK]: sleutel, inert: isVast || undefined }),
  };
}

/**
 * De vasthoudstand voor een lijst. `getoond` is wat de lijst tekent: `lijst`
 * (de bron waarop al de rest rekent, ongewijzigd), met elke vastgehouden rij
 * op haar plaats van vóór de beslissing en met het record uit `zoek` (de
 * collectie). Na de stand verlaat ze `getoond`: wat er niet meer in hoort
 * klapt dicht (`LijstRij`), wat elders hoort schuift erheen (`layout`).
 */
export function useBeslisteRijen<T>(lijst: readonly T[], { sleutel, zoek }: {
  sleutel: (record: T) => string;
  zoek: (id: string) => T | undefined;
}) {
  const lijstRef = useRef<HTMLDivElement | null>(null);
  const stand = useVasthouden({ bereik: lijstRef });
  // De ids van de laatst GETEKENDE lijst: daar staat een vastgehouden rij.
  const vorige = useRef<string[]>([]);
  const getoond = toonBeslist({ huidig: lijst, sleutel, vorige: vorige.current, vast: stand.vast, zoek });
  const ids = getoond.map(({ record }) => sleutel(record));
  useLayoutEffect(() => { vorige.current = ids; });
  return { getoond, houdVast: stand.houdVast, lijstRef, vak: stand.vak };
}
