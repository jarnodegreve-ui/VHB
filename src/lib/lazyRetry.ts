import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'vhb-chunk-reload';

/**
 * React.lazy met vangnet voor mislukte chunk-imports. Twee scenario's die in
 * een PWA anders in het hele-app-crashscherm eindigen:
 * - haperend netwerk onderweg: één stille retry na korte pauze;
 * - verlopen chunk-hash na een deploy (oude index.html verwijst naar een
 *   asset dat niet meer bestaat): één automatische reload zodat de verse
 *   shell geladen wordt. De sessionStorage-vlag voorkomt een reload-lus.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    } catch (err) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const mod = await factory();
        sessionStorage.removeItem(RELOAD_FLAG);
        return mod;
      } catch {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          window.location.reload();
          // Reload is onderweg — laat de Suspense-fallback staan i.p.v. te crashen.
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  });
}
