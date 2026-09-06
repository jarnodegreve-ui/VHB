/** Build-info uit vite.config.ts (versie, commit-SHA, build-tijd). Buiten
 *  Vite (vitest zonder define) is de global er niet: dan een neutrale
 *  fallback, zodat modules die dit importeren (monitoring) niet omvallen. */
export const BUILD_INFO: { readonly version: string; readonly sha: string; readonly builtAt: string } =
  typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : { version: '0.0.0', sha: '', builtAt: '1970-01-01T00:00:00.000Z' };

/** Release-label voor foutrapporten: de commit-SHA van de build, of
 *  'lokaal-<versie>' buiten Vercel. */
export const RELEASE = BUILD_INFO.sha ? BUILD_INFO.sha : `lokaal-${BUILD_INFO.version}`;

/**
 * Vraagt de actieve service worker naar z'n cache-versie (bv.
 * 'vhb-portaal-v15'). Geeft null als er geen SW actief is of hij niet op tijd
 * antwoordt — zo zie je in Systeem-status of de PWA nog op een oude SW draait.
 */
export function getServiceWorkerVersion(timeoutMs = 1500): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) {
    return Promise.resolve(null);
  }
  const controller = navigator.serviceWorker.controller;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const version = event.data?.version;
      resolve(typeof version === 'string' ? version : null);
    };
    controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
}
