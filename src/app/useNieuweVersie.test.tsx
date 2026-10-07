import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const online = vi.hoisted(() => ({ nu: true, luisteraars: new Set<() => void>() }));
vi.mock('../lib/useOnline', () => ({
  isOnlineNu: () => online.nu,
  abonneerOnline: (l: () => void) => { online.luisteraars.add(l); return () => { online.luisteraars.delete(l); }; },
}));

import { NIEUWE_VERSIE_TEKST, useNieuweVersie } from './useNieuweVersie';

/**
 * De melding "nieuwe versie klaar", zoals ze tot 07-10 in App.tsx stond.
 * Vastgelegd: één melding per wachtende worker, niet bij de eerste
 * installatie, niet zonder netwerk, en de knop Vernieuw activeert de worker.
 */
type Luisteraars = Record<string, Array<(...args: unknown[]) => void>>;

const maakWorker = () => ({ postMessage: vi.fn(), state: 'installed', _l: {} as Luisteraars, addEventListener(t: string, f: (...args: unknown[]) => void) { (this._l[t] ??= []).push(f); } });

const maakRegistratie = (waiting: ReturnType<typeof maakWorker> | null) => ({
  waiting,
  installing: null as ReturnType<typeof maakWorker> | null,
  _l: {} as Luisteraars,
  addEventListener(t: string, f: (...args: unknown[]) => void) { (this._l[t] ??= []).push(f); },
});

const zetServiceWorker = (reg: ReturnType<typeof maakRegistratie>, controller: object | null = {}) => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller, getRegistration: () => Promise.resolve(reg) },
  });
};

beforeEach(() => { online.nu = true; online.luisteraars.clear(); });
afterEach(() => { delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker; });

describe('useNieuweVersie', () => {
  it('meldt een wachtende versie één keer, ook na terugkeer naar de app; Vernieuw activeert de worker', async () => {
    const wachtend = maakWorker();
    zetServiceWorker(maakRegistratie(wachtend));
    const showToast = vi.fn();
    renderHook(() => useNieuweVersie(showToast));
    await act(async () => {});
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe(NIEUWE_VERSIE_TEKST);
    expect(showToast.mock.calls[0][1]).toBe('info');
    // Terug naar de app (visibilitychange): dezelfde wachtende worker, geen tweede toast.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(showToast).toHaveBeenCalledTimes(1);
    (showToast.mock.calls[0][2] as { run: () => void }).run();
    expect(wachtend.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('een échte nieuwe deploy (ander wachtend object) wordt wél opnieuw gemeld', async () => {
    const reg = maakRegistratie(maakWorker());
    zetServiceWorker(reg);
    const showToast = vi.fn();
    renderHook(() => useNieuweVersie(showToast));
    await act(async () => {});
    expect(showToast).toHaveBeenCalledTimes(1);
    const nieuwe = maakWorker();
    nieuwe.state = 'installing';
    reg.installing = nieuwe;
    act(() => { reg._l.updatefound?.forEach((f) => f()); });
    reg.waiting = nieuwe;
    nieuwe.state = 'installed';
    act(() => { nieuwe._l.statechange?.forEach((f) => f()); });
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it('bij de eerste installatie (geen controller) komt er geen melding', async () => {
    zetServiceWorker(maakRegistratie(maakWorker()), null);
    const showToast = vi.fn();
    renderHook(() => useNieuweVersie(showToast));
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();
  });

  it('zonder netwerk wacht de melding tot het bereik terug is', async () => {
    online.nu = false;
    zetServiceWorker(maakRegistratie(maakWorker()));
    const showToast = vi.fn();
    renderHook(() => useNieuweVersie(showToast));
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();
    online.nu = true;
    act(() => { online.luisteraars.forEach((l) => l()); });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('zonder service worker doet de hook niets', async () => {
    const showToast = vi.fn();
    renderHook(() => useNieuweVersie(showToast));
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();
    expect(online.luisteraars.size).toBe(0);
  });
});
