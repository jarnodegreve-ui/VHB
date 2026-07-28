import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Clock, CalendarPlus, ChevronDown } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../types';
import { isoWeekOf } from '../lib/week';
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

export function ScheduleView({ user, shifts: allShifts, leaveRequests = [], isInitialLoad = false, lastSyncedAt = null, onRequestSwap }: { user: User; shifts: Shift[]; users: User[]; leaveRequests?: LeaveRequest[]; isInitialLoad?: boolean; lastSyncedAt?: number | null; onRequestSwap?: (shiftId: string) => void }) {
  const [showPast, setShowPast] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

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
        title="Mijn werkrooster"
        description={
          upcoming.length > 0
            ? `${upcoming.length} ${upcoming.length === 1 ? 'aankomende dienst' : 'aankomende diensten'} · klik om de blokken te zien.`
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

      {lastSyncedAt && (
        <p className="-mt-2 text-[11px] font-medium text-slate-400">Bijgewerkt om {formatSyncedTime(lastSyncedAt)} · sleep omlaag om te verversen</p>
      )}

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
        <EmptyState title="Nog geen diensten gepland" />
      ) : (
        <>
          {/* Toekomst */}
          {upcoming.length > 0 && (
            <ShiftList shifts={upcoming} today={today} onRequestSwap={onRequestSwap} />
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

// --- Subcomponent: gedeelde lijst voor toekomst en verleden ---

function ShiftList({ shifts, today, onRequestSwap }: { shifts: GroupedShift[]; today: string; onRequestSwap?: (shiftId: string) => void }) {
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
