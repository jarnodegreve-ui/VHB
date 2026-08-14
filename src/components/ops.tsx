import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { CountUp } from './CountUp';
import { cn } from '../lib/ui';

/**
 * Gedeelde bouwstenen van het Operations Center-dashboard.
 *
 * Stonden eerst alleen in PlannerDashboardWidgets; het chauffeursdashboard
 * gebruikt dezelfde look (tegels, panelen) met eigen data; snelacties
 * bestaan alleen nog op het chauffeursdashboard (planner-kant weg, 03-08),
 * zodat beide schermen niet uit elkaar groeien.
 */
const STAT_TONES = {
  // In donker een tikje meer vulling (…/18 i.p.v. /12): 12%-alpha op
  // near-black werd modderig — een signaal hoort daar juist te dragen.
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:bg-emerald-500/18 dark:text-emerald-400',
  red: 'bg-red-500/12 text-red-600 dark:bg-red-500/18 dark:text-red-400',
  amber: 'bg-amber-500/12 text-amber-600 dark:bg-amber-500/18 dark:text-amber-400',
  // Ziekte volgt de statuskleurtaal (lib/statusColors): rose, niet amber —
  // anders betekende ziek op de tegel iets anders dan in de rijen eronder.
  rose: 'bg-rose-500/12 text-rose-600 dark:bg-rose-500/18 dark:text-rose-400',
  oker: 'bg-oker-500/15 text-oker-600 dark:bg-oker-500/20 dark:text-oker-400',
  blue: 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/18 dark:text-blue-400',
  slate: 'bg-slate-500/12 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
} as const;

type StatTone = keyof typeof STAT_TONES;

/** Compacte KPI voor de status-strip. `value` (getal) animeert via CountUp. */
export function OpsStat({
  icon,
  tone,
  label,
  value,
  text,
  suffix,
  sub,
  subClassName,
  lines,
  meter,
  note,
  onClick,
  className,
}: {
  icon: ReactNode;
  tone: StatTone;
  label: string;
  value?: number;
  text?: string;
  suffix?: string;
  sub: string;
  /** Optionele extra klassen voor de subtekst — bv. iets groter wanneer de
   *  subregel de eigenlijke boodschap draagt ("morgen · di 28 jul"). */
  subClassName?: string;
  /** Optionele detailregels onder de subtekst (bv. de blokken van een
   *  dienst): `left` (tijden) en `right` (loopnummer) staan in twee nette
   *  kolommen onder elkaar. `done` toont een al gereden blok gedempt. */
  lines?: Array<{ left: string; right?: string; done?: boolean; active?: boolean; progress?: number }>;
  /** Optionele voortgangsbalk (0–100) onder de subtekst — bv. verlofsaldo.
   *  Kleurt emerald → amber (>80%) → red (>100 gebruikt). */
  meter?: number;
  /** Notitie van de planner bij deze dag — opvallend maar gedempt (oker). */
  note?: string;
  onClick?: () => void;
  className?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg', STAT_TONES[tone])}>
          {icon}
        </span>
        {onClick && <ArrowUpRight size={13} className="text-slate-300 transition-colors group-hover:text-slate-500" />}
      </div>
      {/* Vaste twee-regel-zone (leading-4 × min-h-8): labels van één en twee
          regels ("BESCHIKBAAR" vs "CHAUFFEURS ACTIEF") duwden de cijfers
          anders naar verschillende hoogtes — de hele strip oogde rommelig
          (melding Jarno). Nu start elk cijfer en elke subtekst op exact
          dezelfde lijn. */}
      <p className="mt-2.5 text-xs leading-4 min-h-8 font-medium text-slate-500">{label}</p>
      {/* Mono: de cijfers zijn het instrumentpaneel — zelfde accent als
          dienstnummers en tijden. */}
      <p className="mt-0.5 text-2xl leading-8 font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">
        {text ?? <CountUp value={value ?? 0} />}
        {suffix && <span className="text-sm font-semibold text-slate-400">{suffix}</span>}
      </p>
      <p className={cn('mt-0.5 text-2xs font-medium text-slate-500 truncate', subClassName)}>{sub}</p>
      {typeof meter === 'number' && (
        <div className="mt-2 h-1.5 rounded-full bg-surface-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', meter > 100 ? 'bg-red-500' : meter > 80 ? 'bg-amber-500' : 'bg-emerald-500')}
            style={{ width: `${Math.max(3, Math.min(100, meter))}%` }}
          />
        </div>
      )}
      {note && (
        <p className="mt-2 rounded-lg bg-oker-500/10 px-2 py-1.5 text-2xs font-medium leading-snug text-oker-800 dark:text-oker-300">
          {note}
        </p>
      )}
      {lines && lines.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {lines.map((l) => (
            <div
              key={`${l.left}-${l.right ?? ''}`}
              className={cn(
                'flex items-baseline justify-between gap-3 text-2xs font-mono font-medium tabular-nums',
                l.done ? 'text-slate-400' : 'text-slate-600',
              )}
            >
              <span className={cn('inline-flex items-center gap-1.5', l.done && 'line-through decoration-slate-300')}>
                {/* "Nu"-stip: het blok dat op dit moment loopt. */}
                {l.active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-oker-500 animate-pulse" aria-label="nu bezig" />}
                {l.left}
              </span>
              {l.right && (
                <span className={cn('shrink-0 text-slate-500', l.done && 'text-slate-400')}>{l.right}</span>
              )}
            </div>
          ))}
          {/* Voortgang van het lopende blok: dun oker lijntje dat meegroeit
              met de dienst (sluit aan bij de nu-stip en het doorstrepen). */}
          {(() => {
            const activeLine = lines.find((l) => l.active && typeof l.progress === 'number');
            if (!activeLine) return null;
            const pct = Math.max(0, Math.min(100, activeLine.progress!));
            return (
              <div
                className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-200/20"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="voortgang van het lopende blok"
              >
                <div className="h-full rounded-full bg-oker-500 transition-[width] duration-1000" style={{ width: `${pct}%` }} />
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
  const style = {
    background: 'var(--tile-bg)',
    border: 'var(--tile-border)',
    boxShadow: 'var(--tile-shadow)',
  };
  if (onClick) {
    return (
      // flex-col + justify-start: Safari centreert button-inhoud verticaal
      // zodra de knop hoger is dan zijn inhoud (grid rekt tegels tot gelijke
      // hoogte). Zonder dit hingen icoon en kop van een kortere tegel lager
      // dan die van de buurtegel.
      <button type="button" onClick={onClick} className={cn('group surface-card-hover flex flex-col items-stretch justify-start rounded-3xl p-4 text-left', className)} style={style}>
        {inner}
      </button>
    );
  }
  return <div className={cn('flex flex-col items-stretch justify-start rounded-3xl p-4', className)} style={style}>{inner}</div>;
}

/** Cockpit-paneel met titelrij en optionele 'bekijk alle'-actie. */
export function OpsPanel({
  icon,
  title,
  aside,
  onSeeAll,
  seeAllLabel = 'Bekijk alle',
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  aside?: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('rounded-3xl p-5 relative', className)}
      style={{
        background: 'var(--tile-bg)',
        border: 'var(--tile-border)',
        boxShadow: 'var(--tile-shadow)',
      }}
    >
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600 dark:text-slate-300">
            {icon}
          </span>
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
        </div>
        {aside && (
          <span className="text-xs font-medium text-slate-500">{aside}</span>
        )}
      </div>
      {children}
      {onSeeAll && (
        <button
          onClick={onSeeAll}
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-surface-row ring-1 ring-hairline px-3 py-2 text-xs font-semibold text-slate-600 transition-all hover:bg-surface-row-hover hover:text-slate-900 hover:shadow-sm"
        >
          {seeAllLabel}
          <ArrowUpRight size={12} />
        </button>
      )}
    </div>
  );
}

/** Werkvoorraad-rij in 'Open taken'. */
export function OpsRow({
  tone,
  icon,
  primary,
  secondary,
  meta,
  trailing,
  onClick,
}: {
  tone: StatTone;
  icon: ReactNode;
  primary: string;
  secondary?: string;
  meta?: string;
  /** Optioneel element rechts (bv. een dienstnummer-chip). */
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl bg-surface-row ring-1 ring-hairline px-3.5 py-2.5 sm:pointer-fine:py-2 text-left transition-all hover:bg-surface-row-hover hover:ring-hairline-strong hover:shadow-sm"
    >
      <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', STAT_TONES[tone])}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800">{primary}</span>
        {secondary && <span className="mt-px block truncate text-xs font-normal text-slate-500">{secondary}</span>}
      </span>
      {trailing}
      {meta && <span className="shrink-0 text-2xs font-medium text-slate-400">{meta}</span>}
      <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
    </button>
  );
}



/** Snelle actie onderaan de cockpit. */
export function QuickAction({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group surface-card-hover flex items-center gap-2.5 rounded-3xl p-3.5 text-left"
      style={{
        background: 'var(--tile-bg)',
        border: 'var(--tile-border)',
        boxShadow: 'var(--tile-shadow)',
      }}
    >
      <span className="quick-action-icon inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold tracking-tight text-slate-900">{label}</span>
        <span className="block truncate text-xs font-medium text-slate-500">{sub}</span>
      </span>
      <ArrowUpRight size={15} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-700" />
    </button>
  );
}

/** Relatieve tijd in het Nederlands ("zojuist", "12 min geleden", "gisteren"). */
export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'zojuist';
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} u geleden`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'gisteren';
  return `${days} dagen geleden`;
}
