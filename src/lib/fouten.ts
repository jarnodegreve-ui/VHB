import { notify } from './ui';

/**
 * Foutcopy met een vervolgstap (tranche 3A, 22-09-2026).
 *
 * 183 rode toasts zeiden "X is mislukt." en lieten de gebruiker daar staan;
 * maar 29 noemden wat je dan moet doen. Hier staat één regel: elke
 * schrijffout = wat er niet lukte + wat je nu kunt doen, afgeleid uit de
 * oorzaak (offline, verbinding, rechten, conflict, invoer, server). Wie een
 * `opnieuw`-functie meegeeft, krijgt de knop "Opnieuw proberen" in de toast.
 *
 *   meldSchrijffout('Opslaan', err, () => opslaan());
 *   // → "Opslaan is mislukt. Controleer je verbinding en probeer het opnieuw."
 *
 * Veldfouten (400 met `veldfouten`) horen niet hier maar bij het veld:
 * src/lib/formulier.ts `useVeldfouten().vanServer(data)`.
 */

export type FoutInfo = {
  /** HTTP-status als die bekend is (TechniekFout, LoonFout, RapportFout, Response, {status}). */
  status?: number;
  /** Servertekst die de gebruiker mag zien (alleen bij een 4xx met een reden). */
  tekst?: string;
  /** fetch() zelf faalde: geen antwoord van de server. */
  netwerk: boolean;
  /** De browser meldt dat er geen verbinding is. */
  offline: boolean;
};

const GENERIEK = /^Er ging iets mis|^Opslaan mislukt|mislukt\.?$/i;

/** Leest status, servertekst en netwerkaard uit wat een save-pad gooit. */
export function leesFout(err: unknown): FoutInfo {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (err == null) return { netwerk: false, offline };
  if (typeof Response !== 'undefined' && err instanceof Response) return { status: err.status, netwerk: false, offline };
  const o = err as { status?: unknown; response?: { status?: unknown }; message?: unknown; name?: unknown };
  const status = typeof o.status === 'number' ? o.status : typeof o.response?.status === 'number' ? o.response.status : undefined;
  const bericht = typeof o.message === 'string' ? o.message.trim() : '';
  const netwerk = status === undefined && (o.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed/i.test(bericht));
  // Alleen een 4xx-reden is een gebruikerstekst; 5xx- en fallbackteksten zijn generiek.
  const tekst = status !== undefined && status >= 400 && status < 500 && bericht && !GENERIEK.test(bericht) ? bericht : undefined;
  return { status, tekst, netwerk, offline };
}

/** De concrete volgende stap bij deze fout, als volledige zin. */
export function vervolgstap(info: FoutInfo): string {
  if (info.offline) return 'Je bent offline. Probeer het opnieuw zodra je bereik hebt.';
  if (info.netwerk) return 'Controleer je verbinding en probeer het opnieuw.';
  switch (info.status) {
    case 400:
    case 422:
      return 'Pas de invoer aan en probeer het opnieuw.';
    case 401:
      return 'Je sessie is verlopen. Meld je opnieuw aan.';
    case 403:
      return 'Je hebt hiervoor geen rechten. Vraag de planning als dat niet klopt.';
    case 404:
      return 'Het bestaat niet meer. Vernieuw de lijst.';
    case 409:
      return 'Iemand anders heeft dit intussen gewijzigd. Vernieuw de lijst en probeer het opnieuw.';
    case 413:
      return 'Maak het bestand kleiner en probeer het opnieuw.';
    case 429:
      return 'Wacht even en probeer het opnieuw.';
    case 503:
      return 'Het portaal is even in onderhoud. Probeer het zo opnieuw.';
    default:
      return 'Probeer het zo opnieuw. Blijft het misgaan, meld het via het accountmenu, Meld een probleem.';
  }
}

const zin = (tekst: string) => (/[.!?]$/.test(tekst) ? tekst : `${tekst}.`);

/**
 * "Opslaan is mislukt. <reden van de server.> <vervolgstap>"
 * `actie` is de werkwoordsvorm die de knop droeg: 'Opslaan', 'Verwijderen',
 * 'Ziek melden', 'Toewijzen'. Een `err` mag ontbreken (bv. `!res.ok` zonder
 * gelezen body): dan blijft alleen de algemene vervolgstap over.
 */
export function schrijffout(actie: string, err?: unknown): string {
  const info = leesFout(err);
  const delen = [`${actie} is mislukt.`];
  if (info.tekst) delen.push(zin(info.tekst));
  delen.push(vervolgstap(info));
  return delen.join(' ');
}

/** Rode toast met vervolgstap, en met "Opnieuw proberen" als de actie
 *  veilig herhaald kan worden (de server heeft niets bewaard). */
export function meldSchrijffout(actie: string, err?: unknown, opnieuw?: () => void): void {
  notify(schrijffout(actie, err), 'error', opnieuw ? { action: { label: 'Opnieuw proberen', run: opnieuw } } : undefined);
}
