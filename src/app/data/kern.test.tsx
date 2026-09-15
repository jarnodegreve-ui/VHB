import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { antwoordDatum, antwoordUitCache, useStabieleActies } from './kern';

/**
 * Stabiele acties en de cache-herkomst van antwoorden (punt 19, 15-09).
 */
describe('useStabieleActies', () => {
  let root: Root;
  let el: HTMLDivElement;
  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
  });

  it('houdt dezelfde functie-identiteit over renders en roept de laatste implementatie aan', () => {
    const gezien: Array<Record<string, (n: number) => number>> = [];
    function Proef({ factor }: { factor: number }) {
      const acties = useStabieleActies({ maal: (n: number) => n * factor });
      gezien.push(acties);
      return null;
    }
    act(() => root.render(<Proef factor={2} />));
    act(() => root.render(<Proef factor={3} />));
    expect(gezien).toHaveLength(2);
    expect(gezien[0]).toBe(gezien[1]);
    expect(gezien[0].maal).toBe(gezien[1].maal);
    // De wrapper is één object, maar spreekt de nieuwste closure aan.
    expect(gezien[1].maal(5)).toBe(15);
  });
});

describe('herkomst van een API-antwoord', () => {
  it('herkent de SW-cache-header en leest de Date', () => {
    const uitCache = new Response('[]', { headers: { 'x-vhb-bron': 'cache', date: 'Tue, 15 Sep 2026 06:12:00 GMT' } });
    const vers = new Response('[]', { headers: { date: 'Tue, 15 Sep 2026 06:12:00 GMT' } });
    expect(antwoordUitCache(uitCache)).toBe(true);
    expect(antwoordUitCache(vers)).toBe(false);
    expect(antwoordDatum(uitCache)).toBe(Date.parse('2026-09-15T06:12:00Z'));
    expect(antwoordDatum(new Response('[]'))).toBeNull();
  });
});
