import React, { useMemo, useState } from 'react';
import { Calendar, ChevronRight, FileText, History, MapPin, Plus, Trash2, Upload } from 'lucide-react';
import type { Diversion } from '../../types';
import { cn, notify } from '../../lib/ui';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, IconButton } from '../../components/primitives';
import { Card } from '../../components/Card';
import { DateInput, Field, Input, Textarea } from '../../components/Field';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { DetailPaneel, MasterDetail } from '../../components/DetailPaneel';

/** Verlopen = einddatum vóór vandaag; zonder einddatum blijft een omleiding
 *  actief tot hij verwijderd wordt. */
import { isExpiredDiversion as isExpired } from '../../lib/diversions';
// isoDate = lokale dag. toISOString() is UTC en gaf tussen 00:00 en 02:00
// Belgische zomertijd de dag ervóór: een omleiding die om 00:30 werd
// aangemaakt kreeg standaard gisteren als startdatum. Zelfde reden als de
// expliciete waarschuwing in ScheduleView.
import { isoDate } from '../../lib/availability';

const FORM_ID = 'omleiding-form';

export function ManageDiversionsView({ diversions, onSave, onSaveDiversion, onCreateDiversion, onDeleteDiversion }: {
  diversions: Diversion[];
  /** Collectie-saver (hele lijst) — alleen nog de terugval als de
   *  per-record-savers hieronder niet doorgegeven zijn. */
  onSave: (d: Diversion[]) => void;
  /** Per record (PUT/POST one/DELETE, useAppData). Optioneel tot App ze doorgeeft. */
  onSaveDiversion?: (d: Diversion) => Promise<boolean>;
  onCreateDiversion?: (d: Diversion) => Promise<boolean>;
  onDeleteDiversion?: (id: string) => Promise<boolean>;
}) {
  // Het bewerkformulier leeft in het DetailPaneel: desktop naast de lijst,
  // mobiel als SlideOver. "Nieuw" opent hetzelfde paneel leeg.
  const [paneelOpen, setPaneelOpen] = useState(false);
  // Actieve omleidingen eerst (nieuwste bovenaan), verlopen onderaan — die
  // bleven voorheen ongemarkeerd tussen de actieve staan én meetellen.
  const sortedDiversions = useMemo(() => {
    return [...diversions].sort((a, b) => {
      const ea = isExpired(a) ? 1 : 0;
      const eb = isExpired(b) ? 1 : 0;
      if (ea !== eb) return ea - eb;
      return String(b.startDate || '').localeCompare(String(a.startDate || ''));
    });
  }, [diversions]);
  const activeCount = useMemo(() => diversions.filter((d) => !isExpired(d)).length, [diversions]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [historyDiversion, setHistoryDiversion] = useState<Diversion | null>(null);

  const [formData, setFormData] = useState<Partial<Diversion>>({
    line: '',
    title: '',
    description: '',
    startDate: isoDate(new Date()),
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const uploadPdf = async (id: string, file: File): Promise<string | null> => {
    if (file.size > 20 * 1024 * 1024) {
      notify('PDF is te groot (max 20 MB).', 'error');
      return null;
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      notify('Alleen PDF-bestanden zijn toegestaan.', 'error');
      return null;
    }
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Kon bestand niet lezen.'));
      reader.readAsDataURL(file);
    });
    const response = await apiFetch('/api/diversions/pdf', {
      method: 'POST',
      body: JSON.stringify({ id, filename: file.name, dataUrl }),
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try { detail = JSON.parse(text).error || detail; } catch {}
      notify(`Upload mislukt: ${detail}`, 'error');
      return null;
    }
    try {
      const result = JSON.parse(text);
      return result.publicUrl as string;
    } catch {
      notify('Onverwachte respons van server na upload.', 'error');
      return null;
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({
      line: '',
      title: '',
      description: '',
      startDate: isoDate(new Date()),
    });
    setPdfFile(null);
    setPaneelOpen(true);
  };

  const handleOpenEdit = (div: Diversion) => {
    setEditingId(div.id);
    setFormData({
      line: div.line,
      title: div.title,
      description: div.description,
      startDate: div.startDate,
      endDate: div.endDate,
    });
    setPdfFile(null);
    setPaneelOpen(true);
  };

  const sluitPaneel = () => setPaneelOpen(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) return;

    // UUID i.p.v. Date.now() zodat de Storage-path (${id}.pdf) niet te
    // raden is voor wie het URL-patroon kent.
    const generateId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const targetId = editingId || generateId();
    let uploadedPdfUrl: string | null = null;

    if (pdfFile) {
      setIsUploading(true);
      try {
        uploadedPdfUrl = await uploadPdf(targetId, pdfFile);
      } catch (error: any) {
        // fetch/FileReader kan ook gooien (offline, leesfout) — zonder deze
        // catch bleef de knop eeuwig op 'PDF uploaden…' hangen.
        notify(`Upload mislukt: ${error?.message || 'netwerkfout'}.`, 'error');
        return;
      } finally {
        setIsUploading(false);
      }
      if (!uploadedPdfUrl) return; // notify reeds getoond
    }

    if (editingId) {
      const bestaande = diversions.find((d) => d.id === editingId);
      const bijgewerkt = { ...bestaande, ...formData, id: editingId, pdfUrl: uploadedPdfUrl || bestaande?.pdfUrl } as Diversion;
      if (onSaveDiversion) {
        // Per record: het paneel blijft open als het misging (409 → de lijst
        // is ververst; de gebruiker ziet de nieuwe staat en kan opnieuw).
        if (!(await onSaveDiversion(bijgewerkt))) return;
      } else {
        onSave(diversions.map((d) => (d.id === editingId ? bijgewerkt : d)));
      }
    } else {
      const diversionToAdd: Diversion = {
        id: targetId,
        line: formData.line || 'Alle',
        title: formData.title || '',
        description: formData.description || '',
        startDate: formData.startDate || '',
        endDate: formData.endDate,
        pdfUrl: uploadedPdfUrl || undefined,
      };
      if (onCreateDiversion) {
        if (!(await onCreateDiversion(diversionToAdd))) return;
      } else {
        onSave([...diversions, diversionToAdd]);
      }
    }

    sluitPaneel();
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    if (onDeleteDiversion) {
      if (!(await onDeleteDiversion(id))) return;
    } else {
      onSave(diversions.filter((d) => d.id !== id));
    }
    if (id === editingId) sluitPaneel();
  };

  const bewerkte = editingId ? diversions.find((d) => d.id === editingId) ?? null : null;

  const lijst = sortedDiversions.length > 0 ? (
    <ul className="space-y-2" aria-label="Omleidingen">
      {sortedDiversions.map(div => {
        const expired = isExpired(div);
        const isCurrent = paneelOpen && editingId === div.id;
        return (
          <Card
            key={div.id}
            as="li"
            padding="none"
            interactive
            aria-current={isCurrent ? 'true' : undefined}
            className={cn('overflow-hidden', expired && 'opacity-60', isCurrent && 'ring-1 ring-oker-400 bg-oker-50/40')}
          >
            {/* rauw: lijstrij van het master-detail (kaart als knop: icoontegel + titel + badges + periode + chevron) — opent het bewerkpaneel */}
            <button
              type="button"
              onClick={() => handleOpenEdit(div)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50/50 md:px-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', expired ? 'bg-slate-500/12 text-slate-500' : 'bg-oker-500/15 text-oker-700')}>
                  <MapPin size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h3 className="text-card-title leading-snug">{div.title}</h3>
                    <Badge tone="slate">Lijn {div.line}</Badge>
                    {expired && <Badge tone="slate">Verlopen</Badge>}
                    {div.pdfUrl && <Badge tone="emerald" icon={<FileText size={12} />}>PDF</Badge>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-2xs font-medium text-slate-500 tabular-nums">
                    <Calendar size={12} className="text-slate-400" />
                    {div.startDate} {div.endDate ? `t/m ${div.endDate}` : '(geen einddatum)'}
                  </div>
                </div>
              </div>
              <ChevronRight size={20} className={cn('shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')} />
            </button>
          </Card>
        );
      })}
    </ul>
  ) : (
    <EmptyState
      icon={<MapPin size={24} />}
      title="Nog geen omleidingen"
      message="Chauffeurs zien een omleiding meteen op hun dashboard en onder Omleidingen."
      action={<Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe omleiding</Button>}
    />
  );

  const paneel = (
    <DetailPaneel
      open={paneelOpen}
      onClose={sluitPaneel}
      title={editingId ? 'Omleiding bewerken' : 'Nieuwe omleiding'}
      subtitle={bewerkte ? `${bewerkte.title} — lijn ${bewerkte.line}` : 'Vul de details in en voeg eventueel een PDF toe.'}
      sleutel={editingId ?? 'nieuw'}
      leegTekst="Kies een omleiding om te bewerken, of maak een nieuwe."
      leegActie={<Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe omleiding</Button>}
      icon={(
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-oker-500/15 text-oker-700">
          <MapPin size={16} />
        </span>
      )}
      footer={(
        <div className="flex items-center gap-2">
          {bewerkte && (
            <>
              <IconButton label="Wijzigingsgeschiedenis" variant="ghost" onClick={() => setHistoryDiversion(bewerkte)}><History size={16} /></IconButton>
              <IconButton label="Verwijderen" variant="danger" onClick={() => setConfirmDeleteId(bewerkte.id)}><Trash2 size={16} /></IconButton>
            </>
          )}
          <Button variant="secondary" size="lg" className="flex-1" onClick={sluitPaneel}>
            Annuleren
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" size="lg" className="flex-1" disabled={isUploading}>
            {isUploading ? 'PDF uploaden…' : editingId ? 'Opslaan' : 'Toevoegen'}
          </Button>
        </div>
      )}
    >
      {/* De opslaan-knop staat in de footer (buiten het formulier) en koppelt
          via form={FORM_ID}; Enter in een veld dient dus ook gewoon in. */}
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-5">
        <Field label="Lijn(en)" htmlFor="omleiding-lijn">
          <Input
            id="omleiding-lijn"
            type="text"
            required
            value={formData.line}
            onChange={(e) => setFormData({...formData, line: e.target.value})}
            placeholder="bv. 1, 2 of Alle"
          />
        </Field>

        <Field label="Titel" htmlFor="omleiding-titel">
          <Input
            id="omleiding-titel"
            type="text"
            required
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            placeholder="bv. Wegwerkzaamheden N70"
          />
        </Field>

        <Field label="Omschrijving" htmlFor="omleiding-omschrijving">
          <Textarea
            id="omleiding-omschrijving"
            required
            rows={3}
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            placeholder="Beschrijf de omleiding…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Startdatum" htmlFor="omleiding-start">
            <DateInput
              id="omleiding-start"
              required
              value={formData.startDate}
              max={formData.endDate || undefined}
              onChange={(v) => setFormData({...formData, startDate: v})}
            />
          </Field>
          <Field label="Einddatum" hint="Leeg = tot hij verwijderd wordt." htmlFor="omleiding-eind">
            <DateInput
              id="omleiding-eind"
              value={formData.endDate || ''}
              min={formData.startDate || undefined}
              onChange={(v) => setFormData({...formData, endDate: v})}
            />
          </Field>
        </div>

        <Field label={editingId ? 'PDF-bestand (optioneel)' : 'PDF-bestand'} htmlFor="pdf-upload">
          <div className="relative">
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              className="hidden"
              id="pdf-upload"
            />
            {/* Label-als-knop voor het verborgen file-input: de native
                bestandskiezer opent via het label, niet via een knop. */}
            <label
              htmlFor="pdf-upload"
              className="ios-pressable control-button-soft inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:text-slate-900"
            >
              <Upload size={16} />
              <span className="truncate">
                {pdfFile ? pdfFile.name : (editingId ? (bewerkte?.pdfUrl ? 'PDF vervangen…' : 'PDF kiezen…') : 'PDF kiezen…')}
              </span>
            </label>
          </div>
        </Field>
      </form>
    </DetailPaneel>
  );

  return (
    <PageShell>
      {/* De enige primaire actie staat in de paginakop; ze opent hetzelfde
          paneel als een rij, maar leeg. */}
      <PageHeader
        eyebrow="Communicatie"
        title="Beheer omleidingen"
        description={diversions.length > 0 ? `${activeCount} actief, ${diversions.length - activeCount} verlopen.` : 'Routewijzigingen en bijlagen voor chauffeurs.'}
        actions={(
          <Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>
            Nieuwe omleiding
          </Button>
        )}
      />

      <MasterDetail lijst={lijst} paneel={paneel} />

      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title="Omleiding verwijderen?"
        message="De omleiding verdwijnt voor alle chauffeurs. Dit kan niet ongedaan gemaakt worden."
      />

      <EntityHistoryModal
        open={!!historyDiversion}
        onClose={() => setHistoryDiversion(null)}
        entityType="diversion"
        entityId={historyDiversion?.id ?? ''}
        title={historyDiversion ? `${historyDiversion.title} — lijn ${historyDiversion.line}` : undefined}
      />

    </PageShell>
  );
}
