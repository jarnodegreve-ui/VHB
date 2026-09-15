import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// useOnline pingt /api/health; hier sturen we de netwerkstatus zelf.
let online = true;
vi.mock('./useOnline', () => ({ useOnline: () => online }));

import { FOCUS_INTERVAL_MS, foutTekst, useZelfLadend, versheidTekst } from './zelfLadend';

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const wordZichtbaar = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  online = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T14:32:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useZelfLadend', () => {
  it('laadt bij mount, zet laden uit en onthoudt het tijdstip', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad));
    expect(result.current.laden).toBe(true);
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);
    expect(result.current.laden).toBe(false);
    expect(result.current.fout).toBeNull();
    expect(result.current.laatstGeladen).toBe(Date.now());
    expect(versheidTekst(result.current.versheid)).toBe('Bijgewerkt om 14:32');
  });

  it('zet de fout met de gekozen boodschap en wist hem bij opnieuw()', async () => {
    const laad = vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad, { boodschap: 'Kon het gele boek niet laden.' }));
    await flush();
    expect(result.current.fout).toBe('Kon het gele boek niet laden.');
    expect(result.current.laatstGeladen).toBeNull();

    await act(async () => { await result.current.opnieuw(); });
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.fout).toBeNull();
    expect(result.current.laatstGeladen).toBe(Date.now());
  });

  it('ververst stil bij terugkeer naar het tabblad, hooguit één keer per minuut', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad));
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);

    // Binnen het interval: niets.
    act(() => { vi.advanceTimersByTime(FOCUS_INTERVAL_MS / 2); wordZichtbaar(); });
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);

    // Erna: één stille verversing (geen skelet, wel nieuw tijdstip).
    act(() => { vi.advanceTimersByTime(FOCUS_INTERVAL_MS / 2); wordZichtbaar(); });
    expect(result.current.laden).toBe(false);
    await flush();
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.laatstGeladen).toBe(Date.now());
  });

  it('slaat de focus-verversing over zonder verbinding en laat de fout dan met rust', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() => useZelfLadend(laad));
    await flush();
    online = false;
    rerender();
    act(() => { vi.advanceTimersByTime(FOCUS_INTERVAL_MS + 1); wordZichtbaar(); });
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);
    expect(versheidTekst(result.current.versheid)).toBe('Offline · Bijgewerkt om 14:32');

    // Verbinding terug: één stille verversing.
    online = true;
    rerender();
    await flush();
    expect(laad).toHaveBeenCalledTimes(2);
  });

  it('negeert een oud antwoord dat na een deps-wissel binnenkomt', async () => {
    let los: (() => void) | null = null;
    const traag = new Promise<void>((r) => { los = r; });
    const laad = vi.fn().mockReturnValueOnce(traag).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ filter }: { filter: string }) => useZelfLadend(laad, { deps: [filter] }), { initialProps: { filter: 'open' } });
    rerender({ filter: 'alles' });
    await flush();
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.laden).toBe(false);
    const tijd = result.current.laatstGeladen;
    vi.advanceTimersByTime(5_000);
    await act(async () => { los!(); await Promise.resolve(); });
    expect(result.current.laatstGeladen).toBe(tijd);
  });

  it('stille verversing die mislukt zet geen fout', async () => {
    const laad = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('kapot'));
    const { result } = renderHook(() => useZelfLadend(laad));
    await flush();
    await act(async () => { await result.current.ververs(); });
    expect(result.current.fout).toBeNull();
    expect(result.current.verversen).toBe(false);
  });
});

describe('foutTekst en versheidTekst', () => {
  it('kiest de boodschap: vast, functie, Error-message of algemeen', () => {
    expect(foutTekst(new Error('x'), 'Vast.')).toBe('Vast.');
    expect(foutTekst(new Error('x'), (e) => `Fout: ${(e as Error).message}`)).toBe('Fout: x');
    expect(foutTekst(new Error('Server zei nee'))).toBe('Server zei nee');
    expect(foutTekst('iets')).toBe('Kon de gegevens niet laden.');
  });
  it('toont Bijwerken… tijdens een stille verversing en niets vóór de eerste laad', () => {
    expect(versheidTekst({ laatstGeladen: null, verversen: false, online: true })).toBe('');
    expect(versheidTekst({ laatstGeladen: 1, verversen: true, online: true })).toBe('Bijwerken…');
    expect(versheidTekst({ laatstGeladen: null, verversen: false, online: false })).toBe('Offline');
  });
});
