import { AFGEMELD, LAATSTE_AUTH_KEY, WIS_PRIVE_GEBEURTENIS } from './afmelden';
import { laatsteEigenSchrijfactie } from './liveSignaal';

/**
 * Het geheugen van een scherm (ronde 6, punt 22): per sleutel het laatste
 * antwoord, hoogstens vijf minuten, alleen in het geheugen van de pagina
 * (nooit localStorage of Cache Storage). Wie terugkeert naar het scherm ziet
 * het meteen, met de tijd van die lezing in de regel, terwijl het scherm
 * ververst (`onthoudenOm` van useZelfLadend).
 *
 *   const lezing = begin(sleutel);  // vlak vóór het verzoek
 *   …
 *   bewaar(lezing, antwoord);       // erna
 *   lees(sleutel);                  // bij de mount: { antwoord, om } of null
 *
 * Een lezing telt alleen als:
 *  - ze jonger is dan MAX_LEEFTIJD_MS, gerekend vanaf haar vertrek;
 *  - er sinds haar vertrek geen eigen schrijfactie was (apiFetch markeert elke
 *    niet-stille schrijfactie bij vertrek en antwoord, src/lib/liveSignaal.ts).
 *    Een markering op dezelfde milliseconde als het vertrek telt alleen mee
 *    als ze er bij het vertrek al stond: de verversing die na een eigen opslag
 *    vertrekt, is geldig, een schrijfactie die erna kwam maakt haar ongeldig;
 *  - ze van dezelfde gebruiker is (LAATSTE_AUTH_KEY, bij bewaren én lezen;
 *    AFGEMELD, niets of geblokkeerde opslag = geen geheugen);
 *  - met `begin(sleutel, { planning: true })` (de Maandplanning): er sinds
 *    haar vertrek geen planningswijziging was. Die meldt App met
 *    'vhb-planning-changed' (src/app/useLiveUpdates.ts: een realtime-event,
 *    een lichte ronde met een gewijzigde versie, en elke volledige
 *    inhaalronde). Op volgorde zoals bij een eigen schrijfactie, met een
 *    volgnummer en niet op de klok: een wijziging vóór het vertrek telt niet,
 *    een wijziging erna (ook op dezelfde milliseconde) maakt de lezing
 *    ongeldig, ook een die nog onderweg is. Andere sleutels (Vervaldata)
 *    hangen niet aan de planning.
 * `bewaar` doet niets als er intussen een nieuwere `begin` voor dezelfde
 * sleutel was, of als het geheugen intussen gewist werd. Dat wissen gebeurt
 * bij elke wis van de privé-caches (afmelden, ook zonder herlaad, een andere
 * gebruiker, een geblokkeerd toestel): `wisPriveCaches` stuurt daarvoor
 * WIS_PRIVE_GEBEURTENIS.
 *
 * Alleen de schermen die het gebruiken importeren dit bestand: het hoort niet
 * in de startbundel.
 */
export const MAX_LEEFTIJD_MS = 5 * 60_000;
export const MAX_SLEUTELS = 10;

/** Wat `begin` teruggeeft en `bewaar` terugkrijgt. */
export type Lezing = {
  readonly sleutel: string;
  /** Vertrek van het verzoek (epoch-ms). */
  readonly om: number;
  readonly nr: number;
  readonly generatie: number;
  readonly eigenaar: string | null;
  /** De laatste eigen schrijfactie op het moment van vertrek. */
  readonly schrijf: number;
  /** Het aantal planningswijzigingen op het moment van vertrek; null = deze
   *  lezing hangt niet aan de planning. */
  readonly planning: number | null;
};

/** De gebeurtenis bij elke planningswijziging (src/app/useLiveUpdates.ts). */
const PLANNING_GEWIJZIGD = 'vhb-planning-changed';

type Item = { antwoord: unknown; lezing: Lezing };

/** Volgorde van invoegen = van oud naar nieuw (bewaren zet achteraan). */
const geheugen = new Map<string, Item>();
const laatsteNr = new Map<string, number>();
let volgnummer = 0;
let generatie = 0;
/** Planningswijzigingen sinds deze module laadde (de luisteraar onderaan). */
let planningWijzigingen = 0;

const huidigeEigenaar = (): string | null => {
  try {
    const id = window.localStorage.getItem(LAATSTE_AUTH_KEY);
    return id && id !== AFGEMELD ? id : null;
  } catch {
    return null; // opslag geblokkeerd: geen geheugen
  }
};

/** Geen eigen schrijfactie sinds het vertrek, en voor een lezing die aan de
 *  planning hangt ook geen planningswijziging (zie de uitleg bovenaan). */
const nietsGewijzigdSinds = (lezing: Lezing): boolean =>
  laatsteEigenSchrijfactie() === lezing.schrijf && (lezing.planning === null || lezing.planning === planningWijzigingen);

export function begin(sleutel: string, opties: { planning?: boolean } = {}): Lezing {
  const nr = ++volgnummer;
  laatsteNr.set(sleutel, nr);
  return {
    sleutel, om: Date.now(), nr, generatie, eigenaar: huidigeEigenaar(), schrijf: laatsteEigenSchrijfactie(),
    planning: opties.planning ? planningWijzigingen : null,
  };
}

export function bewaar(lezing: Lezing, antwoord: unknown): void {
  if (laatsteNr.get(lezing.sleutel) !== lezing.nr || lezing.generatie !== generatie) return;
  if (!lezing.eigenaar || lezing.eigenaar !== huidigeEigenaar() || !nietsGewijzigdSinds(lezing)) return;
  geheugen.delete(lezing.sleutel);
  geheugen.set(lezing.sleutel, { antwoord, lezing });
  for (const sleutel of geheugen.keys()) {
    if (geheugen.size <= MAX_SLEUTELS) break;
    geheugen.delete(sleutel);
  }
}

/** Puur (geen wisbeurt): StrictMode roept een initializer twee keer aan. */
export function lees<T>(sleutel: string): { antwoord: T; om: number } | null {
  const item = geheugen.get(sleutel);
  if (!item) return null;
  const { lezing } = item;
  if (Date.now() - lezing.om >= MAX_LEEFTIJD_MS) return null;
  if (lezing.eigenaar !== huidigeEigenaar() || !nietsGewijzigdSinds(lezing)) return null;
  return { antwoord: item.antwoord as T, om: lezing.om };
}

if (typeof window !== 'undefined') {
  window.addEventListener(WIS_PRIVE_GEBEURTENIS, () => {
    geheugen.clear();
    laatsteNr.clear();
    generatie += 1;
  });
  // Op moduleniveau: telt ook terwijl geen enkel scherm dat dit gebruikt
  // open staat. Een wijziging van vóór het laden van deze module raakt niets,
  // want er bestond toen nog geen lezing.
  window.addEventListener(PLANNING_GEWIJZIGD, () => { planningWijzigingen += 1; });
}
