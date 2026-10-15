import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ apiJson }));

import { useArchief, useToonMeerMetArchief } from './archief';

const reeks = (van: number, tot: number, voorvoegsel = 'a') => Array.from({ length: tot - van }, (_, i) => ({ id: `${voorvoegsel}${van + i}` }));

/** Een archief van `totaal` records op de server, per pagina zoals GET /api/swaps/archief. */
const server = (totaal: number) => {
  const alle = reeks(0, totaal);
  apiJson.mockImplementation(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams;
    const vanaf = Number(q.get('vanaf'));
    const aantal = Number(q.get('aantal'));
    return { ruilen: alle.slice(vanaf, vanaf + aantal), totaal };
  });
};

beforeEach(() => { apiJson.mockReset(); });

describe('useArchief', () => {
  it('haalt meteen de eerste pagina, met het totaal, en de volgende op vraag', async () => {
    server(23);
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.totaal).toBe(23));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=0&aantal=10');
    expect(result.current.items).toHaveLength(10);
    await act(async () => { await result.current.laadVolgende(); });
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?vanaf=10&aantal=10');
    expect(result.current.items).toHaveLength(20);
  });

  it('een filter in het pad begint opnieuw; een laat antwoord op het oude pad telt niet', async () => {
    let losLaten: (v: unknown) => void = () => {};
    apiJson.mockImplementationOnce(() => new Promise((r) => { losLaten = r; }));
    apiJson.mockImplementationOnce(async () => ({ ruilen: [{ id: 'p1' }], totaal: 1 }));
    const { result, rerender } = renderHook(({ pad }) => useArchief<{ id: string }>(pad, { veld: 'ruilen' }), { initialProps: { pad: '/api/swaps/archief' } });
    rerender({ pad: '/api/swaps/archief?persoon=4' });
    await waitFor(() => expect(result.current.totaal).toBe(1));
    expect(apiJson).toHaveBeenLastCalledWith('/api/swaps/archief?persoon=4&vanaf=0&aantal=10');
    await act(async () => { losLaten({ ruilen: [{ id: 'oud' }], totaal: 99 }); });
    expect(result.current.items.map((x) => x.id)).toEqual(['p1']);
    expect(result.current.totaal).toBe(1);
  });

  it('zonder pad geen archief en geen verzoek', () => {
    const { result } = renderHook(() => useArchief<{ id: string }>(null, { veld: 'ruilen' }));
    expect(result.current).toMatchObject({ actief: false, items: [], totaal: null, bezig: false });
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('zonder archief telt de lijst alleen het venster, met het totaal erbij', () => {
    const { result } = renderHook(() => useToonMeerMetArchief(reeks(0, 12, 'v'), useArchief<{ id: string }>(null, { veld: 'ruilen' })));
    expect(result.current).toMatchObject({ getoond: 10, totaal: 12, volgende: 2 });
  });

  it('een fout zet fout, en laadVolgende probeert de eerste pagina opnieuw', async () => {
    apiJson.mockRejectedValueOnce(new Error('netwerk'));
    const { result } = renderHook(() => useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' }));
    await waitFor(() => expect(result.current.fout).toBe(true));
    server(3);
    await act(async () => { await result.current.laadVolgende(); });
    expect(result.current).toMatchObject({ totaal: 3, fout: false });
    expect(result.current.items).toHaveLength(3);
  });
});

describe('useToonMeerMetArchief', () => {
  const opzet = (lokaal: { id: string }[], totaal: number) => {
    server(totaal);
    return renderHook(() => useToonMeerMetArchief(lokaal, useArchief<{ id: string }>('/api/swaps/archief', { veld: 'ruilen' })));
  };

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
});
