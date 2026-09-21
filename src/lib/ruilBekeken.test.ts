import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
let online = true;
vi.mock('./api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock('./useOnline', () => ({ isOnlineNu: () => online }));

import { _resetRuilBekekenVoorTests, bewaakInBeeld, meldRuilBekeken } from './ruilBekeken';

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  online = true;
  _resetRuilBekekenVoorTests();
});

describe('meldRuilBekeken', () => {
  it('stuurt één stille POST naar het eigen endpoint, niet naar /gezien', () => {
    meldRuilBekeken('w1');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/swaps/w1/bekeken', { method: 'POST', stil: true });
  });

  it('hoogstens één keer per ruil per sessie, ook als het scherm opnieuw opent', () => {
    meldRuilBekeken('w1');
    meldRuilBekeken('w1');
    meldRuilBekeken('w2');
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual(['/api/swaps/w1/bekeken', '/api/swaps/w2/bekeken']);
  });

  it('een mislukte registratie stoort niets: geen throw, geen onafgehandelde rejectie, geen herkansing', async () => {
    apiFetch.mockRejectedValue(new Error('Het portaal is even in onderhoud, probeer het zo opnieuw.'));
    const onafgehandeld = vi.fn();
    process.on('unhandledRejection', onafgehandeld);
    expect(() => meldRuilBekeken('w1')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', onafgehandeld);
    expect(onafgehandeld).not.toHaveBeenCalled();
    meldRuilBekeken('w1');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('offline: niets versturen en niets onthouden, zodat het met bereik nog telt', () => {
    online = false;
    meldRuilBekeken('w1');
    expect(apiFetch).not.toHaveBeenCalled();
    online = true;
    meldRuilBekeken('w1');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('zonder id gebeurt er niets', () => {
    meldRuilBekeken('');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('bewaakInBeeld', () => {
  type Melder = (entries: Array<{ isIntersecting: boolean }>) => void;
  let melders: Melder[] = [];
  let losgekoppeld = 0;
  let zichtbaarheid: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    melders = [];
    losgekoppeld = 0;
    zichtbaarheid = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => zichtbaarheid);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: Melder) { melders.push(cb); }
      observe() {}
      disconnect() { losgekoppeld += 1; }
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('meldt pas nadat de kaart even in beeld stond, en daarna nooit meer', () => {
    const klaar = vi.fn();
    bewaakInBeeld(document.createElement('div'), klaar, 800);
    melders[0]([{ isIntersecting: true }]);
    vi.advanceTimersByTime(799);
    expect(klaar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(klaar).toHaveBeenCalledTimes(1);
    expect(losgekoppeld).toBe(1);
  });

  it('een kaart die voorbijschiet bij het scrollen telt niet', () => {
    const klaar = vi.fn();
    bewaakInBeeld(document.createElement('div'), klaar, 800);
    melders[0]([{ isIntersecting: true }]);
    vi.advanceTimersByTime(300);
    melders[0]([{ isIntersecting: false }]);
    vi.advanceTimersByTime(5000);
    expect(klaar).not.toHaveBeenCalled();
  });

  it('een verborgen tabblad telt niet; zodra het zichtbaar wordt begint het verblijf', () => {
    const klaar = vi.fn();
    zichtbaarheid = 'hidden';
    bewaakInBeeld(document.createElement('div'), klaar, 800);
    melders[0]([{ isIntersecting: true }]);
    vi.advanceTimersByTime(5000);
    expect(klaar).not.toHaveBeenCalled();
    zichtbaarheid = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(800);
    expect(klaar).toHaveBeenCalledTimes(1);
  });

  it('opruimen (scherm verlaten, ruil beantwoord) annuleert een lopend verblijf', () => {
    const klaar = vi.fn();
    const opruimen = bewaakInBeeld(document.createElement('div'), klaar, 800);
    melders[0]([{ isIntersecting: true }]);
    opruimen();
    vi.advanceTimersByTime(5000);
    expect(klaar).not.toHaveBeenCalled();
  });

  it('zonder IntersectionObserver telt het openen van het scherm', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const klaar = vi.fn();
    bewaakInBeeld(document.createElement('div'), klaar, 800);
    vi.advanceTimersByTime(800);
    expect(klaar).toHaveBeenCalledTimes(1);
  });
});
