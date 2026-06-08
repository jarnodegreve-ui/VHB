import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';
import {
  fetchAvailability,
  isoDate,
  type AvailabilityResponse,
} from '../lib/availability';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];
const WEEKDAY_LETTERS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];

type CellKind = 'dienst' | 'verlof' | 'vrij';

/**
 * Maandrooster — wie rijdt welke dienst, wie heeft verlof, wie is vrij.
 * Zichtbaar voor iedereen zodat collega's wissels kunnen vinden. Toont per
 * chauffeur per dag het dienstnummer ('V' bij verlof, leeg bij vrij).
 * Data komt van /api/availability (server berekent het, minimale payload).
 */
export function CapacityView() {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const from = isoDate(new Date(year, monthIndex, 1));
  const to = isoDate(new Date(year, monthIndex, daysInMonth));
  const todayIso = isoDate(new Date());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAvailability(from, to)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon het rooster niet laden.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const goPrev = () => setViewMonth(new Date(year, monthIndex - 1, 1));
  const goNext = () => setViewMonth(new Date(year, monthIndex + 1, 1));
  const goToday = () => { const n = new Date(); setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1)); };

  const drivers = data?.drivers ?? [];

  // Lookup: driverId -> dagnummer -> cel
  const cellByDriverDay = useMemo(() => {
    type Cell = { kind: CellKind; label: string };
    const map = new Map<string, Map<number, Cell>>();
    if (!data) return map;
    const ensure = (id: string): Map<number, Cell> => {
      let m = map.get(id);
      if (!m) { m = new Map<number, Cell>(); map.set(id, m); }
      return m;
    };
    for (const day of data.days) {
      const dayNum = parseInt(day.date.slice(-2), 10);
      for (const [id, label] of Object.entries<string>(day.lines)) {
        ensure(id).set(dayNum, { kind: 'dienst', label });
      }
      for (const id of day.leave) {
        const m = ensure(id);
        // Verlof én dienst dezelfde dag = conflict; toon dan beide-markering.
        const existing = m.get(dayNum);
        m.set(dayNum, existing ? { kind: 'dienst', label: `${existing.label}⚠` } : { kind: 'verlof', label: 'V' });
      }
    }
    return map;
  }, [data]);

  const dateIso = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const isWeekend = (day: number) => {
    const jsDay = new Date(year, monthIndex, day).getDay();
    return jsDay === 0 || jsDay === 6;
  };
  const weekdayLetter = (day: number) => {
    const jsDay = new Date(year, monthIndex, day).getDay();
    return WEEKDAY_LETTERS[jsDay === 0 ? 6 : jsDay - 1];
  };
  const isToday = (day: number) => dateIso(day) === todayIso;

  const cellClasses = (kind: CellKind | undefined) => {
    if (kind === 'dienst') return 'bg-oker-50 text-oker-700';
    if (kind === 'verlof') return 'bg-amber-100 text-amber-700';
    return '';
  };

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Maandrooster"
        description="Wie rijdt welke dienst, wie heeft verlof — handig om een wissel te vinden."
        actions={(
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrev} aria-label="Vorige maand" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center transition-colors">
              <ChevronLeft size={18} />
            </button>
            <span className="px-3 text-base font-black tracking-tight capitalize min-w-[150px] text-center">{MONTH_NAMES[monthIndex]} {year}</span>
            <button type="button" onClick={goNext} aria-label="Volgende maand" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center transition-colors">
              <ChevronRight size={18} />
            </button>
            <button type="button" onClick={goToday} className="ios-pressable ml-1 px-3 h-9 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors">
              Deze maand
            </button>
          </div>
        )}
      />

      {error ? (
        <div className="surface-card p-8 rounded-[28px] text-center"><p className="text-sm font-bold text-red-500">{error}</p></div>
      ) : loading ? (
        <div className="surface-card p-8 rounded-[28px] flex items-center justify-center min-h-[200px]">
          <div className="flex items-center gap-3 text-slate-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
            <span className="text-sm font-bold">Rooster laden...</span>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop: volledige maandgrid. */}
          <div className="hidden md:block surface-card rounded-[24px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    <th className="sticky left-0 z-10 bg-slate-50/95 backdrop-blur px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 min-w-[170px]">Chauffeur</th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                      <th key={day} className={cn('px-1 py-2 text-center font-medium border-l border-slate-100', isWeekend(day) && 'bg-slate-100/50', isToday(day) && 'bg-oker-50')}>
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{weekdayLetter(day)}</div>
                        <div className={cn('text-xs font-black mt-0.5', isToday(day) ? 'text-oker-700' : 'text-slate-700')}>{day}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((drv) => {
                    const row = cellByDriverDay.get(drv.id);
                    return (
                      <tr key={drv.id} className="border-b border-slate-100 hover:bg-slate-50/40 transition-colors">
                        <td className="sticky left-0 z-10 bg-white/95 backdrop-blur px-4 py-2 text-sm font-bold text-slate-800 min-w-[170px] truncate">{drv.name}</td>
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                          const cell = row?.get(day);
                          return (
                            <td key={day} className={cn('border-l border-slate-100 h-9 px-0.5 text-center', isWeekend(day) && !cell && 'bg-slate-50/40', isToday(day) && !cell && 'bg-oker-50/30')}>
                              {cell && (
                                <span className={cn('inline-block min-w-[26px] rounded-md px-1 py-0.5 text-[10px] font-black tabular-nums', cellClasses(cell.kind))} title={cell.kind === 'verlof' ? 'Verlof' : `Dienst ${cell.label}`}>
                                  {cell.label}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {drivers.length === 0 && (
                    <tr><td colSpan={daysInMonth + 1} className="p-8 text-center text-sm italic text-slate-400">Geen chauffeurs gevonden.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: per chauffeur de dienst-dagen + verlof van deze maand. */}
          <div className="md:hidden surface-card rounded-[24px] overflow-hidden divide-y divide-slate-100">
            {drivers.map((drv) => {
              const row = cellByDriverDay.get(drv.id);
              const entries = row ? Array.from(row.entries()).sort((a, b) => a[0] - b[0]) : [];
              const diensten = entries.filter(([, c]) => c.kind === 'dienst');
              const verlof = entries.filter(([, c]) => c.kind === 'verlof').map(([d]) => d);
              return (
                <div key={drv.id} className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-bold text-slate-800 truncate">{drv.name}</div>
                    <div className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">{diensten.length} {diensten.length === 1 ? 'dienst' : 'diensten'}</div>
                  </div>
                  {diensten.length === 0 && verlof.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-300 italic">Geen diensten deze maand.</div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {diensten.map(([day, c]) => (
                        <span key={day} className="inline-flex items-center gap-1 rounded-lg bg-oker-50 px-2 py-1 text-[11px] font-bold text-oker-700">
                          <span className="text-slate-400">{day}</span> {c.label}
                        </span>
                      ))}
                      {verlof.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-700">
                          Verlof: {verlof.join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {drivers.length === 0 && (
              <div className="p-6 text-center text-sm italic text-slate-400">Geen chauffeurs gevonden.</div>
            )}
          </div>

          {/* Legende */}
          <div className="surface-card rounded-[24px] p-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Legende</span>
            <div className="flex items-center gap-2"><span className="inline-block min-w-[22px] rounded-md bg-oker-50 px-1 py-0.5 text-center text-[10px] font-black text-oker-700">4101</span><span className="font-medium text-slate-600">Dienstnummer</span></div>
            <div className="flex items-center gap-2"><span className="inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">V</span><span className="font-medium text-slate-600">Verlof</span></div>
            <div className="flex items-center gap-2"><span className="text-amber-700 font-black">⚠</span><span className="font-medium text-slate-600">Dienst én verlof (conflict)</span></div>
            <div className="flex items-center gap-2"><span className="font-medium text-slate-600">Leeg = vrij</span></div>
          </div>
        </>
      )}
    </PageShell>
  );
}
