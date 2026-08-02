import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileText, Trash2, Upload, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from '../../types';
import { getSupabaseAuthHeaders, notify, openPdfInNewTab } from '../../lib/ui';
import { Button, MicroLabel } from '../../components/primitives';
import { formatDateHuman } from '../../lib/format';
import type { UserDocument } from '../DocumentsView';

const MAX_MB = 15;
const ACCEPT = '.pdf,.png,.jpg,.jpeg';

const prettySize = (bytes: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Documenten van één gebruiker beheren (planner/admin): lijst, upload, verwijderen. */
export function UserDocumentsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/documents?userId=${encodeURIComponent(user.id)}`, { headers: await getSupabaseAuthHeaders() });
      if (!res.ok) throw new Error();
      setDocs(await res.json());
    } catch {
      notify('Documenten laden is mislukt.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user.id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return notify(`Bestand is te groot (max ${MAX_MB} MB).`, 'error');
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('lezen mislukt'));
        r.readAsDataURL(file);
      });
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { ...(await getSupabaseAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, filename: file.name, category: category.trim() || undefined, dataUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'upload mislukt');
      notify('Document toegevoegd.', 'success');
      setCategory('');
      await load();
    } catch (err: any) {
      notify(err?.message || 'Uploaden is mislukt.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: UserDocument) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE', headers: await getSupabaseAuthHeaders() });
      if (!res.ok) throw new Error();
      setDocs((cur) => cur.filter((d) => d.id !== doc.id));
    } catch {
      notify('Verwijderen is mislukt.', 'error');
    }
  };

  return createPortal(
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="glass-modal rounded-3xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden"
        >
          <div className="p-6 border-b border-white/70 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-oker-50 text-oker-600 flex items-center justify-center shrink-0"><FileText size={20} /></div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold tracking-tight text-slate-900 truncate">Documenten — {user.name}</h3>
                <MicroLabel className="mt-0.5">Alleen {user.name.split(' ')[0]} ziet deze bestanden.</MicroLabel>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Sluiten" className="ios-pressable shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50 flex items-center justify-center transition-colors"><X size={16} /></button>
          </div>

          <div className="p-6 border-b border-white/70 shrink-0 space-y-3">
            <div className="space-y-1.5">
              <MicroLabel>Categorie (optioneel)</MicroLabel>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="bv. attest, loonbrief, reglement"
                className="control-input w-full px-4 py-2.5 rounded-2xl outline-none text-base sm:text-sm font-medium bg-white/60"
              />
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} onChange={handleUpload} className="hidden" />
            <Button variant="primary" icon={<Upload size={16} />} disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploaden…' : `Document toevoegen (PDF/afbeelding, max ${MAX_MB} MB)`}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <p className="p-4 text-sm font-medium text-slate-500">Laden…</p>
            ) : docs.length === 0 ? (
              <p className="p-4 text-sm font-medium text-slate-400">Nog geen documenten voor deze gebruiker.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 px-2 py-3">
                    <FileText size={18} className="text-slate-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 text-sm truncate">{doc.filename}{doc.category ? ` · ${doc.category}` : ''}</p>
                      <MicroLabel className="mt-0.5">{formatDateHuman(doc.uploadedAt)}{doc.sizeBytes != null ? ` · ${prettySize(doc.sizeBytes)}` : ''}</MicroLabel>
                      {/* Leesbevestiging: gezet zodra de chauffeur het document
                          voor het eerst opent. */}
                      {doc.openedAt ? (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                          <CheckCircle2 size={11} /> Geopend {formatDateHuman(doc.openedAt)}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] font-medium text-slate-400">Nog niet geopend</p>
                      )}
                    </div>
                    <button type="button" onClick={() => doc.url && openPdfInNewTab(doc.url)} aria-label="Openen" className="ios-pressable shrink-0 w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center transition-colors"><Download size={15} /></button>
                    <button type="button" onClick={() => void handleDelete(doc)} aria-label="Verwijderen" className="ios-pressable shrink-0 w-9 h-9 rounded-xl border border-slate-200 bg-white text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center justify-center transition-colors"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
