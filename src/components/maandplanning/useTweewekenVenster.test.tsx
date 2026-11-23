import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMonthPlanning = vi.hoisted(() => vi.fn());
vi.mock('../../lib/monthPlanning', () => ({ fetchMonthPlanning }));
// useZelfLadend leest de netwerkstatus via useOnline; hier altijd online.
vi.mock('../../lib/useOnline', () => ({ useOnline: () => true }));

import type { Herkomst, MonthPlanning } from '../../lib/monthPlanning';
import { PLANNING_SALVO_MS } from '../../lib/maandplanning';
import { LAATSTE_AUTH_KEY, WIS_PRIVE_GEBEURTENIS } from '../../lib/afmelden';
import { markeerEigenSchrijfactie, resetLiveSignaal } from '../../lib/liveSignaal';
import { MAX_LEEFTIJD_MS } from '../../lib/schermGeheugen';
import { leesOnthoudenMaand, maandSleutel, useImportGrenzen, useMaandLaden, useTweewekenVenster } from './useTweewekenVenster';

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

  // Ronde 6, punt 17: /maandplanning/<maand>/<dag> (een rij "te herverdelen",
  // de knop Maandplanning in het ziektedetail, de mail naar de admins). Het
  // standaardvenster is hier 12/10 t/m 25/10 (deze maand) en 30/11 t/m 13/12
  // (december: de maandag van of vóór de eerste).
  describe('een dag in het adres', () => {
    const oktober = { startMaand: new Date(2026, 9, 1), maandParam: '2026-10' };
    const december = { startMaand: new Date(2026, 11, 1), monthParam: '2026-12', maandParam: '2026-12' };

    it('zonder dag, of met een dag die al in het standaardvenster valt, begint het venster waar het altijd begon', () => {
      expect(opzet({ ...oktober }).nu().windowStart).toBe('2026-10-12');
      for (const dag of ['2026-10-12', '2026-10-14', '2026-10-25']) {
        expect(opzet({ ...oktober, dagParam: dag }).nu().windowStart, dag).toBe('2026-10-12');
      }
      expect(opzet({ ...december }).nu().windowStart).toBe('2026-11-30');
      for (const dag of ['2026-12-01', '2026-12-13']) {
        expect(opzet({ ...december, dagParam: dag }).nu().windowStart, dag).toBe('2026-11-30');
      }
    });

    it('een dag buiten het standaardvenster: het venster begint op de maandag van (of vóór) die dag, zodat hij in beeld staat', () => {
      // De dag na de laatste van het venster is zelf een maandag.
      const net = opzet({ ...oktober, dagParam: '2026-10-26' });
      expect(net.nu().windowStart).toBe('2026-10-26');
      expect(net.nu().windowDates).toEqual(dagen('2026-10-26'));
      // Verderop in de week: de maandag ervoor.
      expect(opzet({ ...oktober, dagParam: '2026-10-29' }).nu().windowStart).toBe('2026-10-26');
      // Vóór het venster (staf kijkt terug): de dag vóór de eerste is een
      // zondag, en de eerste van de maand valt in een week die in september begint.
      expect(opzet({ ...oktober, dagParam: '2026-10-11' }).nu().windowStart).toBe('2026-10-05');
      expect(opzet({ ...oktober, dagParam: '2026-10-01' }).nu().windowStart).toBe('2026-09-28');
      // Een andere maand dan de lopende.
      const later = opzet({ ...december, dagParam: '2026-12-18' });
      expect(later.nu().windowStart).toBe('2026-12-14');
      expect(later.nu().windowDates).toContain('2026-12-18');
      expect(opzet({ ...december, dagParam: '2026-12-14' }).nu().windowStart).toBe('2026-12-14');
      expect(opzet({ ...december, dagParam: '2026-12-31' }).nu().windowStart).toBe('2026-12-28');
      // De hoofdmaand blijft die van het adres: de hook zet ze bij het openen niet.
      expect(later.setViewMonth).not.toHaveBeenCalled();
      expect(later.zetMaandParam).not.toHaveBeenCalled();
    });

    it('een ongeldige dag, een dag uit een andere maand dan het adres, of een adres zonder geldige maand: het gedrag van vroeger', () => {
      for (const dag of ['2026-10-99', '2026-10-32', '2026-10-5', 'geen-dag', '', '26/10/2026', '2026-10-26T00:00']) {
        expect(opzet({ ...oktober, dagParam: dag }).nu().windowStart, dag).toBe('2026-10-12');
      }
      // 30 februari en 31 november bestaan niet (een Date zou ze doorrollen naar de maand erna).
      expect(opzet({ startMaand: new Date(2027, 1, 1), monthParam: '2027-02', maandParam: '2027-02', dagParam: '2027-02-30' }).nu().windowStart).toBe('2027-02-01');
      expect(opzet({ startMaand: new Date(2026, 10, 1), monthParam: '2026-11', maandParam: '2026-11', dagParam: '2026-11-31' }).nu().windowStart).toBe('2026-10-26');
      // De dag ligt niet in de maand van het adres.
      expect(opzet({ ...oktober, dagParam: '2026-11-26' }).nu().windowStart).toBe('2026-10-12');
      expect(opzet({ ...december, dagParam: '2026-10-29' }).nu().windowStart).toBe('2026-11-30');
      expect(opzet({ ...december, dagParam: '2027-12-18' }).nu().windowStart).toBe('2026-11-30');
      // Geen (geldige) maand in het adres, of een maand die de view wegliet
      // (wie geen staf is en een dag van vóór deze week opent): deze week.
      expect(opzet({ startMaand: null, dagParam: '2026-10-29' }).nu().windowStart).toBe('2026-10-12');
      expect(opzet({ startMaand: null, maandParam: '2026-09', dagParam: '2026-09-03' }).nu().windowStart).toBe('2026-10-12');
    });

    it('bladeren na een landing op zo\'n dag: het venster verschuift vanaf waar het staat en springt nooit terug naar de dag uit het adres', () => {
      const { nu, rerender, setViewMonth, zetMaandParam } = opzet({ ...december, dagParam: '2026-12-18' });
      const props = (extra: Partial<Parameters<typeof useTweewekenVenster>[0]> = {}) => ({ ...basis, ...december, dagParam: '2026-12-18', zetMaandParam, setViewMonth, ...extra });
      expect(nu().windowStart).toBe('2026-12-14');

      // Vorige twee weken: zelfde hoofdmaand, het adres houdt de dag (dat is
      // de gekozen dag van de dagweergave), het venster blijft waar de
      // planner het zette, ook na een nieuwe render.
      act(() => { nu().goPrevWindow(); });
      expect(nu().windowStart).toBe('2026-11-30');
      expect(setViewMonth).toHaveBeenLastCalledWith(new Date(2026, 11, 1));
      rerender(props());
      expect(nu().windowStart).toBe('2026-11-30');
      expect(zetMaandParam).not.toHaveBeenCalled();

      // Volgende twee weken, twee keer: de hoofdmaand wordt januari. De hook
      // zet alleen de maand in het adres; de dag die daar niet meer bij hoort
      // haalt de view er zelf uit (het bestaande effect in CapacityView).
      act(() => { nu().goNextWindow(); });
      act(() => { nu().goNextWindow(); });
      expect(nu().windowStart).toBe('2026-12-28');
      expect(setViewMonth).toHaveBeenLastCalledWith(new Date(2027, 0, 1));
      rerender(props({ monthParam: '2027-01' }));
      expect(zetMaandParam).toHaveBeenLastCalledWith('2027-01');
      expect(nu().windowStart).toBe('2026-12-28');
      rerender(props({ monthParam: '2027-01', maandParam: '2027-01', dagParam: null }));
      expect(nu().windowStart).toBe('2026-12-28');

      // Deze week: naar vandaag, niet naar de dag van de landing.
      act(() => { nu().naarVandaag(); });
      expect(nu().windowStart).toBe('2026-10-12');
      rerender(props({ monthParam: '2026-10', maandParam: '2027-01', dagParam: null }));
      expect(nu().windowStart).toBe('2026-10-12');
    });

    it('de dag telt alleen bij het openen: een dag die later in het adres komt (tik in de dagweergave) verschuift het venster niet', () => {
      const { nu, rerender, setViewMonth, zetMaandParam } = opzet({ ...oktober });
      expect(nu().windowStart).toBe('2026-10-12');
      rerender({ ...basis, ...oktober, dagParam: '2026-10-29', zetMaandParam, setViewMonth });
      expect(nu().windowStart).toBe('2026-10-12');
      expect(setViewMonth).not.toHaveBeenCalled();
    });
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

/**
 * Terug binnen vijf minuten (ronde 6, punt 22, deel 3): de echte
 * src/lib/schermGeheugen.ts, met een eigenaar in een eigen localStorage
 * (Node >= 22 zet zelf een functieloze `localStorage`-global, zie
 * schermGeheugen.test.ts) en een gewist geheugen per test. Zonder eigenaar,
 * zoals in de proeven hierboven, onthoudt het geheugen niets.
 */
describe('useMaandLaden: het geheugen van de Maandplanning', () => {
  /** Het bord van een maand in versie `v`: één cel met een code die de versie draagt. */
  const versie = (month: string, v: number): MonthPlanning => ({
    month, dates: [`${month}-01`], drivers: [{ id: '7', name: 'Rudy Dhaenens' }],
    cells: { 7: { [`${month}-01`]: { code: `${v}101`, kind: 'service', label: '', segments: [] } } },
  });
  const opslag = new Map<string, string>();
  const zetOpslag = () => {
    const ls = { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); }, clear: () => opslag.clear() };
    vi.stubGlobal('localStorage', ls);
    if (window !== (globalThis as unknown as Window)) Object.defineProperty(window, 'localStorage', { value: ls, configurable: true });
  };
  /** Het verzoek: per maand de versie die de server nu geeft, vasthouden kan, en de herkomst. */
  const server = { v: 1, houd: false, faalt: false, faaltMaand: new Set<string>(), uitCache: new Set<string>(), wachtend: [] as Array<() => void>, perMaand: new Map<string, () => void>() };
  const laatLos = async () => { server.houd = false; await act(async () => { for (const los of server.wachtend.splice(0)) los(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
  beforeEach(() => {
    opslag.clear();
    zetOpslag();
    opslag.set(LAATSTE_AUTH_KEY, 'auth-a');
    resetLiveSignaal();
    window.dispatchEvent(new Event(WIS_PRIVE_GEBEURTENIS));
    Object.assign(server, { v: 1, houd: false, faalt: false, faaltMaand: new Set<string>(), uitCache: new Set<string>(), wachtend: [], perMaand: new Map() });
    fetchMonthPlanning.mockImplementation(async (m: string, herkomst?: Herkomst) => {
      const v = server.v;
      if (server.houd) await new Promise<void>((los) => { server.wachtend.push(los); server.perMaand.set(m, los); });
      if (server.faalt || server.faaltMaand.has(m)) throw new Error('Er ging iets mis (code 500). Probeer het opnieuw.');
      if (herkomst) herkomst.uitCache = server.uitCache.has(m);
      return versie(m, v);
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const opzet = (windowDates: string[], onthoudenOm: number | null = null, monthParam = '2026-10') => {
    const setData = vi.fn();
    const setExtraData = vi.fn();
    const setReloadTick = vi.fn();
    const hook = renderHook((p: Parameters<typeof useMaandLaden>[0]) => useMaandLaden(p), {
      initialProps: { monthParam, windowDates, reloadTick: 0, setReloadTick, setData, setExtraData, onthoudenOm },
    });
    return { ...hook, setData, setExtraData, setReloadTick, nu: () => hook.result.current };
  };
  /** Een eerste bezoek: beide maanden geladen en onthouden, daarna weg van het scherm. */
  const eersteBezoek = async (windowDates = dagen('2026-10-26')) => {
    const a = opzet(windowDates);
    await flush();
    a.unmount();
    return a;
  };

  it('elke geslaagde lezing gaat per maand in het geheugen, met het vertrek als tijd; een antwoord uit de cache van de service worker niet', async () => {
    server.uitCache.add('2026-11');
    const t0 = Date.now();
    await eersteBezoek();
    expect(leesOnthoudenMaand('2026-10')).toEqual({ antwoord: versie('2026-10', 1), om: t0 });
    expect(leesOnthoudenMaand('2026-11')).toBeNull();
    expect(maandSleutel('2026-10')).toBe('maandplanning:2026-10');
  });

  it('terug met een onthouden hoofdmaand: geen skelet, de onthouden tijd in de regel, de maand achter de vensterrand meteen uit het geheugen; daarna de verse borden en de nieuwe tijd', async () => {
    await eersteBezoek();
    const onthouden = leesOnthoudenMaand('2026-10')!;
    vi.advanceTimersByTime(2 * 60_000);
    server.v = 2;
    server.houd = true;
    const b = opzet(dagen('2026-10-26'), onthouden.om);
    // Vóór enig antwoord: de tweede maand uit het geheugen, geen laad, de oude tijd.
    expect(b.setExtraData).toHaveBeenCalledWith(versie('2026-11', 1));
    expect(b.nu().laden).toBe(false);
    expect(b.nu().versheid).toEqual({ laatstGeladen: onthouden.om, verversen: false, online: true });
    expect(fetchMonthPlanning.mock.calls.slice(-2).map((c) => c[0]).sort()).toEqual(['2026-10', '2026-11']);
    await flush();
    expect(b.nu().versheid.laatstGeladen).toBe(onthouden.om);
    await laatLos();
    expect(b.setData).toHaveBeenLastCalledWith(versie('2026-10', 2));
    expect(b.setExtraData).toHaveBeenLastCalledWith(versie('2026-11', 2));
    expect(b.nu().versheid.laatstGeladen).toBe(Date.now());
    expect(b.nu().fout).toBeNull();
    // En het geheugen draagt nu de verse borden.
    expect(leesOnthoudenMaand('2026-10')?.antwoord).toEqual(versie('2026-10', 2));
    expect(leesOnthoudenMaand('2026-11')?.antwoord).toEqual(versie('2026-11', 2));
  });

  it('zonder geheugentreffer voor de hoofdmaand komt ook de tweede maand niet uit het geheugen', async () => {
    await eersteBezoek();
    server.houd = true;
    const b = opzet(dagen('2026-10-26'), null);
    expect(b.nu().laden).toBe(true);
    expect(b.setExtraData).not.toHaveBeenCalled();
    await laatLos();
    expect(b.setExtraData).toHaveBeenCalledWith(versie('2026-11', 1));
  });

  it('mislukt de verversing na een terugkeer: een fout (de kleine Foutkaart), de onthouden tijd blijft, en de onthouden kolommen van de tweede maand blijven staan', async () => {
    await eersteBezoek();
    const onthouden = leesOnthoudenMaand('2026-10')!;
    vi.advanceTimersByTime(60_000);
    server.faalt = true;
    const b = opzet(dagen('2026-10-26'), onthouden.om);
    await flush();
    expect(b.nu().fout).toBe('Er ging iets mis (code 500). Probeer het opnieuw.');
    expect(b.nu().laden).toBe(false);
    expect(b.nu().versheid.laatstGeladen).toBe(onthouden.om);
    expect(b.setData).not.toHaveBeenCalled();
    expect(b.setExtraData.mock.calls).toEqual([[versie('2026-11', 1)]]);
    // Een volgende verversing die slaagt vervangt ze en wist de fout.
    server.faalt = false;
    server.v = 3;
    b.rerender({ monthParam: '2026-10', windowDates: dagen('2026-10-26'), reloadTick: 1, setReloadTick: b.setReloadTick, setData: b.setData, setExtraData: b.setExtraData, onthoudenOm: onthouden.om });
    await flush();
    expect(b.nu().fout).toBeNull();
    expect(b.setData).toHaveBeenLastCalledWith(versie('2026-10', 3));
    expect(b.setExtraData).toHaveBeenLastCalledWith(versie('2026-11', 3));
  });

  // Onthouden kolommen van de tweede maand blijven alleen staan zolang de
  // hoofdmaand zelf nog uit het geheugen komt (of mislukte, met de kleine
  // Foutkaart erboven). Is de hoofdmaand vers en mislukte de tweede maand,
  // dan lege kolommen zoals zonder geheugen, in beide volgordes van aankomst:
  // nooit kolommen van een vorige keer onder een verse regel, zonder fout.
  const losVoor = async (maand: string) => {
    await act(async () => { server.perMaand.get(maand)!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  };
  for (const volgorde of [['2026-10', '2026-11'], ['2026-11', '2026-10']]) {
    it(`terug, de hoofdmaand slaagt en de tweede maand mislukt (eerst ${volgorde[0]}): lege kolommen zoals zonder geheugen, geen fout`, async () => {
      await eersteBezoek();
      const onthouden = leesOnthoudenMaand('2026-10')!;
      vi.advanceTimersByTime(60_000);
      server.v = 2;
      server.houd = true;
      server.faaltMaand.add('2026-11');
      const b = opzet(dagen('2026-10-26'), onthouden.om);
      expect(b.setExtraData.mock.calls).toEqual([[versie('2026-11', 1)]]);
      await flush();
      for (const maand of volgorde) await losVoor(maand);
      expect(b.setData).toHaveBeenLastCalledWith(versie('2026-10', 2));
      expect(b.setExtraData).toHaveBeenLastCalledWith(null);
      expect(b.nu().fout).toBeNull();
      expect(b.nu().versheid.laatstGeladen).toBe(Date.now());
    });
  }

  it('terug, de tweede maand slaagt en de hoofdmaand mislukt: de verse kolommen, het onthouden bord en de fout', async () => {
    await eersteBezoek();
    const onthouden = leesOnthoudenMaand('2026-10')!;
    vi.advanceTimersByTime(60_000);
    server.v = 2;
    server.faaltMaand.add('2026-10');
    const b = opzet(dagen('2026-10-26'), onthouden.om);
    await flush();
    expect(b.setData).not.toHaveBeenCalled();
    expect(b.setExtraData).toHaveBeenLastCalledWith(versie('2026-11', 2));
    expect(b.nu().fout).toBe('Er ging iets mis (code 500). Probeer het opnieuw.');
    expect(b.nu().versheid.laatstGeladen).toBe(onthouden.om);
  });

  it('een planningswijziging terwijl het verzoek onderweg is: het bord wordt getoond maar niet onthouden; de stille verversing erna wel', async () => {
    server.houd = true;
    const a = opzet(dagen('2026-10-05'));
    window.dispatchEvent(new Event('vhb-planning-changed'));
    await laatLos();
    expect(a.setData).toHaveBeenCalledWith(versie('2026-10', 1));
    expect(leesOnthoudenMaand('2026-10')).toBeNull();
    // Het salvo-venster loopt af: de herlaadtik vertrekt ná de wijziging en telt.
    act(() => { vi.advanceTimersByTime(PLANNING_SALVO_MS); });
    expect(a.setReloadTick).toHaveBeenCalledTimes(1);
    a.rerender({ monthParam: '2026-10', windowDates: dagen('2026-10-05'), reloadTick: 1, setReloadTick: a.setReloadTick, setData: a.setData, setExtraData: a.setExtraData, onthoudenOm: null });
    await flush();
    expect(leesOnthoudenMaand('2026-10')?.antwoord).toEqual(versie('2026-10', 1));
  });

  it('na vijf minuten, na een eigen schrijfactie of een planningswijziging sinds het vertrek, en voor een andere gebruiker: niets onthouden', async () => {
    await eersteBezoek();
    expect(leesOnthoudenMaand('2026-10')).not.toBeNull();
    vi.advanceTimersByTime(MAX_LEEFTIJD_MS);
    expect(leesOnthoudenMaand('2026-10')).toBeNull();

    await eersteBezoek();
    vi.advanceTimersByTime(1);
    markeerEigenSchrijfactie();
    expect(leesOnthoudenMaand('2026-10')).toBeNull();

    vi.advanceTimersByTime(1);
    await eersteBezoek();
    window.dispatchEvent(new Event('vhb-planning-changed'));
    expect(leesOnthoudenMaand('2026-10')).toBeNull();
    expect(leesOnthoudenMaand('2026-11')).toBeNull();

    await eersteBezoek();
    opslag.set(LAATSTE_AUTH_KEY, 'auth-b');
    expect(leesOnthoudenMaand('2026-10')).toBeNull();
  });

  it('een laat antwoord van de vorige maand na een maandwissel raakt het bord niet meer', async () => {
    const wacht = new Map<string, () => void>();
    fetchMonthPlanning.mockImplementation((m: string) => new Promise<MonthPlanning>((los) => { wacht.set(m, () => los(versie(m, 1))); }));
    const a = opzet(dagen('2026-10-05'));
    a.rerender({ monthParam: '2026-11', windowDates: dagen('2026-11-02'), reloadTick: 0, setReloadTick: a.setReloadTick, setData: a.setData, setExtraData: a.setExtraData, onthoudenOm: null });
    await act(async () => { wacht.get('2026-11')!(); await Promise.resolve(); await Promise.resolve(); });
    expect(a.setData).toHaveBeenLastCalledWith(versie('2026-11', 1));
    await act(async () => { wacht.get('2026-10')!(); await Promise.resolve(); await Promise.resolve(); });
    expect(a.setData).toHaveBeenCalledTimes(1);
    expect(a.setData).not.toHaveBeenCalledWith(versie('2026-10', 1));
  });

  it('een antwoord dat niet de gevraagde maand draagt, wordt niet onthouden', async () => {
    fetchMonthPlanning.mockImplementation(async () => versie('2026-09', 1));
    await eersteBezoek(dagen('2026-10-05'));
    expect(leesOnthoudenMaand('2026-10')).toBeNull();
    expect(leesOnthoudenMaand('2026-09')).toBeNull();
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

  it('de laatste dag is de laatste van de twee geladen maanden: een oude grens uit de cache verbergt de verse tweede maand niet', () => {
    const oud = met({ geimporteerd: { eerste: '2026-10-05', laatste: '2026-10-25' } });
    const vers = met({ geimporteerd: { eerste: '2026-10-05', laatste: '2026-11-22' } });
    expect(opzet({ data: oud, extraData: vers }).nu()).toMatchObject({ laatsteDag: '2026-11-22', kanVooruit: true, kanMaandVooruit: true });
    expect(opzet({ data: vers, extraData: oud }).nu()).toMatchObject({ laatsteDag: '2026-11-22' });
    // Een tweede maand zonder grens (oude server) verandert niets.
    expect(opzet({ data: oud, extraData: met({}) }).nu()).toMatchObject({ laatsteDag: '2026-10-25', kanVooruit: false });
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
