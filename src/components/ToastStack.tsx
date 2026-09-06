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
   *  pauzeert zolang de muis erop staat of de knop focus heeft; de stack
   *  telt af (ToastStack, ook buiten beeld), niet de showToast-timer in App. */
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

type KlokStaat = {
  resterend: number;
  /** performance.now() bij de laatste start; null zolang de klok stilstaat. */
  start: number | null;
  timer: number | null;
  raf: number | null;
};

/** Wat de zichtbare toast nodig heeft om de hairline te tekenen: loopt de
 *  klok (lijn glijdt in `resterend` ms naar nul) of staat hij stil (lijn
 *  bevriest op de huidige fractie). */
type KlokWeergave = { loopt: boolean; resterend: number };

/**
 * Eén klok per ongedaan-toast, beheerd door de stack en niet door de
 * zichtbare toast-component. Zo loopt de aftelling gewoon door als een toast
 * uit beeld valt (verdrongen door nieuwere, MAX_VISIBLE) en komt hij niet
 * later met een verse 6 s terug (controle 05-09, nr. 12). De klok start
 * zodra de toast in de lijst staat en stopt zodra hij eruit is.
 *
 * `pauzeer`/`hervat` zijn voor de zichtbare toast (muis erop, focus op de
 * knop); `hervat` is idempotent — een lopende klok start niet opnieuw.
 */
function useOngedaanKlokken(toasts: Toast[], onDismiss: (id: number) => void) {
  const staten = useRef(new Map<number, KlokStaat>()).current;
  const [weergave, setWeergave] = useState<Record<number, KlokWeergave>>({});
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const toon = useCallback((id: number, stand: KlokWeergave) => {
    setWeergave((cur) => ({ ...cur, [id]: stand }));
  }, []);

  const hervat = useCallback((id: number) => {
    const s = staten.get(id);
    if (!s || s.timer !== null) return;
    s.start = performance.now();
    s.timer = window.setTimeout(() => {
      s.timer = null;
      onDismissRef.current(id);
    }, s.resterend);
    toon(id, { loopt: true, resterend: s.resterend });
  }, [staten, toon]);

  const pauzeer = useCallback((id: number) => {
    const s = staten.get(id);
    if (!s || s.timer === null) return;
    window.clearTimeout(s.timer);
    s.timer = null;
    const verstreken = performance.now() - (s.start ?? performance.now());
    s.resterend = Math.max(0, s.resterend - verstreken);
    s.start = null;
    toon(id, { loopt: false, resterend: s.resterend });
  }, [staten, toon]);

  const stop = useCallback((id: number) => {
    const s = staten.get(id);
    if (!s) return;
    if (s.timer !== null) window.clearTimeout(s.timer);
    if (s.raf !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(s.raf);
      window.clearTimeout(s.raf);
    }
    staten.delete(id);
  }, [staten]);

  useEffect(() => {
    const ids = new Set<number>();
    for (const t of toasts) {
      if (!t.ongedaan) continue;
      ids.add(t.id);
      if (staten.has(t.id)) continue;
      const s: KlokStaat = { resterend: t.duurMs ?? ONGEDAAN_DUUR_MS, start: null, timer: null, raf: null };
      staten.set(t.id, s);
      // Eerst één frame op de volle lijn schilderen, dan pas de transitie
      // starten — anders is er niets om vanaf te glijden.
      const begin = () => { s.raf = null; hervat(t.id); };
      s.raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(begin) : window.setTimeout(begin, 0);
    }
    let opgeruimd = false;
    for (const id of [...staten.keys()]) {
      if (ids.has(id)) continue;
      stop(id);
      opgeruimd = true;
    }
    if (opgeruimd) {
      setWeergave((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => ids.has(Number(id)))));
    }
  }, [toasts, staten, hervat, stop]);

  // Stack weg: alle klokken stoppen.
  useEffect(() => () => { for (const id of [...staten.keys()]) stop(id); }, [staten, stop]);

  return { weergave, pauzeer, hervat };
}

/** Ongedaan-variant: klok uit de stack (pauze bij hover/focus) + hairline die afloopt. */
function OngedaanToast({ toast, reduced, klok, pauzeer, hervat, onDismiss }: {
  toast: Toast;
  reduced: boolean;
  klok: KlokWeergave;
  pauzeer: () => void;
  hervat: () => void;
  onDismiss: (id: number) => void;
}) {
  const duur = toast.duurMs ?? ONGEDAAN_DUUR_MS;
  // Muis én focus kunnen los van elkaar pauzeren; de klok loopt pas weer
  // als allebei weg zijn.
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const bijwerken = () => {
    if (hoverRef.current || focusRef.current) pauzeer();
    else hervat();
  };

  // Bij (her)verschijnen de hairline eerst op de huidige stand schilderen en
  // dan pas laten glijden; verdwijnt de toast terwijl de muis erop staat
  // (verdrongen), dan komt er geen mouseleave meer — dus dan zelf hervatten.
  const pauzeerRef = useRef(pauzeer);
  const hervatRef = useRef(hervat);
  pauzeerRef.current = pauzeer;
  hervatRef.current = hervat;
  useEffect(() => {
    pauzeerRef.current();
    const begin = () => { if (!hoverRef.current && !focusRef.current) hervatRef.current(); };
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(begin) : window.setTimeout(begin, 0);
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      window.clearTimeout(raf);
      hervatRef.current();
    };
  }, []);

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
  const { weergave, pauzeer, hervat } = useOngedaanKlokken(toasts, onDismiss);

  return (
    <div
      aria-live="polite"
      // iPhone: onderaan, ruim boven de tab-bar (bottom-3 + ~64px hoogte) —
      // rechtsboven overlapte de toast de topbar-acties. Desktop (md+):
      // rechtsboven zoals voorheen.
      className="fixed inset-x-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-[120] mx-auto max-w-sm space-y-2.5 md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:mx-0 md:w-[calc(100vw-2rem)]"
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
                <OngedaanToast
                  toast={toast}
                  reduced={reduced}
                  klok={weergave[toast.id] ?? { loopt: false, resterend: toast.duurMs ?? ONGEDAAN_DUUR_MS }}
                  pauzeer={() => pauzeer(toast.id)}
                  hervat={() => hervat(toast.id)}
                  onDismiss={onDismiss}
                />
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
