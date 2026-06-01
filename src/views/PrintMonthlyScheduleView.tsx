import { useEffect, useMemo } from 'react';
import type { Shift, User } from '../types';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];

const WEEKDAY_FULL = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

// ISO weeknummer (Europees: ma=1, week 1 bevat 4 januari).
const isoWeekNumber = (d: Date) => {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
};

// Categoriseer dienst op basis van starttijd voor visuele groepering.
// Ochtend: voor 09:00 — Middag: 09:00–14:59 — Avond: 15:00+
const shiftCategory = (startTime: string): 'ochtend' | 'middag' | 'avond' => {
  const h = parseInt(startTime.split(':')[0] || '0', 10);
  if (h < 9) return 'ochtend';
  if (h < 15) return 'middag';
  return 'avond';
};

const CATEGORY_LABEL: Record<string, string> = {
  ochtend: 'Vroeg',
  middag: 'Middag',
  avond: 'Laat',
};

const minutesBetween = (start: string, end: string) => {
  const s = start.split(':').map(Number);
  const e = end.split(':').map(Number);
  if (s.length < 2 || e.length < 2) return 0;
  return Math.max(0, e[0] * 60 + e[1] - s[0] * 60 - s[1]);
};

const formatHours = (totalMinutes: number) => {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}u${m > 0 ? ` ${m}m` : ''}`;
};

/**
 * Print-friendly maandrooster voor één chauffeur. Wordt geopend in een
 * nieuw tabblad via query-params en triggert automatisch window.print().
 * Layout is geoptimaliseerd voor A4: weekgroepering, weektotalen,
 * categorie-badge per dienst, footer met handtekeningstrook.
 */
export function PrintMonthlyScheduleView({
  driver,
  monthIso, // 'YYYY-MM'
  shifts,
}: {
  driver: User | null;
  monthIso: string;
  shifts: Shift[];
}) {
  useEffect(() => {
    // Layout-render-tijd geven aan de browser voor we de print-dialoog
    // openen.
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, []);

  const [yearStr, monthStr] = monthIso.split('-');
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const monthName = MONTH_NAMES[monthIndex] || monthStr;

  const monthShifts = useMemo(() => {
    if (!driver) return [];
    return shifts
      .filter((s) => s.driverId === driver.id && s.date.startsWith(`${yearStr}-${monthStr}`))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }, [driver, shifts, yearStr, monthStr]);

  // Groepeer per datum (multi-segment) en daarna per ISO-week.
  const weeks = useMemo(() => {
    const byDate = new Map<string, Shift[]>();
    for (const s of monthShifts) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date)!.push(s);
    }
    type WeekGroup = {
      weekNumber: number;
      days: Array<{ date: string; shifts: Shift[]; minutes: number }>;
      totalMinutes: number;
      totalDays: number;
    };
    const weekMap = new Map<number, WeekGroup>();
    for (const [date, dayShifts] of byDate.entries()) {
      const d = new Date(`${date}T00:00:00`);
      const week = isoWeekNumber(d);
      const dayMinutes = dayShifts.reduce((sum, s) => sum + minutesBetween(s.startTime, s.endTime), 0);
      let group = weekMap.get(week);
      if (!group) {
        group = { weekNumber: week, days: [], totalMinutes: 0, totalDays: 0 };
        weekMap.set(week, group);
      }
      group.days.push({ date, shifts: dayShifts, minutes: dayMinutes });
      group.totalMinutes += dayMinutes;
      group.totalDays += 1;
    }
    // Sorteren op weeknummer, dagen sorteren op datum
    return Array.from(weekMap.values())
      .sort((a, b) => a.weekNumber - b.weekNumber)
      .map((w) => ({ ...w, days: w.days.sort((a, b) => a.date.localeCompare(b.date)) }));
  }, [monthShifts]);

  const totalMinutes = monthShifts.reduce((sum, s) => sum + minutesBetween(s.startTime, s.endTime), 0);
  const totalDaysWorked = new Set(monthShifts.map((s) => s.date)).size;

  if (!driver) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-700 font-bold p-8">
        Chauffeur niet gevonden. Sluit dit tabblad.
      </div>
    );
  }

  const getServiceNumber = (s: Shift) => String(s.line || '--').trim() || '--';

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 14mm 18mm; }
          body { background: white; }
          .no-print { display: none !important; }
          .print-card, .print-week { break-inside: avoid; page-break-inside: avoid; }
          .print-week + .print-week { margin-top: 8mm; }
          .print-keep-with-next { break-after: avoid; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto p-8 md:p-10">
        <div className="no-print flex justify-end mb-4">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            Print / Opslaan als PDF
          </button>
        </div>

        {/* Header */}
        <header className="border-b-2 border-slate-900 pb-5 mb-7">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-oker-600">
                VHB · Maaltegem · Maandrooster
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">{driver.name}</h1>
              <p className="mt-1 text-xl font-bold text-slate-700">{monthName} {year}</p>
              {driver.employeeId && (
                <p className="mt-2 text-xs font-medium text-slate-400">
                  Personeelsnummer: {driver.employeeId}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="inline-flex flex-col items-end gap-1.5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Diensten</p>
                  <p className="mt-1 text-2xl font-black text-slate-900 tabular-nums">{monthShifts.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Totaal uren</p>
                  <p className="mt-1 text-2xl font-black text-slate-900 tabular-nums">{formatHours(totalMinutes)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Werkdagen</p>
                  <p className="mt-1 text-2xl font-black text-slate-900 tabular-nums">{totalDaysWorked}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {monthShifts.length === 0 ? (
          <p className="text-center py-16 text-slate-400 italic">
            Geen diensten geregistreerd in {monthName} {year}.
          </p>
        ) : (
          <div className="space-y-5">
            {weeks.map((week) => (
              <section key={week.weekNumber} className="print-week">
                {/* Week-header */}
                <div className="print-keep-with-next flex items-center justify-between gap-3 mb-2 pb-1.5 border-b border-slate-300">
                  <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">
                    Week {week.weekNumber}
                  </h2>
                  <div className="flex items-center gap-3 text-[11px] font-bold text-slate-500">
                    <span>{week.totalDays} {week.totalDays === 1 ? 'dag' : 'dagen'}</span>
                    <span className="inline-block h-3 w-px bg-slate-300" />
                    <span className="tabular-nums">{formatHours(week.totalMinutes)}</span>
                  </div>
                </div>

                {/* Dagen */}
                <div className="space-y-2">
                  {week.days.map(({ date, shifts: dayShifts, minutes }) => {
                    const d = new Date(`${date}T00:00:00`);
                    const dayName = WEEKDAY_FULL[d.getDay()];
                    const dayLabel = d.toLocaleDateString('nl-BE', { day: '2-digit', month: 'long' });
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                    return (
                      <div
                        key={date}
                        className={`print-card grid grid-cols-[6rem_minmax(0,1fr)_4.5rem] items-start gap-4 rounded-lg border border-slate-200 px-4 py-3 ${
                          isWeekend ? 'bg-slate-50' : ''
                        }`}
                      >
                        {/* Datum */}
                        <div>
                          <p className={`text-xs font-black uppercase tracking-widest ${isWeekend ? 'text-oker-600' : 'text-slate-400'}`}>
                            {dayName.slice(0, 3)}
                          </p>
                          <p className="mt-0.5 text-sm font-black text-slate-900 tabular-nums">{dayLabel}</p>
                        </div>

                        {/* Diensten */}
                        <div className="space-y-1">
                          {dayShifts.map((s, i) => {
                            const cat = shiftCategory(s.startTime);
                            const catColors = {
                              ochtend: 'border-amber-200 bg-amber-50 text-amber-700',
                              middag: 'border-emerald-200 bg-emerald-50 text-emerald-700',
                              avond: 'border-slate-300 bg-slate-100 text-slate-700',
                            }[cat];

                            return (
                              <div key={i} className="flex items-baseline justify-between gap-3">
                                <div className="flex items-baseline gap-2 min-w-0">
                                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${catColors}`}>
                                    {CATEGORY_LABEL[cat]}
                                  </span>
                                  <span className="text-sm font-black text-slate-900">
                                    Dienst {getServiceNumber(s)}
                                  </span>
                                </div>
                                <span className="text-sm font-mono font-bold text-slate-700 tabular-nums whitespace-nowrap">
                                  {s.startTime} – {s.endTime}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Dagtotaal */}
                        <div className="text-right">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Totaal</p>
                          <p className="mt-0.5 text-sm font-black text-slate-900 tabular-nums">{formatHours(minutes)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Handtekening */}
        {monthShifts.length > 0 && (
          <section className="print-card mt-10 pt-6 border-t border-slate-200">
            <div className="grid grid-cols-2 gap-12">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-8">
                  Voor akkoord — chauffeur
                </p>
                <div className="border-b border-slate-400 h-10" />
                <p className="mt-1 text-[10px] font-medium text-slate-400">Datum en handtekening</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-8">
                  Voor akkoord — planner
                </p>
                <div className="border-b border-slate-400 h-10" />
                <p className="mt-1 text-[10px] font-medium text-slate-400">Datum en handtekening</p>
              </div>
            </div>
          </section>
        )}

        <footer className="mt-10 pt-4 border-t border-slate-200 text-[10px] font-medium text-slate-400 text-center">
          Gegenereerd op {new Date().toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })} via VHB Portaal
        </footer>
      </div>
    </div>
  );
}
