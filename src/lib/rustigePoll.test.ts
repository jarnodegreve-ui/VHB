// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRustigePoll } from './rustigePoll';

const MIN = 60_000;

const zetZichtbaarheid = (staat: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => staat });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('startRustigePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T08:00:00Z'));
    zetZichtbaarheid('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('haalt meteen op en daarna per interval', () => {
    const haal = vi.fn();
    const stop = startRustigePoll(haal);
    expect(haal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * MIN);
    expect(haal).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(30 * MIN);
    expect(haal).toHaveBeenCalledTimes(2);
  });

  it('focus ververst hooguit 1x per 5 min', () => {
    const haal = vi.fn();
    const stop = startRustigePoll(haal);
    for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event('focus'));
    expect(haal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4 * MIN);
    window.dispatchEvent(new Event('focus'));
    expect(haal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1 * MIN);
    window.dispatchEvent(new Event('focus'));
    expect(haal).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus'));
    expect(haal).toHaveBeenCalledTimes(2);
    stop();
  });

  it('het interval pauzeert in een verborgen tabblad en hervat bij tonen', () => {
    const haal = vi.fn();
    const stop = startRustigePoll(haal);
    zetZichtbaarheid('hidden');
    vi.advanceTimersByTime(60 * MIN);
    expect(haal).toHaveBeenCalledTimes(1);
    // Terug zichtbaar na een uur: meteen verversen (≥ 5 min oud) en het interval loopt weer.
    zetZichtbaarheid('visible');
    expect(haal).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10 * MIN);
    expect(haal).toHaveBeenCalledTimes(3);
    stop();
  });

  it('kort verborgen geweest: geen extra call bij terugkeer', () => {
    const haal = vi.fn();
    const stop = startRustigePoll(haal);
    zetZichtbaarheid('hidden');
    vi.advanceTimersByTime(2 * MIN);
    zetZichtbaarheid('visible');
    expect(haal).toHaveBeenCalledTimes(1);
    stop();
  });
});
