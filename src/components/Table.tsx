import { ArrowDown, ArrowUp, ArrowUpDown, Check, Search, X } from 'lucide-react';
import { useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/ui';
import { IconButton, Td, Th } from './primitives';

/**
 * Tabel-bouwstenen voor de beheerkant (fase C11):
 * - `TableToolbar`: zoekveld + filters + resultaattelling + acties, één rij.
 * - `useSort` + `SortTh`: sorteerbare kolomkop met aria-sort en pijl.
 * - `Checkbox`: selectievakje in huisstijl (rij- en alles-selectie).
 * - `BulkBar`: balk die verschijnt zodra er rijen geselecteerd zijn.
 * - `StickyThead`: kolomkop die onder de topbar blijft plakken bij scrollen.
 * - `Paginering`: eenvoudige "vorige/volgende + N per pagina".
 */

export function TableToolbar({ zoek, onZoek, placeholder = 'Zoeken…', telling, filters, acties, className }: {
  zoek?: string;
  onZoek?: (v: string) => void;
  placeholder?: string;
  /** Bv. "12 van 42" — staat rechts van het zoekveld. */
  telling?: ReactNode;
  filters?: ReactNode;
  acties?: ReactNode;
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
