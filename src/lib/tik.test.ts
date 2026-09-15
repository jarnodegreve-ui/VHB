import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIK_MS, tik } from './tik';

/** Haptische tik: één trilling per soort, no-op zonder API of bij reduced motion. */
const zetVibrate = (impl?: (ms: number) => boolean) => {
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: impl });
};
const zetReducedMotion = (aan: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => ({ matches: aan && q.includes('reduce'), media: q })),
  });
};

describe('tik', () => {
  afterEach(() => {
    zetVibrate(undefined);
    zetReducedMotion(false);
  });

  it('trilt met de vaste duur per soort', () => {
    const vibrate = vi.fn().mockReturnValue(true);
    zetVibrate(vibrate);
    zetReducedMotion(false);
    expect(tik('drempel')).toBe(true);
    expect(tik('bulk')).toBe(true);
    expect(tik('ongedaan')).toBe(true);
    expect(vibrate.mock.calls.map((c) => c[0])).toEqual([TIK_MS.drempel, TIK_MS.bulk, TIK_MS.ongedaan]);
    expect(TIK_MS).toEqual({ drempel: 10, bulk: 15, ongedaan: 20 });
  });

  it('is een stille no-op zonder vibrate-API (iOS Safari)', () => {
    zetVibrate(undefined);
    zetReducedMotion(false);
    expect(tik('bulk')).toBe(false);
  });

  it('trilt niet bij prefers-reduced-motion', () => {
    const vibrate = vi.fn().mockReturnValue(true);
    zetVibrate(vibrate);
    zetReducedMotion(true);
    expect(tik('ongedaan')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('vangt een gooiende vibrate af', () => {
    zetVibrate(() => { throw new Error('geblokkeerd'); });
    zetReducedMotion(false);
    expect(tik('drempel')).toBe(false);
  });
});
