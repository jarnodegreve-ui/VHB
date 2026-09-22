import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
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
 */
export type PopoverBreedte = 'sm' | 'md' | 'lg' | 'xl';
const BREEDTE: Record<PopoverBreedte, string> = { sm: 'w-56', md: 'w-64', lg: 'w-72', xl: 'w-80' };

const MENU_ITEMS = '[role="menuitem"]:not(:disabled)';

export function Popover({
  open,
  rol = 'dialog',
  label,
  align = 'right',
  breedte = 'md',
  padding = 'menu',
  laag = 'zwevend',
  mobielVol = false,
  focusEerste = rol === 'menu',
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
  /** Focus op het eerste menu-item bij openen (standaard bij `rol="menu"`). */
  focusEerste?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !focusEerste) return;
    ref.current?.querySelector<HTMLElement>(MENU_ITEMS)?.focus();
  }, [open, focusEerste]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          id={id}
          role={rol}
          aria-label={label}
          onKeyDown={onKeyDown}
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE_SPRING } }}
          exit={{ opacity: 0, scale: 0.97, y: -4, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE } }}
          style={{ transformOrigin: `top ${align}` }}
          className={cn(
            'absolute top-full mt-2 rounded-2xl bg-paper ring-1 ring-hairline elev-2 outline-none',
            align === 'right' ? 'right-0' : 'left-0',
            BREEDTE[breedte],
            padding === 'menu' ? 'p-1.5' : 'p-3.5',
            laag === 'menu' ? 'z-menu' : 'z-zwevend',
            mobielVol && 'max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:w-auto',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
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
        'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors duration-fast',
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
