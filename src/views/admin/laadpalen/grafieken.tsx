import { useState, type ReactNode } from 'react';
import { cn } from '../../../lib/ui';
import { GridLijnen, mooiMax, useScrub } from './gedeeld';

/**
 * De twee grafiekvormen van de laadpalenpagina, in het huisdialect: hairline-
 * grid met waardelabels, slate-staven, oker voor de piek, carbon voor de
 * selectie. Eén as per grafiek (kWh óf kW, nooit allebei), geen legenda
 * (één reeks), de uitlezing staat in de samenvattingsregel eronder, en op
 * touch werkt de veeg-selectie uit `useScrub`.
 */

export type Staaf = {
  key: string;
  waarde: number;
  /** Label onder de staaf ('' = geen). */
  asLabel?: string;
  isPiek?: boolean;
  /** Geen meting (bv. dag zonder snapshot): korte gestippelde stub. */
  ontbreekt?: boolean;
  /** Zachte staaf (bv. vandaag, nog onvolledig). */
  gedempt?: boolean;
};

/** Kolomgrafiek: één staaf per item (dag, maand). */
export function Staafgrafiek({
  staven,
  eenheid,
  ariaLabel,
  gekozen,
  onKies,
  titelVan,
  samenvatting,
  referentie,
  hoogte = 'h-28',
  minTop,
}: {
  staven: Staaf[];
  eenheid: string;
  ariaLabel: string;
  gekozen: string | null;
  onKies: (key: string | null) => void;
  /** Hover-title per staaf (desktop). */
  titelVan: (s: Staaf) => string;
  /** Regel onder de as: de gekozen staaf of de samenvatting van de reeks. */
  samenvatting: (gekozen: Staaf | null) => ReactNode;
  /** Gestippelde referentielijn (bv. de vorige maandpiek). */
  referentie?: { waarde: number; label: string } | null;
  hoogte?: string;
  /** Schaal minstens tot hier (zodat een referentielijn in beeld blijft). */
  minTop?: number;
}) {
  const { scrubActief, scrubHandlers } = useScrub();
  const asTop = mooiMax(Math.max(...staven.map((s) => s.waarde), minTop ?? 0, referentie?.waarde ?? 0));
  const gekozenStaaf = staven.find((s) => s.key === gekozen) ?? null;
  return (
    <>
      <div
        role="img"
        aria-label={ariaLabel}
        className={cn('relative touch-pan-y', hoogte)}
        {...scrubHandlers(staven, gekozen, onKies)}
      >
        <GridLijnen top={asTop} eenheid={eenheid} />
        {referentie && referentie.waarde > 0 && (
          <div className="pointer-events-none absolute inset-x-0" style={{ bottom: `${Math.min(98, (referentie.waarde / asTop) * 100)}%` }} aria-hidden="true">
            <div className="border-t border-dashed border-oker-500/70" />
            <span className="absolute left-0 bottom-1 z-10 rounded px-1 py-0.5 text-2xs font-medium font-mono leading-none text-oker-700" style={{ background: 'var(--tile-bg)' }}>
              {referentie.label}
            </span>
          </div>
        )}
        <div className="flex h-full items-end gap-[3px]">
          {staven.map((s) => {
            const isGekozen = gekozen === s.key;
            return (
              // rauw: grafiekstaaf (tik-vlak, aria-hidden), geen knop-uiterlijk
              <button
                key={s.key}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => { if (scrubActief.current) return; onKies(isGekozen ? null : s.key); }}
                title={titelVan(s)}
                className="flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
              >
                {s.ontbreekt ? (
                  <div className="w-full border-t border-dashed border-hairline-strong" />
                ) : (
                  <div
                    className={cn(
                      'w-full rounded-t-md',
                      isGekozen ? 'bg-slate-900' : s.isPiek ? 'bg-oker-500' : s.gedempt ? 'bg-slate-400' : 'bg-slate-500',
                    )}
                    style={{ height: s.waarde > 0 ? `${Math.max(3, Math.round((s.waarde / asTop) * 100))}%` : '2px' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex min-h-4 gap-[3px]" aria-hidden="true">
        {staven.map((s) => (
          <span key={s.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-2xs font-medium font-mono text-slate-500">{s.asLabel ?? ''}</span>
        ))}
      </div>
      <p className={cn('mt-2 min-h-4 truncate text-2xs font-mono', gekozenStaaf ? 'font-semibold text-slate-700' : 'font-medium text-slate-500')}>
        {samenvatting(gekozenStaaf)}
      </p>
    </>
  );
}

export type Slot = { key: string; ts: string; kw: number; charging: number };

/** Kwartiercurve (24 u of één dag): step-lijn met vlak, piekstip, veeg-selectie. */
export function StapCurve({
  slots,
  ariaLabel,
  gekozen,
  onKies,
  titelVan,
  samenvatting,
  referentie,
  asLinks,
  asRechts,
  hoogte = 'h-28',
}: {
  slots: Slot[];
  ariaLabel: string;
  gekozen: string | null;
  onKies: (key: string | null) => void;
  titelVan: (s: Slot) => string;
  samenvatting: (gekozen: Slot | null) => ReactNode;
  referentie?: { waarde: number; label: string } | null;
  asLinks: string;
  asRechts: string;
  hoogte?: string;
}) {
  const { scrubActief, scrubHandlers } = useScrub();
  const maxKw = Math.max(1, ...slots.map((s) => s.kw));
  const asTop = mooiMax(Math.max(maxKw, referentie?.waarde ?? 0));
  const piekIndex = slots.reduce((best, s, i) => (s.kw > (slots[best]?.kw ?? -1) ? i : best), -1);
  const n = slots.length;
  const w = n > 0 ? 100 / n : 100;
  const y = (kw: number) => 100 - Math.min(98, Math.max(kw > 0 ? 2 : 0.5, (kw / asTop) * 100));
  let lijn = n > 0 ? `M 0 ${y(slots[0].kw).toFixed(2)}` : '';
  slots.forEach((s, i) => {
    lijn += ` H ${((i + 1) * w).toFixed(2)}`;
    const volgende = slots[i + 1];
    if (volgende) lijn += ` V ${y(volgende.kw).toFixed(2)}`;
  });
  const vlak = n > 0 ? `${lijn} V 100 H 0 Z` : '';
  const gekozenIndex = slots.findIndex((s) => s.key === gekozen);
  const gekozenSlot = gekozenIndex >= 0 ? slots[gekozenIndex] : null;
  return (
    <>
      <div
        role="img"
        aria-label={ariaLabel}
        className={cn('relative touch-pan-y', hoogte)}
        {...scrubHandlers(slots, gekozen, onKies)}
      >
        <GridLijnen top={asTop} eenheid="kW" />
        {referentie && referentie.waarde > 0 && (
          <div className="absolute inset-x-0" style={{ bottom: `${Math.min(98, (referentie.waarde / asTop) * 100)}%` }} aria-hidden="true">
            <div className="border-t border-dashed border-oker-500/70" />
            <span className="absolute left-0 bottom-1 z-10 rounded px-1 py-0.5 text-2xs font-medium font-mono leading-none text-oker-700" style={{ background: 'var(--tile-bg)' }}>
              {referentie.label}
            </span>
          </div>
        )}
        {n > 1 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <path d={vlak} className="fill-slate-500/12" />
            <path d={lijn} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1.5} className="stroke-slate-600" />
            {piekIndex >= 0 && slots[piekIndex].kw > 0 && (
              <circle cx={(piekIndex + 0.5) * w} cy={y(slots[piekIndex].kw)} r={2.2} vectorEffect="non-scaling-stroke" className="fill-oker-500 stroke-white" strokeWidth={1} />
            )}
            {gekozenIndex >= 0 && <rect x={gekozenIndex * w} y={0} width={w} height={100} className="fill-slate-900/10" />}
          </svg>
        )}
        <div className="absolute inset-0 flex">
          {slots.map((s) => (
            // rauw: onzichtbaar tik-vlak op de curve (aria-hidden)
            <button
              key={s.key}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => { if (scrubActief.current) return; onKies(gekozen === s.key ? null : s.key); }}
              title={titelVan(s)}
              className="h-full min-w-0 flex-1 cursor-pointer"
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex min-h-4 justify-between text-2xs font-medium font-mono text-slate-500" aria-hidden="true">
        <span>{asLinks}</span>
        <span>{asRechts}</span>
      </div>
      <p className={cn('mt-2 min-h-4 truncate text-2xs font-mono', gekozenSlot ? 'font-semibold text-slate-700' : 'font-medium text-slate-500')}>
        {samenvatting(gekozenSlot)}
      </p>
    </>
  );
}

/** Kleine hook: gekozen-staaf-state die reset bij een reekswissel. */
export function useKeuze(reset: unknown): [string | null, (k: string | null) => void] {
  const [staat, setStaat] = useState<{ sleutel: unknown; keuze: string | null }>({ sleutel: reset, keuze: null });
  const keuze = staat.sleutel === reset ? staat.keuze : null;
  return [keuze, (k) => setStaat({ sleutel: reset, keuze: k })];
}
