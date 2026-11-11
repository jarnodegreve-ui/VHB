import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LeaveRequest, Shift, User } from '../../types';

// Het detailpaneel van een ziekmelding leest het record uit de live lijst
// (controle 04-11, punt 34): stelt een collega intussen de einddatum bij
// (realtime), dan toont het paneel die wijziging. Verdwijnt het record uit
// de lijst, dan blijft de kopie van het openen staan.

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../lib/api', () => ({
  apiFetch: apiFetchMock,
  apiJson: async (url: string, init?: RequestInit) => (await apiFetchMock(url, init)).json(),
}));

import { ZiekteView } from './ZiekteView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const PLANNER = { id: 'p1', name: 'Pieter Planner', role: 'planner', isActive: true } as User;
const CHAUFFEUR = { id: 'c1', name: 'Chauffeur A', role: 'chauffeur', isActive: true } as User;
const ZIEK = { id: 'z1', userId: 'c1', type: 'ziekte', status: 'approved', startDate: '2026-11-02', endDate: '2026-11-06', createdAt: '2026-11-02T06:00:00.000Z' } as LeaveRequest;

const toon = (leaveRequests: LeaveRequest[]) => (
  <ZiekteView user={PLANNER} users={[PLANNER, CHAUFFEUR]} leaveRequests={leaveRequests} shifts={[] as Shift[]} onSickReport={vi.fn().mockResolvedValue(true)} onSave={vi.fn().mockResolvedValue(true)} />
);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T10:00:00+01:00'), toFake: ['Date'] });
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async () => Response.json({ reeksen: [] }));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Ziekte: het detail volgt de live lijst', () => {
  it('toont de bijgestelde einddatum van een collega, en houdt de kopie als het record verdwijnt', async () => {
    const { rerender } = render(toon([ZIEK]));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bekijk ziekmelding van Chauffeur A/ })); });
    const dialoog = await screen.findByRole('dialog');
    expect(dialoog.textContent).toContain('t/m vrijdag 6 november');

    // Een collega verlengt de ziekte: de lijst (props) verandert, het paneel ook.
    rerender(toon([{ ...ZIEK, endDate: '2026-11-10' }]));
    expect(screen.getByRole('dialog').textContent).toContain('t/m dinsdag 10 november');

    // Het record is weg (verwijderd door een collega): het paneel klapt niet dicht.
    rerender(toon([]));
    expect(screen.getByRole('dialog').textContent).toContain('t/m dinsdag 10 november');
  });
});

// Ronde 6, punt 17: na een geslaagde melding opent het detail van de nieuwe
// melding, en "Stel kandidaten voor" bestaat ook bij één dienst. Het scherm
// staat hier niet op zijn route: het recordadres valt dan terug op lokale
// state (useRecordParam), de rest van het gedrag is hetzelfde.
describe('Ziekte: ziek melden schakelt door naar het detail van de nieuwe melding', () => {
  const TWEEDE = { id: 'c2', name: 'Chauffeur B', role: 'chauffeur', isActive: true } as User;
  const NIEUW = { id: 'z-nieuw', userId: 'c2', type: 'ziekte', status: 'approved', startDate: '2026-11-05', endDate: '2026-11-05', createdAt: '2026-11-05T09:00:00.000Z' } as LeaveRequest;
  const even = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const scherm = (leaveRequests: LeaveRequest[], onSickReport: (p: { userId: string; startDate?: string; endDate?: string; comment?: string }) => Promise<boolean>) => (
    <ZiekteView user={PLANNER} users={[PLANNER, CHAUFFEUR, TWEEDE]} leaveRequests={leaveRequests} shifts={[] as Shift[]} onSickReport={onSickReport} onSave={vi.fn().mockResolvedValue(true)} />
  );
  /** Het meldvenster open met Chauffeur B gekozen; `verstuur` dient de melding in. */
  const vulMeldvenster = async () => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ziek melden' })); });
    const venster = await screen.findByRole('dialog');
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: /Chauffeur/ }), { target: { value: 'c2' } }); });
    return { verstuur: () => act(async () => { fireEvent.submit(venster.querySelector('form')!); }) };
  };
  const meldZiek = async () => { await (await vulMeldvenster()).verstuur(); };
  const detailVan = (naam: string) => screen.queryAllByRole('dialog').find((d) => d.textContent?.includes('Ziekteperiode') && d.textContent.includes(naam));
  /** Het meldvenster is dicht (na zijn uitgang); het detail telt hier niet mee. */
  const meldvensterDicht = () => vi.waitFor(() => expect(screen.queryByRole('heading', { name: 'Ziekmelding registreren' })).toBeNull(), { timeout: 2000 });
  const geenDetail = () => expect(screen.queryAllByRole('dialog').filter((d) => d.textContent?.includes('Ziekteperiode'))).toHaveLength(0);
  /** Wacht tot het detail van `naam` open staat (timers, terugstap en renders hebben geen vaste duur). */
  const detailOpen = (naam: string) => vi.waitFor(() => expect(detailVan(naam)).toBeTruthy(), { timeout: 3000 });

  it('de verse lijst komt binnen vóór de melding terugkeert: het detail van het nieuwe record opent, met precies één melding', async () => {
    let rerender: (ui: React.ReactElement) => void = () => {};
    const onSickReport = vi.fn(async () => {
      // Zoals de datalaag: eerst de verse lijst, dan pas "gelukt".
      rerender(scherm([ZIEK, NIEUW], onSickReport));
      return true;
    });
    ({ rerender } = render(scherm([ZIEK], onSickReport)));
    await meldZiek();
    await detailOpen('Chauffeur B');
    await meldvensterDicht();
    expect(onSickReport).toHaveBeenCalledTimes(1);
    expect(onSickReport).toHaveBeenCalledWith({ userId: 'c2', startDate: '2026-11-05', endDate: '2026-11-05', comment: '' });
  });

  it('de verse lijst komt pas na de melding: het detail opent zodra het nieuwe record er is', async () => {
    const onSickReport = vi.fn().mockResolvedValue(true);
    const { rerender } = render(scherm([ZIEK], onSickReport));
    await meldZiek();
    await meldvensterDicht();
    // Nog niets te openen: de lijst kent de melding nog niet.
    geenDetail();
    rerender(scherm([ZIEK, NIEUW], onSickReport));
    await detailOpen('Chauffeur B');
    expect(onSickReport).toHaveBeenCalledTimes(1);
  });

  it('een bestaande melding met dezelfde periode is niet "de nieuwe"', async () => {
    // De server weigert dit geval (409); zegt hij toch "gelukt" zonder nieuw
    // record, dan opent er niets en blijft het scherm op de lijst.
    const BESTAAND = { ...NIEUW, id: 'z-bestaand' } as LeaveRequest;
    const onSickReport = vi.fn().mockResolvedValue(true);
    const { rerender } = render(scherm([ZIEK, BESTAAND], onSickReport));
    await meldZiek();
    rerender(scherm([ZIEK, { ...BESTAAND }], onSickReport));
    await meldvensterDicht();
    await even();
    geenDetail();
  });

  it('mislukt de melding, dan blijft het venster open met de invoer en opent er geen detail', async () => {
    const onSickReport = vi.fn().mockResolvedValue(false);
    const { rerender } = render(scherm([ZIEK], onSickReport));
    await meldZiek();
    await vi.waitFor(() => expect(onSickReport).toHaveBeenCalledTimes(1));
    rerender(scherm([ZIEK, NIEUW], onSickReport));
    await even();
    expect(screen.getByRole('heading', { name: 'Ziekmelding registreren' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: /Chauffeur/ }) as HTMLSelectElement).value).toBe('c2');
    expect(detailVan('Chauffeur B')).toBeUndefined();
  });

  it('opent de planner intussen zelf een andere melding, dan vervalt het doorschakelen', async () => {
    const onSickReport = vi.fn().mockResolvedValue(true);
    const { rerender } = render(scherm([ZIEK], onSickReport));
    await meldZiek();
    await meldvensterDicht();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bekijk ziekmelding van Chauffeur A/ })); });
    await detailOpen('Chauffeur A');
    rerender(scherm([ZIEK, NIEUW], onSickReport));
    await even();
    expect(detailVan('Chauffeur A')).toBeTruthy();
    expect(detailVan('Chauffeur B')).toBeUndefined();
  });

  // Tegenlezing ronde 6: het detail komt op de plek van het meldvenster, met
  // "Melding verwijderen" waar net "Ziekmelding registreren" stond. Een klik
  // die nog bij het melden hoort mag de verse melding niet verwijderen.
  describe('rem na het doorschakelen', () => {
    const knop = (naam: RegExp) => screen.getByRole('button', { name: naam }) as HTMLButtonElement;
    /** Een gesloten venster ruimt zijn stap in de historiek op (src/lib/lagen.ts); wacht daarop. */
    const historiekSchoon = () => vi.waitFor(() => expect((window.history.state as { vhbOverlay?: unknown } | null)?.vhbOverlay).toBeUndefined(), { timeout: 2000 });
    const metOnSave = (leaveRequests: LeaveRequest[], onSickReport: () => Promise<boolean>, onSave: (r: LeaveRequest[]) => Promise<boolean>) => (
      <ZiekteView user={PLANNER} users={[PLANNER, CHAUFFEUR, TWEEDE]} leaveRequests={leaveRequests} shifts={[] as Shift[]} onSickReport={onSickReport} onSave={onSave} />
    );

    it('hersteld melden en verwijderen staan kort uit en doen dan niets; daarna werken ze gewoon', async () => {
      const onSickReport = vi.fn().mockResolvedValue(true);
      const onSave = vi.fn().mockResolvedValue(true);
      const { rerender } = render(metOnSave([ZIEK], onSickReport, onSave));
      await meldZiek();
      rerender(metOnSave([ZIEK, NIEUW], onSickReport, onSave));
      await detailOpen('Chauffeur B');

      expect(knop(/^Melding verwijderen/).disabled).toBe(true);
      expect(knop(/^Hersteld/).disabled).toBe(true);
      await act(async () => { fireEvent.click(knop(/^Melding verwijderen/)); fireEvent.click(knop(/^Hersteld/)); });
      expect(onSave).not.toHaveBeenCalled();
      expect(detailVan('Chauffeur B')).toBeTruthy();

      // De rem valt vanzelf weg; een bewuste klik verwijdert dan precies die melding.
      await vi.waitFor(() => expect(knop(/^Melding verwijderen/).disabled).toBe(false), { timeout: 3000 });
      expect(knop(/^Hersteld/).disabled).toBe(false);
      expect(onSave).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(knop(/^Melding verwijderen/)); });
      await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith([ZIEK]);
      // Het detail sluit na het verwijderen en ruimt zijn stap in de historiek op.
      await vi.waitFor(() => expect(detailVan('Chauffeur B')).toBeUndefined(), { timeout: 2000 });
      await historiekSchoon();
    });

    it('een detail dat de planner zelf opent kent de rem niet, ook niet dat van de net gemelde persoon', async () => {
      const onSickReport = vi.fn().mockResolvedValue(true);
      const onSave = vi.fn().mockResolvedValue(true);
      const { rerender } = render(metOnSave([ZIEK], onSickReport, onSave));
      await meldZiek();
      rerender(metOnSave([ZIEK, NIEUW], onSickReport, onSave));
      await detailOpen('Chauffeur B');
      expect(knop(/^Melding verwijderen/).disabled).toBe(true);

      // Meteen weer dicht en zelf dezelfde melding openen in de lijst: geen rem.
      // De sluitknop van het detail zelf: het meldvenster kan nog in zijn uitgang staan.
      await act(async () => { fireEvent.click(within(detailVan('Chauffeur B')!).getAllByRole('button', { name: 'Sluiten' })[0]); });
      await vi.waitFor(() => expect(detailVan('Chauffeur B')).toBeUndefined(), { timeout: 2000 });
      await historiekSchoon();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bekijk ziekmelding van Chauffeur B/ })); });
      await detailOpen('Chauffeur B');
      expect(knop(/^Melding verwijderen/).disabled).toBe(false);
      expect(knop(/^Hersteld/).disabled).toBe(false);
    });
  });

  // De zoekopdracht naar de nieuwe melding is tien seconden houdbaar: komt
  // het record pas later in de lijst (de herlaad mislukte, realtime brengt
  // het na), dan springt er geen detail meer open midden in ander werk.
  describe('houdbaarheid van de zoekopdracht', () => {
    const stap = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    /** De melding versturen met een klok die de test zelf opschuift (de termijn loopt vanaf het antwoord). */
    const meldMetEigenKlok = async () => {
      const { verstuur } = await vulMeldvenster();
      vi.useFakeTimers({ now: new Date('2026-11-05T10:00:00+01:00'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      await verstuur();
    };
    // Terug naar de echte klok vóór het scherm afbreekt (deze hook loopt vóór
    // de afterEach bovenaan): het opruimen van de lagen plant een taak, en
    // die mag niet op een klok staan die daarna verdwijnt, anders opent er
    // in de volgende tests geen venster meer via `naOpruimen`.
    afterEach(async () => {
      await stap(50);
      vi.useRealTimers();
    });

    it('binnen de tien seconden opent het detail nog', async () => {
      const onSickReport = vi.fn().mockResolvedValue(true);
      const { rerender } = render(scherm([ZIEK], onSickReport));
      await meldMetEigenKlok();
      await meldvensterDicht();
      // Ruim binnen de termijn: het wachten hierboven schuift de klok ook op.
      await stap(5_000);
      rerender(scherm([ZIEK, NIEUW], onSickReport));
      await detailOpen('Chauffeur B');
    });

    it('na tien seconden opent er niets meer: het scherm blijft op de lijst', async () => {
      const onSickReport = vi.fn().mockResolvedValue(true);
      const { rerender } = render(scherm([ZIEK], onSickReport));
      await meldMetEigenKlok();
      await meldvensterDicht();
      await stap(10_000);
      rerender(scherm([ZIEK, NIEUW], onSickReport));
      await stap(2_000);
      geenDetail();
      // De melding staat wel gewoon in de lijst.
      expect(screen.getByRole('button', { name: /Bekijk ziekmelding van Chauffeur B/ })).toBeTruthy();
    });
  });
});

describe('Ziekte: "Stel kandidaten voor" bij één dienst', () => {
  const ADMIN = { id: 'a1', name: 'Ada Admin', role: 'admin', isActive: true } as User;
  const TWEEDE = { id: 'c2', name: 'Chauffeur B', role: 'chauffeur', isActive: true } as User;
  const dienst = (id: string, date: string, line: string) => ({ id, driverId: 'c1', date, line, startTime: '06:00', endTime: '14:00', busNumber: '' }) as Shift;
  const open = async (shifts: Shift[], user: User = ADMIN) => {
    render(<ZiekteView user={user} users={[ADMIN, PLANNER, CHAUFFEUR, TWEEDE]} leaveRequests={[ZIEK]} shifts={shifts} onSickReport={vi.fn().mockResolvedValue(true)} onSave={vi.fn().mockResolvedValue(true)} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bekijk ziekmelding van Chauffeur A/ })); });
    return screen.findByRole('dialog');
  };
  const aanroepen = (pad: string) => apiFetchMock.mock.calls.filter(([url]) => String(url).startsWith(pad));

  beforeEach(() => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/coverage-advisor/batch')) {
        return Response.json({ items: [{ date: '2026-11-05', code: '2101', samenvatting: 'Chauffeur B past, 12 u rust.', passend: [{ id: 'c2', name: 'Chauffeur B' }] }] });
      }
      if (String(url).startsWith('/api/month-planning')) return Response.json({ month: '2026-11', dates: [], drivers: [], cells: {} });
      return Response.json({ reeksen: [] });
    });
  });

  it('één dienst op naam: de knop staat er, het voorstel vult alleen de keuzelijst in en zet niets over', async () => {
    const dialoog = await open([dienst('s1', '2026-11-05', '2101')]);
    const knop = screen.getByRole('button', { name: 'Stel kandidaten voor' }) as HTMLButtonElement;
    // De knop wacht op de kandidatenlijst (het bord van die dag).
    await vi.waitFor(() => expect(knop.disabled).toBe(false), { timeout: 3000 });
    // "Verdeel alles" blijft vanaf twee diensten.
    expect(screen.queryByRole('button', { name: /^Verdeel alles/ })).toBeNull();
    const keuze = screen.getByRole('combobox', { name: /^Vervanger voor dienst 2101/ }) as HTMLSelectElement;
    // Zonder de klik staat er niets ingevuld.
    expect(keuze.value).toBe('');
    expect(aanroepen('/api/coverage-advisor/batch')).toHaveLength(0);

    await act(async () => { fireEvent.click(knop); });
    await vi.waitFor(() => expect(keuze.value).toBe('c2'), { timeout: 3000 });
    expect(aanroepen('/api/coverage-advisor/batch')).toHaveLength(1);
    expect(JSON.parse(String(aanroepen('/api/coverage-advisor/batch')[0][1]?.body))).toEqual({ items: [{ date: '2026-11-05', code: '2101' }] });
    expect(dialoog.textContent).toContain('Chauffeur B past, 12 u rust.');
    // De keuze blijft te wijzigen, en er vertrok geen enkele dienstwissel.
    await act(async () => { fireEvent.change(keuze, { target: { value: '' } }); });
    expect(keuze.value).toBe('');
    expect(aanroepen('/api/admin/shift-swap')).toHaveLength(0);
  });

  it('twee diensten: "Verdeel alles" staat ernaast, zoals voorheen', async () => {
    await open([dienst('s1', '2026-11-05', '2101'), dienst('s2', '2026-11-06', '2607')]);
    expect(screen.getByRole('button', { name: 'Stel kandidaten voor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Verdeel alles/ })).toBeTruthy();
  });

  it('een planner zonder adminrecht ziet de knop niet', async () => {
    await open([dienst('s1', '2026-11-05', '2101')], PLANNER);
    expect(screen.queryByRole('button', { name: 'Stel kandidaten voor' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Vervanger voor dienst/ })).toBeNull();
  });
});
