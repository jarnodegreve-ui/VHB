/**
 * Startmeting (ronde 6, punt 21a): elke gewone warme start meet in ms sinds
 * de navigatie (`performance.now()`, gehele getallen) wanneer de startcode
 * liep (`js`), getSession een sessie gaf (`sessie`), /api/me een bruikbaar
 * profiel gaf (`profiel`), de poort van de eerste laadbeurt dicht ging
 * (`gegevens`) en de inhoud er stond (`beeld`: de eerste animatieframe nadat
 * de h1 van Mijn dag, het chauffeursdashboard of de cockpit in de DOM kwam,
 * via de ref `markeerBeeld`; het skelet telt dus niet).
 *
 * Geen extra verzoek: de meting komt in één localStorage-sleutel en reist mee
 * met de aanwezigheidsping (`POST /api/auth/session`, `action: 'resume'`)
 * van de vólgende start (`vorigeStart`); de server maakt er één regel
 * `[start] …` van (api/_lib/startRegel.ts). Op het toestel staat alleen de
 * laatste meting, zonder id, naam, e-mail, URL of user agent.
 *
 * Alleen een gewone warme start telt. Niets bewaren bij een start via het
 * inlogformulier, het codescherm of het toestel-wachtscherm, een mislukt
 * profiel of een mislukte poort (`startOnderbroken`), een tabblad dat vóór
 * het einde ook maar even verborgen was, het printblad en de landing van een
 * uitnodiging. Dicht is dicht: een herkansing, een tweede laadbeurt of een
 * verversing later in de sessie zet niets meer, en een fase telt alleen na de
 * vorige. Wat hier misgaat sluit de meting, nooit de start.
 *
 * Bewust klein: deze module zit in de startbundel (via useSessie en
 * useAppData). Een timer of luisteraar die na het sluiten nog afgaat, doet
 * niets, want de meting is dan null.
 */
import { RELEASE } from './appVersion';
import { deriveDeviceName } from './device';
import { UITNODIGING_HASH } from '../../shared/uitnodigingHash';

const SLEUTEL = 'vhb-startmeting';
/** Een meting die zo lang blijft liggen, gaat weg zonder mee te reizen. */
const MAX_LEEFTIJD_MS = 7 * 864e5;
/** Zo lang na `gegevens` wacht de meting op `beeld`, daarna zonder. */
const BEELD_WACHT_MS = 10_000;

type Fase = 'js' | 'sessie' | 'profiel' | 'gegevens' | 'beeld';
/** Wat bewaard en meegestuurd wordt: fasen en context uit vaste lijsten. */
export type StartMeting = { [F in Fase]?: number } & {
  rol?: string;
  scherm?: 'dashboard' | 'mijn-dag' | 'ander';
  bron?: 'cache' | 'vers';
  toestel?: 'ios' | 'android' | 'desktop';
  weergave?: 'app' | 'browser';
  release?: string;
};

/** De lopende meting; null = geen (meer): bewaard, onderbroken of nooit begonnen. */
let meting: StartMeting | null = null;

const nu = () => Math.round(performance.now());

/** Deze start telt niet (meer): niets bewaren, ook later niet. */
export const startOnderbroken = (): void => { meting = null; };

// `js`: deze module loopt mee met de startbundel. Een tabblad dat verborgen
// opent (achtergrond), het printblad en een uitnodiging meten niet.
try {
  if (!document.hidden && !/[?&]print-/.test(location.search) && !location.hash.startsWith(UITNODIGING_HASH)) {
    meting = { js: nu() };
    document.addEventListener('visibilitychange', () => { if (document.hidden) meting = null; });
  }
} catch {
  meting = null;
}

/** Eén fase zetten: alleen na `vorige` en alleen de eerste keer. */
const stap = (fase: Fase, vorige: Fase, extra?: Partial<StartMeting>): StartMeting | null => {
  const m = meting;
  if (!m || m[fase] !== undefined || m[vorige] === undefined) return null;
  m[fase] = nu();
  return Object.assign(m, extra);
};

/** De meting op het toestel zetten, met de context; daarna is ze dicht. */
function bewaar(): void {
  const m = meting;
  meting = null;
  if (!m) return;
  try {
    // Toestel en weergave uit dezelfde indeling als de toestelnaam van de
    // whitelist ("iPhone · app", "Android · browser", "Mac · browser").
    const naam = deriveDeviceName();
    m.toestel = /^iP/.test(naam) ? 'ios' : /^Android/.test(naam) ? 'android' : 'desktop';
    m.weergave = /app$/.test(naam) ? 'app' : 'browser';
    if (/^[0-9a-f]{7,12}$/.test(RELEASE)) m.release = RELEASE;
    // De tijd van bewaren: voor de 7 dagen, en twee metingen zijn zo nooit
    // dezelfde tekst (zie `wis` in vorigeStart).
    localStorage.setItem(SLEUTEL, JSON.stringify({ t: Date.now(), m }));
  } catch { /* geen opslag: geen meting */ }
}

/** getSession gaf een sessie (de bootstrap van een warme start). */
export const markeerSessie = (): void => { stap('sessie', 'js'); };

/** /api/me gaf een bruikbaar profiel; de rol is die van deze start. */
export const markeerProfiel = (rol: string): void => { stap('profiel', 'sessie', { rol }); };

/** Einde van de eerste laadbeurt, vlak vóór `isInitialLoad` wegvalt.
 *  `uitCache`: kwam een antwoord van de poort uit de cache; null = de poort
 *  ging niet dicht (dan telt de start niet). Een latere laadbeurt doet niets.
 *  Op Mijn dag en het dashboard wacht de meting op `beeld` (hoogstens 10 s),
 *  elders wordt ze nu bewaard. */
export function markeerGegevens(view: string, uitCache: boolean | null): void {
  if (meting && meting.gegevens !== undefined) return;
  if (uitCache === null) return startOnderbroken();
  const scherm = view === 'dashboard' || view === 'mijn-dag' ? view : 'ander';
  if (!stap('gegevens', 'profiel', { scherm, bron: uitCache ? 'cache' : 'vers' })) return;
  if (scherm === 'ander') bewaar();
  else setTimeout(bewaar, BEELD_WACHT_MS);
}

/** Ref-callback op de h1 van het eerste scherm (`<h1 ref={markeerBeeld}>`):
 *  `beeld` = de eerste animatieframe daarna. Een ref is geen hook, dus mag
 *  ook onder een vroege return. Alleen de eerste aanroep na `gegevens` telt:
 *  haar frame zet `beeld` en bewaart, daarna is de meting dicht en doet een
 *  volgende frame niets. */
export function markeerBeeld(el: Element | null): void {
  if (!el || !meting || meting.gegevens === undefined) return;
  try {
    requestAnimationFrame(() => { if (stap('beeld', 'gegevens')) bewaar(); });
  } catch {
    startOnderbroken();
  }
}

/** De bewaarde meting van een vorige start, voor de aanwezigheidsping.
 *  `wis` na een 2xx: alleen als er nog exact die tekst staat, zodat de
 *  meting van deze start (intussen bewaard) blijft staan; een fout daarin
 *  vangt de `.catch` van de ping. Ouder dan 7 dagen = weg zonder meesturen.
 *  Een onleesbare waarde reist niet mee en wordt door de volgende meting
 *  overschreven; wat er wel meereist, keurt de server nog veld per veld. */
export function vorigeStart(): { start: StartMeting; wis: () => void } | undefined {
  try {
    // Geen sleutel: JSON.parse(null) is null en het uitpakken valt in de catch.
    const tekst = localStorage.getItem(SLEUTEL);
    const { t, m } = JSON.parse(tekst!);
    if (Date.now() - t < MAX_LEEFTIJD_MS && m) {
      return { start: m, wis: () => { if (localStorage.getItem(SLEUTEL) === tekst) localStorage.removeItem(SLEUTEL); } };
    }
    localStorage.removeItem(SLEUTEL);
  } catch { /* geen opslag of onleesbaar: niets mee */ }
}
