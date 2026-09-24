import type { ReactNode } from 'react';
import { metEenheid } from '../lib/format';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { CountUp } from './CountUp';
import { cn } from '../lib/ui';
import { Button, Meter, MeterVulling } from './primitives';

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
  mono = false,
  onClick,
  actief = false,
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
  /** Het grote veld toont een dienstnummer of tijd i.p.v. een telling: dan
   *  blijft het mono (instrument-signaal), tellingen staan in de koprol. */
  mono?: boolean;
  onClick?: () => void;
  /** Gekozen filtertegel (punt 4, 16-09): neutraal zoals elke selectie,
   *  gedempt vlak + sterke hairline, geen goud (goud = actie, focus, nu). */
  actief?: boolean;
  className?: string;
}) {
  const inner = (
    <>
      {/* Kop: icoon en label op één regel (het pijltje is weg — de hele tegel
          is klikbaar). Compacter dan de oude icoon-boven-label-opbouw: ±40 px
          minder in de smalle mobiele tegel (Jarno 04-09). */}
      <div className="kpi-kop flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', STAT_TONES[tone])}>
            {icon}
          </span>
          <span className="truncate text-label">{label}</span>
        </span>
      </div>
      {/* Telling = koprol (text-stat); dienstnummer of tijd = mono erbij,
          zelfde accent als overal elders (ronde 3, 19-09). */}
      <p className={cn('kpi-getal mt-2.5 min-w-0 truncate text-stat text-slate-900', mono && 'text-stat-mono')}>
        {text ?? <CountUp value={value ?? 0} />}
        {suffix && <span className="text-sm font-semibold text-slate-500">{suffix}</span>}
      </p>
      <p className={cn('kpi-sub mt-0.5 text-xs font-medium text-slate-500 truncate', subClassName)}>{sub}</p>
      {/* Geen balk zolang er niets verbruikt is: een lege baan over de volle
          breedte las als een scheidingslijn of een foutje. */}
      {typeof meter === 'number' && meter > 0 && (
        <Meter className="kpi-extra mt-2 h-1.5">
          <MeterVulling pct={Math.max(3, meter)} className={meter > 100 ? 'bg-red-500' : meter > 80 ? 'bg-amber-500' : 'bg-emerald-500'} />
        </Meter>
      )}
      {lines && lines.length > 0 && (
        <div className="kpi-extra mt-1.5 space-y-0.5">
          {lines.map((l) => (
            <div
              key={`${l.left}-${l.right ?? ''}`}
              // flex-wrap + nowrap links: in een smalle tegel (twee kolommen op
              // mobiel) brak "15:56–25:20" op het streepje in twee regels naast
              // "loop 4614" (Jarno 04-09). Nu blijft de tijd heel en zakt het
              // rechterdeel naar een eigen regel, rechts uitgelijnd.
              className={cn(
                'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs font-mono font-medium tabular-nums',
                l.done ? 'text-slate-500' : 'text-slate-600',
              )}
            >
              <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', l.done && 'line-through decoration-slate-300')}>
                {/* "Nu"-stip: het blok dat op dit moment loopt. */}
                {l.active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-oker-500 vhb-nu" role="img" aria-label="nu bezig" />}
                {l.left}
              </span>
              {/* Ook na "klaar" leesbaar: slate-400 (2,6:1) was onder AA voor "loop 4500". */}
              {l.right && (
                <span className="ml-auto shrink-0 text-slate-500">{l.right}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {balk && <div className="kpi-extra">{balk}</div>}
      {note && (
        <p className="kpi-extra mt-2 rounded-lg bg-surface-muted px-2 py-1.5 text-xs font-medium leading-snug text-slate-700">
          {note}
        </p>
      )}
    </>
  );
  // Oppervlak = trede 1 van de ladder (.surface-card), net als elke Card;
  // de inline var(--tile-*)-stijlen van vroeger zijn weg (golf 2, punt 2).
  if (onClick) {
    return (
      // flex-col + justify-start: Safari centreert button-inhoud verticaal
      // zodra de knop hoger is dan zijn inhoud (grid rekt tegels tot gelijke
      // hoogte). Zonder dit hingen icoon en kop van een kortere tegel lager
      // dan die van de buurtegel.
      // rauw: KPI-tegel-als-knop met eigen layout (kaart-als-knop).
      <button type="button" onClick={onClick} aria-pressed={actief || undefined} className={cn('ios-pressable kpi-tegel group surface-card surface-card-hover flex flex-col items-stretch justify-start rounded-3xl p-4 text-left', actief && 'bg-surface-muted ring-1 ring-hairline-strong', className)}>
        {inner}
      </button>
    );
  }
  return <div className={cn('kpi-tegel surface-card flex flex-col items-stretch justify-start rounded-3xl p-4', className)}>{inner}</div>;
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
    <div className={cn('surface-card rounded-3xl p-5 relative', className)}>
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
  leading,
  badges,
  primary,
  secondary,
  meta,
  trailing,
  onClick,
}: {
  tone: StatTone;
  icon?: ReactNode;
  /** Eigen tegel links (bv. LijnTegel) in plaats van het icoonvak in `tone`. */
  leading?: ReactNode;
  /** Badges boven de tekst; vervangen het icoonvak als er geen leading is. */
  badges?: ReactNode;
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
      className="tikbaar group flex w-full items-center gap-3 rounded-xl bg-surface-row ring-1 ring-hairline px-3.5 py-2.5 sm:pointer-fine:py-2 text-left transition-[background-color,box-shadow] hover:bg-surface-row-hover hover:ring-hairline-strong hover:elev-1"
    >
      {leading ?? (badges ? null : (
        <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', STAT_TONES[tone])}>
          {icon}
        </span>
      ))}
      <span className="min-w-0 flex-1">
        {badges && <span className="mb-2 block">{badges}</span>}
        <span className="block truncate text-sm font-medium text-slate-800">{primary}</span>
        {secondary && <span className="mt-px block truncate text-xs font-normal text-slate-500">{secondary}</span>}
      </span>
      {trailing}
      {meta && <span className="shrink-0 text-xs font-medium text-slate-500">{meta}</span>}
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
    // rauw: snelactie-tegel (kaart-als-knop met eigen layout), bewust buiten
    // Button gehouden.
    <button
      type="button"
      onClick={onClick}
      className="ios-pressable group surface-card surface-card-hover flex items-center gap-2.5 rounded-3xl p-3.5 text-left"
    >
      {/* Carbon vierkant met licht icoon; de omgekeerde schalen keren dat in
          donker vanzelf om (geen aparte dark-look meer, controle-ronde 05-09, 40). */}
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-slate-50">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{label}</span>
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
  if (minutes < 60) return `${metEenheid(minutes, 'min')} geleden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${metEenheid(hours, 'u')} geleden`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'gisteren';
  return `${days} dagen geleden`;
}
