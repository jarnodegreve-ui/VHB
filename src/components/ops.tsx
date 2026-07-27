import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { CountUp } from './CountUp';
import { cn } from '../lib/ui';

/**
 * Gedeelde bouwstenen van het Operations Center-dashboard.
 *
 * Stonden eerst alleen in PlannerDashboardWidgets; het chauffeursdashboard
 * gebruikt nu dezelfde look (tegels, panelen, snelle acties) met eigen data,
 * zodat beide schermen niet uit elkaar groeien.
 */
export const STAT_TONES = {
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  red: 'bg-red-500/12 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  oker: 'bg-oker-500/15 text-oker-600 dark:text-oker-400',
  blue: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  slate: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
} as const;

export type StatTone = keyof typeof STAT_TONES;

/** Compacte KPI voor de status-strip. `value` (getal) animeert via CountUp. */
export function OpsStat({
  icon,
  tone,
  label,
  value,
  text,
  suffix,
  sub,
  lines,
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
  /** Optionele detailregels onder de subtekst (bv. de blokken van een
   *  dienst): `left` (tijden) en `right` (loopnummer) staan in twee nette
   *  kolommen onder elkaar. `done` toont een al gereden blok gedempt. */
  lines?: Array<{ left: string; right?: string; done?: boolean }>;
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
      <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[24px] leading-8 font-black tabular-nums tracking-[-0.02em] text-slate-900">
        {text ?? <CountUp value={value ?? 0} />}
        {suffix && <span className="text-[14px] font-semibold text-slate-400">{suffix}</span>}
      </p>
      <p className="mt-0.5 text-[11.5px] font-medium text-slate-500 truncate">{sub}</p>
      {lines && lines.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {lines.map((l) => (
            <div
              key={`${l.left}-${l.right ?? ''}`}
              className={cn(
                'flex items-baseline justify-between gap-3 text-[11.5px] font-medium tabular-nums',
                l.done ? 'text-slate-400' : 'text-slate-600',
              )}
            >
              <span className={cn(l.done && 'line-through decoration-slate-300')}>{l.left}</span>
              {l.right && (
                <span className={cn('shrink-0 text-slate-500', l.done && 'text-slate-400')}>{l.right}</span>
              )}
            </div>
          ))}
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
      <button type="button" onClick={onClick} className={cn('group surface-card-hover rounded-3xl p-4 text-left', className)} style={style}>
        {inner}
      </button>
    );
  }
  return <div className={cn('rounded-3xl p-4', className)} style={style}>{inner}</div>;
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
          <h3 className="text-[13.5px] font-bold tracking-tight text-slate-900">{title}</h3>
        </div>
        {aside && (
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{aside}</span>
        )}
      </div>
      {children}
      {onSeeAll && (
        <button
          onClick={onSeeAll}
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-white/70 ring-1 ring-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 transition-all hover:bg-white hover:text-slate-900 hover:shadow-sm"
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
      className="group flex w-full items-center gap-3 rounded-xl bg-white/70 ring-1 ring-slate-200/60 px-3.5 py-2.5 text-left transition-all hover:bg-white hover:ring-slate-300/80 hover:shadow-sm"
    >
      <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', STAT_TONES[tone])}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-slate-800">{primary}</span>
        {secondary && <span className="mt-px block truncate text-xs font-normal text-slate-500">{secondary}</span>}
      </span>
      {trailing}
      {meta && <span className="shrink-0 text-[11px] font-medium text-slate-400">{meta}</span>}
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
        <span className="block truncate text-[13px] font-bold tracking-tight text-slate-900">{label}</span>
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
