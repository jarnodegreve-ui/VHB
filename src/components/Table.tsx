import { ArrowDown, ArrowUp, ArrowUpDown, Check, Columns3, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useId, useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/ui';
import { DUR, EASE } from '../lib/motion';
import { Button, IconButton, MicroLabel, segItemClass, Td, Th } from './primitives';
import { useDropdown } from './useDropdown';

/**
 * Tabel-bouwstenen voor de beheerkant (fase C11):
 * - `TableToolbar`: zoekveld + filters + resultaattelling + acties, één rij.
 * - `useSort` + `SortTh`: sorteerbare kolomkop met aria-sort en pijl.
 * - `Checkbox`: selectievakje in huisstijl (rij- en alles-selectie).
 * - `BulkBar`: balk die verschijnt zodra er rijen geselecteerd zijn.
 * - `StickyThead`: kolomkop die onder de topbar blijft plakken bij scrollen.
 * - `Paginering`: eenvoudige "vorige/volgende + N per pagina".
 * - `useTabelVoorkeur`: rijdichtheid + kolomkeuze, per tabel onthouden in
 *   localStorage; de toolbar toont er de schakelaar en het kolommenmenu voor.
 */

// === Tabelvoorkeur: dichtheid + kolomkeuze ===

export type Dichtheid = 'compact' | 'comfortabel';

/**
 * Klassen op de <table> per dichtheid. Compact knijpt de rijen alleen met een
 * muis (op touch blijft het raakvlak) en zet de celtekst op text-xs; de
 * selectors `[&_td]`/`[&_th]` winnen op specificiteit van de basismaten in
 * Td/Th, zodat de primitieven zelf ongemoeid blijven.
 */
export const DICHTHEID_TABEL: Record<Dichtheid, string> = {
  comfortabel: '',
  compact: 'sm:pointer-fine:[&_td]:py-1.5 sm:pointer-fine:[&_th]:py-1.5 sm:pointer-fine:[&_th_button]:min-h-8 [&_td]:text-xs',
};

export type KolomKeuze<K extends string = string> = { key: K; label: string };

type VoorkeurOpslag = { dichtheid: Dichtheid; verborgen: string[] };

const VOORKEUR_PREFIX = 'vhb-tabel:';

const leesVoorkeur = (sleutel: string): VoorkeurOpslag => {
  const standaard: VoorkeurOpslag = { dichtheid: 'comfortabel', verborgen: [] };
  try {
    const raw = window.localStorage.getItem(VOORKEUR_PREFIX + sleutel);
    if (!raw) return standaard;
    const p = JSON.parse(raw) as Partial<VoorkeurOpslag>;
    return {
      dichtheid: p.dichtheid === 'compact' ? 'compact' : 'comfortabel',
      verborgen: Array.isArray(p.verborgen) ? p.verborgen.filter((k): k is string => typeof k === 'string') : [],
    };
  } catch {
    // privémodus / kapotte JSON: gewoon de standaard
    return standaard;
  }
};

/**
 * Dichtheid ('compact' | 'comfortabel') en verborgen kolommen van één tabel,
 * onthouden per `sleutel` in localStorage. We bewaren de vérborgen kolommen
 * (niet de zichtbare): een kolom die er later bijkomt staat dan standaard
 * aan. `keuzes` zijn de uitschakelbare kolommen — verplichte kolommen (naam,
 * acties) geef je niet mee en blijven dus altijd staan.
 */
export function useTabelVoorkeur<K extends string = never>(sleutel: string, keuzes?: ReadonlyArray<KolomKeuze<K>>) {
  const [voorkeur, setVoorkeur] = useState<VoorkeurOpslag>(() => leesVoorkeur(sleutel));
  useEffect(() => {
    try { window.localStorage.setItem(VOORKEUR_PREFIX + sleutel, JSON.stringify(voorkeur)); } catch { /* privémodus */ }
  }, [sleutel, voorkeur]);

  const setDichtheid = useCallback((dichtheid: Dichtheid) => setVoorkeur((v) => ({ ...v, dichtheid })), []);
  const toggleKolom = useCallback((key: string) => setVoorkeur((v) => ({
    ...v,
    verborgen: v.verborgen.includes(key) ? v.verborgen.filter((k) => k !== key) : [...v.verborgen, key],
  })), []);
  const toonAlles = useCallback(() => setVoorkeur((v) => ({ ...v, verborgen: [] })), []);

  const verborgen = useMemo(() => new Set(voorkeur.verborgen), [voorkeur.verborgen]);
  const zichtbaar = useCallback((key: K) => !verborgen.has(key), [verborgen]);

  return {
    /** Voor `TableToolbar dichtheid`. */
    dichtheid: { waarde: voorkeur.dichtheid, onChange: setDichtheid },
    /** Voor `TableToolbar kolommen` — undefined als er geen keuzes zijn. */
    kolommen: keuzes && keuzes.length > 0 ? { keuzes, verborgen, onToggle: toggleKolom, onAlles: toonAlles } : undefined,
    /** Op de <table> zetten. */
    tabelClass: DICHTHEID_TABEL[voorkeur.dichtheid],
    zichtbaar,
  };
}

export type DichtheidProps = { waarde: Dichtheid; onChange: (d: Dichtheid) => void };
export type KolommenProps = {
  keuzes: ReadonlyArray<KolomKeuze<string>>;
  verborgen: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onAlles?: () => void;
};

const DICHTHEID_LABELS: Record<Dichtheid, string> = { comfortabel: 'Comfortabel', compact: 'Compact' };

/** Segmented "Comfortabel | Compact". Alleen op md+: mobiel toont kaartlijsten, geen tabel. */
function DichtheidSchakelaar({ waarde, onChange }: DichtheidProps) {
  return (
    <div className="glass-segmented hidden md:inline-flex rounded-xl p-1" role="group" aria-label="Rijdichtheid">
      {(['comfortabel', 'compact'] as const).map((d) => (
        // rauw: segmented control op de glass-rail, klassen via segItemClass
        <button key={d} type="button" aria-pressed={waarde === d} onClick={() => onChange(d)} className={segItemClass(waarde === d, 'px-3 py-1.5')}>
          {DICHTHEID_LABELS[d]}
        </button>
      ))}
    </div>
  );
}

/** Kolommenmenu: één Checkbox per uitschakelbare kolom, in een opaak vlak. */
function KolommenMenu({ keuzes, verborgen, onToggle, onAlles }: KolommenProps) {
  const { open, setOpen, wortel } = useDropdown();
  const id = useId();
  const aantalVerborgen = keuzes.filter((k) => verborgen.has(k.key)).length;
  return (
    <div ref={wortel} className="relative hidden md:block">
      <IconButton
        label={aantalVerborgen > 0 ? `Kolommen kiezen (${aantalVerborgen} verborgen)` : 'Kolommen kiezen'}
        size="sm"
        variant={aantalVerborgen > 0 ? 'secondary' : 'ghost'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Columns3 size={16} />
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Kolommen"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: DUR.fast, ease: EASE }}
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl bg-paper p-1.5 ring-1 ring-hairline shadow-xl"
          >
            <MicroLabel className="px-2.5 pb-1 pt-1.5">Kolommen</MicroLabel>
            {keuzes.map((k) => {
              const inputId = `${id}-${k.key}`;
              return (
                <div key={k.key} className="flex items-center gap-1.5 rounded-lg pl-1 pr-2 transition-colors hover:bg-slate-100/70">
                  <Checkbox id={inputId} checked={!verborgen.has(k.key)} onChange={() => onToggle(k.key)} label={`Kolom ${k.label} tonen`} />
                  <label htmlFor={inputId} className="flex-1 cursor-pointer select-none py-1.5 text-sm font-medium text-slate-700">{k.label}</label>
                </div>
              );
            })}
            {onAlles && aantalVerborgen > 0 && (
              <Button variant="ghost" size="sm" full className="mt-1" onClick={onAlles}>Alle kolommen tonen</Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TableToolbar({ zoek, onZoek, placeholder = 'Zoeken…', telling, filters, acties, dichtheid, kolommen, className }: {
  zoek?: string;
  onZoek?: (v: string) => void;
  placeholder?: string;
  /** Bv. "12 van 42" — staat rechts van het zoekveld. */
  telling?: ReactNode;
  filters?: ReactNode;
  acties?: ReactNode;
  /** Rijdichtheid-schakelaar (uit `useTabelVoorkeur().dichtheid`). */
  dichtheid?: DichtheidProps;
  /** Kolommenmenu (uit `useTabelVoorkeur().kolommen`). */
  kolommen?: KolommenProps;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2.5 md:flex-row md:items-center', className)}>
      {onZoek && (
        <div className="relative w-full md:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={zoek ?? ''}
            onChange={(e) => onZoek(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="control-input w-full rounded-xl py-2 pl-9 pr-9 text-base sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none"
          />
          {zoek ? (
            <IconButton label="Zoekopdracht wissen" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => onZoek('')}>
              <X size={14} />
            </IconButton>
          ) : null}
        </div>
      )}
      {filters ? <div className="flex flex-wrap items-center gap-1.5">{filters}</div> : null}
      <div className="flex items-center gap-2.5 md:ml-auto">
        {telling ? <span className="text-xs font-medium tabular-nums text-slate-500">{telling}</span> : null}
        {dichtheid ? <DichtheidSchakelaar {...dichtheid} /> : null}
        {kolommen ? <KolommenMenu {...kolommen} /> : null}
        {acties}
      </div>
    </div>
  );
}

export type SortRichting = 'asc' | 'desc';

/** Sorteerstate + comparator voor een lijst; `key` is de kolomsleutel. */
export function useSort<K extends string>(standaard: K, richting: SortRichting = 'asc') {
  const [key, setKey] = useState<K>(standaard);
  const [dir, setDir] = useState<SortRichting>(richting);
  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setKey(k); setDir('asc'); }
  };
  const sorteer = useMemo(() => {
    return <T,>(rows: T[], waarde: (row: T, k: K) => string | number | null | undefined): T[] => {
      const f = dir === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const va = waarde(a, key); const vb = waarde(b, key);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * f;
        return String(va).localeCompare(String(vb), 'nl', { numeric: true, sensitivity: 'base' }) * f;
      });
    };
  }, [key, dir]);
  return { key, dir, toggle, sorteer };
}

/** Sorteerbare kolomkop: klik wisselt richting, aria-sort voor screenreaders. */
export function SortTh<K extends string>({ kolom, sort, children, className, title, align = 'left' }: {
  kolom: K;
  sort: { key: K; dir: SortRichting; toggle: (k: K) => void };
  children: ReactNode;
  className?: string;
  title?: string;
  align?: 'left' | 'right';
}) {
  const actief = sort.key === kolom;
  const Pijl = !actief ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Th className={cn('p-0', className)} title={title} sort={actief ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {/* rauw: kolomkop-knop (tekst + sorteerpijl) in een tabelkop. */}
      <button type="button" onClick={() => sort.toggle(kolom)} className={cn('group inline-flex min-h-11 sm:pointer-fine:min-h-9 w-full items-center gap-1 px-4 text-xs font-medium transition-colors hover:text-slate-800', align === 'right' ? 'justify-end text-right' : 'text-left', actief ? 'text-slate-800' : 'text-slate-500')}>
        <span>{children}</span>
        <Pijl size={12} className={cn('shrink-0 transition-opacity', actief ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
      </button>
    </Th>
  );
}

/** Selectievakje in huisstijl (oker vinkje op carbon), 44 px raakvlak op touch. */
export function Checkbox({ checked, onChange, label, indeterminate, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> & {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Toegankelijke naam (het zichtbare label staat meestal in de rij ernaast). */
  label: string;
  indeterminate?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('inline-flex min-h-11 min-w-11 sm:pointer-fine:min-h-6 sm:pointer-fine:min-w-6 cursor-pointer items-center justify-center', className)}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        aria-label={label}
        ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate) && !checked; }}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-[18px] w-[18px] items-center justify-center rounded-md border transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-oker-500/30',
          checked || indeterminate ? 'border-oker-500 bg-oker-500 text-slate-950' : 'border-slate-300 bg-paper text-transparent hover:border-slate-400',
        )}
      >
        {indeterminate && !checked ? <span className="h-0.5 w-2.5 rounded-full bg-slate-950" /> : <Check size={12} strokeWidth={3} />}
      </span>
    </label>
  );
}

/** Bulk-balk boven een tabel: "N geselecteerd" + acties; verschijnt alleen bij selectie. */
export function BulkBar({ aantal, onWis, children, className }: { aantal: number; onWis: () => void; children: ReactNode; className?: string }) {
  if (aantal === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2.5 rounded-xl bg-oker-50 ring-1 ring-oker-200 px-3 py-2', className)} role="region" aria-label="Bulkacties">
      <span className="text-sm font-semibold text-slate-900 tabular-nums">{aantal} geselecteerd</span>
      <IconButton label="Selectie wissen" size="sm" onClick={onWis}><X size={14} /></IconButton>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** thead die onder de sticky topbar blijft hangen tijdens het scrollen. */
export function StickyThead({ children, className }: { children: ReactNode; className?: string }) {
  // top = hoogte van de topbar (min-h-12 + py) — de scroll-root is de pagina.
  return <thead className={cn('sticky top-[3.25rem] z-10 bg-surface-white/95 backdrop-blur-[2px] [&_th]:border-b [&_th]:border-slate-200', className)}>{children}</thead>;
}

/** Simpele paginering: "1–25 van 240" met vorige/volgende. */
export function Paginering({ totaal, perPagina, pagina, onPagina, className }: { totaal: number; perPagina: number; pagina: number; onPagina: (p: number) => void; className?: string }) {
  const paginas = Math.max(1, Math.ceil(totaal / perPagina));
  const van = totaal === 0 ? 0 : (pagina - 1) * perPagina + 1;
  const tot = Math.min(totaal, pagina * perPagina);
  if (totaal <= perPagina) return null;
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-medium text-slate-500', className)}>
      <span className="tabular-nums">{van}–{tot} van {totaal}</span>
      <span className="inline-flex items-center gap-1">
        <IconButton label="Vorige pagina" size="sm" variant="secondary" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)}><ArrowUp size={14} className="-rotate-90" /></IconButton>
        <span className="px-1 tabular-nums">{pagina} / {paginas}</span>
        <IconButton label="Volgende pagina" size="sm" variant="secondary" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)}><ArrowUp size={14} className="rotate-90" /></IconButton>
      </span>
    </div>
  );
}

export { Td, Th };
