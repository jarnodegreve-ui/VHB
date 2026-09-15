import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetOnlineStoreVoorTests, abonneerOnline, controleerBereik, isOnlineNu } from './useOnline';

/**
 * De online-store (punt 19): één ping, één listener-set, één waarheid.
 * Vóór 15-09 pingde elke useOnline-instantie apart en had PwaChrome er
 * een derde definitie naast op alleen navigator.onLine.
 */
const zetOnLine = (waarde: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value: waarde });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('online-store', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    zetOnLine(true);
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    _resetOnlineStoreVoorTests();
  });
  afterEach(() => {
    _resetOnlineStoreVoorTests();
    vi.unstubAllGlobals();
  });

  it('twee abonnees delen één ping en één listener-set', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const af1 = abonneerOnline(() => {});
    const af2 = abonneerOnline(() => {});
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/health');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD', cache: 'no-store' });
    expect(addSpy.mock.calls.filter((c) => c[0] === 'online')).toHaveLength(1);
    expect(addSpy.mock.calls.filter((c) => c[0] === 'offline')).toHaveLength(1);
    af1();
    af2();
    addSpy.mockRestore();
  });

  it('offline-event zet de waarheid meteen op false, online-event pingt en herstelt', async () => {
    const meldingen: boolean[] = [];
    const af = abonneerOnline(() => meldingen.push(isOnlineNu()));
    await tick();
    expect(isOnlineNu()).toBe(true);
    zetOnLine(false);
    window.dispatchEvent(new Event('offline'));
    expect(isOnlineNu()).toBe(false);
    zetOnLine(true);
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(isOnlineNu()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(meldingen).toEqual([false, true]);
    af();
  });

  it('"onLine maar geen internet": een mislukte ping telt als offline, een 5xx als bereik', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const af = abonneerOnline(() => {});
    await tick();
    expect(isOnlineNu()).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    controleerBereik();
    await tick();
    expect(isOnlineNu()).toBe(true);
    af();
  });

  it('na de laatste afmelding hangen er geen listeners meer', async () => {
    const af = abonneerOnline(() => {});
    await tick();
    af();
    zetOnLine(false);
    window.dispatchEvent(new Event('offline'));
    // Niemand luistert meer: de store beweegt niet mee (geen lek naar een
    // volgend scherm zonder abonnee).
    expect(isOnlineNu()).toBe(true);
  });
});
