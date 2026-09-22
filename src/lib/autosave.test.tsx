import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn() }));
vi.mock('./ui', async (importOriginal) => ({ ...await importOriginal<typeof import('./ui')>(), notify: notifyMock }));

import { autosaveOnrustig, resetAutosaveVoorTest, useAutosaveCel } from './autosave';

/** Een save die de test zelf laat slagen of mislukken. */
function uitgesteld<T>() {
  let klaar!: (v: T) => void;
  let faal!: (e: unknown) => void;
  const p = new Promise<T>((res, rej) => { klaar = res; faal = rej; });
  return { p, klaar, faal };
}
const netwerkFout = () => Object.assign(new TypeError('Failed to fetch'), {});

beforeEach(() => { notifyMock.mockReset(); resetAutosaveVoorTest(); });
afterEach(() => { resetAutosaveVoorTest(); });

describe('useAutosaveCel', () => {
  it('bezig → bewaard, en de rij krijgt het antwoord', async () => {
    const d = uitgesteld<string>();
    const bewaar = vi.fn(() => d.p);
    const opGelukt = vi.fn();
    const { result } = renderHook(() => useAutosaveCel<number, string>({ actie: 'Overminuten bewaren', bewaar, opGelukt, bewaardMs: 10 }));

    act(() => { result.current.bewaar(30); });
    expect(bewaar).toHaveBeenCalledWith(30);
    expect(result.current.staat).toEqual({ status: 'bezig', waarde: 30 });
    expect(result.current.toon(0)).toBe(30);
    expect(autosaveOnrustig()).toBe(true);

    await act(async () => { d.klaar('rij'); await d.p; });
    expect(result.current.staat.status).toBe('bewaard');
    expect(opGelukt).toHaveBeenCalledWith('rij');
    expect(autosaveOnrustig()).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.staat.status).toBe('rust');
  });

  it('bezig → mislukt → opnieuw (zelfde waarde) → bewaard', async () => {
    const eerste = uitgesteld<string>();
    const tweede = uitgesteld<string>();
    const bewaar = vi.fn().mockReturnValueOnce(eerste.p).mockReturnValueOnce(tweede.p);
    const { result } = renderHook(() => useAutosaveCel<number, string>({ actie: 'Overminuten bewaren', bewaar }));

    act(() => { result.current.bewaar(45); });
    await act(async () => { eerste.faal(netwerkFout()); await eerste.p.catch(() => {}); });
    const st = result.current.staat;
    expect(st.status).toBe('fout');
    if (st.status !== 'fout') return;
    expect(st.waarde).toBe(45); // de getypte waarde blijft
    expect(st.melding).toBe('Niet bewaard. Controleer je verbinding en probeer het opnieuw.');
    expect(result.current.toon(0)).toBe(45);
    expect(autosaveOnrustig()).toBe(true); // mislukt en onbewaard: verlaatwaarschuwing
    expect(notifyMock).not.toHaveBeenCalled(); // bij de cel, geen toast

    act(() => { st.opnieuw!(); });
    expect(bewaar).toHaveBeenLastCalledWith(45);
    expect(result.current.staat.status).toBe('bezig');
    await act(async () => { tweede.klaar('rij'); await tweede.p; });
    expect(result.current.staat.status).toBe('bewaard');
    expect(autosaveOnrustig()).toBe(false);
  });

  it('ongeldige invoer: fout bij de cel zonder request', () => {
    const bewaar = vi.fn();
    const { result } = renderHook(() => useAutosaveCel<string>({ actie: 'Overminuten bewaren', bewaar }));
    act(() => { result.current.ongeldig('1,5', 'Vul een heel aantal minuten in.'); });
    expect(bewaar).not.toHaveBeenCalled();
    expect(result.current.staat).toEqual({ status: 'fout', waarde: '1,5', melding: 'Vul een heel aantal minuten in.', opnieuw: null });
    expect(autosaveOnrustig()).toBe(true);
    // Terug naar de bewaarde waarde: de fout verdwijnt, nog altijd geen request.
    act(() => { result.current.verander('0', '0'); });
    expect(result.current.staat.status).toBe('rust');
    expect(bewaar).not.toHaveBeenCalled();
    expect(autosaveOnrustig()).toBe(false);
  });

  it('unmount terwijl de save loopt: de save loopt door en een fout komt als toast', async () => {
    const d = uitgesteld<string>();
    const bewaar = vi.fn(() => d.p);
    const { result, unmount } = renderHook(() => useAutosaveCel<number, string>({ actie: 'Overminuten van Jan bewaren', bewaar }));
    act(() => { result.current.bewaar(15); });
    unmount();
    expect(autosaveOnrustig()).toBe(true); // nog onderweg: tabblad sluiten waarschuwt

    await act(async () => { d.faal(Object.assign(new Error('Deze dag is afgesloten.'), { status: 409 })); await d.p.catch(() => {}); });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const [tekst, toon, opties] = notifyMock.mock.calls[0];
    expect(tekst).toBe('Overminuten van Jan bewaren is mislukt. Deze dag is afgesloten. Iemand anders heeft dit intussen gewijzigd. Vernieuw de lijst en probeer het opnieuw.');
    expect(toon).toBe('error');
    expect(opties.action.label).toBe('Opnieuw proberen');
    expect(autosaveOnrustig()).toBe(false);

    // Opnieuw vanuit de toast stuurt dezelfde waarde nog eens.
    bewaar.mockResolvedValueOnce('rij');
    await act(async () => { opties.action.run(); await Promise.resolve(); });
    expect(bewaar).toHaveBeenLastCalledWith(15);
  });

  it('unmount na een mislukte save: de fout gaat niet stil verloren', async () => {
    const d = uitgesteld<string>();
    const { result, unmount } = renderHook(() => useAutosaveCel<number, string>({ actie: 'Matricule bewaren', bewaar: () => d.p }));
    act(() => { result.current.bewaar(42); });
    await act(async () => { d.faal(netwerkFout()); await d.p.catch(() => {}); });
    expect(notifyMock).not.toHaveBeenCalled();
    unmount();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatch(/^Matricule bewaren is mislukt\./);
    expect(autosaveOnrustig()).toBe(false);
  });

  it('een ouder antwoord overschrijft geen nieuwere keuze', async () => {
    const oud = uitgesteld<string>();
    const nieuw = uitgesteld<string>();
    const bewaar = vi.fn().mockReturnValueOnce(oud.p).mockReturnValueOnce(nieuw.p);
    const opGelukt = vi.fn();
    const { result } = renderHook(() => useAutosaveCel<string, string>({ actie: 'Code bewaren', bewaar, opGelukt }));
    act(() => { result.current.bewaar('2101'); });
    act(() => { result.current.bewaar('2607'); });
    await act(async () => { nieuw.klaar('rij-2607'); await nieuw.p; });
    await act(async () => { oud.klaar('rij-2101'); await oud.p; });
    expect(opGelukt).toHaveBeenCalledTimes(1);
    expect(opGelukt).toHaveBeenCalledWith('rij-2607');
    expect(result.current.staat.status).toBe('bewaard');
  });

  it('beforeunload waarschuwt alleen zolang er iets onderweg of mislukt is', async () => {
    const d = uitgesteld<string>();
    const { result } = renderHook(() => useAutosaveCel<number, string>({ actie: 'Bewaren', bewaar: () => d.p }));
    const vuur = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(vuur()).toBe(false);
    act(() => { result.current.bewaar(1); });
    expect(vuur()).toBe(true);
    await act(async () => { d.klaar('ok'); await d.p; });
    expect(vuur()).toBe(false);
  });
});
