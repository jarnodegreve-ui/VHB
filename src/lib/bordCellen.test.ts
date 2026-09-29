import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BordCellen } from './vervangers';

/**
 * De vervangerlijsten tonen geen kandidaten tot het bord er is (controle
 * 29-09): tijdens het laden gold de matrixregel, en stond wie een schoolrit
 * rijdt kort als vrij in de lijst.
 */
const antwoorden = new Map<string, { los: (v: unknown) => void; faal: (e: unknown) => void }>();
const gevraagd: string[] = [];
const bron = { data: null as null | { shifts: unknown; swaps: unknown } };

vi.mock('./monthPlanning', () => ({
  fetchMonthPlanning: (maand: string) => {
    gevraagd.push(maand);
    return new Promise((los, faal) => { antwoorden.set(maand, { los, faal }); });
  },
}));
vi.mock('../app/AppDataContext', () => ({ useOptioneleAppData: () => bron.data }));

const { leesBord, useBordCellen } = await import('./bordCellen');

const cellen = (code: string): BordCellen => ({ b: { '2026-07-24': { code, kind: 'service' } } });
const antwoord = async (maand: string, waarde: unknown) => { await act(async () => { antwoorden.get(maand)!.los(waarde); }); };
const fout = async (maand: string) => { await act(async () => { antwoorden.get(maand)!.faal(new Error('500')); }); };

beforeEach(() => { antwoorden.clear(); gevraagd.length = 0; bron.data = null; });
afterEach(() => { vi.clearAllMocks(); });

describe('leesBord', () => {
  const juli = cellen('EEK6');
  const lading = { sleutel: ['2026-07', 'p1', 'r1'], perMaand: { '2026-07': juli, '2026-08': null } };

  it('geeft de cellen van de maand, of null als die maand mislukte', () => {
    expect(leesBord(lading, ['2026-07', 'p1', 'r1'], '2026-07-24')).toBe(juli);
    expect(leesBord(lading, ['2026-07', 'p1', 'r1'], '2026-08-02')).toBeNull();
  });

  it('nog niets geladen, of geladen voor een andere vraag, is "laden"', () => {
    expect(leesBord(null, ['2026-07', 'p1', 'r1'], '2026-07-24')).toBeUndefined();
    expect(leesBord(lading, ['2026-08', 'p1', 'r1'], '2026-07-24')).toBeUndefined();
    expect(leesBord(lading, ['2026-07', 'p2', 'r1'], '2026-07-24')).toBeUndefined();
    expect(leesBord(lading, ['2026-07', 'p1', 'r2'], '2026-07-24')).toBeUndefined();
  });
});

describe('useBordCellen', () => {
  it('laadt: undefined tot het antwoord er is, daarna de cellen', async () => {
    const { result } = renderHook(() => useBordCellen(['2026-07-24', '2026-07-25']));
    expect(gevraagd).toEqual(['2026-07']);
    expect(result.current('2026-07-24')).toBeUndefined();
    await antwoord('2026-07', { cells: cellen('EEK6') });
    expect(result.current('2026-07-24')).toEqual(cellen('EEK6'));
  });

  it('mislukt: null, zodat de lijst op de matrixregel terugvalt', async () => {
    const { result } = renderHook(() => useBordCellen(['2026-07-24']));
    await fout('2026-07');
    expect(result.current('2026-07-24')).toBeNull();
  });

  it('een antwoord zonder cellen (lege lijst) telt als mislukt', async () => {
    const { result } = renderHook(() => useBordCellen(['2026-07-24']));
    await antwoord('2026-07', []);
    expect(result.current('2026-07-24')).toBeNull();
  });

  it('twee maanden: pas klaar als beide er zijn, elk met zijn eigen uitkomst', async () => {
    const { result } = renderHook(() => useBordCellen(['2026-07-31', '2026-08-01']));
    expect(gevraagd).toEqual(['2026-07', '2026-08']);
    await antwoord('2026-07', { cells: cellen('EEK6') });
    expect(result.current('2026-07-31')).toBeUndefined();
    await fout('2026-08');
    expect(result.current('2026-07-31')).toEqual(cellen('EEK6'));
    expect(result.current('2026-08-01')).toBeNull();
  });

  it('zonder dagen wordt er niets geladen', () => {
    renderHook(() => useBordCellen([]));
    expect(gevraagd).toEqual([]);
  });

  it('een andere maand: de cellen van de vorige blijven niet staan terwijl de nieuwe laadt', async () => {
    const { result, rerender } = renderHook(({ dagen }) => useBordCellen(dagen), { initialProps: { dagen: ['2026-07-24'] } });
    await antwoord('2026-07', { cells: cellen('EEK6') });
    rerender({ dagen: ['2026-08-03'] });
    // Meteen, nog vóór het nieuwe antwoord: niets van juli, ook niet voor juli zelf.
    expect(result.current('2026-08-03')).toBeUndefined();
    expect(result.current('2026-07-24')).toBeUndefined();
    await antwoord('2026-08', { cells: { b: { '2026-08-03': { code: 'vrij', kind: 'absence' } } } });
    expect(result.current('2026-08-03')).toEqual({ b: { '2026-08-03': { code: 'vrij', kind: 'absence' } } });
  });

  it('na een wissel (planning of ruilen gewijzigd): opnieuw laden, de oude cellen tellen niet meer', async () => {
    bron.data = { shifts: ['p1'], swaps: ['r1'] };
    const { result, rerender } = renderHook(() => useBordCellen(['2026-07-24']));
    await antwoord('2026-07', { cells: cellen('vrij') });
    expect(result.current('2026-07-24')).toEqual(cellen('vrij'));
    bron.data = { shifts: bron.data.shifts, swaps: ['r1', 'r2'] };
    rerender();
    expect(result.current('2026-07-24')).toBeUndefined();
    expect(gevraagd).toEqual(['2026-07', '2026-07']);
    await antwoord('2026-07', { cells: cellen('EEK6') });
    expect(result.current('2026-07-24')).toEqual(cellen('EEK6'));
  });

  it('een laat antwoord op een vorige vraag wordt genegeerd', async () => {
    bron.data = { shifts: ['p1'], swaps: ['r1'] };
    const { result, rerender } = renderHook(() => useBordCellen(['2026-07-24']));
    const eerste = antwoorden.get('2026-07')!;
    bron.data = { shifts: ['p2'], swaps: bron.data.swaps };
    rerender();
    await act(async () => { eerste.los({ cells: cellen('vrij') }); });
    expect(result.current('2026-07-24')).toBeUndefined();
    await antwoord('2026-07', { cells: cellen('EEK6') });
    expect(result.current('2026-07-24')).toEqual(cellen('EEK6'));
  });
});
