import React, { useEffect, useRef, useState } from 'react';
import { AanwezigOpScherm } from '../../components/AanwezigOpScherm';
import { dienstoverzichtCsv } from '../../lib/dienstoverzichtExport';
import { Download, History, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { Service } from '../../types';
import { isValidBusvakTime, normalizeTimeString } from '../../lib/shiftTime';
import { notify, downloadBlob } from '../../lib/ui';
import { ConfirmationModal, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { Button } from '../../components/primitives';
import { ActieMenu } from '../../components/ActieMenu';
import { Field, Input } from '../../components/Field';
import { Modal, SluitKnop } from '../../components/Modal';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { InfoTip } from '../../components/InfoTip';
import { ROOSTER_MELDING_RUST_MINUTEN } from '../../../shared/roosterMelding';
import { vandaagBrussel } from '../../lib/brussel';
import { DienstTabel, DienstZijvak, useDienstLijst } from '../../components/dienstoverzicht/DienstTabel';

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
  // Tranche 3A: de busvak-tijdcheck zet een fout bij het veld; `vuil` vraagt
  // eerst "Wijzigingen niet bewaren?" bij sluiten met onbewaarde invoer.
  const fouten = useVeldfouten();
  const { vuil } = useVuil(formData, showModal, editingId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (showModal) fouten.wis(); }, [showModal, editingId]);
  // Zoeken en sorteren per kolom in de gedeelde kern (3D.1); standaard de
  // volgorde van de lijst zelf (zoals geïmporteerd/opgeslagen).
  const lijst = useDienstLijst(services);
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
        notify('Het Excel-bestand kon niet verwerkt worden. Controleer of het een geldig Excel-bestand is.', 'error');
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
    void downloadBlob(`beheer_dienstoverzicht_${vandaagBrussel()}.csv`, blob);
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

  const handleSubmit = async () => {
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
          fouten.zet({ [f]: `Ongeldige tijd “${raw}”, gebruik UU:MM, na middernacht als 24:00+ (bv. 26:16).` });
          return;
        }
        cleaned[f] = normalizeTimeString(raw);
      }
      fouten.wis();
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

  // Geeft de Promise terug: de ConfirmationModal toont `bezig` en sluit pas
  // ná het antwoord van de server (fase 2); de `onClose` van de dialoog ruimt
  // de staat op.
  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    return Promise.resolve(onSave(services.filter(s => s.id !== confirmDeleteId)));
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
    // De dialoog wacht op deze Promise en sluit (onClose) daarna zelf.
    return Promise.resolve(onSave(pendingImportedServices, { bulkReplace: true }));
  };

  // Excel importeren + CSV downloaden zitten in het "…"-menu van de paginakop
  // (afwerking 04-09, nr. 7); het zijvak toont alleen nog de kerncijfers.
  const zijvak = (
    <DienstZijvak
      services={services}
      aside={(
        <InfoTip label="Wat gebeurt er na het opslaan?" align="right">
          <p>Wijzig je tijden, delen of loopnummers, dan werkt het portaal de planning van de chauffeurs meteen zelf bij. Goedgekeurde dienstruilen blijven staan.</p>
          <p className="mt-2">Chauffeurs van wie het rooster wijzigt krijgen één melding, zodra je {ROOSTER_MELDING_RUST_MINUTEN} minuten niets meer wijzigt. Meerdere diensten na elkaar aanpassen geeft dus geen reeks meldingen.</p>
          <p className="mt-2">Lukt het bijwerken niet, dan lees je de reden in de melding na het opslaan en bouw je de planning zelf opnieuw op in Beheer planning. Het dienstoverzicht is dan wel gewoon opgeslagen.</p>
        </InfoTip>
      )}
      voet={canAdminOverride ? undefined : 'Excel-import is alleen voor admins; CSV downloaden kan via het menu (…) in de kop.'}
    />
  );

  return (
    <PageShell>
      <PageHeader
        view="beheer-dienstoverzicht"
        title="Beheer dienstoverzicht"
        actions={(
          <>
            <AanwezigOpScherm />
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

      <DienstTabel
        services={services}
        lijst={lijst}
        rijActies={rijActies}
        leegTekst="Voeg handmatig een dienst toe of importeer een Excel-bestand."
        leegActie={<Button variant="secondary" icon={<Plus size={16} />} onClick={() => { setEditingId(null); setFormData(emptyForm); setShowModal(true); }}>Nieuwe dienst</Button>}
        zijvak={zijvak}
      />

      <Modal open={showModal} onClose={() => setShowModal(false)} vuil={vuil} maxWidth="lg" className="flex flex-col !p-0">
        <ModalHeader title={editingId ? 'Dienst bewerken' : 'Nieuwe dienst'} onClose={() => setShowModal(false)} />
        <Formulier onVerstuur={handleSubmit} className="p-6 md:p-7 space-y-5">
          <Field label="Dienstnummer" htmlFor="dienst-nummer">
            <Input
              id="dienst-nummer"
              type="text" required value={formData.serviceNumber}
              onChange={(e) => setFormData({...formData, serviceNumber: e.target.value})}
              className="font-semibold"
            />
          </Field>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Starttijd (deel 1)" htmlFor="dienst-start1" error={fouten.fouten.startTime}>
              <Input
                id="dienst-start1"
                type="text" required inputMode="numeric" placeholder="04:36" pattern="\d{1,2}:\d{2}" title="UU:MM, na middernacht als 24:00+ (bv. 26:16)" value={formData.startTime}
                onChange={(e) => { setFormData({...formData, startTime: e.target.value}); fouten.wisVeld('startTime'); }}
                className="tabular-nums"
              />
            </Field>
            <Field label="Eindtijd (deel 1)" htmlFor="dienst-eind1" error={fouten.fouten.endTime}>
              <Input
                id="dienst-eind1"
                type="text" required inputMode="numeric" placeholder="26:16" pattern="\d{1,2}:\d{2}" title="UU:MM, na middernacht als 24:00+ (bv. 26:16)" value={formData.endTime}
                onChange={(e) => { setFormData({...formData, endTime: e.target.value}); fouten.wisVeld('endTime'); }}
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
            <Field label="Starttijd (deel 2)" htmlFor="dienst-start2" error={fouten.fouten.startTime2}>
              <Input
                id="dienst-start2"
                type="text" inputMode="numeric" placeholder="—" pattern="\d{1,2}:\d{2}" title="UU:MM, na middernacht als 24:00+ (bv. 26:16)" value={formData.startTime2}
                onChange={(e) => { setFormData({...formData, startTime2: e.target.value}); fouten.wisVeld('startTime2'); }}
                className="tabular-nums"
              />
            </Field>
            <Field label="Eindtijd (deel 2)" htmlFor="dienst-eind2" error={fouten.fouten.endTime2}>
              <Input
                id="dienst-eind2"
                type="text" inputMode="numeric" placeholder="—" pattern="\d{1,2}:\d{2}" title="UU:MM, na middernacht als 24:00+ (bv. 26:16)" value={formData.endTime2}
                onChange={(e) => { setFormData({...formData, endTime2: e.target.value}); fouten.wisVeld('endTime2'); }}
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
            <Field label="Starttijd (deel 3)" htmlFor="dienst-start3" error={fouten.fouten.startTime3}>
              <Input
                id="dienst-start3"
                type="text" inputMode="numeric" placeholder="—" pattern="\d{1,2}:\d{2}" title="UU:MM, na middernacht als 24:00+ (bv. 26:16)" value={formData.startTime3}
                onChange={(e) => { setFormData({...formData, startTime3: e.target.value}); fouten.wisVeld('startTime3'); }}
                className="tabular-nums"
              />
            </Field>
            <Field label="Eindtijd (deel 3)" htmlFor="dienst-eind3" error={fouten.fouten.endTime3}>
              <Input
                id="dienst-eind3"
                type="text" inputMode="numeric" placeholder="—" pattern="\d{1,2}:\d{2}" title="UU:MM, na middernacht als 24:00+ (bv. 26:16)" value={formData.endTime3}
                onChange={(e) => { setFormData({...formData, endTime3: e.target.value}); fouten.wisVeld('endTime3'); }}
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
          {/* bezig i.p.v. disabled: na het opslaan werkt de server ook de
              planning bij, de knop toont dat er nog iets loopt. */}
          <div className="mt-4 flex gap-3">
            <SluitKnop onClose={() => setShowModal(false)} variant="ghost" size="lg" className="flex-1" disabled={isSaving}>Annuleren</SluitKnop>
            <Button type="submit" variant="primary" size="lg" className="flex-1" bezig={isSaving}>
              {editingId ? 'Dienst bijwerken' : 'Dienst toevoegen'}
            </Button>
          </div>
        </Formulier>
      </Modal>

      <ConfirmationModal
        open={!!pendingImportedServices}
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
        open={!!confirmDeleteId}
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

