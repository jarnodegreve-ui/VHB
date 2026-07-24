import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { cn } from '../lib/ui';
import { weekRangeLabel } from '../lib/week';
import { PageHeader, PageShell } from '../components/ui';
import { Button, MicroLabel } from '../components/primitives';
import { Modal } from '../components/Modal';
import { isoDate } from '../lib/availability';
import { fetchMonthPlanning, type MonthPlanning, type MonthCell, type CellKind } from '../lib/monthPlanning';
import { KIND_CLS, KIND_LABEL, KIND_TEXT } from '../lib/planningKind';
import type { User } from '../types';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];
const WEEKDAY_LETTERS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];
const WEEKDAY_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/**
 * Maandplanning — read-only weergave van de planning-matrix (chauffeur ×
 * datum met codes), zoals het overzicht dat in het chauffeurslokaal hangt.
 * Zichtbaar voor iedereen zodat collega's wissels kunnen vinden.
 */
export function CapacityView({ currentUser }: { currentUser: User }) {
  const ownId = String(currentUser?.id ?? '');
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<MonthPlanning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ driverName: string; iso: string; cell: MonthCell } | null>(null);
  // Venster van 2 weken binnen de maand; bij de randen springen we naar de
  // vorige/volgende maand. 'pendingEdge' bepaalt waar we landen na het laden.
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingEdge, setPendingEdge] = useState<null | 'first' | 'last' | 'today'>('today');

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

  const dates = data?.dates ?? [];
  const drivers = data?.drivers ?? [];
  const cells = data?.cells ?? {};

  // Staat er ergens een geruilde dienst in deze maand? (voor de legende)
  const hasSwaps = useMemo(
    () => Object.values(cells).some((row) => Object.values(row).some((c) => c.swap)),
    [cells],
  );

  // Maandag van de week (lokaal) → sleutel om dagen per week te bucketen.
  const weekKeyOf = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return isoDate(d);
  };

  // Pagina's van telkens 2 kalenderweken (enkel de geplande dagen erin).
  const WEEKS_PER_PAGE = 2;
  const pages = useMemo(() => {
    if (dates.length === 0) return [] as string[][];
    const byWeek = new Map<string, string[]>();
    for (const iso of dates) {
      const k = weekKeyOf(iso);
      const bucket = byWeek.get(k);
      if (bucket) bucket.push(iso); else byWeek.set(k, [iso]);
    }
    const weekKeys = Array.from(byWeek.keys()).sort();
    const result: string[][] = [];
    for (let i = 0; i < weekKeys.length; i += WEEKS_PER_PAGE) {
      result.push(weekKeys.slice(i, i + WEEKS_PER_PAGE).flatMap((k) => byWeek.get(k)!));
    }
    return result;
  }, [dates]);

  // Na het (her)laden van een maand op de juiste pagina landen.
  useEffect(() => {
    // pendingEdge pas consumeren als de JUISTE maand geladen is — het effect
    // draaide eerder direct na setViewMonth tegen de oude pagina's, waardoor
    // "Vandaag"/maandwissels op het verkeerde 2-weken-venster landden.
    if (pendingEdge && (loading || data?.month !== monthParam)) return;
    if (pages.length === 0) { setPageIndex(0); return; }
    if (pendingEdge === 'last') { setPageIndex(pages.length - 1); setPendingEdge(null); }
    else if (pendingEdge === 'first') { setPageIndex(0); setPendingEdge(null); }
    else if (pendingEdge === 'today') {
      const idx = pages.findIndex((pg) => pg.includes(todayIso));
      setPageIndex(idx >= 0 ? idx : 0);
      setPendingEdge(null);
    } else {
      setPageIndex((p) => Math.min(p, pages.length - 1));
    }
  }, [pages, pendingEdge, todayIso, loading, data?.month, monthParam]);

  const goPrevWindow = () => {
    if (pageIndex > 0) { setPageIndex(pageIndex - 1); return; }
    setPendingEdge('last');
    setViewMonth(new Date(year, monthIndex - 1, 1));
  };
  const goNextWindow = () => {
    if (pageIndex < pages.length - 1) { setPageIndex(pageIndex + 1); return; }
    setPendingEdge('first');
    setViewMonth(new Date(year, monthIndex + 1, 1));
  };
  const goToday = () => {
    const n = new Date();
    setPendingEdge('today');
    setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1));
  };

  const visibleDates = pages[pageIndex] ?? [];

  const formatDayMonth = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    try { return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }); }
    catch { return iso; }
  };
  const windowLabel = visibleDates.length > 0
    ? `${weekRangeLabel(visibleDates)} · ${formatDayMonth(visibleDates[0])} – ${formatDayMonth(visibleDates[visibleDates.length - 1])} ${year}`
    : `${MONTH_NAMES[monthIndex]} ${year}`;

  const dayHeader = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    const jsDay = d.getDay();
    return {
      letter: WEEKDAY_LETTERS[jsDay === 0 ? 6 : jsDay - 1],
      day: d.getDate(),
      weekend: jsDay === 0 || jsDay === 6,
      isMonday: jsDay === 1,
    };
  };

  const formatDateLong = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    try {
      return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch {
      return iso;
    }
  };

  const hasData = dates.length > 0 && drivers.length > 0;

  // Sectie-koppen tonen zodra minstens één chauffeur een sectie heeft (anders
  // gedraagt de lijst zich als voorheen — één alfabetische groep, geen koppen).
  // De API levert 'drivers' al gesorteerd op sectie → naam, dus we hoeven enkel
  // een kop te tonen wanneer de sectie t.o.v. de vorige chauffeur wisselt.
  const showSections = drivers.some((d) => !!d.section);
  const sectionOf = (d: { section?: string | null }) => (d.section || 'Overige');

  // Legende: de codes die in de héle maand voorkomen, elk met hun betekenis.
  // Data-gedreven (geen hardgecodeerde codes) → toont "BV = Verlof", "ziek =
  // Afwezig", "tk = Tijdskrediet"… precies zoals ze geïmporteerd zijn. Betekenis
  // = de omschrijving uit de planningscodes indien ingesteld, anders de categorie.
  const codeLegend = useMemo(() => {
    const map = new Map<string, { code: string; kind: CellKind; meaning: string }>();
    let serviceExample: string | null = null;
    for (const driverId of Object.keys(cells)) {
      const row = cells[driverId];
      for (const iso of Object.keys(row)) {
        const c = row[iso];
        if (c.kind === 'service') {
          if (!serviceExample) serviceExample = c.code;
          continue;
        }
        const key = c.code.trim().toLowerCase();
        if (!key || map.has(key)) continue;
        const hasDesc = !!c.label && c.label.trim().toLowerCase() !== key;
        const meaning = c.kind === 'unknown' || !hasDesc ? KIND_LABEL[c.kind] : c.label;
        map.set(key, { code: c.code, kind: c.kind, meaning });
      }
    }
    const order: CellKind[] = ['leave', 'absence', 'training', 'unknown'];
    const entries = Array.from(map.values()).sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.code.localeCompare(b.code),
    );
    return { serviceExample, entries };
  }, [cells]);

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Maandplanning"
        description="Wie rijdt welke dienst, zoals in het overzicht in het chauffeurslokaal."
        actions={(
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrevWindow} aria-label="Vorige 2 weken" className="ios-pressable w-11 h-11 sm:w-9 sm:h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center transition-colors">
              <ChevronLeft size={18} />
            </button>
            <span className="px-3 text-sm font-semibold tracking-tight capitalize min-w-[150px] text-center tabular-nums">{windowLabel}</span>
            <button type="button" onClick={goNextWindow} aria-label="Volgende 2 weken" className="ios-pressable w-11 h-11 sm:w-9 sm:h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center transition-colors">
              <ChevronRight size={18} />
            </button>
            <Button variant="secondary" size="sm" className="ml-1 h-9 rounded-xl" onClick={goToday}>
              Vandaag
            </Button>
          </div>
        )}
      />

      {error ? (
        <div className="surface-card p-6 rounded-3xl text-center"><p className="text-sm font-semibold text-red-500">{error}</p></div>
      ) : loading ? (
        <div className="surface-card p-6 rounded-3xl flex items-center justify-center min-h-[200px]">
          <div className="flex items-center gap-3 text-slate-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
            <span className="text-sm font-semibold">Maandplanning laden...</span>
          </div>
        </div>
      ) : !hasData ? (
        <div className="surface-card p-6 rounded-3xl text-center">
          <p className="text-sm font-semibold text-slate-500">Geen planning gevonden voor {MONTH_NAMES[monthIndex]} {year}.</p>
          <p className="mt-1 text-xs font-medium text-slate-400">Zodra de planning voor deze maand geïmporteerd is, verschijnt ze hier.</p>
        </div>
      ) : (
        <>
          <style>{`
            .mp-weekend { background-color: rgba(241,245,249,0.85); background-image: repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(100,116,139,0.09) 3px, rgba(100,116,139,0.09) 4px); }
            .dark .mp-weekend { background-color: rgba(255,255,255,0.03); background-image: repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.05) 3px, rgba(255,255,255,0.05) 4px); }
            /* Sticky cellen moeten OPAAK zijn: de generieke dark-overrides van
               bg-white/bg-slate-100/bg-oker-50 zijn alpha-kleuren, waardoor de
               scrollende cellen in dark mode door de vaste naamkolom/koprij
               heen schemerden. */
            /* Alleen de arcering (geen eigen achtergrond) — voor cellen die al
               een band-/vandaag-tint hebben, zoals de sectiekop-rij. */
            .mp-hatch { background-image: repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(100,116,139,0.09) 3px, rgba(100,116,139,0.09) 4px); }
            .dark .mp-hatch { background-image: repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.05) 3px, rgba(255,255,255,0.05) 4px); }
            .dark th.mp-sticky { background-color: rgb(30, 31, 34) !important; }
            .dark td.mp-sticky { background-color: rgb(23, 24, 26) !important; }
            .dark td.mp-sticky-own { background-color: rgb(41, 35, 25) !important; }
          `}</style>
          {/* Desktop: Excel-achtig maandgrid (chauffeur × dag) — dunne gridlijnen,
              platte dienstnummers, gearceerde weekend-kolommen. */}
          <div className="hidden md:block surface-card rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="mp-sticky sticky left-0 top-0 z-30 bg-slate-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 min-w-[180px] border-b-2 border-slate-300 border-r-2 border-slate-300">Chauffeur</th>
                    {visibleDates.map((iso) => {
                      const h = dayHeader(iso);
                      const today = iso === todayIso;
                      return (
                        <th
                          key={iso}
                          className={cn(
                            'sticky top-0 z-20 px-1 py-2 text-center font-medium border-b-2 border-slate-300',
                            h.isMonday ? 'border-l-2 border-l-slate-300' : 'border-l border-slate-200',
                            today ? 'bg-oker-100' : h.weekend ? 'mp-weekend' : 'bg-slate-50',
                          )}
                        >
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{h.letter}</div>
                          <div className={cn('text-xs font-semibold mt-0.5 tabular-nums', today ? 'text-oker-700' : 'text-slate-700')}>{h.day}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((drv, i) => {
                    const row = cells[drv.id] || {};
                    const isOwn = ownId && drv.id === ownId;
                    const rowBg = isOwn ? 'bg-oker-50' : 'bg-white';
                    const section = sectionOf(drv);
                    const showHeader = showSections && (i === 0 || sectionOf(drivers[i - 1]) !== section);
                    return (
                      <Fragment key={drv.id}>
                      {showHeader && (
                        <tr>
                          {/* Label alleen in de vaste eerste cel; de dag-cellen
                              van de band behouden weekend-arcering en de
                              vandaag-markering, zodat die verticale gidsen
                              niet per sectie onderbroken worden. */}
                          <td className="mp-sticky sticky left-0 z-10 p-0 border-y border-slate-300 border-r-2 bg-slate-100/90">
                            <div className="inline-flex items-center px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                              {section}
                            </div>
                          </td>
                          {visibleDates.map((iso) => {
                            const h = dayHeader(iso);
                            const today = iso === todayIso;
                            return (
                              <td
                                key={iso}
                                className={cn(
                                  'p-0 border-y border-slate-300 bg-slate-100/80',
                                  h.isMonday ? 'border-l-2 border-l-slate-300' : 'border-l border-slate-200',
                                  today ? 'bg-oker-100/60' : h.weekend ? 'mp-hatch' : '',
                                )}
                              />
                            );
                          })}
                        </tr>
                      )}
                      <tr className={cn('group border-b border-slate-200', rowBg)}>
                        <td
                          className={cn(
                            isOwn ? 'mp-sticky-own' : 'mp-sticky',
                            'sticky left-0 z-10 px-4 py-2 text-sm font-semibold min-w-[180px] truncate border-r-2 border-slate-300 transition-colors',
                            rowBg,
                            'group-hover:bg-oker-50',
                            isOwn ? 'text-oker-800' : 'text-slate-800',
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {isOwn && <span className="h-1.5 w-1.5 rounded-full bg-oker-500" aria-hidden />}
                            {drv.name}
                            {isOwn && <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oker-600">jij</span>}
                          </span>
                        </td>
                        {visibleDates.map((iso) => {
                          const cell = row[iso];
                          const h = dayHeader(iso);
                          const today = iso === todayIso;
                          return (
                            <td
                              key={iso}
                              className={cn(
                                'p-0 text-center',
                                h.isMonday ? 'border-l-2 border-l-slate-300' : 'border-l border-slate-200',
                                // oker-100/60 i.p.v. 50/50: blijft ook zichtbaar
                                // in je eigen rij (die zelf al bg-oker-50 heeft).
                                today ? 'bg-oker-100/60' : h.weekend ? 'mp-weekend' : '',
                              )}
                            >
                              {cell ? (
                                <button
                                  type="button"
                                  onClick={() => setSelected({ driverName: drv.name, iso, cell })}
                                  className={cn('flex h-7 w-full items-center justify-center gap-0.5 px-1 text-[11px] tabular-nums cursor-pointer transition-colors hover:bg-oker-100/70', KIND_TEXT[cell.kind])}
                                  title={`${KIND_LABEL[cell.kind]} · ${cell.code}${cell.swap ? ` — geruild met ${cell.swap.with}` : ''} — klik voor details`}
                                >
                                  {cell.swap && <ArrowLeftRight size={10} className="shrink-0 text-blue-700" aria-hidden />}
                                  {cell.code}
                                </button>
                              ) : (
                                <div className="h-7" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: per chauffeur de codes per dag als chips. */}
          <div className="md:hidden surface-card rounded-3xl overflow-hidden divide-y divide-slate-100">
            {drivers.map((drv, i) => {
              const row = cells[drv.id] || {};
              const entries = visibleDates.filter((iso) => row[iso]).map((iso) => ({ iso, cell: row[iso] }));
              const isOwn = ownId && drv.id === ownId;
              const section = sectionOf(drv);
              const showHeader = showSections && (i === 0 || sectionOf(drivers[i - 1]) !== section);
              return (
                <Fragment key={drv.id}>
                {showHeader && (
                  <div className="bg-slate-100/80 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{section}</div>
                )}
                <div className={cn('p-4', isOwn && 'bg-oker-50')}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className={cn('text-sm font-semibold truncate inline-flex items-center gap-1.5', isOwn ? 'text-oker-800' : 'text-slate-800')}>
                      {isOwn && <span className="h-1.5 w-1.5 rounded-full bg-oker-500 shrink-0" aria-hidden />}
                      {drv.name}
                      {isOwn && <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oker-600">jij</span>}
                    </div>
                    <MicroLabel className="shrink-0 tabular-nums">{entries.length}</MicroLabel>
                  </div>
                  {entries.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-300 italic">Niets gepland in deze periode.</div>
                  ) : (
                    <div className="mt-2">
                      {entries.map(({ iso, cell }) => {
                        const d = new Date(`${iso}T00:00:00`);
                        const wd = WEEKDAY_SHORT[(d.getDay() + 6) % 7];
                        const today = iso === todayIso;
                        const summary = cell.kind === 'service'
                          ? (cell.segments.length ? cell.segments.join(' · ') : 'Dienst')
                          : cell.label;
                        return (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => setSelected({ driverName: drv.name, iso, cell })}
                            className="w-full flex items-center gap-3 rounded-xl px-2 py-2.5 min-h-11 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] transition-colors"
                          >
                            <span className={cn('w-11 shrink-0 text-xs font-semibold tabular-nums', today ? 'text-oker-600' : 'text-slate-400')}>{wd} {d.getDate()}</span>
                            <span className={cn('shrink-0 inline-block min-w-[46px] text-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-black/5', KIND_CLS[cell.kind])}>{cell.code}</span>
                            {cell.swap && <ArrowLeftRight size={12} className="shrink-0 text-blue-700" aria-hidden />}
                            <span className="min-w-0 flex-1 text-xs font-medium text-slate-500 truncate tabular-nums">{summary}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                </Fragment>
              );
            })}
          </div>

          {/* Legende — de codes die deze maand écht voorkomen, met hun betekenis. */}
          <div className="surface-card rounded-3xl p-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
            <MicroLabel className="text-slate-500">Legende</MicroLabel>
            {codeLegend.serviceExample && (
              <div className="flex items-center gap-2">
                <span className={cn('inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', KIND_CLS.service)}>{codeLegend.serviceExample}</span>
                <span className="font-medium text-slate-600">Dienst</span>
              </div>
            )}
            {codeLegend.entries.map((e) => (
              <div key={e.code} className="flex items-center gap-2">
                <span className={cn('inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold', KIND_CLS[e.kind])}>{e.code}</span>
                <span className="font-medium text-slate-600">{e.meaning}</span>
              </div>
            ))}
            {hasSwaps && (
              <div className="flex items-center gap-2">
                <ArrowLeftRight size={12} className="shrink-0 text-blue-700" />
                <span className="font-medium text-slate-600">Geruilde dienst (goedgekeurd, nog niet in de geïmporteerde planning)</span>
              </div>
            )}
            <span className="font-medium text-slate-400">Leeg = niets gepland</span>
          </div>
        </>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} maxWidth="sm">
        {selected && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <MicroLabel className="capitalize">{formatDateLong(selected.iso)}</MicroLabel>
                <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900 truncate">{selected.driverName}</h3>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Sluiten" className="ios-pressable shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50 flex items-center justify-center transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <span className={cn('inline-block rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums ring-1 ring-black/5', KIND_CLS[selected.cell.kind])}>{selected.cell.code}</span>
              <span className="text-sm font-semibold text-slate-700">{selected.cell.label}</span>
            </div>

            {selected.cell.swap && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                <ArrowLeftRight size={12} className="shrink-0" /> Geruild met {selected.cell.swap.with}
              </p>
            )}

            {selected.cell.kind === 'service' ? (
              selected.cell.segments.length > 0 ? (
                <div className="mt-5 space-y-2">
                  <MicroLabel>Uren</MicroLabel>
                  {selected.cell.segments.map((seg, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-base font-semibold text-slate-800 tabular-nums">
                      <Clock size={16} className="text-oker-500 shrink-0" /> {seg}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm font-medium text-slate-400">Geen uren bekend voor deze dienst in het dienstoverzicht.</p>
              )
            ) : (
              <p className="mt-5 text-sm font-medium text-slate-500">
                {KIND_LABEL[selected.cell.kind]}
                {selected.cell.kind === 'unknown' && ' — staat (nog) niet in het dienstoverzicht of de planningscodes.'}
              </p>
            )}
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
