import { Fragment, useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Inbox,
  KeyRound,
  MapPin,
  Repeat,
  Settings,
  CheckCircle2,
  Upload,
  Users,
} from 'lucide-react';
import type {
  ActivityLogEntry,
  Diversion,
  LeaveRequest,
  PlanningMatrixImportHistory,
  Shift,
  SwapRequest,
  Update,
  User,
  View,
} from '../types';
import type { DayGap } from '../lib/coverage';
import { getDaypartGreeting } from '../lib/interactive';
import { isoDate } from '../lib/availability';
import { CountUp } from '../components/CountUp';
import { Skeleton, SkeletonRow, SkeletonTile } from '../components/Skeleton';
import { cn } from '../lib/ui';

/**
 * Operations Center — het planner/admin-dashboard als operationele cockpit.
 *
 * Eén scherm beantwoordt: wie rijdt er, wat staat er open, wat vraagt
 * aandacht en wat is de actuele status van de operatie. Alle cijfers komen
 * uit echte portaaldata (planning, dekking, verlof, ruilen, imports,
 * omleidingen, activiteit) — niets is decoratief.
 */
export function PlannerDashboardWidgets({
  currentUser,
  users,
  shifts,
  diversions,
  updates,
  leaveRequests,
  swaps,
  matrixHistory,
  activityLog,
  coverageDays,
  onNavigate,
  isInitialLoad = false,
}: {
  currentUser: User;
  users: User[];
  shifts: Shift[];
  diversions: Diversion[];
  updates: Update[];
  leaveRequests: LeaveRequest[];
  swaps: SwapRequest[];
  matrixHistory: PlanningMatrixImportHistory[];
  activityLog: ActivityLogEntry[];
  /** null = dekking (nog) niet geladen — toon 'onbekend' i.p.v. vals-groen. */
  coverageDays: DayGap[] | null;
  onNavigate: (view: View) => void;
  isInitialLoad?: boolean;
}) {
  // Klok voor de header (60s-tick is ruim voldoende voor een dagdeel-groet).
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (isInitialLoad) {
    return (
      <section className="space-y-5">
        <div className="px-1 pt-1 space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl p-5 surface-card">
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </div>
          <div className="rounded-3xl p-5 surface-card">
            <SkeletonRow /><SkeletonRow />
          </div>
        </div>
      </section>
    );
  }

  const today = isoDate(now);
  const firstName = currentUser.name.split(' ')[0];
  const greeting = getDaypartGreeting(now);
  const isAdmin = currentUser.role === 'admin';

  // === Operationele kerncijfers (alles uit echte data) ===
  const driversActiveToday = new Set(
    shifts.filter((s) => s.date === today).map((s) => String(s.driverId)),
  ).size;
  const totalDrivers = users.filter((u) => u.role === 'chauffeur').length;

  // Dekking: null = niet geladen/fout — behandel als 'onbekend', nooit
  // als 'volledig gedekt' (vals-groen is erger dan geen data).
  const coverageKnown = coverageDays !== null;
  const knownDays = coverageDays ?? [];
  const todayGap = knownDays.find((d) => d.date === today);
  const openToday = todayGap?.missing.length ?? 0;
  const openWeek = knownDays.reduce((n, d) => n + d.missing.length, 0);
  const gapDays = knownDays.filter((d) => d.missing.length > 0);

  const activeDiversions = diversions.length;

  const pendingLeave = leaveRequests.filter((r) => r.status === 'pending');
  const pendingSwaps = swaps.filter((s) => s.status === 'pending' || s.status === 'accepted');
  const openTasks = pendingLeave.length + pendingSwaps.length;

  const lastImport = matrixHistory[0] || null;
  const importIssueCount = lastImport
    ? lastImport.unknownCodes.length + lastImport.unmatchedDrivers.length
    : 0;
  const daysSinceImport = lastImport
    ? Math.floor((now.getTime() - new Date(lastImport.createdAt).getTime()) / 86400000)
    : null;
  // Zachte herinnering: er wérd al eens geïmporteerd, maar al > een week niet
  // meer. (Nooit geïmporteerd = niet naggen — kan een niet-import-opzet zijn.)
  const STALE_PLANNING_DAYS = 7;
  const planningStale = daysSinceImport !== null && daysSinceImport > STALE_PLANNING_DAYS;

  // Eén bron van waarheid voor statuspil, teller én empty-state: alles wat
  // als rij in 'Open taken' verschijnt telt mee — niets anders.
  // (Omleidingen tellen bewust niet mee: een omleiding is informatief, geen
  // openstaande taak.)
  const attentionCount =
    (planningStale ? 1 : 0) + (importIssueCount > 0 ? 1 : 0) + gapDays.length + openTasks;
  const needsAttention = attentionCount > 0;
  const userNameById = (id: string) =>
    users.find((u) => String(u.id) === String(id))?.name || 'Onbekend';


  const formatDay = (iso: string) => {
    const label = new Date(`${iso}T00:00:00`).toLocaleDateString('nl-BE', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    return iso === today ? `vandaag (${label})` : label;
  };

  return (
    <section className="space-y-5">
      {/* === Operationele header === */}
      <div className="flex flex-col gap-3 px-1 pt-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-[-0.02em] text-slate-900">
            {greeting}, <span className="text-oker-600">{firstName}</span>
          </h1>
          <p className="mt-0.5 text-[13px] font-normal text-slate-500">
            Actuele status op{' '}
            {now.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div
          className={cn(
            'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5',
            needsAttention
              ? 'border-amber-200 bg-amber-50'
              : 'border-emerald-100 bg-emerald-50',
          )}
        >
          <span className="relative flex h-2 w-2">
            <span className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
              needsAttention ? 'bg-amber-500' : 'bg-emerald-500',
            )} />
            <span className={cn(
              'relative inline-flex h-2 w-2 rounded-full',
              needsAttention ? 'bg-amber-500' : 'bg-emerald-500',
            )} />
          </span>
          <span className={cn(
            'text-[11px] font-semibold',
            needsAttention ? 'text-amber-700' : 'text-emerald-700',
          )}>
            {needsAttention ? 'Open taken' : 'Operationeel'}
          </span>
        </div>
      </div>

      {/* === Status-strip ===
          Gat-vrije verdeling van 5 tegels op elke breedte: mobiel 2+2+1(vol),
          medium een 6-koloms grid met 3 tegels van span-2 en 2 van span-3
          (rijen altijd vol), breed 5 naast elkaar. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-5">
        <OpsStat
          className="md:col-span-2 xl:col-span-1"
          icon={<Users size={16} />}
          tone="emerald"
          label="Chauffeurs actief"
          value={driversActiveToday}
          suffix={totalDrivers > 0 ? ` / ${totalDrivers}` : undefined}
          sub="vandaag ingepland"
          onClick={() => onNavigate('bezetting')}
        />
        {coverageKnown ? (
          <OpsStat
            className="md:col-span-2 xl:col-span-1"
            icon={<AlertTriangle size={16} />}
            tone={openToday > 0 ? 'red' : 'emerald'}
            label="Open diensten"
            value={openToday}
            sub={openWeek > 0 ? `${openWeek} in komende 7 dagen` : 'komende 7 dagen volledig'}
            onClick={() => onNavigate('dekking')}
          />
        ) : (
          <OpsStat
            className="md:col-span-2 xl:col-span-1"
            icon={<AlertTriangle size={16} />}
            tone="slate"
            label="Open diensten"
            text="—"
            sub="dekking niet beschikbaar"
            onClick={() => onNavigate('dekking')}
          />
        )}
        <OpsStat
          className="md:col-span-2 xl:col-span-1"
          icon={<MapPin size={16} />}
          tone="slate"
          label="Omleidingen"
          value={activeDiversions}
          sub={activeDiversions === 1 ? 'actieve omleiding' : 'actieve omleidingen'}
          onClick={() => onNavigate('omleidingen')}
        />
        <OpsStat
          className="md:col-span-3 xl:col-span-1"
          icon={<Inbox size={16} />}
          tone={openTasks > 0 ? 'amber' : 'emerald'}
          label="Open taken"
          value={openTasks}
          sub={`${pendingLeave.length} verlof · ${pendingSwaps.length} dienstruil`}
          onClick={() => onNavigate(pendingSwaps.length > pendingLeave.length ? 'ruil-verzoeken' : 'verlof-beheer')}
        />
        <OpsStat
          className="max-md:col-span-2 md:col-span-3 xl:col-span-1"
          icon={<CalendarClock size={16} />}
          tone={importIssueCount > 0 ? 'red' : planningStale ? 'amber' : 'slate'}
          label="Laatste import"
          text={daysSinceImport === null ? '—' : daysSinceImport === 0 ? 'Vandaag' : `${daysSinceImport}d`}
          sub={
            lastImport
              ? importIssueCount > 0
                ? `${importIssueCount} aandachtspunten`
                : `${lastImport.importedDays} dagen verwerkt`
              : 'nog geen import'
          }
          onClick={() => onNavigate('beheer-roosters')}
        />
      </div>

      {/* === Operations Center ===
          Geen items-start meer: beide kolommen rekken tot dezelfde hoogte,
          zodat er geen leeg gat onder de kortste kolom valt. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Open taken — gecombineerde werkvoorraad */}
        <OpsPanel
          className="lg:col-span-2"
          icon={<Inbox size={15} />}
          title="Open taken"
          aside={attentionCount > 0 ? `${attentionCount} ${attentionCount === 1 ? 'item' : 'items'}` : undefined}
        >
          <div className="space-y-1.5">
            {planningStale && (
              <OpsRow
                tone="amber"
                icon={<CalendarClock size={15} />}
                primary={`Planning al ${daysSinceImport} dagen niet bijgewerkt`}
                secondary="Upload je laatste Excel zodat de planning actueel blijft."
                onClick={() => onNavigate('beheer-roosters')}
              />
            )}
            {importIssueCount > 0 && lastImport && (
              <OpsRow
                tone="red"
                icon={<AlertTriangle size={15} />}
                primary="Laatste import heeft aandachtspunten"
                secondary={[
                  lastImport.unknownCodes.length > 0 ? `${lastImport.unknownCodes.length} onbekende codes` : null,
                  lastImport.unmatchedDrivers.length > 0 ? `${lastImport.unmatchedDrivers.length} niet-gematchte chauffeurs` : null,
                ].filter(Boolean).join(' · ')}
                onClick={() => onNavigate('beheer-roosters')}
              />
            )}
            {gapDays.slice(0, 3).map((d) => (
              <Fragment key={d.date}>
              <OpsRow
                tone="red"
                icon={<AlertTriangle size={15} />}
                primary={`${d.missing.length} open ${d.missing.length === 1 ? 'dienst' : 'diensten'} — ${formatDay(d.date)}`}
                secondary={`Dienst ${d.missing.slice(0, 6).join(', ')}${d.missing.length > 6 ? '…' : ''}`}
                onClick={() => onNavigate('dekking')}
              />
              </Fragment>
            ))}
            {pendingLeave.slice(0, 4).map((req) => (
              <Fragment key={req.id}>
              <OpsRow
                tone="amber"
                icon={<CalendarDays size={15} />}
                primary={`Verlofaanvraag · ${userNameById(req.userId)}`}
                secondary={`${req.startDate}${req.startDate !== req.endDate ? ` → ${req.endDate}` : ''} · ${req.type === 'betaald_verlof' ? 'betaald verlof' : 'klein verlet'}`}
                meta={relTime(req.createdAt)}
                onClick={() => onNavigate('verlof-beheer')}
              />
              </Fragment>
            ))}
            {pendingSwaps.slice(0, 4).map((swap) => (
              <Fragment key={swap.id}>
              <OpsRow
                tone="blue"
                icon={<Repeat size={15} />}
                primary={`Dienstruil · ${swap.targetDriverId
                  ? `${userNameById(swap.requesterId)} → ${userNameById(swap.targetDriverId)}`
                  : userNameById(swap.requesterId)}`}
                secondary={swap.status === 'accepted' ? 'Collega akkoord — wacht op validatie' : swap.reason || 'Wacht op een collega'}
                meta={relTime(swap.createdAt)}
                onClick={() => onNavigate('ruil-verzoeken')}
              />
              </Fragment>
            ))}
            {attentionCount === 0 && (
              <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={16} />
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold text-slate-800">Alles onder controle</p>
                  <p className="text-xs font-normal text-slate-500">Geen open taken, dekkingsgaten of import-aandachtspunten.</p>
                </div>
              </div>
            )}
          </div>
        </OpsPanel>

        {/* Rechterflank: live activiteit. Het vroegere "Systeemstatus"-paneel
            is bewust weg: import-status en dekking staan al in de status-strip
            bovenaan, en "Portaal Online"/"Realtime Actief" waren hardcoded
            (decoratie) — tegen het eigen niets-is-decoratief-principe in. */}
        <div className="flex flex-col gap-4">
          {isAdmin && activityLog.length > 0 ? (
            <OpsPanel
              className="flex-1"
              icon={<Activity size={15} />}
              title="Live activiteit"
              aside="laatste acties"
              onSeeAll={() => onNavigate('activiteit')}
              seeAllLabel="Volledige log"
            >
              <div className="space-y-0.5">
                {activityLog.slice(0, 6).map((entry) => (
                  <Fragment key={entry.id}><FeedRow entry={entry} /></Fragment>
                ))}
              </div>
            </OpsPanel>
          ) : (
            updates.length > 0 && (
              <OpsPanel
                className="flex-1"
                icon={<Bell size={15} />}
                title="Recente updates"
                onSeeAll={() => onNavigate('updates')}
                seeAllLabel="Alle updates"
              >
                <div className="space-y-1.5">
                  {updates.slice(0, 3).map((u) => (
                    <Fragment key={u.id}>
                    <OpsRow
                      tone={u.isUrgent ? 'red' : 'slate'}
                      icon={<Bell size={15} />}
                      primary={u.title}
                      secondary={u.category}
                      onClick={() => onNavigate('updates')}
                    />
                    </Fragment>
                  ))}
                </div>
              </OpsPanel>
            )
          )}
        </div>
      </div>

      {/* === Snelle acties === */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <QuickAction icon={<Upload size={16} />} label="Planning importeren" sub="Matrix uploaden" onClick={() => onNavigate('beheer-roosters')} />
        <QuickAction icon={<MapPin size={16} />} label="Omleiding toevoegen" sub="Hinder registreren" onClick={() => onNavigate('beheer-omleidingen')} />
        <QuickAction icon={<CalendarDays size={16} />} label="Verlofbeheer" sub="Aanvragen beoordelen" onClick={() => onNavigate('verlof-beheer')} />
        <QuickAction icon={<Bell size={16} />} label="Update publiceren" sub="Chauffeurs informeren" onClick={() => onNavigate('beheer-updates')} />
      </div>
    </section>
  );
}

// === Subcomponents ===

const STAT_TONES = {
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  red: 'bg-red-500/12 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  oker: 'bg-oker-500/15 text-oker-600 dark:text-oker-400',
  blue: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  slate: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
} as const;

type StatTone = keyof typeof STAT_TONES;

/** Compacte KPI voor de status-strip. `value` (getal) animeert via CountUp. */
function OpsStat({
  icon,
  tone,
  label,
  value,
  text,
  suffix,
  sub,
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
      <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[24px] leading-8 font-black tabular-nums tracking-[-0.02em] text-slate-900">
        {text ?? <CountUp value={value ?? 0} />}
        {suffix && <span className="text-[14px] font-semibold text-slate-400">{suffix}</span>}
      </p>
      <p className="mt-0.5 text-[11.5px] font-medium text-slate-500 truncate">{sub}</p>
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
function OpsPanel({
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
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{aside}</span>
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
function OpsRow({
  tone,
  icon,
  primary,
  secondary,
  meta,
  onClick,
}: {
  tone: StatTone;
  icon: ReactNode;
  primary: string;
  secondary?: string;
  meta?: string;
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
      {meta && <span className="shrink-0 text-[11px] font-medium text-slate-400">{meta}</span>}
      <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
    </button>
  );
}


const FEED_ICONS: Partial<Record<ActivityLogEntry['category'], ReactNode>> = {
  users: <Users size={13} />,
  planning: <CalendarClock size={13} />,
  planning_codes: <Settings size={13} />,
  services: <CalendarClock size={13} />,
  diversions: <MapPin size={13} />,
  updates: <Bell size={13} />,
  auth: <KeyRound size={13} />,
  leave: <CalendarDays size={13} />,
  swaps: <Repeat size={13} />,
};

/** Activiteit-feedregel: wie deed wat, hoelang geleden. */
function FeedRow({ entry }: { entry: ActivityLogEntry }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-1.5 py-2">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-500/12 text-slate-500 dark:text-slate-300">
        {FEED_ICONS[entry.category] ?? <Activity size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-slate-700">
          <span className="font-semibold text-slate-900">{entry.actorName}</span> · {entry.details || entry.action}
        </p>
        <p className="text-[11px] font-normal text-slate-400">{relTime(entry.createdAt)}</p>
      </div>
    </div>
  );
}

/** Snelle actie onderaan de cockpit. */
function QuickAction({
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
      className="group surface-card-hover flex items-center gap-3 rounded-3xl p-4 text-left"
      style={{
        background: 'var(--tile-bg)',
        border: 'var(--tile-border)',
        boxShadow: 'var(--tile-shadow)',
      }}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-oker-500/15 dark:text-oker-400">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold tracking-tight text-slate-900">{label}</span>
        <span className="block truncate text-xs font-medium text-slate-500">{sub}</span>
      </span>
      <ArrowUpRight size={15} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-700" />
    </button>
  );
}

/** Relatieve tijd in het Nederlands ("zojuist", "12 min geleden", "gisteren"). */
function relTime(iso: string): string {
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
