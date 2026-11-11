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

// Ronde 6, punt 13 (herstel na tegenlezing): de stand van een dag bestaat uit
// twee getallen, het aantal afwezigen en de limiet. Kwamen de limieten niet
// van de server (fout, of een antwoord dat het schema niet haalt), dan staat
// er geen stand en geen knop: de limiet wordt niet geraden uit de standaard.
describe('Verlof: de stand van een dag wacht op de echte limieten', () => {
  const DAG = '2026-11-18';
  const metLimieten = (limieten: () => unknown) => {
    apiJsonMock.mockImplementation(async (pad: string) => {
      if (pad.startsWith('/api/leave/bezetting')) return { dagen: [{ datum: DAG, aantal: 1 }] };
      if (pad === '/api/verlof/limieten') return limieten();
      return {};
    });
  };
  const openDag = async () => {
    render(<LeaveManagementView user={CHAUFFEUR} leaveRequests={[]} users={[CHAUFFEUR]} onSave={vi.fn()} />);
    const cel = await screen.findByRole('button', { name: /^18: .*1 van \d afwezig$/ });
    await act(async () => { fireEvent.click(cel); });
    return cel;
  };
  const vanafKnop = () => screen.queryByRole('button', { name: 'Verlof aanvragen vanaf deze dag' });

  it('geldige limieten: de stand rekent met de limiet van de server en de knop staat er', async () => {
    metLimieten(() => ({ standaard: 1, periodes: [] }));
    await openDag();
    expect(await screen.findByText('Volzet, 1 van 1 afwezig')).toBeTruthy();
    expect(document.querySelector('[data-dagstand]')?.getAttribute('data-dagstand')).toBe('volzet');
    expect(vanafKnop()).toBeTruthy();
  });

  it('limieten mislukt: geen stand en geen knop, de kalendercel kleurt zoals vroeger met de standaard', async () => {
    metLimieten(() => { throw new Error('kapot'); });
    const cel = await openDag();
    expect(cel.getAttribute('aria-label')).toBe('18: deels vrij, 1 van 2 afwezig');
    expect(await screen.findByText('De bezetting van deze dag is niet geladen.')).toBeTruthy();
    expect(document.querySelector('[data-dagstand]')).toBeNull();
    expect(vanafKnop()).toBeNull();
  });

  it('een antwoord met een ongeldige periode telt als niet geladen, ook al is het een 200', async () => {
    // parseVerlofLimieten valt dan terug op de standaard van 2 en verliest perDag.
    metLimieten(() => ({ standaard: 1, periodes: [{ id: 'p1', naam: '', van: '2026-11-01', tot: '2026-11-30', max: 0 }], perDag: { [DAG]: 0 } }));
    await openDag();
    expect(await screen.findByText('De bezetting van deze dag is niet geladen.')).toBeTruthy();
    expect(document.querySelector('[data-dagstand]')).toBeNull();
    expect(vanafKnop()).toBeNull();
  });
});
