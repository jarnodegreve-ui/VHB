import { haalRitbladMeta } from './ritbladPaginas';

/**
 * Ritblad offline (next-level 2, 06-09): na het laden van Mijn dag of het
 * dashboard vraagt de app de service worker om de ritblad-bundel alvast in
 * de build-onafhankelijke cache 'vhb-ritbladen' te zetten
 * (postMessage {type:'cache-ritbladen', urls}). Zo staat het blad ook klaar
 * wanneer de chauffeur het pas onderweg — zonder bereik — opent. De SW
 * snoeit die cache tot MAX_RITBLADEN entries (public/sw-ritbladen.js).
 *
 * Er is één gedeelde bundel (id "current"), dus `urls` is in de praktijk één
 * signed URL; de SW sleutelt op het query-loze pad. Eens per WARM_INTERVAL
 * per sessie: de metadata-call is klein, maar hoeft niet bij elke render.
 */
export const RITBLADEN_CACHE = 'vhb-ritbladen';
const WARM_INTERVAL_MS = 30 * 60 * 1000;
let laatstGewarmd = 0;

/** Query-loze sleutel, gelijk aan ritbladCacheKey in public/sw-ritbladen.js. */
export const ritbladCacheKey = (url: string): string => {
  const u = new URL(url, window.location.origin);
  return u.origin + u.pathname;
};

const swController = (): ServiceWorker | null =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;

/** Stuurt de SW de URL's om te bewaren; false als er geen actieve SW is. */
export const meldRitbladenAanSw = (urls: string[]): boolean => {
  const sw = swController();
  if (!sw || urls.length === 0) return false;
  try {
    sw.postMessage({ type: 'cache-ritbladen', urls });
    return true;
  } catch {
    return false;
  }
};

/** Metadata ophalen en de bundel aanmelden — best-effort en gethrottled. */
export async function warmRitbladCache(opts: { force?: boolean } = {}): Promise<void> {
  if (!swController()) return;
  const nu = Date.now();
  if (!opts.force && nu - laatstGewarmd < WARM_INTERVAL_MS) return;
  laatstGewarmd = nu;
  try {
    const meta = await haalRitbladMeta();
    if (meta?.url) meldRitbladenAanSw([meta.url]);
  } catch {
    // offline of geen bundel — de volgende online opening probeert opnieuw
    laatstGewarmd = 0;
  }
}

/** Staat deze bundel-URL in de ritbladen-cache (→ "Opgeslagen exemplaar")? */
export async function isRitbladOpgeslagen(url: string): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) return false;
    const cache = await caches.open(RITBLADEN_CACHE);
    return Boolean(await cache.match(ritbladCacheKey(url)));
  } catch {
    return false;
  }
}

/** Alleen voor tests: throttle terugzetten. */
export const _resetRitbladWarm = () => { laatstGewarmd = 0; };
