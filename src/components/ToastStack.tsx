import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, Undo2, X } from 'lucide-react';
import { cn } from '../lib/ui';
import { Button, IconButton } from './primitives';
import { DUR, EASE } from '../lib/motion';

export type ToastOpties = {
  /** Zichtbaarheid in ms. Standaard 4,2 s; fout-toasts 10 s. */
  duurMs?: number;
  /** Ongedaan-variant (Gmail/Linear-gevoel): de actie is al gebeurd, de
   *  toast is dé weg terug. 6 s zichtbaar met een aflopende hairline,
   *  pauzeert zolang de muis erop staat of de knop focus heeft; de toast
   *  telt zelf af (ToastStack), niet de showToast-timer in App. */
  ongedaan?: boolean;
};

export type Toast = ToastOpties & {
  id: number;
  message: string;
  tone?: 'success' | 'error' | 'info';
  /** Optionele actie in de melding zelf — bv. "Opnieuw proberen" bij een
   *  mislukte laadbeurt, zodat je niet de hele pagina hoeft te vernieuwen.
   *  Bij `ongedaan` is dit de "Ongedaan maken"-knop. */
  action?: { label: string; run: () => void };
};

/** Zichtbaarheid van een ongedaan-toast: lang genoeg om te lezen én te
 *  reageren, kort genoeg om niet in de weg te hangen. */
export const ONGEDAAN_DUUR_MS = 6000;

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

/**
 * Aftellen voor een ongedaan-toast, met pauze. `resterend` is de tijd die
 * nog over is; `loopt` zegt of de klok tikt. De hairline volgt dezelfde
 * klok: loopt hij, dan glijdt de lijn in `resterend` ms naar nul; staat hij
 * stil, dan bevriest de lijn op de huidige fractie.
 */
function useAftellen(duurMs: number, onKlaar: () => void) {
  const resterendRef = useRef(duurMs);
  const startRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const onKlaarRef = useRef(onKlaar);
  onKlaarRef.current = onKlaar;
  const [klok, setKlok] = useState({ loopt: false, resterend: duurMs });

  const hervat = useCallback(() => {
    if (timerRef.current !== null) return;
    startRef.current = performance.now();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onKlaarRef.current();
    }, resterendRef.current);
    setKlok({ loopt: true, resterend: resterendRef.current });
  }, []);

  const pauzeer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const verstreken = performance.now() - (startRef.current ?? performance.now());
    resterendRef.current = Math.max(0, resterendRef.current - verstreken);
    setKlok({ loopt: false, resterend: resterendRef.current });
  }, []);

  useEffect(() => {
    // Eerst één frame op de volle lijn schilderen, dan pas de transitie
    // starten — anders is er niets om vanaf te glijden.
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(hervat)
      : window.setTimeout(hervat, 0);
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      window.clearTimeout(raf);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [hervat]);

  return { klok, pauzeer, hervat };
}

/** Ongedaan-variant: eigen klok (pauze bij hover/focus) + hairline die afloopt. */
function OngedaanToast({ toast, reduced, onDismiss }: { toast: Toast; reduced: boolean; onDismiss: (id: number) => void }) {
  const duur = toast.duurMs ?? ONGEDAAN_DUUR_MS;
  const { klok, pauzeer, hervat } = useAftellen(duur, () => onDismiss(toast.id));
  // Muis én focus kunnen los van elkaar pauzeren; de klok loopt pas weer
  // als allebei weg zijn.
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const bijwerken = () => {
    if (hoverRef.current || focusRef.current) pauzeer();
    else hervat();
  };
  const fractie = klok.loopt ? 0 : klok.resterend / duur;
  const tone = TONE_STYLES[toast.tone ?? 'success'];
  const ToneIcon = tone.icon;

  return (
    <div
      className="relative"
      onMouseEnter={() => { hoverRef.current = true; bijwerken(); }}
      onMouseLeave={() => { hoverRef.current = false; bijwerken(); }}
      onFocus={() => { focusRef.current = true; bijwerken(); }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focusRef.current = false;
        bijwerken();
      }}
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', tone.chip)}>
          <ToneIcon size={16} strokeWidth={2} />
        </div>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800">{toast.message}</p>
        {toast.action && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Undo2 size={14} />}
            onClick={() => { toast.action!.run(); onDismiss(toast.id); }}
            className="shrink-0"
          >
            {toast.action.label}
          </Button>
        )}
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
      {/* Aflopende hairline in oker op de onderrand: de resterende tijd,
          zonder cijfers. Bij reduced motion geen glijdende lijn. */}
      {!reduced && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-3 h-px overflow-hidden">
          <div
            className="h-full origin-left bg-oker-500"
            style={{
              transform: `scaleX(${fractie})`,
              transition: klok.loopt ? `transform ${klok.resterend}ms linear` : 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}

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
              {toast.ongedaan ? (
                <OngedaanToast toast={toast} reduced={reduced} onDismiss={onDismiss} />
              ) : (
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
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
