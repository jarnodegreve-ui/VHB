import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { cn } from '../lib/ui';
import { useKeyboardInset } from '../lib/useKeyboardInset';

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
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  dismissOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body-scroll-lock, zelfde patroon als SlideOver. Zonder dit scrollde en
  // rubberbandde de pagina áchter de modal mee zodra je binnenin het einde van
  // een lijst bereikte — de modal leek dan te "zwabberen".
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
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
      transition={{ duration: 0.16 }}
      onClick={dismissOnBackdrop ? onClose : undefined}
      // Op mobile: minimale padding zodat de modal bijna full-screen kan,
      // en respecteer safe-area (notch + home-indicator).
      // Op md+: 1rem padding rondom de modal.
      className="fixed inset-0 z-[100] flex items-center justify-center p-2 md:p-4 bg-slate-900/40 backdrop-blur-sm"
      style={{
        paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
        paddingBottom: keyboardInset
          ? `${keyboardInset}px`
          : 'max(0.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        // Op mobile: max-h volle viewport minus safe-area-padding, met
        // iets minder agressieve rounded-hoeken (32px voelt overkill op
        // bijna-full-screen). Op md+: zoals voorheen.
        className={cn(
          'glass-modal rounded-3xl md:rounded-3xl w-full overflow-y-auto overscroll-contain max-h-[calc(100dvh-1rem)] md:max-h-[88dvh]',
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
