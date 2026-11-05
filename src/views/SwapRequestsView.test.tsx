import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Shift, SwapRequest, User } from '../types';

const { apiJsonMock, appData } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
  // Wat useOptioneleAppData teruggeeft: null = buiten de app-schil (zoals in
  // de meeste unit-tests), anders de collectiestaat van de datalaag.
  appData: { waarde: null as null | Record<string, unknown> },
}));
vi.mock('../lib/api', () => ({
  apiJson: apiJsonMock,
  apiFetch: vi.fn(async () => new Response('{}', { status: 200 })),
}));
vi.mock('../app/AppDataContext', () => ({
  useOptioneleAppData: () => appData.waarde,
  useAppDataContext: () => appData.waarde,
}));

import { SwapRequestsView } from './SwapRequestsView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const CHAUFFEUR = { id: 'c1', name: 'Chauffeur A', employeeId: 'C1', role: 'chauffeur', isActive: true } as User;
const PLANNER = { id: 'p1', name: 'Pieter Planner', employeeId: 'P1', role: 'planner', isActive: true, phone: '0472 12 34 56' } as User;
const PLANNER_ZONDER_NUMMER = { ...PLANNER, phone: '' } as User;

const toon = (users: User[], swaps: SwapRequest[] = []) => render(
  <SwapRequestsView user={CHAUFFEUR} swaps={swaps} shifts={[] as Shift[]} users={users} onSave={vi.fn().mockResolvedValue(true)} />,
);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T10:00:00+01:00'), toFake: ['Date'] });
  apiJsonMock.mockReset();
  apiJsonMock.mockResolvedValue({ ruilen: [], totaal: 0 });
  appData.waarde = null;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

// De ruilwizard zonder komende dienst zei "Vraag de planning om hulp" zonder
// een weg ernaartoe (controle 04-11, punt 40). Nu dezelfde uitweg als bij een
// verlof-conflict in het rooster: bellen als een planner een nummer heeft,
// anders de weg naar Contacten. Het nummer komt uit de gebruikerslijst.
describe('Dienstruil: wizard zonder komende dienst', () => {
  const openWizard = async () => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dienstruil aanvragen' })); });
    return screen.findByRole('dialog');
  };

  it('toont een belknop naar de planner met een nummer', async () => {
    toon([CHAUFFEUR, PLANNER]);
    const wizard = await openWizard();
    expect(within(wizard).getByText(/Vraag de planning om hulp/)).toBeTruthy();
    expect(within(wizard).getByRole('button', { name: 'Bel de planning' })).toBeTruthy();
    expect(within(wizard).queryByRole('button', { name: 'Contacten' })).toBeNull();
  });

  it('zonder nummer bij planner of beheerder: de weg naar Contacten, geen verzonnen nummer', async () => {
    toon([CHAUFFEUR, PLANNER_ZONDER_NUMMER]);
    const wizard = await openWizard();
    expect(within(wizard).queryByRole('button', { name: 'Bel de planning' })).toBeNull();
    expect(within(wizard).getByRole('button', { name: 'Contacten' })).toBeTruthy();
  });
});

// Een laadfout van de ruilen (voor een chauffeur laden ze uitgesteld) toonde
// "Nog geen ruilverzoeken" en "Geen openstaande dienstruilen". Dat is het
// patroon van ServicesView en MeldingenView: bij foutZonderData een Foutkaart
// met Opnieuw proberen, geen lege staat (controle 04-11, punt 8).
describe('Dienstruil: laadfout zonder gegevens', () => {
  it('toont in beide kolommen de Foutkaart met Opnieuw proberen, geen lege staat', async () => {
    const herlaadCollectie = vi.fn().mockResolvedValue(undefined);
    appData.waarde = { collectieStaat: { swaps: { geslaagd: false, mislukt: true } }, herlaadCollectie };
    toon([CHAUFFEUR, PLANNER]);
    expect(screen.getAllByText('De dienstruilen konden niet laden.')).toHaveLength(2);
    expect(screen.queryByText('Nog geen ruilverzoeken')).toBeNull();
    expect(screen.queryByText('Geen openstaande dienstruilen')).toBeNull();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Opnieuw/ })[0]); });
    expect(herlaadCollectie).toHaveBeenCalledWith('swaps');
  });

  it('zonder fout blijft de lege staat zoals ze was', async () => {
    appData.waarde = { collectieStaat: { swaps: { geslaagd: true, mislukt: false } }, herlaadCollectie: vi.fn() };
    toon([CHAUFFEUR, PLANNER]);
    // Mijn verzoeken wacht eerst op het archief ("Laden…"), dan pas de lege staat.
    expect(await screen.findByText('Nog geen ruilverzoeken')).toBeTruthy();
    expect(screen.getByText('Geen openstaande dienstruilen')).toBeTruthy();
    expect(screen.queryByText('De dienstruilen konden niet laden.')).toBeNull();
  });
});
