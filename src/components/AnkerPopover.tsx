import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { BREEDTE, MENU_ITEMS, POPOVER_VLAK, type PopoverBreedte } from './Popover';

/**
 * AnkerPopover (3B.2, 23-09): het vlak van `Popover`, voor een popover in een
 * kader dat knipt (een tabel die in haar TableShell-strook schuift, de
 * onderste rijen van Dagadministratie). Het vlak staat, net als ActieMenu,
 * in een portal op <body> met `position: fixed`, gemeten vanaf het anker (de
 * trigger): onder het anker als het daar past, anders erboven, anders tegen
 * de onderrand van de viewport (over het anker) en pas als het hoger is dan
 * de viewport met een eigen scroll; horizontaal altijd binnen de viewport.
 * Bij scrollen en resizen volgt het vlak het anker; schuift het anker uit
 * beeld, dan roept het `onSluit`. Geef `vlakRef={vlak}` van useDropdown
 * mee, zodat een klik in het vlak geen buiten-klik is. Bij openen krijgt het
 * eerste bedieningselement de focus (het vlak staat achteraan in de DOM, Tab
 * vanaf de trigger zou het anders overslaan); Tab voorbij het eerste of
 * laatste element, Escape en een buiten-klik zetten de focus terug op het
 * anker.
 *
 * Eigen module, niet in Popover.tsx: Popover zit via de schil (UserMenu,
 * Meldingen) in de startbundel, deze ankercode alleen in de chunk van het
 * scherm dat haar gebruikt.
 *
 *   const { open, setOpen, wortel, vlak } = useDropdown();
 *   const knop = useRef<HTMLButtonElement>(null);
 *   <div ref={wortel} className="relative">
 *     <Button ref={knop} … aria-expanded={open} onClick={() => setOpen((v) => !v)} />
 *     <AnkerPopover open={open} label="…" anker={knop} vlakRef={vlak} onSluit={() => setOpen(false)}>…</AnkerPopover>
 *   </div>
 */

const FOCUSBAAR = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
/** Waar een buiten-klik de focus mag houden (zie het sluit-effect). */
const BEDIENING = 'input, select, textarea, button, a[href], [contenteditable=""], [contenteditable="true"]';
/** Afstand tot het anker en tot de rand van de viewport (zoals ActieMenu). */
const MARGE = 8;

type AnkerPositie = { stijl: CSSProperties; boven: boolean };

/** Rekenkern van de ankerpositie; los getest in AnkerPopover.test.ts. */
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

export function AnkerPopover({
  open,
  rol = 'dialog',
  label,
  align = 'right',
  breedte = 'md',
  padding = 'menu',
  mobielVol = false,
  focusEerste = true,
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
  mobielVol?: boolean;
  /** Focus bij openen op het eerste menu-item (`rol="menu"`) of anders op
   *  het eerste bedieningselement (standaard aan). */
  focusEerste?: boolean;
  /** De trigger: het vlak zweeft in een portal, vast aan dit element. */
  anker: RefObject<HTMLElement | null>;
  /** Ref van useDropdown (`vlak`), zodat een klik in het vlak niet sluit. */
  vlakRef?: RefObject<HTMLDivElement | null>;
  /** Het anker schoof uit beeld of Tab verliet het vlak. */
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

  const [positie, setPositie] = useState<AnkerPositie | null>(null);
  // Het vlak krijgt pas na de eerste meting focus (anders scrolt de browser
  // naar de voorlopige plek).
  const zichtbaar = positie !== null;

  useEffect(() => {
    if (!open || !focusEerste || !zichtbaar) return;
    const doel = ref.current?.querySelector<HTMLElement>(rol === 'menu' ? MENU_ITEMS : FOCUSBAAR);
    doel?.focus();
  }, [open, focusEerste, rol, zichtbaar]);

  const onSluitRef = useRef(onSluit);
  onSluitRef.current = onSluit;
  /** Meet en zet de positie; false als het anker uit beeld is. */
  const plaats = useCallback((): boolean => {
    const a = anker.current;
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
    if (!open) { setPositie(null); return; }
    plaats();
  }, [open, plaats]);
  useEffect(() => {
    if (!open) return;
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
  }, [open, plaats]);
  // Sluiten (Escape, buiten-klik, Sluiten-knop): de focus terug op het anker,
  // tenzij de gebruiker bewust in een ander bedieningselement klikte (een
  // invoerveld, knop of link); een klik op tekst of op de schuifstrook van de
  // tabel (focusbare region) telt niet.
  const wasOpen = useRef(open);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (open || !was) return;
    const id = requestAnimationFrame(() => {
      const actief = document.activeElement;
      if (!actief || actief === document.body || ref.current?.contains(actief) || !actief.matches(BEDIENING)) anker.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, anker]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
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

  const boven = Boolean(positie?.boven);
  const y = boven ? 4 : -4;
  // Vóór de eerste meting staat het vlak op (0,0); de meting loopt in een
  // layout-effect, dus vóór de eerste paint (en de in-animatie begint op
  // opacity 0). Geen `visibility: hidden` zoals ActieMenu: motion zet stijl
  // pas in zijn eigen frame, en een verborgen vlak weigert de focus.
  const stijl: CSSProperties = positie
    ? { ...positie.stijl, transformOrigin: `${boven ? 'bottom' : 'top'} ${align}` }
    : { top: 0, left: 0 };
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
            POPOVER_VLAK,
            // In een portal: boven de topbar en het dock, zoals de rijmenu's.
            'fixed z-menu',
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
  if (typeof document === 'undefined') return vlak;
  return createPortal(vlak, document.body);
}
