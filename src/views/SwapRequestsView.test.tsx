import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SwapRequestsView } from './SwapRequestsView';
import type { Shift, SwapRequest, User } from '../types';

/**
 * Controle 29-09, nr. 24: de titel van de wijzigingsgeschiedenis toonde de dag
 * van de dienst als rauwe ISO-datum ("Naam, 2026-09-28"). In beeld staat een
 * datum altijd als dag/maand/jaar.
 */
vi.mock('../lib/api', async (origineel) => ({
  ...(await origineel<typeof import('../lib/api')>()),
  apiJson: vi.fn().mockResolvedValue([]),
}));

const PLANNER = { id: '2', name: 'Planner Test', role: 'planner', employeeId: 'VHB-000002', email: 'planner@vhb.be', isActive: true } as User;
const AANVRAGER = { id: '42', name: 'Jan Peeters', role: 'chauffeur', employeeId: 'VHB-000042', email: 'jan@vhb.be', isActive: true } as User;
const COLLEGA = { id: '7', name: 'An Maes', role: 'chauffeur', employeeId: 'VHB-000007', email: 'an@vhb.be', isActive: true } as User;

const ruil = (extra: Partial<SwapRequest> = {}) => ({
  id: 'r1', shiftId: 's1', requesterId: AANVRAGER.id, targetDriverId: COLLEGA.id, status: 'accepted',
  createdAt: '2026-09-20T08:00:00.000Z', shiftDate: '2026-09-28', shiftLine: '2505', returnDate: '2026-10-02', returnCode: 'vrij',
  ...extra,
}) as SwapRequest;

const toon = async (swaps: SwapRequest[], shifts: Shift[] = []) => {
  await act(async () => {
    render(<SwapRequestsView user={PLANNER} swaps={swaps} shifts={shifts} users={[PLANNER, AANVRAGER, COLLEGA]} onSave={() => {}} />);
  });
};
/** Opent de geschiedenis van de eerste ruil en geeft de tekst van het venster terug. */
const openGeschiedenis = async () => {
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Wijzigingsgeschiedenis', hidden: true })[0]); });
  const venster = await screen.findByRole('dialog', { name: 'Wijzigingsgeschiedenis' });
  return venster.textContent ?? '';
};

describe('Dienstruil, titel van de wijzigingsgeschiedenis', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/dienstruil'); });

  it('toont de dag van de dienst als dd/mm/jjjj, nooit als ISO-datum', async () => {
    await toon([ruil()]);
    const tekst = await openGeschiedenis();
    expect(tekst).toContain('Jan Peeters, 28/09/2026');
    expect(tekst).not.toContain('2026-09-28');
  });

  it('valt terug op de dag uit de planning als de ruil zelf geen dag draagt', async () => {
    const dienst = { id: 's1', date: '2026-10-05', startTime: '06:00', endTime: '14:00', line: '2505', busNumber: '', driverId: AANVRAGER.id } as Shift;
    await toon([ruil({ shiftDate: undefined, shiftLine: undefined })], [dienst]);
    const tekst = await openGeschiedenis();
    expect(tekst).toContain('Jan Peeters, 05/10/2026');
    expect(tekst).not.toContain('2026-10-05');
  });

  it('zonder dag alleen de naam, geen losse komma', async () => {
    await toon([ruil({ shiftDate: undefined, shiftLine: undefined })]);
    const tekst = await openGeschiedenis();
    expect(tekst).toContain('Jan Peeters');
    expect(tekst).not.toContain('Jan Peeters,');
  });
});
