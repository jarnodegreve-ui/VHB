import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, FileText, MapPin, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import type { Diversion } from '../../types';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';

export function ManageDiversionsView({ diversions, onSave }: { diversions: Diversion[], onSave: (d: Diversion[]) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<Diversion>>({
    line: '',
    title: '',
    description: '',
    startDate: new Date().toISOString().split('T')[0],
    severity: 'medium',
    mapCoordinates: ''
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
      severity: 'medium',
      mapCoordinates: ''
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
      severity: div.severity,
      mapCoordinates: div.mapCoordinates || ''
    });
    setPdfFile(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) return;

    const targetId = editingId || Date.now().toString();
    let uploadedPdfUrl: string | null = null;

    if (pdfFile) {
      setIsUploading(true);
      uploadedPdfUrl = await uploadPdf(targetId, pdfFile);
      setIsUploading(false);
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
        severity: formData.severity as any || 'medium',
        pdfUrl: uploadedPdfUrl || undefined,
        mapCoordinates: formData.mapCoordinates || undefined,
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
        title="Beheer Omleidingen"
      />

      <div className="surface-card p-6 md:p-8 rounded-[32px] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-lg font-black text-slate-800 tracking-tight">Nieuwe Omleiding</h4>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Voeg een omleiding toe voor de chauffeurs</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="btn-primary ios-pressable w-full sm:w-auto px-8 py-4 text-xs uppercase tracking-widest flex items-center justify-center gap-3"
        >
          <Plus size={20} /> TOEVOEGEN
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {diversions.map(div => (
          <div key={div.id} className="surface-card surface-card-hover p-6 md:p-8 rounded-[32px] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 group">
            <div className="flex items-start gap-5">
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-500 group-hover:scale-110",
                div.severity === 'high' ? "bg-red-50 text-red-600 border border-red-100" : 
                div.severity === 'medium' ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-blue-50 text-blue-600 border border-blue-100"
              )}>
                <MapPin size={28} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h4 className="font-black text-slate-800 text-lg tracking-tight leading-tight">{div.title}</h4>
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-widest">Lijn {div.line}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                  <Calendar size={12} className="text-oker-400" />
                  {div.startDate} {div.endDate ? `t/m ${div.endDate}` : '(Geen einddatum)'}
                </div>
              </div>
            </div>
            
            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 pt-4 sm:pt-0 border-t sm:border-t-0 border-slate-50">
              <div className="flex items-center gap-2">
                {div.pdfUrl && (
                  <div className="w-10 h-10 flex items-center justify-center text-emerald-500 bg-emerald-50 border border-emerald-100 rounded-xl" title="PDF Beschikbaar">
                    <FileText size={20} />
                  </div>
                )}
                <button 
                  onClick={() => handleOpenEdit(div)}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-oker-600 hover:bg-oker-50 border border-slate-100 rounded-xl transition-all active:scale-90"
                  title="Bewerken"
                >
                  <Pencil size={20} />
                </button>
              </div>
              <button 
                onClick={() => setConfirmDeleteId(div.id)}
                className="w-10 h-10 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 border border-slate-100 rounded-xl transition-all active:scale-90"
                title="Verwijderen"
              >
                <Trash2 size={20} />
              </button>
            </div>
          </div>
        ))}
        {diversions.length === 0 && (
          <EmptyState
            icon={<MapPin size={28} />}
            title="Geen actieve omleidingen"
            message="Er staan momenteel geen omleidingen in het systeem."
          />
        )}
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[28px] w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
            >
              <div className="p-8 border-b border-white/70 flex items-center justify-between shrink-0">
                <div>
                  <h4 className="text-xl font-black">{editingId ? 'Omleiding Bewerken' : 'Nieuwe Omleiding'}</h4>
                  <p className="text-sm text-slate-500 font-medium">Vul de details in en upload eventueel een PDF.</p>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-5 overflow-y-auto flex-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Lijn(en)</label>
                    <input 
                      type="text" 
                      required
                      value={formData.line}
                      onChange={(e) => setFormData({...formData, line: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                      placeholder="bijv. 1, 2 of Alle"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Ernst</label>
                    <select 
                      value={formData.severity}
                      onChange={(e) => setFormData({...formData, severity: e.target.value as any})}
                      className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm bg-white/60"
                    >
                      <option value="low">Laag (Informatief)</option>
                      <option value="medium">Medium (Vertraging)</option>
                      <option value="high">Hoog (Blokkade)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Titel</label>
                  <input 
                    type="text" 
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                    placeholder="bijv. Wegwerkzaamheden N70"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Omschrijving</label>
                  <textarea 
                    required
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm resize-none"
                    placeholder="Beschrijf de omleiding..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Startdatum</label>
                    <input 
                      type="date" 
                      required
                      value={formData.startDate}
                      onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Einddatum (Optioneel)</label>
                    <input 
                      type="date" 
                      value={formData.endDate || ''}
                      onChange={(e) => setFormData({...formData, endDate: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Kaart Coördinaten (JSON Array)</label>
                  <textarea 
                    rows={2}
                    value={formData.mapCoordinates}
                    onChange={(e) => setFormData({...formData, mapCoordinates: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm resize-none"
                    placeholder='[[lat, lng], [lat, lng], ...]'
                  />
                  <p className="text-[9px] text-slate-400 font-medium px-1">Plak hier een JSON array van coördinaten om de route op de kaart te tonen.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">PDF Bestand {editingId && '(Optioneel)'}</label>
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
                      className="w-full px-4 py-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-oker-400 hover:bg-oker-50 transition-all flex flex-col items-center justify-center gap-2 cursor-pointer group"
                    >
                      <Upload className="text-slate-300 group-hover:text-oker-500 transition-colors" size={24} />
                      <span className="text-xs font-bold text-slate-400 group-hover:text-oker-600">
                        {pdfFile ? pdfFile.name : (editingId ? 'Klik om PDF te vervangen' : 'Klik om PDF te selecteren')}
                      </span>
                    </label>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-4 rounded-2xl font-black text-slate-400 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                  >
                    Annuleren
                  </button>
                  <button
                    type="submit"
                    disabled={isUploading}
                    className="btn-primary ios-pressable flex-1 px-4 py-4 uppercase tracking-widest text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUploading ? 'PDF uploaden...' : editingId ? 'Opslaan' : 'Toevoegen'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title="Omleiding Verwijderen"
        message="Weet je zeker dat je deze omleiding wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
      />

    </PageShell>
  );
}


