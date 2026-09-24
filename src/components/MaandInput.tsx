import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { maandPlus } from '../lib/datum';
import { MONTH_NAMES } from '../lib/format';
import { isMaand, leesMj, maandBereikFout, maandNaarMj } from '../lib/maand';
import { useLaag } from '../lib/lagen';
import { Button, IconButton } from './primitives';
import { inputClass, invalidClass } from './controlClass';

/**
 * Maandveld (datumtranche PR 4, 23-09): typbaar mm/jjjj met een maandknop
 * ernaast, hetzelfde recept als `DateInput` (src/components/DatePicker.tsx).
 * Vervangt de native `<input type="month">`, die in Safari desktop en Firefox
 * een vrij tekstveld zonder formaat of controle was.
 *
 * Eén eigenaar voor concept, lezen (`leesMj`, geen browserparsing),
 * validatie (min/max als 'YYYY-MM') en doorgeven: `onChange('YYYY-MM')` pas
 * bij blur, Enter of een keuze in het raster; tijdens het typen geen fout.
 * Ongeldig: niets doorgegeven, fout onder het veld, `data-datum-fout` zodat
 * `Formulier` niet indient. Raster: 12 maanden in 4 × 3, pijlen per maand
 * (↑/↓ = drie maanden), PageUp/PageDown per jaar, Enter/Spatie kiest, Esc
 * sluit met de focus terug in het veld. Popover op desktop, sheet onder
 * 640 px. Bewust een eigen module (niet in Field.tsx): Field zit in de
 * warmup, dit veld wordt op één beheerscherm gebruikt.
 */
export type MaandInputProps = {
  value: string;
  onChange: (maand: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  invalid?: boolean;
  /** `false` = altijd een maand: geen Wissen, leeg of ongeldig zet de laatst gekozen maand terug. */
  wisbaar?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

const MOBIEL_BREEDTE = 640;
const RAND = 8;
const AFSTAND = 6;
const huidigeMaand = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
/** Korte maandnamen zoals elders in het portaal (mrt, niet "maa"). */
const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const binnen = (m: string, min?: string, max?: string) => !(min && m < min) && !(max && m > max);
const klem = (m: string, min?: string, max?: string) => (min && m < min ? min : max && m > max ? max : m);

export function MaandInput({
  value, onChange, min, max, disabled, required, id, className, invalid, wisbaar = true,
  'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby, 'aria-describedby': ariaDescribedby,
}: MaandInputProps) {
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState(() => maandNaarMj(value));
  const [fout, setFout] = useState<string | null>(null);
  const [hersteld, setHersteld] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => (isMaand(value) ? value : huidigeMaand()));
  const [mobiel, setMobiel] = useState(false);
  const [positie, setPositie] = useState({ top: 0, left: 0 });
  const veldRef = useRef<HTMLInputElement | null>(null);
  const wortelRef = useRef<HTMLDivElement | null>(null);
  const knopRef = useRef<HTMLButtonElement | null>(null);
  const dialoogRef = useRef<HTMLDivElement | null>(null);
  const focusNaarCel = useRef(false);
  const reduceMotion = useReducedMotion();
  const dialoogId = useId();
  const foutId = useId();
  const geldig = isMaand(value) ? value : '';
  const jaar = cursor.slice(0, 4);

  const zetFout = (reden: string | null) => {
    setFout(reden);
    const el = veldRef.current;
    if (!el) return;
    el.setCustomValidity(reden ?? '');
    if (reden) el.dataset.datumFout = '1'; else delete el.dataset.datumFout;
  };

  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === veldRef.current) return;
    setTekst(maandNaarMj(value));
    zetFout(null);
    setHersteld(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const herstel = (reden: string | null) => {
    zetFout(null);
    setTekst(maandNaarMj(value));
    setHersteld(reden ? `${reden} De vorige maand blijft staan.` : null);
  };

  const bevestig = (): boolean => {
    const r = leesMj(tekst);
    setHersteld(null);
    if (r.staat === 'leeg') {
      zetFout(null);
      if (!wisbaar) { herstel(null); return true; }
      if (value) onChange('');
      return true;
    }
    const reden = r.staat === 'fout' ? r.reden : maandBereikFout(r.maand, min, max);
    if (reden || r.staat === 'fout') {
      if (!wisbaar) herstel(reden); else zetFout(reden);
      return false;
    }
    zetFout(null);
    setTekst(maandNaarMj(r.maand));
    if (r.maand !== value) onChange(r.maand);
    return true;
  };

  // Focus na het sluiten (a11y-rest, 24-09): een keuze of Wissen zet hem in
  // het veld (daar staat nu de waarde); Escape of de knop zelf geeft hem terug
  // aan wat de kiezer opende: de kalenderknop als die geklikt is, anders het
  // veld (ArrowDown).
  const viaKnopRef = useRef(false);
  const sluit = useCallback((focusTerug = false, naar: 'trigger' | 'veld' = 'trigger') => {
    setOpen(false);
    if (focusTerug) (naar === 'veld' || !viaKnopRef.current ? veldRef.current : knopRef.current)?.focus();
  }, []);

  const openKiezer = (viaKnop = false) => {
    if (disabled) return;
    viaKnopRef.current = viaKnop;
    const concept = leesMj(tekst);
    setCursor(klem(concept.staat === 'geldig' ? concept.maand : geldig || huidigeMaand(), min, max));
    setMobiel(typeof window !== 'undefined' && window.innerWidth < MOBIEL_BREEDTE);
    focusNaarCel.current = true;
    setOpen(true);
  };

  const kies = (maand: string) => {
    if (!binnen(maand, min, max)) return;
    setTekst(maandNaarMj(maand));
    zetFout(null);
    setHersteld(null);
    if (maand !== value) onChange(maand);
    sluit(true, 'veld');
  };

  useLaag({ open, sluit: () => setOpen(false) });

  useEffect(() => {
    if (!open) return;
    const buiten = (e: PointerEvent) => {
      const doel = e.target as Node;
      if (dialoogRef.current?.contains(doel) || wortelRef.current?.contains(doel)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', buiten);
    return () => document.removeEventListener('pointerdown', buiten);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || mobiel) return;
    const plaats = () => {
      const t = wortelRef.current;
      const d = dialoogRef.current;
      if (!t || !d) return;
      const r = t.getBoundingClientRect();
      const left = Math.max(RAND, Math.min(r.left, window.innerWidth - d.offsetWidth - RAND));
      let top = r.bottom + AFSTAND;
      if (top + d.offsetHeight > window.innerHeight - RAND && r.top - AFSTAND - d.offsetHeight >= RAND) top = r.top - AFSTAND - d.offsetHeight;
      setPositie((p) => (p.top === top && p.left === left ? p : { top, left }));
    };
    plaats();
    window.addEventListener('resize', plaats);
    window.addEventListener('scroll', plaats, true);
    return () => {
      window.removeEventListener('resize', plaats);
      window.removeEventListener('scroll', plaats, true);
    };
  }, [open, mobiel, jaar]);

  useEffect(() => {
    if (!open || !focusNaarCel.current) return;
    focusNaarCel.current = false;
    dialoogRef.current?.querySelector<HTMLButtonElement>(`[data-maand="${cursor}"]`)?.focus();
  }, [open, cursor]);

  const verplaats = (delta: number) => {
    focusNaarCel.current = true;
    setCursor((c) => klem(maandPlus(c, delta), min, max));
  };

  const onDialoogKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); sluit(true); return;
      case 'ArrowLeft': e.preventDefault(); verplaats(-1); return;
      case 'ArrowRight': e.preventDefault(); verplaats(1); return;
      case 'ArrowUp': e.preventDefault(); verplaats(-3); return;
      case 'ArrowDown': e.preventDefault(); verplaats(3); return;
      case 'PageUp': e.preventDefault(); verplaats(-12); return;
      case 'PageDown': e.preventDefault(); verplaats(12); return;
      case 'Tab': {
        e.stopPropagation();
        const knoppen = [...(dialoogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
        if (knoppen.length === 0) return;
        if (e.shiftKey && document.activeElement === knoppen[0]) { e.preventDefault(); knoppen[knoppen.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === knoppen[knoppen.length - 1]) { e.preventDefault(); knoppen[0].focus(); }
        return;
      }
      default: return;
    }
  };

  const onVeldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sluit(true); return; }
    if (!open && e.key === 'ArrowDown') { e.preventDefault(); openKiezer(); return; }
    if (e.key === 'Enter' && !bevestig()) e.preventDefault();
  };

  const onVeldBlur = (e: FocusEvent<HTMLInputElement>) => {
    const naar = e.relatedTarget as Node | null;
    if (naar && (knopRef.current?.contains(naar) || dialoogRef.current?.contains(naar))) return;
    bevestig();
  };

  const ongeldig = invalid || !!fout;
  const beschrijving = [ariaDescribedby, fout || hersteld ? foutId : null].filter(Boolean).join(' ') || undefined;
  const vorigJaarUit = !!min && `${jaar}-01` <= min;
  const volgendJaarUit = !!max && `${jaar}-12` >= max;
  const stijl: CSSProperties = mobiel
    ? { paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))' }
    : { top: positie.top, left: positie.left };

  const dialoog = (
    <motion.div
      ref={dialoogRef}
      id={dialoogId}
      role="dialog"
      aria-label={ariaLabel ?? 'Maand kiezen'}
      aria-modal={mobiel || undefined}
      tabIndex={-1}
      onKeyDown={onDialoogKey}
      initial={reduceMotion ? { opacity: 1 } : mobiel ? { opacity: 0, y: 24 } : { opacity: 0, scale: 0.96 }}
      animate={{ ...(mobiel ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1 }), transition: reduceMotion ? { duration: 0 } : { duration: mobiel ? DUR.base : DUR.fast, ease: EASE_SPRING } }}
      exit={{ ...(reduceMotion ? { opacity: 0 } : mobiel ? { opacity: 0, y: 24 } : { opacity: 0, scale: 0.96 }), transition: reduceMotion ? { duration: 0 } : { duration: DUR.fast, ease: EASE } }}
      style={stijl}
      className={cn(
        'fixed z-kiezer bg-paper ring-1 ring-hairline elev-2 outline-none',
        mobiel
          ? 'inset-x-0 bottom-0 rounded-t-2xl border-t border-rim p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
          : 'w-[17rem] rounded-2xl border border-rim p-3',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <IconButton label="Vorig jaar" variant="ghost" size="sm" disabled={vorigJaarUit} onClick={() => { setCursor((c) => klem(maandPlus(c, -12), min, max)); }}>
          <ChevronLeft size={16} />
        </IconButton>
        <span aria-live="polite" className="text-sm font-semibold text-slate-800">{jaar}</span>
        <IconButton label="Volgend jaar" variant="ghost" size="sm" disabled={volgendJaarUit} onClick={() => { setCursor((c) => klem(maandPlus(c, 12), min, max)); }}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <div role="grid" aria-label={jaar} className="mt-2 space-y-1">
        {[0, 1, 2, 3].map((rij) => (
          <div key={rij} role="row" className="grid grid-cols-3 gap-1">
            {[0, 1, 2].map((kol) => {
              const n = rij * 3 + kol;
              const maand = `${jaar}-${String(n + 1).padStart(2, '0')}`;
              const uit = !binnen(maand, min, max);
              const gekozen = maand === geldig;
              const nu = maand === huidigeMaand();
              return (
                // rauw: rastercel (role=gridcell, roving tabindex), zelfde recept als de dagcel van DatePicker.
                <button
                  key={maand}
                  type="button"
                  role="gridcell"
                  data-maand={maand}
                  aria-selected={gekozen || undefined}
                  aria-current={nu ? 'date' : undefined}
                  aria-label={`${MONTH_NAMES[n]} ${jaar}`}
                  tabIndex={maand === cursor ? 0 : -1}
                  disabled={uit}
                  onClick={() => kies(maand)}
                  onFocus={() => setCursor(maand)}
                  className={cn(
                    'ios-pressable flex h-11 items-center justify-center rounded-lg text-sm transition-colors sm:pointer-fine:h-9',
                    'text-slate-800',
                    // Zelfde recept als de dagcel van DatePicker: neutraal gekozen, gouden ring voor deze maand.
                    uit ? 'cursor-not-allowed opacity-40' : !gekozen && 'hover:bg-surface-soft-hover',
                    nu && !gekozen && 'ring-1 ring-inset ring-oker-500/35 font-semibold',
                    gekozen && 'bg-keuze text-keuze-tekst font-semibold',
                  )}
                >
                  {MAAND_KORT[n]}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t fine-divider pt-2">
        <Button variant="ghost" size="sm" disabled={!binnen(huidigeMaand(), min, max)} onClick={() => kies(huidigeMaand())}>Deze maand</Button>
        {wisbaar && (
          <Button variant="ghost" size="sm" disabled={!value && !tekst} onClick={() => { setTekst(''); zetFout(null); if (value) onChange(''); sluit(true, 'veld'); }}>Wissen</Button>
        )}
      </div>
    </motion.div>
  );

  return (
    <div className={cn('block w-full', className)}>
      <div ref={wortelRef} className="relative">
        <input
          ref={veldRef}
          type="text"
          id={id}
          value={tekst}
          disabled={disabled}
          required={required}
          placeholder="mm/jjjj"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          spellCheck={false}
          aria-invalid={ongeldig || undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          aria-describedby={beschrijving}
          data-maand={geldig || undefined}
          onChange={(e) => {
            setTekst(e.target.value);
            if (fout) zetFout(null);
            if (hersteld) setHersteld(null);
          }}
          onBlur={onVeldBlur}
          onKeyDown={onVeldKey}
          className={cn(inputClass, 'pr-12 sm:pointer-fine:pr-10', ongeldig && invalidClass)}
        />
        <IconButton
          ref={knopRef}
          label="Maand kiezen"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialoogId : undefined}
          onClick={() => (open ? sluit(true) : openKiezer(true))}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
        >
          <CalendarRange size={16} aria-hidden="true" />
        </IconButton>
      </div>
      {fout && <p id={foutId} role="alert" className="mt-1.5 text-xs font-medium text-red-700">{fout}</p>}
      {hersteld && !fout && <p id={foutId} role="status" className="mt-1.5 text-xs font-medium text-slate-600">{hersteld}</p>}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && (
            <>
              {mobiel && (
                <motion.div
                  aria-hidden="true"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : DUR.fast }}
                  className="fixed inset-0 z-kiezer bg-ink/30"
                />
              )}
              {dialoog}
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
