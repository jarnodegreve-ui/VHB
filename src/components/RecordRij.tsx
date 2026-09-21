import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/ui';
import { Card } from './Card';
import { uitklapChevron } from './Uitklap';

/**
 * Het rijrecept voor lijsten met records (verbeterronde 4, punt 7), afgeleid
 * van de verlofrij van 21-09: één lijstkaart met hairlines in plaats van een
 * stapel losse kaarten, en per rij
 *
 *   regel 1  de titel, alleen: waaraan je het record herkent (periode, kop)
 *   regel 2  meta links (gedempt), status rechts
 *   regel 3  optioneel een voorproef van de inhoud (updates)
 *   rechts   één chevron: omlaag = klapt open, rechts = opent een detail
 *
 * Een gouden streep links = "nieuw voor jou", een rode = dringend; nooit een
 * getint vlak, dat geeft bij een lijst vol verse items één gekleurd blok.
 * Rijen met een eigen, rijkere opbouw (omleidingen met lijntegels, meldingen
 * met een kruisje ernaast) blijven eigen rijen; ze delen wel deze maten.
 */
export function LijstKaart({ children, className, ...rest }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <Card padding="none" className={cn('overflow-hidden', className)}>
      <ul className="divide-y divide-hairline-subtle" {...rest}>{children}</ul>
    </Card>
  );
}

export function RecordRij({ titel, titelAttrs, meta, status, voorproef, leading, accent, richting, open, actief, onClick, children, className }: {
  titel: ReactNode;
  /** Extra attributen op de titel, bv. `data-vt-record` voor de view transition. */
  titelAttrs?: Record<string, string>;
  meta?: ReactNode;
  /** Badges rechts op regel 2. */
  status?: ReactNode;
  /** Optionele derde regel binnen het aanraakdoel: de eerste zin van de inhoud. */
  voorproef?: ReactNode;
  /** Avatar, icoonvak of lijntegel links. */
  leading?: ReactNode;
  accent?: 'nieuw' | 'dringend';
  /** `omlaag` = de rij klapt open (geef `open` mee), `rechts` = opent een detail. */
  richting: 'omlaag' | 'rechts';
  open?: boolean;
  /** Geselecteerd in een lijst-en-detail. */
  actief?: boolean;
  onClick: () => void;
  /** Wat onder de rij hoort (een `Uitklap`, een derde regel buiten de knop). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('relative', actief && 'bg-slate-100/60', className)} aria-current={actief ? 'true' : undefined}>
      {accent && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-0.5', accent === 'dringend' ? 'bg-red-500' : 'bg-oker-500')} />}
      {/* rauw: lijstrij als één aanraakdoel (titel, meta en status, chevron);
          Button centreert en dwingt semibold/min-h af */}
      <button
        type="button"
        onClick={onClick}
        aria-expanded={richting === 'omlaag' ? !!open : undefined}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-soft-hover"
      >
        {leading && <span className="shrink-0">{leading}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-md font-semibold text-slate-900" {...titelAttrs}>{titel}</span>
          {(meta || status) && (
            <span className="mt-1 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-body-sm text-slate-500">{meta}</span>
              {status}
            </span>
          )}
          {voorproef && <span className="mt-1 block truncate text-xs font-normal text-slate-500">{voorproef}</span>}
        </span>
        {richting === 'omlaag'
          ? <ChevronDown size={16} className={uitklapChevron(!!open, 180, 'mt-0.5 shrink-0 text-slate-400')} />
          : <ChevronRight size={16} className={cn('mt-0.5 shrink-0', actief ? 'text-slate-800' : 'text-slate-400')} />}
      </button>
      {children}
    </li>
  );
}
