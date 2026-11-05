import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LeaveRequest, User } from '../types';

// Een eigen openstaande aanvraag intrekken (controle 04-11, punt 40): één
// record verwijderen gaat met een ongedaan-toast, niet met een
// bevestigvenster (huisregel, zoals een ziekmelding verwijderen). Dus: meteen
// bewaard zonder de aanvraag, en "Ongedaan maken" zet haar terug.

const { apiJsonMock } = vi.hoisted(() => ({ apiJsonMock: vi.fn() }));
vi.mock('../lib/api', () => ({
  apiJson: apiJsonMock,
  apiFetch: vi.fn(async () => new Response('{}', { status: 200 })),
}));

import { LeaveManagementView } from './LeaveManagementView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const CHAUFFEUR = { id: 'c1', name: 'Chauffeur A', employeeId: 'C1', role: 'chauffeur', isActive: true, verlofbudget: 24 } as User;
const AANVRAAG = { id: 'l1', userId: 'c1', type: 'betaald_verlof', status: 'pending', startDate: '2026-12-07', endDate: '2026-12-08', createdAt: '2026-11-01T08:00:00.000Z' } as LeaveRequest;

type Toast = { message: string; tone: string; action?: { label: string; run: () => void } };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T10:00:00+01:00'), toFake: ['Date'] });
  apiJsonMock.mockReset();
  apiJsonMock.mockResolvedValue({});
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Verlof: eigen aanvraag intrekken', () => {
  it('verwijdert meteen en zet de aanvraag terug via Ongedaan maken, zonder bevestigvenster', async () => {
    const toasts: Toast[] = [];
    const opToast = (e: Event) => { toasts.push((e as CustomEvent<Toast>).detail); };
    window.addEventListener('vhb-toast', opToast);
    const onSave = vi.fn().mockResolvedValue(true);
    render(<LeaveManagementView user={CHAUFFEUR} leaveRequests={[AANVRAAG]} users={[CHAUFFEUR]} onSave={onSave} />);

    // De rij openklappen (de periode is de titel), dan intrekken.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /07\/12 – 08\/12\/2026/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Aanvraag intrekken' })); });

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual([]);
    const toast = await waitFor(() => {
      const t = toasts.find((x) => x.message === 'Aanvraag ingetrokken.');
      expect(t).toBeTruthy();
      return t!;
    });
    expect(toast.action?.label).toBe('Ongedaan maken');

    await act(async () => { toast.action!.run(); });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toEqual([AANVRAAG]);
    window.removeEventListener('vhb-toast', opToast);
  });
});
