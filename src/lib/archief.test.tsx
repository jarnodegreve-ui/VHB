import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ apiJson }));

import { useArchief, useToonMeerMetArchief } from './archief';

const reeks = (van: number, tot: number, voorvoegsel = 'a') => Array.from({ length: tot - van }, (_, i) => ({ id: `${voorvoegsel}${van + i}` }));

/** Een archief op de server, per pagina zoals GET /api/swaps/archief. `alle`
 *  mag de test intussen wijzigen (een ruil die het archief in schuift). */
const server = (totaal: number, grens = '2026-07-01') => {
  const stand = { alle: reeks(0, totaal), grens };
  apiJson.mockImplementation(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams;
    const vanaf = Number(q.get('vanaf'));
    const aantal = Number(q.get('aantal'));
    return { ruilen: stand.alle.slice(vanaf, vanaf + aantal), totaal: stand.alle.length, grens: stand.grens };
  });
  return stand;
};

/** Een antwoord dat pas komt als de test het loslaat. */
const vasthouden = () => {
  let los: (v: unknown) => void = () => {};
  apiJson.mockImplementationOnce(() => new Promise((r) => { los = r; }));
  return (v: unknown) => los(v);
};

beforeEach(() => { apiJson.mockReset(); });

describe('useArchief', () => {
  it('haalt meteen de eerste pagina, met het totaal, en de volgende op vraag', async () => {
    server(23);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(23));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=0&aantal=10');
    expect(result.current.items).toHaveLength(10);
    act(() => { result.current.laadVolgende(); });
    await waitFor(() => expect(result.current.items).toHaveLength(20));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=10&aantal=10');
  });

  it('is bezig vanaf de eerste render: nooit één render lang "niets en klaar"', () => {
    server(3);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    expect(result.current).toMatchObject({ bezig: true, totaal: null, fout: false });
  });

  it('een filter in het pad begint opnieuw; een laat antwoord op het oude pad telt niet', async () => {
    const losLaten = vasthouden();
    apiJson.mockImplementationOnce(async () => ({ ruilen: [{ id: 'p1' }], totaal: 1 }));
    const { result, rerender } = renderHook(({ pad }) => useArchief<{ id: string }>(pad, { veld: 'ruilen' }), { initialProps: { pad: '/api/swaps/archief' } });
    rerender({ pad: '/api/swaps/archief?persoon=4' });
    await waitFor(() => expect(result.current.totaal).toBe(1));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?persoon=4&vanaf=0&aantal=10');
    await act(async () => { losLaten({ ruilen: [{ id: 'oud' }], totaal: 99 }); });
    expect(result.current.items.map((x) => x.id)).toEqual(['p1']);
    expect(result.current.totaal).toBe(1);
  });

  it('A → B → A: een pagina van de eerste A die nog onderweg was, telt niet mee', async () => {
    const stand = server(30);
    const { result, rerender } = renderHook(({ pad }) => useArchief<{ id: string }>(pad, { veld: 'ruilen' }), { initialProps: { pad: '/api/swaps/archief' } });
    await waitFor(() => expect(result.current.totaal).toBe(30));
    const losLaten = vasthouden();
    act(() => { result.current.laadVolgende(); });
    rerender({ pad: '/api/swaps/archief?persoon=4' });
    rerender({ pad: '/api/swaps/archief' });
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual(stand.alle.slice(0, 10).map((x) => x.id)));
    await act(async () => { losLaten({ ruilen: stand.alle.slice(10, 20), totaal: 30, grens: stand.grens }); });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.items[0].id).toBe('a0');
  });

  it('zonder pad geen archief en geen verzoek', () => {
    const { result } = renderHook(() => useArchief<{ id: string }>(null, { veld: 'ruilen' }));
    expect(result.current).toMatchObject({ actief: false, items: [], totaal: null, bezig: false });
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('een fout zet fout, en laadVolgende probeert de eerste pagina opnieuw', async () => {
    apiJson.mockRejectedValueOnce(new Error('netwerk'));
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.fout).toBe(true));
    server(3);
    act(() => { result.current.laadVolgende(); });
    await waitFor(() => expect(result.current).toMatchObject({ totaal: 3, fout: false }));
    expect(result.current.items).toHaveLength(3);
  });

  it('schoof er iets het archief in, dan begint het opnieuw van voren met zoveel als er stond', async () => {
    const stand = server(25);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(25));
    // Een beslissing zet een ruil bovenaan het archief: alles schuift één plaats op.
    stand.alle = [{ id: 'nieuw' }, ...stand.alle];
    act(() => { result.current.laadVolgende(); });
    await waitFor(() => expect(result.current.totaal).toBe(26));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=0&aantal=20');
    expect(result.current.items.map((x) => x.id)).toEqual(stand.alle.slice(0, 20).map((x) => x.id));
    // En daarna loopt het gewoon verder tot het einde.
    act(() => { result.current.laadVolgende(); });
    await waitFor(() => expect(result.current.items).toHaveLength(26));
  });

  it('een andere grens (de maand verschoof) begint ook opnieuw', async () => {
    const stand = server(25);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(25));
    stand.grens = '2026-08-01';
    act(() => { result.current.laadVolgende(); });
    await waitFor(() => expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=0&aantal=20'));
  });

  it('een pagina zonder iets nieuws terwijl er nog moeten zijn, begint opnieuw in plaats van te blijven hangen', async () => {
    const stand = server(15);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(15));
    // Zelfde totaal, maar de server geeft wat er al stond (records wisselden van plaats).
    apiJson.mockImplementationOnce(async () => ({ ruilen: stand.alle.slice(0, 5), totaal: 15, grens: stand.grens }));
    act(() => { result.current.laadVolgende(); });
    await waitFor(() => expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=0&aantal=20'));
    await waitFor(() => expect(result.current.items).toHaveLength(15));
  });

  it('herlaad vraagt opnieuw van voren en laat de lijst intussen staan', async () => {
    server(25);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(25));
    const losLaten = vasthouden();
    act(() => { result.current.herlaad(); });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.bezig).toBe(true);
    await act(async () => { losLaten({ ruilen: [{ id: 'x' }], totaal: 1, grens: '2026-07-01' }); });
    expect(result.current.items.map((x) => x.id)).toEqual(['x']);
  });
});

describe('useArchief: herstarten (tegenlezing ronde 2)', () => {
  it('een mislukte herstart probeert "opnieuw" exact die herstart, ook als alles al geladen was', async () => {
    server(3);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    apiJson.mockRejectedValueOnce(new Error('netwerk'));
    act(() => { result.current.herlaad(); });
    await waitFor(() => expect(result.current.fout).toBe(true));
    const vragen = apiJson.mock.calls.length;
    act(() => { result.current.laadVolgende(); });
    await waitFor(() => expect(apiJson.mock.calls.length).toBe(vragen + 1));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=0&aantal=10');
    await waitFor(() => expect(result.current.fout).toBe(false));
  });

  it('een herstart vult aan tot zoveel als er stond, ook boven de 50 per vraag', async () => {
    server(80);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(80));
    for (let i = 0; i < 6; i += 1) {
      const voor = result.current.items.length;
      act(() => { result.current.laadVolgende(); });
      await waitFor(() => expect(result.current.items.length).toBe(voor + 10));
    }
    expect(result.current.items).toHaveLength(70);
    act(() => { result.current.herlaad(); });
    await waitFor(() => expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=50&aantal=20'));
    await waitFor(() => expect(result.current.bezig).toBe(false));
    expect(result.current.items).toHaveLength(70);
  });

  it('na het sluiten van het scherm start een laat antwoord geen nieuwe vraag meer', async () => {
    const stand = server(25);
    const { result, unmount } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(25));
    const losLaten = vasthouden();
    act(() => { result.current.laadVolgende(); });
    unmount();
    const vragen = apiJson.mock.calls.length;
    // Een antwoord met een ander totaal zou anders een herstart vragen.
    await act(async () => { losLaten({ ruilen: stand.alle.slice(10, 20), totaal: 26, grens: stand.grens }); });
    expect(apiJson.mock.calls.length).toBe(vragen);
  });
});

describe('useToonMeerMetArchief', () => {
  const opzet = (lokaal: { id: string }[], totaal: number) => {
    server(totaal);
    return renderHook(() => useToonMeerMetArchief(lokaal, useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' })));
  };

  it('zonder archief telt de lijst alleen het venster, met het totaal erbij', () => {
    const { result } = renderHook(() => useToonMeerMetArchief(reeks(0, 12, 'v'), useArchief<{ id: string }>(null, { veld: 'ruilen' })));
    expect(result.current).toMatchObject({ getoond: 10, totaal: 12, volgende: 2, leeg: null });
  });

  it('eerst het venster, dan het archief, tien per stap, met het totaal van beide', async () => {
    const { result } = opzet(reeks(0, 4, 'v'), 23);
    // Het venster heeft er vier; de eerste pagina van het archief vult aan tot tien.
    await waitFor(() => expect(result.current.totaal).toBe(27));
    expect(result.current.zichtbaar.map((x) => x.id)).toEqual(['v0', 'v1', 'v2', 'v3', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
    expect(result.current.volgende).toBe(10);
    // De volgende stap vraagt meer dan er geladen is: een nieuwe pagina.
    act(() => { result.current.meer(); });
    await waitFor(() => expect(result.current.getoond).toBe(20));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=10&aantal=10');
    act(() => { result.current.meer(); });
    await waitFor(() => expect(result.current.getoond).toBe(27));
    expect(result.current.volgende).toBe(0);
  });

  it('een record dat ook in het venster staat telt één keer', async () => {
    const { result } = opzet([{ id: 'a0' }, { id: 'v1' }], 3);
    await waitFor(() => expect(result.current.totaal).toBe(4));
    expect(result.current.zichtbaar.map((x) => x.id)).toEqual(['a0', 'v1', 'a1', 'a2']);
    expect(result.current.volgende).toBe(0);
  });

  it('niets in beeld: eerst laden, dan leeg; een laadfout is nooit leeg', async () => {
    const { result } = opzet([], 0);
    expect(result.current.leeg).toBe('laden');
    await waitFor(() => expect(result.current.leeg).toBe('leeg'));

    apiJson.mockReset();
    apiJson.mockRejectedValueOnce(new Error('netwerk'));
    const fout = renderHook(() => useToonMeerMetArchief([], useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' })));
    await waitFor(() => expect(fout.result.current.leeg).toBe('fout'));
    // De knop staat er en probeert opnieuw.
    expect(fout.result.current).toMatchObject({ fout: true, volgende: 10 });
    server(2);
    act(() => { fout.result.current.meer(); });
    await waitFor(() => expect(fout.result.current.leeg).toBeNull());
    expect(fout.result.current.zichtbaar.map((x) => x.id)).toEqual(['a0', 'a1']);
  });

  it('mislukt de eerste pagina, dan blijft de knop staan en probeert ze opnieuw', async () => {
    apiJson.mockRejectedValueOnce(new Error('netwerk'));
    const { result } = renderHook(() => useToonMeerMetArchief([{ id: 'v0' }], useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' })));
    await waitFor(() => expect(result.current.fout).toBe(true));
    expect(result.current.volgende).toBeGreaterThan(0);
    server(2);
    act(() => { result.current.meer(); });
    await waitFor(() => expect(result.current.totaal).toBe(3));
    expect(result.current.zichtbaar.map((x) => x.id)).toEqual(['v0', 'a0', 'a1']);
  });

  it('een mislukte volgende pagina: eerst wat al klaarstaat, pas daarna "opnieuw", zonder sprong na het herstel', async () => {
    const stand = server(25);
    const { result } = opzet(reeks(0, 5, 'v'), 25);
    await waitFor(() => expect(result.current.totaal).toBe(30));
    // Venster 5 + archief 10 geladen, 10 in beeld. De volgende stap vraagt pagina 2, die mislukt.
    apiJson.mockRejectedValueOnce(new Error('netwerk'));
    act(() => { result.current.meer(); });
    await waitFor(() => expect(result.current.getoond).toBe(15));
    // Alles wat geladen is staat in beeld: nu pas probeert de knop opnieuw, en een tik toont niets extra.
    await waitFor(() => expect(result.current.fout).toBe(true));
    act(() => { result.current.meer(); });
    // De tik vroeg alleen de mislukte pagina opnieuw; daarna staan er 20, niet 30.
    await waitFor(() => expect(result.current.getoond).toBe(20));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=10&aantal=10');
    expect(result.current.fout).toBe(false);
    expect(stand.alle).toHaveLength(25);
  });

  it('mislukt de herstart na een record dat het venster verliet, dan is het "fout" met de knop, nooit "leeg"', async () => {
    server(0);
    const archiefOpzet = (lokaal: { id: string }[]) => useToonMeerMetArchief(lokaal, useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    const { result, rerender } = renderHook(({ lokaal }) => archiefOpzet(lokaal), { initialProps: { lokaal: [{ id: 'v0' }] } });
    await waitFor(() => expect(result.current.totaal).toBe(1));
    apiJson.mockRejectedValueOnce(new Error('netwerk'));
    rerender({ lokaal: [] });
    await waitFor(() => expect(result.current.leeg).toBe('fout'));
    expect(result.current).toMatchObject({ fout: true, volgende: 10 });
  });

  it('verdwijnt een record uit het venster, dan begint het archief opnieuw van voren', async () => {
    server(12);
    const archiefOpzet = (lokaal: { id: string }[]) => useToonMeerMetArchief(lokaal, useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    const { result, rerender } = renderHook(({ lokaal }) => archiefOpzet(lokaal), { initialProps: { lokaal: reeks(0, 3, 'v') } });
    await waitFor(() => expect(result.current.totaal).toBe(15));
    const aantalVragen = apiJson.mock.calls.length;
    // Een nieuw record in het venster: niets te doen.
    rerender({ lokaal: reeks(0, 4, 'v') });
    expect(apiJson.mock.calls.length).toBe(aantalVragen);
    // Eén record verlaat het venster: opnieuw van voren.
    rerender({ lokaal: reeks(1, 4, 'v') });
    await waitFor(() => expect(apiJson.mock.calls.length).toBe(aantalVragen + 1));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=0&aantal=10');
  });

  it('een ander filter (sleutel) telt niet als een record dat vertrok: alleen de vraag van het nieuwe pad', async () => {
    server(12);
    const { result, rerender } = renderHook(({ persoon, lokaal }) => useToonMeerMetArchief(
      lokaal,
      useArchief<{ id: string }>(`/api/swaps/archief${persoon ? `?persoon=${persoon}` : ''}`, { veld: 'ruilen' }),
      { sleutel: persoon },
    ), { initialProps: { persoon: '', lokaal: reeks(0, 3, 'v') } });
    await waitFor(() => expect(result.current.totaal).toBe(15));
    const aantalVragen = apiJson.mock.calls.length;
    rerender({ persoon: '4', lokaal: reeks(0, 1, 'v') });
    await waitFor(() => expect(result.current.totaal).toBe(13));
    expect(apiJson.mock.calls.length).toBe(aantalVragen + 1);
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?persoon=4&vanaf=0&aantal=10');
  });
});
