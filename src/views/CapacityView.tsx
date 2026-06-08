import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Bus, Plane, Check } from 'lucide-react';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';
import {
  fetchAvailability,
  conflictIds,
  isoDate,
  addDays,
  mondayOf,
  type AvailabilityResponse,
  type AvailabilityDay,
} from '../lib/availability';

const WEEKDAYS = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];

const formatDayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const jsDay = d.getDay();
  const weekdayIdx = jsDay === 0 ? 6 : jsDay - 1;
  return {
    weekday: WEEKDAYS[weekdayIdx],
    short: d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }),
  };
};

/**
 * Bezettingsoverzicht — per dag wie er rijdt, op verlof staat of vrij is.
 * Zichtbaar voor iedereen zodat het makkelijker is om een dienstruil te
 * regelen ("wie kan deze dag overnemen?"). Data komt van /api/availability.
 */
export function CapacityView() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const from = isoDate(weekStart);
  const to = isoDate(addDays(weekStart, 6));
  const todayIso = isoDate(new Date());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAvailability(from, to)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon beschikbaarheid niet laden.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const nameById = useMemo(
    () => new Map((data?.drivers ?? []).map((d) => [d.id, d.name])),
    [data],
  );
  const names = (ids: string[]) =>
    ids.map((id) => nameById.get(id) || 'Onbekend').sort((a, b) => a.localeCompare(b));

  const goPrev = () => setWeekStart((w) => addDays(w, -7));
  const goNext = () => setWeekStart((w) => addDays(w, 7));
  const goToday = () => setWeekStart(mondayOf(new Date()));

  const weekLabel = `${new Date(`${from}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} – ${new Date(`${to}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}`;

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Bezetting"
        description="Wie rijdt, wie is met verlof en wie is vrij — handig om een dienstruil te regelen."
        actions={(
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrev} aria-label="Vorige week" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center transition-colors">
              <ChevronLeft size={18} />
            </button>
            <span className="px-2 text-sm font-black tracking-tight min-w-[130px] text-center">{weekLabel}</span>
            <button type="button" onClick={goNext} aria-label="Volgende week" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center transition-colors">
              <ChevronRight size={18} />
            </button>
            <button type="button" onClick={goToday} className="ios-pressable ml-1 px-3 h-9 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors">
              Deze week
            </button>
          </div>
        )}
      />

      {error ? (
        <div className="surface-card p-8 rounded-[28px] text-center">
          <p className="text-sm font-bold text-red-500">{error}</p>
        </div>
      ) : loading ? (
        <div className="surface-card p-8 rounded-[28px] flex items-center justify-center min-h-[200px]">
          <div className="flex items-center gap-3 text-slate-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
            <span className="text-sm font-bold">Bezetting laden...</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.days ?? []).map((day) => {
            const label = formatDayLabel(day.date);
            const conflicts = conflictIds(day);
            const isToday = day.date === todayIso;
            const isOpen = expandedDate === day.date;
            return (
              <div key={day.date} className={cn('surface-card rounded-[22px] overflow-hidden', isToday && 'ring-2 ring-oker-400/40')}>
                <button
                  type="button"
                  onClick={() => setExpandedDate(isOpen ? null : day.date)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50/50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-800 tracking-tight">{label.weekday}</span>
                      {isToday && <span className="text-[9px] font-black uppercase tracking-widest text-oker-600">Vandaag</span>}
                      {conflicts.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-600 ring-1 ring-red-100">
                          <AlertTriangle size={10} /> {conflicts.length} conflict{conflicts.length > 1 ? 'en' : ''}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label.short}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Stat icon={<Bus size={13} />} value={day.working.length} tone="slate" label="rijdt" />
                    <Stat icon={<Plane size={13} />} value={day.leave.length} tone="amber" label="verlof" />
                    <Stat icon={<Check size={13} />} value={day.free.length} tone="emerald" label="vrij" />
                    <ChevronRight size={16} className={cn('text-slate-300 transition-transform', isOpen && 'rotate-90')} />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 px-5 py-4 grid gap-4 sm:grid-cols-3">
                    <NameList title="Rijdt" tone="slate" people={names(day.working)} highlight={new Set(conflicts.map((id) => nameById.get(id) || ''))} />
                    <NameList title="Met verlof" tone="amber" people={names(day.leave)} />
                    <NameList title="Vrij" tone="emerald" people={names(day.free)} />
                  </div>
                )}
              </div>
            );
          })}
          {(!data || data.days.length === 0) && (
            <div className="surface-card p-8 rounded-[22px] text-center">
              <p className="text-sm font-bold text-slate-400">Geen gegevens voor deze week.</p>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Stat({ icon, value, tone, label }: { icon: ReactNode; value: number; tone: 'slate' | 'amber' | 'emerald'; label: string }) {
  const toneCls = {
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black tabular-nums', toneCls)} title={label}>
      {icon}
      {value}
    </span>
  );
}

function NameList({ title, tone, people, highlight }: { title: string; tone: 'slate' | 'amber' | 'emerald'; people: string[]; highlight?: Set<string> }) {
  const dot = { slate: 'bg-slate-400', amber: 'bg-amber-500', emerald: 'bg-emerald-500' }[tone];
  return (
    <div>
      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">{title} · {people.length}</p>
      {people.length === 0 ? (
        <p className="text-xs italic text-slate-300">—</p>
      ) : (
        <ul className="space-y-1">
          {people.map((name) => (
            <li key={name} className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot)} />
              <span className="truncate">{name}</span>
              {highlight?.has(name) && <AlertTriangle size={11} className="text-red-500 shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
