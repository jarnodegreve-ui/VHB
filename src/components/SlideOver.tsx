import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/ui';

/**
 * Premium slide-over side panel (rechts) — het standaard detailvenster van
 * het portaal. Denk: omleiding-details bekijken zonder paginawissel.
 *
 * - Portal naar document.body (ontsnapt aan transform/filter-ancestors).
 * - Backdrop fade (200ms) + paneel dat van rechts inschuift (300ms).
 * - Escape sluit, backdrop-klik sluit, body-scroll-lock terwijl open.
 * - Focus verhuist bij openen naar het paneel zelf (tabIndex={-1}).
 * - Mobiel: volle breedte zonder rounding; sm+: max-w + rounded-l-2xl.
 */
export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  icon,
  width = 'md',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  width?: 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Escape sluit — listener alleen actief terwijl het paneel open is.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body-scroll-lock: bewaar en herstel de bestaande overflow-waarde.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Focus naar het paneel zodra het mount + minimale focus-trap (Tab blijft
  // binnen de dialog, conform aria-modal) + focus-herstel bij sluiten.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
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

  if (typeof document === 'undefined') return null;

  const widthClass = width === 'lg' ? 'sm:max-w-[36rem]' : 'sm:max-w-[28rem]';

  return createPortal(
    <AnimatePresence>
      {open && (
        <React.Fragment key="slide-over">
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
            }
            className={cn(
              // Bewust géén backdrop-filter op het geanimeerde paneel zelf
              // (blur + transform op één element geeft compositing-glitches);
              // near-opaque oppervlak heeft het ook niet nodig.
              'fixed inset-y-0 right-0 z-[101] flex h-full w-full flex-col outline-none sm:rounded-l-2xl',
              'bg-white/95 border-l border-slate-200/80 shadow-[0_0_80px_rgba(13,13,15,0.25)]',
              widthClass,
            )}
          >
            <div className="flex items-start gap-3 border-b border-slate-200/70 p-5">
              {icon}
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold tracking-tight text-slate-900 truncate">
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-slate-500 truncate">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Sluiten"
                className="-m-1 shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">{children}</div>

            {footer && (
              <div
                className="border-t border-slate-200/70 p-4"
                style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>,
    document.body,
  );
}
