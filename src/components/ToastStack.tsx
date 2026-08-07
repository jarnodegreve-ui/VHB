import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/ui';

export type Toast = {
  id: number;
  message: string;
  tone?: 'success' | 'error' | 'info';
  /** Optionele actie in de melding zelf — bv. "Opnieuw proberen" bij een
   *  mislukte laadbeurt, zodat je niet de hele pagina hoeft te vernieuwen. */
  action?: { label: string; run: () => void };
};

const TONE_STYLES = {
  success: {
    icon: CheckCircle2,
    chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  },
  error: {
    icon: AlertTriangle,
    chip: 'bg-red-500/12 text-red-600 dark:text-red-400',
  },
  info: {
    icon: Info,
    chip: 'bg-oker-500/15 text-oker-600 dark:text-oker-400',
  },
} as const;

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Maximaal zichtbaar tegelijk — een salvo meldingen bedekte anders het
 *  halve scherm; de oudste vallen weg, de nieuwste blijven. */
const MAX_VISIBLE = 2;

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const reduced = prefersReducedMotion();
  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <div
      aria-live="polite"
      // iPhone: onderaan, ruim boven de tab-bar (bottom-3 + ~64px hoogte) —
      // rechtsboven overlapte de toast de topbar-acties. Desktop (md+):
      // rechtsboven zoals voorheen.
      className="fixed inset-x-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-[120] mx-auto max-w-sm space-y-2.5 md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:mx-0 md:w-[calc(100vw-2rem)]"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <AnimatePresence>
        {visible.map((toast) => {
          const tone = TONE_STYLES[toast.tone ?? 'info'];
          const ToneIcon = tone.icon;

          return (
            <motion.div
              key={toast.id}
              layout={!reduced}
              role="status"
              // Wegvegen (horizontaal slepen) = sluiten — de iOS-conventie.
              drag={reduced ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragEnd={(_e, info) => {
                if (Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 600) onDismiss(toast.id);
              }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.24, ease: EASE_OUT }}
              className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm touch-pan-y"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    tone.chip
                  )}
                >
                  <ToneIcon size={15} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-[13px] font-medium leading-snug text-slate-800">{toast.message}</p>
                  {toast.action && (
                    <button
                      type="button"
                      onClick={() => { toast.action!.run(); onDismiss(toast.id); }}
                      className="ios-pressable mt-1.5 -ml-1 rounded-lg px-1 py-0.5 text-[13px] font-semibold text-oker-700 underline-offset-2 hover:underline dark:text-oker-500"
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => onDismiss(toast.id)}
                  className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Sluit melding"
                >
                  <X size={15} />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
