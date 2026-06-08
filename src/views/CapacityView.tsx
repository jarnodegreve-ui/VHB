import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';
import { isoDate } from '../lib/availability';
import { fetchMonthPlanning, type MonthPlanning, type CellKind } from '../lib/monthPlanning';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];
const WEEKDAY_LETTERS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];

const KIND_CLS: Record<CellKind, string> = {
  service: 'bg-oker-50 text-oker-700',
  leave: 'bg-amber-100 text-amber-700',
  absence: 'bg-slate-100 text-slate-600',
  training: 'bg-blue-50 text-blue-700',
  unknown: 'bg-red-50 text-red-600',
};

const KIND_LABEL: Record<CellKind, string> = {
  service: 'Dienst',
  leave: 'Verlof',
  absence: 'Afwezig',
  training: 'Opleiding',
  unknown: 'Onbekende code',
};

/**
 * Maandplanning — read-only weergave van de planning-matrix (chauffeur ×
 * datum met codes), zoals het overzicht dat in het chauffeurslokaal hangt.
 * Zichtbaar voor iedereen zodat collega's wissels kunnen vinden.
 */
export function CapacityView() {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<MonthPlanning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const monthParam = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const todayIso = isoDate(new Date());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchMonthPlanning(monthParam)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon de maandplanning niet laden.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [monthParam]);

  const goPrev = () => setViewMonth(new Date(year, monthIndex - 1, 1));
  const goNext = () => setViewMonth(new Date(year, monthIndex + 1, 1));
  const goToday = () => { const n = new Date(); setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1)); };

  const dates = data?.dates ?? [];
  const drivers = data?.drivers ?? [];
  const cells = data?.cells ?? {};

  const dayHeader = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    const jsDay = d.getDay();
    return { letter: WEEKDAY_LETTERS[jsDay === 0 ? 6 : jsDay - 1], day: d.getDate(), weekend: jsDay === 0 || jsDay === 6 };
  };

  const hasData = dates.length > 0 && drivers.length > 0;

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Maandplanning"
        description="Wie rijdt welke dienst, wie heeft verlof — zoals het overzicht in het chauffeurslokaal."
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
            <span className="text-sm font-bold">Maandplanning laden...</span>
          </div>
        </div>
      ) : !hasData ? (
        <div className="surface-card p-10 rounded-[24px] text-center">
          <p className="text-sm font-bold text-slate-500">Geen planning gevonden voor {MONTH_NAMES[monthIndex]} {year}.</p>
          <p className="mt-1 text-xs font-medium text-slate-400">Zodra de planning voor deze maand geïmporteerd is, verschijnt ze hier.</p>
        </div>
      ) : (
        <>
          {/* Desktop: volledige maandgrid (chauffeur × dag). */}
          <div className="hidden md:block surface-card rounded-[24px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    <th className="sticky left-0 z-10 bg-slate-50/95 backdrop-blur px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 min-w-[170px]">Chauffeur</th>
                    {dates.map((iso) => {
                      const h = dayHeader(iso);
                      const today = iso === todayIso;
                      return (
                        <th key={iso} className={cn('px-1 py-2 text-center font-medium border-l border-slate-100', h.weekend && 'bg-slate-100/50', today && 'bg-oker-50')}>
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{h.letter}</div>
                          <div className={cn('text-xs font-black mt-0.5', today ? 'text-oker-700' : 'text-slate-700')}>{h.day}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((drv) => {
                    const row = cells[drv.id] || {};
                    return (
                      <tr key={drv.id} className="border-b border-slate-100 hover:bg-slate-50/40 transition-colors">
                        <td className="sticky left-0 z-10 bg-white/95 backdrop-blur px-4 py-2 text-sm font-bold text-slate-800 min-w-[170px] truncate">{drv.name}</td>
                        {dates.map((iso) => {
                          const cell = row[iso];
                          const today = iso === todayIso;
                          const weekend = dayHeader(iso).weekend;
                          return (
                            <td key={iso} className={cn('border-l border-slate-100 h-9 px-0.5 text-center', !cell && weekend && 'bg-slate-50/40', !cell && today && 'bg-oker-50/30')}>
                              {cell && (
                                <span className={cn('inline-block min-w-[28px] rounded-md px-1 py-0.5 text-[10px] font-black tabular-nums', KIND_CLS[cell.kind])} title={`${KIND_LABEL[cell.kind]} · ${cell.code}`}>
                                  {cell.code}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: per chauffeur de codes per dag als chips. */}
          <div className="md:hidden surface-card rounded-[24px] overflow-hidden divide-y divide-slate-100">
            {drivers.map((drv) => {
              const row = cells[drv.id] || {};
              const entries = dates.filter((iso) => row[iso]).map((iso) => ({ iso, cell: row[iso] }));
              return (
                <div key={drv.id} className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-bold text-slate-800 truncate">{drv.name}</div>
                    <div className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">{entries.length}</div>
                  </div>
                  {entries.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-300 italic">Niets gepland deze maand.</div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entries.map(({ iso, cell }) => (
                        <span key={iso} className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold', KIND_CLS[cell.kind])}>
                          <span className="opacity-60">{new Date(`${iso}T00:00:00`).getDate()}</span> {cell.code}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legende */}
          <div className="surface-card rounded-[24px] p-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Legende</span>
            {(['service', 'leave', 'absence', 'training', 'unknown'] as CellKind[]).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className={cn('inline-block rounded-md px-1.5 py-0.5 text-[10px] font-black', KIND_CLS[k])}>{k === 'service' ? '4101' : KIND_LABEL[k].slice(0, 3)}</span>
                <span className="font-medium text-slate-600">{KIND_LABEL[k]}</span>
              </div>
            ))}
            <span className="font-medium text-slate-400">Leeg = niets gepland</span>
          </div>
        </>
      )}
    </PageShell>
  );
}
