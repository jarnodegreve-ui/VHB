import { useSyncExternalStore } from 'react';

/**
 * Netwerkstatus als module-store (patroon presence.ts): één waarheid voor de
 * stille offline-labels (Mijn dag, ritbladviewer, zelf-ladende schermen), de
 * offline-kaart in de schil en de update-toast-guard in App.tsx.
 *
 * `navigator.onLine` + de online/offline-events zijn de basis, maar die
 * liegen soms: een telefoon met wifi-symbool zonder internet (captive
 * portal, bus-wifi) blijft "online". Daarom een lichte ping-fallback: bij
 * de eerste abonnee, bij terugkeer naar de voorgrond en bij een online-event
 * één HEAD naar /api/health (publiek, geen sessie, geen SW-cache). Alleen een
 * netwerkfout of time-out telt als offline; elke HTTP-status (ook 4xx/5xx)
 * = bereik. Geen periodieke polling: één request per voorgrond-moment.
 *
 * Vóór 15-09 was dit een lokale hook: elke instantie hing eigen listeners op
 * en deed een eigen ping (Mijn dag + ritbladviewer = twee pings naast
 * elkaar), en PwaChrome had er nog een derde definitie naast op alleen
 * `navigator.onLine`. Nu: één ping tegelijk (gedeeld), één listener-set
 * (opgehangen bij de eerste abonnee, weer weg bij de laatste), en
 * `isOnlineNu()` voor code buiten React.
 */
const PING_URL = '/api/health';
const PING_TIMEOUT_MS = 4000;

export async function pingBereik(signal?: AbortSignal): Promise<boolean> {
  if (typeof fetch !== 'function') return true;
  const afbreker = new AbortController();
  const timer = window.setTimeout(() => afbreker.abort(), PING_TIMEOUT_MS);
  signal?.addEventListener('abort', () => afbreker.abort(), { once: true });
  try {
    await fetch(PING_URL, { method: 'HEAD', cache: 'no-store', signal: afbreker.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

// --- module-store ---
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
const luisteraars = new Set<() => void>();
let lopendePing: AbortController | null = null;
let opgehangen = false;

const zetOnline = (waarde: boolean) => {
  if (online === waarde) return;
  online = waarde;
  luisteraars.forEach((l) => l());
};

/** Bereik nu opnieuw vaststellen: offline-vlag van de browser wint meteen,
 *  anders één (gedeelde) ping. Een lopende ping wordt vervangen. */
export function controleerBereik(): void {
  if (typeof navigator === 'undefined') return;
  if (!navigator.onLine) {
    lopendePing?.abort();
    lopendePing = null;
    zetOnline(false);
    return;
  }
  lopendePing?.abort();
  const mijn = new AbortController();
  lopendePing = mijn;
  void pingBereik(mijn.signal).then((ok) => {
    if (lopendePing !== mijn) return; // ingehaald door een nieuwere check
    lopendePing = null;
    zetOnline(ok);
  });
}

const opOnline = () => controleerBereik();
const opOffline = () => {
  lopendePing?.abort();
  lopendePing = null;
  zetOnline(false);
};
const opZichtbaar = () => {
  if (document.visibilityState === 'visible') controleerBereik();
};

const hangOp = () => {
  if (opgehangen || typeof window === 'undefined') return;
  opgehangen = true;
  window.addEventListener('online', opOnline);
  window.addEventListener('offline', opOffline);
  document.addEventListener('visibilitychange', opZichtbaar);
  controleerBereik();
};
const haalWeg = () => {
  if (!opgehangen) return;
  opgehangen = false;
  window.removeEventListener('online', opOnline);
  window.removeEventListener('offline', opOffline);
  document.removeEventListener('visibilitychange', opZichtbaar);
  lopendePing?.abort();
  lopendePing = null;
};

/** Abonneren buiten React (App-effecten, tests). Geeft de afmelder terug. */
export function abonneerOnline(l: () => void): () => void {
  luisteraars.add(l);
  hangOp();
  return () => {
    luisteraars.delete(l);
    if (luisteraars.size === 0) haalWeg();
  };
}

/** De laatst bekende status, synchroon, voor code buiten een component. */
export const isOnlineNu = (): boolean => online;

const lees = () => online;
const leesServer = () => true;

export function useOnline(): boolean {
  return useSyncExternalStore(abonneerOnline, lees, leesServer);
}

/** Alleen voor tests: store terug naar de beginstand. */
export function _resetOnlineStoreVoorTests(): void {
  haalWeg();
  luisteraars.clear();
  online = typeof navigator === 'undefined' ? true : navigator.onLine;
}
