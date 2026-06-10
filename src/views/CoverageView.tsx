import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Settings2, AlertTriangle, Check, X, UserCheck } from 'lucide-react';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';
import { Modal } from '../components/Modal';
import { fetchAvailability } from '../lib/availability';
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
  // Klik op een ontbrekende dienst → wie is er vrij die dag?
  const [pick, setPick] = useState<{ date: string; code: string } | null>(null);
  const [freeNames, setFreeNames] = useState<string[] | null>(null);
  const [pickLoading, setPickLoading] = useState(false);
  // Schoolvakantie-periodes (ma–vr binnen een periode = 'vakantie', anders 'schooldag').
  const [vacations, setVacations] = useState<{ from: string; to: string }[]>([]);

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    fetchCoverageConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setDraft(c.expectations || {});
        // "from..to"-strings → bewerkbare {from,to}-rijen.
        setVacations((c.vacations || []).map((s) => {
          const [from, to] = s.split('..');
          return { from: from || '', to: to || from || '' };
        }));
      })
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

  // Vrije chauffeurs ophalen voor de gekozen dag (kandidaten om het gat te vullen).
  useEffect(() => {
    if (!pick) { setFreeNames(null); return; }
    let cancelled = false;
    setPickLoading(true);
    setFreeNames(null);
    fetchAvailability(pick.date, pick.date)
      .then((res) => {
        if (cancelled) return;
        const day = res.days.find((d) => d.date === pick.date);
        const freeSet = new Set(day?.free ?? []);
        setFreeNames(res.drivers.filter((d) => freeSet.has(d.id)).map((d) => d.name).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => { if (!cancelled) setFreeNames([]); })
      .finally(() => { if (!cancelled) setPickLoading(false); });
    return () => { cancelled = true; };
  }, [pick]);

  const toggleService = (dayType: string, svc: string) => {
    setDraft((prev) => {
      const cur = new Set(prev[dayType] || []);
      if (cur.has(svc)) cur.delete(svc); else cur.add(svc);
      return { ...prev, [dayType]: Array.from(cur) };
    });
  };

  const addVacation = () => setVacations((prev) => [...prev, { from: '', to: '' }]);
  const updateVacation = (i: number, field: 'from' | 'to', value: string) =>
    setVacations((prev) => prev.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));
  const removeVacation = (i: number) => setVacations((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Alleen volledig ingevulde periodes; van/tot rechtzetten en serialiseren.
      const serialized = vacations
        .filter((v) => v.from && v.to)
        .map((v) => (v.from <= v.to ? `${v.from}..${v.to}` : `${v.to}..${v.from}`));
      await saveCoverageExpectations(draft, serialized);
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
        title="Openstaande diensten"
        description="Diensten die nog niet ingevuld zijn — per dag, t.o.v. de verwachte diensten per dag-type."
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

          {/* Schoolvakanties — bepalen welke weekdagen 'vakantie' i.p.v. 'schooldag' zijn */}
          {config && (
            <div className="border-t border-slate-100 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black tracking-tight text-slate-900">Schoolvakanties</h3>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">Weekdagen binnen een periode tellen als <span className="font-bold">vakantie</span>, daarbuiten als <span className="font-bold">schooldag</span>. Weekends blijven zaterdag/zondag.</p>
                </div>
                <button type="button" onClick={addVacation} className="ios-pressable shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-colors">
                  + Periode
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {vacations.length === 0 ? (
                  <p className="text-xs font-medium text-slate-400">Nog geen vakantieperiodes ingesteld — elke weekdag telt dan als schooldag.</p>
                ) : (
                  vacations.map((v, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input type="date" value={v.from} onChange={(e) => updateVacation(i, 'from', e.target.value)} aria-label="Van" className="control-input rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                      <span className="text-[11px] font-bold text-slate-400">t/m</span>
                      <input type="date" value={v.to} onChange={(e) => updateVacation(i, 'to', e.target.value)} aria-label="Tot en met" className="control-input rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                      <button type="button" onClick={() => removeVacation(i)} aria-label="Periode verwijderen" className="ios-pressable w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors">
                        <X size={15} />
                      </button>
                    </div>
                  ))
                )}
                <p className="text-[11px] font-medium text-slate-400 pt-1">Vergeet niet op <span className="font-bold">Opslaan</span> te klikken.</p>
              </div>
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
                        <button
                          key={svc}
                          type="button"
                          onClick={() => setPick({ date: d.date, code: svc })}
                          title="Klik om te zien wie vrij is"
                          className="rounded-md bg-red-100 text-red-700 px-1.5 py-0.5 text-[11px] font-black tabular-nums ring-1 ring-red-200 hover:bg-red-200 hover:ring-red-300 transition-colors cursor-pointer"
                        >
                          {svc}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wie is vrij op de gekozen dag? — kandidaten om het gat te vullen */}
      <Modal open={!!pick} onClose={() => setPick(null)} maxWidth="sm">
        {pick && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kandidaten voor dienst {pick.code}</div>
                <h3 className="mt-0.5 text-lg font-black tracking-tight text-slate-900 capitalize">{dayLabel(pick.date)}</h3>
              </div>
              <button type="button" onClick={() => setPick(null)} aria-label="Sluiten" className="ios-pressable shrink-0 w-8 h-8 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50 flex items-center justify-center transition-colors">
                <X size={16} />
              </button>
            </div>

            {pickLoading ? (
              <div className="mt-5 flex items-center gap-3 text-slate-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
                <span className="text-sm font-bold">Beschikbaarheid laden…</span>
              </div>
            ) : !freeNames || freeNames.length === 0 ? (
              <p className="mt-5 text-sm font-medium text-slate-400">Niemand is vrij op deze dag (geen dienst én geen verlof).</p>
            ) : (
              <div className="mt-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600">{freeNames.length} vrij</div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {freeNames.map((name) => (
                    <div key={name} className="flex items-center gap-2 rounded-xl bg-emerald-50/70 ring-1 ring-emerald-100 px-3 py-2">
                      <UserCheck size={15} className="text-emerald-600 shrink-0" />
                      <span className="text-sm font-bold text-slate-800 truncate">{name}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] font-medium text-slate-400">"Vrij" = geen dienst en geen verlof die dag. De planner wijst de dienst toe in de planning.</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
