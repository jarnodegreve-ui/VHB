import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EIGEN_ACTIE_VENSTER_MS, LIVE_THROTTLE_MS, markeerEigenSchrijfactie, meldLive, resetLiveSignaal } from './liveSignaal';

/** Vangt de `vhb-toast`-events op die notify() op window afvuurt. */
const vang = () => {
  const toasts: Array<{ message: string; tone?: string }> = [];
  const handler = (e: Event) => toasts.push((e as CustomEvent).detail);
  window.addEventListener('vhb-toast', handler);
  return { toasts, stop: () => window.removeEventListener('vhb-toast', handler) };
};

describe('liveSignaal', () => {
  let stop: () => void;
  let toasts: Array<{ message: string; tone?: string }>;
  beforeEach(() => {
    resetLiveSignaal();
    ({ toasts, stop } = vang());
  });
  afterEach(() => stop());

  it('toont per collectie hooguit één toast per 10 s', () => {
    const t0 = 1_000_000;
    expect(meldLive('planning', t0)).toBe(true);
    expect(meldLive('planning', t0 + 500)).toBe(false);
    expect(meldLive('planning', t0 + LIVE_THROTTLE_MS - 1)).toBe(false);
    expect(meldLive('planning', t0 + LIVE_THROTTLE_MS)).toBe(true);
    expect(toasts.map((t) => t.message)).toEqual(['Planning bijgewerkt', 'Planning bijgewerkt']);
    expect(toasts.every((t) => t.tone === 'info')).toBe(true);
  });

  it('throttlet per collectie, niet globaal', () => {
    const t0 = 5_000_000;
    expect(meldLive('planning', t0)).toBe(true);
    expect(meldLive('verlof', t0 + 10)).toBe(true);
    expect(meldLive('ruil', t0 + 20)).toBe(true);
    expect(toasts.map((t) => t.message)).toEqual(['Planning bijgewerkt', 'Verlof bijgewerkt', 'Dienstruil bijgewerkt']);
  });

  it('zwijgt vlak na een eigen schrijfactie (de realtime-echo van je eigen opslag)', () => {
    const t0 = 9_000_000;
    markeerEigenSchrijfactie(t0);
    expect(meldLive('verlof', t0 + 1500)).toBe(false);
    expect(meldLive('verlof', t0 + EIGEN_ACTIE_VENSTER_MS)).toBe(true);
    expect(toasts).toHaveLength(1);
  });
});
