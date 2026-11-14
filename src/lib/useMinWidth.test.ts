import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MD_QUERY, useMedia, useMinWidth } from './useMinWidth';

/**
 * useMedia vraagt exact de gegeven query aan matchMedia en volgt ze live;
 * useMinWidth steunt erop en bouwt dezelfde px-query als vroeger, zodat zijn
 * aanroepers (Rooster, Dienstruil, DetailPaneel, …) niets merken. jsdom kent
 * matchMedia niet: elke test zet een eigen nep-versie met een schakelbare
 * stand per query.
 */
type Luisteraar = () => void;

function nepMatchMedia(begin: Record<string, boolean> = {}) {
  const stand = new Map(Object.entries(begin));
  const luisteraars = new Map<string, Set<Luisteraar>>();
  const gevraagd: string[] = [];
  const matchMedia = vi.fn((query: string) => {
    gevraagd.push(query);
    return {
      get matches() { return stand.get(query) ?? false; },
      media: query,
      addEventListener: (_soort: string, cb: Luisteraar) => {
        if (!luisteraars.has(query)) luisteraars.set(query, new Set());
        luisteraars.get(query)!.add(cb);
      },
      removeEventListener: (_soort: string, cb: Luisteraar) => { luisteraars.get(query)?.delete(cb); },
    };
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    gevraagd,
    /** Zet de stand van één query en meldt het zoals de browser (change). */
    zet(query: string, waarde: boolean) {
      stand.set(query, waarde);
      for (const cb of luisteraars.get(query) ?? []) cb();
    },
    aantalLuisteraars: (query: string) => luisteraars.get(query)?.size ?? 0,
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('MD_QUERY', () => {
  it('is de grens van md in rem, zoals Tailwind ze in de gebouwde CSS zet', () => {
    expect(MD_QUERY).toBe('(min-width: 48rem)');
  });
});

describe('useMedia', () => {
  it('vraagt exact de gegeven query, niets anders', () => {
    const mm = nepMatchMedia({ [MD_QUERY]: true });
    const { result } = renderHook(() => useMedia(MD_QUERY));
    expect(result.current).toBe(true);
    expect(mm.gevraagd.length).toBeGreaterThan(0);
    expect(new Set(mm.gevraagd)).toEqual(new Set([MD_QUERY]));
  });

  it('volgt de query live: een change zet de nieuwe stand, in beide richtingen', () => {
    const mm = nepMatchMedia({ [MD_QUERY]: false });
    const { result } = renderHook(() => useMedia(MD_QUERY));
    expect(result.current).toBe(false);
    act(() => mm.zet(MD_QUERY, true));
    expect(result.current).toBe(true);
    act(() => mm.zet(MD_QUERY, false));
    expect(result.current).toBe(false);
  });

  it('meldt zich af bij het ontkoppelen', () => {
    const mm = nepMatchMedia();
    const { unmount } = renderHook(() => useMedia(MD_QUERY));
    expect(mm.aantalLuisteraars(MD_QUERY)).toBe(1);
    unmount();
    expect(mm.aantalLuisteraars(MD_QUERY)).toBe(0);
  });

  it('een andere query wisselt het abonnement mee', () => {
    const mm = nepMatchMedia({ '(min-width: 40rem)': true, [MD_QUERY]: false });
    const { result, rerender } = renderHook(({ q }) => useMedia(q), { initialProps: { q: '(min-width: 40rem)' } });
    expect(result.current).toBe(true);
    rerender({ q: MD_QUERY });
    expect(result.current).toBe(false);
    expect(mm.aantalLuisteraars('(min-width: 40rem)')).toBe(0);
    expect(mm.aantalLuisteraars(MD_QUERY)).toBe(1);
  });
});

describe('useMinWidth', () => {
  it('useMinWidth(768) vraagt nog altijd (min-width: 768px), niet de rem-query', () => {
    const mm = nepMatchMedia({ '(min-width: 768px)': true });
    const { result } = renderHook(() => useMinWidth(768));
    expect(result.current).toBe(true);
    expect(new Set(mm.gevraagd)).toEqual(new Set(['(min-width: 768px)']));
  });

  it('bouwt de px-query voor elke aanroeper zoals vroeger en volgt ze live', () => {
    for (const px of [640, 1024, 1280]) {
      const mm = nepMatchMedia();
      const { result, unmount } = renderHook(() => useMinWidth(px));
      expect(result.current).toBe(false);
      act(() => mm.zet(`(min-width: ${px}px)`, true));
      expect(result.current).toBe(true);
      expect(new Set(mm.gevraagd)).toEqual(new Set([`(min-width: ${px}px)`]));
      unmount();
      vi.unstubAllGlobals();
    }
  });
});
