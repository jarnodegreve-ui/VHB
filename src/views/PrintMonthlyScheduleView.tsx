import { useEffect, useMemo, useState } from 'react';
import type { Shift, User } from '../types';
import { getSupabaseAuthHeaders } from '../lib/ui';
import { isoWeekNumber } from '../lib/week';
import { shiftCategory } from '../lib/shiftTime';
import { MONTH_NAMES } from '../lib/format';


const WEEKDAY_FULL = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

const CATEGORY_LABEL: Record<string, string> = {
  ochtend: 'Vroeg',
  middag: 'Middag',
  avond: 'Laat',
};

export const minutesBetween = (start: string, end: string) => {
  const s = start.split(':').map(Number);
  const e = end.split(':').map(Number);
  if (s.length < 2 || e.length < 2) return 0;
  const startMin = s[0] * 60 + s[1];
  let endMin = e[0] * 60 + e[1];
  // Impliciete nachtdienst (eind ≤ start, bv. 22:00–06:00) = +24u — zelfde
  // regel als buildVevent/isShiftActiveAt. Zonder dit telde de maandprint
  // zo'n dienst als 0 uur en klopte geen enkel urenoverzicht van een
  // nachtchauffeur (controleronde 30/07). Busvak-notatie (26:16) telde al goed.
  if (endMin <= startMin) endMin += 1440;
  return endMin - startMin;
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
  const [absences, setAbsences] = useState<Array<{ date: string; code: string; label: string }>>([]);
  const [ready, setReady] = useState(false);

  // Afwezigheden (alle niet-dienst-codes: BV/ziekte/KV/…) uit de matrix-
  // maandplanning, zodat ze naast de diensten in het rooster verschijnen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (driver) {
        try {
          const res = await fetch(`/api/month-planning?month=${monthIso}`, { headers: await getSupabaseAuthHeaders() });
          if (res.ok && !cancelled) {
            const data = await res.json();
            const cells = (data?.cells?.[driver.id] ?? {}) as Record<string, { code: string; kind: string; label: string }>;
            const abs = Object.entries(cells)
              .filter(([, c]) => c.kind !== 'service' && c.kind !== 'unknown')
              .map(([date, c]) => ({ date, code: c.code, label: c.label }));
            setAbsences(abs);
          }
        } catch { /* zonder afwezigheden verder */ }
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [driver, monthIso]);

  // Print pas nadat de afwezigheden geladen zijn (of de fetch faalde), zodat
  // ze mee in de PDF staan.
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [ready]);

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

  // Groepeer per datum (diensten multi-segment + eventuele afwezigheid) en
  // daarna per ISO-week. Een dag met een afwezigheidscode heeft geen diensten.
  const weeks = useMemo(() => {
    type Day = { date: string; shifts: Shift[]; minutes: number; absence?: { code: string; label: string } };
    const byDate = new Map<string, Day>();
    for (const s of monthShifts) {
      if (!byDate.has(s.date)) byDate.set(s.date, { date: s.date, shifts: [], minutes: 0 });
      byDate.get(s.date)!.shifts.push(s);
    }
    for (const a of absences) {
      if (!a.date.startsWith(`${yearStr}-${monthStr}`)) continue;
      const existing = byDate.get(a.date);
      if (existing) {
        if (existing.shifts.length === 0 && !existing.absence) existing.absence = { code: a.code, label: a.label };
      } else {
        byDate.set(a.date, { date: a.date, shifts: [], minutes: 0, absence: { code: a.code, label: a.label } });
      }
    }
    for (const day of byDate.values()) {
      day.minutes = day.shifts.reduce((sum, s) => sum + minutesBetween(s.startTime, s.endTime), 0);
    }
    type WeekGroup = { weekNumber: number; days: Day[]; totalMinutes: number; totalDays: number };
    // Bucketen op de maandag-DATUM van de week, niet op het kale weeknummer:
    // rond de jaargrens (dec: week 1 van het nieuwe jaar; jan: week 52/53 van
    // het oude) sorteerde het nummer de weekblokken anders in verkeerde
    // volgorde. Het nummer blijft alleen het label.
    const mondayOf = (d: Date) => {
      const copy = new Date(d);
      copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
      return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`;
    };
    const weekMap = new Map<string, WeekGroup>();
    for (const day of byDate.values()) {
      const d = new Date(`${day.date}T00:00:00`);
      const week = isoWeekNumber(d);
      const key = mondayOf(d);
      let group = weekMap.get(key);
      if (!group) {
        group = { weekNumber: week, days: [], totalMinutes: 0, totalDays: 0 };
        weekMap.set(key, group);
      }
      group.days.push(day);
      group.totalMinutes += day.minutes;
      if (day.shifts.length > 0) group.totalDays += 1; // weektotaal telt enkel werkdagen
    }
    return Array.from(weekMap.values())
      .map((w) => ({ ...w, days: w.days.sort((a, b) => a.date.localeCompare(b.date)) }))
      .sort((a, b) => a.days[0].date.localeCompare(b.days[0].date));
  }, [monthShifts, absences, yearStr, monthStr]);

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
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-[0.08em] hover:bg-slate-800 transition-colors"
          >
            Print / Opslaan als PDF
          </button>
        </div>

        {/* Header */}
        <header className="border-b-2 border-slate-900 pb-5 mb-7">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-oker-600">
            VHB · Maldegem · Maandrooster
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight">{driver.name}</h1>
              <p className="mt-1 text-lg font-bold text-slate-600">{monthName} {year}</p>
              {driver.employeeId && (
                <p className="mt-1.5 text-xs font-medium text-slate-400">
                  Personeelsnummer: {driver.employeeId}
                </p>
              )}
            </div>
            {/* Lichte stat-strip: hairline-scheiders, geen kaders */}
            <div className="flex items-stretch divide-x divide-slate-200">
              <div className="pr-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Diensten</p>
                <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{monthShifts.length}</p>
              </div>
              <div className="px-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Totaal uren</p>
                <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{formatHours(totalMinutes)}</p>
              </div>
              <div className="px-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Werkdagen</p>
                <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{totalDaysWorked}</p>
              </div>
              {absences.length > 0 && (
                <div className="pl-5">
                  <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-oker-600">Afwezig</p>
                  <p className="mt-1 text-xl font-black text-oker-600 tabular-nums leading-none">{absences.length}</p>
                </div>
              )}
            </div>
          </div>
        </header>

        {monthShifts.length === 0 && absences.length === 0 ? (
          <p className="text-center py-16 text-slate-400 italic">
            Geen diensten of afwezigheden geregistreerd in {monthName} {year}.
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
                  {week.days.map(({ date, shifts: dayShifts, minutes, absence }) => {
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
                          <p className={`text-xs font-black uppercase tracking-[0.08em] ${isWeekend ? 'text-oker-600' : 'text-slate-400'}`}>
                            {dayName.slice(0, 3)}
                          </p>
                          <p className="mt-0.5 text-sm font-black text-slate-900 tabular-nums">{dayLabel}</p>
                        </div>

                        {/* Diensten of afwezigheid */}
                        <div className="space-y-1">
                          {absence ? (
                            <div className="flex items-baseline gap-2">
                              <span className="inline-block rounded border border-oker-200 bg-oker-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-oker-700">
                                {absence.code.toUpperCase()}
                              </span>
                              <span className="text-sm font-bold text-slate-700">{absence.label}</span>
                            </div>
                          ) : dayShifts.map((s, i) => {
                            const cat = shiftCategory(s.startTime);
                            const catColors = {
                              ochtend: 'border-amber-200 bg-amber-50 text-amber-700',
                              middag: 'border-emerald-200 bg-emerald-50 text-emerald-700',
                              avond: 'border-slate-300 bg-slate-100 text-slate-700',
                            }[cat];

                            return (
                              <div key={i} className="flex items-baseline justify-between gap-3">
                                <div className="flex items-baseline gap-2 min-w-0">
                                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${catColors}`}>
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
                          <p className="text-[9px] font-black uppercase tracking-[0.08em] text-slate-400">Totaal</p>
                          <p className="mt-0.5 text-sm font-black text-slate-900 tabular-nums">{absence ? '—' : formatHours(minutes)}</p>
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
        {(monthShifts.length > 0 || absences.length > 0) && (
          <section className="print-card mt-10 pt-6 border-t border-slate-200">
            <div className="grid grid-cols-2 gap-12">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500 mb-8">
                  Voor akkoord — chauffeur
                </p>
                <div className="border-b border-slate-400 h-10" />
                <p className="mt-1 text-[10px] font-medium text-slate-400">Datum en handtekening</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500 mb-8">
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
