import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TOON_MEER_STAP, useToonMeer } from './ToonMeer';

const reeks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}` }));

/**
 * "Toon meer" onder lijsten die met de historiek groeien (Jarno 15-10): eerst
 * tien, dan telkens tien erbij; andere filters beginnen opnieuw, en een link
 * naar een record verderop toont de lijst tot en met dat record.
 */
describe('useToonMeer', () => {
  it('toont eerst tien en zet er per tik tien bij, tot alles er staat', () => {
    const items = reeks(23);
    const { result } = renderHook(() => useToonMeer(items));
    expect(TOON_MEER_STAP).toBe(10);
    expect(result.current.zichtbaar.map((r) => r.id)).toEqual(items.slice(0, 10).map((r) => r.id));
    expect(result.current).toMatchObject({ getoond: 10, totaal: 23, volgende: 10 });

    act(() => { result.current.meer(); });
    expect(result.current).toMatchObject({ getoond: 20, volgende: 3 });

    act(() => { result.current.meer(); });
    expect(result.current).toMatchObject({ getoond: 23, volgende: 0 });
    expect(result.current.zichtbaar).toHaveLength(23);
  });

  it('een korte lijst staat er meteen helemaal, zonder knop', () => {
    const { result } = renderHook(() => useToonMeer(reeks(4)));
    expect(result.current).toMatchObject({ getoond: 4, totaal: 4, volgende: 0 });
  });

  it('andere filters (sleutel) beginnen weer bij de eerste tien', () => {
    const items = reeks(40);
    const { result, rerender } = renderHook(({ sleutel }) => useToonMeer(items, { sleutel }), { initialProps: { sleutel: 'alle' } });
    act(() => { result.current.meer(); });
    act(() => { result.current.meer(); });
    expect(result.current.getoond).toBe(30);

    rerender({ sleutel: 'lijn 50' });
    expect(result.current.getoond).toBe(10);
    // Terug naar de vorige filter is ook een wissel: weer tien.
    rerender({ sleutel: 'alle' });
    expect(result.current.getoond).toBe(10);
  });

  it('een link naar een record verderop toont de lijst tot en met dat record, op een hele stap', () => {
    const items = reeks(40);
    const { result, rerender } = renderHook(({ doelId }: { doelId: string | null }) => useToonMeer(items, { doel: doelId ? (r) => r.id === doelId : undefined }), { initialProps: { doelId: 'r26' as string | null } });
    expect(result.current.getoond).toBe(30);
    expect(result.current.zichtbaar.some((r) => r.id === 'r26')).toBe(true);

    // De link valt weg (paneel dicht): de lijst krimpt niet onder de lezer weg.
    rerender({ doelId: null });
    expect(result.current.getoond).toBe(30);
  });

  it('een link naar een record dat al in beeld staat verandert niets', () => {
    const { result } = renderHook(() => useToonMeer(reeks(40), { doel: (r) => r.id === 'r3' }));
    expect(result.current.getoond).toBe(10);
  });

  it('begin en stap mogen verschillen (de jongste vorige ritbladen, dan vijf tegelijk)', () => {
    const items = reeks(12);
    const { result } = renderHook(() => useToonMeer(items, { begin: 1, stap: 5 }));
    expect(result.current).toMatchObject({ getoond: 1, volgende: 5 });
    act(() => { result.current.meer(); });
    expect(result.current).toMatchObject({ getoond: 6, volgende: 5 });
    act(() => { result.current.meer(); });
    act(() => { result.current.meer(); });
    expect(result.current).toMatchObject({ getoond: 12, volgende: 0 });
  });

  it('een link met een afwijkend begin rondt af vanaf dat begin', () => {
    const { result } = renderHook(() => useToonMeer(reeks(12), { begin: 1, stap: 5, doel: (r) => r.id === 'r8' }));
    // 1 + 5 = 6 is te weinig voor het achtste, 1 + 10 = 11 volstaat.
    expect(result.current.getoond).toBe(11);
  });

  it('krimpt de lijst, dan telt getoond mee en verdwijnt de knop', () => {
    const { result, rerender } = renderHook(({ n }) => useToonMeer(reeks(n)), { initialProps: { n: 25 } });
    act(() => { result.current.meer(); });
    expect(result.current.getoond).toBe(20);
    rerender({ n: 12 });
    expect(result.current).toMatchObject({ getoond: 12, totaal: 12, volgende: 0 });
  });
});
