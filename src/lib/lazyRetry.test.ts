import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Vangnet voor een verlopen chunk na een deploy (melding Jarno 09-09,
 * "beheer-tabs openen niet meer op mobiel"). Een verdwenen asset geeft geen
 * 404 maar 200 + index.html (SPA-rewrite), dus de import klapt op het parsen.
 * Een gewone reload volstond niet: de service worker mag op een traag netwerk
 * dezelfde oude shell teruggeven. Daarom eerst de wachtende worker laten
 * aantreden en de shell-cache wissen.
 */
const laadModule = async () => {
  vi.resetModules();
  return (await import('./lazyRetry')).lazyWithRetry;
};

/** React.lazy stelt de factory uit tot het renderen; hier roepen we de
 *  binnenkant rechtstreeks aan via het _payload-veld van het lazy-object. */
const draaiFactory = async (lazyObj: unknown): Promise<unknown> => {
  const payload = (lazyObj as { _payload: { _result: () => Promise<unknown> } })._payload;
  return payload._result();
};

const opzet = (opts: { waiting?: boolean } = {}) => {
  const gewist: string[] = [];
  const geposte: unknown[] = [];
  const herlaad = vi.fn();
  const update = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    keys: vi.fn().mockResolvedValue(['vhb-portaal-abc123', 'vhb-ritbladen', 'iets-anders']),
    delete: vi.fn(async (k: string) => { gewist.push(k); return true; }),
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({
        update,
        waiting: opts.waiting === false ? null : { postMessage: (m: unknown) => geposte.push(m) },
      }),
    },
  });
  Object.defineProperty(window, 'location', { value: { reload: herlaad }, writable: true });
  sessionStorage.clear();
  return { gewist, geposte, herlaad, update };
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('lazyWithRetry', () => {
  it('laat een geslaagde import gewoon door', async () => {
    opzet();
    const lazyWithRetry = await laadModule();
    const comp = { default: () => null } as never;
    const uit = await draaiFactory(lazyWithRetry(async () => comp));
    expect(uit).toBe(comp);
  });

  it('probeert één keer opnieuw voor het opgeeft (haperend netwerk)', async () => {
    opzet();
    const lazyWithRetry = await laadModule();
    const comp = { default: () => null } as never;
    let pogingen = 0;
    const uit = await draaiFactory(lazyWithRetry(async () => {
      pogingen += 1;
      if (pogingen === 1) throw new Error('netwerk');
      return comp;
    }));
    expect(pogingen).toBe(2);
    expect(uit).toBe(comp);
  });

  it('activeert de wachtende versie, wist alleen de shell-cache en herlaadt', async () => {
    const { gewist, geposte, herlaad, update } = opzet();
    const lazyWithRetry = await laadModule();
    // Blijft hangen op de Suspense-fallback: de reload is onderweg.
    let opgelost = false;
    void draaiFactory(lazyWithRetry(async () => { throw new Error('Failed to fetch dynamically imported module'); }))
      .then(() => { opgelost = true; });
    await vi.waitFor(() => expect(herlaad).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(update).toHaveBeenCalled();
    expect(geposte).toEqual([{ type: 'SKIP_WAITING' }]);
    // De ritbladen-cache blijft staan (build-onafhankelijk, offline ritbladen).
    expect(gewist).toEqual(['vhb-portaal-abc123']);
    expect(opgelost).toBe(false);
    expect(sessionStorage.getItem('vhb-chunk-reload')).toBe('1');
  });

  it('herlaadt niet twee keer, maar meldt het met een Vernieuwen-knop', async () => {
    const { herlaad } = opzet();
    sessionStorage.setItem('vhb-chunk-reload', '1');
    const lazyWithRetry = await laadModule();
    const toasts: CustomEvent[] = [];
    window.addEventListener('vhb-toast', (e) => toasts.push(e as CustomEvent));
    await expect(draaiFactory(lazyWithRetry(async () => { throw new Error('stuk'); }))).rejects.toThrow('stuk');
    expect(herlaad).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].detail.tone).toBe('error');
    expect(toasts[0].detail.action.label).toBe('Vernieuwen');
  });
});
