import { useEffect, useState } from 'react';

/**
 * Netwerkstatus voor de stille offline-labels (Mijn dag, ritbladviewer).
 *
 * `navigator.onLine` + de online/offline-events zijn de basis, maar die
 * liegen soms: een telefoon met wifi-symbool zonder internet (captive
 * portal, bus-wifi) blijft "online". Daarom een lichte ping-fallback: bij
 * het openen, bij terugkeer naar de voorgrond en bij een online-event één
 * HEAD naar /api/health (publiek, geen sessie, geen SW-cache — de service
 * worker laat /api/* buiten Mijn dag ongemoeid). Alleen een netwerkfout of
 * time-out telt als offline; elke HTTP-status (ook 4xx/5xx) = bereik.
 * Geen periodieke polling: één request per voorgrond-moment volstaat.
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

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let actief = true;
    let lopend: AbortController | null = null;
    const check = () => {
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }
      lopend?.abort();
      lopend = new AbortController();
      void pingBereik(lopend.signal).then((ok) => {
        if (actief) setOnline(ok);
      });
    };
    const op = () => check();
    const af = () => setOnline(false);
    const zichtbaar = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('online', op);
    window.addEventListener('offline', af);
    document.addEventListener('visibilitychange', zichtbaar);
    check();
    return () => {
      actief = false;
      lopend?.abort();
      window.removeEventListener('online', op);
      window.removeEventListener('offline', af);
      document.removeEventListener('visibilitychange', zichtbaar);
    };
  }, []);

  return online;
}
