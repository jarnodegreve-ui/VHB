import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Settings2, AlertTriangle, Check, X, UserCheck, Plus } from 'lucide-react';
import { cn } from '../lib/ui';
import { Skeleton, SkeletonTile } from '../components/Skeleton';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel } from '../components/primitives';
import { Modal } from '../components/Modal';
import { fetchAvailability } from '../lib/availability';
import { formatShortDay, MONTH_NAMES } from '../lib/format';
import {
  fetchCoverageConfig,
  fetchCoverageGaps,
  saveCoverageConfig,
  type CoverageConfig,
  type CoverageDayType,
  type CoverageOverride,
  type DayGap,
} from '../lib/coverage';
import { normalizeCode } from '../lib/coverageGaps';


// Weergave-volgorde maandag-eerst; dow = JS getUTCDay (0=zondag..6=zaterdag).
const WEEKDAY_ORDER: { dow: number; label: string }[] = [
  { dow: 1, label: 'Maandag' },
  { dow: 2, label: 'Dinsdag' },
  { dow: 3, label: 'Woensdag' },
  { dow: 4, label: 'Donderdag' },
  { dow: 5, label: 'Vrijdag' },
  { dow: 6, label: 'Zaterdag' },
  { dow: 0, label: 'Zondag' },
];

/**
 * Openstaande diensten — planner/admin: welke verwachte diensten zijn op een
 * dag niet ingevuld? De planner beheert zelf de dag-types + hun verwachte
 * diensten, welk dag-type elke weekdag standaard is, en uitzonderingen
 * (datumreeksen die afwijken, bv. schoolvakantie of feestdag).
 */
export function CoverageView() {
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [config, setConfig] = useState<CoverageConfig | null>(null);
  // Bewerkbare config-state.
  const [dayTypes, setDayTypes] = useState<CoverageDayType[]>([]);
  const [weekdays, setWeekdays] = useState<string[]>(['', '', '', '', '', '', '']);
  const [overrides, setOverrides] = useState<CoverageOverride[]>([]);
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
        setDayTypes((c.dayTypes || []).map((dt) => ({ name: dt.name, services: [...(dt.services || [])] })));
        const w = Array.isArray(c.weekdays) && c.weekdays.length === 7 ? c.weekdays : ['', '', '', '', '', '', ''];
        setWeekdays([...w]);
        setOverrides((c.overrides || []).map((o) => ({ ...o })));
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon instellingen niet laden.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCoverageGaps(from, to)
      .then((res) => { if (!cancelled) setGaps(Array.isArray(res?.days) ? res.days : []); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon dekking niet berekenen.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const refetchGaps = () => fetchCoverageGaps(from, to).then((res) => setGaps(Array.isArray(res?.days) ? res.days : [])).catch(() => {});

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

  // --- Dag-types beheren ---
  const dayTypeNames = useMemo(
    () => Array.from(new Set(dayTypes.map((d) => d.name.trim()).filter(Boolean))),
    [dayTypes],
  );

  // Nieuw dag-type bovenaan toevoegen (anders verdwijnt het onder de lange
  // chips-lijsten en lijkt "toevoegen" niets te doen) + naamveld focussen.
  const firstNameRef = useRef<HTMLInputElement | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const addDayType = () => {
    setDayTypes((prev) => [{ name: '', services: [] }, ...prev]);
    setFocusTick((t) => t + 1);
  };
  useEffect(() => {
    if (focusTick === 0) return;
    firstNameRef.current?.focus();
    firstNameRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focusTick]);

  // Hernoemen: verwijzingen in weekdagen + uitzonderingen mee-hernoemen.
  // Per toetsaanslag alléén bij niet-lege namen (oud patroon hernoemde naar
  // '' zodra het veld leeggemaakt werd → mappings definitief kwijt bij
  // leegmaken-en-hertypen). Het anker bij focus + de remap bij blur dekt
  // dat hertyp-scenario af.
  const nameEditAnchorRef = useRef<string | null>(null);
  const remapDayTypeName = (old: string, neu: string) => {
    if (!old || !neu || old === neu) return;
    setWeekdays((prev) => prev.map((x) => (x === old ? neu : x)));
    setOverrides((prev) => prev.map((x) => (x.dayType === old ? { ...x, dayType: neu } : x)));
  };
  const updateDayTypeName = (i: number, name: string) => {
    const old = (dayTypes[i]?.name ?? '').trim();
    const neu = name.trim();
    setDayTypes((prev) => prev.map((dt, idx) => (idx === i ? { ...dt, name } : dt)));
    remapDayTypeName(old, neu);
  };
  const beginDayTypeNameEdit = (i: number) => {
    nameEditAnchorRef.current = (dayTypes[i]?.name ?? '').trim();
  };
  const finishDayTypeNameEdit = (i: number) => {
    const anchor = nameEditAnchorRef.current;
    nameEditAnchorRef.current = null;
    if (anchor) remapDayTypeName(anchor, (dayTypes[i]?.name ?? '').trim());
  };

  const toggleService = (i: number, svc: string) => {
    setDayTypes((prev) => prev.map((dt, idx) => {
      if (idx !== i) return dt;
      const set = new Set(dt.services);
      if (set.has(svc)) set.delete(svc); else set.add(svc);
      return { ...dt, services: Array.from(set) };
    }));
  };

  const removeDayType = (i: number) => {
    const removed = (dayTypes[i]?.name ?? '').trim();
    setDayTypes((prev) => prev.filter((_, idx) => idx !== i));
    if (removed) {
      setWeekdays((prev) => prev.map((x) => (x === removed ? '' : x)));
      setOverrides((prev) => prev.filter((o) => o.dayType !== removed));
    }
  };

  const setWeekday = (dow: number, name: string) =>
    setWeekdays((prev) => prev.map((x, idx) => (idx === dow ? name : x)));

  // --- Uitzonderingen ---
  const addOverride = () => setOverrides((prev) => [...prev, { from: '', to: '', dayType: '' }]);
  const updateOverride = (i: number, field: keyof CoverageOverride, value: string) =>
    setOverrides((prev) => prev.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  const removeOverride = (i: number) => setOverrides((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Dag-types: lege namen weg, dedupe (eerste wint).
      const seen = new Set<string>();
      const cleanDayTypes: CoverageDayType[] = [];
      for (const dt of dayTypes) {
        const name = dt.name.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        cleanDayTypes.push({ name, services: dt.services });
      }
      const validNames = new Set(cleanDayTypes.map((d) => d.name));
      const cleanWeekdays = weekdays.map((w) => (validNames.has(w) ? w : ''));
      const cleanOverrides = overrides
        .filter((o) => o.from && o.to && validNames.has(o.dayType))
        .map((o) => ({ from: o.from, to: o.to, dayType: o.dayType }));
      await saveCoverageConfig({ dayTypes: cleanDayTypes, weekdays: cleanWeekdays, overrides: cleanOverrides });
      await refetchGaps();
    } catch (e: any) {
      setError(e?.message || 'Opslaan is mislukt.');
    } finally {
      setSaving(false);
    }
  };

  const dayLabel = formatShortDay; // gedeelde compacte dag-vorm (datum-consolidatie)

  const totalMissing = useMemo(() => gaps.reduce((sum, d) => sum + d.missing.length, 0), [gaps]);
  const anyExpectations = useMemo(() => dayTypes.some((dt) => dt.services.length > 0), [dayTypes]);
  const visibleDays = onlyGaps ? gaps.filter((d) => d.missing.length > 0) : gaps;

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Openstaande diensten"
        description="Diensten die nog niet ingevuld zijn per dag, t.o.v. de verwachte diensten per dag-type."
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={18} />} aria-label="Vorige maand" onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))} />
            <span className="px-3 text-sm font-bold tracking-tight capitalize min-w-[130px] text-center">{MONTH_NAMES[monthIndex]} {year}</span>
            <Button variant="ghost" size="sm" icon={<ChevronRight size={18} />} aria-label="Volgende maand" onClick={() => setViewMonth(new Date(year, monthIndex + 1, 1))} />
            <Button
              variant="secondary"
              size="sm"
              icon={<Settings2 size={14} />}
              className={cn('ml-1', showConfig && 'bg-oker-50 text-oker-700 hover:text-oker-700')}
              onClick={() => setShowConfig((v) => !v)}
            >
              Instellen
            </Button>
          </div>
        )}
      />

      {error && <div className="surface-card p-4 rounded-2xl text-sm font-semibold text-red-700">{error}</div>}

      {/* === Instellingen === */}
      {showConfig && (
        <div className="surface-card rounded-3xl p-6 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-slate-900">Dekkingsinstellingen</h3>
              <p className="text-xs font-medium text-slate-500 mt-0.5">Beheer je dag-types, de verwachte diensten per type, welk type elke weekdag is, en uitzonderingen.</p>
            </div>
            <Button variant="primary" size="md" className="shrink-0" disabled={saving} onClick={handleSave}>
              {saving ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </div>

          {!config ? (
            <div className="space-y-2.5">
              <Skeleton className="h-9 w-full" rounded="2xl" />
              <Skeleton className="h-9 w-4/5" rounded="2xl" />
              <Skeleton className="h-9 w-3/5" rounded="2xl" />
            </div>
          ) : config.services.length === 0 ? (
            <p className="text-sm font-medium text-slate-400">Geen diensten in het dienstoverzicht om uit te kiezen.</p>
          ) : (
            <>
              {/* 1. Dag-types + verwachte diensten */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <MicroLabel className="text-slate-500">Dag-types &amp; verwachte diensten</MicroLabel>
                  <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={addDayType}>
                    Dag-type
                  </Button>
                </div>
                {dayTypes.length === 0 ? (
                  <p className="text-sm font-medium text-slate-400">Nog geen dag-types. Klik op "Dag-type" om er een toe te voegen (bv. schooldag, vakantie, zaterdag, zondag).</p>
                ) : (
                  <div className="space-y-3">
                    {dayTypes.map((dt, i) => {
                      const selected = new Set(dt.services);
                      return (
                        <div key={i} className="rounded-2xl border border-slate-100 bg-white/60 p-4">
                          <div className="flex items-center gap-2">
                            <input
                              ref={i === 0 ? firstNameRef : undefined}
                              value={dt.name}
                              onChange={(e) => updateDayTypeName(i, e.target.value)}
                              onFocus={() => beginDayTypeNameEdit(i)}
                              onBlur={() => finishDayTypeNameEdit(i)}
                              placeholder="Naam dag-type"
                              aria-label="Naam dag-type"
                              className="control-input flex-1 rounded-xl px-3 py-2 text-sm font-semibold outline-none"
                            />
                            <Badge tone="slate" className="shrink-0 tabular-nums">{dt.services.length} {dt.services.length === 1 ? 'dienst' : 'diensten'}</Badge>
                            <Button variant="ghost" size="sm" icon={<X size={15} />} className="shrink-0 hover:text-red-700 hover:bg-red-50" aria-label="Dag-type verwijderen" onClick={() => removeDayType(i)} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {config.services.map((svc) => {
                              const on = selected.has(svc);
                              return (
                                <button
                                  key={svc}
                                  type="button"
                                  onClick={() => toggleService(i, svc)}
                                  className={cn(
                                    'rounded-lg px-2 py-1 text-[11px] font-semibold tabular-nums ring-1 transition-colors',
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

              {/* 2. Standaard dag-type per weekdag */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div>
                  <MicroLabel className="text-slate-500">Standaard per weekdag</MicroLabel>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">Welk dag-type geldt standaard op elke weekdag (tenzij een uitzondering hieronder).</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {WEEKDAY_ORDER.map(({ dow, label }) => (
                    <div key={dow} className="flex items-center justify-between gap-3 rounded-xl bg-white ring-1 ring-slate-200/60 px-3 py-2">
                      <span className="text-sm font-bold text-slate-700">{label}</span>
                      <select
                        value={weekdays[dow] || ''}
                        onChange={(e) => setWeekday(dow, e.target.value)}
                        aria-label={`Dag-type voor ${label}`}
                        className="control-input rounded-lg px-2 py-1.5 text-sm font-bold outline-none max-w-[55%]"
                      >
                        <option value="">— geen —</option>
                        {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Uitzonderingen */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <MicroLabel className="text-slate-500">Uitzonderingen</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">Een periode die afwijkt van de weekdag-standaard — bv. een schoolvakantie of een feestdag (van = tot voor één dag).</p>
                  </div>
                  <Button variant="secondary" size="sm" icon={<Plus size={13} />} className="shrink-0" onClick={addOverride}>
                    Uitzondering
                  </Button>
                </div>
                {overrides.length === 0 ? (
                  <p className="text-xs font-medium text-slate-400">Geen uitzonderingen — elke dag volgt de weekdag-standaard.</p>
                ) : (
                  <div className="space-y-2">
                    {overrides.map((o, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <input type="date" value={o.from} onChange={(e) => updateOverride(i, 'from', e.target.value)} aria-label="Van" className="control-input rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                        <span className="text-[11px] font-bold text-slate-400">t/m</span>
                        <input type="date" value={o.to} onChange={(e) => updateOverride(i, 'to', e.target.value)} aria-label="Tot en met" className="control-input rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                        <span className="text-slate-400 font-semibold">→</span>
                        <select value={o.dayType} onChange={(e) => updateOverride(i, 'dayType', e.target.value)} aria-label="Dag-type" className="control-input rounded-xl px-2 py-2 text-sm font-bold outline-none">
                          <option value="">— kies type —</option>
                          {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <Button variant="ghost" size="sm" icon={<X size={15} />} className="shrink-0 hover:text-red-700 hover:bg-red-50" aria-label="Uitzondering verwijderen" onClick={() => removeOverride(i)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-[11px] font-medium text-slate-400">Vergeet niet op <span className="font-bold">Opslaan</span> te klikken.</p>
            </>
          )}
        </div>
      )}

      {/* === Gaten-overzicht === */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {totalMissing > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-red-600 tabular-nums"><AlertTriangle size={15} /> {totalMissing} niet-ingevulde {totalMissing === 1 ? 'dienst' : 'diensten'} deze maand</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600"><Check size={15} /> Alle verwachte diensten zijn ingevuld</span>
          )}
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} className="accent-oker-500" />
          Alleen dagen met gaten
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}><SkeletonTile /></div>
          ))}
        </div>
      ) : !anyExpectations ? (
        <EmptyState
          mascotte={false}
          icon={<Settings2 size={28} />}
          title="Nog geen verwachte diensten ingesteld"
          message='Klik op "Instellen" en kies per dag-type welke diensten horen te draaien — daarna ziet dit scherm elke onbemande dienst.'
        />
      ) : visibleDays.length === 0 ? (
        <div className="surface-card p-8 rounded-3xl text-center">
          <p className="text-sm font-bold text-emerald-600">Geen openstaande diensten in {MONTH_NAMES[monthIndex].toLowerCase()} {year}.</p>
        </div>
      ) : (
        <div className="surface-card rounded-3xl overflow-hidden divide-y divide-slate-100">
          {visibleDays.map((d) => {
            const ok = d.missing.length === 0;
            return (
              <div key={d.date} className={cn('p-4 flex flex-col sm:flex-row sm:items-center gap-3', !ok && 'bg-red-50/40')}>
                <div className="sm:w-44 shrink-0">
                  <div className="text-sm font-semibold text-slate-800 capitalize tabular-nums">{dayLabel(d.date)}</div>
                  <div className="mt-1">
                    <Badge tone={d.dayType ? 'oker' : 'slate'} className="capitalize">{d.dayType || '—'}</Badge>
                  </div>
                </div>
                <div className="shrink-0 sm:w-28">
                  <Badge tone={ok ? 'emerald' : 'red'} dot className="tabular-nums">{d.covered}/{d.expected} gedekt</Badge>
                </div>
                <div className="min-w-0 flex-1">
                  {ok ? (
                    <span className="text-xs font-medium text-emerald-600 inline-flex items-center gap-1"><Check size={13} /> volledig gedekt</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {d.missing.map((svc) => {
                        // Gat door een gemelde afwezigheid: toon wie uitviel en
                        // waarom ("4407 · Pascal Duysburgh · ziek"). Een dienst
                        // die nooit toegewezen was, blijft een kale chip.
                        // Vorm: min-h 36px + gap-2 — de oude 20px-chips met
                        // 6px ertussen waren op een telefoon niet raakbaar.
                        // De NAAM truncate't, de REDEN nooit (shrink-0): de
                        // reden was juist de toevoeging. Redenkleur volgt de
                        // statuskleurtaal: ziek rose, verlof/verlet slate —
                        // rood blijft van het gat zelf, niet van de persoon.
                        const info = d.uitval?.[normalizeCode(svc)];
                        return (
                          <button
                            key={svc}
                            type="button"
                            onClick={() => setPick({ date: d.date, code: svc })}
                            title="Klik om te zien wie vrij is"
                            className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg bg-red-100 text-red-800 px-2 py-1 text-[11px] font-semibold ring-1 ring-red-200 hover:bg-red-200 hover:ring-red-300 transition-colors cursor-pointer dark:text-red-300"
                          >
                            <span className="tabular-nums">{svc}</span>
                            {info && (
                              <span className="flex min-w-0 items-baseline gap-1 font-medium">
                                <span className="min-w-0 truncate text-red-700/90 dark:text-red-300/80">· {info.name}</span>
                                <span className={cn('shrink-0', info.reason === 'ziek' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300')}>· {info.reason}</span>
                              </span>
                            )}
                          </button>
                        );
                      })}
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
                <MicroLabel className="tabular-nums">Kandidaten voor dienst {pick.code}</MicroLabel>
                <h3 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 capitalize">{dayLabel(pick.date)}</h3>
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
                <MicroLabel className="text-emerald-600 tabular-nums">{freeNames.length} vrij</MicroLabel>
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
