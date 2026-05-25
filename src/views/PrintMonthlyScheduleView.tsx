import { useEffect } from 'react';
import type { Shift, User } from '../types';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];

const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString('nl-BE', { weekday: 'long', day: '2-digit', month: 'long' });
};

/**
 * Print-friendly maandrooster voor één chauffeur. Wordt geopend in een
 * nieuw tabblad via query-params en triggert automatisch window.print().
 * @media print regels zorgen dat enkel de inhoud zichtbaar is.
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
    // Geef de browser tijd om de layout te renderen voor we de print
    // dialoog openen.
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, []);

  if (!driver) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-700 font-bold p-8">
        Chauffeur niet gevonden. Sluit dit tabblad.
      </div>
    );
  }

  const [yearStr, monthStr] = monthIso.split('-');
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const monthName = MONTH_NAMES[monthIndex] || monthStr;

  const monthShifts = shifts
    .filter((s) => s.driverId === driver.id && s.date.startsWith(`${yearStr}-${monthStr}`))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const getServiceNumber = (s: Shift) => String(s.line || '--').trim() || '--';

  // Groepeer per datum (één datum kan meerdere segmenten hebben)
  const byDate = new Map<string, Shift[]>();
  for (const s of monthShifts) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }

  const totalHours = monthShifts.reduce((sum, s) => {
    const start = s.startTime?.split(':').map(Number);
    const end = s.endTime?.split(':').map(Number);
    if (!start || !end || start.length < 2 || end.length < 2) return sum;
    const minutes = (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]);
    return sum + Math.max(0, minutes);
  }, 0);
  const hoursLabel = `${Math.floor(totalHours / 60)}u ${totalHours % 60}m`;

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4; margin: 16mm; }
          body { background: white; }
          .no-print { display: none !important; }
          .print-card { break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto p-10">
        <div className="no-print flex justify-end mb-4">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            Print / Opslaan als PDF
          </button>
        </div>

        <header className="border-b-2 border-slate-900 pb-6 mb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">VHB Portaal · Maandrooster</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{driver.name}</h1>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="text-xl font-bold text-slate-700">{monthName} {year}</p>
            <p className="text-sm font-medium text-slate-500">
              {monthShifts.length} {monthShifts.length === 1 ? 'dienst' : 'diensten'} · {hoursLabel} totaal
            </p>
          </div>
          {driver.employeeId && (
            <p className="mt-2 text-xs font-medium text-slate-400">Personeelsnummer: {driver.employeeId}</p>
          )}
        </header>

        {monthShifts.length === 0 ? (
          <p className="text-center py-12 text-slate-400 italic">Geen diensten geregistreerd in {monthName} {year}.</p>
        ) : (
          <div className="space-y-3">
            {Array.from(byDate.entries()).map(([date, dayShifts]) => (
              <div key={date} className="print-card border border-slate-200 rounded-xl p-4 flex items-start gap-6">
                <div className="w-44 shrink-0">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">{date}</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">{dayLabel(date)}</p>
                </div>
                <div className="flex-1 space-y-2">
                  {dayShifts.map((s, i) => (
                    <div key={i} className="flex items-baseline justify-between">
                      <div className="flex items-baseline gap-3">
                        <span className="text-base font-black text-slate-900">Dienst {getServiceNumber(s)}</span>
                      </div>
                      <span className="text-sm font-mono font-bold text-slate-700">
                        {s.startTime} - {s.endTime}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <footer className="mt-12 pt-6 border-t border-slate-200 text-[10px] font-medium text-slate-400 text-center">
          Gegenereerd op {new Date().toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })} via VHB Portaal
        </footer>
      </div>
    </div>
  );
}
