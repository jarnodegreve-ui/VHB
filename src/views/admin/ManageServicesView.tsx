import React, { useRef, useState } from 'react';
import { dienstoverzichtCsv } from '../../lib/dienstoverzichtExport';
import { Clock, Download, History, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { Service } from '../../types';
import { isValidBusvakTime, normalizeTimeString } from '../../lib/shiftTime';
import { cn, notify, downloadBlob } from '../../lib/ui';
import { ConfirmationModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { Button, MicroLabel, Td, Th } from '../../components/primitives';
import { ActieMenu } from '../../components/ActieMenu';
import { SortTh, StickyThead, TableToolbar, useSort, useTabelVoorkeur } from '../../components/Table';
import { Field, Input } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { Zijvak, ZijvakLayout, ZijvakRij } from '../../components/Zijvak';
import { dienstStatistiek, formatDienstDuur } from '../../lib/dienstStatistiek';

// Een deel telt alleen als het een geldige begin- én eindtijd (HH:MM) heeft.
// Zo tonen we voor 1- of 2-delige diensten geen '--'-placeholder in de lege
// deel-kolommen (zelfde logica als de leesweergave ServicesView).
const hasValidTime = (start?: string, end?: string) =>
  !!start && !!end && /^\d{1,2}:\d{2}$/.test(start) && /^\d{1,2}:\d{2}$/.test(end);

export function ManageServicesView({ services, onSave, canAdminOverride }: { services: Service[], onSave: (s: Service[], opts?: { bulkReplace?: boolean }) => Promise<boolean> | boolean | void, canAdminOverride: boolean }) {
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Verborgen file-input voor de Excel-import; het "…"-menu in de kop klikt hem aan.
  const importRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [historyService, setHistoryService] = useState<Service | null>(null);
  const [pendingImportedServices, setPendingImportedServices] = useState<Service[] | null>(null);
  const [pendingImportCount, setPendingImportCount] = useState(0);
  const [formData, setFormData] = useState({
    serviceNumber: '', 
    startTime: '', 
    endTime: '',
    startTime2: '',
    endTime2: '',
    startTime3: '',
    endTime3: '',
    loopnr: '',
    loopnr2: '',
    loopnr3: ''
  });
  const [isImporting, setIsImporting] = useState(false);
  // Zoeken op dienst- of loopnummer; sorteren per kolom. Standaard blijft de
  // volgorde van de lijst zelf (zoals geïmporteerd/opgeslagen) — 'volgorde'
  // is die onzichtbare standaardsleutel.
  const [zoek, setZoek] = useState('');
  const sort = useSort<'volgorde' | 'dienst' | 'loop1' | 'start'>('volgorde');
  // Rijdichtheid, onthouden per toestel.
  const voorkeur = useTabelVoorkeur('dienstoverzicht');
  const zoekTerm = zoek.trim().toLowerCase();
  const gefilterd = zoekTerm
    ? services.filter((s) => [s.serviceNumber, s.loopnr, s.loopnr2, s.loopnr3].filter(Boolean).join(' ').toLowerCase().includes(zoekTerm))
    : services;
  const volgorde = new Map(services.map((s, i) => [s.id, i]));
  const gesorteerd = sort.sorteer(gefilterd, (s, k) => {
    switch (k) {
      case 'volgorde': return volgorde.get(s.id) ?? 0;
      case 'dienst': return s.serviceNumber;
      case 'loop1': return s.loopnr || null;
      case 'start': return s.startTime || null;
    }
  });
  /** "04:36–07:52" — en-dash, zoals de chauffeursweergave. */
  const tijdvak = (van: string, tot: string) => `${van}–${tot}`;
  // Rij-acties in één "…"-menu (ActieMenu): drie losse iconknoppen maakten de
  // Acties-kolom te breed om naast het zijvak te passen op 1440 px.
  const rijActies = (s: Service) => (
    <ActieMenu
      size="sm"
      label={`Acties voor dienst ${s.serviceNumber}`}
      items={[
        { label: 'Bewerken', icon: <Pencil size={16} />, onClick: () => handleEdit(s) },
        { label: 'Wijzigingsgeschiedenis', icon: <History size={16} />, onClick: () => setHistoryService(s) },
        ...(canAdminOverride ? [{ label: 'Verwijderen', icon: <Trash2 size={16} />, gevaarlijk: true, scheiding: true, onClick: () => handleDelete(s.id) }] : []),
      ]}
    />
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canAdminOverride) {
      notify('Excel-import is alleen beschikbaar voor admins.', 'error');
      if (e.target) e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSX = await import('xlsx');
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
          notify('Het Excel-bestand lijkt leeg te zijn.', 'error');
          setIsImporting(false);
          return;
        }

        const formatExcelTime = (val: any) => {
          if (val === undefined || val === null || val === "") return "";
          if (typeof val === 'number') {
            // Excel stores time as a fraction of 24 hours (0.5 = 12:00)
            const totalSeconds = Math.round(val * 24 * 3600);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          }
          return normalizeTimeString(val.toString().trim());
        };

        const importedServices: Service[] = jsonData.map((row: any, index) => {
          const rowKeys = Object.keys(row);
          const findValue = (patterns: string[]) => {
            const foundKey = rowKeys.find(k => {
              const cleanK = k.toString().trim().toLowerCase();
              return patterns.some(p => cleanK.includes(p));
            });
            return foundKey ? row[foundKey] : undefined;
          };

          const serviceNumber = findValue(['dienst', 'nummer', 'service', 'nr']);
          
          // Part 1
          const startTime = findValue(['start 1', 'begin 1', 'van 1', 'starttijd 1', 'start (deel 1)']);
          const endTime = findValue(['eind 1', 'stop 1', 'tot 1', 'eindtijd 1', 'einde (deel 1)']);
          
          // Part 2 — herkent ook xlsx auto-suffix wanneer 'begin'/'einde'
          // drie keer voorkomen als kolomnaam (begin_1 = tweede 'begin'-kolom).
          const startTime2 = findValue(['start 2', 'begin 2', 'van 2', 'starttijd 2', 'start (deel 2)', 'begin_1', 'begin2']);
          const endTime2 = findValue(['eind 2', 'stop 2', 'tot 2', 'eindtijd 2', 'einde (deel 2)', 'einde_1', 'einde2']);

          // Part 3
          const startTime3 = findValue(['start 3', 'begin 3', 'van 3', 'starttijd 3', 'start (deel 3)', 'begin_2', 'begin3']);
          const endTime3 = findValue(['eind 3', 'stop 3', 'tot 3', 'eindtijd 3', 'einde (deel 3)', 'einde_2', 'einde3']);

          // Loopnummers per deel — het deel van de dienst waar bepaalde
          // ritten onder vallen. Kolomnaam mag 'loop 1'/'loopnr 1'/'loopnummer 1'
          // zijn (of zonder cijfer voor deel 1).
          const loopnr = findValue(['loop 1', 'loopnr 1', 'loopnummer 1', 'loop (deel 1)', 'loop', 'loopnr', 'loopnummer']);
          const loopnr2 = findValue(['loop 2', 'loopnr 2', 'loopnummer 2', 'loop (deel 2)', 'loop_1', 'loopnr_1']);
          const loopnr3 = findValue(['loop 3', 'loopnr 3', 'loopnummer 3', 'loop (deel 3)', 'loop_2', 'loopnr_2']);

          // Fallback for simple start/end if part 1 is missing
          const finalStart = startTime || findValue(['start', 'begin', 'van']);
          const finalEnd = endTime || findValue(['eind', 'stop', 'tot']);

          return {
            id: (Date.now() + index).toString(),
            serviceNumber: serviceNumber?.toString().trim() || '',
            startTime: formatExcelTime(finalStart),
            endTime: formatExcelTime(finalEnd),
            startTime2: formatExcelTime(startTime2),
            endTime2: formatExcelTime(endTime2),
            startTime3: formatExcelTime(startTime3),
            endTime3: formatExcelTime(endTime3),
            loopnr: loopnr?.toString().trim() || '',
            loopnr2: loopnr2?.toString().trim() || '',
            loopnr3: loopnr3?.toString().trim() || ''
          };
        }).filter(s => s.serviceNumber);

        if (importedServices.length > 0) {
          setPendingImportedServices(importedServices);
          setPendingImportCount(importedServices.length);
        } else {
          notify('Geen geldige diensten gevonden in het bestand. Controleer de kolommen Dienst, Start en Eind.', 'error');
        }
      } catch (error) {
        console.error('Error parsing Excel:', error);
        notify('Fout bij het verwerken van het Excel-bestand.', 'error');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadCSV = () => {
    const blob = new Blob([dienstoverzichtCsv(services)], { type: 'text/csv;charset=utf-8;' });
    // downloadBlob i.p.v. een handmatige <a download>: dezelfde iOS-share-
    // route en revokeObjectURL als de andere exports.
    void downloadBlob(`beheer_dienstoverzicht_${new Date().toISOString().split('T')[0]}.csv`, blob);
  };

  const handleEdit = (service: Service) => {
    setEditingId(service.id);
    setFormData({ 
      serviceNumber: service.serviceNumber, 
      startTime: service.startTime, 
      endTime: service.endTime,
      startTime2: service.startTime2 || '',
      endTime2: service.endTime2 || '',
      startTime3: service.startTime3 || '',
      endTime3: service.endTime3 || '',
      loopnr: service.loopnr || '',
      loopnr2: service.loopnr2 || '',
      loopnr3: service.loopnr3 || ''
    });
    setShowModal(true);
  };

  const emptyForm = {
    serviceNumber: '',
    startTime: '',
    endTime: '',
    startTime2: '',
    endTime2: '',
    startTime3: '',
    endTime3: '',
    loopnr: '',
    loopnr2: '',
    loopnr3: ''
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      // Pas sluiten/wissen ná een geslaagde save: bij een 409 of serverfout
      // bleef de invoer voorheen niet bewaard — het enige formulier in de
      // app dat fire-and-forget opsloeg (controleronde 30/07).
      // Busvak-validatie + normalisatie ("6:00" → "06:00"): het native
      // time-veld kon geen 24:00+ aan waardoor dienst 2607 onbewerkbaar was;
      // een tekstveld kan alles, dus de regels (uur ≤ 47, min ≤ 59) hier.
      const timeFields = ['startTime', 'endTime', 'startTime2', 'endTime2', 'startTime3', 'endTime3'] as const;
      const cleaned: typeof formData = { ...formData };
      for (const f of timeFields) {
        const raw = String(cleaned[f] ?? '').trim();
        if (!raw) { cleaned[f] = ''; continue; }
        if (!isValidBusvakTime(raw)) {
          notify(`Ongeldige tijd "${raw}" — gebruik UU:MM, na middernacht als 24:00+ (bv. 26:16).`, 'error');
          return;
        }
        cleaned[f] = normalizeTimeString(raw);
      }
      const next = editingId
        ? services.map(s => s.id === editingId ? { ...s, ...cleaned } : s)
        : [...services, { id: Date.now().toString(), ...cleaned }];
      const ok = await onSave(next);
      if (ok === false) return;
      setShowModal(false);
      setEditingId(null);
      setFormData(emptyForm);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!canAdminOverride) {
      notify('Diensten verwijderen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    setConfirmDeleteId(id);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    void onSave(services.filter(s => s.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const handleConfirmImport = () => {
    if (!canAdminOverride) {
      notify('Excel-import is alleen beschikbaar voor admins.', 'error');
      setPendingImportedServices(null);
      setPendingImportCount(0);
      return;
    }
    if (!pendingImportedServices) return;
    // Bewuste volledige vervanging (al bevestigd in de dialoog hierboven) —
    // meld dat aan de server zodat de bulk-wipe-vangrail niet blokkeert.
    void onSave(pendingImportedServices, { bulkReplace: true });
    setPendingImportedServices(null);
    setPendingImportCount(0);
  };

  // Kerncijfers voor het zijvak — over de hele lijst, niet het zoekresultaat.
  const stat = dienstStatistiek(services);
  const uiterste = (u: { serviceNumber: string; minuten: number } | null) =>
    u ? `${u.serviceNumber} · ${formatDienstDuur(u.minuten)}` : '—';

  // Excel importeren + CSV downloaden zitten in het "…"-menu van de paginakop
  // (afwerking 04-09, nr. 7); het zijvak toont alleen nog de kerncijfers.
  const zijvak = (
    <Zijvak
      titel="Overzicht"
      voet={canAdminOverride ? undefined : 'Excel-import is alleen voor admins; CSV downloaden kan via het menu (…) in de kop.'}
    >
      <ZijvakRij label="Diensten" waarde={stat.diensten} mono />
      <ZijvakRij label="Loops" waarde={stat.loops} mono />
      <ZijvakRij label="Langste dienst" waarde={uiterste(stat.langste)} mono />
      <ZijvakRij label="Kortste dienst" waarde={uiterste(stat.kortste)} mono />
    </Zijvak>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Beheer"
        title="Beheer dienstoverzicht"
        description="Voeg diensten toe, bewerk of verwijder ze."
        actions={(
          <>
            {/* Eén gouden knop; import en export in het "…"-menu ernaast, zodat
                er op mobiel geen drie knoppen stapelen (afwerking 04-09, nr. 7). */}
            <input ref={importRef} type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
            <ActieMenu
              label="Meer acties"
              align="left"
              items={[
                ...(canAdminOverride ? [{ label: isImporting ? 'Bezig met importeren…' : 'Excel importeren', icon: <Upload size={16} />, disabled: isImporting, onClick: () => importRef.current?.click() }] : []),
                { label: 'CSV downloaden', icon: <Download size={16} />, disabled: services.length === 0, onClick: downloadCSV },
              ]}
            />
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                setEditingId(null);
                // De drie loopnr-velden hoorden hier ook thuis: zonder hen
                // werden de inputs na "Nieuwe dienst" ongecontroleerd (React
                // waarschuwt daarover en de vorige waarde kan blijven hangen).
                // Precies de loopnummer-laag die eerder al stil data wiste —
                // de typecheck ving dit pas zodra de React-types meededen.
                setFormData({
                  serviceNumber: '',
                  startTime: '',
                  endTime: '',
                  startTime2: '',
                  endTime2: '',
                  startTime3: '',
                  endTime3: '',
                  loopnr: '',
                  loopnr2: '',
                  loopnr3: '',
                });
                setShowModal(true);
              }}
            >
              Nieuwe dienst
            </Button>
          </>
        )}
      />

      {/* Desktop: tabel als hoofdkolom + zijvak (afwerkingsronde 04-09);
          xl omdat de acht kolommen op lg naast een vak te krap zitten. */}
      <ZijvakLayout breekpunt="xl" zijvak={zijvak}>
      {/* `overflow-clip` i.p.v. TableShell: die maakt een scrollcontainer en
          dan plakt de kolomkop niet meer onder de topbar. De tabel is
          desktop-only (mobiel = kaartlijst), dus horizontaal scrollen hoeft niet. */}
      <div className="surface-table rounded-3xl overflow-clip">
        <div className="border-b border-slate-200/70 px-5 py-4 md:px-6">
          <TableToolbar
            zoek={zoek}
            onZoek={setZoek}
            placeholder="Zoek op dienst- of loopnummer…"
            telling={`${gesorteerd.length} van ${services.length}`}
            dichtheid={voorkeur.dichtheid}
          />
        </div>

        {gesorteerd.length > 0 && (
          <div className="hidden md:block">
            <table className={cn('w-full text-left border-collapse', voorkeur.tabelClass)}>
              <StickyThead>
                <tr>
                  {/* Zelfde indeling als het totaaloverzicht van de planning
                      en als de chauffeurs-weergave: loop vóór de uren. */}
                  <SortTh kolom="dienst" sort={sort}>Dienst</SortTh>
                  <SortTh kolom="loop1" sort={sort}>Loop 1</SortTh>
                  <SortTh kolom="start" sort={sort}>Deel 1</SortTh>
                  <Th>Loop 2</Th>
                  <Th>Deel 2</Th>
                  <Th>Loop 3</Th>
                  <Th>Deel 3</Th>
                  <Th className="text-right">Acties</Th>
                </tr>
              </StickyThead>
              <tbody>
                {gesorteerd.map(s => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                    <Td className="font-semibold text-slate-800 tabular-nums">{s.serviceNumber}</Td>
                    <Td className="tabular-nums font-semibold text-slate-700">{s.loopnr || <span className="font-normal text-slate-300">—</span>}</Td>
                    <Td className="tabular-nums whitespace-nowrap">{tijdvak(s.startTime, s.endTime)}</Td>
                    <Td className="tabular-nums font-semibold text-slate-700">
                      {hasValidTime(s.startTime2, s.endTime2) && s.loopnr2 ? s.loopnr2 : <span className="font-normal text-slate-300">—</span>}
                    </Td>
                    <Td className="tabular-nums whitespace-nowrap">
                      {hasValidTime(s.startTime2, s.endTime2) ? tijdvak(s.startTime2!, s.endTime2!) : ''}
                    </Td>
                    <Td className="tabular-nums font-semibold text-slate-700">
                      {hasValidTime(s.startTime3, s.endTime3) && s.loopnr3 ? s.loopnr3 : <span className="font-normal text-slate-300">—</span>}
                    </Td>
                    <Td className="tabular-nums whitespace-nowrap">
                      {hasValidTime(s.startTime3, s.endTime3) ? tijdvak(s.startTime3!, s.endTime3!) : ''}
                    </Td>
                    <Td className="w-14 text-right">{rijActies(s)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobiel: kaart per dienst */}
        <div className="md:hidden divide-y divide-slate-100">
          {gesorteerd.map(s => (
            <div key={s.id} className="p-5 space-y-4 hover:bg-slate-50/50 transition-colors">
              <div className="flex justify-between items-center">
                <span className="text-card-title tabular-nums">{s.serviceNumber}</span>
                {rijActies(s)}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-col gap-1">
                  <MicroLabel>Deel 1{s.loopnr ? ` · loop ${s.loopnr}` : ''}</MicroLabel>
                  <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm tabular-nums">
                    <Clock size={14} className="text-oker-500" />
                    {tijdvak(s.startTime, s.endTime)}
                  </div>
                </div>

                {hasValidTime(s.startTime2, s.endTime2) && (
                  <div className="flex flex-col gap-1">
                    <MicroLabel>Deel 2{s.loopnr2 ? ` · loop ${s.loopnr2}` : ''}</MicroLabel>
                    <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm tabular-nums">
                      <Clock size={14} className="text-oker-500" />
                      {tijdvak(s.startTime2!, s.endTime2!)}
                    </div>
                  </div>
                )}

                {hasValidTime(s.startTime3, s.endTime3) && (
                  <div className="flex flex-col gap-1">
                    <MicroLabel>Deel 3{s.loopnr3 ? ` · loop ${s.loopnr3}` : ''}</MicroLabel>
                    <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm tabular-nums">
                      <Clock size={14} className="text-oker-500" />
                      {tijdvak(s.startTime3!, s.endTime3!)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {gesorteerd.length === 0 && (
          <div className="p-6">
            {zoekTerm ? (
              <EmptyState
                title={`Geen resultaten voor “${zoek.trim()}”`}
                message="Zoek op dienstnummer of loopnummer."
                action={<Button variant="secondary" onClick={() => setZoek('')}>Zoekterm wissen</Button>}
              />
            ) : (
              <EmptyState
                title="Nog geen diensten"
                message="Voeg handmatig een dienst toe of importeer een Excel-bestand."
                action={<Button variant="secondary" icon={<Plus size={16} />} onClick={() => { setEditingId(null); setFormData(emptyForm); setShowModal(true); }}>Nieuwe dienst</Button>}
              />
            )}
          </div>
        )}
      </div>
      </ZijvakLayout>

      <Modal open={showModal} onClose={() => setShowModal(false)} maxWidth="lg" className="flex flex-col !p-0">
        <ModalHeader title={editingId ? 'Dienst bewerken' : 'Nieuwe dienst'} onClose={() => setShowModal(false)} />
        <form onSubmit={handleSubmit} className="p-6 md:p-7 space-y-5">
          <Field label="Dienstnummer" htmlFor="dienst-nummer">
            <Input
              id="dienst-nummer"
              type="text" required value={formData.serviceNumber}
              onChange={(e) => setFormData({...formData, serviceNumber: e.target.value})}
              className="font-semibold"
            />
          </Field>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Starttijd (deel 1)" htmlFor="dienst-start1">
              <Input
                id="dienst-start1"
                type="text" required inputMode="numeric" placeholder="04:36" pattern="\\d{1,2}:\\d{2}" title="UU:MM — na middernacht als 24:00+ (bv. 26:16)" value={formData.startTime}
                onChange={(e) => setFormData({...formData, startTime: e.target.value})}
                className="tabular-nums"
              />
            </Field>
            <Field label="Eindtijd (deel 1)" htmlFor="dienst-eind1">
              <Input
                id="dienst-eind1"
                type="text" required inputMode="numeric" placeholder="26:16" pattern="\\d{1,2}:\\d{2}" title="UU:MM — na middernacht als 24:00+ (bv. 26:16)" value={formData.endTime}
                onChange={(e) => setFormData({...formData, endTime: e.target.value})}
                className="tabular-nums"
              />
            </Field>
            <Field label="Loopnummer (deel 1)" htmlFor="dienst-loop1">
              <Input
                id="dienst-loop1"
                type="text" inputMode="numeric" value={formData.loopnr}
                onChange={(e) => setFormData({...formData, loopnr: e.target.value})}
                placeholder="bv. 12"
                className="tabular-nums"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Starttijd (deel 2)" htmlFor="dienst-start2">
              <Input
                id="dienst-start2"
                type="text" inputMode="numeric" placeholder="—" pattern="\\d{1,2}:\\d{2}" title="UU:MM — na middernacht als 24:00+ (bv. 26:16)" value={formData.startTime2}
                onChange={(e) => setFormData({...formData, startTime2: e.target.value})}
                className="tabular-nums"
              />
            </Field>
            <Field label="Eindtijd (deel 2)" htmlFor="dienst-eind2">
              <Input
                id="dienst-eind2"
                type="text" inputMode="numeric" placeholder="—" pattern="\\d{1,2}:\\d{2}" title="UU:MM — na middernacht als 24:00+ (bv. 26:16)" value={formData.endTime2}
                onChange={(e) => setFormData({...formData, endTime2: e.target.value})}
                className="tabular-nums"
              />
            </Field>
            <Field label="Loopnummer (deel 2)" htmlFor="dienst-loop2">
              <Input
                id="dienst-loop2"
                type="text" inputMode="numeric" value={formData.loopnr2}
                onChange={(e) => setFormData({...formData, loopnr2: e.target.value})}
                placeholder="bv. 12"
                className="tabular-nums"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Starttijd (deel 3)" htmlFor="dienst-start3">
              <Input
                id="dienst-start3"
                type="text" inputMode="numeric" placeholder="—" pattern="\\d{1,2}:\\d{2}" title="UU:MM — na middernacht als 24:00+ (bv. 26:16)" value={formData.startTime3}
                onChange={(e) => setFormData({...formData, startTime3: e.target.value})}
                className="tabular-nums"
              />
            </Field>
            <Field label="Eindtijd (deel 3)" htmlFor="dienst-eind3">
              <Input
                id="dienst-eind3"
                type="text" inputMode="numeric" placeholder="—" pattern="\\d{1,2}:\\d{2}" title="UU:MM — na middernacht als 24:00+ (bv. 26:16)" value={formData.endTime3}
                onChange={(e) => setFormData({...formData, endTime3: e.target.value})}
                className="tabular-nums"
              />
            </Field>
            <Field label="Loopnummer (deel 3)" htmlFor="dienst-loop3">
              <Input
                id="dienst-loop3"
                type="text" inputMode="numeric" value={formData.loopnr3}
                onChange={(e) => setFormData({...formData, loopnr3: e.target.value})}
                placeholder="bv. 12"
                className="tabular-nums"
              />
            </Field>
          </div>
          <Button type="submit" variant="primary" size="lg" full className="mt-4" disabled={isSaving}>
            {editingId ? 'Dienst bijwerken' : 'Dienst toevoegen'}
          </Button>
        </form>
      </Modal>

      <ConfirmationModal
        isOpen={!!pendingImportedServices}
        onClose={() => {
          setPendingImportedServices(null);
          setPendingImportCount(0);
        }}
        onConfirm={handleConfirmImport}
        title="Diensten importeren"
        message={`Er zijn ${pendingImportCount} diensten gevonden. De huidige lijst wordt vervangen door deze import.`}
        confirmText="Importeren"
        variant="warning"
      />

      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleConfirmDelete}
        title="Dienst verwijderen"
        message="Weet je zeker dat je deze dienst wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
      />

      <EntityHistoryModal
        open={!!historyService}
        onClose={() => setHistoryService(null)}
        entityType="service"
        entityId={historyService?.id ?? ''}
        title={historyService ? `Dienst ${historyService.serviceNumber}` : undefined}
      />
    </PageShell>
  );
}


