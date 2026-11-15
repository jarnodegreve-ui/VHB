import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abonneerNu, leesNu, leesVandaag, useNu, useVandaag } from './nu';

/**
 * De gedeelde klok (ronde 6, punt 21c). Wat hier vastligt: de tik valt op de
 * minuut, één timer voor alle luisteraars, niets blijft hangen zonder
 * luisteraars, terugkeer naar de app leest meteen opnieuw, en een scherm dat
 * na lange tijd opnieuw opent krijgt de minuut van nu.
 */
const om = (uur: number, minuut: number, seconde = 0, ms = 0, dag = 15) => new Date(2026, 10, dag, uur, minuut, seconde, ms);

let zichtbaar = true;
const zetZichtbaar = (aan: boolean) => {
  zichtbaar = aan;
  document.dispatchEvent(new Event('visibilitychange'));
};
const pageshow = () => window.dispatchEvent(new Event('pageshow'));
const focus = () => window.dispatchEvent(new Event('focus'));

const afmelders: Array<() => void> = [];
/** Abonneert buiten React en ruimt na de test vanzelf op. */
const luister = () => {
  const l = vi.fn();
  const af = abonneerNu(l);
  afmelders.push(af);
  return { l, af };
};

beforeEach(() => {
  zichtbaar = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (zichtbaar ? 'visible' : 'hidden') });
});
afterEach(() => {
  cleanup();
  afmelders.splice(0).forEach((af) => af());
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe('de tik', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(om(10, 0, 20));
  });

  it('valt op de minuutgrens en daarna elke minuut', () => {
    const { l } = luister();
    const eerst = leesNu();
    expect([eerst.getHours(), eerst.getMinutes()]).toEqual([10, 0]);

    vi.advanceTimersByTime(39_999);
    expect(l).not.toHaveBeenCalled();
    expect(leesNu(), 'binnen de minuut hetzelfde object').toBe(eerst);

    vi.advanceTimersByTime(1);
    expect(l).toHaveBeenCalledTimes(1);
    expect(leesNu()).not.toBe(eerst);
    expect(leesNu().getTime()).toBe(om(10, 1).getTime());

    vi.advanceTimersByTime(59_999);
    expect(l).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(l).toHaveBeenCalledTimes(2);
    expect(leesNu().getTime()).toBe(om(10, 2).getTime());
  });

  it('twee luisteraars delen één timer en één stel gebeurtenisluisteraars', () => {
    const opDocument = vi.spyOn(document, 'addEventListener');
    const opWindow = vi.spyOn(window, 'addEventListener');
    const a = luister();
    const b = luister();

    expect(vi.getTimerCount()).toBe(1);
    expect(opDocument.mock.calls.map((c) => c[0])).toEqual(['visibilitychange']);
    expect(opWindow.mock.calls.map((c) => c[0])).toEqual(['pageshow', 'focus']);

    vi.advanceTimersByTime(40_000);
    expect(a.l).toHaveBeenCalledTimes(1);
    expect(b.l).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('de laatste luisteraar weg: geen timer en geen gebeurtenisluisteraars meer', () => {
    const bij = [vi.spyOn(document, 'addEventListener'), vi.spyOn(window, 'addEventListener')];
    const weg = [vi.spyOn(document, 'removeEventListener'), vi.spyOn(window, 'removeEventListener')];
    const a = luister();
    const b = luister();

    a.af();
    expect(vi.getTimerCount(), 'de tweede luisteraar houdt de klok aan').toBe(1);
    expect(weg.flatMap((s) => s.mock.calls)).toEqual([]);

    b.af();
    expect(vi.getTimerCount()).toBe(0);
    // Precies wat opgehangen is, gaat weer weg: zelfde soort, zelfde functie.
    expect(weg[0].mock.calls.map((c) => [c[0], c[1]])).toEqual(bij[0].mock.calls.map((c) => [c[0], c[1]]));
    expect(weg[1].mock.calls.map((c) => [c[0], c[1]])).toEqual(bij[1].mock.calls.map((c) => [c[0], c[1]]));

    // Een tweede afmelding en wat er daarna nog gebeurt, raakt niets meer.
    a.af();
    b.af();
    vi.setSystemTime(om(14, 30));
    zetZichtbaar(true);
    pageshow();
    focus();
    vi.advanceTimersByTime(180_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(a.l).not.toHaveBeenCalled();
    expect(b.l).not.toHaveBeenCalled();
  });

  it('geen update zonder minuutwissel, ook niet bij zichtbaar, pageshow of focus', () => {
    const { l } = luister();
    const eerst = leesNu();
    vi.advanceTimersByTime(10_000);
    zetZichtbaar(true);
    pageshow();
    focus();
    expect(l).not.toHaveBeenCalled();
    expect(leesNu()).toBe(eerst);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('een scherm dat tussendoor hertekent schuift de lezing op; de anderen horen de minuutwissel toch', () => {
    const { l } = luister();
    // De timer is te laat (trage telefoon): de minuut is om, er tikte nog niets.
    vi.setSystemTime(om(10, 1, 5));
    expect(leesNu().getMinutes(), 'wie nu hertekent leest de nieuwe minuut').toBe(1);
    expect(l).not.toHaveBeenCalled();
    focus();
    expect(l).toHaveBeenCalledTimes(1);
  });
});

describe('terug in de app', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(om(10, 0, 20));
  });

  it('verborgen tikt er niets; zichtbaar na een tijdsprong is één update en de tik lijnt opnieuw uit', () => {
    const { l } = luister();
    zetZichtbaar(false);
    expect(vi.getTimerCount(), 'geen timer in een verborgen tabblad').toBe(0);

    // Uren later, zonder dat er een timer liep (de app hing in de app-switcher).
    vi.setSystemTime(om(13, 47, 35));
    expect(l).not.toHaveBeenCalled();

    zetZichtbaar(true);
    pageshow();
    focus();
    expect(l, 'drie gebeurtenissen, één minuutwissel').toHaveBeenCalledTimes(1);
    expect([leesNu().getHours(), leesNu().getMinutes()]).toEqual([13, 47]);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(24_999);
    expect(l).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(l).toHaveBeenCalledTimes(2);
    expect(leesNu().getTime()).toBe(om(13, 48).getTime());
  });

  it('pageshow of focus alleen volstaat (een hervatte PWA meldt niet altijd visibilitychange)', () => {
    const { l } = luister();
    vi.setSystemTime(om(11, 30));
    pageshow();
    expect(l).toHaveBeenCalledTimes(1);
    expect(leesNu().getHours()).toBe(11);

    vi.setSystemTime(om(6, 0, 0, 0, 16));
    focus();
    expect(l).toHaveBeenCalledTimes(2);
    expect(leesVandaag()).toBe('2026-11-16');
  });

  it('een gebeurtenis in een verborgen tabblad start de tik niet opnieuw', () => {
    luister();
    zetZichtbaar(false);
    focus();
    pageshow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('een klok die terugspringt geeft ook een nieuwe lezing', () => {
    const { l } = luister();
    vi.setSystemTime(om(9, 0, 20));
    focus();
    expect(l).toHaveBeenCalledTimes(1);
    expect(leesNu().getHours()).toBe(9);
  });
});

describe('in een scherm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('useNu geeft binnen een minuut hetzelfde object en hertekent één keer per minuut', () => {
    vi.setSystemTime(om(10, 0, 20));
    let getekend = 0;
    const { result } = renderHook(() => { getekend += 1; return useNu(); });
    const eerst = result.current;
    expect(getekend).toBe(1);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(getekend).toBe(1);
    expect(result.current).toBe(eerst);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(getekend).toBe(2);
    expect(result.current.getTime()).toBe(om(10, 1).getTime());
  });

  it('de dagvariant tekent alleen bij een dagwissel', () => {
    vi.setSystemTime(om(23, 57, 30));
    let dagGetekend = 0;
    let nuGetekend = 0;
    const dag = renderHook(() => { dagGetekend += 1; return useVandaag(); });
    renderHook(() => { nuGetekend += 1; return useNu(); });
    expect(dag.result.current).toBe('2026-11-15');

    // 23:58 en 23:59: de klok tikt, de dag blijft.
    act(() => { vi.advanceTimersByTime(30_000); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(nuGetekend).toBe(3);
    expect(dagGetekend).toBe(1);

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(nuGetekend).toBe(4);
    expect(dagGetekend).toBe(2);
    expect(dag.result.current).toBe('2026-11-16');
  });

  it('laatste luisteraar weg, een uur later een nieuwe: de eerste lezing is de minuut van nu', () => {
    vi.setSystemTime(om(10, 0, 20));
    const vroeger = renderHook(() => useNu());
    expect(vroeger.result.current.getHours()).toBe(10);
    vroeger.unmount();
    expect(vi.getTimerCount()).toBe(0);

    vi.setSystemTime(om(11, 0, 20));
    const gezien: string[] = [];
    renderHook(() => {
      const nu = useNu();
      gezien.push(`${nu.getHours()}:${nu.getMinutes()}`);
      return nu;
    });
    expect(gezien[0], 'nooit eerst de tijd van het vorige bezoek').toBe('11:0');
    expect(new Set(gezien)).toEqual(new Set(['11:0']));
  });

  it('idem voor de dag: na middernacht opnieuw geopend staat er nooit de dag van gisteren', () => {
    vi.setSystemTime(om(22, 30));
    const vroeger = renderHook(() => useVandaag());
    expect(vroeger.result.current).toBe('2026-11-15');
    vroeger.unmount();

    vi.setSystemTime(om(6, 0, 0, 0, 16));
    const gezien: string[] = [];
    renderHook(() => {
      const dag = useVandaag();
      gezien.push(dag);
      return dag;
    });
    expect(new Set(gezien)).toEqual(new Set(['2026-11-16']));
  });
});

describe('op een stilstaande klok (e2e met een vaste tijd)', () => {
  const GRENS = om(10, 0).getTime();

  for (const [naam, tijd] of [['op een minuutgrens', GRENS], ['1 ms voor een minuutgrens', GRENS - 1]] as const) {
    it(`${naam}: nooit een timer onder 1000 ms en geen rondjes`, () => {
      // Alleen de timers zijn nep: Date.now() staat stil, zoals page.clock.setFixedTime.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(Date, 'now').mockReturnValue(tijd);
      const gepland = vi.spyOn(globalThis, 'setTimeout');
      const { l } = luister();
      const eerst = leesNu();
      expect(eerst.getTime()).toBe(tijd);

      vi.advanceTimersByTime(10 * 60_000);
      const wachttijden = gepland.mock.calls.map((c) => Number(c[1]));
      expect(wachttijden.length).toBeGreaterThan(0);
      expect(Math.min(...wachttijden)).toBeGreaterThanOrEqual(1000);
      // Tien minuten: hoogstens één tik per seconde, plus de eerste planning.
      expect(wachttijden.length).toBeLessThanOrEqual(601);
      expect(l, 'de minuut wisselt niet, dus niemand hoort iets').not.toHaveBeenCalled();
      expect(leesNu(), 'altijd hetzelfde object').toBe(eerst);
      expect(vi.getTimerCount()).toBe(1);
    });

    it(`${naam}: een scherm tekent één keer`, () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(Date, 'now').mockReturnValue(tijd);
      let getekend = 0;
      const { result } = renderHook(() => { getekend += 1; return [useNu(), useVandaag()] as const; });
      act(() => { vi.advanceTimersByTime(10 * 60_000); });
      act(() => { zetZichtbaar(true); pageshow(); focus(); });
      expect(getekend).toBe(1);
      expect(result.current[0].getTime()).toBe(tijd);
      expect(result.current[1]).toBe('2026-11-15');
    });
  }
});
