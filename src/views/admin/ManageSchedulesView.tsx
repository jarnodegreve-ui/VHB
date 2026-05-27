import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, AlertTriangle, ChevronDown, Database, Info, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { PlanningMatrixImportHistory, Shift, User } from '../../types';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { AdminSubsectionHeader, ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Input } from '../../components/Input';
import { ScheduleView } from '../ScheduleView';

export function ManageSchedulesView({ shifts, onSave, users, history, canAdminOverride, onMatrixImported }: { shifts: Shift[], onSave: (s: Shift[]) => void | Promise<void>, users: User[], history: PlanningMatrixImportHistory[], canAdminOverride: boolean, onMatrixImported: () => Promise<void> }) {
  const [jsonInput, setJsonInput] = useState('');
  const [showExcelInfo, setShowExcelInfo] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [isMatrixImporting, setIsMatrixImporting] = useState(false);
  const [matrixPreviewOpen, setMatrixPreviewOpen] = useState(false);
  // Base64-encoded inhoud van het geüploade .xls/.xlsx-bestand. Blijft in
  // state zodat de gebruiker in de preview kan bevestigen zonder opnieuw
  // te uploaden. Voorheen heette dit `pendingMatrixCsv`; nu dragen we de
  // ruwe Excel mee i.p.v. een CSV-string.
  const [pendingMatrixXlsxBase64, setPendingMatrixXlsxBase64] = useState('');
  const [pendingMatrixFilename, setPendingMatrixFilename] = useState('');
  const [matrixPreview, setMatrixPreview] = useState<null | {
    importedDays: number;
    detectedDrivers: number;
    generatedShifts: number;
    matchedServices: number;
    skippedAbsences: number;
    startDate: string | null;
    endDate: string | null;
    importedDates: string[];
    unknownCodes: string[];
    unmatchedDrivers: string[];
    verlofConflicts: Array<{ driverId: string; driverName: string; date: string; serviceNumber: string; leaveStart: string; leaveEnd: string }>;
    servicesWithoutSegments: string[];
    perDriver: Array<{
      driverName: string;
      driverId: string;
      daysWithCode: number;
      shiftsGenerated: number;
      servicesMatched: number;
      absences: number;
      servicesWithoutSegments: number;
    }>;
  }>(null);
  const matrixPreviewHasIssues = !!matrixPreview && (matrixPreview.unknownCodes.length > 0 || matrixPreview.unmatchedDrivers.length > 0 || matrixPreview.verlofConflicts.length > 0);

  // Wijzigingen sinds laatste matrix-import (in-app verlof + dienstruil
  // beslissingen die nog niet in Excel verwerkt zijn).
  const [changesSinceImport, setChangesSinceImport] = useState<null | {
    lastImport: { createdAt: string; importedDays: number } | null;
    approvedLeave: Array<{ id: string; userName: string | null; startDate: string; endDate: string; type: string; decidedAt?: string }>;
    approvedSwaps: Array<{ id: string; requesterName: string | null; targetName: string | null; decidedAt?: string }>;
  }>(null);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const [printDriverId, setPrintDriverId] = useState<string>('');
  const [printMonth, setPrintMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchChangesSince = async () => {
    try {
      const response = await fetch('/api/planning-matrix/changes-since-import', {
        headers: await getSupabaseAuthHeaders(),
      });
      if (!response.ok) return;
      const data = await response.json();
      setChangesSinceImport(data);
    } catch (err) {
      console.error('changes-since-import fetch error:', err);
    }
  };

  useEffect(() => {
    fetchChangesSince();
  }, []);
  const matrixOverwriteSummary = useMemo(() => {
    if (!matrixPreview) return null;

    const importedDateSet = new Set(matrixPreview.importedDates);
    const existingDates = shifts.map((shift) => shift.date).filter(Boolean).sort();
    const currentStartDate = existingDates[0] || null;
    const currentEndDate = existingDates[existingDates.length - 1] || null;
    const affectedExistingShifts = importedDateSet.size > 0
      ? shifts.filter((shift) => importedDateSet.has(shift.date)).length
      : 0;

    return {
      currentShiftCount: shifts.length,
      affectedExistingShifts,
      incomingShiftCount: matrixPreview.generatedShifts,
      currentStartDate,
      currentEndDate,
    };
  }, [matrixPreview, shifts]);

  const handleImport = () => {
    if (!canAdminOverride) {
      notify('JSON fallback-import is alleen beschikbaar voor admins.', 'error');
      return;
    }
    try {
      const data = JSON.parse(jsonInput);
      if (Array.isArray(data)) {
        onSave(data);
        setJsonInput('');
        notify('Planning succesvol geïmporteerd!', 'success');
      } else {
        notify('Ongeldig formaat. Zorg dat het een array van diensten is.', 'error');
      }
    } catch (e) {
      notify('Fout bij het parsen van JSON. Controleer de syntax.', 'error');
    }
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearingPlanning, setIsClearingPlanning] = useState(false);

  // Lees binary file → base64 in chunks. btoa(String.fromCharCode(...arr))
  // klapt over de stack-limit voor bestanden > ~1MB, dus we hakken het in
  // stukken van 32 KB en concateneren.
  const fileToBase64 = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
  };

  const handleMatrixFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsMatrixImporting(true);
      const xlsxBase64 = await fileToBase64(file);
      const response = await fetch('/api/planning-matrix/preview', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ xlsxBase64 }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Import mislukt.');
      }

      setPendingMatrixXlsxBase64(xlsxBase64);
      setPendingMatrixFilename(file.name);
      setMatrixPreview({
        importedDays: data.importedDays || 0,
        detectedDrivers: data.detectedDrivers || 0,
        generatedShifts: data.generatedShifts || 0,
        matchedServices: data.matchedServices || 0,
        skippedAbsences: data.skippedAbsences || 0,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        importedDates: Array.isArray(data.importedDates) ? data.importedDates : [],
        unknownCodes: Array.isArray(data.unknownCodes) ? data.unknownCodes : [],
        unmatchedDrivers: Array.isArray(data.unmatchedDrivers) ? data.unmatchedDrivers : [],
        verlofConflicts: Array.isArray(data.verlofConflicts) ? data.verlofConflicts : [],
        servicesWithoutSegments: Array.isArray(data.servicesWithoutSegments) ? data.servicesWithoutSegments : [],
        perDriver: Array.isArray(data.perDriver) ? data.perDriver : [],
      });
      setMatrixPreviewOpen(true);
    } catch (error: any) {
      notify(`Excel-preview mislukt: ${error.message}`, 'error');
    } finally {
      setIsMatrixImporting(false);
      if (event.target) event.target.value = '';
    }
  };

  const confirmMatrixImport = async () => {
    if (!pendingMatrixXlsxBase64) {
      notify('Er is geen matrixbestand klaar om te importeren.', 'error');
      return;
    }

    try {
      setIsMatrixImporting(true);
      const response = await fetch('/api/planning-matrix/import', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ xlsxBase64: pendingMatrixXlsxBase64 }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Import mislukt.');
      }

      const syncNotes: string[] = [];
      if (Array.isArray(data.unknownCodes) && data.unknownCodes.length > 0) {
        syncNotes.push(`${data.unknownCodes.length} onbekende code${data.unknownCodes.length === 1 ? '' : 's'}`);
      }
      if (Array.isArray(data.unmatchedDrivers) && data.unmatchedDrivers.length > 0) {
        syncNotes.push(`${data.unmatchedDrivers.length} niet-gematchte chauffeur${data.unmatchedDrivers.length === 1 ? '' : 's'}`);
      }

      notify(
        `Matrixplanning geïmporteerd: ${data.importedDays || 0} dagen, ${data.generatedShifts || 0} roosterregels opgebouwd${syncNotes.length ? `, ${syncNotes.join(', ')}` : ''}.`,
        'success'
      );
      setMatrixPreviewOpen(false);
      setPendingMatrixXlsxBase64('');
      setPendingMatrixFilename('');
      setMatrixPreview(null);
      await onMatrixImported();
      await fetchChangesSince();
    } catch (error: any) {
      notify(`Excel-import mislukt: ${error.message}`, 'error');
    } finally {
      setIsMatrixImporting(false);
    }
  };

  const handleSync = async () => {
    if (!canAdminOverride) {
      notify('Deze synchronisatie is alleen beschikbaar voor admins.', 'error');
      return;
    }
    try {
      setIsSyncing(true);
      const response = await fetch('/api/planning/sync-from-matrix', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
      });
      const text = await response.text();
      
      if (!response.ok && !text.startsWith('{')) {
        throw new Error(`Server fout (${response.status}): ${text.slice(0, 200) || 'Lege response'}`);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse JSON. Response text:', text);
        throw new Error('Server gaf geen geldig JSON-antwoord terug. Controleer de console voor details.');
      }

      if (data.success) {
        const syncNotes: string[] = [];
        if (Array.isArray(data.unknownCodes) && data.unknownCodes.length > 0) {
          syncNotes.push(`${data.unknownCodes.length} onbekende code${data.unknownCodes.length === 1 ? '' : 's'}`);
        }
        if (Array.isArray(data.unmatchedDrivers) && data.unmatchedDrivers.length > 0) {
          syncNotes.push(`${data.unmatchedDrivers.length} niet-gematchte chauffeur${data.unmatchedDrivers.length === 1 ? '' : 's'}`);
        }
        notify(`Planning opnieuw opgebouwd: ${data.generatedShifts || 0} roosterregels${syncNotes.length ? `, ${syncNotes.join(', ')}` : ''}.`, 'success');
        await onMatrixImported();
      } else {
        notify('Synchronisatie mislukt: ' + (data.error || 'Onbekende fout'), 'error');
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      notify('Er is een fout opgetreden bij het synchroniseren: ' + error.message, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearPlanning = async () => {
    if (!canAdminOverride) {
      notify('Planning wissen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    try {
      setIsClearingPlanning(true);
      await Promise.resolve(onSave([]));
      notify('Actieve planning gewist.', 'success');
      setConfirmClearOpen(false);
    } catch (error: any) {
      notify(`Planning wissen mislukt: ${error.message || 'Onbekende fout'}`, 'error');
    } finally {
      setIsClearingPlanning(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Planningbeheer"
        title="Beheer Roosters"
        description="Importeer matrixplanning, bouw de actieve planning opnieuw op en controleer recente imports op problemen voordat je iets overschrijft."
        actions={canAdminOverride ? (
          <button 
            onClick={() => setConfirmSyncOpen(true)}
            disabled={isSyncing}
            className="w-full sm:w-auto bg-emerald-500 text-white px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95"
            title="Synchroniseer lokale JSON data naar Supabase"
          >
            <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? 'Synchroniseren...' : 'Sync naar DB'}
          </button>
        ) : null}
      />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_minmax(0,0.9fr)]">
        <div className="surface-card rounded-[32px] p-6 md:p-8">
          <AdminSubsectionHeader
            eyebrow="Importbronnen"
            title="Matrix en fallback-import"
            description="Upload het originele Excel-bestand. De praktijk-tab wordt server-side gelezen — geen CSV-export of conversie nodig."
            aside={showExcelInfo ? (
              <button
                onClick={() => setShowExcelInfo(false)}
                className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:text-slate-800"
              >
                Info verbergen
              </button>
            ) : (
              <button
                onClick={() => setShowExcelInfo(true)}
                className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:text-slate-800"
              >
                Info tonen
              </button>
            )}
          />

          {showExcelInfo && (
            <div className="mt-5 rounded-[24px] border border-oker-100 bg-oker-50/80 p-5 text-sm">
              <p className="font-bold text-oker-800">Importvolgorde</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-oker-700">
                <li>Upload het hele <code className="rounded bg-white/70 px-1.5 py-0.5 text-[11px]">.xls</code>/<code className="rounded bg-white/70 px-1.5 py-0.5 text-[11px]">.xlsx</code>-bestand. De server leest de praktijk-tab automatisch.</li>
                <li>Controleer in de preview: dagen, diensten, onbekende codes, niet-gematchte chauffeurs en services zonder uren.</li>
                <li>JSON-import blijft beschikbaar voor oudere rij-per-dienst exports.</li>
              </ol>
            </div>
          )}

          {(() => {
            if (!changesSinceImport) {
              return null;
            }
            const totalChanges = changesSinceImport.approvedLeave.length + changesSinceImport.approvedSwaps.length;
            const hasChanges = totalChanges > 0;
            const lastImportLabel = changesSinceImport.lastImport
              ? new Date(changesSinceImport.lastImport.createdAt).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })
              : 'nog nooit';

            const accent = hasChanges
              ? { border: 'border-amber-200', bg: 'bg-amber-50/70', icon: 'bg-amber-100 text-amber-700', eyebrow: 'text-amber-700', body: 'text-amber-900', stamp: 'text-amber-600' }
              : { border: 'border-emerald-200', bg: 'bg-emerald-50/70', icon: 'bg-emerald-100 text-emerald-700', eyebrow: 'text-emerald-700', body: 'text-emerald-900', stamp: 'text-emerald-600' };

            return (
              <div className={cn('mt-6 rounded-[28px] border p-5', accent.border, accent.bg)}>
                <button
                  type="button"
                  onClick={() => hasChanges && setChangesExpanded((v) => !v)}
                  disabled={!hasChanges}
                  className="flex w-full items-start justify-between gap-4 text-left disabled:cursor-default"
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('rounded-2xl p-2', accent.icon)}>
                      {hasChanges ? <AlertTriangle size={18} /> : <Activity size={18} />}
                    </div>
                    <div>
                      <p className={cn('text-[10px] font-black uppercase tracking-[0.18em]', accent.eyebrow)}>Voor je uploadt</p>
                      <h4 className="mt-1 text-base font-black tracking-tight text-slate-900">
                        {hasChanges ? 'Wijzigingen sinds vorige import' : 'Geen wijzigingen sinds vorige import'}
                      </h4>
                      <p className={cn('mt-1 text-sm font-medium', accent.body)}>
                        {hasChanges
                          ? `${changesSinceImport.approvedLeave.length} verlof${changesSinceImport.approvedLeave.length === 1 ? '' : 'en'} en ${changesSinceImport.approvedSwaps.length} dienstruil${changesSinceImport.approvedSwaps.length === 1 ? '' : 'en'} goedgekeurd. Controleer of deze in jouw Excel verwerkt zijn.`
                          : 'Geen verloven of dienstruilen goedgekeurd in de app sinds je laatste matrix-import. Excel en app zijn in sync.'}
                      </p>
                      <p className={cn('mt-1 text-[10px] font-bold uppercase tracking-widest', accent.stamp)}>
                        Laatste import: {lastImportLabel}
                      </p>
                    </div>
                  </div>
                  {hasChanges && (
                    <ChevronDown size={18} className={cn('shrink-0 mt-1 transition-transform', accent.eyebrow, changesExpanded && 'rotate-180')} />
                  )}
                </button>
                {hasChanges && changesExpanded && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className={cn('text-[10px] font-black uppercase tracking-widest mb-2', accent.eyebrow)}>Verlof</p>
                      {changesSinceImport.approvedLeave.length > 0 ? (
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {changesSinceImport.approvedLeave.map((l) => (
                            <li key={l.id} className="flex items-start gap-2">
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                              <span>
                                <span className="font-black">{l.userName}</span>
                                {' — '}
                                {l.startDate}{l.startDate !== l.endDate ? ` t/m ${l.endDate}` : ''}
                                {l.type ? ` (${l.type})` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs italic text-slate-400">Geen.</p>
                      )}
                    </div>
                    <div>
                      <p className={cn('text-[10px] font-black uppercase tracking-widest mb-2', accent.eyebrow)}>Dienstruil</p>
                      {changesSinceImport.approvedSwaps.length > 0 ? (
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {changesSinceImport.approvedSwaps.map((s) => (
                            <li key={s.id} className="flex items-start gap-2">
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                              <span>
                                <span className="font-black">{s.requesterName}</span>
                                {' → '}
                                <span className="font-black">{s.targetName || '?'}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs italic text-slate-400">Geen.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[28px] border border-emerald-100 bg-emerald-50/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Primair</p>
                  <h4 className="mt-2 text-base font-black tracking-tight text-slate-900">Excel Matrix Upload</h4>
                  <p className="mt-2 text-sm font-medium text-slate-600">
                    Upload je originele <code className="rounded bg-white/70 px-1.5 py-0.5 text-[11px]">.xls</code>/<code className="rounded bg-white/70 px-1.5 py-0.5 text-[11px]">.xlsx</code>-bestand. De server leest de praktijk-tab; je krijgt een preview met per-chauffeur breakdown voor je iets overschrijft.
                  </p>
                  {pendingMatrixFilename && (
                    <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                      Geladen: {pendingMatrixFilename}
                    </p>
                  )}
                </div>
                <span className="rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                  Aangeraden
                </span>
              </div>
              <label
                className={cn(
                  "mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl px-6 py-4 text-xs font-black uppercase tracking-widest transition-all",
                  isMatrixImporting ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"
                )}
              >
                <Upload size={18} />
                {isMatrixImporting ? 'Importeren...' : 'Excel Matrix Upload'}
                <input
                  type="file"
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleMatrixFileUpload}
                  disabled={isMatrixImporting}
                />
              </label>
            </div>

            {canAdminOverride ? (
            <div className="rounded-[28px] border border-white/70 bg-white/45 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Fallback</p>
                  <h4 className="mt-2 text-base font-black tracking-tight text-slate-900">JSON Import</h4>
                  <p className="mt-2 text-sm font-medium text-slate-500">
                    Gebruik dit alleen als je planning al per dienst in JSON is geëxporteerd. Dit pad is bedoeld voor oudere dataflows.
                  </p>
                </div>
                <span className="rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Legacy
                </span>
              </div>
              <textarea
                className="control-input mt-5 min-h-[170px] w-full rounded-2xl px-4 py-3 font-mono text-sm transition-all focus:outline-none"
                placeholder='Plak hier de JSON data uit Excel... e.g. [{"id":"1","date":"2026-03-01",...}]'
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
              />
              <button
                onClick={handleImport}
                className="btn-primary ios-pressable mt-4 inline-flex w-full items-center justify-center px-6 py-4 text-xs uppercase tracking-widest"
              >
                Importeer JSON Planning
              </button>
            </div>
            ) : (
            <div className="rounded-[28px] border border-white/70 bg-white/45 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Admin pad</p>
                  <h4 className="mt-2 text-base font-black tracking-tight text-slate-900">Fallback en sync</h4>
                  <p className="mt-2 text-sm font-medium text-slate-500">
                    JSON fallback-import, handmatige planning sync en directe overschrijvingen zijn afgeschermd voor admins. Gebruik als planner de matrix-upload hierboven.
                  </p>
                </div>
                <span className="rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Admin only
                </span>
              </div>
            </div>
            )}
          </div>
        </div>

        {canAdminOverride ? (
        <div className="surface-card rounded-[32px] p-6 md:p-8">
          <AdminSubsectionHeader
            eyebrow="Database"
            title="Actieve planning herschrijven"
            description="Gebruik sync om de actuele planning opnieuw op te bouwen of wis de planning volledig wanneer een nieuwe planning later volgt."
          />
          <div className="mt-5 space-y-4">
            <div className="rounded-[24px] border border-white/70 bg-white/45 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Opnieuw opbouwen</p>
              <p className="mt-2 text-sm font-medium text-slate-500">
                Dit pad vervangt de actieve planning met de recentste matrixopbouw. Gebruik dit als je de matrix al gecontroleerd hebt en de actuele planning wilt overschrijven.
              </p>
              <button
                onClick={() => setConfirmSyncOpen(true)}
                disabled={isSyncing}
                className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-6 py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 disabled:opacity-50 active:scale-95"
                title="Synchroniseer lokale JSON data naar Supabase"
              >
                <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
                {isSyncing ? 'Synchroniseren...' : 'Planning Overschrijven'}
              </button>
            </div>

            <div className="rounded-[24px] border border-red-200/70 bg-red-50/80 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-700">Leegmaken</p>
              <p className="mt-2 text-sm font-medium text-red-700/80">
                Wis alle actieve roosterregels in het portaal. Handig wanneer de planning volledig vervangen wordt en je eerst een lege toestand wilt.
              </p>
              <button
                onClick={() => setConfirmClearOpen(true)}
                disabled={isClearingPlanning}
                className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-red-200 bg-white px-6 py-4 text-xs font-black uppercase tracking-widest text-red-700 transition-all hover:bg-red-100 disabled:opacity-50 active:scale-95"
              >
                <Trash2 size={18} />
                {isClearingPlanning ? 'Wissen...' : 'Planning Wissen'}
              </button>
            </div>
          </div>
        </div>
        ) : null}
      </div>

      {canAdminOverride ? (
      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <AdminSubsectionHeader
          eyebrow="Correcties"
          title="Handmatig toevoegen"
          description="Gebruik dit alleen voor uitzonderingen of snelle correcties buiten de matrixflow."
        />
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5 md:gap-6">
          <Input label="Datum" type="date" />
          <Input label="Chauffeur" type="select" options={[...users].filter(u => u.role === 'chauffeur' && u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)).map(u => ({ label: u.name, value: u.id }))} />
          <Input label="Start Tijd" type="time" />
          <Input label="Eind Tijd" type="time" />
          <Input label="Dienst" type="text" placeholder="Bijv. 12" />
        </div>
        <div className="mt-6 flex justify-end">
          <button className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-500 px-8 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-95 sm:w-auto">
            Dienst Opslaan
          </button>
        </div>
      </div>
      ) : null}

      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <AdminSubsectionHeader
          eyebrow="Historiek"
          title="Recente Matriximports"
          description="Laatste importmomenten met de belangrijkste controlecijfers."
          aside={<div className="rounded-full border border-white/70 bg-white/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{history.length} logs</div>}
        />

        <div className="mt-6 space-y-3">
          {history.length > 0 ? history.slice(0, 8).map((entry) => {
            const hasIssues = entry.unknownCodes.length > 0 || entry.unmatchedDrivers.length > 0;
            return (
              <div key={entry.id} className="rounded-[24px] border border-white/70 bg-white/45 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        hasIssues ? "bg-amber-500" : "bg-emerald-500"
                      )} />
                      <p className="text-sm font-black text-slate-800">
                        {new Date(entry.createdAt).toLocaleString('nl-BE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      {hasIssues ? 'Controle nodig' : 'Volledig herkenbaar'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {entry.importedDays} dagen
                    </span>
                    <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {entry.generatedShifts} diensten
                    </span>
                    <span className={cn(
                      "rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest",
                      entry.unknownCodes.length > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    )}>
                      {entry.unknownCodes.length} onbekend
                    </span>
                    <span className={cn(
                      "rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest",
                      entry.unmatchedDrivers.length > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    )}>
                      {entry.unmatchedDrivers.length} chauffeur
                    </span>
                  </div>
                </div>
              </div>
            );
          }) : (
            <EmptyState
              icon={<Activity size={28} />}
              title="Nog geen importhistoriek"
              message="Na je eerste bevestigde matrix-import verschijnt hier automatisch een historiek."
            />
          )}
        </div>
      </div>

      <div className="surface-card p-8 rounded-[24px]">
        <AdminSubsectionHeader
          eyebrow="Export"
          title="Print Maandrooster"
          description="Genereer per chauffeur een maand-overzicht in print-/PDF-formaat."
        />
        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto_auto] items-end">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Chauffeur</label>
            <select
              value={printDriverId}
              onChange={(e) => setPrintDriverId(e.target.value)}
              className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none"
            >
              <option value="">Kies een chauffeur…</option>
              {users
                .filter((u) => u.isActive !== false && u.name.toLowerCase() !== 'beheerder')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Maand</label>
            <input
              type="month"
              value={printMonth}
              onChange={(e) => setPrintMonth(e.target.value)}
              className="control-input px-4 py-3 rounded-2xl font-bold text-sm outline-none"
            />
          </div>
          <button
            type="button"
            disabled={!printDriverId || !printMonth}
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?print-driver=${encodeURIComponent(printDriverId)}&print-month=${encodeURIComponent(printMonth)}`;
              window.open(url, '_blank', 'noopener,noreferrer');
            }}
            className="btn-primary ios-pressable px-6 py-3 text-xs uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Open print-weergave
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-400 font-medium">
          Opent in een nieuw tabblad met een printvriendelijke layout. Browser-printdialoog opent automatisch — daar kan je "Opslaan als PDF" kiezen of direct afdrukken.
        </p>
      </div>

      <div className="surface-card p-8 rounded-[24px]">
        <AdminSubsectionHeader
          eyebrow="Controle"
          title="Huidige Planning"
          description="Bekijk de actieve planning zoals die nu in het portaal beschikbaar is."
        />
        <div className="mt-6">
        <ScheduleView user={{ id: '0', name: 'Admin', role: 'admin', employeeId: 'ADMIN' }} shifts={shifts} users={users} />
        </div>
      </div>

      {canAdminOverride ? (
        <ConfirmationModal
          isOpen={confirmSyncOpen}
          onClose={() => setConfirmSyncOpen(false)}
          onConfirm={handleSync}
          title="Planning synchroniseren"
          message="Deze actie schrijft de lokale planning weg naar de database en kan bestaande records met dezelfde ID overschrijven."
          confirmText="Synchroniseren"
          variant="warning"
        />
      ) : null}

      {canAdminOverride ? (
        <ConfirmationModal
          isOpen={confirmClearOpen}
          onClose={() => setConfirmClearOpen(false)}
          onConfirm={handleClearPlanning}
          title="Planning wissen"
          message="Deze actie verwijdert alle actieve roosterregels uit het portaal. Gebruik dit alleen als je bewust met een lege planning wilt starten."
          confirmText={isClearingPlanning ? "Wissen..." : "Planning Wissen"}
          variant="danger"
        />
      ) : null}

      {createPortal(
      <AnimatePresence>
        {matrixPreviewOpen && matrixPreview && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[32px] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              <div className="p-8 border-b border-white/70 shrink-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-oker-600">Matrix Import Preview</p>
                <h4 className="mt-3 text-xl font-black tracking-tight">Controleer voor je de planning vervangt</h4>
                <p className="mt-2 text-sm font-medium text-slate-500">
                  Deze stap schrijft nog niets weg. Bevestig pas als dagen, diensten en probleempunten correct ogen.
                </p>
              </div>

              <div className="p-8 space-y-6 overflow-y-auto flex-1">
                <div className={cn(
                  "rounded-[24px] border p-5",
                  matrixPreviewHasIssues ? "border-red-200 bg-red-50/80" : "border-emerald-200 bg-emerald-50/80"
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-0.5 h-3 w-3 rounded-full shrink-0",
                      matrixPreviewHasIssues ? "bg-red-500" : "bg-emerald-500"
                    )} />
                    <div>
                      <p className={cn(
                        "text-xs font-black uppercase tracking-[0.2em]",
                        matrixPreviewHasIssues ? "text-red-700" : "text-emerald-700"
                      )}>
                        {matrixPreviewHasIssues ? 'Import Geblokkeerd' : 'Klaar Voor Import'}
                      </p>
                      <p className={cn(
                        "mt-2 text-sm font-medium",
                        matrixPreviewHasIssues ? "text-red-800" : "text-emerald-800"
                      )}>
                        {matrixPreviewHasIssues
                          ? 'Deze matrix bevat onbekende codes, niet-gematchte chauffeurs of conflicten met goedgekeurd verlof. Los deze eerst op (planningscodes toevoegen, naam corrigeren, Excel aanpassen of verlof annuleren) voor je opnieuw importeert.'
                          : 'Geen onbekende codes, niet-gematchte chauffeurs of verlof-conflicten. Deze import is klaar om de planning te vervangen.'}
                      </p>
                    </div>
                  </div>
                </div>

                {matrixPreview.verlofConflicts.length > 0 && (
                  <div className="rounded-[24px] border border-red-200 bg-red-50/70 p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-red-100 p-2 text-red-700"><AlertTriangle size={18} /></div>
                      <div className="flex-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-700">Conflict met goedgekeurd verlof</p>
                        <p className="mt-1 text-sm font-medium text-red-900">
                          De Excel zet {matrixPreview.verlofConflicts.length} dienst{matrixPreview.verlofConflicts.length === 1 ? '' : 'en'} op een chauffeur die voor die dag al goedgekeurd verlof heeft.
                        </p>
                        <ul className="mt-3 space-y-1 text-xs text-red-900">
                          {matrixPreview.verlofConflicts.slice(0, 8).map((c, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                              <span>
                                <span className="font-black">{c.driverName}</span>
                                {' — '}
                                {c.date}, dienst {c.serviceNumber}
                                <span className="text-red-600"> · verlof {c.leaveStart}{c.leaveStart !== c.leaveEnd ? ` t/m ${c.leaveEnd}` : ''}</span>
                              </span>
                            </li>
                          ))}
                          {matrixPreview.verlofConflicts.length > 8 && (
                            <li className="italic text-red-700">… en nog {matrixPreview.verlofConflicts.length - 8} meer.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Dagen</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.importedDays}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chauffeurs</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.detectedDrivers}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Diensten</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.generatedShifts}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Afwezigheden</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.skippedAbsences}</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[24px] border border-white/70 bg-white/50 p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Importbereik</p>
                    <p className="mt-2 text-lg font-black text-slate-900">
                      {matrixPreview.startDate
                        ? `${new Date(matrixPreview.startDate).toLocaleDateString('nl-BE')} ${matrixPreview.endDate && matrixPreview.endDate !== matrixPreview.startDate ? `t/m ${new Date(matrixPreview.endDate).toLocaleDateString('nl-BE')}` : ''}`
                        : 'Onbekend'}
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      {matrixPreview.importedDays} dagen uit de nieuwe matrix worden in dit bereik verwerkt.
                    </p>
                  </div>

                  <div className="rounded-[24px] border border-white/70 bg-white/50 p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Impact op actieve planning</p>
                    <p className="mt-2 text-lg font-black text-slate-900">
                      {matrixOverwriteSummary?.affectedExistingShifts || 0} bestaande roosterregels geraakt
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      {matrixOverwriteSummary?.currentShiftCount || 0} actieve regels in totaal, {matrixOverwriteSummary?.incomingShiftCount || 0} nieuwe regels komen binnen.
                    </p>
                  </div>
                </div>

                <div className="rounded-[24px] border border-oker-100 bg-oker-50/80 p-5">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-oker-700">Wat wordt overschreven</p>
                      <p className="mt-2 text-sm font-medium text-oker-900">
                        {matrixOverwriteSummary?.affectedExistingShifts || 0} bestaande roosterregels binnen het importbereik worden vervangen door {matrixPreview.generatedShifts} nieuw opgebouwde roosterregels.
                      </p>
                    </div>
                    <div className="rounded-full border border-oker-200 bg-white/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-oker-700">
                      {matrixOverwriteSummary?.currentStartDate
                        ? `Actief: ${new Date(matrixOverwriteSummary.currentStartDate).toLocaleDateString('nl-BE')}${matrixOverwriteSummary.currentEndDate && matrixOverwriteSummary.currentEndDate !== matrixOverwriteSummary.currentStartDate ? ` t/m ${new Date(matrixOverwriteSummary.currentEndDate).toLocaleDateString('nl-BE')}` : ''}`
                        : 'Nog geen actieve planning'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[24px] border border-red-200/70 bg-red-50/80 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Onbekende Codes</p>
                      <span className="rounded-full border border-red-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                        {matrixPreview.unknownCodes.length}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {matrixPreview.unknownCodes.length > 0 ? matrixPreview.unknownCodes.map((code) => (
                        <span key={code} className="rounded-full border border-red-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-red-700">
                          {code}
                        </span>
                      )) : (
                        <span className="text-sm font-medium text-red-700">Geen onbekende codes.</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-amber-200/70 bg-amber-50/80 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Niet-Gematchte Chauffeurs</p>
                      <span className="rounded-full border border-amber-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                        {matrixPreview.unmatchedDrivers.length}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {matrixPreview.unmatchedDrivers.length > 0 ? matrixPreview.unmatchedDrivers.map((driver) => (
                        <span key={driver} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-amber-800">
                          {driver}
                        </span>
                      )) : (
                        <span className="text-sm font-medium text-amber-700">Alle chauffeurs werden herkend.</span>
                      )}
                    </div>
                  </div>
                </div>

                {matrixPreview.servicesWithoutSegments.length > 0 && (
                  <div className="rounded-[24px] border border-amber-200/70 bg-amber-50/70 p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={18} /></div>
                      <div className="flex-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Services zonder geldige uren</p>
                        <p className="mt-1 text-sm font-medium text-amber-900">
                          {matrixPreview.servicesWithoutSegments.length} service{matrixPreview.servicesWithoutSegments.length === 1 ? '' : 's'} word{matrixPreview.servicesWithoutSegments.length === 1 ? 't' : 'en'} in de Excel toegewezen, maar heb{matrixPreview.servicesWithoutSegments.length === 1 ? 't' : 'ben'} geen valid HH:MM-segmenten in de dienstoverzicht-tabel. Voor deze dagen wordt géén shift opgebouwd — vul de uren aan via Dienstoverzicht.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {matrixPreview.servicesWithoutSegments.map((code) => (
                            <span key={code} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-amber-800">
                              {code}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {matrixPreview.perDriver.length > 0 && (
                  <div className="rounded-[24px] border border-white/70 bg-white/55 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">Per-chauffeur breakdown</p>
                      <span className="rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {matrixPreview.perDriver.length} chauffeurs
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">
                      Stille gaten worden hier zichtbaar: een chauffeur met dagen-met-code maar nul diensten betekent ofwel allemaal afwezigheden, ofwel een service zonder geldige uren.
                    </p>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
                            <th className="py-2 pr-3">Chauffeur</th>
                            <th className="py-2 px-2 text-right">Dagen</th>
                            <th className="py-2 px-2 text-right">Diensten</th>
                            <th className="py-2 px-2 text-right">Shifts</th>
                            <th className="py-2 px-2 text-right">Afwez.</th>
                            <th className="py-2 pl-2 text-right">⚠ Geen uren</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matrixPreview.perDriver.map((d) => {
                            const hasWarn = d.servicesWithoutSegments > 0;
                            const noShifts = d.servicesMatched > 0 && d.shiftsGenerated === 0;
                            return (
                              <tr
                                key={d.driverId}
                                className={cn(
                                  'border-t border-white/60',
                                  hasWarn || noShifts ? 'text-amber-900' : 'text-slate-700'
                                )}
                              >
                                <td className="py-2 pr-3 font-bold">{d.driverName}</td>
                                <td className="py-2 px-2 text-right tabular-nums">{d.daysWithCode}</td>
                                <td className="py-2 px-2 text-right tabular-nums">{d.servicesMatched}</td>
                                <td className={cn('py-2 px-2 text-right tabular-nums font-black', noShifts && 'text-amber-700')}>
                                  {d.shiftsGenerated}
                                </td>
                                <td className="py-2 px-2 text-right tabular-nums text-slate-500">{d.absences}</td>
                                <td className={cn('py-2 pl-2 text-right tabular-nums', hasWarn ? 'font-black text-amber-700' : 'text-slate-300')}>
                                  {d.servicesWithoutSegments || '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-8 bg-white/40 flex gap-3 backdrop-blur-sm shrink-0">
                <button
                  onClick={() => {
                    setMatrixPreviewOpen(false);
                    setPendingMatrixXlsxBase64('');
                    setPendingMatrixFilename('');
                    setMatrixPreview(null);
                  }}
                  className="flex-1 px-4 py-4 rounded-2xl font-black text-slate-500 hover:bg-white/70 transition-all uppercase tracking-widest text-xs border border-transparent hover:border-white/80"
                >
                  Annuleren
                </button>
                <button
                  onClick={confirmMatrixImport}
                  disabled={isMatrixImporting || matrixPreviewHasIssues}
                  title={matrixPreviewHasIssues ? 'Los eerst de fouten op in de Excel of in de planningscodes/chauffeurslijst.' : undefined}
                  className={cn(
                    "flex-1 px-4 py-4 rounded-2xl font-black text-white transition-all shadow-xl uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed",
                    matrixPreviewHasIssues
                      ? "bg-slate-400"
                      : "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20"
                  )}
                >
                  {isMatrixImporting ? 'Importeren...' : matrixPreviewHasIssues ? 'Eerst fouten oplossen' : 'Vervang Huidige Planning'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
        document.body,
      )}
    </PageShell>
  );
}


