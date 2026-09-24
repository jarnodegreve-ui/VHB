import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { z } from 'zod';
import { useVeldfouten, useVuil } from './formulier';

describe('useVeldfouten', () => {
  const schema = z.object({ naam: z.string().min(1), email: z.string().email() });

  it('controleer zet één tekst per veld en geeft null; bij succes de data en lege fouten', () => {
    const { result } = renderHook(() => useVeldfouten());
    let data: unknown;
    act(() => { data = result.current.controleer(schema, { naam: '', email: 'x' }); });
    expect(data).toBeNull();
    expect(Object.keys(result.current.fouten)).toEqual(['naam', 'email']);
    expect(result.current.heeftFouten).toBe(true);
    act(() => { data = result.current.controleer(schema, { naam: 'A', email: 'a@b.be' }); });
    expect(data).toEqual({ naam: 'A', email: 'a@b.be' });
    expect(result.current.fouten).toEqual({});
  });

  it('wisVeld haalt alleen dat veld weg; vanServer neemt 400-veldfouten over', () => {
    const { result } = renderHook(() => useVeldfouten());
    act(() => { result.current.zet({ naam: 'Vul in', email: 'Ongeldig' }); });
    act(() => { result.current.wisVeld('naam'); });
    expect(result.current.fouten).toEqual({ email: 'Ongeldig' });
    let had = false;
    act(() => { had = result.current.vanServer({ error: 'Ongeldige invoer', veldfouten: { email: 'Bestaat al' } }); });
    expect(had).toBe(true);
    expect(result.current.fouten).toEqual({ email: 'Bestaat al' });
    act(() => { had = result.current.vanServer({ error: 'Serverfout' }); });
    expect(had).toBe(false);
    act(() => { result.current.wis(); });
    expect(result.current.heeftFouten).toBe(false);
  });
});

describe('useVuil', () => {
  it('is schoon bij openen, vuil na een wijziging en weer schoon na markeerSchoon', () => {
    const { result, rerender } = renderHook(({ w, open }) => useVuil(w, open), { initialProps: { w: { naam: 'A' }, open: true } });
    expect(result.current.vuil).toBe(false);
    rerender({ w: { naam: 'B' }, open: true });
    expect(result.current.vuil).toBe(true);
    act(() => result.current.markeerSchoon());
    expect(result.current.vuil).toBe(false);
  });

  it('neemt een nieuwe momentopname als de overlay opnieuw opent', () => {
    const { result, rerender } = renderHook(({ w, open }) => useVuil(w, open), { initialProps: { w: { naam: 'A' }, open: false } });
    rerender({ w: { naam: 'B' }, open: false });
    expect(result.current.vuil).toBe(false); // dicht = nooit vuil
    rerender({ w: { naam: 'B' }, open: true });
    expect(result.current.vuil).toBe(false); // momentopname bij openen
    rerender({ w: { naam: 'C' }, open: true });
    expect(result.current.vuil).toBe(true);
  });

  it('een andere sleutel (ander record) begint schoon', () => {
    const { result, rerender } = renderHook(({ w, k }) => useVuil(w, true, k), { initialProps: { w: { naam: 'A' }, k: 1 } });
    rerender({ w: { naam: 'B' }, k: 1 });
    expect(result.current.vuil).toBe(true);
    rerender({ w: { naam: 'Z' }, k: 2 });
    expect(result.current.vuil).toBe(false);
  });

  it('geen enkele render van een net geopend formulier is vuil (anders vraagt een snelle terugknop om niets)', () => {
    const gezien: boolean[] = [];
    const { rerender } = renderHook(({ w, open, k }) => {
      const { vuil } = useVuil(w, open, k);
      gezien.push(vuil);
      return vuil;
    }, { initialProps: { w: { naam: '' }, open: false, k: null as string | null } });
    // Openen met een record: waarden, open en sleutel wisselen in één render.
    rerender({ w: { naam: 'Dienst 2515' }, open: true, k: '3' });
    expect(gezien.every((v) => v === false)).toBe(true);
  });
});
