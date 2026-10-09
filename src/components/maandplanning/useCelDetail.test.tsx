import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const meldSchrijffout = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/api')>(), apiFetch }));
vi.mock('../../lib/ui', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/ui')>(), notify }));
vi.mock('../../lib/fouten', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/fouten')>(), meldSchrijffout }));

import type { MonthCell } from '../../lib/monthPlanning';
import { useCelDetail } from './useCelDetail';

/**
 * Het celdetail met de dienstnotities, zoals het tot 09-10 in CapacityView.tsx
 * stond. Deze tests leggen vast wat bij de verplaatsing gelijk moest blijven:
 * welke aanroep er vertrekt, wat er daarna in de kaart staat, welke melding
 * er komt en wanneer het venster sluit.
 */
const antwoord = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const dienst: MonthCell = { code: '2101', kind: 'service', label: 'Dienst 2101', segments: ['05:30 - 13:45'] };
const rudy = { id: '7', name: 'Rudy Dhaenens', section: 'Regulier' };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const oktober = { monthFrom: '2026-10-01', monthTo: '2026-10-31' };

const opzet = async (notities: unknown = [{ driverId: 7, date: '2026-10-15', note: 'Bus 412' }]) => {
  apiFetch.mockResolvedValueOnce(antwoord(notities));
  const hook = renderHook((p: { monthFrom: string; monthTo: string }) => useCelDetail(p), { initialProps: oktober });
  await flush();
  return { ...hook, nu: () => hook.result.current };
};

beforeEach(() => { apiFetch.mockReset(); notify.mockClear(); meldSchrijffout.mockClear(); });
afterEach(() => { cleanup(); });

describe('notities laden', () => {
  it('vraagt de notities van de maand op bij het openen en opnieuw bij een maandwissel', async () => {
    const { nu, rerender } = await opzet();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/planning-notes?from=2026-10-01&to=2026-10-31');
    expect(nu().notes.get('7:2026-10-15')).toBe('Bus 412');

    apiFetch.mockResolvedValueOnce(antwoord([]));
    rerender({ monthFrom: '2026-11-01', monthTo: '2026-11-30' });
    await flush();
    expect(apiFetch).toHaveBeenLastCalledWith('/api/planning-notes?from=2026-11-01&to=2026-11-30');
    expect(nu().notes.size).toBe(0);
  });

  it('een mislukte of onleesbare laadbeurt laat de kaart met rust: notities zijn nice-to-have', async () => {
    const { nu, rerender } = await opzet();
    apiFetch.mockResolvedValueOnce(antwoord({ error: 'weg' }, 500));
    rerender({ monthFrom: '2026-11-01', monthTo: '2026-11-30' });
    await flush();
    expect(nu().notes.get('7:2026-10-15')).toBe('Bus 412');
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    rerender({ monthFrom: '2026-12-01', monthTo: '2026-12-31' });
    await flush();
    expect(nu().notes.get('7:2026-10-15')).toBe('Bus 412');
    expect(meldSchrijffout).not.toHaveBeenCalled();
  });
});

describe('openen en sluiten', () => {
  it('open zet de cel en de bestaande notitie als concept; een dag zonder notitie geeft een leeg concept; sluit haalt de cel weg', async () => {
    const { nu } = await opzet();
    act(() => { nu().open(rudy, '2026-10-15', dienst); });
    expect(nu().selected).toEqual({ driverName: 'Rudy Dhaenens', driverId: '7', iso: '2026-10-15', cell: dienst });
    expect(nu().noteDraft).toBe('Bus 412');
    act(() => { nu().open(rudy, '2026-10-16', dienst); });
    expect(nu().selected?.iso).toBe('2026-10-16');
    expect(nu().noteDraft).toBe('');
    act(() => { nu().sluit(); });
    expect(nu().selected).toBeNull();
  });
});

describe('notitie opslaan', () => {
  it('PUT met chauffeur, dag en de tekst zoals getypt; daarna de getrimde notitie in de kaart, de toast en het venster dicht', async () => {
    const { nu } = await opzet();
    act(() => { nu().open(rudy, '2026-10-15', dienst); });
    act(() => { nu().setNoteDraft('  Eerst tanken  '); });
    apiFetch.mockResolvedValueOnce(antwoord({}));
    await act(async () => { await nu().saveNote(); });
    expect(apiFetch).toHaveBeenLastCalledWith('/api/planning-notes', {
      method: 'PUT',
      body: JSON.stringify({ driverId: '7', date: '2026-10-15', note: '  Eerst tanken  ' }),
    });
    expect(nu().notes.get('7:2026-10-15')).toBe('Eerst tanken');
    expect(notify).toHaveBeenCalledWith('Notitie opgeslagen, de chauffeur krijgt een melding.', 'success');
    expect(nu().selected).toBeNull();
    expect(nu().isSavingNote).toBe(false);
  });

  it('een lege tekst verwijdert de notitie uit de kaart, met de eigen toast', async () => {
    const { nu } = await opzet();
    act(() => { nu().open(rudy, '2026-10-15', dienst); });
    act(() => { nu().setNoteDraft('   '); });
    apiFetch.mockResolvedValueOnce(antwoord({}));
    await act(async () => { await nu().saveNote(); });
    expect(nu().notes.has('7:2026-10-15')).toBe(false);
    expect(notify).toHaveBeenCalledWith('Notitie verwijderd.', 'success');
    expect(nu().selected).toBeNull();
  });

  it('een fout van de server geeft dezelfde melding met Opnieuw proberen, en het venster blijft open', async () => {
    const { nu } = await opzet();
    act(() => { nu().open(rudy, '2026-10-15', dienst); });
    act(() => { nu().setNoteDraft('Eerst tanken'); });
    apiFetch.mockResolvedValueOnce(antwoord({ error: 'Databank even weg' }, 500));
    await act(async () => { await nu().saveNote(); });
    expect(meldSchrijffout).toHaveBeenCalledWith('Notitie opslaan', { status: 500, message: 'Databank even weg' }, expect.any(Function));
    expect(notify).not.toHaveBeenCalled();
    expect(nu().selected?.driverId).toBe('7');
    expect(nu().notes.get('7:2026-10-15')).toBe('Bus 412');
    expect(nu().isSavingNote).toBe(false);
    // Opnieuw proberen = dezelfde PUT nog eens.
    apiFetch.mockResolvedValueOnce(antwoord({}));
    await act(async () => { meldSchrijffout.mock.calls[0][2](); await flush(); });
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(nu().selected).toBeNull();
  });

  it('een netwerkfout geeft dezelfde melding met de fout zelf', async () => {
    const { nu } = await opzet();
    act(() => { nu().open(rudy, '2026-10-15', dienst); });
    const fout = new Error('offline');
    apiFetch.mockRejectedValueOnce(fout);
    await act(async () => { await nu().saveNote(); });
    expect(meldSchrijffout).toHaveBeenCalledWith('Notitie opslaan', fout, expect.any(Function));
    expect(nu().selected?.driverId).toBe('7');
  });

  it('zonder open cel vertrekt er niets, en tijdens het opslaan geen tweede PUT', async () => {
    const { nu } = await opzet();
    await act(async () => { await nu().saveNote(); });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    act(() => { nu().open(rudy, '2026-10-15', dienst); });
    let klaar!: (v: unknown) => void;
    apiFetch.mockReturnValueOnce(new Promise((r) => { klaar = r; }));
    let eerste!: Promise<void>;
    act(() => { eerste = nu().saveNote(); });
    expect(nu().isSavingNote).toBe(true);
    await act(async () => { await nu().saveNote(); });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    await act(async () => { klaar(antwoord({})); await eerste; });
    expect(nu().isSavingNote).toBe(false);
  });
});
