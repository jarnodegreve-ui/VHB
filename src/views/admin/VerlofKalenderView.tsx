import { Fragment, useState } from 'react';
import { typedagLabel } from '../../lib/typedag';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import type { LeaveRequest, User } from '../../types';
import { leaveSolid } from '../../lib/statusColors';
import { cn, openPdfInNewTab } from '../../lib/ui';
import { isoDate } from '../../lib/availability';
import { PageHeader, PageShell } from '../../components/ui';
import { Button, MicroLabel, TableShell, Td, Th } from '../../components/primitives';
import { MONTH_NAMES, LEAVE_TYPE_LABELS } from '../../lib/format';

const WEEKDAY_LABELS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];


// Kleuren uit de gedeelde statuskleurtaal (src/lib/statusColors.ts) — deze
// view bepaalt alleen nog de vorm (vol kleurvlak).
const cellColor = leaveSolid;

export function VerlofKalenderView({ users, leaveRequests }: { users: User[]; leaveRequests: LeaveRequest[] }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const monthName = MONTH_NAMES[monthIndex];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const todayIso = isoDate(new Date()); // lokale datum (niet UTC → geen dag-verschuiving 's nachts)

  const goToPrev = () => setViewMonth(new Date(year, monthIndex - 1, 1));
  const goToNext = () => setViewMonth(new Date(year, monthIndex + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  // Toon enkel actieve chauffeurs en planners (niet de admin/beheerder).
  const visibleUsers = users
    .filter((u) => u.isActive !== false && u.name.toLowerCase() !== 'beheerder' && (u.role === 'chauffeur' || u.role === 'planner'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const dateIso = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weekdayLetter = (day: number) => {
    const jsDay = new Date(year, monthIndex, day).getDay();
    const mondayIndex = jsDay === 0 ? 6 : jsDay - 1;
    return WEEKDAY_LABELS[mondayIndex];
  };
  const isWeekend = (day: number) => {
    const jsDay = new Date(year, monthIndex, day).getDay();
    return jsDay === 0 || jsDay === 6;
  };
  const isToday = (day: number) => dateIso(day) === todayIso;

  // Nieuw tabblad met het print-jaaroverzicht van deze chauffeur, voor het
  // jaar dat nu in beeld staat (zelfde print-modus-patroon als het
  // maandrooster in ManageSchedulesView).
  const openJaaroverzicht = (userId: string) => {
    // openPdfInNewTab i.p.v. rauwe window.open: in iOS-standalone geeft
    // window.open geregeld null terug — dan deed de knop niets, of belandde je
    // buiten de PWA in Safari zonder weg terug. De helper navigeert in dat
    // geval in hetzelfde venster.
    openPdfInNewTab(
      `${window.location.origin}${window.location.pathname}?print-verlof-driver=${encodeURIComponent(userId)}&print-verlof-jaar=${year}`,
    );
  };

  // Build a lookup: userId -> day-number -> matching leave record (highest priority status)
  const leaveByUserDay = new Map<string, Map<number, LeaveRequest>>();
  const monthStart = dateIso(1);
  const monthEnd = dateIso(daysInMonth);
  const statusPriority: Record<LeaveRequest['status'], number> = {
    approved: 4, pending: 3, cancelled: 2, rejected: 1,
  };
  for (const leave of leaveRequests) {
    if (leave.endDate < monthStart || leave.startDate > monthEnd) continue;
    const start = leave.startDate < monthStart ? monthStart : leave.startDate;
    const end = leave.endDate > monthEnd ? monthEnd : leave.endDate;
    const startDay = parseInt(start.slice(-2), 10);
    const endDay = parseInt(end.slice(-2), 10);
    let userMap = leaveByUserDay.get(leave.userId);
    if (!userMap) {
      userMap = new Map();
      leaveByUserDay.set(leave.userId, userMap);
    }
    for (let d = startDay; d <= endDay; d++) {
      const existing = userMap.get(d);
      if (!existing || statusPriority[leave.status] > statusPriority[existing.status]) {
        userMap.set(d, leave);
      }
    }
  }

  // Aggregeren voor de top-rij: hoeveel afwezigen (approved) per dag
  const absenceCountPerDay: Record<number, number> = {};
  for (const [, userMap] of leaveByUserDay) {
    for (const [day, leave] of userMap) {
      if (leave.status === 'approved') {
        absenceCountPerDay[day] = (absenceCountPerDay[day] || 0) + 1;
      }
    }
  }

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Verlof-kalender"
        description="Maandoverzicht van wie wanneer afwezig is. Eén oogopslag voor capaciteitsplanning."
        actions={(
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm" className="min-h-11 min-w-11 justify-center"
              onClick={goToPrev}
              aria-label="Vorige maand"
              icon={<ChevronLeft size={16} />}
            />
            <span className="px-3 text-base font-semibold tracking-tight capitalize min-w-[150px] text-center text-slate-800">{monthName} {year}</span>
            <Button
              variant="ghost"
              size="sm" className="min-h-11 min-w-11 justify-center"
              onClick={goToNext}
              aria-label="Volgende maand"
              icon={<ChevronRight size={16} />}
            />
            <Button variant="secondary" size="sm" className="ml-1" onClick={goToToday}>
              Vandaag
            </Button>
          </div>
        )}
      />

      {/* Desktop: volle 31-koloms kalender. Op mobile is dit onbruikbaar
          (~6px per dag-cel), dus tonen we hieronder een per-chauffeur
          stacked list. */}
      <TableShell className="hidden md:block">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/60 border-b border-slate-100">
                <Th className="sticky left-0 z-10 bg-surface-soft min-w-[180px]">
                  Chauffeur
                </Th>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                  <Fragment key={day}>
                    <Th
                      title={typedagLabel(dateIso(day))?.titel}
                      className={cn(
                        'px-1 py-2 text-center border-l border-slate-100',
                        isWeekend(day) && 'bg-slate-100/50',
                        isToday(day) && 'bg-oker-50',
                      )}
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{weekdayLetter(day)}</div>
                      <div className={cn('text-xs font-semibold mt-0.5 tabular-nums', isToday(day) ? 'text-oker-700' : 'text-slate-700')}>{day}</div>
                      {typedagLabel(dateIso(day)) && (
                        <div className={cn('text-[10px] font-bold leading-3 mt-0.5', typedagLabel(dateIso(day))!.kort === 'F' ? 'text-oker-600' : 'text-slate-400')}>
                          {typedagLabel(dateIso(day))!.kort}
                        </div>
                      )}
                      {absenceCountPerDay[day] > 0 && (
                        <div className="text-[11px] font-semibold text-emerald-600 mt-0.5 tabular-nums">{absenceCountPerDay[day]}</div>
                      )}
                    </Th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => {
                const userMap = leaveByUserDay.get(u.id);
                return (
                  <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50/40 transition-colors">
                    <Td className="sticky left-0 z-10 bg-surface-white py-2 text-sm font-semibold text-slate-800 min-w-[180px] truncate">
                      <button
                        type="button"
                        onClick={() => openJaaroverzicht(u.id)}
                        title={`Verlof-jaaroverzicht ${year} openen (print)`}
                        className="group inline-flex max-w-full items-center gap-1.5 text-left transition-colors hover:text-oker-700"
                      >
                        <span className="truncate">{u.name}</span>
                        <Printer size={12} className="shrink-0 text-slate-300 transition-colors group-hover:text-oker-500" />
                      </button>
                    </Td>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                      const leave = userMap?.get(day);
                      const title = leave
                        ? `${LEAVE_TYPE_LABELS[leave.type] || leave.type} — ${leave.status} (${leave.startDate}${leave.startDate !== leave.endDate ? ` t/m ${leave.endDate}` : ''})`
                        : undefined;
                      return (
                        <td
                          key={day}
                          title={title}
                          className={cn(
                            'border-l border-slate-100 h-9 px-1',
                            isWeekend(day) && !leave && 'bg-slate-50/40',
                            isToday(day) && !leave && 'bg-oker-50/30',
                          )}
                        >
                          {leave && (
                            <div className={cn('w-full h-6 rounded-md', cellColor(leave.status, leave.type))} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {visibleUsers.length === 0 && (
                <tr><td colSpan={daysInMonth + 1} className="px-4 py-8 text-center text-sm font-medium text-slate-400">Geen actieve chauffeurs gevonden.</td></tr>
              )}
            </tbody>
          </table>
      </TableShell>

      {/* Mobile: per-chauffeur lijst met afwezigheden in deze maand.
          Veel compacter dan een mini-grid; meest relevante info eerst. */}
      <div className="md:hidden surface-card rounded-3xl overflow-hidden divide-y divide-slate-100">
        {visibleUsers.map((u) => {
          const userMap = leaveByUserDay.get(u.id);
          // userMap heeft één entry per dag van een leave — dedup naar
          // unieke leave-aanvragen om die als items te tonen.
          const uniqueLeaves = userMap
            ? Array.from(new Map(Array.from(userMap.values()).map((l) => [l.id, l])).values())
                .sort((a, b) => a.startDate.localeCompare(b.startDate))
            : [];
          return (
            <div key={u.id} className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <button
                  type="button"
                  onClick={() => openJaaroverzicht(u.id)}
                  className="group inline-flex min-w-0 items-center gap-1.5 text-left text-sm font-semibold text-slate-800"
                >
                  <span className="truncate">{u.name}</span>
                  <Printer size={12} className="shrink-0 text-slate-300" />
                </button>
                {uniqueLeaves.length > 0 && (
                  <MicroLabel className="shrink-0">
                    {uniqueLeaves.length} {uniqueLeaves.length === 1 ? 'aanvraag' : 'aanvragen'}
                  </MicroLabel>
                )}
              </div>
              {uniqueLeaves.length === 0 ? (
                <div className="mt-2 text-xs font-medium text-slate-400">Geen afwezigheden deze maand.</div>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {uniqueLeaves.map((leave) => {
                    const startDay = parseInt(leave.startDate.slice(-2), 10);
                    const endDay = parseInt(leave.endDate.slice(-2), 10);
                    const sameMonthAsStart = leave.startDate.startsWith(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
                    const sameMonthAsEnd = leave.endDate.startsWith(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
                    return (
                      <li key={leave.id} className="flex items-center gap-2.5 text-xs">
                        <span className={cn('shrink-0 w-2.5 h-2.5 rounded-full', cellColor(leave.status, leave.type))} />
                        <span className="font-semibold text-slate-700 tabular-nums">
                          {sameMonthAsStart ? startDay : '←'}
                          {leave.startDate !== leave.endDate && ` — ${sameMonthAsEnd ? endDay : '→'}`}
                        </span>
                        <span className="text-slate-500 truncate">
                          {LEAVE_TYPE_LABELS[leave.type] || leave.type}
                          {leave.status === 'pending' && ' · in behandeling'}
                          {leave.status === 'cancelled' && ' · geannuleerd'}
                          {leave.status === 'rejected' && ' · afgewezen'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        {visibleUsers.length === 0 && (
          <div className="p-6 text-center text-sm font-medium text-slate-400">
            Geen actieve chauffeurs gevonden.
          </div>
        )}
      </div>

      {/* Legende */}
      <div className="surface-card rounded-3xl p-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
        <MicroLabel className="text-slate-500">Legende</MicroLabel>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded-sm bg-emerald-500" />
          <span className="font-medium text-slate-600">Betaald verlof goedgekeurd</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded-sm bg-blue-400" />
          <span className="font-medium text-slate-600">Klein verlet goedgekeurd</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded-sm bg-rose-500" />
          <span className="font-medium text-slate-600">Ziekte</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded-sm bg-amber-400" />
          <span className="font-medium text-slate-600">In behandeling</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded-sm bg-slate-300" />
          <span className="font-medium text-slate-600">Geannuleerd</span>
        </div>
      </div>
    </PageShell>
  );
}
