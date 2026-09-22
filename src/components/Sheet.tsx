import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';
import { IconButton } from './primitives';

/**
 * Sheet (ronde 5, F2): paneel dat van onder komt, dé overlay voor een
 * telefoon. Veer in, ease uit, sluit op scrim, kruisje, Escape, terugknop
 * én een veeg omlaag (drempel 80 px of 600 px/s, zelfde als de toast).
 * Boven `sm` blijft het een sheet maar smaller en gecentreerd, zodat één
 * component op elk formaat werkt. Scroll-lock op body én de scroll-root,
 * focus naar het paneel en terug naar de trigger, zoals Modal en SlideOver.
 *
 * Wanneer welke overlay: Modal = beslissing of formulier midden in beeld;
 * SlideOver = detail naast een lijst (desktop); Sheet = keuze of kort
 * formulier onder de duim (telefoon); Popover = klein vlak onder een knop.
 */
export function Sheet({ open, onClose, title, subtitle, children, footer, ariaLabel, className }: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Toegankelijke naam als er geen titel is. */
  ariaLabel?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const paneel = useRef<HTMLDivElement>(null);
  useHistoryDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const scrollRoot = document.querySelector<HTMLElement>('[data-scroll-root]');
    const vorigeBody = document.body.style.overflow;
    const vorigeRoot = scrollRoot?.style.overflow ?? '';
    document.body.style.overflow = 'hidden';
    if (scrollRoot) scrollRoot.style.overflow = 'hidden';
    const eerder = document.activeElement as HTMLElement | null;
    paneel.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = vorigeBody;
      if (scrollRoot) scrollRoot.style.overflow = vorigeRoot;
      eerder?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <React.Fragment key="sheet">
          <motion.div
            key="scrim"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : DUR.fast }}
            onClick={onClose}
            className="fixed inset-0 z-modal bg-ink/40"
          />
          <motion.div
            key="paneel"
            ref={paneel}
            role="dialog"
            aria-modal="true"
            aria-label={title ?? ariaLabel}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE_SPRING } }}
            exit={{ y: '100%', transition: reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE } }}
            drag={reduced ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 80 || info.velocity.y > 600) onClose(); }}
            className={cn(
              'fixed inset-x-0 bottom-0 z-modal flex max-h-overlay flex-col rounded-t-2xl border-t border-hairline bg-paper/95 elev-3 focus-stil',
              'sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2',
              className,
            )}
          >
            {/* Handvat: zegt "dit kan je omlaag vegen". */}
            <div className="flex shrink-0 justify-center pt-2" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-slate-300" />
            </div>
            {(title || subtitle) && (
              <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-2">
                <div className="min-w-0 flex-1">
                  {title && <h2 className="text-card-title truncate">{title}</h2>}
                  {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
                </div>
                <IconButton label="Sluiten" size="sm" className="-mr-2 -mt-1" onClick={onClose}><X size={16} /></IconButton>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
            {footer && (
              <div className="shrink-0 border-t border-hairline px-4 pt-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                {footer}
              </div>
            )}
            {!footer && <div className="shrink-0" style={{ height: 'max(0.5rem, env(safe-area-inset-bottom))' }} />}
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>,
    document.body,
  );
}
