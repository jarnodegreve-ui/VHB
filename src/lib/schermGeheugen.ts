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
 *    AFGEMELD, niets of geblokkeerde opslag = geen geheugen).
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
};

type Item = { antwoord: unknown; lezing: Lezing };

/** Volgorde van invoegen = van oud naar nieuw (bewaren zet achteraan). */
const geheugen = new Map<string, Item>();
const laatsteNr = new Map<string, number>();
let volgnummer = 0;
let generatie = 0;

const huidigeEigenaar = (): string | null => {
  try {
    const id = window.localStorage.getItem(LAATSTE_AUTH_KEY);
    return id && id !== AFGEMELD ? id : null;
  } catch {
    return null; // opslag geblokkeerd: geen geheugen
  }
};

/** Geen eigen schrijfactie sinds het vertrek (zie de uitleg bovenaan). */
const geenSchrijfactieSinds = (lezing: Lezing): boolean => laatsteEigenSchrijfactie() === lezing.schrijf;

export function begin(sleutel: string): Lezing {
  const nr = ++volgnummer;
  laatsteNr.set(sleutel, nr);
  return { sleutel, om: Date.now(), nr, generatie, eigenaar: huidigeEigenaar(), schrijf: laatsteEigenSchrijfactie() };
}

export function bewaar(lezing: Lezing, antwoord: unknown): void {
  if (laatsteNr.get(lezing.sleutel) !== lezing.nr || lezing.generatie !== generatie) return;
  if (!lezing.eigenaar || lezing.eigenaar !== huidigeEigenaar() || !geenSchrijfactieSinds(lezing)) return;
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
  if (lezing.eigenaar !== huidigeEigenaar() || !geenSchrijfactieSinds(lezing)) return null;
  return { antwoord: item.antwoord as T, om: lezing.om };
}

if (typeof window !== 'undefined') {
  window.addEventListener(WIS_PRIVE_GEBEURTENIS, () => {
    geheugen.clear();
    laatsteNr.clear();
    generatie += 1;
  });
}
