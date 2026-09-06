import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/ui';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { DUR, EASE_SPRING } from '../lib/motion';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';

// Stapel van open modals (module-scope): bij een dialoog bóven een dialoog
// (bv. verwijder-bevestiging boven Gebruikersbeheer-modal) mogen ESC en de
// focus-trap alleen op de bovenste werken — anders sloten beide tegelijk en
// trok de onderliggende trap de focus uit de bevestiging weg.
const modalStack: symbol[] = [];

/**
 * Portal-rendered modal with backdrop, click-outside-to-close and ESC support.
 *
 * Renders into document.body to escape ancestor transform/filter contexts
 * that would otherwise trap `position: fixed`. We deliberately do NOT use
 * AnimatePresence here — the exit animation kept the backdrop mounted for
 * a few frames after close and occasionally swallowed scroll events. With
 * an instant unmount we keep the elegant enter animation but the page is
 * always immediately interactive again after the modal closes.
 */
export function Modal({
  open,
  onClose,
  children,
  maxWidth = 'md',
  className,
  dismissOnBackdrop = true,
  ariaLabel,
  boven = false,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  dismissOnBackdrop?: boolean;
  /** Toegankelijke naam van de dialoog — zonder deze heet elke modal voor
   *  VoiceOver alleen "dialoog". Geef mee wat de kop van de inhoud is. */
  ariaLabel?: string;
  /** Rendert boven een al openstaande modal (hogere z-index) — voor
   *  bevestigings-dialogen bovenop een formulier-modal. */
  boven?: boolean;
}) {
  const idRef = useRef(Symbol('modal'));
  // Vóór élke early return (hooks-volgorde): stond eerst ná `if (!open)
  // return null`, waardoor het openen van een modal React liet crashen op
  // "rendered more hooks" — de e2e-smoke ving dat (PR #403).
  const reduceMotion = useReducedMotion();
  const isBovenste = () => modalStack[modalStack.length - 1] === idRef.current;
  // Terugknop/swipe-back sluit de dialoog i.p.v. de app (PWA op Android).
  useHistoryDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    modalStack.push(id);
    return () => {
      const i = modalStack.indexOf(id);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // Alleen de bovenste dialoog sluit op ESC — anders klapte een
      // bevestiging én zijn onderliggende formulier in één toets dicht.
      if (event.key === 'Escape' && isBovenste()) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Dialoog-semantiek + focus-beheer (zelfde patroon als SlideOver): focus
  // het paneel bij openen, houd Tab binnen de dialoog (aria-modal), en zet
  // de focus bij sluiten terug waar hij vandaan kwam — anders landt een
  // toetsenbord-/VoiceOver-gebruiker weer bovenaan de pagina.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Respecteer een autoFocus-veld in de inhoud: React zet die focus vóór
    // dit effect, en het paneel mag hem dan niet meer afpakken.
    const panel = panelRef.current;
    if (panel && !(document.activeElement && panel.contains(document.activeElement))) panel.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !isBovenste()) return;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (active && !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Scroll-lock. De app scrolt niet op <body> maar in een eigen container
  // ([data-scroll-root] in App.tsx) — alleen body locken was daardoor een
  // no-op en de pagina rubberbandde achter de modal mee zodra je binnenin
  // het einde van een lijst bereikte. Beide locken: body als vangnet (print,
  // login), de echte scroll-root voor de app zelf.
  useEffect(() => {
    if (!open) return;
    const scrollRoot = document.querySelector<HTMLElement>('[data-scroll-root]');
    const previousBody = document.body.style.overflow;
    const previousRoot = scrollRoot?.style.overflow ?? '';
    document.body.style.overflow = 'hidden';
    if (scrollRoot) scrollRoot.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBody;
      if (scrollRoot) scrollRoot.style.overflow = previousRoot;
    };
  }, [open]);

  // iOS: het toetsenbord bedekt anders de onderkant van de modal (o.a. de
  // opslaan-knop), want de layout-viewport krimpt niet mee.
  const keyboardInset = useKeyboardInset(open);

  if (typeof document === 'undefined' || !open) return null;

  const widthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  }[maxWidth];

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.16 }}
      onClick={dismissOnBackdrop ? onClose : undefined}
      // Op mobile: minimale padding zodat de modal bijna full-screen kan,
      // en respecteer safe-area (notch + home-indicator).
      // Op md+: 1rem padding rondom de modal.
      className={cn(
        'fixed inset-0 flex items-center justify-center p-2 md:p-4 bg-ink/40 backdrop-blur-sm',
        boven ? 'z-[120]' : 'z-[100]',
      )}
      style={{
        paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
        paddingBottom: keyboardInset
          ? `${keyboardInset}px`
          : 'max(0.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        // Zelfde reduced-motion-respect als SlideOver (Modal miste het:
        // de CSS-regel raakt alleen CSS-animaties, niet deze JS-animaties).
        initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        // Binnenkomend met de veer (EASE_SPRING); de Modal heeft geen exit-
        // animatie (zie boven), dus de standaard-ease komt hier niet voor.
        transition={reduceMotion ? { duration: 0 } : { duration: DUR.base, ease: EASE_SPRING }}
        onClick={(e) => e.stopPropagation()}
        // Op mobile: max-h = viewport minus de safe-area-padding van de
        // backdrop hierboven (dezelfde max(0.5rem, env(…))-termen), zodat een
        // lange modal niet ±30 px in de home-indicator-zone zakt (controle-
        // ronde 27-08, nr. 34); iets minder agressieve rounded-hoeken (32px
        // voelt overkill op bijna-full-screen). Op md+: zoals voorheen.
        className={cn(
          'glass-modal rounded-3xl md:rounded-3xl w-full overflow-y-auto overscroll-contain max-h-[calc(100dvh-max(0.5rem,env(safe-area-inset-top))-max(0.5rem,env(safe-area-inset-bottom)))] md:max-h-[88dvh]',
          widthClass,
          className,
        )}
        // Toetsenbord open: ook het páneel moet krimpen, niet alleen de
        // backdrop-padding. dvh krimpt op iOS niet mee met het toetsenbord, en
        // de backdrop is items-center — het paneel behield dus zijn volle
        // hoogte en liep boven én onder buiten beeld. In de ruilwizard zat de
        // knop "Ruilverzoek versturen" daardoor achter het toetsenbord zodra
        // je de opmerking-textarea aantikte. Inline, zodat het wint van een
        // max-h die de aanroeper via className meegeeft.
        style={keyboardInset ? { maxHeight: `calc(100dvh - ${keyboardInset}px - 1rem)` } : undefined}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
