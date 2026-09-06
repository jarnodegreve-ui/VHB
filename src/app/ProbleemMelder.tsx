import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { CardHeader } from '../components/Card';
import { Field, Textarea } from '../components/Field';
import { Button } from '../components/primitives';
import { reportUserFeedback } from '../lib/monitoring';
import type { View } from '../types';

/**
 * "Meld een probleem" (testfase): vrije tekst + scherm-context → client_errors
 * met bron 'gebruikersmelding', zichtbaar in Systeemstatus en het dagoverzicht.
 * Eigen state; App weet alleen of hij open is.
 */
export function ProbleemMelder({ open, onClose, view }: { open: boolean; onClose: () => void; view: View }) {
  const [tekst, setTekst] = useState('');
  const [verstuurd, setVerstuurd] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState(false);
  useEffect(() => {
    if (open) { setTekst(''); setVerstuurd(false); setFout(false); }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" ariaLabel="Meld een probleem">
      <div className="p-6">
        {verstuurd ? (
          <div className="text-center py-4">
            <p className="text-sm font-bold text-slate-800">Bedankt, jouw melding is verstuurd!</p>
            <p className="mt-1.5 text-xs text-slate-500">De planning ziet hem in het systeemoverzicht.</p>
            <Button variant="primary" className="mt-5" onClick={onClose}>Sluiten</Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = tekst.trim();
              if (!t || bezig) return;
              // Pas "verstuurd" tonen als de server de melding écht heeft.
              setBezig(true);
              setFout(false);
              void reportUserFeedback(t, { view }).then((ok) => {
                setBezig(false);
                if (ok) setVerstuurd(true); else setFout(true);
              });
            }}
          >
            <CardHeader title="Meld een probleem" description="Beschrijf kort wat er misging of niet klopte. Het scherm waar je nu bent sturen we automatisch mee." />
            <Field label="Wat ging er mis?" htmlFor="probleem-tekst" className="mt-4" error={fout ? 'Versturen lukte niet, controleer je verbinding en probeer opnieuw.' : undefined}>
              {({ id, describedBy, invalid }) => (
                <Textarea id={id} aria-describedby={describedBy} invalid={invalid} value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={900} rows={4} placeholder="Bv. de aftelling bij Chris klopt niet, hij is al klaar…" />
              )}
            </Field>
            <div className="mt-4 flex justify-end gap-2.5">
              <Button variant="ghost" onClick={onClose}>Annuleren</Button>
              <Button type="submit" variant="primary" disabled={!tekst.trim() || bezig}>{bezig ? 'Versturen…' : 'Versturen'}</Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
