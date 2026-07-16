import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, CalendarPlus, ChevronDown } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../types';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../components/primitives';
import { CalendarSubscribeModal } from '../components/CalendarSubscribeModal';
import { SkeletonRow } from '../components/Skeleton';
import { cn } from '../lib/ui';
import { shiftIdsWithConflict } from '../lib/conflicts';
import { isoDate } from '../lib/availability';

// Categoriseer per starttijd voor visuele kleurcode — zelfde logica als
// de maandprint.
const shiftCategory = (startTime: string): 'ochtend' | 'middag' | 'avond' => {
  const h = parseInt(startTime.split(':')[0] || '0', 10);
  if (h < 9) return 'ochtend';
  if (h < 15) return 'middag';
  return 'avond';
};

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

export function ScheduleView({ user, shifts: allShifts, leaveRequests = [], isInitialLoad = false }: { user: User; shifts: Shift[]; users: User[]; leaveRequests?: LeaveRequest[]; isInitialLoad?: boolean }) {
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
    const calendarHeader = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VHB Portaal//NL',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ].join('\r\n');

    const calendarFooter = 'END:VCALENDAR';

    const events = myShifts
      .map((shift) => {
        const [year, month, day] = shift.date.split('-').map(Number);
        const [startH, startM] = shift.startTime.split(':').map(Number);
        const [endH, endM] = shift.endTime.split(':').map(Number);

        const startDate = new Date(year, month - 1, day, startH, startM);
        const endDate = new Date(year, month - 1, day, endH, endM);

        const formatICSDate = (date: Date) =>
          date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

        return [
          'BEGIN:VEVENT',
          `UID:${shift.id}@vhb-portaal.be`,
          `DTSTAMP:${formatICSDate(new Date())}`,
          `DTSTART:${formatICSDate(startDate)}`,
          `DTEND:${formatICSDate(endDate)}`,
          `SUMMARY:Dienst ${getServiceNumber(shift)}`,
          `DESCRIPTION:VHB · ${shift.startTime} - ${shift.endTime}`,
          'END:VEVENT',
        ].join('\r\n');
      })
      .join('\r\n');

    const fullCalendar = `${calendarHeader}\r\n${events}\r\n${calendarFooter}`;
    const blob = new Blob([fullCalendar], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', `VHB_Rooster_${user.name.replace(/\s+/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        <EmptyState
          title="Nog geen diensten gepland"
          message="Zodra de planner een nieuwe matrix uploadt, vind je hier al je komende ritten."
        />
      ) : (
        <>
          {/* Toekomst */}
          {upcoming.length > 0 && (
            <ShiftList shifts={upcoming} today={today} />
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

function ShiftList({ shifts, today }: { shifts: GroupedShift[]; today: string }) {
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
                        {formatShiftDate(g.date)}
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
                        <span className="text-[10px] font-medium text-slate-400">
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
                        </div>
                      ))}
                    </div>
                  </Td>
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
                'surface-card rounded-2xl p-4',
                isToday && 'ring-2 ring-oker-300',
                g.hasConflict && 'ring-2 ring-red-300 bg-red-50/30',
              )}
            >
              {/* Datum + dienst-pill */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <MicroLabel className={cn(isToday && 'text-oker-600')}>
                    {isToday ? 'Vandaag' : formatShortDate(g.date).split(' ')[0]}
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
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
