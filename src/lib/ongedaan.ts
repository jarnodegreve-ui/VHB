import type { Toast, ToastOpties } from '../components/ToastStack';

/** Toast-functie zoals App.showToast / notify die ook een actie en opties aankan. */
export type OngedaanToast = (
  message: string,
  tone?: Toast['tone'],
  action?: Toast['action'],
  opties?: ToastOpties,
) => void;

export const ONGEDAAN_LABEL = 'Ongedaan maken';
export const ONGEDAAN_FOUT = 'Ongedaan maken is mislukt.';

/** Resultaat van een stap: `false` = mislukt; `void`/`true` = gelukt. */
type Stap = () => boolean | void | Promise<boolean | void>;

/**
 * Meteen doen, met een weg terug (Gmail/Linear-gevoel): voert `uitvoeren`
 * uit en toont bij succes een ongedaan-toast met de knop "Ongedaan maken".
 * Klik = `herstellen`. Geeft terug of `uitvoeren` slaagde.
 *
 * Foutafhandeling van het herstel: gooit `herstellen` of geeft het `false`
 * terug, dan komt er een fout-toast (`herstelFout`). Meldt het herstel zijn
 * fouten zelf al (bv. via perRecord in de datalaag), geef dan `void` terug —
 * dan blijft het bij die ene melding.
 */
export async function metOngedaan({
  boodschap,
  uitvoeren,
  herstellen,
  toast,
  tone = 'success',
  herstelFout = ONGEDAAN_FOUT,
}: {
  boodschap: string;
  uitvoeren: Stap;
  herstellen: Stap;
  toast: OngedaanToast;
  tone?: Toast['tone'];
  herstelFout?: string;
}): Promise<boolean> {
  const gelukt = await uitvoeren();
  if (gelukt === false) return false;

  const herstel = async () => {
    try {
      const hersteld = await herstellen();
      if (hersteld === false) toast(herstelFout, 'error');
    } catch (error) {
      console.error('Ongedaan maken is mislukt:', error);
      toast(herstelFout, 'error');
    }
  };

  toast(boodschap, tone, { label: ONGEDAAN_LABEL, run: () => { void herstel(); } }, { ongedaan: true });
  return true;
}
