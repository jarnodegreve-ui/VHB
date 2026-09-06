import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { CountUp } from './CountUp';
import { cn } from '../lib/ui';
import { Button } from './primitives';

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
  emerald: 'bg-emerald-500/12 text-emerald-700',
  red: 'bg-red-500/12 text-red-700',
  amber: 'bg-amber-500/12 text-amber-700',
  // Ziekte volgt de statuskleurtaal (lib/statusColors): rose, niet amber —
  // anders betekende ziek op de tegel iets anders dan in de rijen eronder.
  rose: 'bg-rose-500/12 text-rose-700',
  oker: 'bg-oker-500/15 text-oker-700',
  blue: 'bg-blue-500/12 text-blue-700',
  slate: 'bg-slate-500/12 text-slate-600',
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
  balk,
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
  lines?: Array<{ left: string; right?: string; done?: boolean; active?: boolean }>;
  /** Instrument onder de regels — bv. de DienstBalk (compact). */
  balk?: ReactNode;
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
      {/* Kop: icoon en label op één regel (het pijltje is weg — de hele tegel
          is klikbaar). Compacter dan de oude icoon-boven-label-opbouw: ±40 px
          minder in de smalle mobiele tegel (Jarno 04-09). */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', STAT_TONES[tone])}>
            {icon}
          </span>
          <span className="truncate text-label">{label}</span>
        </span>
      </div>
      {/* Mono: de cijfers zijn het instrumentpaneel — zelfde accent als
          dienstnummers en tijden (rol text-stat, index.css). */}
      <p className="mt-2.5 min-w-0 truncate text-stat text-slate-900">
        {text ?? <CountUp value={value ?? 0} />}
        {suffix && <span className="text-sm font-semibold text-slate-500">{suffix}</span>}
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
      {lines && lines.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {lines.map((l) => (
            <div
              key={`${l.left}-${l.right ?? ''}`}
              // flex-wrap + nowrap links: in een smalle tegel (twee kolommen op
              // mobiel) brak "15:56–25:20" op het streepje in twee regels naast
              // "loop 4614" (Jarno 04-09). Nu blijft de tijd heel en zakt het
              // rechterdeel naar een eigen regel, rechts uitgelijnd.
              className={cn(
                'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-2xs font-mono font-medium tabular-nums',
                l.done ? 'text-slate-500' : 'text-slate-600',
              )}
            >
              <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', l.done && 'line-through decoration-slate-300')}>
                {/* "Nu"-stip: het blok dat op dit moment loopt. */}
                {l.active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-oker-500 animate-pulse" aria-label="nu bezig" />}
                {l.left}
              </span>
              {l.right && (
                <span className={cn('ml-auto shrink-0 text-slate-500', l.done && 'text-slate-400')}>{l.right}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {balk}
      {note && (
        <p className="mt-2 rounded-lg bg-oker-500/10 px-2 py-1.5 text-2xs font-medium leading-snug text-oker-800">
          {note}
        </p>
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
      // rauw: KPI-tegel-als-knop met eigen layout en inline var(--tile-*)-oppervlak.
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
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600">
            {icon}
          </span>
          <h3 className="text-card-title">{title}</h3>
        </div>
        {aside && (
          <span className="text-xs font-medium text-slate-500">{aside}</span>
        )}
      </div>
      {children}
      {onSeeAll && (
        <Button variant="secondary" size="sm" full className="mt-3 gap-1" onClick={onSeeAll}>
          {seeAllLabel}
          <ArrowUpRight size={12} />
        </Button>
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
    // rauw: klikbare werkvoorraad-rij (icoon + twee tekstregels + meta + chevron) —
    // rij-als-knop met eigen layout, geen knop-uiterlijk.
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
      {meta && <span className="shrink-0 text-2xs font-medium text-slate-500">{meta}</span>}
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
    // rauw: snelactie-tegel (kaart-als-knop met eigen layout en inline
    // var(--tile-*)-oppervlak), bewust buiten Button gehouden.
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
      {/* Carbon vierkant met licht icoon; de omgekeerde schalen keren dat in
          donker vanzelf om (geen aparte dark-look meer, controle-ronde 05-09, 40). */}
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-slate-50">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold tracking-tight text-slate-900">{label}</span>
        <span className="block truncate text-xs font-medium text-slate-500">{sub}</span>
      </span>
      <ArrowUpRight size={16} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-700" />
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
