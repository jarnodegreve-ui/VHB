import React, { useState } from 'react';
import { Calendar, FileText, History, MapPin, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import type { Diversion } from '../../types';
import { getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { Badge, Button, MicroLabel } from '../../components/primitives';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

export function ManageDiversionsView({ diversions, onSave }: { diversions: Diversion[], onSave: (d: Diversion[]) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [historyDiversion, setHistoryDiversion] = useState<Diversion | null>(null);

  const [formData, setFormData] = useState<Partial<Diversion>>({
    line: '',
    title: '',
    description: '',
    startDate: new Date().toISOString().split('T')[0],
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
    const response = await fetch('/api/diversions/pdf', {
      method: 'POST',
      headers: await getSupabaseAuthHeaders(),
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
      startDate: new Date().toISOString().split('T')[0],
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
        // catch bleef de knop eeuwig op 'PDF uploaden...' hangen.
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
      <PageHeader
        eyebrow="Beheer"
        title="Beheer omleidingen"
      />

      <div className="surface-card p-5 md:p-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-lg font-bold text-slate-800 tracking-tight">Nieuwe omleiding</h4>
          <p className="text-xs text-slate-500 font-medium mt-1">Voeg een omleiding toe voor de chauffeurs.</p>
        </div>
        <Button variant="primary" size="lg" icon={<Plus size={16} />} className="w-full sm:w-auto" onClick={handleOpenAdd}>
          Toevoegen
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {diversions.map(div => {
          return (
          <div key={div.id} className="surface-card surface-card-hover p-5 md:p-6 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 group">
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-2xl border border-oker-100 bg-oker-50 text-oker-600 flex items-center justify-center shrink-0 transition-transform duration-500 group-hover:scale-110">
                <MapPin size={28} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h4 className="font-bold text-slate-800 text-lg tracking-tight leading-tight">{div.title}</h4>
                  <Badge tone="slate">Lijn {div.line}</Badge>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium tabular-nums">
                  <Calendar size={12} className="text-oker-400" />
                  {div.startDate} {div.endDate ? `t/m ${div.endDate}` : '(Geen einddatum)'}
                </div>
              </div>
            </div>

            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 pt-4 sm:pt-0 border-t sm:border-t-0 border-slate-50">
              <div className="flex items-center gap-2">
                {div.pdfUrl && (
                  <div className="w-9 h-9 flex items-center justify-center text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl" title="PDF beschikbaar">
                    <FileText size={18} />
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<History size={18} />}
                  aria-label="Wijzigingsgeschiedenis"
                  title="Wijzigingsgeschiedenis"
                  onClick={() => setHistoryDiversion(div)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Pencil size={18} />}
                  aria-label="Bewerken"
                  title="Bewerken"
                  onClick={() => handleOpenEdit(div)}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={18} />}
                className="text-red-700 hover:text-red-700 hover:bg-red-50"
                aria-label="Verwijderen"
                title="Verwijderen"
                onClick={() => setConfirmDeleteId(div.id)}
              />
            </div>
          </div>
          );
        })}
        {diversions.length === 0 && (
          <EmptyState mascotte={false}
            icon={<MapPin size={28} />}
            title="Geen actieve omleidingen"
            message="Er staan momenteel geen omleidingen in het systeem."
          />
        )}
      </div>

      {/* Gedeelde Modal: ESC, backdrop-tap, safe-area en dvh (verbeterronde 29/07 #3). */}
      <Modal open={showModal} onClose={() => setShowModal(false)} maxWidth="lg" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
              <div className="p-6 border-b border-white/70 flex items-center justify-between shrink-0">
                <div>
                  <h4 className="text-xl font-bold tracking-tight">{editingId ? 'Omleiding bewerken' : 'Nieuwe omleiding'}</h4>
                  <p className="text-sm text-slate-500 font-medium">Vul de details in en upload eventueel een PDF.</p>
                </div>
                <Button variant="ghost" size="sm" icon={<X size={20} />} aria-label="Sluiten" onClick={() => setShowModal(false)} />
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
                <div className="space-y-2">
                  <MicroLabel className="ml-1">Lijn(en)</MicroLabel>
                  <input
                    type="text"
                    required
                    aria-label="Lijn(en)"
                    value={formData.line}
                    onChange={(e) => setFormData({...formData, line: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-base md:text-sm"
                    placeholder="bijv. 1, 2 of Alle"
                  />
                </div>

                <div className="space-y-2">
                  <MicroLabel className="ml-1">Titel</MicroLabel>
                  <input 
                    type="text" 
                    required
                    aria-label="Titel"
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-base md:text-sm"
                    placeholder="bijv. Wegwerkzaamheden N70"
                  />
                </div>

                <div className="space-y-2">
                  <MicroLabel className="ml-1">Omschrijving</MicroLabel>
                  <textarea 
                    required
                    rows={3}
                    aria-label="Omschrijving"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-base md:text-sm resize-none"
                    placeholder="Beschrijf de omleiding..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <MicroLabel className="ml-1">Startdatum</MicroLabel>
                    <input 
                      type="date" 
                      required
                      aria-label="Startdatum"
                      value={formData.startDate}
                      onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-base md:text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <MicroLabel className="ml-1">Einddatum (Optioneel)</MicroLabel>
                    <input 
                      type="date" 
                      aria-label="Einddatum"
                      value={formData.endDate || ''}
                      onChange={(e) => setFormData({...formData, endDate: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-base md:text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <MicroLabel className="ml-1">PDF Bestand {editingId && '(Optioneel)'}</MicroLabel>
                  <div className="relative">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="pdf-upload"
                    />
                    <label
                      htmlFor="pdf-upload"
                      className="ios-pressable control-button-soft inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition-all hover:text-slate-900"
                    >
                      <Upload size={16} />
                      <span className="truncate">
                        {pdfFile ? pdfFile.name : (editingId ? 'Klik om PDF te vervangen' : 'Klik om PDF te selecteren')}
                      </span>
                    </label>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <Button variant="secondary" size="lg" className="flex-1" onClick={() => setShowModal(false)}>
                    Annuleren
                  </Button>
                  <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={isUploading}>
                    {isUploading ? 'PDF uploaden...' : editingId ? 'Opslaan' : 'Toevoegen'}
                  </Button>
                </div>
              </form>
      </Modal>

      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title="Omleiding verwijderen"
        message="Weet je zeker dat je deze omleiding wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
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


