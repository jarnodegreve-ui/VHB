import { useSyncExternalStore } from 'react';
import { isoDate } from './datum';

/**
 * Eén klok voor de hele app (ronde 6, punt 21c), als module-store zoals
 * useOnline.ts. Vóór 15-11 hield elk scherm dat "nu" of "vandaag" toont een
 * eigen `useState(new Date())` met een interval van 60 s bij (Mijn dag, het
 * dashboard, de cockpit, Vandaag, het Overzicht). Een app die uren in de
 * app-switcher hing, toonde bij het hervatten daardoor tot een minuut de oude
 * tijd, en na middernacht de dag en de dienst van gisteren.
 *
 * - De lezing is altijd actueel: `leesNu` vergelijkt de minuut van
 *   `Date.now()` met die van de bewaarde Date. Andere minuut: een nieuwe Date;
 *   zelfde minuut: hetzelfde object (ook op een bevroren klok, anders hertekent
 *   React eindeloos). Een scherm dat na een uur opnieuw opent, krijgt zo meteen
 *   de minuut van nu, nooit die van het vorige bezoek.
 * - Eén timer, hoeveel schermen er ook luisteren, en hij valt op de minuut:
 *   eerst tot de volgende minuutgrens, dan elke minuut. Zonder luisteraars is
 *   er geen timer en hangt er niets aan document of window.
 * - Terug uit de achtergrond (`visibilitychange` naar zichtbaar, `pageshow`,
 *   `focus`; een hervatte PWA op de iPhone geeft niet altijd alle drie): de
 *   tijd meteen opnieuw lezen en de tik opnieuw uitlijnen. In een verborgen
 *   tabblad tikt er niets.
 * - Luisteraars horen alleen iets als de minuut veranderde.
 *
 * De Date is gedeeld: lees ze, wijzig ze nooit (`setDate` en co. op een kopie).
 */
const MINUUT_MS = 60_000;
/** De volgende tik ligt minstens zo ver weg: op een bevroren klok vlak vóór
 *  een minuutgrens (e2e met een vaste tijd) zou de timer anders rondjes draaien. */
const MIN_TIK_MS = 1000;

const minuutVan = (ms: number): number => Math.floor(ms / MINUUT_MS);

let lezing!: Date;
let lezingMinuut = NaN;
/** De minuut die de luisteraars het laatst hoorden. Los van `lezingMinuut`:
 *  een scherm dat om een andere reden hertekent, schuift de lezing al op, en
 *  dan moet de tik de andere schermen nog altijd verwittigen. */
let gemeldeMinuut = NaN;
const luisteraars = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** "Nu", tot op de minuut actueel; hetzelfde object zolang de minuut dezelfde is. */
export function leesNu(): Date {
  const ms = Date.now();
  const minuut = minuutVan(ms);
  if (minuut !== lezingMinuut) {
    lezing = new Date(ms);
    lezingMinuut = minuut;
  }
  return lezing;
}

/** De dag van nu als lokale 'YYYY-MM-DD'. */
export const leesVandaag = (): string => isoDate(leesNu());

const meld = () => {
  const minuut = minuutVan(Date.now());
  if (minuut === gemeldeMinuut) return;
  gemeldeMinuut = minuut;
  luisteraars.forEach((l) => l());
};

/** De volgende tik: op de minuutgrens, en niet in een verborgen tabblad. */
const plan = () => {
  clearTimeout(timer);
  if (document.visibilityState === 'hidden') return;
  timer = setTimeout(tik, Math.max(MIN_TIK_MS, MINUUT_MS - (Date.now() % MINUUT_MS)));
};

// Eerst plannen, dan melden: een luisteraar die zich in de melding afmeldt
// (de laatste weg = timer weg) laat zo geen timer achter, en een luisteraar
// die gooit houdt de volgende tik niet tegen.
const tik = () => {
  plan();
  meld();
};

const opTerugkeer = () => {
  plan();
  if (document.visibilityState !== 'hidden') meld();
};

const gebeurtenissen = (doe: 'addEventListener' | 'removeEventListener') => {
  document[doe]('visibilitychange', opTerugkeer);
  window[doe]('pageshow', opTerugkeer);
  window[doe]('focus', opTerugkeer);
};

/** Abonneren buiten React (tests). Geeft de afmelder terug. */
export function abonneerNu(l: () => void): () => void {
  luisteraars.add(l);
  if (luisteraars.size === 1) {
    gemeldeMinuut = minuutVan(Date.now());
    gebeurtenissen('addEventListener');
    plan();
  }
  return () => {
    if (!luisteraars.delete(l) || luisteraars.size > 0) return;
    gebeurtenissen('removeEventListener');
    clearTimeout(timer);
  };
}

/** "Nu" als Date, per minuut ververst en meteen juist bij terugkeer naar de app. */
export function useNu(): Date {
  return useSyncExternalStore(abonneerNu, leesNu);
}

/** De dag van vandaag ('YYYY-MM-DD'); hertekent alleen als de dag verandert. */
export function useVandaag(): string {
  return useSyncExternalStore(abonneerNu, leesVandaag);
}
