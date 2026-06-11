import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/ui';

export type Toast = {
  id: number;
  message: string;
  tone?: 'success' | 'error' | 'info';
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

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const reduced = prefersReducedMotion();

  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 z-[120] w-[calc(100vw-2rem)] max-w-sm space-y-2.5"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const tone = TONE_STYLES[toast.tone ?? 'info'];
          const ToneIcon = tone.icon;

          return (
            <motion.div
              key={toast.id}
              layout={!reduced}
              role="status"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.24, ease: EASE_OUT }}
              className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm"
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
                <p className="min-w-0 flex-1 pt-1 text-[13px] font-medium leading-snug text-slate-800">
                  {toast.message}
                </p>
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
