/** Build-info uit vite.config.ts (versie, commit-SHA, build-tijd). */
export const BUILD_INFO = __BUILD_INFO__;

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
