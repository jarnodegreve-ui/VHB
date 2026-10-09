import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const meldSchrijffout = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/api')>(), apiFetch }));
vi.mock('../../lib/ui', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/ui')>(), notify }));
vi.mock('../../lib/fouten', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/fouten')>(), meldSchrijffout }));

import type { MonthCell } from '../../lib/monthPlanning';
import { noteKey, WISSEL_REDENEN, type Cellen } from '../../lib/maandplanning';
import { CelDetailModal } from './CelDetailModal';
import { useCelDetail } from './useCelDetail';
import { useDienstwissel } from './useDienstwissel';

/**
 * Het celdetail door de echte hooks heen, zoals de view het sinds stap 3
 * (09-10) samenstelt: de twee objecten als props, en de volgorde van de
 * bevestigingen die bij de verplaatsing gelijk moest blijven.
 */
const antwoord = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const dienst2101: MonthCell = { code: '2101', kind: 'service', label: 'Dienst 2101', segments: ['05:30 - 13:45'] };
const dienst2102: MonthCell = { code: '2102', kind: 'service', label: 'Dienst 2102', segments: [] };
const geruild: MonthCell = { ...dienst2101, swapId: 'swp1', swapFrom: 'Alex Du Priez' };
const drivers = [{ id: '7', name: 'Rudy Dhaenens' }, { id: '8', name: 'Alex Du Priez' }];
const cells: Cellen = { '7': { '2026-10-15': dienst2101 }, '8': { '2026-10-15': dienst2102 } };
const herlaad = vi.fn();

function Harnas({ rol, cel: celVanRudy }: { rol: 'admin' | 'planner' | 'chauffeur'; cel: MonthCell }) {
  const cel = useCelDetail({ monthFrom: '2026-10-01', monthTo: '2026-10-31' });
  const { selected } = cel;
  const wissel = useDienstwissel({ selected, sluit: cel.sluit, drivers, cells, herlaad });
  const canEditNotes = rol !== 'chauffeur';
  const celVuil = !!selected && (
    (canEditNotes && cel.noteDraft !== (cel.notes.get(noteKey(selected.driverId, selected.iso)) ?? ''))
    || wissel.wisselNaar !== '' || wissel.wisselToelichting !== '' || wissel.wisselReden !== WISSEL_REDENEN[0]
  );
  return (
    <>
      {/* rauw: testharnas */}
      <button type="button" onClick={() => cel.open(drivers[0], '2026-10-15', celVanRudy)}>Open cel</button>
      <CelDetailModal
        cel={{ ...cel, vuil: celVuil, canEditNotes }}
        wissel={{ ...wissel, isAdmin: rol === 'admin', drivers, cells, werkdagenPerChauffeur: new Map() }}
      />
    </>
  );
}

const open = async (rol: 'admin' | 'planner' | 'chauffeur', cel: MonthCell) => {
  apiFetch.mockResolvedValueOnce(antwoord([]));
  render(<Harnas rol={rol} cel={cel} />);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Open cel' }));
  await screen.findByRole('dialog');
  await screen.findByRole('heading', { name: 'Rudy Dhaenens' });
};
const dialogenWeg = () => waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

beforeEach(() => { apiFetch.mockReset(); notify.mockClear(); meldSchrijffout.mockClear(); herlaad.mockClear(); });
afterEach(() => { cleanup(); });

describe('CelDetailModal met de hooks', () => {
  it('staf: Wissel terugdraaien opent eerst de bevestiging; pas Terugdraaien doet de PATCH en sluit het venster', async () => {
    await open('planner', geruild);
    fireEvent.click(screen.getByRole('button', { name: 'Wissel terugdraaien' }));
    await screen.findByRole('heading', { name: 'Wissel terugdraaien?' });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    apiFetch.mockResolvedValueOnce(antwoord({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Terugdraaien' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch).toHaveBeenLastCalledWith('/api/swaps/swp1', { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', ifStatus: 'approved' }) });
    await dialogenWeg();
    expect(herlaad).toHaveBeenCalledTimes(1);
  });

  it('admin: een chauffeur kiezen en overzetten opent de bevestiging met de reden; Doorvoeren doet de POST', async () => {
    await open('admin', dienst2101);
    expect((screen.getByRole('button', { name: 'Dienst overzetten…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nieuwe chauffeur'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Toelichting bij de reden'), { target: { value: 'mondeling' } });
    // Alex rijdt die dag 2102: een 1-op-1-wissel.
    fireEvent.click(screen.getByRole('button', { name: 'Diensten wisselen…' }));
    await screen.findByRole('heading', { name: 'Dienstwissel doorvoeren?' });
    expect(screen.getByText(/dienst 2101 van Rudy Dhaenens naar Alex Du Priez, en dienst 2102 van Alex Du Priez naar Rudy Dhaenens\. Reden: Ziekte, mondeling\./)).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    apiFetch.mockResolvedValueOnce(antwoord({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Doorvoeren' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/shift-swap', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-15', line: '2101', fromDriverId: '7', toDriverId: '8', reason: 'Ziekte, mondeling', returnLine: '2102' }),
    });
    await dialogenWeg();
    expect(herlaad).toHaveBeenCalledTimes(1);
  });

  it('planner: geen dienstwissel-blok; een notitie typen en opslaan doet de PUT en sluit het venster', async () => {
    await open('planner', dienst2101);
    expect(screen.queryByText('Dienstwissel (admin)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Notitie voor de chauffeur'), { target: { value: 'Neem bus 412.' } });
    apiFetch.mockResolvedValueOnce(antwoord({}));
    fireEvent.click(screen.getByRole('button', { name: 'Notitie opslaan' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch).toHaveBeenLastCalledWith('/api/planning-notes', { method: 'PUT', body: JSON.stringify({ driverId: '7', date: '2026-10-15', note: 'Neem bus 412.' }) });
    expect(notify).toHaveBeenCalledWith('Notitie opgeslagen, de chauffeur krijgt een melding.', 'success');
    await dialogenWeg();
    expect(herlaad).not.toHaveBeenCalled();
  });

  it('chauffeur: geen notitieveld, geen wissel en geen terugdraaien, wel de uren', async () => {
    await open('chauffeur', geruild);
    expect(screen.queryByLabelText('Notitie voor de chauffeur')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wissel terugdraaien' })).toBeNull();
    expect(screen.queryByText('Dienstwissel (admin)')).toBeNull();
    expect(screen.getByText('05:30 - 13:45')).toBeTruthy();
    expect(screen.getByText(/Geruild van/)).toBeTruthy();
  });
});
