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
 *     van de sessie met het laatst bewaarde. Verschilt het, dan gaan de
 *     privé-caches eerst weg en telt een profiel uit de cache niet. Het id in
 *     het profiel zelf is geen bewijs: dat profiel kan net het antwoord van
 *     de vorige gebruiker zijn. Het id wordt bewaard na een profiel van de
 *     server; een afmelding zet er `AFGEMELD` voor in de plaats, nooit niets.
 *     Is er nog geen id bewaard (een toestel dat deze regel nog niet kende),
 *     dan geldt wat vroeger gold: de caches blijven en een profiel uit de
 *     cache telt, zodat Mijn dag zonder bereik blijft openen.
 *  3. **Herladen** na een afmelding kan alleen als de schil er daarna nog is:
 *     met bereik, of uit de cache van de service worker.
 *  4. **De sessie zelf** gaat altijd uit de opslag, ook als `signOut` dat
 *     niet deed (`meldAfBijSupabase`).
 *
 * Buiten Cache Storage staat er verder niets persoonlijks op het toestel dat
 * een volgende gebruiker te zien krijgt: localStorage bevat voorkeuren en
 * tijdstempels per gebruikers-id en bedrijfsbrede lijsten (filmnummers,
 * ritblad-metadata); IndexedDB gebruikt het portaal niet.
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

/**
 * Wat de afronding van een afmelding in de plaats van het auth-id zet: de
 * privé-caches zijn gewist, ze zijn van niemand. Geen echt id, dus wie daarna
 * start (ook dezelfde gebruiker) is "iemand anders": caches eerst weg, geen
 * profiel uit de cache. Zo valt een toestel na een afmelding nooit terug op
 * "geen id bewaard", waar een profiel uit de cache wel telt; mocht er dan
 * toch nog iets van de vorige in de cache belanden (een service worker van
 * vóór deze regel), dan start niemand daarmee. Voor dezelfde gebruiker kost
 * het niets: na een afmelding is zijn cache er niet meer.
 */
export const AFGEMELD = '-';

/** Het kenmerk van vóór 02-10: het profiel-id van de vorige gebruiker. */
const OUD_KENMERK = 'vhb-last-user-id';

const lees = (sleutel: string): string | null => {
  try {
    return window.localStorage.getItem(sleutel);
  } catch {
    return null; // opslag geblokkeerd: niets bewaard
  }
};

/** Iemand anders dan de vorige op dit toestel? Alleen te zeggen als er een
 *  id bewaard is; zonder bewaard id is het antwoord nee (zoals vroeger). */
export const isAndereGebruiker = (bewaard: string | null | undefined, authId: string | null | undefined): boolean =>
  !!bewaard && bewaard !== authId;

/**
 * Start van een sessie, vóór het profiel wordt opgehaald: is dit iemand
 * anders dan de vorige op dit toestel, dan eerst de privé-caches weg. Geeft
 * terug of een profiel uit de cache mag dienen (`magProfiel`).
 */
export async function borgGebruiker(authId: string | undefined): Promise<boolean> {
  const ander = isAndereGebruiker(lees(LAATSTE_AUTH_KEY), authId);
  if (ander) await wisPriveCaches();
  return !ander;
}

/** Mag dit profiel-antwoord dienen? Een antwoord van de server altijd, een
 *  antwoord uit de cache alleen als de start het toeliet (`borgGebruiker`). */
export const magProfiel = (uitCache: boolean, cacheMag: boolean): boolean => !uitCache || cacheMag;

/** Het auth-id bewaren (of `AFGEMELD`, bij een afmelding). */
export function onthoudGebruiker(authId: string | undefined): void {
  if (!authId) return;
  try {
    window.localStorage.setItem(LAATSTE_AUTH_KEY, authId);
  } catch {
    // opslag geblokkeerd: dan blijft het toestel zonder bewaard id
  }
}

/**
 * Na een profiel dat van de server kwam (nooit na een profiel uit de cache:
 * dat bewijst niet wie dit is): de privé-caches zijn vanaf nu van deze
 * gebruiker. Was er nog geen auth-id bewaard, dan beslist één keer het oude
 * kenmerk, zoals vroeger: een ander profiel-id dan de vorige keer = de caches
 * weg; hetzelfde (of geen) = ze blijven.
 */
export async function bevestigGebruiker(authId: string | undefined, profielId: string): Promise<void> {
  const oud = lees(OUD_KENMERK);
  if (!lees(LAATSTE_AUTH_KEY) && oud && oud !== profielId) await wisPriveCaches();
  onthoudGebruiker(authId);
}

/**
 * Afmelden bij Supabase, en de sessie hoe dan ook uit de opslag. `signOut`
 * laat ze staan wanneer hij ze niet kan lezen: een verlopen token terwijl de
 * aanmeldserver onbereikbaar is (verversen mislukt, en dan keert hij terug
 * vóór hij iets wist; `scope: 'local'` loopt door dezelfde controle en doet
 * ook een netwerkaanroep). Op een gedeeld toestel was de vorige gebruiker dan
 * terug zodra het bereik er weer was. Geeft `signOut` een fout of gooit hij,
 * dan gaat de sessie weg onder de sleutel die de client zelf gebruikt.
 *
 * `bereik` (05-10): `'local'` beëindigt alleen de sessie van dit toestel,
 * `'global'` elke sessie van het account. Tot 05-10 was het altijd `'global'`
 * (de standaard van supabase-js): wie zich op een computer afmeldde, was ook
 * op zijn telefoon afgemeld en moest daar zijn wachtwoord opnieuw kennen. De
 * knop Afmelden vraagt nu `'local'`; een gedeeld toestel en de gedwongen
 * uitlog blijven `'global'` (zie `bereikVanAfmelding`). Ook `'local'` trekt
 * de sessie van dit toestel op de server in: een gekopieerd token is daarna
 * niets meer waard. Alle andere toestellen afmelden kan in Instellingen.
 */
export type AfmeldBereik = 'local' | 'global';

/** De knop Afmelden: alleen dit toestel, behalve op een gedeeld toestel. */
export const bereikVanAfmelding = (gedeeldToestel: boolean): AfmeldBereik => (gedeeldToestel ? 'global' : 'local');

export async function meldAfBijSupabase(
  auth: { signOut: (opties?: { scope?: AfmeldBereik }) => Promise<{ error: unknown }> } | null | undefined,
  bereik: AfmeldBereik = 'global',
): Promise<void> {
  if (!auth) return;
  let fout: unknown = true;
  try {
    fout = (await auth.signOut({ scope: bereik })).error;
  } catch {
    // telt als mislukt
  }
  if (!fout) return;
  try {
    window.localStorage.removeItem((auth as { storageKey?: string }).storageKey ?? '');
  } catch {
    // opslag geblokkeerd: dan stond de sessie er ook niet
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
