import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMaandVeeg, VEEG_DREMPEL, type MaandVeeg } from './useMaandVeeg';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * De maand-veeg: horizontaal slepen wisselt de maand met richting, verticaal
 * slepen wordt nooit gekaapt (scroll en pull-to-refresh blijven werken).
 * jsdom heeft geen `Touch`-constructor: de touches-lijst wordt zelf op het
 * event gezet.
 */

let root: Root | null = null;
let laatste: MaandVeeg | null = null;
const onVorige = vi.fn();
const onVolgende = vi.fn();

function Harnas() {
  laatste = useMaandVeeg({ onVorige, onVolgende });
  return <div ref={laatste.ref} data-testid="veeg" style={{ width: 300 }} />;
}

const el = () => document.querySelector<HTMLDivElement>('[data-testid="veeg"]')!;

function touch(type: 'touchstart' | 'touchmove' | 'touchend', x: number, y: number) {
  const e = new TouchEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  el().dispatchEvent(e);
  return e;
}

/** Vinger neer op (0,0) en dan in stappen naar (dx,dy). */
function sleep(dx: number, dy: number) {
  touch('touchstart', 0, 0);
  const stappen = 4;
  const events: TouchEvent[] = [];
  for (let i = 1; i <= stappen; i++) events.push(touch('touchmove', (dx * i) / stappen, (dy * i) / stappen));
  touch('touchend', dx, dy);
  return events;
}

beforeEach(async () => {
  vi.useFakeTimers();
  onVorige.mockReset();
  onVolgende.mockReset();
  // De hook bindt alleen op touch-toestellen.
  Object.defineProperty(window, 'ontouchstart', { value: null, configurable: true });
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Harnas />); });
  // jsdom meet niets: een breedte voor de cap (40 % van 300 = 120 px).
  Object.defineProperty(el(), 'clientWidth', { value: 300, configurable: true });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  document.body.innerHTML = '';
  vi.useRealTimers();
  delete (window as { ontouchstart?: unknown }).ontouchstart;
});

describe('useMaandVeeg', () => {
  it('veegt naar links boven de drempel: volgende maand, richting 1, via veeg', async () => {
    await act(async () => { sleep(-(VEEG_DREMPEL + 20), 2); });
    // Doorveren: eerst de transform voorbij de loslaatpositie, dan (na DUR.fast) de wissel.
    expect(el().style.transform).toMatch(/translateX\(-/);
    expect(el().style.opacity).toBe('0');
    expect(onVolgende).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(onVolgende).toHaveBeenCalledTimes(1);
    expect(onVorige).not.toHaveBeenCalled();
    expect(laatste!.richting).toBe(1);
    expect(laatste!.viaVeeg).toBe(true);
    // Transform weer vrij zodat de nieuwe maand op 0 binnenkomt.
    expect(el().style.transform).toBe('');
    expect(el().style.opacity).toBe('');
  });

  it('veegt naar rechts boven de drempel: vorige maand, richting −1', async () => {
    await act(async () => { sleep(VEEG_DREMPEL + 20, -3); vi.advanceTimersByTime(200); });
    expect(onVorige).toHaveBeenCalledTimes(1);
    expect(laatste!.richting).toBe(-1);
  });

  it('onder de drempel veert de inhoud terug zonder wissel', async () => {
    await act(async () => { sleep(-30, 0); vi.advanceTimersByTime(300); });
    expect(onVolgende).not.toHaveBeenCalled();
    expect(onVorige).not.toHaveBeenCalled();
    expect(el().style.transform).toBe('');
    expect(el().style.transition).toContain('var(--ease-standard)');
  });

  it('beweegt getemperd mee met een cap van 40 % van de breedte', async () => {
    touch('touchstart', 0, 0);
    touch('touchmove', -20, 0); // richting bepaald: horizontaal
    expect(el().style.transform).toBe('translateX(-12px)'); // 20 × 0,6
    touch('touchmove', -1000, 0);
    expect(el().style.transform).toBe('translateX(-120px)'); // cap 300 × 0,4
    await act(async () => { touch('touchend', -1000, 0); vi.advanceTimersByTime(200); });
  });

  it('kaapt een verticale beweging nooit: geen transform, geen preventDefault, geen wissel', async () => {
    let events: TouchEvent[] = [];
    await act(async () => { events = sleep(8, 120); vi.advanceTimersByTime(300); });
    expect(el().style.transform).toBe('');
    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
    expect(onVolgende).not.toHaveBeenCalled();
    expect(onVorige).not.toHaveBeenCalled();
  });

  it('een diagonale start die verticaal wint, blijft losgelaten voor de rest van de veeg', async () => {
    touch('touchstart', 0, 0);
    touch('touchmove', 5, 10); // verticaal wint → losgelaten
    const later = touch('touchmove', 90, 12); // daarna horizontaal: te laat, niet meer kapen
    expect(later.defaultPrevented).toBe(false);
    expect(el().style.transform).toBe('');
    await act(async () => { touch('touchend', 90, 12); vi.advanceTimersByTime(300); });
    expect(onVolgende).not.toHaveBeenCalled();
    expect(onVorige).not.toHaveBeenCalled();
  });

  it('horizontaal slepen roept preventDefault aan (geen scroll-chaining) zodra de richting vaststaat', () => {
    touch('touchstart', 0, 0);
    const eerste = touch('touchmove', 3, 1); // binnen de slop: nog niets
    expect(eerste.defaultPrevented).toBe(false);
    const tweede = touch('touchmove', 30, 2);
    expect(tweede.defaultPrevented).toBe(true);
    touch('touchend', 30, 2);
  });

  it('de pijltjes zetten de richting zonder veeg', async () => {
    await act(async () => { laatste!.vorige(); });
    expect(onVorige).toHaveBeenCalledTimes(1);
    expect(laatste!.richting).toBe(-1);
    expect(laatste!.viaVeeg).toBe(false);
    await act(async () => { laatste!.volgende(); });
    expect(onVolgende).toHaveBeenCalledTimes(1);
    expect(laatste!.richting).toBe(1);
  });
});
