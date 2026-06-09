import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Settings2, AlertTriangle, Check } from 'lucide-react';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';
import {
  fetchCoverageConfig,
  fetchCoverageGaps,
  saveCoverageExpectations,
  type CoverageConfig,
  type DayGap,
} from '../lib/coverage';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];

/**
 * Dekking — planner/admin: welke verwachte diensten zijn op een dag niet
 * ingevuld? Verwachte diensten worden per dag-type ingesteld; gaten worden
 * per dag berekend t.o.v. de planning-matrix.
 */
export function CoverageView() {
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [config, setConfig] = useState<CoverageConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [gaps, setGaps] = useState<DayGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(true);

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    fetchCoverageConfig()
      .then((c) => { if (!cancelled) { setConfig(c); setDraft(c.expectations || {}); } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon instellingen niet laden.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCoverageGaps(from, to)
      .then((res) => { if (!cancelled) setGaps(res.days); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon dekking niet berekenen.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const refetchGaps = () => fetchCoverageGaps(from, to).then((res) => setGaps(res.days)).catch(() => {});

  const toggleService = (dayType: string, svc: string) => {
    setDraft((prev) => {
      const cur = new Set(prev[dayType] || []);
      if (cur.has(svc)) cur.delete(svc); else cur.add(svc);
      return { ...prev, [dayType]: Array.from(cur) };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveCoverageExpectations(draft);
      await refetchGaps();
    } catch (e: any) {
      setError(e?.message || 'Opslaan mislukt.');
    } finally {
      setSaving(false);
    }
  };

  const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    try { return d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch { return iso; }
  };

  const totalMissing = useMemo(() => gaps.reduce((sum, d) => sum + d.missing.length, 0), [gaps]);
  const anyExpectations = useMemo(() => Object.values(draft).some((l) => Array.isArray(l) && l.length > 0), [draft]);
  const visibleDays = onlyGaps ? gaps.filter((d) => d.missing.length > 0) : gaps;

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Dekking"
        description="Niet-ingevulde diensten per dag — t.o.v. de verwachte diensten per dag-type."
        actions={(
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))} aria-label="Vorige maand" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center"><ChevronLeft size={18} /></button>
            <span className="px-3 text-sm font-black tracking-tight capitalize min-w-[130px] text-center">{MONTH_NAMES[monthIndex]} {year}</span>
            <button type="button" onClick={() => setViewMonth(new Date(year, monthIndex + 1, 1))} aria-label="Volgende maand" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center"><ChevronRight size={18} /></button>
            <button type="button" onClick={() => setShowConfig((v) => !v)} className={cn('ios-pressable ml-1 inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-colors', showConfig ? 'border-oker-300 bg-oker-50 text-oker-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}>
              <Settings2 size={14} /> Instellen
            </button>
          </div>
        )}
      />

      {error && <div className="surface-card p-4 rounded-[20px] text-sm font-bold text-red-500">{error}</div>}

      {/* Config: verwachte diensten per dag-type */}
      {showConfig && (
        <div className="surface-card rounded-[24px] p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-black tracking-tight text-slate-900">Verwachte diensten per dag-type</h3>
              <p className="text-xs font-medium text-slate-500 mt-0.5">Vink de diensten aan die op dat dag-type horen te draaien. Ontbreekt zo'n dienst op een dag → gat.</p>
            </div>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary ios-pressable px-5 py-2.5 text-xs disabled:opacity-50">
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>

          {!config ? (
            <p className="text-sm font-medium text-slate-400">Laden…</p>
          ) : config.dayTypes.length === 0 ? (
            <p className="text-sm font-medium text-slate-400">Nog geen dag-types gevonden — importeer eerst een planning-matrix.</p>
          ) : config.services.length === 0 ? (
            <p className="text-sm font-medium text-slate-400">Geen diensten in het dienstoverzicht om uit te kiezen.</p>
          ) : (
            <div className="space-y-5">
              {config.dayTypes.map((dt) => {
                const selected = new Set(draft[dt] || []);
                return (
                  <div key={dt}>
                    <div className="flex items-baseline justify-between">
                      <div className="text-[11px] font-black uppercase tracking-widest text-slate-600 capitalize">{dt || '—'}</div>
                      <div className="text-[10px] font-bold text-slate-400">{selected.size} geselecteerd</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {config.services.map((svc) => {
                        const on = selected.has(svc);
                        return (
                          <button
                            key={svc}
                            type="button"
                            onClick={() => toggleService(dt, svc)}
                            className={cn(
                              'rounded-lg px-2 py-1 text-[11px] font-black tabular-nums ring-1 transition-colors',
                              on ? 'bg-oker-100 text-oker-700 ring-oker-300' : 'bg-white text-slate-400 ring-slate-200 hover:text-slate-600 hover:ring-slate-300',
                            )}
                          >
                            {svc}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Gaten-overzicht */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {totalMissing > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-black text-red-600"><AlertTriangle size={15} /> {totalMissing} niet-ingevulde {totalMissing === 1 ? 'dienst' : 'diensten'} deze maand</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-black text-emerald-600"><Check size={15} /> Alle verwachte diensten zijn gedekt</span>
          )}
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} className="accent-oker-500" />
          Alleen dagen met gaten
        </label>
      </div>

      {loading ? (
        <div className="surface-card p-8 rounded-[24px] flex items-center justify-center min-h-[140px]">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
        </div>
      ) : !anyExpectations ? (
        <div className="surface-card p-8 rounded-[24px] text-center">
          <p className="text-sm font-bold text-slate-500">Nog geen verwachte diensten ingesteld.</p>
          <p className="mt-1 text-xs font-medium text-slate-400">Klik op "Instellen" en kies per dag-type welke diensten horen te draaien.</p>
        </div>
      ) : visibleDays.length === 0 ? (
        <div className="surface-card p-8 rounded-[24px] text-center">
          <p className="text-sm font-bold text-emerald-600">Geen gaten in {MONTH_NAMES[monthIndex]} {year}.</p>
        </div>
      ) : (
        <div className="surface-card rounded-[24px] overflow-hidden divide-y divide-slate-100">
          {visibleDays.map((d) => {
            const ok = d.missing.length === 0;
            return (
              <div key={d.date} className={cn('p-4 flex flex-col sm:flex-row sm:items-center gap-3', !ok && 'bg-red-50/40')}>
                <div className="sm:w-44 shrink-0">
                  <div className="text-sm font-black text-slate-800 capitalize">{dayLabel(d.date)}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 capitalize">{d.dayType || '—'}</div>
                </div>
                <div className="shrink-0 sm:w-24">
                  <span className={cn('text-xs font-black tabular-nums', ok ? 'text-emerald-600' : 'text-red-600')}>{d.covered}/{d.expected}</span>
                  <span className="text-[10px] font-bold text-slate-400"> gedekt</span>
                </div>
                <div className="min-w-0 flex-1">
                  {ok ? (
                    <span className="text-xs font-medium text-emerald-600 inline-flex items-center gap-1"><Check size={13} /> volledig gedekt</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {d.missing.map((svc) => (
                        <span key={svc} className="rounded-md bg-red-100 text-red-700 px-1.5 py-0.5 text-[11px] font-black tabular-nums ring-1 ring-red-200">{svc}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
