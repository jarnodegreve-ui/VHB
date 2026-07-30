import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Clock, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../types';
import { isoWeekOf } from '../lib/week';
import { typedagLabel } from '../lib/typedag';
import { leaveDayTint, leaveDot } from '../lib/statusColors';
import { formatLeaveType } from '../lib/format';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../components/primitives';
import { CalendarSubscribeModal } from '../components/CalendarSubscribeModal';
import { SkeletonRow } from '../components/Skeleton';
import { cn, downloadBlob } from '../lib/ui';
import { shiftIdsWithConflict } from '../lib/conflicts';
import { isoDate } from '../lib/availability';
import { shiftCategory } from '../lib/shiftTime';
import { formatSyncedTime } from '../lib/format';
import { buildCalendar, type IcsEvent } from '../lib/ics';

const CATEGORY_PILL: Record<string, { label: string; tone: 'amber' | 'emerald' | 'slate' }> = {
  ochtend: { label: 'Vroeg', tone: 'slate' },
  middag: { label: 'Middag', tone: 'slate' },
  avond: { label: 'Laat', tone: 'slate' },
};

type GroupedShift = {
  key: string;
  date: string;
  line: string;
  segments: Shift[];
  earliestStart: string;
  hasConflict: boolean;
};

const formatShiftDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

const formatShortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

const getServiceNumber = (shift: Shift) => String(shift.line || '--').trim() || '--';

export function ScheduleView({ notes = [], user, shifts: allShifts, leaveRequests = [], isInitialLoad = false, lastSyncedAt = null, onRequestSwap }: { user: User; shifts: Shift[]; users: User[]; notes?: Array<{ date: string; note: string }>; leaveRequests?: LeaveRequest[]; isInitialLoad?: boolean; lastSyncedAt?: number | null; onRequestSwap?: (shiftId: string) => void }) {
  const [showPast, setShowPast] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Lijst of maandgrid — de keuze blijft bewaard (localStorage kan in
  // privacy-modus geblokkeerd zijn, vandaar de try/catch).
  const [weergave, setWeergaveState] = useState<'lijst' | 'maand'>(() => {
    try {
      return window.localStorage.getItem('vhb-rooster-weergave') === 'maand' ? 'maand' : 'lijst';
    } catch {
      return 'lijst';
    }
  });
  const setWeergave = (w: 'lijst' | 'maand') => {
    setWeergaveState(w);
    try { window.localStorage.setItem('vhb-rooster-weergave', w); } catch { /* niet erg */ }
  };

  // Strict eigen diensten; voor het overzicht van alle chauffeurs gaat
  // planner/admin naar Beheer Roosters.
  const myShifts = useMemo(
    () => allShifts.filter((s) => s.driverId === user.id),
    [allShifts, user.id],
  );

  // Set van shift-IDs met een verlofconflict (chauffeur staat ingepland
  // op een dag waarop hij goedgekeurd verlof heeft). Rendert als rode flag.
  const conflictIds = useMemo(
    () => shiftIdsWithConflict(myShifts, leaveRequests),
    [myShifts, leaveRequests],
  );

  // Groepeer per (datum + dienstnummer) zodat multi-segment diensten
  // (bv. dienst 2304 met 3 blokken) als één kaart met meerdere
  // tijdsvensters tonen i.p.v. drie aparte cards.
  const grouped = useMemo<GroupedShift[]>(() => {
    const byKey = new Map<string, GroupedShift>();
    for (const s of myShifts) {
      const key = `${s.date}__${getServiceNumber(s)}`;
      const hasConflict = conflictIds.has(s.id);
      const existing = byKey.get(key);
      if (existing) {
        existing.segments.push(s);
        if (s.startTime.localeCompare(existing.earliestStart) < 0) {
          existing.earliestStart = s.startTime;
        }
        if (hasConflict) existing.hasConflict = true;
      } else {
        byKey.set(key, {
          key,
          date: s.date,
          line: getServiceNumber(s),
          segments: [s],
          earliestStart: s.startTime,
          hasConflict,
        });
      }
    }
    // Sorteer segmenten chronologisch binnen elke groep
    for (const g of byKey.values()) {
      g.segments.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return Array.from(byKey.values()).sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.earliestStart.localeCompare(b.earliestStart),
    );
    // conflictIds zit in de body: zonder deze dep blijven de verlof-conflict-
    // vlaggen stale wanneer alleen leaveRequests (en dus conflictIds) wijzigt.
  }, [myShifts, conflictIds]);

  // Splits toekomst / vandaag / verleden — chauffeur wil toekomst zien.
  // isoDate = lokale tijd; toISOString() gaf in BE 's nachts de UTC-dag
  // (off-by-one), waardoor 'vandaag' soms in 'verleden' belandde.
  const today = isoDate(new Date());
  const upcoming = grouped.filter((g) => g.date >= today);
  const past = grouped.filter((g) => g.date < today).reverse();

  const exportToICS = () => {
    // Gedeelde ICS-builder (src/lib/ics.ts) i.p.v. een eigen kopie: die schrijft
    // floating local time én zet DTEND een dag verder bij een nachtdienst
    // (eind <= start) — de oude handmatige export zette DTEND vóór DTSTART.
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const events: IcsEvent[] = myShifts
      .filter((shift) => shift.startTime && shift.endTime)
      .map((shift) => ({
        uid: `${shift.id}@vhb-portaal.be`,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        summary: `Dienst ${getServiceNumber(shift)}`,
        description: `VHB · ${shift.startTime} - ${shift.endTime}`,
      }));

    const fullCalendar = buildCalendar(events, { calName: `VHB Rooster ${user.name}`, dtstamp });
    const blob = new Blob([fullCalendar], { type: 'text/calendar;charset=utf-8' });
    void downloadBlob(`VHB_Rooster_${user.name.replace(/\s+/g, '_')}.ics`, blob);
  };

  return (
    <PageShell>
      <PageHeader
        title="Mijn rooster"
        description={
          upcoming.length > 0
            ? `${upcoming.length} ${upcoming.length === 1 ? 'aankomende dienst' : 'aankomende diensten'}.`
            : 'Overzicht van je komende diensten.'
        }
        actions={
          <Button
            variant="secondary"
            icon={<CalendarPlus size={16} className="text-oker-500" />}
            onClick={() => setCalendarOpen(true)}
          >
            Aan agenda toevoegen
          </Button>
        }
      />

      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
        {/* Weergave-wissel: lijst (default) of persoonlijk maandgrid */}
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
          {(['lijst', 'maand'] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeergave(w)}
              className={cn(
                'ios-pressable rounded-[10px] px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors',
                weergave === w ? 'bg-oker-500 text-slate-950 shadow-sm shadow-oker-500/30' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {w}
            </button>
          ))}
        </div>
        {lastSyncedAt && (
          <p className="text-[11px] font-medium text-slate-400">Bijgewerkt om {formatSyncedTime(lastSyncedAt)} · sleep omlaag om te verversen</p>
        )}
      </div>

      <CalendarSubscribeModal open={calendarOpen} onClose={() => setCalendarOpen(false)} onDownload={exportToICS} />

      {isInitialLoad ? (
        <div className="surface-card rounded-3xl overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-white/40 last:border-0" />
            </div>
          ))}
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <EmptyState title="Nog geen diensten gepland" message="Zodra de planner het rooster publiceert, verschijnen je diensten hier — je krijgt er een melding van." />
      ) : weergave === 'maand' ? (
        <MonthCalendar
          groups={grouped}
          today={today}
          leaves={leaveRequests.filter((l) => l.userId === user.id)}
          noteFor={(d) => notes.find((n) => n.date === d)?.note}
          onRequestSwap={onRequestSwap}
        />
      ) : (
        <>
          {/* Toekomst */}
          {upcoming.length > 0 && (
            <ShiftList shifts={upcoming} today={today} noteFor={(d) => notes.find((n) => n.date === d)?.note} onRequestSwap={onRequestSwap} />
          )}

          {/* Verleden — collapsed by default */}
          {past.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowPast((v) => !v)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
              >
                <ChevronDown
                  size={14}
                  className={cn('transition-transform', showPast && 'rotate-180')}
                />
                {showPast ? 'Verberg' : 'Toon'} verleden ({past.length})
              </button>
              {showPast && (
                <div className="mt-4 opacity-60">
                  <ShiftList shifts={past} today={today} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

// --- Subcomponent: persoonlijk maandgrid (diensten + verlof + typedagen) ---

const WEEKDAY_HEAD = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

function MonthCalendar({
  groups,
  today,
  leaves,
  noteFor,
  onRequestSwap,
}: {
  groups: GroupedShift[];
  today: string;
  leaves: LeaveRequest[];
  noteFor: (date: string) => string | undefined;
  onRequestSwap?: (shiftId: string) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string>(today);

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthName = viewMonth.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  const dateIso = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Maandag-eerst: JS-zondag (0) wordt kolom 7.
  const leadingBlanks = (new Date(year, monthIndex, 1).getDay() + 6) % 7;

  const groupsByDate = useMemo(() => {
    const map = new Map<string, GroupedShift[]>();
    for (const g of groups) {
      const list = map.get(g.date);
      if (list) list.push(g);
      else map.set(g.date, [g]);
    }
    return map;
  }, [groups]);

  // Verlof per dag; goedgekeurd wint van aangevraagd als beide de dag raken.
  const leaveFor = (iso: string): LeaveRequest | undefined => {
    const hits = leaves.filter(
      (l) => (l.status === 'approved' || l.status === 'pending') && l.startDate <= iso && l.endDate >= iso,
    );
    return hits.find((l) => l.status === 'approved') ?? hits[0];
  };

  const selectedGroups = groupsByDate.get(selected) ?? [];
  const selectedLeave = leaveFor(selected);
  const selectedNote = noteFor(selected);
  const selectedTypedag = typedagLabel(selected);

  return (
    <div className="space-y-4">
      <div className="surface-card rounded-3xl p-4">
        {/* Maandnavigatie */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))}
            aria-label="Vorige maand"
            className="ios-pressable flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold capitalize text-slate-800">{monthName}</span>
          <button
            type="button"
            onClick={() => setViewMonth(new Date(year, monthIndex + 1, 1))}
            aria-label="Volgende maand"
            className="ios-pressable flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Grid */}
        <div className="mt-3 grid grid-cols-7 gap-1">
          {WEEKDAY_HEAD.map((d) => (
            <div key={d} className="py-1 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300">
              {d}
            </div>
          ))}
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const iso = dateIso(day);
            const dayGroups = groupsByDate.get(iso) ?? [];
            const leave = leaveFor(iso);
            const td = typedagLabel(iso);
            const isSelected = iso === selected;
            const isToday = iso === today;
            const conflict = dayGroups.some((g) => g.hasConflict);

            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelected(iso)}
                aria-label={`${iso}${dayGroups.length > 0 ? ', dienst' : ''}${leave ? ', verlof' : ''}`}
                className={cn(
                  'flex min-h-[52px] flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-colors',
                  !isSelected && 'hover:bg-slate-50',
                  isSelected && 'bg-oker-500/15 ring-1 ring-oker-400',
                  !isSelected && isToday && 'ring-1 ring-oker-300',
                  !isSelected && leave && leaveDayTint(leave.status, leave.type),
                )}
              >
                <span className={cn('text-xs font-semibold tabular-nums leading-none', isToday ? 'text-oker-700' : 'text-slate-700')}>
                  {day}
                </span>
                {td && (
                  <span className={cn('text-[8px] font-bold leading-none', td.kort === 'F' ? 'text-oker-600' : 'text-slate-400')} title={td.titel}>
                    {td.kort}
                  </span>
                )}
                {dayGroups.length > 0 ? (
                  <span className={cn('max-w-full truncate text-[9px] font-bold tabular-nums leading-none', conflict ? 'text-red-600' : 'text-oker-700')}>
                    {dayGroups[0].line}
                    {dayGroups.length > 1 && '+'}
                  </span>
                ) : leave ? (
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      leaveDot(leave.status, leave.type),
                    )}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Legende */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[10px] font-medium text-slate-400">
          <span className="inline-flex items-center gap-1.5"><span className="text-[10px] font-bold tabular-nums text-oker-700">2101</span> dienst</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> verlof</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> aangevraagd</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-[9px] font-bold text-oker-600">F</span> feestdag</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-[9px] font-bold text-slate-400">V</span> schoolvakantie</span>
        </div>
      </div>

      {/* Detail van de geselecteerde dag */}
      <div className="surface-card rounded-3xl p-4">
        <MicroLabel className={cn(selected === today && 'text-oker-600')}>
          {selected === today ? 'Vandaag' : `Wk ${isoWeekOf(selected)}`}
        </MicroLabel>
        <p className="mt-0.5 text-sm font-semibold capitalize text-slate-900">{formatShiftDate(selected)}</p>
        {selectedTypedag && (
          <p className={cn('mt-0.5 text-[11px] font-semibold', selectedTypedag.kort === 'F' ? 'text-oker-600' : 'text-slate-400')}>
            {selectedTypedag.titel}
          </p>
        )}

        {selectedLeave && (
          <p
            className={cn(
              'mt-2.5 rounded-xl px-3 py-2 text-xs font-semibold',
              selectedLeave.status === 'pending'
                ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
                : selectedLeave.type === 'ziekte'
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
                  : selectedLeave.type === 'klein_verlet'
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
            )}
          >
            {formatLeaveType(selectedLeave.type)}
            {selectedLeave.status === 'pending' && ' — aangevraagd, wacht op de planner'}
          </p>
        )}

        {selectedGroups.length === 0 && !selectedLeave ? (
          <p className="mt-2.5 text-xs italic text-slate-400">Geen dienst gepland.</p>
        ) : (
          selectedGroups.map((g) => (
            <div key={g.key} className="mt-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold tabular-nums text-oker-700">{g.line}</span>
                {g.hasConflict && (
                  <Badge tone="red" icon={<AlertTriangle size={10} />}>Verlof-conflict</Badge>
                )}
              </div>
              <div className="mt-1.5 space-y-1.5 pl-1">
                {g.segments.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <Clock size={12} className="shrink-0 text-slate-400" />
                    <span className="font-medium tabular-nums text-slate-700">
                      {s.startTime} – {s.endTime}
                    </span>
                    {s.loopnr && (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                        loop {s.loopnr}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {selectedNote && (
          <p className="mt-2.5 rounded-xl bg-oker-500/10 px-3 py-2 text-xs font-medium leading-snug text-oker-800 dark:text-oker-300">
            {selectedNote}
          </p>
        )}

        {onRequestSwap && selected >= today && selectedGroups.length > 0 && !selectedGroups.some((g) => g.hasConflict) && (
          <button
            type="button"
            onClick={() => onRequestSwap(selectedGroups[0].segments[0].id)}
            className="ios-pressable mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ArrowLeftRight size={14} className="text-oker-500" /> Deze dienst ruilen
          </button>
        )}
      </div>
    </div>
  );
}

// --- Subcomponent: gedeelde lijst voor toekomst en verleden ---

function ShiftList({ shifts, today, noteFor, onRequestSwap }: { shifts: GroupedShift[]; today: string; noteFor?: (date: string) => string | undefined; onRequestSwap?: (shiftId: string) => void }) {
  return (
    <>
      {/* Desktop tabel */}
      <TableShell className="hidden md:block">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <Th className="px-6 py-4">Datum</Th>
              <Th className="px-6 py-4">Dienst</Th>
              <Th className="px-6 py-4">Uren</Th>
              {onRequestSwap && <Th className="px-6 py-4 text-right">Actie</Th>}
            </tr>
          </thead>
          <tbody>
            {shifts.map((g) => {
              const isToday = g.date === today;
              const cat = shiftCategory(g.earliestStart);
              const pill = CATEGORY_PILL[cat];

              return (
                <tr
                  key={g.key}
                  className={cn(
                    'hover:bg-slate-50/60 transition-colors group border-t border-slate-100',
                    isToday && 'bg-oker-50/30',
                    g.hasConflict && 'bg-red-50/40 hover:bg-red-50/60',
                  )}
                >
                  <Td className="px-6 py-4">
                    <div className="space-y-1">
                      <p className={cn('font-semibold tabular-nums', isToday ? 'text-oker-700' : 'text-slate-800')}>
                        {formatShiftDate(g.date)} <span className="font-medium text-slate-400">· wk {isoWeekOf(g.date)}</span>
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {isToday && <Badge tone="oker">Vandaag</Badge>}
                        {g.hasConflict && (
                          <span title="Je staat ingepland terwijl je verlof goedgekeurd is. Neem contact op met de planner.">
                            <Badge tone="red" icon={<AlertTriangle size={11} />}>Verlof-conflict</Badge>
                          </span>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td className="px-6 py-4">
                    <div className="inline-flex items-center gap-2">
                      <Badge tone={pill.tone}>{pill.label}</Badge>
                      <span className="text-lg font-semibold text-oker-700 tabular-nums">{g.line}</span>
                      {g.segments.length > 1 && (
                        <span className="text-[11px] font-medium text-slate-400">
                          ({g.segments.length} blokken)
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="px-6 py-4">
                    <div className="space-y-1">
                      {g.segments.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 font-medium text-slate-700">
                          <Clock size={14} className="text-oker-400 shrink-0" />
                          <span className="tabular-nums">
                            {s.startTime} – {s.endTime}
                          </span>
                          {s.loopnr && (
                            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                              loop {s.loopnr}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Td>
                  {onRequestSwap && (
                    <Td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm" icon={<ArrowLeftRight size={14} />} onClick={() => onRequestSwap(g.segments[0].id)}>
                        Ruilen
                      </Button>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>

      {/* Mobile cards — compacter */}
      <div className="md:hidden space-y-3">
        {shifts.map((g) => {
          const isToday = g.date === today;
          const cat = shiftCategory(g.earliestStart);
          const pill = CATEGORY_PILL[cat];

          return (
            <div
              key={g.key}
              className={cn(
                'surface-card rounded-3xl p-4',
                isToday && 'ring-2 ring-oker-300',
                g.hasConflict && 'ring-2 ring-red-300 bg-red-50/30',
              )}
            >
              {/* Datum + dienst-pill */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <MicroLabel className={cn(isToday && 'text-oker-600')}>
                    {isToday ? 'Vandaag' : formatShortDate(g.date).split(' ')[0]} · wk {isoWeekOf(g.date)}
                  </MicroLabel>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {formatShortDate(g.date).split(' ').slice(1).join(' ')}
                  </p>
                  {g.hasConflict && (
                    <div className="mt-1">
                      <Badge tone="red" icon={<AlertTriangle size={10} />}>
                        Verlof-conflict
                      </Badge>
                      <p className="text-[11px] font-medium text-red-600 mt-1">Je hebt hier verlof — bel de planner.</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={pill.tone}>{pill.label}</Badge>
                  <span className="text-base font-semibold text-oker-700 tabular-nums">{g.line}</span>
                </div>
              </div>

              {/* Segmenten */}
              <div className="space-y-1.5 pl-1">
                {g.segments.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <Clock size={12} className="text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-700 tabular-nums">
                      {s.startTime} – {s.endTime}
                    </span>
                    {s.loopnr && (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                        loop {s.loopnr}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {noteFor?.(g.date) && (
                <p className="mt-2.5 rounded-xl bg-oker-500/10 px-3 py-2 text-xs font-medium leading-snug text-oker-800 dark:text-oker-300">
                  {noteFor(g.date)}
                </p>
              )}

              {onRequestSwap && !g.hasConflict && (
                <button
                  type="button"
                  onClick={() => onRequestSwap(g.segments[0].id)}
                  className="ios-pressable mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeftRight size={14} className="text-oker-500" /> Deze dienst ruilen
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
