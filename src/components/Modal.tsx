import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/ui';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { useLaag } from '../lib/lagen';
import { Button } from './primitives';

/**
 * Sluiten met dirty-bescherming (tranche 3A, 22-09). Een overlay met
 * `vuil` (onbewaarde invoer) sluit niet zomaar op Escape, backdrop, de
 * terugknop, het kruisje of Annuleren: eerst de vraag "Wijzigingen niet
 * bewaren?". `useModalSluiten()` geeft de formulierknoppen dezelfde poort:
 *
 *   const sluitVia = useModalSluiten();
 *   <Button onClick={() => sluitVia(onClose)}>Annuleren</Button>
 *
 * Buiten een overlay roept `sluitVia` de functie gewoon aan. Een geslaagde
 * save sluit via de eigen `onClose` en passeert de vraag dus nooit.
 */
/** `bijVerder`: wat er moet gebeuren als de gebruiker kiest voor "Verder
 *  bewerken" (bv. de URL terugzetten op het record dat open blijft). */
export type SluitVia = (fn: () => void, bijVerder?: () => void) => boolean;
export const SluitContext = createContext<SluitVia | null>(null);
const DIRECT: SluitVia = (fn) => { fn(); return true; };
export function useModalSluiten(): SluitVia {
  return useContext(SluitContext) ?? DIRECT;
}

/** Annuleren/Sluiten-knop in een formulier-overlay: gaat door de sluitpoort
 *  (de aanroeper rendert de Modal zelf en staat dus búiten de context). */
export function SluitKnop({ onClose, onClick, ...rest }: React.ComponentProps<typeof Button> & { onClose: () => void }) {
  const sluitVia = useModalSluiten();
  return (
    <Button
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        sluitVia(onClose);
      }}
    />
  );
}

/** De vraag zelf, bóven de overlay. Gedeeld door Modal en SlideOver. */
export function OnbewaardDialoog({ open, onVerder, onNietBewaren }: { open: boolean; onVerder: () => void; onNietBewaren: () => void }) {
  return (
    <Modal open={open} onClose={onVerder} maxWidth="sm" ariaLabel="Wijzigingen niet bewaren?" boven>
      <div className="p-6 md:p-7">
        <h2 className="text-section-title">Wijzigingen niet bewaren?</h2>
        <p className="mt-1.5 text-body font-normal text-slate-500">Je hebt iets gewijzigd dat nog niet is opgeslagen.</p>
      </div>
      <div className="flex gap-2.5 bg-slate-50 p-5 md:p-6">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onVerder} autoFocus>
          Verder bewerken
        </Button>
        <Button variant="dangerSolid" size="lg" className="flex-1" onClick={onNietBewaren}>
          Niet bewaren
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Gedeelde sluitpoort van Modal, SlideOver en het desktop-DetailPaneel
 * (useDetailPoort): vuil → vraag eerst.
 *
 * `onNietBewaren` (optioneel) loopt alleen wanneer de gebruiker in de vraag
 * "Wijzigingen niet bewaren?" voor "Niet bewaren" kiest, vlak vóór het
 * wachtende sluiten. Zo kan een scherm dat zijn invoer over sluiten heen
 * bewaart (een concept) die invoer echt weggooien. "Verder bewerken" en een
 * gewoon sluiten zonder vraag roepen hem niet aan.
 */
export function useSluitPoort(open: boolean, vuil: boolean, onNietBewaren?: () => void) {
  const [vraag, setVraag] = useState(false);
  const wachtend = useRef<{ fn: () => void; bijVerder?: () => void } | null>(null);
  useEffect(() => {
    if (!open) {
      setVraag(false);
      wachtend.current = null;
    }
  }, [open]);
  const sluitVia: SluitVia = (fn, bijVerder) => {
    if (vuil) {
      // Een tweede verzoek terwijl de vraag openstaat (bv. een refetch die
      // dezelfde URL-wissel opnieuw aanbiedt) vervangt de wachtende actie.
      wachtend.current = { fn, bijVerder };
      setVraag(true);
      return false;
    }
    fn();
    return true;
  };
  const verder = () => {
    const w = wachtend.current;
    wachtend.current = null;
    setVraag(false);
    w?.bijVerder?.();
  };
  const nietBewaren = () => {
    const w = wachtend.current;
    wachtend.current = null;
    setVraag(false);
    onNietBewaren?.();
    w?.fn();
  };
  return { sluitVia, dialoog: <OnbewaardDialoog open={vraag} onVerder={verder} onNietBewaren={nietBewaren} /> };
}

/**
 * Portal-rendered modal with backdrop, click-outside-to-close and ESC support.
 *
 * Renders into document.body to escape ancestor transform/filter contexts
 * that would otherwise trap `position: fixed`.
 *
 * Uitgang (fase 2, 22-09): scrim en paneel faden uit op DUR.fast/EASE, zoals
 * SlideOver, ActieMenu en de menu's. Tot dan verdween elke Modal in één
 * frame, omdat een eerdere exit-animatie de scrim enkele frames liet staan
 * en scrollgebaren opslokte. Dat is opgelost door de scrim tijdens de
 * uitgang `pointer-events: none` te geven (niet-animeerbare waarde, geldt
 * meteen bij het begin van de exit) en door scroll-lock, focus-herstel en
 * de modal-stapel aan `open` te hangen, niet aan de mount: de pagina is dus
 * direct weer bedienbaar terwijl het paneel nog wegfadet.
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
  vuil = false,
  onNietBewaren,
  vast = false,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Onbewaarde invoer: Escape, backdrop, terugknop, kruisje en Annuleren
   *  (via useModalSluiten) vragen eerst "Wijzigingen niet bewaren?". */
  vuil?: boolean;
  /** Loopt alleen bij "Niet bewaren" in die vraag, vóór onClose: gooi hier
   *  een bewaard concept weg (zie useSluitPoort). */
  onNietBewaren?: () => void;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  className?: string;
  dismissOnBackdrop?: boolean;
  /** Toegankelijke naam van de dialoog — zonder deze heet elke modal voor
   *  VoiceOver alleen "dialoog". Geef mee wat de kop van de inhoud is. */
  ariaLabel?: string;
  /** Rendert boven een al openstaande modal (hogere z-index) — voor
   *  bevestigings-dialogen bovenop een formulier-modal. */
  boven?: boolean;
  /** Tijdens een lopende actie (bevestiging die op de server wacht): de
   *  terugknop, Escape en de achtergrond sluiten niet; de terugknop laat de
   *  entry staan, zodat een tweede tik de pagina niet midden in de actie verlaat. */
  vast?: boolean;
}) {
  // Vóór élke early return (hooks-volgorde): stond eerst ná `if (!open)
  // return null`, waardoor het openen van een modal React liet crashen op
  // "rendered more hooks" — de e2e-smoke ving dat (PR #403).
  const reduceMotion = useReducedMotion();
  // Eén laag in de gedeelde stapel (src/lib/lagen.ts): de terugknop en
  // Escape sluiten alleen de bovenste laag, met onbewaarde invoer of tijdens
  // een lopende actie weigert `sluit` (false) en blijft de entry staan. De
  // scroll-lock hangt aan dezelfde levensloop (src/lib/scrollSlot.ts).
  const { sluitVia, dialoog } = useSluitPoort(open, vuil, onNietBewaren);
  const sluit = () => (vast ? false : sluitVia(onClose));
  const laag = useLaag({ open, sluit, soort: 'dialoog', scrollSlot: 'modal' });
  // Focus-trap alleen in de bovenste dialoog (Modal of SlideOver); een menu
  // of datumkiezer erboven heeft zijn eigen toetsen.
  const isBovenste = () => laag.isBovenste('dialoog');

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
    // Focus mag de achterliggende scroll-root niet verplaatsen, ook niet
    // terwijl overflow:hidden staat (dat blokkeert alleen gebruikersscroll).
    if (panel && !(document.activeElement && panel.contains(document.activeElement))) panel.focus({ preventScroll: true });
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
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // iOS: het toetsenbord bedekt anders de onderkant van de modal (o.a. de
  // opslaan-knop), want de layout-viewport krimpt niet mee.
  const keyboardInset = useKeyboardInset(open);

  if (typeof document === 'undefined') return null;

  const widthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  }[maxWidth];

  return createPortal(
    <AnimatePresence>
      {open && (
    <motion.div
      key="modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: reduceMotion ? 0 : DUR.fast, ease: EASE } }}
      exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: reduceMotion ? 0 : DUR.fast, ease: EASE } }}
      onClick={dismissOnBackdrop && !vast ? () => sluit() : undefined}
      // Op mobile: minimale padding zodat de modal bijna full-screen kan,
      // en respecteer safe-area (notch + home-indicator).
      // Op md+: 1rem padding rondom de modal.
      className={cn(
        'fixed inset-0 flex items-center justify-center p-2 md:p-4 bg-ink/40 backdrop-blur-sm',
        boven ? 'z-modal-boven' : 'z-modal',
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
        // Binnenkomend met de veer (EASE_SPRING), uitgaand korter op de
        // standaard-ease, zoals elk paneel in de app.
        animate={{ opacity: 1, scale: 1, y: 0, transition: reduceMotion ? { duration: 0 } : { duration: DUR.base, ease: EASE_SPRING } }}
        exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.98, y: 8, transition: { duration: DUR.fast, ease: EASE } }}
        onClick={(e) => e.stopPropagation()}
        // Op mobile: max-h = viewport minus de safe-area-padding van de
        // backdrop hierboven (dezelfde max(0.5rem, env(…))-termen), zodat een
        // lange modal niet ±30 px in de home-indicator-zone zakt (controle-
        // ronde 27-08, nr. 34); iets minder agressieve rounded-hoeken (32px
        // voelt overkill op bijna-full-screen). Op md+: zoals voorheen.
        className={cn(
          // focus-stil: het paneel krijgt bij openen programmatisch focus
          // (focus-trap); een ring om het hele venster zegt niets.
          'glass-modal focus-stil rounded-3xl md:rounded-3xl w-full overflow-y-auto overscroll-contain max-h-[calc(100dvh-max(0.5rem,env(safe-area-inset-top))-max(0.5rem,env(safe-area-inset-bottom)))] md:max-h-overlay',
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
        <SluitContext.Provider value={sluitVia}>{children}</SluitContext.Provider>
        {dialoog}
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
