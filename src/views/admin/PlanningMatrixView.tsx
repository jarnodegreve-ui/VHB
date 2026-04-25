import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, Clock, Download, FileText, Filter, Upload, Users } from 'lucide-react';
import type { PlanningCode, PlanningMatrixRow, Service, User } from '../../types';
import { cn, notify } from '../../lib/ui';
import { EmptyState } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { normalizePlanningToken, resolvePlanningAssignment } from '../../lib/planning';

export function PlanningMatrixView({
  rows,
  services,
  planningCodes,
  users,
  canOpenUserManagement,
  onOpenPlanningCodes,
  onOpenServiceOverview,
  onOpenUserManagement,
}: {
  rows: PlanningMatrixRow[];
  services: Service[];
  planningCodes: PlanningCode[];
  users: User[];
  canOpenUserManagement: boolean;
  onOpenPlanningCodes: () => void;
  onOpenServiceOverview: () => void;
  onOpenUserManagement: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(rows[0]?.source_date || null);
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [visibleDayCount, setVisibleDayCount] = useState(60);
  const safeRows = useMemo(
    () => rows.map((row) => ({
      ...row,
      source_date: String(row.source_date ?? ''),
      day_type: String(row.day_type ?? ''),
      assignments: row.assignments && typeof row.assignments === 'object' && !Array.isArray(row.assignments)
        ? Object.fromEntries(Object.entries(row.assignments).map(([driver, code]) => [String(driver), String(code ?? '')]))
        : {},
    })),
    [rows]
  );
  const deferredRows = useDeferredValue(safeRows);

  useEffect(() => {
    if (!selectedDate && safeRows[0]?.source_date) {
      setSelectedDate(safeRows[0].source_date);
    }
    if (selectedDate && !safeRows.some((row) => row.source_date === selectedDate) && safeRows[0]?.source_date) {
      setSelectedDate(safeRows[0].source_date);
    }
  }, [safeRows, selectedDate]);

  useEffect(() => {
    setVisibleDayCount(60);
  }, [showOnlyIssues]);

  try {
    const derived = useMemo(() => {
      const serviceCodeLookup = new Set(services.map((service) => normalizePlanningToken(service.serviceNumber)));
      const planningCodeLookup = new Set(planningCodes.map((code) => normalizePlanningToken(code.code)));
      const knownDriverLookup = new Set(
        users
          .map((user) => normalizePlanningToken(user.name))
          .filter((value) => value.length > 0)
      );

    const globalUnknownCodeSet = new Set<string>();
    const globalUnmatchedDriverSet = new Set<string>();
    const generatedServicesPerDay = new Map<string, number>();
    const daySummaryByDate = new Map<string, {
      assignmentCount: number;
      generatedServices: number;
      unknownCodeCount: number;
      unmatchedDriverCount: number;
      unmatchedDrivers: string[];
    }>();
    for (const row of deferredRows) {
      const assignmentsEntries = Object.entries(row.assignments || {}) as Array<[string, string]>;
      let generatedServices = 0;
      let unknownCodeCount = 0;
      let unmatchedDriverCount = 0;
      const unmatchedDrivers: string[] = [];

      for (const [driver, code] of assignmentsEntries) {
        const normalizedCode = normalizePlanningToken(code);
        const normalizedDriver = normalizePlanningToken(driver);
        const hasKnownDriver = normalizedDriver.length > 0 && knownDriverLookup.has(normalizedDriver);
        const isKnownService = normalizedCode.length > 0 && serviceCodeLookup.has(normalizedCode);
        const isKnownPlanningCode = normalizedCode.length > 0 && planningCodeLookup.has(normalizedCode);

        if (isKnownService) {
          generatedServices += 1;
        }

        if (normalizedCode.length > 0 && !isKnownService && !isKnownPlanningCode) {
          unknownCodeCount += 1;
          globalUnknownCodeSet.add(normalizedCode);
        }

        if (normalizedDriver.length > 0 && !hasKnownDriver) {
          unmatchedDriverCount += 1;
          unmatchedDrivers.push(driver);
          globalUnmatchedDriverSet.add(driver);
        }
      }

      generatedServicesPerDay.set(row.source_date, generatedServices);
      daySummaryByDate.set(row.source_date, {
        assignmentCount: assignmentsEntries.length,
        generatedServices,
        unknownCodeCount,
        unmatchedDriverCount,
        unmatchedDrivers: unmatchedDrivers.sort((a, b) => a.localeCompare(b)),
      });
    }

    const rowsWithAssignments = deferredRows.filter((row) => (daySummaryByDate.get(row.source_date)?.assignmentCount || 0) > 0);
    const rowsWithIssues = deferredRows.filter((row) => {
      const summary = daySummaryByDate.get(row.source_date);
      return !!summary && (summary.unknownCodeCount > 0 || summary.unmatchedDriverCount > 0);
    });

    return {
      serviceCodeLookup,
      planningCodeLookup,
      daySummaryByDate,
      generatedServicesPerDay,
      globalUnknownCodes: Array.from(globalUnknownCodeSet).sort((a, b) => a.localeCompare(b)),
      globalUnmatchedDrivers: Array.from(globalUnmatchedDriverSet).sort((a, b) => a.localeCompare(b)),
      rowsWithAssignments,
      rowsWithIssues,
      totalGeneratedServices: Array.from<number>(generatedServicesPerDay.values()).reduce<number>((sum, value) => sum + value, 0),
    };
    }, [deferredRows, services, planningCodes, users]);

    const selectedRow = deferredRows.find((row) => row.source_date === selectedDate) || null;
    const assignments = useMemo(
      () => selectedRow
        ? ((Object.entries(selectedRow.assignments) as Array<[string, string]>)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([driver, code]) => resolvePlanningAssignment(driver, code, services, planningCodes)))
        : [],
      [selectedRow, services, planningCodes]
    );
    const visibleRows = showOnlyIssues ? derived.rowsWithIssues : deferredRows;
    const serviceAssignments = assignments.filter((assignment) => assignment.kind === 'service').length;
    const unknownAssignments = assignments.filter((assignment) => assignment.kind === 'unknown').length;
    const unmatchedDriversForSelectedDay = selectedRow ? (derived.daySummaryByDate.get(selectedRow.source_date)?.unmatchedDrivers || []) : [];
    const filteredAssignments = highlightedCode
      ? assignments.filter((assignment) => normalizePlanningToken(assignment.code) === highlightedCode)
      : assignments;
    const visibleDayRows = visibleRows.slice(0, visibleDayCount);

    const exportProblemReport = () => {
    const problemReportRows = deferredRows.flatMap((row) => {
      const formattedDate = new Date(row.source_date).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const unknownRows = (Object.entries(row.assignments || {}) as Array<[string, string]>)
        .filter(([, code]) => {
          const normalizedCode = normalizePlanningToken(code);
          return normalizedCode.length > 0 && !derived.serviceCodeLookup.has(normalizedCode) && !derived.planningCodeLookup.has(normalizedCode);
        })
        .map(([driver, code]) => ({
          date: formattedDate,
          dayType: row.day_type || '',
          type: 'onbekende_code',
          driver,
          code,
          details: 'Geen match in Dienstoverzicht of Planningscodes',
        }));
      const unmatchedRows = Object.keys(row.assignments || {})
        .filter((driver) => (derived.daySummaryByDate.get(row.source_date)?.unmatchedDrivers || []).includes(driver))
        .map((driver) => ({
          date: formattedDate,
          dayType: row.day_type || '',
          type: 'niet_gematchte_chauffeur',
          driver,
          code: row.assignments?.[driver] || '',
          details: 'Geen match met gebruikerslijst',
        }));
      return [...unknownRows, ...unmatchedRows];
    });

    if (problemReportRows.length === 0) {
      notify('Er zijn momenteel geen problemen om te exporteren.', 'info');
      return;
    }

    const header = ['datum', 'dagtype', 'type', 'chauffeur', 'code', 'details'];
    const csvRows = [
      header.join(';'),
      ...problemReportRows.map((row) => [
        row.date,
        row.dayType,
        row.type,
        row.driver,
        row.code,
        row.details,
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';')),
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planning-matrix-problemen.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

    return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Clock className="text-emerald-600" />}
          label="Gegenereerde Diensten"
          value={derived.totalGeneratedServices.toString()}
          subValue="Gematcht vanuit Dienstoverzicht"
        />
        <StatCard
          icon={<AlertTriangle className="text-slate-600" />}
          label="Onbekende Codes"
          value={derived.globalUnknownCodes.length.toString()}
          subValue={derived.globalUnknownCodes.length === 0 ? 'Alles herkend' : derived.globalUnknownCodes.slice(0, 3).join(' • ')}
        />
        <StatCard
          icon={<Users className="text-oker-600" />}
          label="Niet-Gematchte Chauffeurs"
          value={derived.globalUnmatchedDrivers.length.toString()}
          subValue={derived.globalUnmatchedDrivers.length === 0 ? 'Alles gekoppeld' : derived.globalUnmatchedDrivers.slice(0, 2).join(' • ')}
        />
      </div>

      <section className="surface-card rounded-[32px] p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-black tracking-tight">Controlefilters</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Filter op probleemdagen of klik een onbekende code om enkel die assignments te bekijken.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowOnlyIssues((current) => !current)}
              className={cn(
                "rounded-2xl border px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] transition-all",
                showOnlyIssues ? "border-red-200 bg-red-50 text-red-700" : "border-white/70 bg-white/55 text-slate-500 hover:bg-white/80"
              )}
            >
              {showOnlyIssues ? 'Alleen Probleemdagen' : 'Toon Alle Dagen'}
            </button>
            {highlightedCode ? (
              <button
                onClick={() => setHighlightedCode(null)}
                className="rounded-2xl border border-oker-200 bg-oker-50 px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-oker-700 transition-all hover:bg-oker-100"
              >
                Reset Codefilter
              </button>
            ) : null}
            <button
              onClick={exportProblemReport}
              disabled={derived.globalUnknownCodes.length === 0 && derived.globalUnmatchedDrivers.length === 0}
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] transition-all",
                derived.globalUnknownCodes.length === 0 && derived.globalUnmatchedDrivers.length === 0
                  ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                  : "border-white/70 bg-white/55 text-slate-600 hover:bg-white/80"
              )}
            >
              <Download size={14} />
              Exporteer Problemen
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {derived.globalUnknownCodes.length > 0 ? derived.globalUnknownCodes.map((code) => (
            <button
              key={code}
              onClick={() => setHighlightedCode(code)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all",
                highlightedCode === code ? "border-red-300 bg-red-100 text-red-800" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              )}
            >
              {code}
            </button>
          )) : (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-emerald-700">
              Geen onbekende codes
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-red-200/70 bg-red-50/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Onbekende Codes</p>
              <span className="rounded-full border border-red-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                {derived.globalUnknownCodes.length}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnknownCodes.length > 0 ? derived.globalUnknownCodes.map((code) => (
                <button
                  key={`list-${code}`}
                  onClick={() => setHighlightedCode(code)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all",
                    highlightedCode === code ? "border-red-300 bg-red-100 text-red-800" : "border-red-200 bg-white/80 text-red-700 hover:bg-red-100"
                  )}
                >
                  {code}
                </button>
              )) : (
                <span className="text-sm font-medium text-red-700">Geen onbekende codes gevonden.</span>
              )}
            </div>
            {derived.globalUnknownCodes.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenPlanningCodes}
                  className="rounded-2xl border border-red-200 bg-white/80 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-red-700 transition-all hover:bg-red-100"
                >
                  Open Planningscodes
                </button>
                <button
                  type="button"
                  onClick={onOpenServiceOverview}
                  className="rounded-2xl border border-red-200 bg-white/80 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-red-700 transition-all hover:bg-red-100"
                >
                  Open Dienstoverzicht
                </button>
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border border-amber-200/70 bg-amber-50/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Niet-Gematchte Chauffeurs</p>
              <span className="rounded-full border border-amber-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                {derived.globalUnmatchedDrivers.length}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnmatchedDrivers.length > 0 ? derived.globalUnmatchedDrivers.map((driver) => (
                <span key={driver} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-amber-800">
                  {driver}
                </span>
              )) : (
                <span className="text-sm font-medium text-amber-700">Alle chauffeurs zijn gekoppeld.</span>
              )}
            </div>
            {derived.globalUnmatchedDrivers.length > 0 ? (
              <div className="mt-4">
                {canOpenUserManagement ? (
                  <button
                    type="button"
                    onClick={onOpenUserManagement}
                    className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 transition-all hover:bg-amber-100"
                  >
                    Open Gebruikersbeheer
                  </button>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-amber-700">
                    Gebruikersbeheer admin-only
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="surface-card rounded-[32px] p-6">
          <div className="mb-5">
            <h3 className="text-lg font-black tracking-tight">Geuploade Dagen</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {visibleRows.length} getoond, {derived.rowsWithAssignments.length} met effectieve assignments en {derived.rowsWithIssues.length} met controlepunten.
            </p>
          </div>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-2">
            {visibleDayRows.length > 0 ? visibleDayRows.map((row) => {
              const summary = derived.daySummaryByDate.get(row.source_date);
              const assignmentCount = summary?.assignmentCount || 0;
              const generatedServices = summary?.generatedServices || 0;
              const rowUnknownCodes = summary?.unknownCodeCount || 0;
              const rowUnmatchedDrivers = summary?.unmatchedDriverCount || 0;
              const isActive = row.source_date === selectedDate;
              return (
                <button
                  key={row.id}
                  onClick={() => setSelectedDate(row.source_date)}
                  className={cn(
                    "w-full rounded-2xl border px-4 py-4 text-left transition-all",
                    isActive ? "border-oker-400 bg-oker-50 ring-2 ring-oker-500/10" : "border-white/70 bg-white/45 hover:bg-white/75"
                  )}
                >
                  <p className="text-sm font-black text-slate-800">
                    {new Date(row.source_date).toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Dagtype {row.day_type || '-'}</span>
                    <span>{assignmentCount} codes</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>{generatedServices} diensten</span>
                    {rowUnknownCodes > 0 || rowUnmatchedDrivers > 0 || (generatedServices === 0 && assignmentCount > 0)
                      ? <span>controle nodig</span>
                      : <span>&nbsp;</span>}
                  </div>
                  {(rowUnknownCodes > 0 || rowUnmatchedDrivers > 0) ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rowUnknownCodes > 0 ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                          {rowUnknownCodes} onbekend
                        </span>
                      ) : null}
                      {rowUnmatchedDrivers > 0 ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                          {rowUnmatchedDrivers} chauffeur
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            }) : (
              <EmptyState
                icon={<Calendar size={28} />}
                title={showOnlyIssues ? "Geen probleemdagen gevonden" : "Nog geen matrixplanning"}
                message={showOnlyIssues ? "Alle geüploade dagen zijn momenteel volledig herkenbaar." : "Upload eerst een matrix-CSV via Beheer Roosters om hier een overzicht te zien."}
              />
            )}
            {visibleRows.length > visibleDayRows.length ? (
              <button
                onClick={() => setVisibleDayCount((current) => current + 60)}
                className="w-full rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500 transition-all hover:bg-white/80"
              >
                Toon Meer Dagen ({visibleRows.length - visibleDayRows.length} resterend)
              </button>
            ) : null}
          </div>
        </section>

        <section className="surface-card rounded-[32px] p-6">
          {selectedRow ? (
            <>
              <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">
                    {new Date(selectedRow.source_date).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Dagtype {selectedRow.day_type || '-'} met {assignments.length} ingevulde chauffeurcodes.
                  </p>
                </div>
                <div className="glass-chip rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-oker-700">
                  Matrix staging
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <StatCard
                  icon={<Users className="text-oker-600" />}
                  label="Chauffeurs"
                  value={assignments.length.toString()}
                  subValue="Met een ingevulde code"
                />
                <StatCard
                  icon={<Clock className="text-emerald-600" />}
                  label="Herkende Diensten"
                  value={serviceAssignments.toString()}
                  subValue="Gematcht met Dienstoverzicht"
                />
                <StatCard
                  icon={<AlertTriangle className="text-slate-600" />}
                  label="Onbekende Codes"
                  value={unknownAssignments.toString()}
                  subValue={unknownAssignments === 0 ? 'Alles herkend' : 'Nog te mappen'}
                />
              </div>

              {(unknownAssignments > 0 || unmatchedDriversForSelectedDay.length > 0 || highlightedCode) ? (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[24px] border border-amber-200/70 bg-amber-50/80 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Niet-Gematchte Chauffeurs</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {unmatchedDriversForSelectedDay.length > 0 ? unmatchedDriversForSelectedDay.map((driver) => (
                        <span key={driver} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-amber-800">
                          {driver}
                        </span>
                      )) : (
                        <span className="text-sm font-medium text-amber-700">Geen niet-gematchte chauffeurs voor deze dag.</span>
                      )}
                    </div>
                    {unmatchedDriversForSelectedDay.length > 0 ? (
                      <div className="mt-4">
                        {canOpenUserManagement ? (
                          <button
                            type="button"
                            onClick={onOpenUserManagement}
                            className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 transition-all hover:bg-amber-100"
                          >
                            Open Gebruikersbeheer
                          </button>
                        ) : (
                          <div className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-amber-700">
                            Gebruikersbeheer admin-only
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-[24px] border border-red-200/70 bg-red-50/80 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">
                      {unknownAssignments > 0 ? 'Onbekende Codes' : 'Codefilter'}
                    </p>
                    <p className="mt-3 text-sm font-medium text-red-700">
                      {unknownAssignments > 0
                        ? `${unknownAssignments} assignment${unknownAssignments === 1 ? '' : 's'} op deze dag vragen nog interpretatie via Planningscodes of Dienstoverzicht.`
                        : highlightedCode
                          ? `Je bekijkt nu enkel assignments met code ${highlightedCode}.`
                          : 'Geen actieve codefilter.'}
                    </p>
                    {unknownAssignments > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={onOpenPlanningCodes}
                          className="rounded-2xl border border-red-200 bg-white/80 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-red-700 transition-all hover:bg-red-100"
                        >
                          Open Planningscodes
                        </button>
                        <button
                          type="button"
                          onClick={onOpenServiceOverview}
                          className="rounded-2xl border border-red-200 bg-white/80 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-red-700 transition-all hover:bg-red-100"
                        >
                          Open Dienstoverzicht
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="mt-6 surface-table rounded-[28px] overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/60">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Chauffeur</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Code</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Interpretatie</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Uren / status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssignments.map((assignment) => (
                        <tr key={assignment.driver} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 text-sm font-bold text-slate-800">{assignment.driver}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              'rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest',
                              assignment.kind === 'service' && 'glass-chip text-emerald-700',
                              assignment.kind === 'leave' && 'glass-chip text-sky-700',
                              assignment.kind === 'training' && 'glass-chip text-violet-700',
                              assignment.kind === 'absence' && 'glass-chip text-amber-700',
                              assignment.kind === 'unknown' && 'border border-red-200 bg-red-50 text-red-700'
                            )}>
                              {assignment.code}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm font-bold text-slate-800">{assignment.label}</td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-500">{assignment.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-slate-50 md:hidden">
                  {filteredAssignments.map((assignment) => (
                    <div key={assignment.driver} className="p-5">
                      <p className="text-sm font-black text-slate-800">{assignment.driver}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={cn(
                          'rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest',
                          assignment.kind === 'service' && 'glass-chip text-emerald-700',
                          assignment.kind === 'leave' && 'glass-chip text-sky-700',
                          assignment.kind === 'training' && 'glass-chip text-violet-700',
                          assignment.kind === 'absence' && 'glass-chip text-amber-700',
                          assignment.kind === 'unknown' && 'border border-red-200 bg-red-50 text-red-700'
                        )}>
                          {assignment.code}
                        </span>
                        <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{assignment.label}</span>
                      </div>
                      <p className="mt-3 text-sm font-medium text-slate-500">{assignment.details}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<FileText size={28} />}
              title="Geen dag geselecteerd"
              message="Kies links een geüploade dag om de actuele matrixplanning te bekijken."
            />
          )}
        </section>
      </div>
    </div>
    );
  } catch (error) {
    console.error('Planning Overzicht renderfout:', error);
    return (
      <div className="surface-card rounded-[32px] p-8">
        <div className="rounded-[24px] border border-red-200 bg-red-50/80 p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Schermfout</p>
          <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-900">Planning Overzicht kon niet geladen worden</h3>
          <p className="mt-2 text-sm font-medium text-slate-600">
            {error instanceof Error ? error.message : 'Onbekende renderfout'}
          </p>
        </div>
      </div>
    );
  }
}

