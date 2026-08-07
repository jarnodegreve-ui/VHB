import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, Clock, Download, FileText, Users } from 'lucide-react';
import type { PlanningCode, PlanningMatrixRow, Service, User } from '../../types';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { KIND_BADGE_TONE } from '../../lib/planningKind';
import { EmptyState, PageHeader } from '../../components/ui';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../../components/primitives';
import { OpsStat } from '../../components/ops';
import { normalizePlanningToken, resolvePlanningAssignment, sortedNameToken, suggestClosestName } from '../../lib/planning';

/** Badge-tone per assignment-soort (presentatie van de matrixcodes). */
// Gedeelde kleurentaal met de Maandplanning (src/lib/planningKind.ts) —
// voorheen hadden beide views een tegenstrijdige legende.
const ASSIGNMENT_KIND_TONES = KIND_BADGE_TONE;

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

    // NB: de useMemo-hooks staan bewust BUITEN de try/catch verderop —
    // React-hooks mogen niet binnen een try/catch draaien (Rules of Hooks):
    // als de eerste hook gooit wordt de tweede overgeslagen → "rendered
    // fewer hooks than expected" en een crash op de volgende render.
    const derived = useMemo(() => {
      const serviceCodeLookup = new Set(services.map((service) => normalizePlanningToken(service.serviceNumber)));
      const planningCodeLookup = new Set(planningCodes.map((code) => normalizePlanningToken(code.code)));
      // Zowel de directe token als de volgorde-onafhankelijke sleutel, exact
      // zoals de server (idByNameKey) — anders telt een omgekeerde naamvolgorde
      // of accentverschil hier onterecht als "niet-gematchte chauffeur".
      const knownDriverLookup = new Set<string>();
      for (const user of users) {
        const token = normalizePlanningToken(user.name);
        if (token.length > 0) {
          knownDriverLookup.add(token);
          knownDriverLookup.add(sortedNameToken(user.name));
        }
      }

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
        const hasKnownDriver = normalizedDriver.length > 0 &&
          (knownDriverLookup.has(normalizedDriver) || knownDriverLookup.has(sortedNameToken(driver)));
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

    // Vanaf hier: geen hooks meer → veilig om in try/catch te wikkelen als
    // render-vangnet (de catch toont een nette schermfout i.p.v. een crash).
    try {
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
    void downloadBlob('planning-matrix-problemen.csv', blob);
  };

    return (
    <div className="space-y-6">
      <PageHeader
        title="Planningsoverzicht"
        description="Controleer de geïmporteerde matrix en los onbekende codes of niet-gematchte chauffeurs op."
      />
      {/* OpsStat i.p.v. StatCard (vaste regel voor KPI-strips): vaste
          twee-regel-labelzone, dus cijfers en subteksten op één lijn. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <OpsStat
          icon={<Clock size={16} />}
          tone="emerald"
          label="Gegenereerde Diensten"
          value={derived.totalGeneratedServices}
          sub="gematcht vanuit Dienstoverzicht"
        />
        <OpsStat
          icon={<AlertTriangle size={16} />}
          tone={derived.globalUnknownCodes.length > 0 ? 'amber' : 'slate'}
          label="Onbekende Codes"
          value={derived.globalUnknownCodes.length}
          sub={derived.globalUnknownCodes.length === 0 ? 'alles herkend' : derived.globalUnknownCodes.slice(0, 3).join(' • ')}
        />
        <OpsStat
          icon={<Users size={16} />}
          tone={derived.globalUnmatchedDrivers.length > 0 ? 'oker' : 'slate'}
          label="Niet-Gematchte Chauffeurs"
          value={derived.globalUnmatchedDrivers.length}
          sub={derived.globalUnmatchedDrivers.length === 0 ? 'alles gekoppeld' : derived.globalUnmatchedDrivers.slice(0, 2).join(' • ')}
        />
      </div>

      <section className="surface-card rounded-3xl p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Controlefilters</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Filter op probleemdagen of klik een onbekende code om enkel die assignments te bekijken.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant={showOnlyIssues ? 'ghost' : 'secondary'}
              onClick={() => setShowOnlyIssues((current) => !current)}
              className={showOnlyIssues ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-700' : undefined}
            >
              {showOnlyIssues ? 'Alleen Probleemdagen' : 'Toon Alle Dagen'}
            </Button>
            {highlightedCode ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHighlightedCode(null)}
                className="border border-oker-200 bg-oker-50 text-oker-700 hover:bg-oker-100 hover:text-oker-700"
              >
                Reset Codefilter
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              icon={<Download size={14} />}
              onClick={exportProblemReport}
              disabled={derived.globalUnknownCodes.length === 0 && derived.globalUnmatchedDrivers.length === 0}
            >
              Exporteer Problemen
            </Button>
          </div>
        </div>


        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-red-100 bg-red-50/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <MicroLabel className="text-red-700">Onbekende Codes</MicroLabel>
              <Badge tone="red">{derived.globalUnknownCodes.length}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnknownCodes.length > 0 ? derived.globalUnknownCodes.map((code) => (
                <button
                  key={`list-${code}`}
                  onClick={() => setHighlightedCode(code)}
                  className={cn(
                    'ios-pressable rounded-full border px-3 py-1.5 text-xs font-semibold transition-all',
                    highlightedCode === code ? 'border-red-300 bg-red-100 text-red-800' : 'border-red-100 bg-white/80 text-red-700 hover:bg-red-100'
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
                <Button size="sm" variant="danger" onClick={onOpenPlanningCodes}>
                  Open Planningscodes
                </Button>
                <Button size="sm" variant="danger" onClick={onOpenServiceOverview}>
                  Open Dienstoverzicht
                </Button>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <MicroLabel className="text-amber-700">Niet-Gematchte Chauffeurs</MicroLabel>
              <Badge tone="amber">{derived.globalUnmatchedDrivers.length}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnmatchedDrivers.length > 0 ? derived.globalUnmatchedDrivers.map((driver) => {
                // Fuzzy-suggestie: "Duysbergh Pascal" (typo) → "≈ Duysburgh Pascal?"
                const suggestion = suggestClosestName(driver, users.map((u) => ({ id: String(u.id), name: u.name })));
                return (
                  <span key={driver} className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-white/80 px-3 py-1.5 text-xs font-semibold text-amber-700">
                    {driver}
                    {suggestion && <span className="font-medium text-amber-600/90">≈ {suggestion.name}?</span>}
                  </span>
                );
              }) : (
                <span className="text-sm font-medium text-amber-700">Alle chauffeurs zijn gekoppeld.</span>
              )}
            </div>
            {derived.globalUnmatchedDrivers.length > 0 ? (
              <div className="mt-4">
                {canOpenUserManagement ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onOpenUserManagement}
                    className="border border-amber-200 bg-white/80 text-amber-700 hover:bg-amber-100 hover:text-amber-700"
                  >
                    Open Gebruikersbeheer
                  </Button>
                ) : (
                  <Badge tone="amber" className="bg-white/80">Gebruikersbeheer admin-only</Badge>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="surface-card rounded-3xl p-6">
          <div className="mb-5">
            <h3 className="text-lg font-bold tracking-tight">Geuploade Dagen</h3>
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
                    'ios-pressable w-full rounded-2xl border px-4 py-3 text-left transition-all',
                    isActive ? 'border-oker-400 bg-oker-50 ring-2 ring-oker-500/10' : 'border-slate-100 bg-white/60 hover:bg-slate-50/60'
                  )}
                >
                  <p className="text-sm font-semibold text-slate-800 tabular-nums">
                    {new Date(row.source_date).toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-slate-400 tabular-nums">
                    <span>Dagtype {row.day_type || '-'}</span>
                    <span>{assignmentCount} codes</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] font-medium text-slate-400 tabular-nums">
                    <span>{generatedServices} diensten</span>
                    {rowUnknownCodes > 0 || rowUnmatchedDrivers > 0 || (generatedServices === 0 && assignmentCount > 0)
                      ? <span className="font-semibold text-amber-700">controle nodig</span>
                      : <span>&nbsp;</span>}
                  </div>
                  {(rowUnknownCodes > 0 || rowUnmatchedDrivers > 0) ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {rowUnknownCodes > 0 ? (
                        <Badge tone="red">{rowUnknownCodes} onbekend</Badge>
                      ) : null}
                      {rowUnmatchedDrivers > 0 ? (
                        <Badge tone="amber">{rowUnmatchedDrivers} chauffeur</Badge>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            }) : (
              <EmptyState mascotte={false}
                icon={<Calendar size={28} />}
                title={showOnlyIssues ? "Geen probleemdagen gevonden" : "Nog geen matrixplanning"}
                message={showOnlyIssues ? "Alle geüploade dagen zijn momenteel volledig herkenbaar." : "Upload eerst een matrix-CSV via Beheer Roosters om hier een overzicht te zien."}
              />
            )}
            {visibleRows.length > visibleDayRows.length ? (
              <Button
                size="sm"
                variant="secondary"
                full
                onClick={() => setVisibleDayCount((current) => current + 60)}
              >
                Toon Meer Dagen ({visibleRows.length - visibleDayRows.length} resterend)
              </Button>
            ) : null}
          </div>
        </section>

        <section className="surface-card rounded-3xl p-6">
          {selectedRow ? (
            <>
              <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-lg md:text-xl font-bold tracking-tight text-slate-900">
                    {new Date(selectedRow.source_date).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Dagtype {selectedRow.day_type || '-'} met {assignments.length} ingevulde chauffeurcodes.
                  </p>
                </div>
                <Badge tone="oker">Matrix staging</Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <OpsStat
                  icon={<Users size={16} />}
                  tone="oker"
                  label="Chauffeurs"
                  value={assignments.length}
                  sub="met een ingevulde code"
                />
                <OpsStat
                  icon={<Clock size={16} />}
                  tone="emerald"
                  label="Herkende Diensten"
                  value={serviceAssignments}
                  sub="gematcht met Dienstoverzicht"
                />
                <OpsStat
                  icon={<AlertTriangle size={16} />}
                  tone={unknownAssignments > 0 ? 'amber' : 'slate'}
                  label="Onbekende Codes"
                  value={unknownAssignments}
                  sub={unknownAssignments === 0 ? 'alles herkend' : 'nog te mappen'}
                />
              </div>

              {(unknownAssignments > 0 || unmatchedDriversForSelectedDay.length > 0 || highlightedCode) ? (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-5">
                    <MicroLabel className="text-amber-700">Niet-Gematchte Chauffeurs</MicroLabel>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {unmatchedDriversForSelectedDay.length > 0 ? unmatchedDriversForSelectedDay.map((driver) => (
                        <Fragment key={driver}><Badge tone="amber" className="bg-white/80">{driver}</Badge></Fragment>
                      )) : (
                        <span className="text-sm font-medium text-amber-700">Geen niet-gematchte chauffeurs voor deze dag.</span>
                      )}
                    </div>
                    {unmatchedDriversForSelectedDay.length > 0 ? (
                      <div className="mt-4">
                        {canOpenUserManagement ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={onOpenUserManagement}
                            className="border border-amber-200 bg-white/80 text-amber-700 hover:bg-amber-100 hover:text-amber-700"
                          >
                            Open Gebruikersbeheer
                          </Button>
                        ) : (
                          <Badge tone="amber" className="bg-white/80">Gebruikersbeheer admin-only</Badge>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-red-100 bg-red-50/80 p-5">
                    <MicroLabel className="text-red-700">
                      {unknownAssignments > 0 ? 'Onbekende Codes' : 'Codefilter'}
                    </MicroLabel>
                    <p className="mt-3 text-sm font-medium text-red-700">
                      {unknownAssignments > 0
                        ? `${unknownAssignments} assignment${unknownAssignments === 1 ? '' : 's'} op deze dag vragen nog interpretatie via Planningscodes of Dienstoverzicht.`
                        : highlightedCode
                          ? `Je bekijkt nu enkel assignments met code ${highlightedCode}.`
                          : 'Geen actieve codefilter.'}
                    </p>
                    {unknownAssignments > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button size="sm" variant="danger" onClick={onOpenPlanningCodes}>
                          Open Planningscodes
                        </Button>
                        <Button size="sm" variant="danger" onClick={onOpenServiceOverview}>
                          Open Dienstoverzicht
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <TableShell className="mt-6">
                <div className="hidden md:block">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/60">
                      <tr>
                        <Th>Chauffeur</Th>
                        <Th>Code</Th>
                        <Th>Interpretatie</Th>
                        <Th>Uren / status</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAssignments.map((assignment) => (
                        <tr key={assignment.driver} className="hover:bg-slate-50/60 transition-colors">
                          <Td className="font-semibold text-slate-800">{assignment.driver}</Td>
                          <Td>
                            <Badge tone={ASSIGNMENT_KIND_TONES[assignment.kind] ?? 'slate'} className="uppercase tracking-[0.08em]">
                              {assignment.code}
                            </Badge>
                          </Td>
                          <Td className="font-semibold text-slate-800">{assignment.label}</Td>
                          <Td className="text-slate-500 tabular-nums">{assignment.details}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-slate-100 md:hidden">
                  {filteredAssignments.map((assignment) => (
                    <div key={assignment.driver} className="p-5">
                      <p className="text-sm font-semibold text-slate-800">{assignment.driver}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge tone={ASSIGNMENT_KIND_TONES[assignment.kind] ?? 'slate'} className="uppercase tracking-[0.08em]">
                          {assignment.code}
                        </Badge>
                        <span className="text-xs font-semibold text-slate-500">{assignment.label}</span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-500 tabular-nums">{assignment.details}</p>
                    </div>
                  ))}
                </div>
              </TableShell>
            </>
          ) : (
            <EmptyState mascotte={false}
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
      <div className="surface-card rounded-3xl p-6">
        <div className="rounded-2xl border border-red-100 bg-red-50/80 p-5">
          <MicroLabel className="text-red-700">Schermfout</MicroLabel>
          <h3 className="mt-3 text-lg md:text-xl font-bold tracking-tight text-slate-900">Planning Overzicht kon niet geladen worden</h3>
          <p className="mt-2 text-sm font-medium text-slate-600">
            {error instanceof Error ? error.message : 'Onbekende renderfout'}
          </p>
        </div>
      </div>
    );
  }
}
