import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const meldSchrijffout = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/api')>(), apiFetch }));
vi.mock('../../lib/ui', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/ui')>(), notify }));
vi.mock('../../lib/fouten', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/fouten')>(), meldSchrijffout }));

import type { MonthCell } from '../../lib/monthPlanning';
import type { Cellen, GekozenCel } from '../../lib/maandplanning';
import { useDienstwissel } from './useDienstwissel';

/**
 * De handmatige dienstwissel en het terugdraaien, zoals ze tot 09-10 in
 * CapacityView.tsx stonden: welke dienst er over te zetten is, wanneer het
 * een 1-op-1-wissel wordt, de body van de POST en de PATCH, de meldingen,
 * en dat terugdraaien eerst om een bevestiging vraagt.
 */
const antwoord = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const dienst2101: MonthCell = { code: '2101', kind: 'service', label: 'Dienst 2101', segments: [] };
const dienst2102: MonthCell = { code: '2102', kind: 'service', label: 'Dienst 2102', segments: [] };
const ziek: MonthCell = { code: 'ziek', kind: 'absence', label: 'Ziek', segments: [], hiddenService: '2103' };
const vrij: MonthCell = { code: 'vrij', kind: 'unknown', label: 'Vrij', segments: [] };
const geruild: MonthCell = { ...dienst2101, swapId: 'swp 1', swapFrom: 'Alex Du Priez' };
const cells: Cellen = { '7': { '2026-10-15': dienst2101 }, '8': { '2026-10-15': dienst2102 }, '9': { '2026-10-15': ziek } };
const drivers = [{ id: '7', name: 'Rudy Dhaenens' }, { id: '8', name: 'Alex Du Priez' }, { id: '9', name: 'Diether Van Haute' }];
const cel = (driverId: string, cell: MonthCell): GekozenCel => ({ driverName: drivers.find((d) => d.id === driverId)!.name, driverId, iso: '2026-10-15', cell });
const opDienst = cel('7', dienst2101);
const opZiek = cel('9', ziek);

const opzet = (selected: GekozenCel | null = opDienst) => {
  const sluit = vi.fn();
  const herlaad = vi.fn();
  const hook = renderHook((p: { selected: GekozenCel | null }) => useDienstwissel({ selected: p.selected, sluit, drivers, cells, herlaad }), { initialProps: { selected } });
  return { ...hook, sluit, herlaad, nu: () => hook.result.current };
};

beforeEach(() => { apiFetch.mockReset(); notify.mockClear(); meldSchrijffout.mockClear(); });
afterEach(() => { cleanup(); });

describe('welke dienst en welke reden', () => {
  it('een dienst-cel geeft haar dienst, een afwezigheidscel de dienst eronder, een vrije cel of geen cel niets', () => {
    expect(opzet(opDienst).nu()).toMatchObject({ wisselDienst: '2101', wisselNaAfwezigheid: false });
    expect(opzet(opZiek).nu()).toMatchObject({ wisselDienst: '2103', wisselNaAfwezigheid: true });
    expect(opzet(cel('8', vrij)).nu()).toMatchObject({ wisselDienst: null, wisselNaAfwezigheid: false });
    expect(opzet(null).nu()).toMatchObject({ wisselDienst: null, wisselNaAfwezigheid: false });
  });

  it('de reden is de keuze, met de toelichting erachter; bij Andere correctie alleen de toelichting; klaar pas met chauffeur én reden', () => {
    const { nu } = opzet();
    expect(nu()).toMatchObject({ wisselReden: 'Ziekte', wisselRedenTekst: 'Ziekte', wisselKlaar: false, wisselBevestigen: false, isWisselen: false });
    act(() => { nu().setWisselNaar('8'); });
    expect(nu().wisselKlaar).toBe(true);
    act(() => { nu().setWisselToelichting('  gebeld om 10u  '); });
    expect(nu().wisselRedenTekst).toBe('Ziekte, gebeld om 10u');
    act(() => { nu().setWisselReden('Andere correctie'); });
    expect(nu().wisselRedenTekst).toBe('gebeld om 10u');
    act(() => { nu().setWisselToelichting(' '); });
    expect(nu()).toMatchObject({ wisselRedenTekst: '', wisselKlaar: false });
  });

  it('1-op-1: rijdt de gekozen chauffeur die dag zelf, dan komt zijn dienst terug; niet vanaf een afwezigheidscel', () => {
    const a = opzet(opDienst);
    act(() => { a.nu().setWisselNaar('8'); });
    expect(a.nu()).toMatchObject({ wisselTerug: '2102', wisselNaarNaam: 'Alex Du Priez' });
    act(() => { a.nu().setWisselNaar('9'); });
    expect(a.nu()).toMatchObject({ wisselTerug: null, wisselNaarNaam: 'Diether Van Haute' });
    act(() => { a.nu().setWisselNaar('onbekend'); });
    expect(a.nu().wisselNaarNaam).toBe('—');
    const b = opzet(opZiek);
    act(() => { b.nu().setWisselNaar('8'); });
    expect(b.nu().wisselTerug).toBeNull();
  });

  it('een andere cel geeft een vers formulier', () => {
    const { nu, rerender } = opzet();
    act(() => { nu().setWisselNaar('8'); nu().setWisselReden('Mondelinge dienstruil'); nu().setWisselToelichting('ok'); });
    rerender({ selected: opZiek });
    expect(nu()).toMatchObject({ wisselNaar: '', wisselReden: 'Ziekte', wisselToelichting: '' });
  });
});

describe('dienstwissel doorvoeren', () => {
  it('POST met dezelfde body (met returnLine bij een 1-op-1), dan de toast, sluiten en herladen in die volgorde', async () => {
    const { nu, sluit, herlaad } = opzet();
    act(() => { nu().setWisselNaar('8'); nu().setWisselToelichting('mondeling'); });
    apiFetch.mockResolvedValueOnce(antwoord({ ok: true }));
    await act(async () => { await nu().uitvoerenWissel(); });
    expect(apiFetch).toHaveBeenCalledWith('/api/admin/shift-swap', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-15', line: '2101', fromDriverId: '7', toDriverId: '8', reason: 'Ziekte, mondeling', returnLine: '2102' }),
    });
    expect(notify).toHaveBeenCalledWith('Diensten 2101 en 2102 gewisseld, beide chauffeurs krijgen een melding.', 'success');
    expect(sluit).toHaveBeenCalledTimes(1);
    expect(herlaad).toHaveBeenCalledTimes(1);
    expect(notify.mock.invocationCallOrder[0]).toBeLessThan(sluit.mock.invocationCallOrder[0]);
    expect(sluit.mock.invocationCallOrder[0]).toBeLessThan(herlaad.mock.invocationCallOrder[0]);
    expect(nu().isWisselen).toBe(false);
  });

  it('vanaf een afwezigheidscel: de dienst eronder, zonder returnLine, met de eigen toast', async () => {
    const { nu } = opzet(opZiek);
    act(() => { nu().setWisselNaar('8'); });
    apiFetch.mockResolvedValueOnce(antwoord({ ok: true }));
    await act(async () => { await nu().uitvoerenWissel(); });
    expect(apiFetch).toHaveBeenCalledWith('/api/admin/shift-swap', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-15', line: '2103', fromDriverId: '9', toDriverId: '8', reason: 'Ziekte' }),
    });
    expect(notify).toHaveBeenCalledWith('Dienst 2103 overgezet, beide chauffeurs krijgen een melding.', 'success');
  });

  it('niet klaar: er vertrekt niets', async () => {
    const { nu, sluit } = opzet();
    await act(async () => { await nu().uitvoerenWissel(); });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(sluit).not.toHaveBeenCalled();
  });

  it('een fout geeft dezelfde melding zonder Opnieuw proberen; het venster blijft open en er wordt niet herladen', async () => {
    const { nu, sluit, herlaad } = opzet();
    act(() => { nu().setWisselNaar('8'); });
    apiFetch.mockResolvedValueOnce(antwoord({ error: 'Alex rijdt die dag al 2102' }, 409));
    await act(async () => { await nu().uitvoerenWissel(); });
    expect(meldSchrijffout).toHaveBeenCalledWith('Dienstwissel', { status: 409, message: 'Alex rijdt die dag al 2102' });
    expect(meldSchrijffout.mock.calls[0]).toHaveLength(2);
    const fout = new Error('offline');
    apiFetch.mockRejectedValueOnce(fout);
    await act(async () => { await nu().uitvoerenWissel(); });
    expect(meldSchrijffout).toHaveBeenLastCalledWith('Dienstwissel', fout);
    expect(notify).not.toHaveBeenCalled();
    expect(sluit).not.toHaveBeenCalled();
    expect(herlaad).not.toHaveBeenCalled();
    expect(nu().isWisselen).toBe(false);
  });
});

describe('wissel terugdraaien', () => {
  it('vraagt eerst de bevestiging: de vlag staat uit, aanzetten stuurt niets, pas uitvoeren doet de PATCH', async () => {
    const { nu, sluit, herlaad } = opzet(cel('7', geruild));
    expect(nu()).toMatchObject({ terugdraaien: false, isTerugdraaien: false });
    act(() => { nu().setTerugdraaien(true); });
    expect(nu().terugdraaien).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();

    apiFetch.mockResolvedValueOnce(antwoord({ ok: true }));
    await act(async () => { await nu().uitvoerenTerugdraai(); });
    expect(apiFetch).toHaveBeenCalledWith('/api/swaps/swp%201', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', ifStatus: 'approved' }),
    });
    expect(notify).toHaveBeenCalledWith('Wissel teruggedraaid, de dienst staat weer op de oorspronkelijke chauffeur.', 'success');
    expect(sluit).toHaveBeenCalledTimes(1);
    expect(herlaad).toHaveBeenCalledTimes(1);
    expect(sluit.mock.invocationCallOrder[0]).toBeLessThan(herlaad.mock.invocationCallOrder[0]);
    expect(nu().isTerugdraaien).toBe(false);
  });

  it('zonder ruil op de cel vertrekt er niets', async () => {
    const { nu } = opzet(opDienst);
    await act(async () => { await nu().uitvoerenTerugdraai(); });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('mislukt: dezelfde melding mét Opnieuw proberen, dat dezelfde PATCH nog eens doet', async () => {
    const { nu, sluit } = opzet(cel('7', geruild));
    apiFetch.mockResolvedValueOnce(antwoord({ error: 'Al afgehandeld' }, 409));
    await act(async () => { await nu().uitvoerenTerugdraai(); });
    expect(meldSchrijffout).toHaveBeenCalledWith('Terugdraaien', { status: 409, message: 'Al afgehandeld' }, expect.any(Function));
    expect(sluit).not.toHaveBeenCalled();
    apiFetch.mockResolvedValueOnce(antwoord({ ok: true }));
    await act(async () => { meldSchrijffout.mock.calls[0][2](); await Promise.resolve(); await Promise.resolve(); });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(sluit).toHaveBeenCalledTimes(1);

    const fout = new Error('offline');
    apiFetch.mockRejectedValueOnce(fout);
    await act(async () => { await nu().uitvoerenTerugdraai(); });
    expect(meldSchrijffout).toHaveBeenLastCalledWith('Terugdraaien', fout, expect.any(Function));
  });
});
