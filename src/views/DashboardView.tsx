import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Calendar, Clock, MapPin, ChevronRight, ArrowUpRight, Plane, FileText, RefreshCw, Users, LayoutGrid, Eye } from 'lucide-react';
import type { Diversion, LeaveRequest, Shift, User, View } from '../types';
import { getDaypartGreeting } from '../lib/interactive';
import { formatDateHuman } from '../lib/format';
import { isoDate } from '../lib/availability';
import { verlofBalans } from '../lib/leaveBalance';
import { Sparkline } from '../components/Sparkline';
import { BrandBus } from '../components/BrandBus';
import { Skeleton, SkeletonRow, SkeletonTile } from '../components/Skeleton';
import { SlideOver } from '../components/SlideOver';

/**
 * Dashboard — Bento premium-stijl (E++ preview).
 *
 * Verfijningen vs. eerste bento-versie:
 * - Asymmetrische tegel-groottes (hero span 2-col + 2 smaller)
 * - Diepere lagen schaduw (basis + colored glow on hover)
 * - 2-tone iconen: chip-achtergrond + crisp foreground
 * - Sterker typografisch contrast (label-size klein, value-size groot)
 * - Inner highlight via inset shadows (premium glas-gevoel)
 * - Smooth hover-transitions (scale + shadow + ring)
 */
export function DashboardView({
  user,
  shifts,
  diversions,
  users,
  leaveRequests = [],
  isInitialLoad = false,
  onNavigate,
  canPreview = false,
  previewActive = false,
  onTogglePreview,
}: {
  user: User;
  shifts: Shift[];
  diversions: Diversion[];
  users: User[];
  leaveRequests?: LeaveRequest[];
  isInitialLoad?: boolean;
  onNavigate?: (view: View) => void;
  /** Admin-only: toon de 'bekijk als chauffeur'-switch. */
  canPreview?: boolean;
  previewActive?: boolean;
  onTogglePreview?: () => void;
}) {
  const [now, setNow] = useState(new Date());
  // Detailvenster voor een omleiding — opent als side panel, geen paginawissel.
  const [openDiversion, setOpenDiversion] = useState<Diversion | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const myShifts = shifts.filter((s) => s.driverId === user.id);
  // Lokale dag (isoDate) i.p.v. toISOString(): die laatste gaf 's nachts in
  // BE de UTC-dag terug, waardoor 'Vandaag' de verkeerde/geen dienst toonde.
  const today = isoDate(now);
  const todaysShift = myShifts.find((shift) => shift.date === today);

  const nextShift = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter((s) => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];

  const newestDiversions = [...diversions].reverse().slice(0, 3);
  const visibleShifts = myShifts.slice(0, 3);

  // Verlofsaldo + 'deze maand' voor de extra dashboard-kaarten.
  const balans = verlofBalans(leaveRequests, user.id, now.getFullYear(), user.verlofBudget);
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthShiftCount = myShifts.filter((s) => s.date.startsWith(monthPrefix)).length;

  // Volgende geplande diensten (toekomst, oplopend gesorteerd) — voor de
  // Planning-panel bij chauffeurs.
  const upcomingShifts = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter((s) => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())
    .slice(0, 3);

  const formatShiftDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });

  const getServiceNumber = (shift: Shift) => String(shift.line || '--').trim() || '--';

  // "Lijn 5 & 8" vs "5": prefix alleen wanneer 't nog niet in de data zit.
  const lineLabel = (line: string) =>
    line.trim().toLowerCase().startsWith('lijn') ? line.trim() : `Lijn ${line.trim()}`;

  // Adaptief: voor < 24u is de countdown zelf de hero (dringend, hoe
  // lang nog tot je dienst). Voor > 24u is de DATUM bruikbaarder dan
  // "27 dagen" — dat zegt een chauffeur weinig. Subtitle krijgt dan
  // de dagen-info als context.
  const getNextShiftDisplay = (target: Date) => {
    const diff = target.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const dateStr = target.toLocaleDateString('nl-BE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const capitalized = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return {
        hero: capitalized,
        sub: `over ${days} ${days === 1 ? 'dag' : 'dagen'}`,
      };
    }
    if (hours > 0) {
      return { hero: `${hours}u ${minutes}m`, sub: capitalized };
    }
    return { hero: `${minutes} minuten`, sub: capitalized };
  };

  const isChauffeur = user.role === 'chauffeur';
  const firstName = user.name.split(' ')[0];
  const greeting = getDaypartGreeting(now);

  // Skeleton-mode: eerste fetch nog niet rond
  if (isInitialLoad) {
    return (
      <div className="space-y-4">
        <div className="px-1 pt-1 space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl h-44">
            <SkeletonTile className="h-full" />
          </div>
          <div className="flex flex-col gap-4">
            <SkeletonTile />
            <SkeletonTile />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-3xl p-5 surface-card">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
          <div className="rounded-3xl p-5 surface-card">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Admin-preview: schakel de weergave naar hoe een chauffeur het portaal ziet
          (enkel visueel — rechten/data blijven ongewijzigd). */}
      {canPreview && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-oker-200/70 bg-oker-500/10 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <Eye size={15} className="shrink-0 text-oker-600" />
            <span className="text-[12.5px] font-medium text-slate-600 truncate">
              {previewActive ? 'Je bekijkt het portaal als een chauffeur.' : 'Bekijk het portaal als een chauffeur.'}
            </span>
          </div>
          <button
            type="button"
            onClick={onTogglePreview}
            role="switch"
            aria-checked={previewActive}
            aria-label="Chauffeurs-weergave"
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${previewActive ? 'bg-oker-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${previewActive ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
      )}
      {/* === Gepersonaliseerde begroeting === */}
      <div className="px-1 pt-1">
        <h1 className="text-[22px] md:text-[26px] font-bold tracking-[-0.02em] text-slate-900">
          {greeting}, <span className="text-oker-600">{firstName}</span>
        </h1>
        <p className="text-[13px] font-normal text-slate-500 mt-0.5">
          {isChauffeur ? (
            todaysShift ? (
              <>Je rijdt vandaag <span className="font-semibold text-slate-700">dienst {getServiceNumber(todaysShift)}</span> · {todaysShift.startTime}–{todaysShift.endTime}</>
            ) : nextShift ? (
              <>Vrije dag · volgende dienst {nextShift.startDateTime.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} om {nextShift.startTime}</>
            ) : (
              <>Vrije dag · geen diensten gepland</>
            )
          ) : (
            <>{now.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}</>
          )}
        </p>
      </div>

      {/* === HERO ROW === */}
      {isChauffeur && nextShift ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {todaysShift ? (
            <StatTile
              icon={<Clock size={18} />}
              color="emerald"
              label="Vandaag"
              value={todaysShift.startTime}
              subValue={`tot ${todaysShift.endTime}`}
            />
          ) : (
            /* Vrij vandaag — busje rijdt over de onderrand (delay 0s) */
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="tilt-card glow-top relative overflow-hidden rounded-3xl p-5"
              style={{
                background: 'var(--tile-bg)',
                border: 'var(--tile-border)',
                boxShadow: 'var(--tile-shadow)',
              }}
            >
              <div className="relative">
                <div className="flex items-start justify-between mb-2.5">
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                    <Clock size={18} />
                  </div>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Vandaag</p>
                <p className="mt-1 text-[28px] leading-9 font-black tracking-[-0.02em] text-slate-900">Vrij</p>
                <p className="mt-1 text-xs font-medium text-slate-500">Geniet van je vrije dag.</p>
              </div>
              <DrivingBus delay="0s" />
            </motion.div>
          )}

          {/* Volgende-dienst tile — zelfde format als StatTile zodat 't
              naadloos in de rij met andere hero's past. */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="tilt-card glow-top relative overflow-hidden rounded-3xl p-5"
            style={{
              background: 'var(--tile-bg)',
              border: 'var(--tile-border)',
              boxShadow: 'var(--tile-shadow)',
            }}
          >
            <div className="flex items-start justify-between mb-2.5">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-oker-500/15 text-oker-600 dark:text-oker-400">
                <Calendar size={18} />
              </div>
            </div>
            {(() => {
              const display = getNextShiftDisplay(nextShift.startDateTime);
              return (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Volgende dienst
                  </p>
                  <p className="mt-1 text-[22px] font-black tracking-[-0.02em] text-slate-900 leading-tight">
                    {display.hero}
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500 tabular-nums">
                    {display.sub} · {nextShift.startTime}–{nextShift.endTime}
                  </p>
                </>
              );
            })()}
          </motion.div>

          <StatTile
            icon={<Plane size={18} />}
            color="blue"
            label="Verlofsaldo"
            value={balans.betaaldResterend}
            subValue={`van ${balans.betaaldBudget} dagen over`}
            onClick={onNavigate ? () => onNavigate('verlof') : undefined}
          />

          <StatTile
            icon={<AlertTriangle size={18} />}
            color="rose"
            label="Omleidingen"
            value={diversions.length}
            subValue="Actief in netwerk"
            onClick={onNavigate ? () => onNavigate('omleidingen') : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Busje rijdt ook hier (admin/planner + chauffeur-zonder-
              dienst) van tile naar tile zodra 't 'Vrij' is. Delays 0s/4s
              voor de twee tiles. */}
          <StatTile
            icon={<Clock size={18} />}
            color="emerald"
            label="Vandaag"
            value={todaysShift?.startTime || 'Vrij'}
            subValue={todaysShift ? `tot ${todaysShift.endTime}` : 'Geen dienst gepland'}
            overlay={!todaysShift ? <DrivingBus delay="0s" /> : undefined}
          />
          <StatTile
            icon={<AlertTriangle size={18} />}
            color="rose"
            label="Omleidingen"
            value={diversions.length}
            subValue="Actief in netwerk"
          />
        </div>
      )}

      {/* === Wide tiles row === */}
      <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${isChauffeur && onNavigate ? '2xl:grid-cols-3' : ''}`}>
        <PremiumPanel icon={<Calendar size={16} />} iconBg="bg-slate-900" title="Planning" subtitle={isChauffeur ? `${thisMonthShiftCount} deze maand` : now.toLocaleDateString('nl-BE', { day: '2-digit', month: 'long' })}>
          {/* Chauffeur: volgende geplande diensten (toekomst). De vrije-dag
              empty state + busje staat nu in de 'Vandaag'-tile bovenaan.
              Planner/admin: bredere lijst met komende diensten + namen. */}
          {(() => {
            const planningShifts = isChauffeur ? upcomingShifts : visibleShifts;
            if (planningShifts.length === 0) {
              return (
                <EmptyTile
                  icon={<Calendar size={20} />}
                  title="Geen geplande diensten"
                  subtitle="Er staan geen komende diensten in de planning."
                />
              );
            }
            return (
              <div className="space-y-2">
                {planningShifts.map((shift) => (
                  <div key={shift.id} className="group flex items-center justify-between gap-3 rounded-2xl bg-white/70 ring-1 ring-slate-200/60 px-3.5 py-2.5 hover:bg-white hover:ring-slate-300/80 hover:shadow-sm transition-all">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{formatShiftDate(shift.date)}</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-oker-700">Dienst {getServiceNumber(shift)}</span>
                      </div>
                      <p className="mt-0.5 text-base font-bold text-slate-900 tabular-nums tracking-tight">
                        {shift.startTime} <span className="text-slate-400 font-bold">–</span> {shift.endTime}
                      </p>
                    </div>
                    {!isChauffeur && (
                      <span className="text-xs text-slate-500 truncate font-semibold max-w-[120px]">
                        {users.find((u) => u.id === shift.driverId)?.name || 'Onbekend'}
                      </span>
                    )}
                    <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-600 transition-colors shrink-0" />
                  </div>
                ))}
              </div>
            );
          })()}
        </PremiumPanel>

        <PremiumPanel icon={<AlertTriangle size={16} />} iconBg="bg-oker-500" title="Omleidingen" subtitle={`${diversions.length} actief`} accent="oker">
          {newestDiversions.length > 0 ? (
            <div className="space-y-2">
              {newestDiversions.map((div) => (
                <button
                  type="button"
                  key={div.id}
                  onClick={() => setOpenDiversion(div)}
                  className="group flex w-full items-start gap-3 rounded-xl bg-white/70 ring-1 ring-slate-200/60 px-3.5 py-2.5 text-left hover:bg-white hover:ring-slate-300/80 hover:shadow-sm transition-all"
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${div.severity === 'high' ? 'bg-red-500' : div.severity === 'medium' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-900 truncate">{div.title}</p>
                      <span className="shrink-0 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{div.line}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-normal text-slate-500 line-clamp-2">{div.description}</p>
                  </div>
                  <ArrowUpRight size={14} className="text-slate-300 group-hover:text-slate-700 transition-colors shrink-0 mt-1" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyTile icon={<MapPin size={20} />} title="Vrije baan" subtitle="Geen omleidingen op het netwerk." />
          )}
        </PremiumPanel>

        {/* Snelkoppelingen — vult de breedte op breedbeeld + handige sprongen. */}
        {isChauffeur && onNavigate && (
          <div className="lg:col-span-2 2xl:col-span-1">
            <PremiumPanel icon={<LayoutGrid size={16} />} iconBg="bg-slate-900" title="Snelkoppelingen">
              <div className="grid grid-cols-2 gap-2.5">
                <QuickLink icon={<Calendar size={16} />} label="Mijn Rooster" onClick={() => onNavigate('rooster')} />
                <QuickLink icon={<Users size={16} />} label="Maandplanning" onClick={() => onNavigate('bezetting')} />
                <QuickLink icon={<FileText size={16} />} label="Ritblaadjes" onClick={() => onNavigate('ritblaadjes')} />
                <QuickLink icon={<RefreshCw size={16} />} label="Dienstruil" onClick={() => onNavigate('ruil-verzoeken')} />
              </div>
            </PremiumPanel>
          </div>
        )}
      </div>

      {/* Omleiding-detail als premium side panel */}
      <SlideOver
        open={!!openDiversion}
        onClose={() => setOpenDiversion(null)}
        title={openDiversion?.title ?? 'Omleiding'}
        subtitle={openDiversion ? lineLabel(openDiversion.line) : undefined}
        icon={
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-oker-500/15 text-oker-600 dark:text-oker-400">
            <MapPin size={17} />
          </span>
        }
      >
        {openDiversion && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  openDiversion.severity === 'high'
                    ? 'border-red-100 bg-red-50 text-red-700'
                    : openDiversion.severity === 'medium'
                    ? 'border-amber-100 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    openDiversion.severity === 'high'
                      ? 'bg-red-500'
                      : openDiversion.severity === 'medium'
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
                  }`}
                />
                {openDiversion.severity === 'high' ? 'Hoge impact' : openDiversion.severity === 'medium' ? 'Matige impact' : 'Lage impact'}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {lineLabel(openDiversion.line)}
              </span>
            </div>
            <div className="surface-muted rounded-xl p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Periode</p>
              <p className="mt-1.5 text-sm font-semibold text-slate-800 tabular-nums">
                {formatDateHuman(openDiversion.startDate)}
                {openDiversion.endDate ? ` → ${formatDateHuman(openDiversion.endDate)}` : ' → einde onbekend'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Omschrijving</p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-normal leading-relaxed text-slate-700">
                {openDiversion.description}
              </p>
            </div>
            {openDiversion.pdfUrl && (
              <a
                href={openDiversion.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="control-button-soft inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all"
              >
                <FileText size={15} />
                Bijlage openen (PDF)
              </a>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}

/** Knop in het Snelkoppelingen-paneel. */
function QuickLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2.5 rounded-xl bg-white/70 ring-1 ring-slate-200/60 px-3 py-3 text-left hover:bg-white hover:ring-slate-300/80 hover:shadow-sm transition-all"
    >
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-600 group-hover:bg-oker-100 group-hover:text-oker-700 transition-colors shrink-0">{icon}</span>
      <span className="text-[13.5px] font-semibold text-slate-800 truncate">{label}</span>
    </button>
  );
}

// === Subcomponents ===

// Rustige glass palette: glas-tegels met heel licht kleur-zweem.
// backdrop-filter geeft het "Apple Wallet kaart"-glas-effect — witten zijn
// iets minder dekkend zodat de background door het glas heen schijnt.
// Strakke neutrale tegels: gekleurd icoon = enige tint, achtergrond blijft
// gewoon wit. Geen warme creme- of pastel-tinten meer.
// CSS-variables zodat tegels mee-flippen in dark mode (zie :root en
// html.dark in index.css voor de waardes).
const NEUTRAL_BG = 'var(--tile-bg)';
const NEUTRAL_BORDER = 'var(--tile-border)';
const NEUTRAL_SHADOW = 'var(--tile-shadow)';

// Soft-tint icoonchips (Stripe/Linear-stijl): getinte achtergrond + gekleurd
// icoon i.p.v. massieve kleurblokken. Rustiger en professioneler.
const TILE_PALETTE = {
  emerald: {
    bg: NEUTRAL_BG,
    shadow: NEUTRAL_SHADOW,
    border: NEUTRAL_BORDER,
    iconBg: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  rose: {
    bg: NEUTRAL_BG,
    shadow: NEUTRAL_SHADOW,
    border: NEUTRAL_BORDER,
    iconBg: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  oker: {
    bg: NEUTRAL_BG,
    shadow: NEUTRAL_SHADOW,
    border: NEUTRAL_BORDER,
    iconBg: 'bg-oker-500/15 text-oker-600 dark:text-oker-400',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  blue: {
    bg: NEUTRAL_BG,
    shadow: NEUTRAL_SHADOW,
    border: NEUTRAL_BORDER,
    iconBg: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  slate: {
    bg: NEUTRAL_BG,
    shadow: NEUTRAL_SHADOW,
    border: NEUTRAL_BORDER,
    iconBg: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
} as const;

export type TilePalette = keyof typeof TILE_PALETTE;

/**
 * Per-tile rijdend busje + weg-segment. De bus rijdt over de onderrand
 * van de tile (geclipt door de tile's overflow-hidden) en verdwijnt
 * achter de rand. Met een verschillende `delay` per tile lijkt dezelfde
 * bus van tile naar tile over te springen — tussendoor (in de gap) is
 * 'ie niet zichtbaar. Alleen tonen wanneer de chauffeur vandaag vrij is.
 */
function DrivingBus({ delay }: { delay: string }) {
  return (
    <div className="driving-bus pointer-events-none absolute inset-x-0 bottom-0 h-7">
      {/* Weg-segment langs de onderrand (fade aan de randen). Iets
          zichtbaarder in light mode, subtieler in dark. */}
      <div className="absolute inset-x-3 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-oker-400/50 to-transparent dark:via-oker-400/30" />
      <div className="bus-cross" style={{ animationDelay: delay }}>
        <div className="bus-bump">
          {/* Donker busje in light mode, wit busje in dark mode. */}
          <span className="block dark:hidden">
            <BrandBus width={44} />
          </span>
          <span className="hidden dark:block">
            <BrandBus width={44} dark />
          </span>
        </div>
      </div>
    </div>
  );
}

export function StatTile({
  icon,
  color,
  label,
  value,
  subValue,
  onClick,
  sparkline,
  sparklineColor,
  overlay,
}: {
  icon: ReactNode;
  color: TilePalette;
  label: string;
  value: string | number;
  subValue?: string;
  onClick?: () => void;
  sparkline?: number[];
  sparklineColor?: string;
  overlay?: ReactNode;
}) {
  const c = TILE_PALETTE[color];
  // Default sparkline-kleur volgt de accent-tint
  const splColor =
    sparklineColor ||
    (color === 'oker'
      ? '#C9851F'
      : color === 'rose'
      ? '#e11d48'
      : color === 'emerald'
      ? '#059669'
      : color === 'blue'
      ? '#2563eb'
      : '#4F575F');
  const Body = (
    <>
      <div className="flex items-start justify-between mb-2.5">
        <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${c.iconBg}`}>
          {icon}
        </div>
        {sparkline && sparkline.length > 1 ? (
          <Sparkline data={sparkline} width={64} height={22} color={splColor} />
        ) : (
          onClick && <ArrowUpRight size={14} className={`${c.sub} opacity-70`} />
        )}
      </div>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${c.sub}`}>{label}</p>
      <p className={`mt-1 text-[28px] leading-9 font-black tabular-nums tracking-[-0.02em] ${c.text}`}>{value}</p>
      {subValue && <p className={`mt-1 text-xs font-medium ${c.sub}`}>{subValue}</p>}
    </>
  );
  const tileStyle = {
    background: c.bg,
    border: c.border,
    boxShadow: c.shadow,
  };
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="tilt-card glow-top glass-stack text-left flex-1 rounded-3xl p-5 relative overflow-hidden active:scale-[0.99]"
        style={tileStyle}
      >
        <span className="relative z-10 block">{Body}</span>
        {overlay}
      </button>
    );
  }
  return (
    <div
      className="glow-top flex-1 rounded-3xl p-5 relative overflow-hidden"
      style={tileStyle}
    >
      <span className="relative z-10 block">{Body}</span>
      {overlay}
    </div>
  );
}

function PremiumPanel({
  icon,
  iconBg,
  title,
  subtitle,
  accent = 'slate',
  children,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  accent?: 'slate' | 'oker';
  children: ReactNode;
}) {
  // Strakke neutrale panelen — accent/iconBg blijven voor API-compat, maar
  // de chip is nu soft-tint per accent. Achtergrond via CSS-vars (dark-proof).
  void iconBg;
  const chip = accent === 'oker'
    ? 'bg-oker-500/15 text-oker-600 dark:text-oker-400'
    : 'bg-slate-500/12 text-slate-600 dark:text-slate-300';
  return (
    <div
      className="glow-top rounded-3xl p-5 relative overflow-hidden"
      style={{
        background: 'var(--tile-bg)',
        border: 'var(--tile-border)',
        boxShadow: 'var(--tile-shadow)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${chip}`}>
            {icon}
          </div>
          <h3 className="text-[13.5px] font-bold text-slate-900 tracking-tight">{title}</h3>
        </div>
        {subtitle && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyTile({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8">
      <div className="w-12 h-12 rounded-2xl bg-white ring-1 ring-slate-200/60 flex items-center justify-center text-slate-300 mb-3 shadow-sm">
        {icon}
      </div>
      <p className="text-sm font-bold text-slate-700">{title}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">{subtitle}</p>
    </div>
  );
}
