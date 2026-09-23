import React, { useRef, useState } from 'react';
import { Send, Upload, Users } from 'lucide-react';
import { notify } from '../../lib/ui';
import { Button } from '../../components/primitives';
import { Modal, SluitKnop } from '../../components/Modal';
import { ModalHeader } from '../../components/ui';
import { Field, Input } from '../../components/Field';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { apiFetch } from '../../lib/api';

const MAX_MB = 15;
const ACCEPT = '.pdf,.png,.jpg,.jpeg';

/** Eén document naar álle actieve chauffeurs sturen (planner/admin). */
export function BroadcastDocumentModal({ onClose, onDone }: { onClose: () => void; onDone?: (count: number) => void }) {
  const [category, setCategory] = useState('');
  const [fileName, setFileName] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Tranche 3A: bestandsfouten bij het veld, niet als toast; met een
  // categorie of een gekozen bestand vraagt sluiten eerst bevestiging.
  const fouten = useVeldfouten();
  const vuil = category.trim() !== '' || fileName !== '';

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return fouten.zet({ bestand: `Bestand is te groot (max ${MAX_MB} MB).` });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('lezen mislukt'));
        r.readAsDataURL(file);
      });
      setFileName(file.name);
      setDataUrl(url);
      fouten.wisVeld('bestand');
    } catch {
      fouten.zet({ bestand: 'Bestand kon niet gelezen worden.' });
    }
  };

  const send = async () => {
    if (sending) return;
    if (!dataUrl || !fileName) return fouten.zet({ bestand: 'Kies eerst een bestand.' });
    setSending(true);
    try {
      const res = await apiFetch('/api/documents/broadcast', {
        method: 'POST',
        body: JSON.stringify({ filename: fileName, category: category.trim() || undefined, dataUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Aanmaken (POST): geen "Opnieuw proberen", de knop staat er nog.
        meldSchrijffout('Uploaden', { status: res.status, message: body?.error });
        return;
      }
      notify(`Document naar ${body.count} chauffeur(s) verstuurd.`, 'success');
      onDone?.(body.count);
      onClose();
    } catch (err) {
      meldSchrijffout('Uploaden', err);
    } finally {
      setSending(false);
    }
  };

  // Op de gedeelde Modal met `boven` (was een eigen portal op z-[120]) —
  // zo krijgt hij ook ESC, focus-trap en scroll-lock.
  return (
    <Modal open onClose={onClose} vuil={vuil} maxWidth="md" ariaLabel="Document naar alle chauffeurs" boven>
      <div className="flex flex-col overflow-hidden">
          <ModalHeader
            leading={<div className="w-10 h-10 rounded-2xl bg-surface-muted text-slate-700 flex items-center justify-center"><Users size={20} /></div>}
            title="Document naar alle chauffeurs"
            description="Elke actieve chauffeur krijgt een eigen kopie + melding."
            onClose={onClose}
          />

          <Formulier onVerstuur={send} className="p-6 md:p-7 space-y-4">
            <Field label="Categorie (optioneel)">
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="bv. reglement, mededeling"
              />
            </Field>
            <Field label="Bestand" error={fouten.fouten.bestand}>
              {({ id, describedBy, invalid }) => (
                <>
                  {/* De knop vóór het verborgen file-input: focusEersteFout
                      neemt het eerste control in het veld, en dat moet de
                      zichtbare knop zijn. */}
                  <Button id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} variant="secondary" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>
                    {fileName ? `Gekozen: ${fileName}` : `Bestand kiezen (PDF/afbeelding, max ${MAX_MB} MB)`}
                  </Button>
                  <input ref={fileRef} type="file" accept={ACCEPT} onChange={pickFile} className="hidden" tabIndex={-1} aria-hidden="true" />
                </>
              )}
            </Field>
            <div className="flex gap-3 pt-1">
              <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={sending}>Annuleren</SluitKnop>
              <Button type="submit" variant="primary" className="flex-1" icon={<Send size={16} />} bezig={sending}>
                Naar alle chauffeurs versturen
              </Button>
            </div>
          </Formulier>
      </div>
    </Modal>
  );
}
