import { useCallback, useState } from 'react';
import { useOptioneleAppData } from './AppDataContext';
import { COLLECTIE_ONBEKEND, type CollectieStaat } from './data/kern';
import type { Uitgesteld } from './data/poort';

const GELADEN: CollectieStaat = { geslaagd: true, mislukt: false };

/** De boodschap van de Foutkaart per collectie (hier, niet in de startbundel). */
const BOODSCHAP: Record<Uitgesteld, string> = {
  services: 'Het dienstoverzicht kon niet laden.',
  planningCodes: 'De planningscodes konden niet laden.',
  planningMatrix: 'De planningsmatrix kon niet laden.',
  activityLog: 'Het activiteitenlog kon niet laden.',
  users: 'De gebruikerslijst kon niet laden.',
  swaps: 'De dienstruilen konden niet laden.',
  documenten: 'De documenten konden niet laden.',
};

/**
 * Hét patroon voor een scherm dat op een collectie uit de datalaag draait
 * (release-safety, 24-09). Vroeger wist een view alleen "geladen" (= de
 * eerste poging is voorbij) en toonde een mislukte laad zich als lege
 * staat: "Nog geen diensten" met een knop Nieuwe dienst, of een lege
 * codelijst met een actieve Opslaan. Dat nodigt uit tot dubbele records of
 * tot het opslaan van niets.
 *
 * - `foutZonderData`: de laad is mislukt en is nog nooit gelukt. Toon dan
 *   een Foutkaart met `opnieuw`, geen lege staat, geen create-acties.
 * - `geslaagd`: er is minstens één keer met succes geladen; opslaan mag.
 *   (De datalaag bewaakt dat zelf ook nog met `guardCollectionLoaded`.)
 * - `mislukt` mét `geslaagd`: een latere verversing mislukte; de gegevens zijn
 *   er nog, toon hooguit een compacte Foutkaart erboven.
 */
export function useCollectieStaat(sleutel: Uitgesteld): CollectieStaat & {
  /** De boodschap voor de Foutkaart, alleen als de laatste laad mislukte. */
  fout: string | null;
  foutZonderData: boolean;
  bezig: boolean;
  opnieuw: () => Promise<void>;
} {
  // Buiten de app-schil (unit-tests, losse voorbeelden) is er geen datalaag:
  // dan telt de collectie als geladen, zoals vóór dit patroon.
  const app = useOptioneleAppData();
  const staat = app ? (app.collectieStaat[sleutel] ?? COLLECTIE_ONBEKEND) : GELADEN;
  const herlaad = app?.herlaadCollectie;
  const [bezig, setBezig] = useState(false);
  const opnieuw = useCallback(async () => {
    if (!herlaad) return;
    setBezig(true);
    try { await herlaad(sleutel); } finally { setBezig(false); }
  }, [herlaad, sleutel]);
  return { ...staat, fout: staat.mislukt ? BOODSCHAP[sleutel] : null, foutZonderData: staat.mislukt && !staat.geslaagd, bezig, opnieuw };
}
