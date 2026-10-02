/**
 * Afmelden op een gedeeld toestel (beveiligingsscan 01-10): wat er van een
 * account op het toestel staat, en wanneer het weg moet. Depot-tablet en
 * bureau-pc worden door meerdere mensen gebruikt; wie zich daarna aanmeldt,
 * mag niets van de vorige zien.
 *
 * Drie regels, alle drie hier:
 *  1. **Privé-caches**: alles in Cache Storage behalve de schil van de build.
 *     De service worker bewaart API-antwoorden (profiel, rooster, notities,
 *     meldingen, verlof) op URL, zonder gebruiker in de sleutel
 *     (`vhb-ritbladen`), en de viewer bewaart bijlagen (`vhb-bijlagen-v1`).
 *     De schil (`vhb-portaal-<build>`: index.html, scripts, stijlen, iconen)
 *     bevat niets van een gebruiker en blijft staan: daarmee opent het
 *     inlogscherm na een afmelding ook zonder bereik.
 *  2. **Wie is dit?** Bij elke start vergelijkt de app het Supabase-auth-id
 *     van de sessie met het laatst bewaarde. Verschilt het (of is er geen),
 *     dan gaan de privé-caches eerst weg en telt een profiel uit de cache
 *     niet. Het id in het profiel zelf is geen bewijs: dat profiel kan net
 *     het antwoord van de vorige gebruiker zijn.
 *  3. **Herladen** na een afmelding kan alleen als de schil er daarna nog is:
 *     met bereik, of uit de cache van de service worker.
 *
 * Buiten Cache Storage staat er niets persoonlijks op het toestel dat een
 * volgende gebruiker te zien krijgt: localStorage bevat voorkeuren en
 * tijdstempels per gebruikers-id, bedrijfsbrede lijsten (filmnummers,
 * ritblad-metadata) en de Supabase-sessie, die `signOut` zelf verwijdert;
 * IndexedDB gebruikt het portaal niet.
 */

/** Voorvoegsel van de build-gestempelde schil-cache (`CACHE_NAME` in public/sw.js). */
export const SCHIL_CACHE_PREFIX = 'vhb-portaal-';

/** Privé = alles wat niet de schil is. Bewust zo en niet met een lijst van
 *  namen: een cache die er later bijkomt, gaat bij twijfel mee weg. */
export const isPriveCache = (naam: string): boolean => !naam.startsWith(SCHIL_CACHE_PREFIX);

/** Bericht aan de service worker: wat nog onderweg is voor de vorige
 *  gebruiker mag niet meer in de privé-cache landen (public/sw.js). */
export const WIS_PRIVE_BERICHT = 'wis-prive';

/**
 * De privé-caches weg: bij afmelden, bij een gebruikerswissel en zodra een
 * toestel geblokkeerd of ingetrokken is. De schil blijft. Best-effort: zonder
 * Cache Storage (privévenster) valt er niets te wissen.
 */
export async function wisPriveCaches(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: WIS_PRIVE_BERICHT });
  } catch {
    // geen (bruikbare) service worker: de pagina wist zelf
  }
  try {
    await Promise.all((await caches.keys()).filter(isPriveCache).map((naam) => caches.delete(naam)));
  } catch {
    // geen Cache Storage (privévenster) of geblokkeerd, geen blocker
  }
}

/** localStorage-sleutel: het auth-id van wie hier het laatst een profiel
 *  van de server kreeg. De privé-caches zijn van die gebruiker. */
export const LAATSTE_AUTH_KEY = 'vhb-last-auth-id';

/** Dezelfde gebruiker als de vorige op dit toestel? Zonder bewaard of zonder
 *  huidig id is het antwoord nee. */
export const isZelfdeGebruiker = (bewaard: string | null | undefined, authId: string | null | undefined): boolean =>
  !!authId && bewaard === authId;

/**
 * Start van een sessie, vóór het profiel wordt opgehaald: is dit dezelfde
 * gebruiker als de vorige op dit toestel? Zo niet, dan eerst de privé-caches
 * weg. Het antwoord bepaalt ook of een profiel uit de cache mag dienen
 * (`magProfiel`).
 */
export async function borgGebruiker(authId: string | undefined): Promise<boolean> {
  let bewaard: string | null = null;
  try {
    bewaard = window.localStorage.getItem(LAATSTE_AUTH_KEY);
  } catch {
    // opslag geblokkeerd: dan is niemand "dezelfde"
  }
  const zelfde = isZelfdeGebruiker(bewaard, authId);
  if (!zelfde) await wisPriveCaches();
  return zelfde;
}

/** Mag dit profiel-antwoord dienen? Een antwoord van de server altijd, een
 *  antwoord uit de cache alleen voor dezelfde gebruiker als de vorige. */
export const magProfiel = (uitCache: boolean, zelfdeGebruiker: boolean): boolean => !uitCache || zelfdeGebruiker;

/** Na een geslaagd profiel: de privé-caches zijn vanaf nu van deze gebruiker. */
export function onthoudGebruiker(authId: string | undefined): void {
  if (!authId) return;
  try {
    window.localStorage.setItem(LAATSTE_AUTH_KEY, authId);
  } catch {
    // opslag geblokkeerd: de volgende start wist dan opnieuw
  }
}

/**
 * Kan de pagina na een afmelding herladen zonder op een foutpagina van de
 * browser te eindigen? Met bereik altijd; zonder bereik alleen als de service
 * worker deze pagina bedient en de schil in zijn cache heeft.
 */
export async function kanHerladen(online: boolean): Promise<boolean> {
  if (online) return true;
  try {
    return !!navigator.serviceWorker?.controller && !!(await caches.match('/'));
  } catch {
    return false;
  }
}
