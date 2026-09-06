import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/ui';
import { DUR, EASE } from '../lib/motion';
import { addDagen, maandPlus } from '../lib/datum';
import { WEEKDAY_SHORT_MON } from '../lib/format';
import {
  binnenBereik, dagPlusMaand, formatDatumKiezer, isIsoDag, klemOpBereik, maandBuitenBereik, maandGrid, maandLabel, maandVan, vandaagIso,
} from '../lib/kalender';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';
import { Button, IconButton } from './primitives';
import { inputClass, invalidClass } from './controlClass';

/**
 * Datumkiezer in huisstijl — vervangt de native `<input type="date">` (oogde
 * per browser anders, Safari desktop het slechtst). Trigger = knop in de
 * `Input`-look met kalender-icoon en de datum als 'di 8 sep 2026'; popover
 * onder het veld (viewport-geklemd, boven het veld als er onder geen plaats
 * is), op mobiel (<640 px) dezelfde inhoud als sheet onderaan het scherm.
 *
 * Waarde-API zoals het native veld: `value` = '' of 'YYYY-MM-DD',
 * `onChange(value)`, `min`/`max`/`disabled`/`required`/`id`/`name`.
 * Toetsenbord: pijlen per dag/week, PageUp/PageDown per maand, Home/End
 * naar begin/einde van de week, Enter/Spatie kiest, Esc sluit (focus terug
 * naar de trigger). De terugknop op mobiel sluit de kiezer (useHistoryDismiss).
 */
export type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  /** `sm` = compacte variant voor inline-navigatievelden (dekking, laadplein). */
  size?: 'md' | 'sm';
  /** Rode rand + aria-invalid (Field geeft dit door bij een fout). */
  invalid?: boolean;
  placeholder?: string;
  /** Naam van de dialoog; valt terug op aria-label of 'Datum kiezen'. */
  dialogLabel?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

const MOBIEL_BREEDTE = 640;
const RAND = 8;
const AFSTAND = 6;

type Positie = { top: number; left: number; boven: boolean };

export const DatePicker = forwardRef<HTMLButtonElement, DatePickerProps>(function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  required,
  id,
  name,
  className,
  size = 'md',
  invalid,
  placeholder = 'Kies een datum',
  dialogLabel,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}, ref) {
  const [open, setOpen] = useState(false);
  const [maand, setMaand] = useState(() => maandVan(isIsoDag(value) ? value : vandaagIso()));
  const [cursor, setCursor] = useState(() => (isIsoDag(value) ? value : vandaagIso()));
  const [mobiel, setMobiel] = useState(false);
  const [positie, setPositie] = useState<Positie>({ top: 0, left: 0, boven: false });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialoogRef = useRef<HTMLDivElement | null>(null);
  const focusNaarCel = useRef(false);
  const reduceMotion = useReducedMotion();
  const dialoogId = useId();

  const zetTrigger = (el: HTMLButtonElement | null) => {
    triggerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const vandaag = vandaagIso();
  const geldig = isIsoDag(value) ? value : '';

  const sluit = useCallback((focusTerug = false) => {
    setOpen(false);
    if (focusTerug) triggerRef.current?.focus();
  }, []);

  const openKiezer = () => {
    if (disabled) return;
    const start = klemOpBereik(geldig || vandaag, min, max);
    setCursor(start);
    setMaand(maandVan(start));
    setMobiel(typeof window !== 'undefined' && window.innerWidth < MOBIEL_BREEDTE);
    focusNaarCel.current = true;
    setOpen(true);
  };

  const kies = (iso: string) => {
    if (!binnenBereik(iso, min, max)) return;
    onChange(iso);
    sluit(true);
  };

  // Terugknop/swipe-back op mobiel sluit de kiezer i.p.v. het scherm.
  useHistoryDismiss(open, () => setOpen(false));

  // Klik buiten trigger én dialoog sluit (de dialoog hangt in een portal,
  // dus `contains` op één wortel volstaat niet).
  useEffect(() => {
    if (!open) return;
    const buiten = (e: PointerEvent) => {
      const doel = e.target as Node;
      if (dialoogRef.current?.contains(doel) || triggerRef.current?.contains(doel)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', buiten);
    return () => document.removeEventListener('pointerdown', buiten);
  }, [open]);

  // Positie onder (of boven) het veld, geklemd op de viewport; volgt scroll
  // en resize zolang de kiezer open is. Op mobiel is het een sheet.
  useLayoutEffect(() => {
    if (!open || mobiel) return;
    const plaats = () => {
      const t = triggerRef.current;
      const d = dialoogRef.current;
      if (!t || !d) return;
      const r = t.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const breedte = d.offsetWidth;
      const hoogte = d.offsetHeight;
      const left = Math.max(RAND, Math.min(r.left, vw - breedte - RAND));
      let top = r.bottom + AFSTAND;
      let boven = false;
      if (top + hoogte > vh - RAND && r.top - AFSTAND - hoogte >= RAND) {
        top = r.top - AFSTAND - hoogte;
        boven = true;
      }
      setPositie((p) => (p.top === top && p.left === left && p.boven === boven ? p : { top, left, boven }));
    };
    plaats();
    window.addEventListener('resize', plaats);
    window.addEventListener('scroll', plaats, true);
    return () => {
      window.removeEventListener('resize', plaats);
      window.removeEventListener('scroll', plaats, true);
    };
  }, [open, mobiel, maand]);

  // Focus de cursor-cel bij openen en na elke toetsenbord-verplaatsing.
  useEffect(() => {
    if (!open || !focusNaarCel.current) return;
    focusNaarCel.current = false;
    dialoogRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${cursor}"]`)?.focus();
  }, [open, cursor, maand]);

  // Maandknoppen: cursor mee naar dezelfde dag in de nieuwe maand, zodat een
  // pijltje daarna niet terugspringt naar de oude maand.
  const naarMaand = (delta: number) => {
    const doel = maandPlus(maand, delta);
    setMaand(doel);
    setCursor(klemOpBereik(dagPlusMaand(cursor, delta), min, max));
  };

  const verplaats = (naar: string) => {
    const doel = klemOpBereik(naar, min, max);
    focusNaarCel.current = true;
    setCursor(doel);
    setMaand(maandVan(doel));
  };

  const onDialoogKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Eigen toetsen afhandelen én stoppen: een omliggende Modal luistert op
    // window naar Escape/Tab en zou anders mee sluiten of de focus wegtrekken.
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); sluit(true); return;
      case 'ArrowLeft': e.preventDefault(); verplaats(addDagen(cursor, -1)); return;
      case 'ArrowRight': e.preventDefault(); verplaats(addDagen(cursor, 1)); return;
      case 'ArrowUp': e.preventDefault(); verplaats(addDagen(cursor, -7)); return;
      case 'ArrowDown': e.preventDefault(); verplaats(addDagen(cursor, 7)); return;
      case 'PageUp': e.preventDefault(); verplaats(dagPlusMaand(cursor, e.shiftKey ? -12 : -1)); return;
      case 'PageDown': e.preventDefault(); verplaats(dagPlusMaand(cursor, e.shiftKey ? 12 : 1)); return;
      case 'Home': e.preventDefault(); verplaats(addDagen(cursor, -((new Date(`${cursor}T00:00:00Z`).getUTCDay() + 6) % 7))); return;
      case 'End': e.preventDefault(); verplaats(addDagen(cursor, 6 - ((new Date(`${cursor}T00:00:00Z`).getUTCDay() + 6) % 7))); return;
      case 'Tab': {
        e.stopPropagation();
        const d = dialoogRef.current;
        if (!d) return;
        const focusbaar = [...d.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (focusbaar.length === 0) return;
        const eerste = focusbaar[0];
        const laatste = focusbaar[focusbaar.length - 1];
        if (e.shiftKey && document.activeElement === eerste) { e.preventDefault(); laatste.focus(); }
        else if (!e.shiftKey && document.activeElement === laatste) { e.preventDefault(); eerste.focus(); }
        return;
      }
      default: return;
    }
  };

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sluit(true); return; }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openKiezer(); }
  };

  const grid = maandGrid(maand);
  const vorigeUit = maandBuitenBereik(maandPlus(maand, -1), min, max);
  const volgendeUit = maandBuitenBereik(maandPlus(maand, 1), min, max);
  const naamDialoog = dialogLabel ?? ariaLabel ?? 'Datum kiezen';

  // Sheet: landscape-iOS negeert de portrait-lock, dus de zij-insets tellen
  // mee (zoals SlideOver) — anders vallen de randcellen achter de notch-hoek.
  const stijlDialoog: CSSProperties = mobiel
    ? { paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))' }
    : { top: positie.top, left: positie.left, transformOrigin: positie.boven ? 'bottom left' : 'top left' };

  const dialoog = (
    <motion.div
      ref={dialoogRef}
      id={dialoogId}
      role="dialog"
      aria-label={naamDialoog}
      aria-modal={mobiel || undefined}
      tabIndex={-1}
      onKeyDown={onDialoogKey}
      initial={reduceMotion ? { opacity: 1 } : mobiel ? { opacity: 0, y: 24 } : { opacity: 0, scale: 0.96 }}
      animate={mobiel ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : mobiel ? { opacity: 0, y: 24 } : { opacity: 0, scale: 0.96 }}
      transition={reduceMotion ? { duration: 0 } : { duration: DUR.fast, ease: EASE }}
      style={stijlDialoog}
      className={cn(
        'fixed z-[130] bg-paper ring-1 ring-hairline shadow-xl outline-none',
        mobiel
          ? 'inset-x-0 bottom-0 rounded-t-2xl border-t border-rim p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
          // Op touch (tablet/landscape ≥640) zijn de cellen 44 px: 7 × 44 + p-3 past niet in 19.5rem.
          : 'w-[19.5rem] pointer-coarse:w-[21rem] rounded-2xl border border-rim p-3',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <IconButton label="Vorige maand" variant="ghost" size="sm" disabled={vorigeUit} onClick={() => naarMaand(-1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <span aria-live="polite" className="text-sm font-semibold text-slate-800">{maandLabel(maand)}</span>
        <IconButton label="Volgende maand" variant="ghost" size="sm" disabled={volgendeUit} onClick={() => naarMaand(1)}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <div role="grid" aria-label={maandLabel(maand)} className="mt-2">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAY_SHORT_MON.map((d, i) => (
            <span key={i} role="columnheader" className="text-micro py-1 text-center">{d}</span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, rij) => (
          <div key={rij} role="row" className="grid grid-cols-7">
            {grid.slice(rij * 7, rij * 7 + 7).map((iso) => {
              const inMaand = maandVan(iso) === maand;
              const uit = !binnenBereik(iso, min, max);
              const gekozen = iso === geldig;
              const isVandaag = iso === vandaag;
              return (
                // rauw: kalendercel (role=gridcell, roving tabindex) — Button dwingt min-h-11/semibold en past niet in een 7-koloms raster.
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  data-iso={iso}
                  aria-selected={gekozen || undefined}
                  aria-current={isVandaag ? 'date' : undefined}
                  aria-label={formatDatumKiezer(iso)}
                  tabIndex={iso === cursor ? 0 : -1}
                  disabled={uit}
                  onClick={() => kies(iso)}
                  onFocus={() => setCursor(iso)}
                  className={cn(
                    // 44 px raakvlak op touch, 36 px met een muis — zelfde recept als IconButton.
                    'ios-pressable mx-auto flex h-11 w-11 items-center justify-center rounded-lg text-sm tabular-nums transition-colors sm:pointer-fine:h-9 sm:pointer-fine:w-9',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oker-400',
                    inMaand ? 'text-slate-800' : 'text-slate-400',
                    uit ? 'cursor-not-allowed opacity-40' : 'hover:bg-slate-100/70',
                    isVandaag && !gekozen && 'ring-1 ring-inset ring-hairline-strong font-semibold',
                    gekozen && 'bg-oker-500 text-slate-950 font-semibold shadow-sm shadow-oker-500/30 hover:bg-oker-400',
                  )}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t fine-divider pt-2">
        <Button variant="ghost" size="sm" disabled={!binnenBereik(vandaag, min, max)} onClick={() => kies(vandaag)}>Vandaag</Button>
        <Button variant="ghost" size="sm" disabled={!value} onClick={() => { onChange(''); sluit(true); }}>Wissen</Button>
      </div>
    </motion.div>
  );

  return (
    <>
      {/* rauw: de trigger oogt als een Input (.control-input), niet als een knop — Button heeft die vorm niet. */}
      <button
        ref={zetTrigger}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialoogId : undefined}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-required={required || undefined}
        data-datum={geldig || undefined}
        onClick={() => (open ? sluit() : openKiezer())}
        onKeyDown={onTriggerKey}
        className={cn(
          inputClass,
          'inline-flex items-center gap-2 text-left',
          size === 'sm' && 'w-auto rounded-lg px-3 py-2 text-xs sm:text-xs',
          !geldig && 'text-slate-400',
          invalid && invalidClass,
          className,
        )}
      >
        <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-slate-400" />
        <span className="truncate tabular-nums">{geldig ? formatDatumKiezer(geldig) : placeholder}</span>
      </button>
      {/* Verborgen spiegel voor formulieren: draagt `name` mee in FormData en
          laat `required` door de native validatie lopen (opent de kiezer i.p.v.
          een ballon op een onzichtbaar veld). Bewust níet `readOnly`: read-only
          velden zijn per HTML-spec uitgesloten van constraint validation, dus
          `required` deed niets en een leeg verplicht veld submitte gewoon
          (controle-ronde 05-09, nr. 10). Onbedienbaar via tabIndex/aria-hidden/
          pointer-events; de waarde komt uitsluitend via de kiezer. */}
      {(name || required) && (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          required={required}
          disabled={disabled}
          value={value}
          autoComplete="off"
          className="sr-only pointer-events-none"
          onChange={() => { /* waarde komt via de kiezer */ }}
          onKeyDown={(e) => e.preventDefault()}
          onInvalid={(e) => { e.preventDefault(); triggerRef.current?.focus(); openKiezer(); }}
          onFocus={() => triggerRef.current?.focus()}
        />
      )}
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
                  className="fixed inset-0 z-[129] bg-ink/30"
                />
              )}
              {dialoog}
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
});
