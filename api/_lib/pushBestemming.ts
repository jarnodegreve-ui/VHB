/**
 * Mag de server een push naar dit endpoint sturen? (beveiligingsscan 01-10,
 * keuze 10.)
 *
 * Het endpoint van een push-abonnement komt uit de browser van de gebruiker en
 * is dus invoer: elke ingelogde gebruiker kon een eigen server opgeven. De
 * server roept dat adres later zelf aan, en web-push leest het hele antwoord
 * in zonder bovengrens. Een eigen server kon zo het geheugen van de functie
 * vullen, en een hostnaam die naar een intern adres wijst passeerde de oude
 * controle, want die keek alleen naar de tekst van de hostnaam.
 *
 * Daarom geen lijst van verboden adressen maar een lijst van toegestane
 * bestemmingen: alleen de pushdiensten die browsers echt gebruiken. Een
 * abonnement uit `pushManager.subscribe()` wijst altijd naar een van deze:
 *
 *  - fcm.googleapis.com: Chrome, Edge op Android, Samsung Internet, Opera,
 *    Brave, Vivaldi (Firebase Cloud Messaging).
 *  - jmt17.google.com: dezelfde dienst voor Chrome Beta, Dev en Canary. Bron:
 *    de Chromium-code, components/push_messaging/push_messaging_constants.cc
 *    (`kPushMessagingStagingGcmEndpoint`) en push_messaging_utils.cc
 *    (`GetGcmEndpointForChannel`: elk kanaal behalve Stable krijgt dit adres).
 *  - updates.push.services.mozilla.com: Firefox, ook op Android.
 *  - één label onder push.apple.com (vandaag web.push.apple.com): Safari op
 *    macOS, en elke browser op iOS en iPadOS.
 *  - elke host onder notify.windows.com: Edge op Windows (WNS).
 *
 * Een pushdienst die hier ontbreekt verliest zijn meldingen niet stil: het
 * versturen logt de hostnaam (api/push.ts) en de rij blijft staan. Voeg de
 * host dan hier toe, met de bron erbij.
 *
 * Zuiver en zonder afhankelijkheden: geen DNS, geen netwerk. Getest in
 * src/pushBestemming.test.ts.
 */

/** Exacte hostnamen. */
const EXACT: ReadonlySet<string> = new Set([
  "fcm.googleapis.com",
  "jmt17.google.com",
  "updates.push.services.mozilla.com",
]);

// Eén DNS-label: letters, cijfers en een streepje, nooit aan de rand.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** Precies één label onder push.apple.com (web.push.apple.com). */
const APPLE = new RegExp(`^${LABEL}\\.push\\.apple\\.com$`);
/** Eén of meer labels onder notify.windows.com (wns2-par02p.notify.windows.com). */
const WINDOWS = new RegExp(`^(?:${LABEL}\\.)+notify\\.windows\\.com$`);

const isPushHost = (host: string): boolean => EXACT.has(host) || APPLE.test(host) || WINDOWS.test(host);

export type PushBestemming =
  /** `url` is de genormaliseerde vorm: daarheen gaat de aanroep. */
  | { toegestaan: true; host: string; url: string }
  /** `host` is alleen voor het logboek; null als de tekst geen URL is. */
  | { toegestaan: false; host: string | null };

/**
 * Beoordeelt een endpoint. Toegestaan is alleen: https, de standaardpoort,
 * geen gebruikersnaam of wachtwoord in de URL, en een host uit de lijst
 * hierboven. De hostnaam wordt vergeleken zoals de URL-parser hem leest
 * (kleine letters, één punt aan het einde telt niet mee), exact of als
 * achtervoegsel dat op een punt begint. `fcm.googleapis.com.aanvaller.tld` en
 * `evil-fcm.googleapis.com` vallen dus af, net als een IP-adres.
 *
 * De teruggegeven `url` is opnieuw opgebouwd uit de gelezen delen. De
 * verzender gebruikt die en niet de bewaarde tekst: web-push leest een URL met
 * de oude `url.parse`, en twee parsers die dezelfde tekst anders lezen is
 * precies hoe een hostcontrole omzeild wordt. Voor een endpoint dat een
 * browser aanmaakte zijn beide vormen gelijk.
 */
export const beoordeelPushBestemming = (raw: unknown): PushBestemming => {
  if (typeof raw !== "string" || raw === "") return { toegestaan: false, host: null };
  let u: URL;
  try { u = new URL(raw); } catch { return { toegestaan: false, host: null }; }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.protocol !== "https:") return { toegestaan: false, host };
  // `new URL` maakt van een expliciete :443 een lege poort; elke andere poort blijft staan.
  if (u.port !== "") return { toegestaan: false, host };
  if (u.username !== "" || u.password !== "") return { toegestaan: false, host };
  if (!isPushHost(host)) return { toegestaan: false, host };
  return { toegestaan: true, host, url: `https://${host}${u.pathname}${u.search}` };
};
