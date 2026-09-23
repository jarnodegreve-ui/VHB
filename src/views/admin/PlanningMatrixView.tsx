import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Download, Plus, UserSearch, Users } from 'lucide-react';
import type { PlanningCode, PlanningMatrixRow, Service, User } from '../../types';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { csvTekst } from '../../lib/csv';
import { celBadgeTone } from '../../lib/planningKind';
import { EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, Chip, FilterChip, IconButton, MicroLabel } from '../../components/primitives';
import { StickyThead } from '../../components/Table';
import { formatDatumDMJ, formatDayLong, WEEKDAY_SHORT_SUN } from '../../lib/format';
import { Card, CardHeader } from '../../components/Card';
import { InfoTip } from '../../components/InfoTip';
import { OpsStat } from '../../components/ops';
import { Modal, SluitKnop } from '../../components/Modal';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { Field, Input, Select } from '../../components/Field';
import { useOptioneleAppData } from '../../app/AppDataContext';
import { navigeer } from '../../app/router';
import { normalizePlanningToken, resolvePlanningAssignment, sortedNameToken, suggestClosestName } from '../../lib/planning';
import { TableShell, Td, Th, Tabel } from '../../components/TabelBasis';

/** Zelfde categorieën als Planningscodes (die view is een eigen chunk, dus niet importeren). */
const CATEGORIE_OPTIES: Array<{ value: PlanningCode['category']; label: string }> = [
  { value: 'service', label: 'Dienst' },
  { value: 'absence', label: 'Afwezigheid' },
  { value: 'leave', label: 'Verlof' },
  { value: 'training', label: 'Opleiding' },
  { value: 'unknown', label: 'Onbekend' },
];

/** "wo 17/09/2026": weekdag + dag/maand/jaar, nooit een rauwe of lokale datumnotatie. */
const dagKort = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? formatDatumDMJ(iso) : `${WEEKDAY_SHORT_SUN[d.getDay()]} ${formatDatumDMJ(iso)}`;
};
/** "woensdag 17 september 2026": de kop van de gekozen dag. */
const dagLang = (iso: string) => `${formatDayLong(iso)} ${iso.slice(0, 4)}`;

/** Badge-tone per assignment-soort (presentatie van de matrixcodes). */
// Gedeelde kleurentaal met de Maandplanning (src/lib/planningKind.ts) —
// voorheen hadden beide views een tegenstrijdige legende.

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

  // Doe-scherm (punt 16): een onbekende code meteen als planningscode
  // vastleggen (zelfde schrijfpad als Planningscodes: savePlanningCodes uit
  // de datalaag, met revisie-header en conflict-toast) en vanuit een
  // niet-gematchte naam in één klik op de juiste gebruiker landen. Buiten de
  // app-schil (geen context) verdwijnt de toevoegknop gewoon.
  const savePlanningCodes = useOptioneleAppData()?.savePlanningCodes;
  const [nieuweCode, setNieuweCode] = useState<{ code: string; description: string; category: PlanningCode['category'] } | null>(null);
  const [codeBezig, setCodeBezig] = useState(false);
  const codeFouten = useVeldfouten();
  const { vuil: codeVuil } = useVuil(nieuweCode, !!nieuweCode);
  const openNieuweCode = (code: string) => { codeFouten.wis(); setNieuweCode({ code: normalizePlanningToken(code), description: '', category: 'unknown' }); };
  const bewaarNieuweCode = async () => {
    if (!nieuweCode || !savePlanningCodes || codeBezig) return;
    const code = nieuweCode.code.trim().toLowerCase();
    if (!code) { codeFouten.zet({ code: 'De code mag niet leeg zijn.' }); return; }
    if (planningCodes.some((c) => normalizePlanningToken(c.code) === normalizePlanningToken(code))) {
      codeFouten.zet({ code: 'Deze code staat al bij de planningscodes.' });
      return;
    }
    codeFouten.wis();
    setCodeBezig(true);
    // Vinkjes (telt als dienst, betaald, vrije dag) blijven uit, zoals een
    // nieuwe rij in Planningscodes; daar stel je ze bij.
    let ok: boolean;
    try {
      ok = await savePlanningCodes([...planningCodes, { code, category: nieuweCode.category, description: nieuweCode.description.trim(), countsAsShift: false, isPaidAbsence: false, isDayOff: false }]);
    } finally {
      setCodeBezig(false);
    }
    if (!ok) return; // de datalaag meldt de fout of het conflict zelf
    notify(`Code ${code.toUpperCase()} toegevoegd als planningscode.`, 'success');
    setNieuweCode(null);
    setHighlightedCode((cur) => (cur === normalizePlanningToken(code) ? null : cur));
  };
  // Gebruikers met de zoekterm al ingevuld (?zoek= bestaat daar): de planner
  // staat meteen op de juiste rij om de naam te vergelijken of aan te passen.
  const openGebruiker = (naam: string) => {
    navigeer('gebruikers');
    const url = new URL(window.location.href);
    url.searchParams.set('zoek', naam);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    window.dispatchEvent(new CustomEvent('vhb-route'));
  };

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
      const formattedDate = formatDatumDMJ(row.source_date);
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
    // csvTekst: chauffeursnaam/code/details komen uit de Excel — formule-guard.
    const csv = csvTekst([
      header,
      ...problemReportRows.map((row) => [row.date, row.dayType, row.type, row.driver, row.code, row.details]),
    ], ';');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    void downloadBlob('planning-matrix-problemen.csv', blob);
  };

    return (
    <PageShell breed>
      <PageHeader
        view="planning-matrix"
        title="Planningsoverzicht"
      />
      {/* OpsStat i.p.v. StatCard (vaste regel voor KPI-strips): vaste
          twee-regel-labelzone, dus cijfers en subteksten op één lijn. */}
      <div className="kpi-raster grid grid-cols-2 gap-3 md:grid-cols-3">
        <OpsStat
          icon={<Clock size={16} />}
          tone="emerald"
          label="Gegenereerde diensten"
          value={derived.totalGeneratedServices}
          sub="gematcht vanuit Dienstoverzicht"
        />
        <OpsStat
          icon={<AlertTriangle size={16} />}
          tone={derived.globalUnknownCodes.length > 0 ? 'amber' : 'slate'}
          label="Onbekende codes"
          value={derived.globalUnknownCodes.length}
          sub={derived.globalUnknownCodes.length === 0 ? 'alles herkend' : derived.globalUnknownCodes.slice(0, 3).join(' · ')}
        />
        <OpsStat
          icon={<Users size={16} />}
          tone={derived.globalUnmatchedDrivers.length > 0 ? 'amber' : 'slate'}
          label="Niet-gematchte chauffeurs"
          value={derived.globalUnmatchedDrivers.length}
          sub={derived.globalUnmatchedDrivers.length === 0 ? 'alles gekoppeld' : derived.globalUnmatchedDrivers.slice(0, 2).join(' · ')}
        />
      </div>

      <Card as="section">
        <CardHeader
          title="Controlepunten"
          description="Klik een onbekende code om enkel die toewijzingen te bekijken."
          aside={(
            <>
              <FilterChip active={showOnlyIssues} onClick={() => setShowOnlyIssues((current) => !current)}>
                {showOnlyIssues ? 'Alleen probleemdagen' : 'Alle dagen'}
              </FilterChip>
              {highlightedCode ? (
                <Button size="sm" variant="ghost" onClick={() => setHighlightedCode(null)}>
                  Codefilter wissen
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                icon={<Download size={14} />}
                onClick={exportProblemReport}
                disabled={derived.globalUnknownCodes.length === 0 && derived.globalUnmatchedDrivers.length === 0}
              >
                Exporteer problemen
              </Button>
            </>
          )}
        />

        {/* Neutrale vlakken; de teller-badge is het enige accent (rood =
            onbekende code, amber = niet-gematchte chauffeur). */}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card tone="muted" padding="sm">
            <div className="flex items-center justify-between gap-3">
              <MicroLabel>Onbekende codes</MicroLabel>
              <Badge tone={derived.globalUnknownCodes.length > 0 ? 'red' : 'slate'} className="tabular-nums">{derived.globalUnknownCodes.length}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnknownCodes.length > 0 ? derived.globalUnknownCodes.map((code) => (
                <span key={`list-${code}`} className="inline-flex items-center gap-0.5">
                  <FilterChip tone="red" active={highlightedCode === code} onClick={() => setHighlightedCode(code)}>
                    {code}
                  </FilterChip>
                  {savePlanningCodes && (
                    <IconButton label={`Voeg ${code} toe als planningscode`} variant="ghost" size="sm" onClick={() => openNieuweCode(code)}>
                      <Plus size={14} />
                    </IconButton>
                  )}
                </span>
              )) : (
                <span className="text-sm text-slate-500">Geen onbekende codes gevonden.</span>
              )}
            </div>
            {derived.globalUnknownCodes.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={onOpenPlanningCodes}>
                  Open planningscodes
                </Button>
                <Button size="sm" variant="ghost" onClick={onOpenServiceOverview}>
                  Open dienstoverzicht
                </Button>
              </div>
            ) : null}
          </Card>

          <Card tone="muted" padding="sm">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5">
                <MicroLabel>Niet-gematchte chauffeurs</MicroLabel>
                <InfoTip label="Hoe koppelt het portaal een naam?">
                  Het portaal koppelt de naam uit de Excel aan een gebruiker op naam; volgorde (voor- of achternaam eerst), hoofdletters en accenten tellen niet mee. Staat de naam anders gespeld, pas hem dan aan bij de gebruiker (Open gebruiker) of in de Excel. Een aparte alias per gebruiker bestaat nog niet.
                </InfoTip>
              </span>
              <Badge tone={derived.globalUnmatchedDrivers.length > 0 ? 'amber' : 'slate'} className="tabular-nums">{derived.globalUnmatchedDrivers.length}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnmatchedDrivers.length > 0 ? derived.globalUnmatchedDrivers.map((driver) => {
                // Fuzzy-suggestie: "Duysbergh Pascal" (typo) → "≈ Duysburgh Pascal?"
                const suggestion = suggestClosestName(driver, users.map((u) => ({ id: String(u.id), name: u.name })));
                return (
                  <span key={driver} className="inline-flex items-center gap-1">
                    <Badge tone="amber">
                      {driver}
                      {suggestion && <span className="font-normal text-amber-700/90">≈ {suggestion.name}?</span>}
                    </Badge>
                    {canOpenUserManagement && (
                      <Button size="sm" variant="ghost" icon={<UserSearch size={14} />} onClick={() => openGebruiker(suggestion?.name ?? driver)}>
                        Open gebruiker
                      </Button>
                    )}
                  </span>
                );
              }) : (
                <span className="text-sm text-slate-500">Alle chauffeurs zijn gekoppeld.</span>
              )}
            </div>
            {derived.globalUnmatchedDrivers.length > 0 ? (
              <div className="mt-4">
                {canOpenUserManagement ? (
                  <Button size="sm" variant="secondary" onClick={onOpenUserManagement}>
                    Open gebruikers
                  </Button>
                ) : (
                  <Badge tone="slate">Gebruikers: alleen admin</Badge>
                )}
              </div>
            ) : null}
          </Card>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card as="section">
          <CardHeader
            className="mb-5"
            title="Geüploade dagen"
            description={<>{visibleRows.length} getoond, {derived.rowsWithIssues.length} met controlepunten.</>}
            aside={(
              <InfoTip label="Uitleg bij de dagen" align="right">
                {derived.rowsWithAssignments.length} van de {deferredRows.length} dagen hebben effectieve toewijzingen. Kies een dag om de codes per chauffeur te bekijken; dagen met onbekende codes of niet-gematchte chauffeurs zijn gemarkeerd.
              </InfoTip>
            )}
          />
          <div className="max-h-[70vh] overflow-y-auto pr-2">
            {visibleDayRows.length > 0 ? (
              // Echte lijst; de gekozen dag draagt aria-current (tranche 3B).
              <ul className="space-y-3" aria-label="Geüploade dagen">
                {visibleDayRows.map((row) => {
                  const summary = derived.daySummaryByDate.get(row.source_date);
                  const assignmentCount = summary?.assignmentCount || 0;
                  const generatedServices = summary?.generatedServices || 0;
                  const rowUnknownCodes = summary?.unknownCodeCount || 0;
                  const rowUnmatchedDrivers = summary?.unmatchedDriverCount || 0;
                  const isActive = row.source_date === selectedDate;
                  return (
                    <li key={row.id}>
                      {/* rauw: dagkaart-als-knop met eigen layout (datum, tellingen, badges) */}
                      <button
                        type="button"
                        onClick={() => setSelectedDate(row.source_date)}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                          'ios-pressable w-full rounded-2xl border px-4 py-3 text-left',
                          isActive ? 'border-hairline-strong bg-surface-muted' : 'border-hairline-subtle bg-surface-field hover:bg-surface-soft-hover'
                        )}
                      >
                        <span className="block text-sm font-semibold text-slate-800">{dagKort(row.source_date)}</span>
                        <span className="mt-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
                          <span>Dagtype {row.day_type || '—'}</span>
                          <span>{assignmentCount} codes</span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between text-xs font-medium text-slate-500">
                          <span>{generatedServices} diensten</span>
                          {rowUnknownCodes > 0 || rowUnmatchedDrivers > 0 || (generatedServices === 0 && assignmentCount > 0)
                            ? <span className="font-semibold text-amber-700">controle nodig</span>
                            : null}
                        </span>
                        {(rowUnknownCodes > 0 || rowUnmatchedDrivers > 0) ? (
                          <span className="mt-2 flex flex-wrap gap-1.5">
                            {rowUnknownCodes > 0 ? (
                              <Badge tone="red">{rowUnknownCodes} onbekend</Badge>
                            ) : null}
                            {rowUnmatchedDrivers > 0 ? (
                              <Badge tone="amber">{rowUnmatchedDrivers} chauffeur</Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                variant={showOnlyIssues ? 'klaar' : 'leeg'}
                title={showOnlyIssues ? "Geen probleemdagen gevonden" : "Nog geen matrixplanning"}
                message={showOnlyIssues ? 'Alle geüploade dagen zijn volledig herkend.' : 'Upload eerst een Excel-matrix via Beheer planning om hier een overzicht te zien.'}
              />
            )}
            {visibleRows.length > visibleDayRows.length ? (
              <Button
                size="sm"
                variant="secondary"
                full
                className="mt-3"
                onClick={() => setVisibleDayCount((current) => current + 60)}
              >
                Toon meer dagen ({visibleRows.length - visibleDayRows.length} resterend)
              </Button>
            ) : null}
          </div>
        </Card>

        <Card as="section">
          {selectedRow ? (
            <>
              <CardHeader
                className="mb-5"
                title={dagLang(selectedRow.source_date)}
                description={<span>Dagtype {selectedRow.day_type || '—'} · {assignments.length} ingevulde chauffeurcodes.</span>}
              />

              <div className="kpi-raster grid grid-cols-2 gap-3 md:grid-cols-3">
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
                  label="Herkende diensten"
                  value={serviceAssignments}
                  sub="gematcht met Dienstoverzicht"
                />
                <OpsStat
                  icon={<AlertTriangle size={16} />}
                  tone={unknownAssignments > 0 ? 'amber' : 'slate'}
                  label="Onbekende codes"
                  value={unknownAssignments}
                  sub={unknownAssignments === 0 ? 'alles herkend' : 'nog te mappen'}
                />
              </div>

              {(unknownAssignments > 0 || unmatchedDriversForSelectedDay.length > 0 || highlightedCode) ? (
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <Card tone="muted" padding="sm">
                    <div className="flex items-center justify-between gap-3">
                      <MicroLabel>Niet-gematchte chauffeurs</MicroLabel>
                      <Badge tone={unmatchedDriversForSelectedDay.length > 0 ? 'amber' : 'slate'} className="tabular-nums">{unmatchedDriversForSelectedDay.length}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {unmatchedDriversForSelectedDay.length > 0 ? unmatchedDriversForSelectedDay.map((driver) => (
                        <Fragment key={driver}><Badge tone="amber">{driver}</Badge></Fragment>
                      )) : (
                        <span className="text-sm text-slate-500">Geen niet-gematchte chauffeurs voor deze dag.</span>
                      )}
                    </div>
                    {unmatchedDriversForSelectedDay.length > 0 ? (
                      <div className="mt-4">
                        {canOpenUserManagement ? (
                          <Button size="sm" variant="secondary" onClick={onOpenUserManagement}>
                            Open gebruikers
                          </Button>
                        ) : (
                          <Badge tone="slate">Gebruikers: alleen admin</Badge>
                        )}
                      </div>
                    ) : null}
                  </Card>
                  <Card tone="muted" padding="sm">
                    <div className="flex items-center justify-between gap-3">
                      <MicroLabel>{unknownAssignments > 0 ? 'Onbekende codes' : 'Codefilter'}</MicroLabel>
                      {unknownAssignments > 0 ? <Badge tone="red" className="tabular-nums">{unknownAssignments}</Badge> : null}
                    </div>
                    <p className="mt-3 text-sm text-slate-600">
                      {unknownAssignments > 0
                        ? `${unknownAssignments} toewijzing${unknownAssignments === 1 ? '' : 'en'} op deze dag ${unknownAssignments === 1 ? 'vraagt' : 'vragen'} nog interpretatie via Planningscodes of Dienstoverzicht.`
                        : highlightedCode
                          ? `Je bekijkt nu enkel toewijzingen met code ${highlightedCode}.`
                          : 'Geen actieve codefilter.'}
                    </p>
                    {unknownAssignments > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={onOpenPlanningCodes}>
                          Open planningscodes
                        </Button>
                        <Button size="sm" variant="ghost" onClick={onOpenServiceOverview}>
                          Open dienstoverzicht
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                </div>
              ) : null}

              {/* Toewijzingen van de gekozen dag. Tabel vanaf md (vier korte
                  kolommen, past in de kaart: `past`, dus de kop plakt onder de
                  topbar bij een lange dag), op de telefoon een lijst met
                  dezelfde gegevens én dezelfde actie (onbekende code toevoegen). */}
              <TableShell className="mt-5" past label={`Toewijzingen op ${dagKort(selectedRow.source_date)}`}>
                <div className="hidden md:block">
                  <Tabel>
                    <StickyThead>
                      <tr>
                        <Th>Chauffeur</Th>
                        <Th>Code</Th>
                        <Th>Interpretatie</Th>
                        <Th>Uren / status</Th>
                      </tr>
                    </StickyThead>
                    <tbody>
                      {filteredAssignments.map((assignment) => (
                        <tr key={assignment.driver} className="border-b border-hairline-subtle last:border-b-0 transition-colors hover:bg-surface-soft-hover">
                          <Th scope="row" className="py-3 text-sm font-semibold text-slate-800 whitespace-normal">{assignment.driver}</Th>
                          <Td nowrap>
                            <span className="inline-flex items-center gap-0.5">
                              <Chip tone={celBadgeTone(assignment)} className="uppercase">
                                {assignment.code}
                              </Chip>
                              {assignment.kind === 'unknown' && savePlanningCodes && (
                                <IconButton label={`Voeg ${assignment.code} toe als planningscode`} variant="ghost" size="sm" onClick={() => openNieuweCode(assignment.code)}>
                                  <Plus size={14} />
                                </IconButton>
                              )}
                            </span>
                          </Td>
                          <Td className="font-semibold text-slate-800">{assignment.label}</Td>
                          <Td className="text-slate-500">{assignment.details}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabel>
                </div>

                <ul className="divide-y divide-hairline-subtle md:hidden">
                  {filteredAssignments.map((assignment) => (
                    <li key={assignment.driver} className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">{assignment.driver}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-0.5">
                          <Chip tone={celBadgeTone(assignment)} className="uppercase">
                            {assignment.code}
                          </Chip>
                          {/* Zelfde actie als in de tabel (was er op de telefoon niet). */}
                          {assignment.kind === 'unknown' && savePlanningCodes && (
                            <IconButton label={`Voeg ${assignment.code} toe als planningscode`} variant="ghost" size="sm" onClick={() => openNieuweCode(assignment.code)}>
                              <Plus size={14} />
                            </IconButton>
                          )}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">{assignment.label}</span>
                      </div>
                      {assignment.details ? <p className="mt-1.5 text-body-sm text-slate-500">{assignment.details}</p> : null}
                    </li>
                  ))}
                </ul>
              </TableShell>
            </>
          ) : (
            <EmptyState
              title="Geen dag geselecteerd"
              message="Kies links een geüploade dag om de actuele matrixplanning te bekijken."
            />
          )}
        </Card>
      </div>

      {/* Onbekende code als planningscode vastleggen zonder schermwissel. */}
      <Modal open={!!nieuweCode} onClose={() => setNieuweCode(null)} vuil={codeVuil} maxWidth="sm" className="!p-0" ariaLabel="Planningscode toevoegen">
        {nieuweCode && (
          <Formulier onVerstuur={bewaarNieuweCode}>
            <ModalHeader
              title={`Code ${nieuweCode.code.toUpperCase()} toevoegen`}
              description="Komt in dezelfde lijst als Planningscodes en is meteen herkend in elke geüploade dag."
              onClose={() => setNieuweCode(null)}
            />
            <div className="space-y-4 p-6">
              <Field label="Code" error={codeFouten.fouten.code}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} aria-describedby={describedBy} invalid={invalid} value={nieuweCode.code} readOnly className="font-mono uppercase" />
                )}
              </Field>
              <Field label="Betekenis" hint="Wat de code in de Excel betekent, bv. “bijscholing” of “recup”.">
                {({ id, describedBy }) => (
                  <Input id={id} aria-describedby={describedBy} value={nieuweCode.description} autoFocus onChange={(e) => setNieuweCode({ ...nieuweCode, description: e.target.value })} />
                )}
              </Field>
              <Field label="Categorie" hint="Telt als dienst, betaald of vrije dag stel je daarna bij in Planningscodes.">
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} value={nieuweCode.category} onChange={(e) => setNieuweCode({ ...nieuweCode, category: e.target.value as PlanningCode['category'] })}>
                    {CATEGORIE_OPTIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                )}
              </Field>
              <div className="flex justify-end gap-2 pt-1">
                <SluitKnop onClose={() => setNieuweCode(null)} variant="secondary" disabled={codeBezig}>Annuleren</SluitKnop>
                <Button type="submit" variant="primary" bezig={codeBezig} icon={<Plus size={16} />}>Toevoegen</Button>
              </div>
            </div>
          </Formulier>
        )}
      </Modal>
    </PageShell>
    );
  } catch (error) {
    console.error('Planningsoverzicht renderfout:', error);
    return (
      <Card tone="danger">
        <MicroLabel className="text-red-700">Schermfout</MicroLabel>
        <h3 className="mt-2 text-card-title">Planningsoverzicht kon niet geladen worden</h3>
        <p className="mt-1.5 text-sm text-slate-600">
          {error instanceof Error ? error.message : 'Onbekende renderfout'}
        </p>
      </Card>
    );
  }
}
