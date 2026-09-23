import React, { useRef, useState } from 'react';
import { Download, History, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { Service } from '../types';
import { AanwezigOpScherm } from '../components/AanwezigOpScherm';
import { dienstoverzichtCsv } from '../lib/dienstoverzichtExport';
import { isValidBusvakTime, normalizeTimeString } from '../lib/shiftTime';
import { notify, downloadBlob } from '../lib/ui';
import { ConfirmationModal, PageHeader, PageShell } from '../components/ui';
import { Button, IconButton } from '../components/primitives';
import { ActieMenu } from '../components/ActieMenu';
import { Field, Input } from '../components/Field';
import { SluitKnop } from '../components/Modal';
import { SlideOver } from '../components/SlideOver';
import { Formulier } from '../components/Formulier';
import { useVeldfouten, useVuil } from '../lib/formulier';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { InfoTip } from '../components/InfoTip';
import { RecordOnbekend } from '../components/RecordOnbekend';
import { useRecordLink } from '../app/useRecordLink';
import { ROOSTER_MELDING_RUST_MINUTEN } from '../../shared/roosterMelding';
import { vandaagBrussel } from '../lib/brussel';
import { DienstTabel, DienstZijvak, useDienstLijst } from '../components/dienstoverzicht/DienstTabel';
import { dienstenUitRijen } from '../components/dienstoverzicht/dienstImport';

type Opslaan = (s: Service[], opts?: { bulkReplace?: boolean; actie?: string }) => Promise<boolean> | boolean | void;

const LEEG_FORMULIER = {
  serviceNumber: '', startTime: '', endTime: '',
  startTime2: '', endTime2: '', startTime3: '', endTime3: '',
  loopnr: '', loopnr2: '', loopnr3: '',
};
type DienstFormulierData = typeof LEEG_FORMULIER;

const formulierVan = (s: Service): DienstFormulierData => ({
  serviceNumber: s.serviceNumber,
  startTime: s.startTime,
  endTime: s.endTime,
  startTime2: s.startTime2 || '',
  endTime2: s.endTime2 || '',
  startTime3: s.startTime3 || '',
  endTime3: s.endTime3 || '',
  loopnr: s.loopnr || '',
  loopnr2: s.loopnr2 || '',
  loopnr3: s.loopnr3 || '',
});

const TIJD_TITEL = 'UU:MM, na middernacht als 24:00+ (bv. 26:16)';

/**
 * Het Dienstoverzicht (3D, 23-09): één scherm voor planner en admin, op
 * /beheer/dienstoverzicht. De lijst (zoeken, sorteren, tabel of kaarten)
 * komt uit de gedeelde kern; een dienst openen zet haar id in de URL
 * (/beheer/dienstoverzicht/<id>, deelbaar, overleeft een refresh) en toont
 * het detailpaneel, op elke breedte een SlideOver zodat de tabel met acht
 * kolommen intact blijft en zoekterm, sortering en scroll blijven staan.
 *
 * Rechten volgen de server, de UI verbergt alleen: bewerken, nieuw en
 * geschiedenis voor planner en admin; Excel importeren en verwijderen alleen
 * admin (`canAdminOverride`; de server weigert een planner allebei, #602).
 * Verwijderen is een expliciete bevestiging die wacht op de server: geen
 * optimistische verwijdering en geen ongedaan maken.
 */
export function ServicesView({ services, onSave, canAdminOverride }: { services: Service[]; onSave: Opslaan; canAdminOverride: boolean }) {
  const lijst = useDienstLijst(services);
  const link = useRecordLink('dienstoverzicht', services);
  const [nieuw, setNieuw] = useState(false);
  const bewerkte = link.staat === 'gevonden' ? link.record : null;
  const paneelOpen = nieuw || bewerkte !== null;

  // Het formulier volgt wat er open staat. Bijgewerkt tijdens de render (niet
  // in een effect), zodat de momentopname van useVuil meteen de gevulde
  // waarden neemt, ook bij een recordlink van buiten of een refresh.
  const gewenst = nieuw ? 'nieuw' : bewerkte?.id ?? null;
  const [formVoor, setFormVoor] = useState<string | null>(null);
  const [formData, setFormData] = useState<DienstFormulierData>(LEEG_FORMULIER);
  if (gewenst !== null && gewenst !== formVoor) {
    setFormVoor(gewenst);
    setFormData(bewerkte && !nieuw ? formulierVan(bewerkte) : LEEG_FORMULIER);
  }
  const fouten = useVeldfouten();
  const { vuil } = useVuil(formData, paneelOpen, formVoor);

  const [isSaving, setIsSaving] = useState(false);
  const [historyService, setHistoryService] = useState<Service | null>(null);
  const [teVerwijderen, setTeVerwijderen] = useState<Service | null>(null);
  const [pendingImportedServices, setPendingImportedServices] = useState<Service[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  // Verborgen file-input voor de Excel-import; het "…"-menu in de kop klikt hem aan.
  const importRef = useRef<HTMLInputElement>(null);

  const openDienst = (s: Service) => { fouten.wis(); setNieuw(false); link.open(s.id); };
  const openNieuw = () => { fouten.wis(); setFormVoor(null); setNieuw(true); link.sluit(); };
  const sluitPaneel = () => { setNieuw(false); setFormVoor(null); link.sluit(); };

  const handleDelete = (s: Service) => {
    if (!canAdminOverride) {
      notify('Diensten verwijderen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    setTeVerwijderen(s);
  };

  // Rij-acties in één "…"-menu: drie losse iconknoppen maakten de kolom te
  // breed om naast het zijvak te passen op 1440 px.
  const rijActies = (s: Service) => (
    <ActieMenu
      size="sm"
      label={`Acties voor dienst ${s.serviceNumber}`}
      items={[
        { label: 'Bewerken', icon: <Pencil size={16} />, onClick: () => openDienst(s) },
        { label: 'Wijzigingsgeschiedenis', icon: <History size={16} />, onClick: () => setHistoryService(s) },
        ...(canAdminOverride ? [{ label: 'Verwijderen', icon: <Trash2 size={16} />, gevaarlijk: true, scheiding: true, onClick: () => handleDelete(s) }] : []),
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
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
        if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
          notify('Het Excel-bestand lijkt leeg te zijn.', 'error');
          return;
        }
        const geimporteerd = dienstenUitRijen(jsonData);
        if (geimporteerd.length > 0) setPendingImportedServices(geimporteerd);
        else notify('Geen geldige diensten gevonden in het bestand. Controleer de kolommen Dienst, Start en Eind.', 'error');
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
    void downloadBlob(`dienstoverzicht_${vandaagBrussel()}.csv`, blob);
  };

  const handleSubmit = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      // Busvak-validatie + normalisatie ("6:00" → "06:00"): een tekstveld
      // aanvaardt 24:00+, dus de regels (uur ≤ 47, min ≤ 59) hier. Het paneel
      // sluit pas ná een geslaagde save; bij een 409 of serverfout blijft de
      // invoer staan.
      const timeFields = ['startTime', 'endTime', 'startTime2', 'endTime2', 'startTime3', 'endTime3'] as const;
      const cleaned: DienstFormulierData = { ...formData };
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
      const next = bewerkte && !nieuw
        ? services.map((s) => (s.id === bewerkte.id ? { ...s, ...cleaned } : s))
        : [...services, { id: Date.now().toString(), ...cleaned }];
      const ok = await onSave(next);
      if (ok === false) return;
      sluitPaneel();
    } finally {
      setIsSaving(false);
    }
  };

  // Server-confirmed: de ConfirmationModal toont `bezig` en sluit pas ná het
  // antwoord. De rij blijft tot de server bevestigt (saveServices zet de lijst
  // pas na een 2xx); mislukt het, dan blijft ze staan en zegt de foutmelding
  // welke dienst niet verwijderd is en waarom.
  const handleConfirmDelete = async () => {
    const doel = teVerwijderen;
    if (!doel) return;
    const ok = await onSave(services.filter((s) => s.id !== doel.id), { actie: `Verwijderen van dienst ${doel.serviceNumber}` });
    if (ok !== false && bewerkte?.id === doel.id) sluitPaneel();
  };

  const handleConfirmImport = () => {
    if (!canAdminOverride) {
      notify('Excel-import is alleen beschikbaar voor admins.', 'error');
      setPendingImportedServices(null);
      return;
    }
    if (!pendingImportedServices) return;
    // Bewuste volledige vervanging (bevestigd in de dialoog): meld dat aan
    // de server zodat de bulk-wipe-vangrail niet blokkeert.
    return Promise.resolve(onSave(pendingImportedServices, { bulkReplace: true }));
  };

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
      voet={canAdminOverride ? undefined : 'Excel-import en verwijderen zijn alleen voor admins; CSV downloaden kan via het menu (…) in de kop.'}
    />
  );

  const tijdVeld = (veld: keyof DienstFormulierData, id: string, label: string, opts: { verplicht?: boolean; placeholder: string }) => (
    <Field label={label} htmlFor={id} error={fouten.fouten[veld]}>
      <Input
        id={id}
        type="text" required={opts.verplicht} inputMode="numeric" placeholder={opts.placeholder} pattern="\d{1,2}:\d{2}" title={TIJD_TITEL} value={formData[veld]}
        onChange={(e) => { setFormData({ ...formData, [veld]: e.target.value }); fouten.wisVeld(veld); }}
        className="tabular-nums"
      />
    </Field>
  );
  const loopVeld = (veld: 'loopnr' | 'loopnr2' | 'loopnr3', id: string, label: string) => (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="text" inputMode="numeric" value={formData[veld]}
        onChange={(e) => setFormData({ ...formData, [veld]: e.target.value })}
        placeholder="bv. 12"
        className="tabular-nums"
      />
    </Field>
  );

  return (
    <PageShell>
      <PageHeader
        view="dienstoverzicht"
        title="Dienstoverzicht"
        actions={(
          <>
            <AanwezigOpScherm />
            {/* Eén gouden knop; import en export in het "…"-menu ernaast. */}
            <input ref={importRef} type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
            <ActieMenu
              label="Meer acties"
              align="left"
              items={[
                ...(canAdminOverride ? [{ label: isImporting ? 'Bezig met importeren…' : 'Excel importeren', icon: <Upload size={16} />, disabled: isImporting, onClick: () => importRef.current?.click() }] : []),
                { label: 'CSV downloaden', icon: <Download size={16} />, disabled: services.length === 0, onClick: downloadCSV },
              ]}
            />
            <Button variant="primary" icon={<Plus size={16} />} onClick={openNieuw}>Nieuwe dienst</Button>
          </>
        )}
      />

      <DienstTabel
        services={services}
        lijst={lijst}
        rijActies={rijActies}
        onKies={openDienst}
        gekozenId={bewerkte?.id ?? null}
        boven={link.staat === 'onbekend' ? <RecordOnbekend soort="dienst" onSluit={link.sluit} /> : undefined}
        leegTekst="Voeg handmatig een dienst toe of importeer een Excel-bestand."
        leegActie={<Button variant="secondary" icon={<Plus size={16} />} onClick={openNieuw}>Nieuwe dienst</Button>}
        zijvak={zijvak}
      />

      {/* Het detailpaneel: op elke breedte een SlideOver (terugknop en Escape
          sluiten, useHistoryDismiss). Sluiten haalt het id uit de URL; de
          lijst eronder is nooit weg geweest. */}
      <SlideOver
        open={paneelOpen}
        onClose={sluitPaneel}
        vuil={vuil}
        title={nieuw || !bewerkte ? 'Nieuwe dienst' : `Dienst ${bewerkte.serviceNumber}`}
        subtitle={nieuw || !bewerkte ? 'Tijden en loopnummers per deel.' : 'Bekijk of bewerk de tijden en loopnummers.'}
        width="lg"
        footer={(
          <div className="flex gap-3">
            <SluitKnop onClose={sluitPaneel} variant="secondary" size="lg" className="flex-1" disabled={isSaving}>Annuleren</SluitKnop>
            <Button type="submit" form="dienst-formulier" variant="primary" size="lg" className="flex-1" bezig={isSaving}>
              {nieuw || !bewerkte ? 'Dienst toevoegen' : 'Dienst bijwerken'}
            </Button>
          </div>
        )}
      >
        {bewerkte && !nieuw && (
          <div className="mb-5 flex items-center justify-end gap-1">
            <IconButton label="Wijzigingsgeschiedenis" size="sm" onClick={() => setHistoryService(bewerkte)}><History size={16} /></IconButton>
            {canAdminOverride && (
              <IconButton label={`Dienst ${bewerkte.serviceNumber} verwijderen`} size="sm" variant="danger" onClick={() => handleDelete(bewerkte)}><Trash2 size={16} /></IconButton>
            )}
          </div>
        )}
        <Formulier id="dienst-formulier" onVerstuur={handleSubmit} className="space-y-5">
          <Field label="Dienstnummer" htmlFor="dienst-nummer">
            <Input
              id="dienst-nummer"
              type="text" required value={formData.serviceNumber}
              onChange={(e) => setFormData({ ...formData, serviceNumber: e.target.value })}
              className="font-semibold"
            />
          </Field>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {tijdVeld('startTime', 'dienst-start1', 'Starttijd (deel 1)', { verplicht: true, placeholder: '04:36' })}
            {tijdVeld('endTime', 'dienst-eind1', 'Eindtijd (deel 1)', { verplicht: true, placeholder: '26:16' })}
            {loopVeld('loopnr', 'dienst-loop1', 'Loopnummer (deel 1)')}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {tijdVeld('startTime2', 'dienst-start2', 'Starttijd (deel 2)', { placeholder: '—' })}
            {tijdVeld('endTime2', 'dienst-eind2', 'Eindtijd (deel 2)', { placeholder: '—' })}
            {loopVeld('loopnr2', 'dienst-loop2', 'Loopnummer (deel 2)')}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {tijdVeld('startTime3', 'dienst-start3', 'Starttijd (deel 3)', { placeholder: '—' })}
            {tijdVeld('endTime3', 'dienst-eind3', 'Eindtijd (deel 3)', { placeholder: '—' })}
            {loopVeld('loopnr3', 'dienst-loop3', 'Loopnummer (deel 3)')}
          </div>
        </Formulier>
      </SlideOver>

      <ConfirmationModal
        open={!!pendingImportedServices}
        onClose={() => setPendingImportedServices(null)}
        onConfirm={handleConfirmImport}
        title="Diensten importeren"
        message={`Er zijn ${pendingImportedServices?.length ?? 0} diensten gevonden. De huidige lijst wordt vervangen door deze import.`}
        confirmText="Importeren"
        variant="warning"
      />

      <ConfirmationModal
        open={!!teVerwijderen}
        onClose={() => setTeVerwijderen(null)}
        onConfirm={handleConfirmDelete}
        title={teVerwijderen ? `Dienst ${teVerwijderen.serviceNumber} verwijderen` : 'Dienst verwijderen'}
        message="De dienst verdwijnt uit het dienstoverzicht en de planning wordt bijgewerkt. Dit kan niet ongedaan worden gemaakt."
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
