import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMonthPlanning = vi.hoisted(() => vi.fn());
vi.mock('../../lib/monthPlanning', () => ({ fetchMonthPlanning }));
// useZelfLadend leest de netwerkstatus via useOnline; hier altijd online.
vi.mock('../../lib/useOnline', () => ({ useOnline: () => true }));

import type { MonthPlanning } from '../../lib/monthPlanning';
import { PLANNING_SALVO_MS } from '../../lib/maandplanning';
import { useImportGrenzen, useMaandLaden, useTweewekenVenster } from './useTweewekenVenster';

/**
 * Het tweewekenvenster, het laden van de twee maanden en de grenzen van de
 * import, zoals ze tot 09-10 in CapacityView.tsx stonden. Vaste klok:
 * woensdag 14/10/2026, dus de lopende week begint op maandag 12/10.
 */
const bord = (month: string): MonthPlanning => ({ month, dates: [`${month}-01`], drivers: [{ id: '7', name: 'Rudy Dhaenens' }], cells: {} });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const dagen = (vanaf: string, n = 14) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${vanaf}T00:00:00`);
  d.setDate(d.getDate() + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T10:00:00'));
  fetchMonthPlanning.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useTweewekenVenster', () => {
  const basis = { monthParam: '2026-10', maandParam: null as string | null, dagParam: null as string | null, todayIso: '2026-10-14' };
  const opzet = (extra: Partial<Parameters<typeof useTweewekenVenster>[0]> = {}) => {
    const zetMaandParam = vi.fn();
    const setViewMonth = vi.fn();
    const hook = renderHook((p: Parameters<typeof useTweewekenVenster>[0]) => useTweewekenVenster(p), {
      initialProps: { ...basis, startMaand: null, zetMaandParam, setViewMonth, ...extra },
    });
    return { ...hook, zetMaandParam, setViewMonth, nu: () => hook.result.current };
  };

  it('begint op de maandag van deze week, ook met de huidige maand in de URL; een andere maand begint op de maandag van of vóór de eerste', () => {
    expect(opzet().nu().windowStart).toBe('2026-10-12');
    expect(opzet({ startMaand: new Date(2026, 9, 1) }).nu().windowStart).toBe('2026-10-12');
    expect(opzet({ startMaand: new Date(2026, 11, 1) }).nu().windowStart).toBe('2026-11-30');
    const { nu } = opzet();
    expect(nu().windowDates).toEqual(dagen('2026-10-12'));
    expect(nu().windowLabel).toMatch(/ 2026$/);
  });

  it('verschuiven gaat twee weken op en zet de hoofdmaand op de maand van de tweede maandag', () => {
    const { nu, setViewMonth } = opzet();
    act(() => { nu().goNextWindow(); });
    expect(nu().windowStart).toBe('2026-10-26');
    expect(setViewMonth).toHaveBeenLastCalledWith(new Date(2026, 10, 1));
    act(() => { nu().goPrevWindow(); });
    act(() => { nu().goPrevWindow(); });
    expect(nu().windowStart).toBe('2026-09-28');
    expect(setViewMonth).toHaveBeenLastCalledWith(new Date(2026, 9, 1));
    act(() => { nu().naarVandaag(); });
    expect(nu().windowStart).toBe('2026-10-12');
    expect(setViewMonth).toHaveBeenLastCalledWith(new Date(2026, 9, 1));
  });

  it('de hoofdmaand in de URL: de huidige maand zonder dag is geen parameter, een andere maand of een dag wel, en niets als het al klopt', () => {
    expect(opzet().zetMaandParam).not.toHaveBeenCalled();
    expect(opzet({ maandParam: '2026-10' }).zetMaandParam).toHaveBeenCalledWith(null);
    expect(opzet({ monthParam: '2026-11' }).zetMaandParam).toHaveBeenCalledWith('2026-11');
    expect(opzet({ monthParam: '2026-11', maandParam: '2026-11' }).zetMaandParam).not.toHaveBeenCalled();
    expect(opzet({ dagParam: '2026-10-15' }).zetMaandParam).toHaveBeenCalledWith('2026-10');
    expect(opzet({ dagParam: '2026-10-15', maandParam: '2026-10' }).zetMaandParam).not.toHaveBeenCalled();
  });
});

describe('useMaandLaden', () => {
  const opzet = (windowDates: string[], extra: { monthParam?: string; reloadTick?: number } = {}) => {
    const setData = vi.fn();
    const setExtraData = vi.fn();
    const setReloadTick = vi.fn();
    const hook = renderHook((p: Parameters<typeof useMaandLaden>[0]) => useMaandLaden(p), {
      initialProps: { monthParam: '2026-10', windowDates, reloadTick: 0, setReloadTick, setData, setExtraData, ...extra },
    });
    return { ...hook, setData, setExtraData, setReloadTick, nu: () => hook.result.current };
  };

  it('laadt de hoofdmaand zichtbaar en de maand achter de vensterrand stil erbij; binnen één maand geen extra maand', async () => {
    fetchMonthPlanning.mockImplementation(async (m: string) => bord(m));
    const { nu, setData, setExtraData } = opzet(dagen('2026-10-26'));
    expect(nu().laden).toBe(true);
    await flush();
    expect(fetchMonthPlanning.mock.calls.map((c) => c[0])).toEqual(['2026-10', '2026-11']);
    expect(setData).toHaveBeenCalledWith(bord('2026-10'));
    expect(setExtraData).toHaveBeenCalledWith(bord('2026-11'));
    expect(nu().laden).toBe(false);
    expect(nu().fout).toBeNull();

    const binnen = opzet(dagen('2026-10-05'));
    await flush();
    expect(binnen.setExtraData).toHaveBeenCalledWith(null);
    expect(fetchMonthPlanning).toHaveBeenCalledTimes(3);
  });

  it('een laadfout geeft de tekst van de fout, of de algemene tekst', async () => {
    fetchMonthPlanning.mockRejectedValueOnce(new Error('Kon de maandplanning niet laden: 503'));
    const a = opzet(dagen('2026-10-05'));
    await flush();
    expect(a.nu().fout).toBe('Kon de maandplanning niet laden: 503');
    fetchMonthPlanning.mockRejectedValueOnce('weg');
    const b = opzet(dagen('2026-10-05'));
    await flush();
    expect(b.nu().fout).toBe('Kon de maandplanning niet laden.');
  });

  it('een herlaadtik ververst stil: hoofdmaand én extra maand opnieuw, zonder skelet', async () => {
    fetchMonthPlanning.mockImplementation(async (m: string) => bord(m));
    const { nu, rerender, setData, setExtraData, setReloadTick } = opzet(dagen('2026-10-26'));
    await flush();
    expect(fetchMonthPlanning).toHaveBeenCalledTimes(2);
    rerender({ monthParam: '2026-10', windowDates: dagen('2026-10-26'), reloadTick: 1, setReloadTick, setData, setExtraData });
    expect(nu().laden).toBe(false);
    await flush();
    expect(fetchMonthPlanning).toHaveBeenCalledTimes(4);
    expect(fetchMonthPlanning.mock.calls.slice(2).map((c) => c[0]).sort()).toEqual(['2026-10', '2026-11']);
    expect(setData).toHaveBeenCalledTimes(2);
    expect(setExtraData).toHaveBeenCalledTimes(2);
  });

  it('een salvo van planning-wijzigingen wordt één tik na 1,2 s stilte; na het sluiten luistert niets meer', () => {
    fetchMonthPlanning.mockImplementation(async (m: string) => bord(m));
    const { unmount, setReloadTick } = opzet(dagen('2026-10-05'));
    const wijziging = () => window.dispatchEvent(new Event('vhb-planning-changed'));
    act(() => { wijziging(); });
    act(() => { vi.advanceTimersByTime(PLANNING_SALVO_MS - 200); wijziging(); });
    act(() => { vi.advanceTimersByTime(PLANNING_SALVO_MS - 200); wijziging(); });
    expect(setReloadTick).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(PLANNING_SALVO_MS); });
    expect(setReloadTick).toHaveBeenCalledTimes(1);
    expect(setReloadTick.mock.calls[0][0](4)).toBe(5);
    unmount();
    act(() => { wijziging(); vi.advanceTimersByTime(PLANNING_SALVO_MS * 2); });
    expect(setReloadTick).toHaveBeenCalledTimes(1);
  });

  it('een laat antwoord voor een vorige extra maand wordt genegeerd; mislukt de extra maand, dan lege kolommen', async () => {
    const wacht = new Map<string, (b: MonthPlanning) => void>();
    fetchMonthPlanning.mockImplementation((m: string) => m === '2026-10' ? Promise.resolve(bord(m)) : new Promise<MonthPlanning>((r) => { wacht.set(m, r); }));
    const { rerender, setData, setExtraData, setReloadTick } = opzet(dagen('2026-10-26'));
    await flush();
    rerender({ monthParam: '2026-10', windowDates: dagen('2026-09-28'), reloadTick: 0, setReloadTick, setData, setExtraData });
    await flush();
    await act(async () => { wacht.get('2026-11')!(bord('2026-11')); await Promise.resolve(); });
    expect(setExtraData).not.toHaveBeenCalledWith(bord('2026-11'));
    await act(async () => { wacht.get('2026-09')!(bord('2026-09')); await Promise.resolve(); });
    expect(setExtraData).toHaveBeenLastCalledWith(bord('2026-09'));

    fetchMonthPlanning.mockImplementation((m: string) => m === '2026-10' ? Promise.resolve(bord(m)) : Promise.reject(new Error('weg')));
    const b = opzet(dagen('2026-10-26'));
    await flush();
    expect(b.setExtraData).toHaveBeenLastCalledWith(null);
    expect(b.nu().fout).toBeNull();
  });
});

describe('useImportGrenzen', () => {
  const opzet = (extra: Partial<Parameters<typeof useImportGrenzen>[0]> = {}) => {
    const setWindowStart = vi.fn();
    const setViewMonth = vi.fn();
    const hook = renderHook((p: Parameters<typeof useImportGrenzen>[0]) => useImportGrenzen(p), {
      initialProps: { data: null, extraData: null, monthParam: '2026-10', year: 2026, monthIndex: 9, windowStart: '2026-10-12', setWindowStart, setViewMonth, ...extra },
    });
    return { ...hook, setWindowStart, setViewMonth, nu: () => hook.result.current };
  };
  const met = (extra: Partial<MonthPlanning>): MonthPlanning => ({ ...bord('2026-10'), ...extra });

  it('zonder grenzen van de server blijft alles bereikbaar', () => {
    const { nu, setWindowStart, setViewMonth } = opzet();
    expect(nu()).toEqual({ laatsteDag: null, beginUitleg: 'De planning begint op ', maandVoorbij: false, kanTerug: true, kanVooruit: true, kanMaandTerug: true, kanMaandVooruit: true });
    expect(setWindowStart).not.toHaveBeenCalled();
    expect(setViewMonth).not.toHaveBeenCalled();
  });

  it('de geïmporteerde periode begrenst venster en maand: het vorige venster eindigt vóór de eerste dag, het volgende begint na de laatste', () => {
    const { nu } = opzet({ data: met({ geimporteerd: { eerste: '2026-10-05', laatste: '2026-10-25' } }) });
    expect(nu()).toMatchObject({ laatsteDag: '2026-10-25', beginUitleg: 'De planning begint op 05/10/2026', kanTerug: true, kanVooruit: false, kanMaandTerug: false, kanMaandVooruit: false });
    const ruim = opzet({ data: met({ geimporteerd: { eerste: '2026-09-01', laatste: '2026-11-30' } }) });
    expect(ruim.nu()).toMatchObject({ kanTerug: true, kanVooruit: true, kanMaandTerug: true, kanMaandVooruit: true });
    const rand = opzet({ data: met({ geimporteerd: { eerste: '2026-10-12', laatste: '2026-10-26' } }) });
    expect(rand.nu()).toMatchObject({ kanTerug: false, kanVooruit: true });
    // Alleen de extra maand geladen: dezelfde grenzen.
    const extra = opzet({ extraData: met({ geimporteerd: { eerste: '2026-10-05', laatste: '2026-10-25' } }) });
    expect(extra.nu()).toMatchObject({ laatsteDag: '2026-10-25', kanVooruit: false });
  });

  it('wie geen staf is: de terugblikgrens trekt het venster mee en de uitleg zegt het; een voorbije maand wordt de maand van het venster', () => {
    const zicht = met({ zichtbaarVanaf: '2026-10-12', geimporteerd: { eerste: '2026-10-12', laatste: '2026-12-31' } });
    const a = opzet({ data: zicht, windowStart: '2026-10-05' });
    expect(a.nu().beginUitleg).toBe('Je ziet de planning vanaf deze week (12/10/2026)');
    expect(a.nu().maandVoorbij).toBe(false);
    expect(a.setWindowStart).toHaveBeenCalledWith('2026-10-12');
    expect(a.setViewMonth).not.toHaveBeenCalled();

    const b = opzet({ data: zicht, windowStart: '2026-09-28', monthParam: '2026-09', monthIndex: 8 });
    expect(b.nu().maandVoorbij).toBe(true);
    expect(b.setWindowStart).toHaveBeenCalledWith('2026-10-12');
    expect(b.setViewMonth).toHaveBeenCalledWith(new Date(2026, 9, 1));

    const c = opzet({ data: zicht, windowStart: '2026-10-12' });
    expect(c.setWindowStart).not.toHaveBeenCalled();
  });
});
