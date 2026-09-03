import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/ui';
import { Button, IconButton } from './primitives';
import { DUR, EASE } from '../lib/motion';

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
    chip: 'bg-emerald-500/12 text-emerald-700',
  },
  error: {
    icon: AlertTriangle,
    chip: 'bg-red-500/12 text-red-700',
  },
  info: {
    icon: Info,
    chip: 'bg-oker-500/15 text-oker-700',
  },
} as const;

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
              transition={{ duration: DUR.base, ease: EASE }}
              className="rounded-2xl border border-slate-200 bg-paper/95 px-4 py-3 shadow-lg backdrop-blur-sm touch-pan-y"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    tone.chip
                  )}
                >
                  <ToneIcon size={16} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-sm font-medium leading-snug text-slate-800">{toast.message}</p>
                  {/* Dit is dé knop van de uitrol-flow ("Vernieuw"): op een
                      telefoon, buiten, met handschoenen moet hij raakbaar zijn.
                      min-h-11 met negatieve marge zodat het raakvlak groeit
                      zonder de toast hoger te maken. */}
                  {toast.action && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { toast.action!.run(); onDismiss(toast.id); }}
                      className="-mx-2 -my-1 mt-0.5 px-2 py-1 text-sm text-oker-700 underline-offset-2 hover:text-oker-700 hover:underline sm:pointer-fine:min-h-0 sm:pointer-fine:mt-1.5"
                    >
                      {toast.action.label}
                    </Button>
                  )}
                </div>
                <IconButton
                  label="Sluit melding"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDismiss(toast.id)}
                  className="-m-1.5 text-slate-400 sm:pointer-fine:-m-0"
                >
                  <X size={16} />
                </IconButton>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
