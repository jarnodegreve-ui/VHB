import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// useOnline pingt /api/health; hier sturen we de netwerkstatus zelf.
let online = true;
vi.mock('./useOnline', () => ({ useOnline: () => online }));

import { FOCUS_INTERVAL_MS, foutTekst, useZelfLadend, versheidTekst } from './zelfLadend';

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const wordZichtbaar = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  online = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T14:32:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useZelfLadend', () => {
  it('laadt bij mount, zet laden uit en onthoudt het tijdstip', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad));
    expect(result.current.laden).toBe(true);
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);
    expect(result.current.laden).toBe(false);
    expect(result.current.fout).toBeNull();
    expect(result.current.laatstGeladen).toBe(Date.now());
    expect(versheidTekst(result.current.versheid)).toBe('Bijgewerkt om 14:32');
  });

  it('zet de fout met de gekozen boodschap en wist hem bij opnieuw()', async () => {
    const laad = vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad, { boodschap: 'Kon het gele boek niet laden.' }));
    await flush();
    expect(result.current.fout).toBe('Kon het gele boek niet laden.');
    expect(result.current.laatstGeladen).toBeNull();

    await act(async () => { await result.current.opnieuw(); });
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.fout).toBeNull();
    expect(result.current.laatstGeladen).toBe(Date.now());
  });

  it('ververst stil bij terugkeer naar het tabblad, hooguit één keer per minuut', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad));
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);

    // Binnen het interval: niets.
    act(() => { vi.advanceTimersByTime(FOCUS_INTERVAL_MS / 2); wordZichtbaar(); });
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);

    // Erna: één stille verversing (geen skelet, wel nieuw tijdstip).
    act(() => { vi.advanceTimersByTime(FOCUS_INTERVAL_MS / 2); wordZichtbaar(); });
    expect(result.current.laden).toBe(false);
    await flush();
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.laatstGeladen).toBe(Date.now());
  });

  it('slaat de focus-verversing over zonder verbinding en laat de fout dan met rust', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() => useZelfLadend(laad));
    await flush();
    online = false;
    rerender();
    act(() => { vi.advanceTimersByTime(FOCUS_INTERVAL_MS + 1); wordZichtbaar(); });
    await flush();
    expect(laad).toHaveBeenCalledTimes(1);
    expect(versheidTekst(result.current.versheid)).toBe('Offline · Bijgewerkt om 14:32');

    // Verbinding terug: één stille verversing.
    online = true;
    rerender();
    await flush();
    expect(laad).toHaveBeenCalledTimes(2);
  });

  it('negeert een oud antwoord dat na een deps-wissel binnenkomt', async () => {
    let los: (() => void) | null = null;
    const traag = new Promise<void>((r) => { los = r; });
    const laad = vi.fn().mockReturnValueOnce(traag).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ filter }: { filter: string }) => useZelfLadend(laad, { deps: [filter] }), { initialProps: { filter: 'open' } });
    rerender({ filter: 'alles' });
    await flush();
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.laden).toBe(false);
    const tijd = result.current.laatstGeladen;
    vi.advanceTimersByTime(5_000);
    await act(async () => { los!(); await Promise.resolve(); });
    expect(result.current.laatstGeladen).toBe(tijd);
  });

  it('een geslaagde stille verversing wist de fout van een eerdere laad (bereik weg en weer terug)', async () => {
    online = false;
    const laad = vi.fn().mockRejectedValueOnce(new Error('geen bereik')).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() => useZelfLadend(laad, { boodschap: 'Kon de lijst niet laden.' }));
    await flush();
    expect(result.current.fout).toBe('Kon de lijst niet laden.');

    // Verbinding terug: de stille verversing slaagt, de data is vers, dus de
    // fout hoort weg (anders bleef de foutkaart boven een verse lijst staan).
    online = true;
    rerender();
    await flush();
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.fout).toBeNull();
    expect(result.current.laatstGeladen).toBe(Date.now());
  });

  it('stille verversing die mislukt zet geen fout', async () => {
    const laad = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('kapot'));
    const { result } = renderHook(() => useZelfLadend(laad));
    await flush();
    await act(async () => { await result.current.ververs(); });
    expect(result.current.fout).toBeNull();
    expect(result.current.verversen).toBe(false);
  });
});

describe('useZelfLadend met gegevens uit het geheugen (onthoudenOm)', () => {
  // Het scherm toont bij de mount een lezing van 14:29:30 uit het geheugen.
  const ONTHOUDEN = new Date('2026-09-15T14:29:30').getTime();
  const uitgesteld = () => {
    let los!: () => void;
    let faal!: (e: unknown) => void;
    const belofte = new Promise<void>((r, f) => { los = r; faal = f; });
    return { belofte, los: () => act(async () => { los(); await belofte; }), faal: (e: unknown) => act(async () => { faal(e); await belofte.catch(() => undefined); }) };
  };

  it('geen skelet: laden staat nooit aan, de regel noemt de onthouden tijd tijdens het verversen en daarna de nieuwe', async () => {
    const bezig = uitgesteld();
    const laad = vi.fn().mockReturnValueOnce(bezig.belofte).mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad, { onthoudenOm: ONTHOUDEN }));
    expect(result.current.laden).toBe(false);
    expect(result.current.laatstGeladen).toBe(ONTHOUDEN);
    expect(laad).toHaveBeenCalledTimes(1);
    // De verversing loopt (stil), maar de regel verbergt de leeftijd niet.
    expect(result.current.verversen).toBe(true);
    expect(versheidTekst(result.current.versheid)).toBe('Bijgewerkt om 14:29');

    await bezig.los();
    expect(result.current.laden).toBe(false);
    expect(result.current.verversen).toBe(false);
    expect(result.current.fout).toBeNull();
    expect(result.current.laatstGeladen).toBe(Date.now());
    expect(versheidTekst(result.current.versheid)).toBe('Bijgewerkt om 14:32');

    // Daarna is het een gewoon scherm: een stille verversing zegt "Bijwerken…".
    const tweede = uitgesteld();
    laad.mockReturnValueOnce(tweede.belofte);
    let klaar!: Promise<void>;
    act(() => { klaar = result.current.ververs(); });
    expect(versheidTekst(result.current.versheid)).toBe('Bijwerken…');
    await tweede.los();
    await act(async () => { await klaar; });
  });

  it('een fout van die eerste verversing wordt getoond; de onthouden tijd blijft in de regel', async () => {
    const laad = vi.fn().mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useZelfLadend(laad, { onthoudenOm: ONTHOUDEN, boodschap: 'Kon de vervaldata niet laden.' }));
    await flush();
    expect(result.current.laden).toBe(false);
    expect(result.current.fout).toBe('Kon de vervaldata niet laden.');
    expect(result.current.laatstGeladen).toBe(ONTHOUDEN);
    expect(versheidTekst(result.current.versheid)).toBe('Bijgewerkt om 14:29');
  });

  it('zolang de gegevens uit het geheugen komen, toont ook een latere stille verversing haar fout; Opnieuw herstelt', async () => {
    // De eerste verversing blijft hangen; een tweede, stille (bv. bereik
    // terug) neemt het over en mislukt: ook die fout staat er, want de
    // gegevens zijn nog altijd niet van dit bezoek.
    const hangt = uitgesteld();
    const laad = vi.fn().mockReturnValueOnce(hangt.belofte).mockRejectedValueOnce(new Error('500')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad, { onthoudenOm: ONTHOUDEN, boodschap: 'Kapot.' }));
    expect(result.current.fout).toBeNull();
    await act(async () => { await result.current.ververs(); });
    expect(laad).toHaveBeenCalledTimes(2);
    expect(result.current.fout).toBe('Kapot.');
    expect(result.current.laden).toBe(false);
    expect(result.current.laatstGeladen).toBe(ONTHOUDEN);
    expect(versheidTekst(result.current.versheid)).toBe('Bijgewerkt om 14:29');
    // Het antwoord van de eerste komt te laat: het raakt niets meer.
    await hangt.los();
    expect(result.current.fout).toBe('Kapot.');
    expect(result.current.laatstGeladen).toBe(ONTHOUDEN);

    await act(async () => { await result.current.opnieuw(); });
    expect(result.current.fout).toBeNull();
    expect(result.current.laatstGeladen).toBe(Date.now());

    // Nu van dit bezoek: een mislukte stille verversing zwijgt weer, zoals altijd.
    laad.mockRejectedValueOnce(new Error('500'));
    await act(async () => { await result.current.ververs(); });
    expect(result.current.fout).toBeNull();
  });

  it('een deps-wissel laadt zichtbaar, en onthoudenOm telt alleen bij de mount', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ filter, om }: { filter: string; om: number | null }) => useZelfLadend(laad, { deps: [filter], onthoudenOm: om }),
      { initialProps: { filter: 'open', om: ONTHOUDEN as number | null } },
    );
    expect(result.current.laden).toBe(false);
    await flush();
    rerender({ filter: 'alles', om: ONTHOUDEN });
    expect(result.current.laden).toBe(true);
    await flush();
    expect(result.current.laden).toBe(false);
    // Een andere waarde na de mount verandert niets aan wat al geladen is.
    const tijd = result.current.laatstGeladen;
    rerender({ filter: 'alles', om: ONTHOUDEN - 60_000 });
    expect(result.current.laatstGeladen).toBe(tijd);
    expect(laad).toHaveBeenCalledTimes(2);
  });

  it('zonder de optie (of met null) precies zoals vroeger: eerst laden, dan de tijd', async () => {
    const laad = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useZelfLadend(laad, { onthoudenOm: null }));
    expect(result.current.laden).toBe(true);
    expect(result.current.laatstGeladen).toBeNull();
    expect(versheidTekst(result.current.versheid)).toBe('');
    await flush();
    expect(result.current.laden).toBe(false);
    expect(versheidTekst(result.current.versheid)).toBe('Bijgewerkt om 14:32');
  });
});

describe('foutTekst en versheidTekst', () => {
  it('kiest de boodschap: vast, functie, Error-message of algemeen', () => {
    expect(foutTekst(new Error('x'), 'Vast.')).toBe('Vast.');
    expect(foutTekst(new Error('x'), (e) => `Fout: ${(e as Error).message}`)).toBe('Fout: x');
    expect(foutTekst(new Error('Server zei nee'))).toBe('Server zei nee');
    expect(foutTekst('iets')).toBe('Kon de gegevens niet laden.');
  });
  it('toont Bijwerken… tijdens een stille verversing en niets vóór de eerste laad', () => {
    expect(versheidTekst({ laatstGeladen: null, verversen: false, online: true })).toBe('');
    expect(versheidTekst({ laatstGeladen: 1, verversen: true, online: true })).toBe('Bijwerken…');
    expect(versheidTekst({ laatstGeladen: null, verversen: false, online: false })).toBe('Offline');
  });
});
