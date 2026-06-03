import { useMemo, useState } from 'react';
import { Calendar, Clock, Download, ChevronDown } from 'lucide-react';
import type { Shift, User } from '../types';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { BrandEmptyState } from '../components/BrandEmptyState';
import { SkeletonRow } from '../components/Skeleton';
import { cn } from '../lib/ui';

// Categoriseer per starttijd voor visuele kleurcode — zelfde logica als
// de maandprint.
const shiftCategory = (startTime: string): 'ochtend' | 'middag' | 'avond' => {
  const h = parseInt(startTime.split(':')[0] || '0', 10);
  if (h < 9) return 'ochtend';
  if (h < 15) return 'middag';
  return 'avond';
};

const CATEGORY_PILL: Record<string, { label: string; className: string }> = {
  ochtend: { label: 'Vroeg', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  middag: { label: 'Middag', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  avond: { label: 'Laat', className: 'bg-slate-200 text-slate-700 border-slate-300' },
};

type GroupedShift = {
  key: string;
  date: string;
  line: string;
  segments: Shift[];
  earliestStart: string;
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

export function ScheduleView({ user, shifts: allShifts, isInitialLoad = false }: { user: User; shifts: Shift[]; users: User[]; isInitialLoad?: boolean }) {
  const [showPast, setShowPast] = useState(false);

  // Strict eigen diensten; voor het overzicht van alle chauffeurs gaat
  // planner/admin naar Beheer Roosters.
  const myShifts = useMemo(
    () => allShifts.filter((s) => s.driverId === user.id),
    [allShifts, user.id],
  );

  // Groepeer per (datum + dienstnummer) zodat multi-segment diensten
  // (bv. dienst 2304 met 3 blokken) als één kaart met meerdere
  // tijdsvensters tonen i.p.v. drie aparte cards.
  const grouped = useMemo<GroupedShift[]>(() => {
    const byKey = new Map<string, GroupedShift>();
    for (const s of myShifts) {
      const key = `${s.date}__${getServiceNumber(s)}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.segments.push(s);
        if (s.startTime.localeCompare(existing.earliestStart) < 0) {
          existing.earliestStart = s.startTime;
        }
      } else {
        byKey.set(key, {
          key,
          date: s.date,
          line: getServiceNumber(s),
          segments: [s],
          earliestStart: s.startTime,
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
  }, [myShifts]);

  // Splits toekomst / vandaag / verleden — chauffeur wil toekomst zien
  const today = new Date().toISOString().split('T')[0];
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
        title="Mijn Werkrooster"
        description={
          upcoming.length > 0
            ? `${upcoming.length} ${upcoming.length === 1 ? 'aankomende dienst' : 'aankomende diensten'} · klik om de blokken te zien.`
            : 'Overzicht van je komende diensten.'
        }
        actions={
          <button
            onClick={exportToICS}
            className="control-button-soft flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-600 transition-all active:scale-95"
          >
            <Download size={16} className="text-oker-500" />
            Export naar Agenda
          </button>
        }
      />

      {isInitialLoad ? (
        <div className="surface-card rounded-[32px] overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-white/40 last:border-0" />
            </div>
          ))}
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <BrandEmptyState
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
                className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
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
      <div className="hidden md:block surface-table rounded-[32px] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Datum</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Dienst</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tijdsvensters</th>
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
                    'hover:bg-slate-50/50 transition-colors group border-t border-slate-100',
                    isToday && 'bg-oker-50/30',
                  )}
                >
                  <td className="px-6 py-5">
                    <div className="space-y-1">
                      <p className={cn('font-black', isToday ? 'text-oker-700' : 'text-slate-800')}>
                        {formatShiftDate(g.date)}
                      </p>
                      {isToday && (
                        <span className="inline-block rounded-full bg-oker-500/15 text-oker-700 text-[9px] font-black uppercase tracking-widest px-2 py-0.5">
                          Vandaag
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="inline-flex items-center gap-2">
                      <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest', pill.className)}>
                        {pill.label}
                      </span>
                      <span className="font-black text-oker-700 text-lg">{g.line}</span>
                      {g.segments.length > 1 && (
                        <span className="text-[10px] font-bold text-slate-400">
                          ({g.segments.length} blokken)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="space-y-1">
                      {g.segments.map((s, i) => (
                        <div key={i} className="flex items-center gap-3 text-slate-700 font-bold">
                          <Clock size={14} className="text-oker-400 shrink-0" />
                          <span className="tabular-nums">
                            {s.startTime} – {s.endTime}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
              )}
            >
              {/* Datum + dienst-pill */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className={cn('text-xs font-black uppercase tracking-widest', isToday ? 'text-oker-600' : 'text-slate-400')}>
                    {isToday ? 'Vandaag' : formatShortDate(g.date).split(' ')[0]}
                  </p>
                  <p className="text-sm font-black text-slate-900 mt-0.5">
                    {formatShortDate(g.date).split(' ').slice(1).join(' ')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest', pill.className)}>
                    {pill.label}
                  </span>
                  <span className="text-base font-black text-oker-700">{g.line}</span>
                </div>
              </div>

              {/* Segmenten */}
              <div className="space-y-1.5 pl-1">
                {g.segments.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Clock size={12} className="text-slate-400 shrink-0" />
                    <span className="font-mono font-bold text-slate-700 tabular-nums">
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
