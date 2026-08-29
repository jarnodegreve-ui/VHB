import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { PlanningMatrixImportHistory, Shift, User } from '../../types';
import { cn, getSupabaseAuthHeaders, notify, openPdfInNewTab } from '../../lib/ui';
import { isoDate } from '../../lib/availability';
import { AdminSubsectionHeader, ConfirmationModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { Badge, Button, MicroLabel, Td, Th } from '../../components/primitives';
import type { VerwachtingAfwijking } from '../../lib/coverageGaps';
import { VerwachtingAfwijkingLijst, ZiekteReeksRij, ziekteReeksSleutel, type ZiekteReeks } from '../../components/planningSignalen';

/** Inklapbare preview-sectie: de import-preview groeide naar acht blokken —
 *  met een kop + teller per blok blijft het scanbaar en klap je alleen open
 *  wat je wilt nalezen. Blokken met een actiepunt staan standaard open. */
function InklapSectie({ title, aantal, tone, defaultOpen, children }: {
  title: string;
  aantal?: number;
  tone: 'amber' | 'slate' | 'red';
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const kader = tone === 'amber'
    ? 'border-amber-200/70 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10'
    : tone === 'red'
      ? 'border-red-200/70 bg-red-50/80'
      : 'border-slate-200/70 bg-surface-field';
  const label = tone === 'amber' ? 'text-amber-700 dark:text-amber-400' : tone === 'red' ? 'text-red-700' : 'text-slate-600';
  return (
    <div className={cn('rounded-3xl border', kader)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="flex items-center gap-2">
          <MicroLabel className={label}>{title}</MicroLabel>
          {typeof aantal === 'number' && <Badge tone={tone === 'red' ? 'red' : tone === 'amber' ? 'amber' : 'slate'} className="tabular-nums">{aantal}</Badge>}
        </span>
        <ChevronDown size={16} className={cn('shrink-0 transition-transform', label, open && 'rotate-180')} />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

export function ManageSchedulesView({ shifts, onSave, users, history, canAdminOverride, onMatrixImported }: { shifts: Shift[], onSave: (s: Shift[]) => void | boolean | Promise<void | boolean>, users: User[], history: PlanningMatrixImportHistory[], canAdminOverride: boolean, onMatrixImported: () => Promise<void> }) {
  const [showExcelInfo, setShowExcelInfo] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [isMatrixImporting, setIsMatrixImporting] = useState(false);
  const [matrixPreviewOpen, setMatrixPreviewOpen] = useState(false);
  // Base64-encoded inhoud van het geüploade .xls/.xlsx-bestand. Blijft in
  // state zodat de gebruiker in de preview kan bevestigen zonder opnieuw
  // te uploaden.
  const [pendingMatrixXlsxBase64, setPendingMatrixXlsxBase64] = useState('');
  const [pendingMatrixFilename, setPendingMatrixFilename] = useState('');
  // Terugzetten naar het herstelpunt van een import (admin-only): knop in de
  // historiek + expliciete bevestigmodal — dit vervangt de volledige planning.
  const [restoreEntry, setRestoreEntry] = useState<PlanningMatrixImportHistory | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  // Gekozen importperiode (standaard het volledige bestand). De planner maakt
  // de Excel vaak maanden vooruit; met een kortere periode blijft het
  // nog-niet-vaststaande deel buiten het portaal.
  const [periodeVan, setPeriodeVan] = useState('');
  const [periodeTot, setPeriodeTot] = useState('');
  const [isPreviewVerversen, setIsPreviewVerversen] = useState(false);
  // Volgnummer tegen out-of-order preview-antwoorden bij snel datum-klikken.
  const previewVolgnummerRef = useRef(0);
  const [matrixPreview, setMatrixPreview] = useState<null | {
    importedDays: number;
    detectedDrivers: number;
    generatedShifts: number;
    matchedServices: number;
    skippedAbsences: number;
    startDate: string | null;
    endDate: string | null;
    /** Volledig bereik van het bestand, vóór de periode-selectie. */
    fileStartDate: string | null;
    fileEndDate: string | null;
    importedDates: string[];
    /** Bereik van de matrix die nu al in het portaal staat (null = nog leeg). */
    existingStart: string | null;
    existingEnd: string | null;
    /** Bestaande matrixdagen binnen resp. buiten het importbereik. */
    replacedExistingDays: number;
    retainedDays: number;
    unknownCodes: string[];
    unmatchedDrivers: string[];
    verlofConflicts: Array<{ driverId: string; driverName: string; date: string; serviceNumber: string; leaveStart: string; leaveEnd: string }>;
    /** Diensten op ziek gemelde chauffeurs — informatief, blokkeert niet:
     *  ziekte is onvoorzien en de herverdeel-flow vangt dit na de import op. */
    ziekteDiensten: Array<{ driverId: string; driverName: string; date: string; serviceNumber: string; leaveStart: string; leaveEnd: string }>;
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
    /** Naamachtige kolommen ná de "aantal"-kolom: die leest de import niet. */
    parserWaarschuwingen: string[];
    /** Chauffeurs vergeleken met de planning vóór deze periode. */
    chauffeursNieuw: string[];
    chauffeursVerdwenen: Array<{ naam: string; laatste: string }>;
    /** "ziek" in de Excel zonder geregistreerde ziekteperiode in het portaal. */
    ziekTeRegistreren: ZiekteReeks[];
    /** Dag-type-lijsten die niet sporen met wat dit bestand echt rijdt. */
    verwachtingsCheck: VerwachtingAfwijking[];
  }>(null);
  const matrixPreviewHasIssues = !!matrixPreview && (matrixPreview.unknownCodes.length > 0 || matrixPreview.unmatchedDrivers.length > 0 || matrixPreview.verlofConflicts.length > 0);

  // Wijzigingen sinds laatste matrix-import (in-app verlof + dienstruil
  // beslissingen die nog niet in Excel verwerkt zijn).
  const [changesSinceImport, setChangesSinceImport] = useState<null | {
    lastImport: { createdAt: string; importedDays: number } | null;
    approvedLeave: Array<{ id: string; userName: string | null; startDate: string; endDate: string; type: string; decidedAt?: string }>;
    approvedSwaps: Array<{ id: string; requesterName: string | null; targetName: string | null; decidedAt?: string; swapType?: string }>;
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
      // Shape-guard: een afwijkende respons (fout-object, oude API) mag het
      // hele beheerscherm niet laten crashen op .approvedLeave.length.
      if (!data || !Array.isArray(data.approvedLeave) || !Array.isArray(data.approvedSwaps)) return;
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

    const { startDate, endDate, existingStart, existingEnd } = matrixPreview;
    // Een import vervangt alléén zijn eigen datumbereik: regels binnen het
    // bereik worden vervangen, alles daarbuiten blijft staan.
    const inSpan = (date: string) => Boolean(startDate && endDate && date >= startDate && date <= endDate);
    const affectedExistingShifts = shifts.filter((shift) => shift.date && inSpan(shift.date)).length;

    // Gat tussen de bestaande matrix en dit bestand. Server-bereik gebruiken,
    // niet shifts: dagen met enkel afwezigheidscodes tellen daar wél mee.
    const dayMs = 24 * 60 * 60 * 1000;
    const gapDagen = (van: string, tot: string) => Math.round((Date.parse(tot) - Date.parse(van)) / dayMs) - 1;
    let gap: { van: string; tot: string; dagen: number } | null = null;
    if (startDate && endDate && existingStart && existingEnd) {
      if (startDate > existingEnd && gapDagen(existingEnd, startDate) > 0) {
        gap = { van: existingEnd, tot: startDate, dagen: gapDagen(existingEnd, startDate) };
      } else if (endDate < existingStart && gapDagen(endDate, existingStart) > 0) {
        gap = { van: endDate, tot: existingStart, dagen: gapDagen(endDate, existingStart) };
      }
    }

    return {
      currentShiftCount: shifts.length,
      affectedExistingShifts,
      retainedExistingShifts: shifts.length - affectedExistingShifts,
      incomingShiftCount: matrixPreview.generatedShifts,
      currentStartDate: existingStart,
      currentEndDate: existingEnd,
      gap,
    };
  }, [matrixPreview, shifts]);

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

  const fetchMatrixPreview = async (xlsxBase64: string, periode?: { van: string; tot: string }) => {
    const response = await fetch('/api/planning-matrix/preview', {
      method: 'POST',
      headers: await getSupabaseAuthHeaders(),
      body: JSON.stringify(periode ? { xlsxBase64, periode } : { xlsxBase64 }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.details || data.error || 'Import mislukt.');
    }
    return data;
  };

  const previewToState = (data: any) => ({
    importedDays: data.importedDays || 0,
    detectedDrivers: data.detectedDrivers || 0,
    generatedShifts: data.generatedShifts || 0,
    matchedServices: data.matchedServices || 0,
    skippedAbsences: data.skippedAbsences || 0,
    startDate: data.startDate || null,
    endDate: data.endDate || null,
    fileStartDate: data.fileStartDate || null,
    fileEndDate: data.fileEndDate || null,
    importedDates: Array.isArray(data.importedDates) ? data.importedDates : [],
    existingStart: data.existingStart || null,
    existingEnd: data.existingEnd || null,
    replacedExistingDays: data.replacedExistingDays || 0,
    retainedDays: data.retainedDays || 0,
    unknownCodes: Array.isArray(data.unknownCodes) ? data.unknownCodes : [],
    unmatchedDrivers: Array.isArray(data.unmatchedDrivers) ? data.unmatchedDrivers : [],
    verlofConflicts: Array.isArray(data.verlofConflicts) ? data.verlofConflicts : [],
    ziekteDiensten: Array.isArray(data.ziekteDiensten) ? data.ziekteDiensten : [],
    servicesWithoutSegments: Array.isArray(data.servicesWithoutSegments) ? data.servicesWithoutSegments : [],
    perDriver: Array.isArray(data.perDriver) ? data.perDriver : [],
    parserWaarschuwingen: Array.isArray(data.parserWaarschuwingen) ? data.parserWaarschuwingen : [],
    chauffeursNieuw: Array.isArray(data.chauffeursNieuw) ? data.chauffeursNieuw : [],
    chauffeursVerdwenen: Array.isArray(data.chauffeursVerdwenen) ? data.chauffeursVerdwenen : [],
    ziekTeRegistreren: Array.isArray(data.ziekTeRegistreren) ? data.ziekTeRegistreren : [],
    verwachtingsCheck: Array.isArray(data.verwachtingsCheck) ? data.verwachtingsCheck : [],
  });

  // Eén-klik ziekte-registratie vanuit de preview: de reeks komt uit de Excel
  // ("ziek"-cellen zonder ziekteperiode in het portaal), de registratie loopt
  // via dezelfde route als het Ziekte-blad. Geregistreerde reeksen blijven
  // zichtbaar met een vinkje zodat de lijst niet onder je muis verschuift.
  const [ziekteRegBusy, setZiekteRegBusy] = useState<string | null>(null);
  const [ziekteGeregistreerd, setZiekteGeregistreerd] = useState<Set<string>>(new Set());
  const registreerZiekte = async (reeks: ZiekteReeks) => {
    if (!reeks.userId || ziekteRegBusy) return;
    const sleutel = ziekteReeksSleutel(reeks);
    setZiekteRegBusy(sleutel);
    try {
      const res = await fetch('/api/leave/sick-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
        body: JSON.stringify({
          userId: reeks.userId,
          startDate: reeks.van,
          endDate: reeks.tot,
          comment: 'Geregistreerd vanuit de import-preview (stond als "ziek" in de Excel).',
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        notify(body.error || 'Ziekte registreren is mislukt.', 'error');
        return;
      }
      notify(`Ziekte geregistreerd voor ${reeks.naam} (${reeks.van}${reeks.tot !== reeks.van ? ` t/m ${reeks.tot}` : ''}).`, 'success');
      setZiekteGeregistreerd((cur) => new Set(cur).add(sleutel));
    } catch {
      notify('Ziekte registreren is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
    } finally {
      setZiekteRegBusy(null);
    }
  };

  const handleMatrixFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsMatrixImporting(true);
      const xlsxBase64 = await fileToBase64(file);
      const data = await fetchMatrixPreview(xlsxBase64);
      setPendingMatrixXlsxBase64(xlsxBase64);
      setPendingMatrixFilename(file.name);
      setZiekteGeregistreerd(new Set());
      setMatrixPreview(previewToState(data));
      // Periode start op het volledige bestand; inkorten kan in de preview.
      setPeriodeVan(data.startDate || '');
      setPeriodeTot(data.endDate || '');
      setMatrixPreviewOpen(true);
    } catch (error: any) {
      notify(`Excel-preview mislukt: ${error.message}`, 'error');
    } finally {
      setIsMatrixImporting(false);
      if (event.target) event.target.value = '';
    }
  };

  // Periode gewijzigd in de preview: voorbeeld opnieuw berekenen over de
  // geselecteerde dagen (aantallen, conflicten en bereik-info schuiven mee).
  const handlePeriodeChange = async (van: string, tot: string) => {
    setPeriodeVan(van);
    setPeriodeTot(tot);
    if (!pendingMatrixXlsxBase64 || !van || !tot || van > tot) return;
    const volgnummer = ++previewVolgnummerRef.current;
    try {
      setIsPreviewVerversen(true);
      const data = await fetchMatrixPreview(pendingMatrixXlsxBase64, { van, tot });
      if (volgnummer !== previewVolgnummerRef.current) return;
      setMatrixPreview(previewToState(data));
    } catch (error: any) {
      if (volgnummer === previewVolgnummerRef.current) {
        notify(`Voorbeeld bijwerken mislukt: ${error.message}`, 'error');
      }
    } finally {
      if (volgnummer === previewVolgnummerRef.current) setIsPreviewVerversen(false);
    }
  };

  const restoreImportSnapshot = async () => {
    if (!restoreEntry) return;
    try {
      setIsRestoring(true);
      const response = await fetch('/api/planning-matrix/restore', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ historyId: restoreEntry.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Terugzetten is mislukt.');
      notify(`Planning teruggezet naar de stand van vóór de import van ${new Date(restoreEntry.createdAt).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`, 'success');
      setRestoreEntry(null);
      await onMatrixImported();
    } catch (error: any) {
      notify(error.message || 'Terugzetten is mislukt.', 'error');
    } finally {
      setIsRestoring(false);
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
        body: JSON.stringify({
          xlsxBase64: pendingMatrixXlsxBase64,
          // Bestandsnaam mee voor de historiek ("welk bestand was dit ook
          // alweer?") — puur informatief.
          ...(pendingMatrixFilename ? { filename: pendingMatrixFilename } : {}),
          // Zelfde periode als het getoonde voorbeeld — de import verwerkt
          // en vervangt alleen de geselecteerde dagen.
          ...(periodeVan && periodeTot ? { periode: { van: periodeVan, tot: periodeTot } } : {}),
        }),
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

      const periode = data.startDate && data.endDate
        ? ` (${new Date(data.startDate).toLocaleDateString('nl-BE')} t/m ${new Date(data.endDate).toLocaleDateString('nl-BE')} vervangen)`
        : '';
      notify(
        `Matrixplanning geïmporteerd: ${data.importedDays || 0} dagen${periode}, ${data.generatedShifts || 0} roosterregels opgebouwd${syncNotes.length ? `, ${syncNotes.join(', ')}` : ''}.`,
        'success'
      );
      setMatrixPreviewOpen(false);
      setPendingMatrixXlsxBase64('');
      setPendingMatrixFilename('');
      setMatrixPreview(null);
      setPeriodeVan('');
      setPeriodeTot('');
      setZiekteGeregistreerd(new Set());
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
      // App toast zelf succes/fout — geen valse 'gewist'-melding meer
      // wanneer de server de wipe weigert.
      const ok = await Promise.resolve(onSave([]));
      if (ok !== false) setConfirmClearOpen(false);
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
        title="Beheer roosters"
        description="Importeer matrixplanning, bouw de actieve planning opnieuw op en controleer recente imports op problemen voordat je iets overschrijft."
      />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_minmax(0,0.9fr)]">
        <div className="surface-card rounded-3xl p-6 md:p-8">
          <AdminSubsectionHeader
            eyebrow="Importbronnen"
            title="Matrix en fallback-import"
            description="Upload het originele Excel-bestand. De praktijk-tab wordt server-side gelezen — geen CSV-export of conversie nodig."
            aside={showExcelInfo ? (
              <Button variant="ghost" size="sm" onClick={() => setShowExcelInfo(false)}>
                Info verbergen
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setShowExcelInfo(true)}>
                Info tonen
              </Button>
            )}
          />

          {showExcelInfo && (
            <div className="mt-5 rounded-3xl border border-oker-100 bg-oker-50/80 p-5 text-sm">
              <p className="font-bold text-oker-800">Importvolgorde</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-oker-700">
                <li>Upload het hele <code className="rounded bg-surface-row px-1.5 py-0.5 text-2xs">.xls</code>/<code className="rounded bg-surface-row px-1.5 py-0.5 text-2xs">.xlsx</code>-bestand. De server leest de praktijk-tab automatisch.</li>
                <li>Controleer in de preview: dagen, diensten, onbekende codes, niet-gematchte chauffeurs en services zonder uren.</li>
              </ol>
            </div>
          )}

          {(() => {
            if (!changesSinceImport) {
              return null;
            }
            // Ziekte is geen verlof (scheiding sinds 15-08, #370): een
            // geregistreerde ziekteperiode staat wel in de leave-tabel maar
            // hoort hier een eigen naam en telling te krijgen — de melding
            // "1 verlof goedgekeurd" voor een ziekmelding verwarde (19-08).
            const verlofSinds = changesSinceImport.approvedLeave.filter((l) => l.type !== 'ziekte');
            const ziekteSinds = changesSinceImport.approvedLeave.filter((l) => l.type === 'ziekte');
            const totalChanges = verlofSinds.length + ziekteSinds.length + changesSinceImport.approvedSwaps.length;
            const hasChanges = totalChanges > 0;
            const lastImportLabel = changesSinceImport.lastImport
              ? new Date(changesSinceImport.lastImport.createdAt).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })
              : 'nog nooit';

            const accent = hasChanges
              ? { border: 'border-amber-200', bg: 'bg-amber-50/70', icon: 'bg-amber-100 text-amber-700', eyebrow: 'text-amber-700', body: 'text-amber-900', stamp: 'text-amber-600' }
              : { border: 'border-emerald-200', bg: 'bg-emerald-50/70', icon: 'bg-emerald-100 text-emerald-700', eyebrow: 'text-emerald-700', body: 'text-emerald-900', stamp: 'text-emerald-600' };

            return (
              <div className={cn('mt-6 rounded-3xl border p-5', accent.border, accent.bg)}>
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
                      <MicroLabel className={accent.eyebrow}>Voor je uploadt</MicroLabel>
                      <h4 className="mt-1 text-base font-bold tracking-tight text-slate-900">
                        {hasChanges ? 'Wijzigingen sinds vorige import' : 'Geen wijzigingen sinds vorige import'}
                      </h4>
                      <p className={cn('mt-1 text-sm font-medium', accent.body)}>
                        {hasChanges
                          ? `${verlofSinds.length} verlof${verlofSinds.length === 1 ? '' : 'en'} en ${changesSinceImport.approvedSwaps.length} dienstruil${changesSinceImport.approvedSwaps.length === 1 ? '' : 'en'} goedgekeurd${ziekteSinds.length > 0 ? `, ${ziekteSinds.length} ziekteperiode${ziekteSinds.length === 1 ? '' : 's'} geregistreerd` : ''}. Dienstruilen voert het portaal automatisch door (ook na een import) — dit lijstje is ter controle voor je Excel-archief; verlof verwerk je wél in Excel.${ziekteSinds.length > 0 ? ' Ziekte hoeft niet vooraf in je Excel — na de import staan die diensten als te herverdelen klaar.' : ''}`
                          : 'Geen verloven, dienstruilen of ziekmeldingen in de app sinds je laatste matrix-import. Excel en app zijn in sync.'}
                      </p>
                      <MicroLabel className={cn('mt-1', accent.stamp)}>
                        Laatste import: {lastImportLabel}
                      </MicroLabel>
                    </div>
                  </div>
                  {hasChanges && (
                    <ChevronDown size={18} className={cn('shrink-0 mt-1 transition-transform', accent.eyebrow, changesExpanded && 'rotate-180')} />
                  )}
                </button>
                {hasChanges && changesExpanded && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <MicroLabel className={cn('mb-2', accent.eyebrow)}>Verlof</MicroLabel>
                      {verlofSinds.length > 0 ? (
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {verlofSinds.map((l) => (
                            <li key={l.id} className="flex items-start gap-2">
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                              <span>
                                <span className="font-semibold">{l.userName}</span>
                                {' — '}
                                {l.startDate}{l.startDate !== l.endDate ? ` t/m ${l.endDate}` : ''}
                                {l.type ? ` (${l.type})` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500">Geen.</p>
                      )}
                      {ziekteSinds.length > 0 && (
                        <>
                          <MicroLabel className={cn('mb-2 mt-4', accent.eyebrow)}>Ziekte</MicroLabel>
                          <ul className="space-y-1.5 text-xs text-slate-700">
                            {ziekteSinds.map((l) => (
                              <li key={l.id} className="flex items-start gap-2">
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                                <span>
                                  <span className="font-semibold">{l.userName}</span>
                                  {' — ziek '}
                                  {l.startDate}{l.startDate !== l.endDate ? ` t/m ${l.endDate}` : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                    <div>
                      <MicroLabel className={cn('mb-2', accent.eyebrow)}>Dienstruil</MicroLabel>
                      {changesSinceImport.approvedSwaps.length > 0 ? (
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {changesSinceImport.approvedSwaps.map((s) => (
                            <li key={s.id} className="flex items-start gap-2">
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                              <span>
                                <span className="font-semibold">{s.requesterName}</span>
                                {' → '}
                                <span className="font-semibold">{s.targetName || '?'}</span>
                                {s.swapType === 'overname' && (
                                  <span className="text-slate-400"> · overname (geen tegenprestatie)</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500">Geen.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mt-6 grid gap-4">
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <MicroLabel className="text-emerald-700">Primair</MicroLabel>
                  <h4 className="mt-2 text-base font-bold tracking-tight text-slate-900">Excel-matrix uploaden</h4>
                  <p className="mt-2 text-sm font-medium text-slate-600">
                    Upload je originele <code className="rounded bg-surface-row px-1.5 py-0.5 text-2xs">.xls</code>/<code className="rounded bg-surface-row px-1.5 py-0.5 text-2xs">.xlsx</code>-bestand. De server leest de praktijk-tab; je krijgt een preview met per-chauffeur breakdown voor je iets overschrijft.
                  </p>
                  {pendingMatrixFilename && (
                    <MicroLabel className="mt-2 text-emerald-700">
                      Geladen: {pendingMatrixFilename}
                    </MicroLabel>
                  )}
                </div>
                <Badge tone="emerald">Aangeraden</Badge>
              </div>
              <label
                className={cn(
                  "ios-pressable mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
                  isMatrixImporting ? "cursor-not-allowed bg-slate-200 text-slate-400" : "btn-primary"
                )}
              >
                <Upload size={16} />
                {isMatrixImporting ? 'Importeren…' : 'Excel-matrix uploaden'}
                <input
                  type="file"
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleMatrixFileUpload}
                  disabled={isMatrixImporting}
                />
              </label>
            </div>

          </div>
        </div>

        {canAdminOverride ? (
        <div className="surface-card rounded-3xl p-6 md:p-8">
          <AdminSubsectionHeader
            eyebrow="Database"
            title="Actieve planning herschrijven"
            description="Bouw de planning opnieuw op uit de laatst geïmporteerde matrix, of wis de planning volledig wanneer een nieuwe later volgt."
          />
          <div className="mt-5 space-y-4">
            <div className="surface-card rounded-3xl p-5">
              <MicroLabel>Opnieuw opbouwen</MicroLabel>
              <p className="mt-2 text-sm font-medium text-slate-500">
                Bouwt de planning opnieuw op uit de matrix die al in het portaal staat — je hoeft je Excel niet opnieuw te uploaden. Gebruik dit nadat je in het Dienstoverzicht iets wijzigde (tijden, loopnummers): die aanpassingen komen zo bij de chauffeurs terecht.
              </p>
              <Button
                variant="success"
                size="lg"
                full
                className="mt-5"
                onClick={() => setConfirmSyncOpen(true)}
                disabled={isSyncing}
                title="Bouwt de planning opnieuw op uit de laatst geïmporteerde matrix"
                icon={<RotateCcw size={16} className={isSyncing ? "animate-spin" : ""} />}
              >
                {isSyncing ? 'Opnieuw opbouwen…' : 'Planning opnieuw opbouwen'}
              </Button>
            </div>

            <div className="rounded-3xl border border-red-200/70 bg-red-50/80 p-5">
              <MicroLabel className="text-red-700">Leegmaken</MicroLabel>
              <p className="mt-2 text-sm font-medium text-red-700/80">
                Wis alle actieve roosterregels in het portaal. Handig wanneer de planning volledig vervangen wordt en je eerst een lege toestand wilt.
              </p>
              <Button
                variant="danger"
                size="lg"
                full
                className="mt-5"
                onClick={() => setConfirmClearOpen(true)}
                disabled={isClearingPlanning}
                icon={<Trash2 size={16} />}
              >
                {isClearingPlanning ? 'Wissen…' : 'Planning wissen'}
              </Button>
            </div>
          </div>
        </div>
        ) : null}
      </div>

      <div className="surface-card p-6 md:p-8 rounded-3xl">
        <AdminSubsectionHeader
          eyebrow="Historiek"
          title="Recente matriximports"
          description="Laatste importmomenten met de belangrijkste controlecijfers."
          aside={<Badge tone="slate">{history.length} logs</Badge>}
        />

        <div className="mt-6 space-y-3">
          {history.length > 0 ? history.slice(0, 8).map((entry) => {
            const hasIssues = entry.unknownCodes.length > 0 || entry.unmatchedDrivers.length > 0;
            return (
              <div key={entry.id} className="surface-card rounded-3xl p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        hasIssues ? "bg-amber-500" : "bg-emerald-500"
                      )} />
                      <p className="text-sm font-semibold text-slate-800 tabular-nums">
                        {new Date(entry.createdAt).toLocaleString('nl-BE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <MicroLabel className="mt-2">
                      {hasIssues ? 'Controle nodig' : 'Volledig herkenbaar'}
                    </MicroLabel>
                    {(entry.filename || entry.importedBy || (entry.periodStart && entry.periodEnd)) && (
                      <p className="mt-1.5 max-w-sm truncate text-xs text-slate-500">
                        {[
                          entry.filename,
                          entry.importedBy,
                          entry.periodStart && entry.periodEnd ? `${entry.periodStart} t/m ${entry.periodEnd}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="slate" className="tabular-nums">{entry.importedDays} dagen</Badge>
                    <Badge tone="slate" className="tabular-nums">{entry.generatedShifts} diensten</Badge>
                    <Badge tone={entry.unknownCodes.length > 0 ? 'red' : 'emerald'} className="tabular-nums">
                      {entry.unknownCodes.length} onbekend
                    </Badge>
                    <Badge tone={entry.unmatchedDrivers.length > 0 ? 'amber' : 'emerald'} className="tabular-nums">
                      {entry.unmatchedDrivers.length} chauffeur
                    </Badge>
                    {canAdminOverride && entry.snapshotPath && (
                      <button
                        type="button"
                        onClick={() => setRestoreEntry(entry)}
                        disabled={isRestoring}
                        className="ios-pressable inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-surface-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-surface-soft-hover disabled:opacity-50"
                      >
                        <RotateCcw size={14} className="text-oker-500" /> Zet terug
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          }) : (
            <EmptyState mascotte={false}
              icon={<Activity size={28} />}
              title="Nog geen importhistoriek"
              message="Na je eerste bevestigde matrix-import verschijnt hier automatisch een historiek."
            />
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={restoreEntry !== null}
        onClose={() => { if (!isRestoring) setRestoreEntry(null); }}
        onConfirm={() => { if (!isRestoring) void restoreImportSnapshot(); }}
        title="Planning terugzetten?"
        message={restoreEntry ? `De volledige planning en matrix gaan terug naar de stand van vóór de import van ${new Date(restoreEntry.createdAt).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${restoreEntry.filename ? ` (${restoreEntry.filename})` : ''}. Alles wat je ná die import wijzigde (latere imports, toewijzingen, geregistreerde ziektes) verdwijnt uit de planning.` : undefined}
        confirmText={isRestoring ? 'Bezig…' : 'Zet terug'}
        variant="warning"
      />

      <div className="surface-card p-6 md:p-8 rounded-3xl">
        <AdminSubsectionHeader
          eyebrow="Export"
          title="Print maandrooster"
          description="Genereer per chauffeur een maand-overzicht in print-/PDF-formaat."
        />
        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto_auto] items-end">
          <div className="space-y-2">
            <MicroLabel className="ml-1">Chauffeur</MicroLabel>
            <select
              value={printDriverId}
              onChange={(e) => setPrintDriverId(e.target.value)}
              className="control-input w-full px-4 py-3 rounded-2xl font-semibold text-sm outline-none"
            >
              <option value="">Kies een chauffeur…</option>
              <option value="alle">Alle chauffeurs (blad per chauffeur)</option>
              {users
                .filter((u) => u.isActive !== false && u.name.toLowerCase() !== 'beheerder')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </div>
          <div className="space-y-2">
            <MicroLabel className="ml-1">Maand</MicroLabel>
            <input
              type="month"
              value={printMonth}
              onChange={(e) => setPrintMonth(e.target.value)}
              className="control-input px-4 py-3 rounded-2xl font-semibold text-sm outline-none tabular-nums"
            />
          </div>
          <Button
            variant="primary"
            disabled={!printDriverId || !printMonth}
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?print-driver=${encodeURIComponent(printDriverId)}&print-month=${encodeURIComponent(printMonth)}`;
              // openPdfInNewTab i.p.v. rauwe window.open: in iOS-standalone geeft
              // window.open geregeld null → dan navigeren we in hetzelfde venster.
              openPdfInNewTab(url);
            }}
          >
            Open print-weergave
          </Button>
        </div>
        <p className="mt-4 text-xs text-slate-400 font-medium">
          Opent in een nieuw tabblad met een printvriendelijke layout. Browser-printdialoog opent automatisch — daar kan je "Opslaan als PDF" kiezen of direct afdrukken.
        </p>
      </div>

      <div className="surface-card p-6 md:p-8 rounded-3xl">
        <AdminSubsectionHeader
          eyebrow="Controle"
          title="Huidige planning"
          description="Bekijk de actieve planning zoals die nu in het portaal beschikbaar is."
        />
        <div className="mt-6">
        {(() => {
          // All-chauffeurs-overzicht (ScheduleView is strikt per-chauffeur en
          // toonde met een synthetische admin altijd leeg). Toont de actieve
          // planning vanaf vandaag, gegroepeerd per dag.
          const today = isoDate(new Date());
          const nameById = new Map(users.map((u) => [String(u.id), u.name]));
          const upcoming = shifts
            .filter((s) => s.date && s.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime || '').localeCompare(String(b.startTime || '')));
          if (upcoming.length === 0) {
            return <EmptyState mascotte={false} title="Geen actieve planning" message={shifts.length === 0 ? 'Er is nog geen planning geïmporteerd.' : 'Geen diensten vanaf vandaag — importeer of synchroniseer een planning.'} />;
          }
          const byDate = new Map<string, Shift[]>();
          for (const s of upcoming) {
            const list = byDate.get(s.date) ?? [];
            list.push(s);
            byDate.set(s.date, list);
          }
          const driverCount = new Set(upcoming.map((s) => String(s.driverId))).size;
          return (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                <Badge tone="oker" dot>{upcoming.length} diensten vanaf vandaag</Badge>
                <Badge tone="slate" dot>{byDate.size} dagen</Badge>
                <Badge tone="slate" dot>{driverCount} chauffeurs</Badge>
              </div>
              <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
                {[...byDate.entries()].map(([date, daysShifts]) => (
                  <div key={date}>
                    <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1.5">
                      {new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'long', day: '2-digit', month: 'long' })}
                      <span className="ml-2 text-slate-400">· {daysShifts.length}</span>
                    </div>
                    <div className="rounded-2xl border border-slate-200/70 divide-y divide-slate-100">
                      {daysShifts.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="font-semibold text-slate-800 min-w-0 flex-1 truncate">{nameById.get(String(s.driverId)) || `Chauffeur ${s.driverId}`}</span>
                          <span className="text-slate-500 tabular-nums">{s.line || '--'}</span>
                          <span className="text-slate-400 text-xs tabular-nums whitespace-nowrap">{s.startTime}–{s.endTime}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
        </div>
      </div>

      {canAdminOverride ? (
        <ConfirmationModal
          isOpen={confirmSyncOpen}
          onClose={() => setConfirmSyncOpen(false)}
          onConfirm={handleSync}
          title="Planning opnieuw opbouwen"
          message="De actieve planning wordt vervangen door een verse opbouw uit de laatst geïmporteerde matrix, met de huidige tijden en loopnummers uit het Dienstoverzicht. Handmatige wijzigingen in de planning gaan hierbij verloren."
          confirmText="Opnieuw opbouwen"
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
          confirmText={isClearingPlanning ? "Wissen…" : "Planning wissen"}
          variant="danger"
        />
      ) : null}

      {/* Gedeelde Modal: ESC, backdrop-tap, safe-area en dvh (verbeterronde 29/07 #3).
          dismissOnBackdrop uit: een half gecontroleerde import-preview mag niet
          per ongeluk wegklikken. */}
      <Modal open={Boolean(matrixPreviewOpen && matrixPreview)} onClose={() => setMatrixPreviewOpen(false)} maxWidth="2xl" dismissOnBackdrop={false} className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
        {matrixPreview && (
        <>
              <ModalHeader
                eyebrow="Matrix Import Preview"
                title="Controleer voor je deze periode vervangt"
                description="Deze stap schrijft nog niets weg. Alleen de periode van dit bestand wordt vervangen — planning buiten die periode blijft staan."
              />

              <div className="p-6 md:p-7 space-y-6 overflow-y-auto flex-1">
                <div className={cn(
                  "rounded-3xl border p-5",
                  matrixPreviewHasIssues ? "border-red-200 bg-red-50/80" : "border-emerald-200 bg-emerald-50/80"
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-0.5 h-3 w-3 rounded-full shrink-0",
                      matrixPreviewHasIssues ? "bg-red-500" : "bg-emerald-500"
                    )} />
                    <div>
                      <MicroLabel className={matrixPreviewHasIssues ? "text-red-700" : "text-emerald-700"}>
                        {matrixPreviewHasIssues ? 'Import geblokkeerd' : 'Klaar voor import'}
                      </MicroLabel>
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
                  <div className="rounded-3xl border border-red-200 bg-red-50/70 p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-red-100 p-2 text-red-700"><AlertTriangle size={18} /></div>
                      <div className="flex-1">
                        <MicroLabel className="text-red-700">Conflict met goedgekeurd verlof</MicroLabel>
                        <p className="mt-1 text-sm font-medium text-red-900">
                          De Excel zet {matrixPreview.verlofConflicts.length} dienst{matrixPreview.verlofConflicts.length === 1 ? '' : 'en'} op een chauffeur die voor die dag al goedgekeurd verlof heeft.
                        </p>
                        <ul className="mt-3 space-y-1 text-xs text-red-900">
                          {matrixPreview.verlofConflicts.slice(0, 8).map((c, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                              <span>
                                <span className="font-semibold">{c.driverName}</span>
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

                {/* Kolommen die de import bewust niet leest (ná "aantal"):
                    een chauffeur die daar per ongeluk staat, verdween tot nu
                    geruisloos uit het portaal. */}
                {matrixPreview.parserWaarschuwingen.length > 0 && (
                  <InklapSectie title="Kolommen buiten de import" aantal={matrixPreview.parserWaarschuwingen.length} tone="amber" defaultOpen>
                    <ul className="space-y-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                      {matrixPreview.parserWaarschuwingen.map((w, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </InklapSectie>
                )}

                {/* Chauffeurs vergeleken met de planning vóór deze periode:
                    een weggevallen Excel-kolom (of een nieuwe collega) valt zo
                    op vóór je vervangt, niet weken later op de dekking. */}
                {(matrixPreview.chauffeursVerdwenen.length > 0 || matrixPreview.chauffeursNieuw.length > 0) && (
                  <InklapSectie
                    title="Chauffeurs veranderd t.o.v. de vorige planning"
                    aantal={matrixPreview.chauffeursVerdwenen.length + matrixPreview.chauffeursNieuw.length}
                    tone="amber"
                    defaultOpen
                  >
                    <p className="text-xs font-medium text-amber-900/80 dark:text-amber-200/80">
                      Klopt dit met de realiteit (vertrokken of nieuwe collega), dan is er niets aan de hand — staat hier iemand die nog gewoon rijdt, controleer dan zijn kolom in de Excel.
                    </p>
                    <div className="mt-3 space-y-2 text-xs text-amber-900 dark:text-amber-200">
                      {matrixPreview.chauffeursVerdwenen.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">Niet meer in dit bestand:</span>
                          {/* Datum ín de badge: een title-tooltip bestaat niet op
                              touch, en juist "t/m wanneer?" stuurt de beoordeling. */}
                          {matrixPreview.chauffeursVerdwenen.map((c) => (
                            <Badge key={c.naam} tone="amber" className="tabular-nums">{c.naam} · t/m {new Date(c.laatste).toLocaleDateString('nl-BE')}</Badge>
                          ))}
                        </div>
                      )}
                      {matrixPreview.chauffeursNieuw.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">Nieuw in dit bestand:</span>
                          {matrixPreview.chauffeursNieuw.map((naam) => (
                            <Badge key={naam} tone="emerald">{naam}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </InklapSectie>
                )}

                {/* "ziek" in de Excel zonder ziekteperiode in het portaal: het
                    Ziekte-blad, de digest en de advisor kennen die afwezigheid
                    dan niet. Registreren kan meteen hiervandaan. */}
                {matrixPreview.ziekTeRegistreren.length > 0 && (
                  <InklapSectie title="Ziekte nog niet geregistreerd" aantal={matrixPreview.ziekTeRegistreren.length} tone="amber" defaultOpen>
                    <p className="text-xs font-medium text-amber-900/80 dark:text-amber-200/80">
                      Deze chauffeurs staan in de Excel als "ziek", maar hebben geen ziekteperiode in het portaal — het Ziekte-blad en de meldingen kennen hen dan niet. Registreren kan meteen:
                    </p>
                    {/* Zelfde rij-component als het Ziekte-blad: één presentatie
                        (datumvorm, knoptekst, chips) op beide plekken. */}
                    <ul className="mt-3 space-y-2">
                      {matrixPreview.ziekTeRegistreren.map((r) => {
                        const sleutel = ziekteReeksSleutel(r);
                        return (
                          <ZiekteReeksRij
                            key={sleutel}
                            reeks={r}
                            bezig={ziekteRegBusy === sleutel}
                            klaar={ziekteGeregistreerd.has(sleutel)}
                            disabled={!!ziekteRegBusy}
                            onRegistreer={registreerZiekte}
                          />
                        );
                      })}
                    </ul>
                  </InklapSectie>
                )}

                {/* Dag-type-lijsten die niet sporen met wat dit bestand rijdt:
                    een dienstregelingswissel valt zo al hier op, niet pas als
                    fantoomgaten op de dekking (20-08). */}
                {matrixPreview.verwachtingsCheck.length > 0 && (
                  <InklapSectie title="Dekking-verwachtingen wijken af" aantal={matrixPreview.verwachtingsCheck.length} tone="amber" defaultOpen>
                    <p className="text-xs font-medium text-amber-900/80 dark:text-amber-200/80">
                      Vergelijking van de dag-type-lijsten (Openstaande diensten → Instellen) met wat dit bestand echt rijdt:
                    </p>
                    <VerwachtingAfwijkingLijst afwijkingen={matrixPreview.verwachtingsCheck} />
                  </InklapSectie>
                )}

                {/* Informatief, blokkeert niet: ziekte is onvoorzien — de Excel
                    wordt vooraf gemaakt. Na de import staan deze diensten als
                    "nog te herverdelen" op dashboard en maandplanning. */}
                {matrixPreview.ziekteDiensten.length > 0 && (
                  <InklapSectie title="Ziek gemelde chauffeurs in deze Excel" aantal={matrixPreview.ziekteDiensten.length} tone="amber">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {matrixPreview.ziekteDiensten.length} dienst{matrixPreview.ziekteDiensten.length === 1 ? ' staat' : 'en staan'} op een chauffeur die ziek gemeld is.
                      De import gaat gewoon door; daarna staan ze als "nog te herverdelen" op het dashboard en in de maandplanning.
                    </p>
                    <ul className="mt-3 space-y-1 text-xs text-amber-900 dark:text-amber-200">
                      {matrixPreview.ziekteDiensten.slice(0, 6).map((c, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          <span>
                            <span className="font-semibold">{c.driverName}</span>
                            {' — '}
                            {c.date}, dienst {c.serviceNumber}
                            <span className="opacity-75"> · ziek {c.leaveStart}{c.leaveStart !== c.leaveEnd ? ` t/m ${c.leaveEnd}` : ''}</span>
                          </span>
                        </li>
                      ))}
                      {matrixPreview.ziekteDiensten.length > 6 && (
                        <li className="italic opacity-75">… en nog {matrixPreview.ziekteDiensten.length - 6} meer.</li>
                      )}
                    </ul>
                  </InklapSectie>
                )}

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="surface-muted rounded-2xl p-4">
                    <MicroLabel>Dagen</MicroLabel>
                    <p className="mt-2 text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">{matrixPreview.importedDays}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <MicroLabel>Chauffeurs</MicroLabel>
                    <p className="mt-2 text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">{matrixPreview.detectedDrivers}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <MicroLabel>Diensten</MicroLabel>
                    <p className="mt-2 text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">{matrixPreview.generatedShifts}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <MicroLabel>Afwezigheden</MicroLabel>
                    <p className="mt-2 text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">{matrixPreview.skippedAbsences}</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="surface-card rounded-3xl p-5">
                    <div className="flex items-center justify-between gap-3">
                      <MicroLabel>Importperiode</MicroLabel>
                      {isPreviewVerversen && <MicroLabel className="text-oker-600">Bijwerken…</MicroLabel>}
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      Het bestand loopt van {matrixPreview.fileStartDate ? new Date(matrixPreview.fileStartDate).toLocaleDateString('nl-BE') : '?'} t/m {matrixPreview.fileEndDate ? new Date(matrixPreview.fileEndDate).toLocaleDateString('nl-BE') : '?'}. Alleen de gekozen periode wordt geïmporteerd en vervangen — kort hem in als latere maanden nog niet vaststaan.
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <MicroLabel className="ml-1">Van</MicroLabel>
                        <input
                          type="date"
                          value={periodeVan}
                          min={matrixPreview.fileStartDate ?? undefined}
                          max={periodeTot || matrixPreview.fileEndDate || undefined}
                          onChange={(e) => handlePeriodeChange(e.target.value, periodeTot)}
                          className="control-input w-full px-3 py-2.5 rounded-2xl font-semibold text-sm outline-none tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <MicroLabel className="ml-1">Tot en met</MicroLabel>
                        <input
                          type="date"
                          value={periodeTot}
                          min={periodeVan || matrixPreview.fileStartDate || undefined}
                          max={matrixPreview.fileEndDate ?? undefined}
                          onChange={(e) => handlePeriodeChange(periodeVan, e.target.value)}
                          className="control-input w-full px-3 py-2.5 rounded-2xl font-semibold text-sm outline-none tabular-nums"
                        />
                      </div>
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-500">
                      {matrixPreview.importedDays} dag{matrixPreview.importedDays === 1 ? '' : 'en'} geselecteerd. Alleen dit bereik wordt vervangen{matrixPreview.retainedDays > 0
                        ? ` — ${matrixPreview.retainedDays} bestaande dag${matrixPreview.retainedDays === 1 ? ' erbuiten blijft' : 'en erbuiten blijven'} staan.`
                        : '; er staat geen planning buiten dit bereik.'}
                    </p>
                  </div>

                  <div className="surface-card rounded-3xl p-5">
                    <MicroLabel>Impact op actieve planning</MicroLabel>
                    <p className="mt-2 text-lg font-semibold text-slate-900">
                      <span className="font-mono tabular-nums tracking-[-0.01em]">{matrixOverwriteSummary?.affectedExistingShifts || 0}</span> bestaande roosterregels geraakt
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      {matrixOverwriteSummary?.currentShiftCount || 0} actieve regels in totaal; {matrixOverwriteSummary?.incomingShiftCount || 0} nieuwe komen binnen, {matrixOverwriteSummary?.retainedExistingShifts || 0} buiten het bereik blijven ongewijzigd.
                    </p>
                  </div>
                </div>

                <div className="rounded-3xl border border-oker-100 bg-oker-50/80 p-5">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <MicroLabel className="text-oker-700">Wat wordt overschreven</MicroLabel>
                      <p className="mt-2 text-sm font-medium text-oker-900">
                        {matrixOverwriteSummary?.affectedExistingShifts || 0} bestaande roosterregels binnen het importbereik worden vervangen door {matrixPreview.generatedShifts} nieuw opgebouwde roosterregels. Alles buiten het bereik blijft staan.
                      </p>
                    </div>
                    <Badge tone="oker" className="tabular-nums">
                      {matrixOverwriteSummary?.currentStartDate
                        ? `Actief: ${new Date(matrixOverwriteSummary.currentStartDate).toLocaleDateString('nl-BE')}${matrixOverwriteSummary.currentEndDate && matrixOverwriteSummary.currentEndDate !== matrixOverwriteSummary.currentStartDate ? ` t/m ${new Date(matrixOverwriteSummary.currentEndDate).toLocaleDateString('nl-BE')}` : ''}`
                        : 'Nog geen actieve planning'}
                    </Badge>
                  </div>
                </div>

                {/* De periodes sluiten niet aan: dagen zonder planning tussen de
                    bestaande matrix en dit bestand. Meestal een verkeerd of
                    onvolledig bestand — informatief, blokkeert niet. */}
                {matrixOverwriteSummary?.gap && (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"><AlertTriangle size={18} /></div>
                      <div>
                        <MicroLabel className="text-amber-700 dark:text-amber-400">De periodes sluiten niet aan</MicroLabel>
                        <p className="mt-1 text-sm font-medium text-amber-900 dark:text-amber-200">
                          Tussen {new Date(matrixOverwriteSummary.gap.van).toLocaleDateString('nl-BE')} en {new Date(matrixOverwriteSummary.gap.tot).toLocaleDateString('nl-BE')} {matrixOverwriteSummary.gap.dagen === 1 ? 'valt 1 dag' : `vallen ${matrixOverwriteSummary.gap.dagen} dagen`} zonder planning.
                          Klopt dat niet, controleer dan of je het juiste bestand uploadt — de import gaat anders gewoon door.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Kleur volgt de zwaarste inhoud: rood alleen bij onbekende
                    codes; alleen niet-gematchte chauffeurs = amber (zoals hun
                    eigen kaart) — rode kop om amber inhoud gaf een gemengd
                    signaal op precies het scherm waar rood "geblokkeerd" is. */}
                <InklapSectie
                  title="Codes & chauffeur-matching"
                  aantal={matrixPreview.unknownCodes.length + matrixPreview.unmatchedDrivers.length}
                  tone={matrixPreview.unknownCodes.length > 0 ? 'red' : matrixPreview.unmatchedDrivers.length > 0 ? 'amber' : 'slate'}
                  defaultOpen={matrixPreview.unknownCodes.length > 0 || matrixPreview.unmatchedDrivers.length > 0}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-surface-white ring-1 ring-hairline p-4">
                      <div className="flex items-center justify-between gap-3">
                        <MicroLabel className={matrixPreview.unknownCodes.length > 0 ? 'text-red-700' : 'text-slate-500'}>Onbekende Codes</MicroLabel>
                        <Badge tone={matrixPreview.unknownCodes.length > 0 ? 'red' : 'emerald'} className="tabular-nums">{matrixPreview.unknownCodes.length}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {matrixPreview.unknownCodes.length > 0 ? matrixPreview.unknownCodes.map((code) => (
                          <Fragment key={code}><Badge tone="red">{code}</Badge></Fragment>
                        )) : (
                          <span className="text-sm text-slate-500">Geen onbekende codes.</span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-surface-white ring-1 ring-hairline p-4">
                      <div className="flex items-center justify-between gap-3">
                        <MicroLabel className={matrixPreview.unmatchedDrivers.length > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500'}>Niet-Gematchte Chauffeurs</MicroLabel>
                        <Badge tone={matrixPreview.unmatchedDrivers.length > 0 ? 'amber' : 'emerald'} className="tabular-nums">{matrixPreview.unmatchedDrivers.length}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {matrixPreview.unmatchedDrivers.length > 0 ? matrixPreview.unmatchedDrivers.map((driver) => (
                          <Fragment key={driver}><Badge tone="amber">{driver}</Badge></Fragment>
                        )) : (
                          <span className="text-sm font-medium text-slate-400">Alle chauffeurs werden herkend.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </InklapSectie>

                {matrixPreview.servicesWithoutSegments.length > 0 && (
                  <InklapSectie title="Services zonder geldige uren" aantal={matrixPreview.servicesWithoutSegments.length} tone="amber" defaultOpen>
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {matrixPreview.servicesWithoutSegments.length} service{matrixPreview.servicesWithoutSegments.length === 1 ? '' : 's'} word{matrixPreview.servicesWithoutSegments.length === 1 ? 't' : 'en'} in de Excel toegewezen, maar heb{matrixPreview.servicesWithoutSegments.length === 1 ? 't' : 'ben'} geen valid HH:MM-segmenten in de dienstoverzicht-tabel. Voor deze dagen wordt géén shift opgebouwd — vul de uren aan via Dienstoverzicht.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {matrixPreview.servicesWithoutSegments.map((code) => (
                        <Fragment key={code}><Badge tone="amber">{code}</Badge></Fragment>
                      ))}
                    </div>
                  </InklapSectie>
                )}

                {matrixPreview.perDriver.length > 0 && (
                  <InklapSectie title="Per-chauffeur breakdown" aantal={matrixPreview.perDriver.length} tone="slate">
                    <p className="text-2xs font-medium text-slate-500">
                      Stille gaten worden hier zichtbaar: een chauffeur met dagen-met-code maar nul diensten betekent ofwel allemaal afwezigheden, ofwel een service zonder geldige uren.
                    </p>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <Th className="px-2 py-2 pr-3">Chauffeur</Th>
                            <Th className="px-2 py-2 text-right">Dagen</Th>
                            <Th className="px-2 py-2 text-right">Diensten</Th>
                            <Th className="px-2 py-2 text-right">Shifts</Th>
                            <Th className="px-2 py-2 text-right">Afwez.</Th>
                            <Th className="px-2 py-2 pl-2 text-right">Geen uren</Th>
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
                                  'border-t border-slate-100 transition-colors hover:bg-slate-50/50',
                                  hasWarn || noShifts ? 'text-amber-900' : 'text-slate-700'
                                )}
                              >
                                <Td className="px-2 py-2 pr-3 text-xs font-semibold text-inherit">{d.driverName}</Td>
                                <Td className="px-2 py-2 text-right text-xs tabular-nums text-inherit">{d.daysWithCode}</Td>
                                <Td className="px-2 py-2 text-right text-xs tabular-nums text-inherit">{d.servicesMatched}</Td>
                                <Td className={cn('px-2 py-2 text-right text-xs tabular-nums font-semibold text-inherit', noShifts && 'text-amber-700')}>
                                  {d.shiftsGenerated}
                                </Td>
                                <Td className="px-2 py-2 text-right text-xs tabular-nums text-slate-500">{d.absences}</Td>
                                <Td className={cn('px-2 py-2 pl-2 text-right text-xs tabular-nums', hasWarn ? 'font-semibold text-amber-700' : 'text-slate-300')}>
                                  {d.servicesWithoutSegments || '—'}
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </InklapSectie>
                )}
              </div>

              <div className="p-5 md:p-6 bg-slate-50/80 flex gap-3 shrink-0">
                <Button
                  variant="ghost"
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    setMatrixPreviewOpen(false);
                    setPendingMatrixXlsxBase64('');
                    setPendingMatrixFilename('');
                    setMatrixPreview(null);
                    setPeriodeVan('');
                    setPeriodeTot('');
                    setZiekteGeregistreerd(new Set());
                  }}
                >
                  Annuleren
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  className={cn('flex-1', matrixPreviewHasIssues && 'bg-slate-400 hover:bg-slate-400 shadow-none')}
                  onClick={confirmMatrixImport}
                  disabled={isMatrixImporting || isPreviewVerversen || matrixPreviewHasIssues}
                  title={matrixPreviewHasIssues ? 'Los eerst de fouten op in de Excel of in de planningscodes/chauffeurslijst.' : undefined}
                >
                  {isMatrixImporting ? 'Importeren…' : matrixPreviewHasIssues ? 'Eerst fouten oplossen' : 'Vervang deze periode'}
                </Button>
              </div>
        </>
        )}
      </Modal>
    </PageShell>
  );
}


