import React, { useRef, useState } from 'react';
import { Send, Upload, Users, X } from 'lucide-react';
import { getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { Button, MicroLabel } from '../../components/primitives';
import { Modal } from '../../components/Modal';

const MAX_MB = 15;
const ACCEPT = '.pdf,.png,.jpg,.jpeg';

/** Eén document naar álle actieve chauffeurs sturen (planner/admin). */
export function BroadcastDocumentModal({ onClose, onDone }: { onClose: () => void; onDone?: (count: number) => void }) {
  const [category, setCategory] = useState('');
  const [fileName, setFileName] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return notify(`Bestand is te groot (max ${MAX_MB} MB).`, 'error');
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('lezen mislukt'));
        r.readAsDataURL(file);
      });
      setFileName(file.name);
      setDataUrl(url);
    } catch {
      notify('Bestand kon niet gelezen worden.', 'error');
    }
  };

  const send = async () => {
    if (!dataUrl || !fileName) return notify('Kies eerst een bestand.', 'error');
    setSending(true);
    try {
      const res = await fetch('/api/documents/broadcast', {
        method: 'POST',
        headers: { ...(await getSupabaseAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fileName, category: category.trim() || undefined, dataUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'versturen mislukt');
      notify(`Document naar ${body.count} chauffeur(s) verstuurd.`, 'success');
      onDone?.(body.count);
      onClose();
    } catch (err: any) {
      notify(err?.message || 'Rondsturen is mislukt.', 'error');
    } finally {
      setSending(false);
    }
  };

  // Op de gedeelde Modal met `boven` (was een eigen portal op z-[120]) —
  // zo krijgt hij ook ESC, focus-trap en scroll-lock.
  return (
    <Modal open onClose={onClose} maxWidth="md" ariaLabel="Document naar alle chauffeurs" boven>
      <div className="flex flex-col overflow-hidden">
          <div className="p-6 border-b border-white/70 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-oker-50 text-oker-600 flex items-center justify-center"><Users size={20} /></div>
              <div>
                <h3 className="text-lg font-bold tracking-tight text-slate-900">Document naar alle chauffeurs</h3>
                <p className="text-xs font-medium text-slate-500">Elke actieve chauffeur krijgt een eigen kopie + melding.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Sluiten" className="ios-pressable w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 rounded-full border border-slate-200 bg-surface-white text-slate-400 hover:text-slate-700 hover:bg-surface-soft-hover flex items-center justify-center transition-colors"><X size={16} /></button>
          </div>

          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <MicroLabel>Categorie (optioneel)</MicroLabel>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="bv. reglement, mededeling"
                className="control-input w-full px-4 py-2.5 rounded-2xl outline-none text-base sm:text-sm font-medium bg-surface-field"
              />
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} onChange={pickFile} className="hidden" />
            <Button variant="secondary" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>
              {fileName ? `Gekozen: ${fileName}` : `Bestand kiezen (PDF/afbeelding, max ${MAX_MB} MB)`}
            </Button>
            <Button variant="primary" icon={<Send size={16} />} disabled={!dataUrl || sending} onClick={send}>
              {sending ? 'Versturen…' : 'Naar alle chauffeurs versturen'}
            </Button>
          </div>
      </div>
    </Modal>
  );
}
