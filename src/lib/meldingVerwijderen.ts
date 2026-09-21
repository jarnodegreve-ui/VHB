import { ONGEDAAN_DUUR_MS } from '../components/ToastStack';
import { metOngedaan } from './ongedaan';
import { notify } from './ui';

/**
 * Eén melding verwijderen, met de weg terug. Gedeeld door het paneel onder de
 * bel en het scherm /meldingen, zodat beide zich gelijk gedragen.
 *
 * De melding verdwijnt meteen uit de lijst; de DELETE vertrekt pas als de
 * ongedaan-toast verlopen is (zie src/app/data/meldingen.ts). De marge boven
 * op de toastduur vangt op dat de klok pauzeert zolang de muis erop staat.
 */
export const ONGEDAAN_MARGE_MS = 1500;

export function verwijderMeldingMetOngedaan(
  id: string,
  verwijderMelding: (id: string, wachtMs: number) => boolean,
  herstelMelding: (id: string) => void,
): void {
  void metOngedaan({
    boodschap: 'Melding verwijderd.',
    uitvoeren: () => verwijderMelding(id, ONGEDAAN_DUUR_MS + ONGEDAAN_MARGE_MS),
    herstellen: () => { herstelMelding(id); },
    toast: (message, tone, action, opties) => notify(message, tone, { action, opties }),
  });
}
