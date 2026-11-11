import { aantal } from './format';
import { BEZETTING_LABEL, bezettingVanDag, type Bezetting } from './verlofBezetting';

/**
 * De bezetting van één dag in woorden, voor wie verlof aanvraagt (ronde 6,
 * punt 13). Een chauffeur krijgt van de server alleen aantallen, geen namen;
 * die aantallen stonden enkel in title en aria-label van de kalendercel en
 * waren op een telefoon dus niet te lezen.
 *
 * Beide teksten rekenen met dezelfde twee getallen als de stip in de cel
 * (aantal afwezigen, limiet van de dag) en met dezelfde indeling
 * (`bezettingVanDag`), zodat tekst en kleur nooit iets anders zeggen.
 *
 * Bewust een eigen module en niet in verlofBezetting.ts: die zit ook in de
 * verlofkalender van de planner, en daarmee in de staf-warmup.
 */

/** De tekst bij de stip van een dag: aria-label en title van de kalendercel,
 *  en het aria-label van dezelfde dag in het bereikraster van de aanvraag. */
export const bezettingCelTekst = (afwezig: number, limiet: number): string => {
  const bezetting = bezettingVanDag(afwezig, limiet);
  return `${BEZETTING_LABEL[bezetting]}${afwezig > 0 && bezetting !== 'geen' ? `, ${afwezig} van ${limiet} afwezig` : ''}`;
};

/**
 * De stand van een dag als één regel in het dagdetail. `afwezig` is het
 * aantal dat de server voor die dag gaf; ontbreekt het (nog niet geladen, of
 * het laden mislukte), dan is er geen stand: nooit "vrij" raden.
 */
export const verlofDagStand = (afwezig: number | null | undefined, limiet: number): { bezetting: Bezetting; tekst: string } | null => {
  if (afwezig == null || !Number.isFinite(afwezig)) return null;
  const bezetting = bezettingVanDag(afwezig, limiet);
  const telling = `${afwezig} van ${limiet} afwezig`;
  const tekst = bezetting === 'geen'
    ? 'Geen verlof mogelijk op deze dag'
    : bezetting === 'vrij'
      ? 'Vrij, niemand afwezig'
      : bezetting === 'volzet'
        ? `Volzet, ${telling}`
        : `Nog ${aantal(limiet - afwezig, 'plaats', 'plaatsen')}, ${telling}`;
  return { bezetting, tekst };
};
