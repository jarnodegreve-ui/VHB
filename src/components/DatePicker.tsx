import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { addDagen, maandPlus } from '../lib/datum';
import { WEEKDAY_SHORT_MON } from '../lib/format';
import {
  bereikFout, binnenBereik, dagPlusMaand, formatDatumKiezer, isIsoDag, isoNaarDmj, klemOpBereik, leesDmj, maandBuitenBereik, maandGrid, maandLabel, maandVan, vandaagIso, weekdagMa,
} from '../lib/kalender';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';
import { Button, IconButton } from './primitives';
import { inputClass, invalidClass } from './controlClass';

/**
 * Datumveld in huisstijl (datumtranche PR 1, 23-09): een typbaar tekstveld
 * dd/mm/jjjj met een kalenderknop ernaast. Vervangt de native
 * `<input type="date">` (oogde per browser anders) en de knop-trigger van
 * vroeger, waarin je niet kon typen.
 *
 * Eén eigenaar voor alles: dit component houdt de getypte tekst (concept), leest
 * ze met `leesDmj` (src/lib/kalender.ts, geen Date.parse), controleert min/max
 * en geeft pas door (`onChange(iso)`) bij een logisch moment: blur, Enter of
 * een keuze in de kalender. Tijdens het typen blijft onvolledige invoer staan
 * en verschijnt er geen fout; plakken volgt hetzelfde pad. Een ongeldige
 * invoer geeft niets door, toont de fout bij het veld en markeert het veld
 * (aria-invalid + customValidity + `data-datum-fout`), zodat `Formulier` niet
 * indient met de oude waarde.
 *
 * Waarde-API zoals het native veld: `value` = '' of 'YYYY-MM-DD',
 * `onChange(value)`, `min`/`max`/`disabled`/`required`/`id`/`name`. `name`
 * draagt de ISO-waarde mee in FormData (verborgen veld), niet de getypte tekst.
 *
 * Kalender: knop "Kalender openen" (of Alt+↓ / ↓ in het veld); popover op
 * desktop, sheet op mobiel (<640 px), zelfde inhoud en toetsen: pijlen per
 * dag/week, PageUp/PageDown per maand (Shift = jaar), Home/End, Enter/Spatie
 * kiest, Esc sluit met de focus terug in het veld.
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
  /**
   * `false` = het veld heeft altijd een datum (dagnavigatie, een periode die
   * een scherm stuurt): geen Wissen in de kalender, en bij blur of Enter
   * zonder geldige datum (leeg, onbestaand, buiten min/max) komt de laatst
   * gecommitte datum terug, nooit vandaag (datumtranche PR 3; vroeger negeerde
   * de aanroeper '' stil met `v && …` en toonde het veld iets anders dan wat
   * actief was).
   */
  wisbaar?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

const MOBIEL_BREEDTE = 640;
const RAND = 8;
const AFSTAND = 6;

type Positie = { top: number; left: number; boven: boolean };


export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker({
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
  placeholder = 'dd/mm/jjjj',
  dialogLabel,
  wisbaar = true,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}, ref) {
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState(() => isoNaarDmj(value));
  const [fout, setFout] = useState<string | null>(null);
  /** Navigatieveld (wisbaar={false}): waarom de vorige datum terugkwam. Geen fout: de getoonde datum is de actieve. */
  const [hersteld, setHersteld] = useState<string | null>(null);
  const [maand, setMaand] = useState(() => maandVan(isIsoDag(value) ? value : vandaagIso()));
  const [cursor, setCursor] = useState(() => (isIsoDag(value) ? value : vandaagIso()));
  const [mobiel, setMobiel] = useState(false);
  const [positie, setPositie] = useState<Positie>({ top: 0, left: 0, boven: false });
  const veldRef = useRef<HTMLInputElement | null>(null);
  const wortelRef = useRef<HTMLDivElement | null>(null);
  const knopRef = useRef<HTMLButtonElement | null>(null);
  const dialoogRef = useRef<HTMLDivElement | null>(null);
  const focusNaarCel = useRef(false);
  const reduceMotion = useReducedMotion();
  const dialoogId = useId();
  const foutId = useId();

  const zetVeld = (el: HTMLInputElement | null) => {
    veldRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const vandaag = vandaagIso();
  const geldig = isIsoDag(value) ? value : '';

  // Waarde van buiten (formulier gereset, ander record, kalender): het veld
  // volgt, behalve terwijl iemand erin typt.
  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === veldRef.current) return;
    setTekst(isoNaarDmj(value));
    zetFout(null);
    setHersteld(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /** Fout tonen én synchroon op het veld zetten: een submit in dezelfde tik ziet ze al. */
  const zetFout = (reden: string | null) => {
    setFout(reden);
    const el = veldRef.current;
    if (!el) return;
    el.setCustomValidity(reden ?? '');
    if (reden) el.dataset.datumFout = '1'; else delete el.dataset.datumFout;
  };

  /**
   * Navigatieveld zonder geldige invoer: de laatst gecommitte datum komt
   * terug (nooit vandaag), zodat het veld meteen weer toont wat actief is.
   * Een ongeldige invoer zegt kort waarom; leegmaken zegt niets.
   */
  const herstel = (reden: string | null) => {
    zetFout(null);
    setTekst(isoNaarDmj(value));
    setHersteld(reden ? `${reden} De vorige datum blijft staan.` : null);
  };

  /** Concept lezen en doorgeven; false = ongeldig (niets doorgegeven). */
  const bevestig = (): boolean => {
    const r = leesDmj(tekst);
    setHersteld(null);
    if (r.staat === 'leeg') {
      zetFout(null);
      if (!wisbaar) { herstel(null); return true; }
      if (value) onChange('');
      return true;
    }
    if (r.staat === 'fout') {
      if (!wisbaar) { herstel(r.reden); return false; }
      zetFout(r.reden);
      return false;
    }
    const buiten = bereikFout(r.iso, min, max);
    if (buiten) {
      if (!wisbaar) { herstel(buiten); return false; }
      zetFout(buiten);
      return false;
    }
    zetFout(null);
    setTekst(isoNaarDmj(r.iso));
    if (r.iso !== value) onChange(r.iso);
    return true;
  };

  const sluit = useCallback((focusTerug = false) => {
    setOpen(false);
    if (focusTerug) veldRef.current?.focus();
  }, []);

  const openKiezer = () => {
    if (disabled) return;
    const concept = leesDmj(tekst);
    const start = klemOpBereik(concept.staat === 'geldig' ? concept.iso : geldig || vandaag, min, max);
    setCursor(start);
    setMaand(maandVan(start));
    setMobiel(typeof window !== 'undefined' && window.innerWidth < MOBIEL_BREEDTE);
    focusNaarCel.current = true;
    setOpen(true);
  };

  const kies = (iso: string) => {
    if (!binnenBereik(iso, min, max)) return;
    setTekst(isoNaarDmj(iso));
    zetFout(null);
    if (iso !== value) onChange(iso);
    sluit(true);
  };

  // Terugknop/swipe-back op mobiel sluit de kiezer i.p.v. het scherm.
  useHistoryDismiss(open, () => setOpen(false));

  // Klik buiten veld én dialoog sluit (de dialoog hangt in een portal,
  // dus `contains` op één wortel volstaat niet).
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

  // Positie onder (of boven) het veld, geklemd op de viewport; volgt scroll
  // en resize zolang de kiezer open is. Op mobiel is het een sheet.
  useLayoutEffect(() => {
    if (!open || mobiel) return;
    const plaats = () => {
      const t = wortelRef.current;
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
      case 'Home': e.preventDefault(); verplaats(addDagen(cursor, -weekdagMa(cursor))); return;
      case 'End': e.preventDefault(); verplaats(addDagen(cursor, 6 - weekdagMa(cursor))); return;
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

  const onVeldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sluit(true); return; }
    if (!open && e.key === 'ArrowDown') { e.preventDefault(); openKiezer(); return; }
    // Enter = bevestigen. Ongeldig: niet indienen (de fout staat bij het veld).
    if (e.key === 'Enter' && !bevestig()) e.preventDefault();
  };

  const onVeldBlur = (e: FocusEvent<HTMLInputElement>) => {
    // Naar de kalenderknop of in de dialoog: nog niet bevestigen, de keuze
    // daar is zelf een bevestiging.
    const naar = e.relatedTarget as Node | null;
    if (naar && (knopRef.current?.contains(naar) || dialoogRef.current?.contains(naar))) return;
    bevestig();
  };

  const grid = maandGrid(maand);
  const vorigeUit = maandBuitenBereik(maandPlus(maand, -1), min, max);
  const volgendeUit = maandBuitenBereik(maandPlus(maand, 1), min, max);
  const naamDialoog = dialogLabel ?? ariaLabel ?? 'Datum kiezen';
  const ongeldig = invalid || !!fout;
  const beschrijving = [ariaDescribedby, fout || hersteld ? foutId : null].filter(Boolean).join(' ') || undefined;

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
      // Binnenkomend met de veer (sheet én popover), uitgaand standaard.
      animate={{ ...(mobiel ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1 }), transition: reduceMotion ? { duration: 0 } : { duration: mobiel ? DUR.base : DUR.fast, ease: EASE_SPRING } }}
      exit={{ ...(reduceMotion ? { opacity: 0 } : mobiel ? { opacity: 0, y: 24 } : { opacity: 0, scale: 0.96 }), transition: reduceMotion ? { duration: 0 } : { duration: DUR.fast, ease: EASE } }}
      style={stijlDialoog}
      className={cn(
        'fixed z-kiezer bg-paper ring-1 ring-hairline elev-2 outline-none',
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
                    inMaand ? 'text-slate-800' : 'text-slate-400',
                    uit ? 'cursor-not-allowed opacity-40' : 'hover:bg-surface-soft-hover',
                    isVandaag && !gekozen && 'ring-1 ring-inset ring-hairline-strong font-semibold',
                    gekozen && 'bg-oker-500 text-slate-950 font-semibold elev-accent hover:bg-oker-400',
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
        {wisbaar && (
          <Button variant="ghost" size="sm" disabled={!value && !tekst} onClick={() => { setTekst(''); zetFout(null); if (value) onChange(''); sluit(true); }}>Wissen</Button>
        )}
      </div>
    </motion.div>
  );

  return (
    <div className={cn(size === 'sm' ? 'inline-block' : 'block w-full', className)}>
      <div ref={wortelRef} className="relative">
        <input
          ref={zetVeld}
          type="text"
          id={id}
          value={tekst}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          // Cijferklavier op de telefoon; acht cijfers zonder "/" worden ook gelezen.
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          spellCheck={false}
          aria-invalid={ongeldig || undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          aria-describedby={beschrijving}
          data-datum={geldig || undefined}
          onChange={(e) => {
            setTekst(e.target.value);
            // Tijdens het typen geen fout; bij de volgende bevestiging opnieuw.
            if (fout) zetFout(null);
            if (hersteld) setHersteld(null);
          }}
          onBlur={onVeldBlur}
          onKeyDown={onVeldKey}
          className={cn(
            inputClass,
            'pr-12 sm:pointer-fine:pr-10',
            size === 'sm' && 'w-[9.5rem] rounded-lg px-3 py-2 text-xs sm:text-xs',
            ongeldig && invalidClass,
          )}
        />
        <IconButton
          ref={knopRef}
          label="Kalender openen"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialoogId : undefined}
          onClick={() => (open ? sluit(true) : openKiezer())}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
        >
          <CalendarDays size={16} aria-hidden="true" />
        </IconButton>
      </div>
      {/* De ISO-waarde in FormData, niet de getypte tekst. */}
      {name && <input type="hidden" name={name} value={geldig} />}
      {fout && (
        <p id={foutId} role="alert" className="mt-1.5 text-xs font-medium text-red-700">{fout}</p>
      )}
      {hersteld && !fout && (
        <p id={foutId} role="status" className="mt-1.5 text-xs font-medium text-slate-600">{hersteld}</p>
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
});
