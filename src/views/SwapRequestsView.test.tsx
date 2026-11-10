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

// Ronde 6, punt 16: in de beheertabel op desktop stond de rustwaarschuwing niet
// in de rij en waren Goedkeuren en Afwijzen iconen van één klik. Nu staat de
// waarschuwing in de statuscel, opent Goedkeuren bij te weinig rust eerst het
// paneel met de rustregels (een waarschuwing, geen blokkade) en vraagt Afwijzen
// altijd eerst een bevestiging. Zonder waarschuwing blijft Goedkeuren één klik.
// jsdom kent de CSS niet: de tabel (`hidden md:block`) staat hier gewoon in de
// boom, naast de telefoonlijst. De echte breedtes staan in de e2e-spec.
describe('Dienstruil: beheertabel op desktop', () => {
  const ALEX = { id: 'c2', name: 'Alex Collega', employeeId: 'C2', role: 'chauffeur', isActive: true } as User;
  const ADMIN = { id: 'a1', name: 'Ada Admin', employeeId: 'A1', role: 'admin', isActive: true } as User;
  const DAG = '2026-11-20';
  const TE_KORT: SwapRequest['rust'] = [{ wie: 'collega', datum: DAG, dienst: '2505', rustVoor: 340, rustNa: null, teKort: true }];
  const GENOEG: SwapRequest['rust'] = [{ wie: 'collega', datum: DAG, dienst: '2505', rustVoor: 660, rustNa: null, teKort: false }];
  const ruil = (extra: Partial<SwapRequest> = {}): SwapRequest => ({
    id: 'r1', shiftId: 's1', requesterId: CHAUFFEUR.id, targetDriverId: ALEX.id, status: 'accepted',
    createdAt: '2026-11-04T08:00:00.000Z', shiftDate: DAG, shiftLine: '2505', returnDate: '2026-11-25', returnCode: 'vrij', ...extra,
  });
  const beheer = (kijker: User, swaps: SwapRequest[], onDecide = vi.fn().mockResolvedValue(true)) => (
    <SwapRequestsView user={kijker} swaps={swaps} shifts={[] as Shift[]} users={[CHAUFFEUR, ALEX, PLANNER, ADMIN]} onSave={vi.fn().mockResolvedValue(true)} onDecide={onDecide} />
  );
  const toonBeheer = (kijker: User, swaps: SwapRequest[]) => {
    const onDecide = vi.fn().mockResolvedValue(true);
    return { onDecide, ...render(beheer(kijker, swaps, onDecide)) };
  };
  const tabel = () => within(screen.getByRole('table', { name: 'Dienstruilen' }));
  const klik = async (knop: HTMLElement) => { await act(async () => { fireEvent.click(knop); }); };
  /** Het beoordelingspaneel draagt de naam van de aanvrager. */
  const paneel = () => screen.findByRole('dialog', { name: CHAUFFEUR.name });

  it('te weinig rust: de badge staat in de rij en Goedkeuren opent eerst het paneel, zonder te beslissen', async () => {
    const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
    expect(tabel().getByText('Te weinig rust')).toBeTruthy();
    expect(tabel().queryByRole('button', { name: 'Goedkeuren' })).toBeNull();
    const knop = tabel().getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd' });
    expect(knop.getAttribute('title')).toBe('Bekijk eerst de rusttijd');
    await klik(knop);
    const open = await paneel();
    expect(within(open).getByRole('region', { name: 'Rusttijd' }).textContent).toContain('Te weinig rust: Alex Collega, dienst 2505');
    expect(onDecide).not.toHaveBeenCalled();
    // Een waarschuwing, geen blokkade: in het paneel kan de planner nog altijd goedkeuren.
    await klik(within(open).getByRole('button', { name: 'Goedkeuren' }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'accepted');
  });

  it('zonder waarschuwing (geen rust of genoeg rust) keurt Goedkeuren in één klik goed, zoals vroeger', async () => {
    const { onDecide } = toonBeheer(PLANNER, [ruil(), ruil({ id: 'r2', shiftLine: '2606', rust: GENOEG })]);
    expect(tabel().queryByText('Te weinig rust')).toBeNull();
    const knoppen = tabel().getAllByRole('button', { name: 'Goedkeuren' });
    expect(knoppen).toHaveLength(2);
    expect(knoppen[0].getAttribute('title')).toBe('Goedkeuren (rij-/rusttijden ok)');
    await klik(knoppen[0]);
    await klik(knoppen[1]);
    expect(onDecide).toHaveBeenCalledTimes(2);
    expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'accepted');
    expect(onDecide).toHaveBeenCalledWith('r2', 'approved', 'accepted');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Afwijzen vraagt eerst een bevestiging die de ruil noemt; Annuleren doet niets, bevestigen wijst af', async () => {
    const { onDecide } = toonBeheer(PLANNER, [ruil()]);
    await klik(tabel().getByRole('button', { name: 'Afwijzen' }));
    const vraag = await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' });
    expect(vraag.textContent).toContain('De aanvraag van Chauffeur A met Alex Collega voor dienst 2505 op ');
    expect(vraag.textContent).toContain('20 november wordt afgewezen.');
    expect(onDecide).not.toHaveBeenCalled();
    await klik(within(vraag).getByRole('button', { name: 'Annuleren' }));
    expect(onDecide).not.toHaveBeenCalled();

    await klik(tabel().getByRole('button', { name: 'Afwijzen' }));
    await klik(within(await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' })).getByRole('button', { name: 'Afwijzen' }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'accepted');
  });

  it('de bevestiging geeft de status mee die de planner zag toen ze opende', async () => {
    const onDecide = vi.fn().mockResolvedValue(true);
    const { rerender } = render(beheer(ADMIN, [ruil({ status: 'pending' })], onDecide));
    await klik(tabel().getByRole('button', { name: 'Afwijzen' }));
    const vraag = await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' });
    // Intussen accepteert de collega: de lijst ververst onder de open bevestiging.
    rerender(beheer(ADMIN, [ruil({ status: 'accepted' })], onDecide));
    await klik(within(vraag).getByRole('button', { name: 'Afwijzen' }));
    expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'pending');
  });

  it('planner bij een ruil die op de collega wacht: de badge staat er, Afwijzen vraagt ook daar een bevestiging', async () => {
    const { onDecide } = toonBeheer(PLANNER, [ruil({ status: 'pending', rust: TE_KORT })]);
    expect(tabel().getByText('Te weinig rust')).toBeTruthy();
    expect(tabel().queryByRole('button', { name: /goedkeuren/i })).toBeNull();
    await klik(tabel().getByRole('button', { name: 'Afwijzen' }));
    expect(await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' })).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('admin, Direct goedkeuren bij te weinig rust: eerst het paneel, geen bevestiging en geen beslissing', async () => {
    const { onDecide } = toonBeheer(ADMIN, [ruil({ status: 'pending', rust: TE_KORT })]);
    expect(tabel().queryByRole('button', { name: 'Direct goedkeuren' })).toBeNull();
    const knop = tabel().getByRole('button', { name: 'Direct goedkeuren, bekijk eerst de rusttijd' });
    expect(knop.getAttribute('title')).toBe('Bekijk eerst de rusttijd, collega heeft nog niet bevestigd');
    await klik(knop);
    const open = await paneel();
    expect(within(open).getByRole('region', { name: 'Rusttijd' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Direct goedkeuren' })).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();
    // In het paneel loopt goedkeuren zoals altijd: de bestaande bevestiging van de admin.
    await klik(within(open).getByRole('button', { name: 'Goedkeuren' }));
    await klik(within(await screen.findByRole('dialog', { name: 'Direct goedkeuren' })).getByRole('button', { name: 'Toch goedkeuren' }));
    expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'pending');
  });

  it('admin, Direct goedkeuren zonder waarschuwing: de bestaande bevestiging, zoals vroeger', async () => {
    const { onDecide } = toonBeheer(ADMIN, [ruil({ status: 'pending' })]);
    const knop = tabel().getByRole('button', { name: 'Direct goedkeuren' });
    expect(knop.getAttribute('title')).toBe('Direct goedkeuren, collega heeft nog niet bevestigd');
    await klik(knop);
    const vraag = await screen.findByRole('dialog', { name: 'Direct goedkeuren' });
    expect(screen.queryByRole('dialog', { name: CHAUFFEUR.name })).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();
    await klik(within(vraag).getByRole('button', { name: 'Toch goedkeuren' }));
    expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'pending');
  });

  it('een goedgekeurde ruil met een oud rust-veld toont de waarschuwing niet meer in de tabel', () => {
    // Na een goedkeuring houdt de lokale kopie het oude `rust`-veld tot de lijst ververst.
    toonBeheer(PLANNER, [ruil({ status: 'approved', rust: TE_KORT })]);
    expect(tabel().getByRole('button', { name: 'Afhandelen' })).toBeTruthy();
    expect(tabel().queryByText('Te weinig rust')).toBeNull();
  });

  it('de bevestiging blijft een zin als de collega, de dienst of de dag ontbreekt', async () => {
    toonBeheer(ADMIN, [ruil({ status: 'pending', targetDriverId: undefined, shiftDate: undefined, shiftLine: undefined })]);
    await klik(tabel().getByRole('button', { name: 'Afwijzen' }));
    const vraag = await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' });
    expect(vraag.textContent).toContain('De aanvraag van Chauffeur A voor de dienst wordt afgewezen.');
  });
});
