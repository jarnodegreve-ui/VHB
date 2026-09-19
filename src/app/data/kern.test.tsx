import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { antwoordAfdruk, antwoordDatum, antwoordUitCache, useCollectieState, useStabieleActies } from './kern';

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

/**
 * Gelijkheidscheck in de datalaag (ronde 3, 19-09): een GET met ongewijzigde
 * inhoud mag geen setState (en dus geen tree-render) geven.
 */
describe('antwoordAfdruk', () => {
  const antwoord = (etag: string | null, url = 'https://x.test/api/leave') =>
    ({ url, headers: new Headers(etag ? { etag } : {}) }) as Pick<Response, 'headers' | 'url'>;

  it('gebruikt de ETag (met de URL) als die er is, ongeacht de payload', () => {
    expect(antwoordAfdruk(antwoord('W/"abc"'), [1])).toBe(antwoordAfdruk(antwoord('W/"abc"'), [2]));
    expect(antwoordAfdruk(antwoord('W/"abc"'), [1])).not.toBe(antwoordAfdruk(antwoord('W/"def"'), [1]));
    // Zelfde ETag op een andere URL (ander filter) is niet hetzelfde antwoord.
    expect(antwoordAfdruk(antwoord('W/"abc"'), [1])).not.toBe(antwoordAfdruk(antwoord('W/"abc"', 'https://x.test/api/planning?month=2026-09'), [1]));
  });

  it('valt zonder ETag terug op de geserialiseerde payload', () => {
    expect(antwoordAfdruk(antwoord(null), [{ id: '1', a: 1 }])).toBe(antwoordAfdruk(null, [{ id: '1', a: 1 }]));
    expect(antwoordAfdruk(null, [{ id: '1', a: 1 }])).not.toBe(antwoordAfdruk(null, [{ id: '1', a: 2 }]));
  });
});

describe('useCollectieState', () => {
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

  type Rij = { id: string; n: number };
  type Api = { waarde: Rij[]; zet: React.Dispatch<React.SetStateAction<Rij[]>>; uit: (payload: Rij[]) => boolean };

  const monteer = () => {
    const renders: Rij[][] = [];
    const api = { current: null as Api | null };
    function Proef() {
      const [waarde, zet, zetUitAntwoord] = useCollectieState<Rij[]>([]);
      renders.push(waarde);
      api.current = { waarde, zet, uit: (payload) => zetUitAntwoord(null, payload, payload) };
      return null;
    }
    act(() => root.render(<Proef />));
    return { renders, api };
  };

  it('slaat de setState over bij een inhoudelijk gelijk antwoord en houdt de referentie', () => {
    const { renders, api } = monteer();
    let gezet = false;
    act(() => { gezet = api.current!.uit([{ id: 'a', n: 1 }]); });
    expect(gezet).toBe(true);
    const eerste = api.current!.waarde;
    const aantal = renders.length;
    // Nieuwe array, zelfde inhoud (zoals response.json() bij elke refetch).
    act(() => { gezet = api.current!.uit([{ id: 'a', n: 1 }]); });
    expect(gezet).toBe(false);
    expect(renders.length).toBe(aantal);
    expect(api.current!.waarde).toBe(eerste);
  });

  it('past een gewijzigd antwoord wel toe', () => {
    const { api } = monteer();
    act(() => { api.current!.uit([{ id: 'a', n: 1 }]); });
    let gezet = false;
    act(() => { gezet = api.current!.uit([{ id: 'a', n: 2 }]); });
    expect(gezet).toBe(true);
    expect(api.current!.waarde).toEqual([{ id: 'a', n: 2 }]);
  });

  it('een lokale wijziging maakt de afdruk ongeldig: hetzelfde serverantwoord herstelt daarna de waarheid', () => {
    const { api } = monteer();
    const server = [{ id: 'a', n: 1 }];
    act(() => { api.current!.uit(server); });
    // Optimistische stap (of overnemen na een save) wijkt af van de server…
    act(() => { api.current!.zet((prev) => prev.map((r) => ({ ...r, n: 99 }))); });
    expect(api.current!.waarde[0].n).toBe(99);
    // …en de refetch levert exact het oude antwoord (save teruggedraaid).
    let gezet = false;
    act(() => { gezet = api.current!.uit([{ id: 'a', n: 1 }]); });
    expect(gezet).toBe(true);
    expect(api.current!.waarde[0].n).toBe(1);
  });
});
