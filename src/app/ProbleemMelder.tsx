import { useEffect, useState } from 'react';
import { Modal, SluitKnop } from '../components/Modal';
import { Formulier } from '../components/Formulier';
import { CardHeader } from '../components/Card';
import { Field, Textarea } from '../components/Field';
import { Button } from '../components/primitives';
import { reportUserFeedback } from '../lib/monitoring';
import type { View } from '../types';
import { useFoutReferentie } from './FoutReferentie';

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
  // Laatste foutreferentie (zie FoutReferentie.tsx): gaat automatisch mee in
  // het bericht, dan hangt de melding meteen aan de juiste foutgroep.
  const referentie = useFoutReferentie();
  useEffect(() => {
    if (open) { setTekst(''); setVerstuurd(false); setFout(false); }
  }, [open]);
  // De tekst begint bij elk openen leeg, dus elke ingetypte tekst is onbewaard.
  const vuil = open && !verstuurd && tekst.trim() !== '';

  return (
    <Modal open={open} onClose={onClose} vuil={vuil} maxWidth="sm" ariaLabel="Meld een probleem">
      <div className="p-6">
        {verstuurd ? (
          <div className="text-center py-4">
            <p className="text-sm font-bold text-slate-800">Bedankt, jouw melding is verstuurd!</p>
            <p className="mt-1.5 text-xs text-slate-500">De planning ziet hem in het systeemoverzicht.</p>
            <Button variant="primary" className="mt-5" onClick={onClose}>Sluiten</Button>
          </div>
        ) : (
          <Formulier
            onVerstuur={async () => {
              const t = tekst.trim();
              if (!t || bezig) return;
              // Pas "verstuurd" tonen als de server de melding écht heeft.
              setBezig(true);
              setFout(false);
              const ok = await reportUserFeedback(referentie ? `${t} (referentie ${referentie})` : t, { view });
              setBezig(false);
              if (ok) setVerstuurd(true); else setFout(true);
            }}
          >
            <CardHeader title="Meld een probleem" description="Beschrijf kort wat er misging of niet klopte. Het scherm waar je nu bent sturen we automatisch mee." />
            <Field label="Wat ging er mis?" htmlFor="probleem-tekst" className="mt-4" error={fout ? 'Versturen lukte niet, controleer je verbinding en probeer opnieuw.' : undefined}>
              <Textarea id="probleem-tekst" value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={900} rows={4} placeholder="Bv. de aftelling bij Chris klopt niet, hij is al klaar…" />
            </Field>
            <div className="mt-4 flex justify-end gap-2.5">
              <SluitKnop onClose={onClose} variant="ghost" disabled={bezig}>Annuleren</SluitKnop>
              <Button type="submit" variant="primary" bezig={bezig} disabled={!tekst.trim()}>Versturen</Button>
            </div>
          </Formulier>
        )}
      </div>
    </Modal>
  );
}
