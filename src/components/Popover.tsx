import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';

/**
 * Popover: hét zwevende vlak onder een trigger (ronde 5, F2). Vóór dit
 * primitief bouwden acht plekken hun eigen recept (UserMenu, Open taken,
 * Meldingen, aanwezigheid, InfoTip, kolommenmenu, vlaggen, rijmenu) met
 * vijf breedtes, twee radii, drie paddings en drie z-lagen. Nu één vorm:
 * `rounded-2xl bg-paper ring-1 ring-hairline elev-2`, veer in / ease uit.
 *
 * Open/dicht komt van `useDropdown()` (buiten-klik + Escape); de aanroeper
 * zet `ref={wortel}` op de `relative` wrapper rond trigger en Popover:
 *
 *   const { open, setOpen, wortel } = useDropdown();
 *   <div ref={wortel} className="relative">
 *     <IconButton … aria-expanded={open} onClick={() => setOpen((v) => !v)} />
 *     <Popover open={open} rol="menu" label="Account"><MenuItem …>…</MenuItem></Popover>
 *   </div>
 *
 * `rol="menu"`: focus op het eerste item bij openen, pijltjes/Home/End
 * tussen de items (WAI-ARIA-menupatroon). `rol="dialog"` voor uitleg en
 * lijsten zonder menugedrag (InfoTip, aanwezigheid, kolommen).
 * `laag`: `zwevend` in de inhoud (z-zwevend), `menu` in de topbar (z-menu).
 * `mobielVol`: op een telefoon losgekoppeld van de trigger en over de volle
 * breedte (de panelen in de topbar, die anders links buiten beeld vielen).
 *
 * `anker` (3B.2, 23-09): voor een popover in een kader dat knipt (een tabel
 * die in haar TableShell-strook schuift, de onderste rijen van
 * Dagadministratie). Het vlak staat dan, net als ActieMenu, in een portal op
 * <body> met `position: fixed`, gemeten vanaf het anker (de trigger): onder
 * het anker als het daar past, anders erboven, anders tegen de onderrand
 * van de viewport (over het anker) en pas als het hoger is dan de viewport
 * met een eigen scroll; horizontaal altijd binnen de viewport. Bij scrollen en resizen volgt het vlak het anker; schuift het
 * anker uit beeld, dan roept het `onSluit`. Geef `vlakRef={vlak}` van
 * useDropdown mee, zodat een klik in het vlak geen buiten-klik is. Bij
 * openen krijgt het eerste bedieningselement de focus (het vlak staat
 * achteraan in de DOM, Tab vanaf de trigger zou het anders overslaan);
 * Tab voorbij het eerste of laatste element, Escape en een buiten-klik
 * zetten de focus terug op het anker.
 */
export type PopoverBreedte = 'sm' | 'md' | 'lg' | 'xl';
const BREEDTE: Record<PopoverBreedte, string> = { sm: 'w-56', md: 'w-64', lg: 'w-72', xl: 'w-80' };

const MENU_ITEMS = '[role="menuitem"]:not(:disabled)';
const FOCUSBAAR = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
/** Waar een buiten-klik de focus mag houden (zie het sluit-effect). */
const BEDIENING = 'input, select, textarea, button, a[href], [contenteditable=""], [contenteditable="true"]';
/** Afstand tot het anker en tot de rand van de viewport (zoals ActieMenu). */
const MARGE = 8;

type AnkerPositie = { stijl: CSSProperties; boven: boolean };

/** Rekenkern van de ankerpositie; los getest in Popover.test.ts. */
export function ankerPositie(
  t: { top: number; bottom: number; left: number; right: number },
  vlak: { breedte: number; hoogte: number },
  viewport: { breedte: number; hoogte: number },
  align: 'left' | 'right',
  mobielVol = false,
): AnkerPositie {
  const { breedte: vw, hoogte: vh } = viewport;
  const onder = vh - t.bottom - 2 * MARGE;
  const erboven = t.top - 2 * MARGE;
  let stijl: CSSProperties;
  let boven = false;
  if (vlak.hoogte <= onder) stijl = { top: t.bottom + MARGE };
  else if (vlak.hoogte <= erboven) { stijl = { bottom: vh - t.top + MARGE }; boven = true; }
  // Past aan geen van beide kanten (telefoon, anker midden in beeld): tegen de
  // onderrand van de viewport, over het anker heen, liever dan een eigen scroll.
  else if (vlak.hoogte <= vh - 2 * MARGE) stijl = { top: vh - MARGE - vlak.hoogte };
  // Hoger dan de viewport: volle hoogte met een eigen scroll.
  else stijl = { top: MARGE, maxHeight: vh - 2 * MARGE, overflowY: 'auto' };
  const maxBreedte = vw - 2 * MARGE;
  if (mobielVol && vw < 640) {
    stijl.left = MARGE; stijl.right = MARGE; stijl.width = 'auto';
    return { stijl, boven };
  }
  const breedte = Math.min(vlak.breedte, maxBreedte);
  if (vlak.breedte > maxBreedte) stijl.width = maxBreedte;
  // Voorkeurskant volgens `align`, binnen de viewport geschoven.
  const links = align === 'left' ? t.left : t.right - breedte;
  stijl.left = Math.min(Math.max(MARGE, links), vw - MARGE - breedte);
  return { stijl, boven };
}

export function Popover({
  open,
  rol = 'dialog',
  label,
  align = 'right',
  breedte = 'md',
  padding = 'menu',
  laag = 'zwevend',
  mobielVol = false,
  focusEerste,
  anker,
  vlakRef,
  onSluit,
  id,
  className,
  children,
}: {
  open: boolean;
  rol?: 'dialog' | 'menu';
  /** Toegankelijke naam van het vlak. */
  label: string;
  align?: 'left' | 'right';
  breedte?: PopoverBreedte;
  /** `menu` = p-1.5 rond menurijen, `tekst` = p-3.5 rond lopende tekst. */
  padding?: 'menu' | 'tekst';
  laag?: 'zwevend' | 'menu';
  mobielVol?: boolean;
  /** Focus op het eerste menu-item bij openen (standaard bij `rol="menu"`
   *  en bij een `anker`, daar op het eerste bedieningselement). */
  focusEerste?: boolean;
  /** De trigger: het vlak zweeft dan in een portal, vast aan dit element
   *  (ontsnapt aan elk kader dat knipt; zie de uitleg bovenaan). */
  anker?: RefObject<HTMLElement | null>;
  /** Ref van useDropdown (`vlak`), zodat een klik in het vlak niet sluit. */
  vlakRef?: RefObject<HTMLDivElement | null>;
  /** Met `anker`: het anker schoof uit beeld of Tab verliet het vlak. */
  onSluit?: () => void;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const zetRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (vlakRef) vlakRef.current = el;
  }, [vlakRef]);
  const focusOpEerste = focusEerste ?? (rol === 'menu' || Boolean(anker));

  // --- Ankermodus: portal + fixed, gemeten vanaf de trigger ---
  const [positie, setPositie] = useState<AnkerPositie | null>(null);
  // Een geankerd vlak krijgt pas na de eerste meting focus (anders scrolt de
  // browser naar de voorlopige plek).
  const zichtbaar = !anker || positie !== null;

  useEffect(() => {
    if (!open || !focusOpEerste || !zichtbaar) return;
    const doel = ref.current?.querySelector<HTMLElement>(rol === 'menu' ? MENU_ITEMS : FOCUSBAAR);
    doel?.focus();
  }, [open, focusOpEerste, rol, zichtbaar]);

  const onSluitRef = useRef(onSluit);
  onSluitRef.current = onSluit;
  /** Meet en zet de positie; false als het anker uit beeld is. */
  const plaats = useCallback((): boolean => {
    const a = anker?.current;
    const el = ref.current;
    if (!a || !el) return true;
    const t = a.getBoundingClientRect();
    if (t.bottom < 0 || t.top > window.innerHeight || t.width === 0) return false;
    // offset-/scrollmaten: de in-animatie schaalt het vlak (transform), dat
    // mag de meting niet verkleinen; scrollHeight negeert een eerdere maxHeight.
    setPositie(ankerPositie(t, { breedte: el.offsetWidth, hoogte: el.scrollHeight }, { breedte: window.innerWidth, hoogte: window.innerHeight }, align, mobielVol));
    return true;
  }, [anker, align, mobielVol]);
  useLayoutEffect(() => {
    if (!anker) return;
    if (!open) { setPositie(null); return; }
    plaats();
  }, [open, anker, plaats]);
  useEffect(() => {
    if (!anker || !open) return;
    const volg = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      if (!plaats()) onSluitRef.current?.();
    };
    window.addEventListener('scroll', volg, true);
    window.addEventListener('resize', volg);
    return () => {
      window.removeEventListener('scroll', volg, true);
      window.removeEventListener('resize', volg);
    };
  }, [anker, open, plaats]);
  // Sluiten (Escape, buiten-klik, Sluiten-knop): de focus terug op het anker,
  // tenzij de gebruiker bewust in een ander bedieningselement klikte (een
  // invoerveld, knop of link); een klik op tekst of op de schuifstrook van de
  // tabel (focusbare region) telt niet.
  const wasOpen = useRef(open);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (!anker || open || !was) return;
    const id = requestAnimationFrame(() => {
      const actief = document.activeElement;
      if (!actief || actief === document.body || ref.current?.contains(actief) || !actief.matches(BEDIENING)) anker.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, anker]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (anker && e.key === 'Tab') {
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSBAAR) ?? []);
      const eerste = items[0];
      const laatste = items[items.length - 1];
      if ((e.shiftKey && document.activeElement === eerste) || (!e.shiftKey && document.activeElement === laatste)) {
        e.preventDefault();
        anker.current?.focus();
        onSluitRef.current?.();
      }
      return;
    }
    if (rol !== 'menu') return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const volgende =
      e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % items.length
      : (i - 1 + items.length) % items.length;
    items[volgende].focus();
  };

  const boven = Boolean(anker && positie?.boven);
  const y = boven ? 4 : -4;
  // Vóór de eerste meting staat een geankerd vlak op (0,0); de meting loopt in
  // een layout-effect, dus vóór de eerste paint (en de in-animatie begint op
  // opacity 0). Geen `visibility: hidden` zoals ActieMenu: motion zet stijl
  // pas in zijn eigen frame, en een verborgen vlak weigert de focus.
  const stijl: CSSProperties = anker
    ? (positie ? { ...positie.stijl, transformOrigin: `${boven ? 'bottom' : 'top'} ${align}` } : { top: 0, left: 0 })
    : { transformOrigin: `top ${align}` };
  const vlak = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={zetRef}
          id={id}
          role={rol}
          aria-label={label}
          onKeyDown={onKeyDown}
          initial={{ opacity: 0, scale: 0.97, y }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE_SPRING } }}
          exit={{ opacity: 0, scale: 0.97, y, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE } }}
          style={stijl}
          className={cn(
            'rounded-2xl bg-paper ring-1 ring-hairline elev-2 outline-none',
            anker
              // In een portal: boven de topbar en het dock, zoals de rijmenu's.
              ? 'fixed z-menu'
              : cn(
                'absolute top-full mt-2',
                align === 'right' ? 'right-0' : 'left-0',
                laag === 'menu' ? 'z-menu' : 'z-zwevend',
                mobielVol && 'max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:w-auto',
              ),
            BREEDTE[breedte],
            padding === 'menu' ? 'p-1.5' : 'p-3.5',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
  if (anker && typeof document !== 'undefined') return createPortal(vlak, document.body);
  return vlak;
}

/**
 * Kop van een Popover: titel links, één kleine actie rechts, haarlijn eronder.
 */
export function PopoverKop({ titel, aside, className }: { titel: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-1 flex items-center justify-between gap-2 border-b fine-divider px-3 py-2', className)}>
      <span className="text-sm font-semibold text-slate-800">{titel}</span>
      {aside}
    </div>
  );
}

/** Voet van een Popover: haarlijn erboven, meestal één MenuItem "Alles…". */
export function PopoverVoet({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-1 border-t fine-divider pt-1', className)}>{children}</div>;
}

/**
 * Menurij in een Popover (role=menuitem): icoon links, label, optionele
 * tweede regel en iets rechts (pijl, teller). Eén recept voor UserMenu,
 * Open taken, Meldingen en het rijmenu van Gebruikers, die elk hun eigen
 * rauwe knop hadden.
 */
export function MenuItem({
  icon,
  iconClassName,
  sub,
  trailing,
  gevaarlijk = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  /** Eigen tint voor het icoon (bv. rood/amber bij een open taak). */
  iconClassName?: string;
  sub?: ReactNode;
  trailing?: ReactNode;
  gevaarlijk?: boolean;
}) {
  return (
    // rauw: menurij (role=menuitem) met eigen rij-layout, links uitgelijnd;
    // Button centreert en dwingt min-h-11/semibold af.
    <button
      type={type}
      role="menuitem"
      className={cn(
        'tikbaar flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        gevaarlijk ? 'text-red-700 hover:bg-red-500/10' : 'text-slate-600 hover:bg-surface-soft-hover hover:text-slate-900',
        className,
      )}
      {...rest}
    >
      {icon && <span className={cn('shrink-0', sub && 'mt-0.5', gevaarlijk ? 'text-red-700' : 'text-slate-400', iconClassName)}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {sub && <span className="block truncate text-xs font-normal text-slate-500">{sub}</span>}
      </span>
      {trailing && <span className="shrink-0 self-center text-slate-400">{trailing}</span>}
    </button>
  );
}
