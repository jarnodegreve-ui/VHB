import { Fragment, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, CalendarDays, Clock, MapPin, Plane, FileText, RefreshCw, Users } from 'lucide-react';
import type { Diversion, LeaveRequest, Shift, User, View } from '../types';
import { getDaypartGreeting } from '../lib/interactive';
import { cn, openPdfInNewTab } from '../lib/ui';
import { formatDateHuman } from '../lib/format';
import { isoDate } from '../lib/availability';
import { hasShiftEnded } from '../lib/shiftTime';
import { verlofBalans } from '../lib/leaveBalance';
import { Skeleton, SkeletonRow, SkeletonTile } from '../components/Skeleton';
import { SlideOver } from '../components/SlideOver';
import { PreviewToggle } from '../components/PreviewToggle';
import { OpsPanel, OpsRow, OpsStat, QuickAction } from '../components/ops';
import { ServiceChip } from '../components/ServiceChip';

/**
 * Chauffeursdashboard — zelfde Operations Center-taal als het planner/admin-
 * scherm (gedeelde bouwstenen uit components/ops), maar met de gegevens van
 * de ingelogde chauffeur: zijn dienst van vandaag, de volgende dienst met
 * dienstnummer/loopnummer, verlofsaldo, omleidingen en snelle acties.
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
  onChangePassword,
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
  /** Opent de wachtwoord-wijzigen-modal (voor de eenmalige welkomstkaart). */
  onChangePassword?: () => void;
}) {
  const [now, setNow] = useState(new Date());
  // Eenmalige welkomstkaart bij de allereerste keer op het dashboard: nieuwe
  // chauffeurs krijgen een tijdelijk wachtwoord van de beheerder en hadden
  // verder geen enkele uitleg. Weggeklikt = weggeklikt (localStorage).
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      return !window.localStorage.getItem(`vhb-welkom-gezien-${user.id}`);
    } catch {
      return false;
    }
  });
  const dismissWelcome = () => {
    setShowWelcome(false);
    try {
      window.localStorage.setItem(`vhb-welkom-gezien-${user.id}`, new Date().toISOString());
    } catch {
      // localStorage geblokkeerd — kaart komt dan gewoon nog eens terug.
    }
  };
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
  // Alle delen van de dienst van vandaag (een gesplitste dienst = meerdere
  // planning-rijen), op starttijd. Al gereden delen blijven staan maar
  // worden gedempt getoond — zo zie je in één oogopslag wat nog komt.
  const todayParts = myShifts
    .filter((s) => s.date === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const todayLines = todayParts.map((p) => ({
    left: `${p.startTime}–${p.endTime}`,
    right: p.loopnr ? `loop ${p.loopnr}` : undefined,
    done: hasShiftEnded(p, now),
  }));
  // Dienstnummers van vandaag, gededupliceerd (meestal één dienst).
  const todayServices = [...new Set(todayParts.map((p) => String(p.line || '').trim()).filter(Boolean))];

  const nextShift = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter((s) => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];

  const newestDiversions = [...diversions].reverse().slice(0, 3);

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

  // Wanneer is de volgende dienst, in dag-taal: chauffeurs denken in
  // "morgen/overmorgen", niet in een aftellend "17u 25m" (verzoek Jarno).
  // Kalenderdag-verschil, dus 's avonds klopt "morgen" ook al is het < 12u.
  const relativeDay = (dateIso: string): string => {
    const diff = Math.round(
      (new Date(`${dateIso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000,
    );
    if (diff <= 0) return 'vandaag';
    if (diff === 1) return 'morgen';
    if (diff === 2) return 'overmorgen';
    return `over ${diff} dagen`;
  };

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

  // Statuspil rechtsboven, zelfde taal als het Operations Center: iets in
  // behandeling (amber) of alles rustig (emerald).
  const pendingLeaveMine = leaveRequests.filter((l) => l.userId === user.id && l.status === 'pending');
  const needsAttention = pendingLeaveMine.length > 0;

  return (
    <div className="space-y-5">
      {/* Admin-preview: zie components/PreviewToggle (staat ook op het
          Operations Center, zodat een admin hem kán aanzetten). */}
      {canPreview && onTogglePreview && <PreviewToggle active={previewActive} onToggle={onTogglePreview} />}

      {/* === Eenmalige welkomstkaart (eerste bezoek) === */}
      {showWelcome && (
        <div className="rounded-2xl border border-oker-200/70 bg-oker-50 p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">Welkom bij het VHB Portaal 👋</h2>
            <p className="mt-1 text-sm font-medium text-slate-600 leading-relaxed">
              Hier vind je je <strong>rooster</strong>, vraag je <strong>verlof</strong> aan, stel je een <strong>dienstruil</strong> voor aan een collega en lees je <strong>omleidingen en updates</strong>. Op je telefoon staan de belangrijkste knoppen onderaan.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {onChangePassword && (
              <button
                type="button"
                onClick={() => { dismissWelcome(); onChangePassword(); }}
                className="btn-primary ios-pressable px-4 py-2.5 text-sm min-h-11"
              >
                Kies eerst je eigen wachtwoord
              </button>
            )}
            <button
              type="button"
              onClick={dismissWelcome}
              className="ios-pressable rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 min-h-11"
            >
              Aan de slag
            </button>
          </div>
          <p className="text-[11px] font-medium text-slate-400">Kreeg je een tijdelijk wachtwoord van de planning? Kies dan nu meteen een eigen wachtwoord.</p>
        </div>
      )}

      {/* === Persoonlijke header === */}
      <div className="flex flex-col gap-3 px-1 pt-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-[-0.02em] text-slate-900">
            {greeting}, <span className="text-oker-600">{firstName}</span>
          </h1>
          <p className="mt-0.5 text-[13px] font-normal text-slate-500">
            {now.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div
          className={cn(
            'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5',
            needsAttention ? 'border-amber-200 bg-amber-50' : 'border-emerald-100 bg-emerald-50',
          )}
        >
          <span className="relative flex h-2 w-2">
            <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', needsAttention ? 'bg-amber-500' : 'bg-emerald-500')} />
            <span className={cn('relative inline-flex h-2 w-2 rounded-full', needsAttention ? 'bg-amber-500' : 'bg-emerald-500')} />
          </span>
          <span className={cn('text-[11px] font-semibold', needsAttention ? 'text-amber-700' : 'text-emerald-700')}>
            {needsAttention
              ? `${pendingLeaveMine.length} aanvraag${pendingLeaveMine.length === 1 ? '' : 'en'} in behandeling`
              : todaysShift ? 'Dienst vandaag' : 'Vrij vandaag'}
          </span>
        </div>
      </div>

      {/* === Status-strip ===
          Zelfde raster als het Operations Center: mobiel 2 kolommen, breed
          6 — de 'volgende dienst' krijgt dubbele breedte omdat daar het
          dienstnummer, de tijden en de loopnummers in passen. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <OpsStat
          icon={<Clock size={16} />}
          className={todayLines.length > 1 ? 'md:col-span-2 xl:col-span-2' : undefined}
          tone={todaysShift ? 'emerald' : 'slate'}
          label="Vandaag"
          // Dienstnummer als kop, de blokken eronder: geen herhaling van
          // dezelfde tijd in groot én klein.
          text={todayParts.length === 0 ? 'Vrij' : todayServices.join(' / ') || todayParts[0].startTime}
          sub={
            todayParts.length === 0
              ? 'geen dienst gepland'
              : todayLines.length > 1
                ? `${todayLines.length} delen · tot ${todayParts[todayParts.length - 1].endTime}`
                : `tot ${todayParts[0].endTime}`
          }
          lines={todayLines}
          onClick={onNavigate ? () => onNavigate('rooster') : undefined}
        />
        {/* Bewust kaal (verzoek Jarno): het dienstnummer volstaat hier,
            de blokken/uren staan in "Komende diensten" en het rooster. */}
        <OpsStat
          icon={<Calendar size={16} />}
          tone={nextShift ? 'oker' : 'slate'}
          label="Volgende dienst"
          text={nextShift ? getServiceNumber(nextShift) : '—'}
          sub={
            nextShift
              ? `${relativeDay(nextShift.date)} · ${new Date(`${nextShift.date}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })}`
              : 'niets ingepland'
          }
          onClick={onNavigate ? () => onNavigate('rooster') : undefined}
        />
        <OpsStat
          icon={<Plane size={16} />}
          tone="blue"
          label="Verlofsaldo"
          value={balans.betaaldResterend}
          suffix={` / ${balans.betaaldBudget}`}
          sub="dagen over"
          onClick={onNavigate ? () => onNavigate('verlof') : undefined}
        />
        <OpsStat
          icon={<CalendarDays size={16} />}
          tone="slate"
          label="Deze maand"
          value={thisMonthShiftCount}
          sub="diensten ingepland"
          onClick={onNavigate ? () => onNavigate('rooster') : undefined}
        />
        <OpsStat
          icon={<MapPin size={16} />}
          tone={diversions.length > 0 ? 'amber' : 'slate'}
          label="Omleidingen"
          value={diversions.length}
          sub={diversions.length === 1 ? 'actieve omleiding' : 'actieve omleidingen'}
          onClick={onNavigate ? () => onNavigate('omleidingen') : undefined}
        />
      </div>

      {/* === Panelen === */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <OpsPanel
          className="lg:col-span-2"
          icon={<Calendar size={15} />}
          title="Komende diensten"
          aside={thisMonthShiftCount > 0 ? `${thisMonthShiftCount} deze maand` : undefined}
          onSeeAll={onNavigate ? () => onNavigate('rooster') : undefined}
          seeAllLabel="Mijn rooster"
        >
          {upcomingShifts.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                <Clock size={16} />
              </span>
              <div>
                <p className="text-[13.5px] font-semibold text-slate-800">Geen komende diensten</p>
                <p className="text-xs font-normal text-slate-500">Er staat op dit moment niets ingepland.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {upcomingShifts.map((shift) => (
                <Fragment key={shift.id}>
                  <OpsRow
                    tone="oker"
                    icon={<Calendar size={15} />}
                    primary={formatShiftDate(shift.date)}
                    secondary={`${shift.startTime}–${shift.endTime}${shift.loopnr ? ` · loop ${shift.loopnr}` : ''}`}
                    trailing={<ServiceChip serviceNumber={getServiceNumber(shift)} tone="oker" />}
                    onClick={() => onNavigate?.('rooster')}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          icon={<MapPin size={15} />}
          title="Omleidingen"
          aside={diversions.length > 0 ? `${diversions.length} actief` : undefined}
          onSeeAll={onNavigate ? () => onNavigate('omleidingen') : undefined}
        >
          {newestDiversions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                <MapPin size={16} />
              </span>
              <div>
                <p className="text-[13.5px] font-semibold text-slate-800">Vrije baan</p>
                <p className="text-xs font-normal text-slate-500">Geen omleidingen op het netwerk.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {newestDiversions.map((div) => (
                <Fragment key={div.id}>
                  <OpsRow
                    tone="amber"
                    icon={<AlertTriangle size={15} />}
                    primary={div.title}
                    secondary={div.description}
                    meta={div.line}
                    onClick={() => setOpenDiversion(div)}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>

      {/* === Snelle acties === */}
      {onNavigate && (
        <div className="grid grid-cols-2 gap-3 xl:grid-flow-col xl:auto-cols-fr">
          <QuickAction icon={<Calendar size={16} />} label="Mijn rooster" sub="Diensten en agenda" onClick={() => onNavigate('rooster')} />
          <QuickAction icon={<Plane size={16} />} label="Verlof aanvragen" sub="Saldo en aanvragen" onClick={() => onNavigate('verlof')} />
          <QuickAction icon={<RefreshCw size={16} />} label="Dienstruil" sub="Ruilen met een collega" onClick={() => onNavigate('ruil-verzoeken')} />
          <QuickAction icon={<FileText size={16} />} label="Ritbladen" sub="Actuele rit-info" onClick={() => onNavigate('ritblaadjes')} />
          <QuickAction icon={<Users size={16} />} label="Maandplanning" sub="Wie rijdt wanneer" onClick={() => onNavigate('bezetting')} />
        </div>
      )}

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
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {lineLabel(openDiversion.line)}
              </span>
            </div>
            <div className="surface-muted rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Periode</p>
              <p className="mt-1.5 text-sm font-semibold text-slate-800 tabular-nums">
                {formatDateHuman(openDiversion.startDate)}
                {openDiversion.endDate ? ` → ${formatDateHuman(openDiversion.endDate)}` : ' → einde onbekend'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Omschrijving</p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-normal leading-relaxed text-slate-700">
                {openDiversion.description}
              </p>
            </div>
            {openDiversion.pdfUrl && (
              <button
                type="button"
                onClick={() => openPdfInNewTab(openDiversion.pdfUrl)}
                className="control-button-soft ios-pressable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all"
              >
                <FileText size={15} />
                Bijlage openen (PDF)
              </button>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}
