import React, { useMemo, useState } from 'react';
import { Calendar, FileText, History, MapPin, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { Diversion } from '../../types';
import { cn, notify } from '../../lib/ui';
import { ConfirmationModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Badge, Button, IconButton } from '../../components/primitives';
import { Card } from '../../components/Card';
import { Field, Input, Textarea } from '../../components/Field';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

/** Verlopen = einddatum vóór vandaag; zonder einddatum blijft een omleiding
 *  actief tot hij verwijderd wordt. */
import { isExpiredDiversion as isExpired } from '../../lib/diversions';
// isoDate = lokale dag. toISOString() is UTC en gaf tussen 00:00 en 02:00
// Belgische zomertijd de dag ervóór: een omleiding die om 00:30 werd
// aangemaakt kreeg standaard gisteren als startdatum. Zelfde reden als de
// expliciete waarschuwing in ScheduleView.
import { isoDate } from '../../lib/availability';

export function ManageDiversionsView({ diversions, onSave }: { diversions: Diversion[], onSave: (d: Diversion[]) => void }) {
  const [showModal, setShowModal] = useState(false);
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
    setShowModal(true);
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
    setShowModal(true);
  };

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
      const updatedDiversions = diversions.map(d =>
        d.id === editingId
          ? {
              ...d,
              ...formData,
              pdfUrl: uploadedPdfUrl || d.pdfUrl,
            } as Diversion
          : d
      );
      onSave(updatedDiversions);
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
      onSave([...diversions, diversionToAdd]);
    }

    setShowModal(false);
  };

  const handleDelete = () => {
    if (confirmDeleteId) {
      onSave(diversions.filter(d => d.id !== confirmDeleteId));
      setConfirmDeleteId(null);
    }
  };

  return (
    <PageShell>
      {/* De enige primaire actie staat in de paginakop; de vroegere
          "Nieuwe omleiding"-kaart met alleen een knop erin is weg. */}
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

      <div className="grid grid-cols-1 gap-4">
        {sortedDiversions.map(div => {
          const expired = isExpired(div);
          return (
          <Card key={div.id} className={cn('flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between', expired && 'opacity-60')}>
            <div className="flex min-w-0 items-start gap-4">
              <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', expired ? 'bg-slate-500/12 text-slate-500' : 'bg-oker-500/15 text-oker-700')}>
                <MapPin size={20} />
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-card-title leading-tight">{div.title}</h3>
                  <Badge tone="slate">Lijn {div.line}</Badge>
                  {expired && <Badge tone="slate">Verlopen</Badge>}
                  {div.pdfUrl && <Badge tone="emerald" icon={<FileText size={12} />}>PDF</Badge>}
                </div>
                <div className="flex items-center gap-2 text-2xs font-medium text-slate-500 tabular-nums">
                  <Calendar size={12} className="text-slate-400" />
                  {div.startDate} {div.endDate ? `t/m ${div.endDate}` : '(geen einddatum)'}
                </div>
              </div>
            </div>

            <div className="flex w-full items-center justify-between gap-3 border-t border-slate-100 pt-4 sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0">
              <div className="flex items-center gap-1">
                <IconButton label="Wijzigingsgeschiedenis" variant="ghost" size="sm" onClick={() => setHistoryDiversion(div)}><History size={18} /></IconButton>
                <IconButton label="Bewerken" variant="ghost" size="sm" onClick={() => handleOpenEdit(div)}><Pencil size={18} /></IconButton>
              </div>
              <IconButton label="Verwijderen" variant="danger" size="sm" onClick={() => setConfirmDeleteId(div.id)}><Trash2 size={18} /></IconButton>
            </div>
          </Card>
          );
        })}
        {diversions.length === 0 && (
          <EmptyState
            icon={<MapPin size={24} />}
            title="Nog geen omleidingen"
            message="Chauffeurs zien een omleiding meteen op hun dashboard en onder Omleidingen."
            action={<Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe omleiding</Button>}
          />
        )}
      </div>

      {/* Gedeelde Modal: ESC, backdrop-tap, safe-area en dvh (verbeterronde 29/07 #3). */}
      <Modal open={showModal} onClose={() => setShowModal(false)} maxWidth="lg" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
              <ModalHeader
                title={editingId ? 'Omleiding bewerken' : 'Nieuwe omleiding'}
                description="Vul de details in en voeg eventueel een PDF toe."
                onClose={() => setShowModal(false)}
              />
              <form onSubmit={handleSubmit} className="p-6 md:p-7 space-y-5 overflow-y-auto flex-1">
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
                    <Input
                      id="omleiding-start"
                      type="date"
                      required
                      value={formData.startDate}
                      onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                    />
                  </Field>
                  <Field label="Einddatum" hint="Leeg = tot hij verwijderd wordt." htmlFor="omleiding-eind">
                    <Input
                      id="omleiding-eind"
                      type="date"
                      value={formData.endDate || ''}
                      onChange={(e) => setFormData({...formData, endDate: e.target.value})}
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
                        {pdfFile ? pdfFile.name : (editingId ? 'PDF vervangen…' : 'PDF kiezen…')}
                      </span>
                    </label>
                  </div>
                </Field>

                <div className="pt-4 flex gap-3">
                  <Button variant="secondary" size="lg" className="flex-1" onClick={() => setShowModal(false)}>
                    Annuleren
                  </Button>
                  <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={isUploading}>
                    {isUploading ? 'PDF uploaden…' : editingId ? 'Opslaan' : 'Toevoegen'}
                  </Button>
                </div>
              </form>
      </Modal>

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
