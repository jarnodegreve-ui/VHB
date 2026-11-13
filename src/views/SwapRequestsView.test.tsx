import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { apiFetch } from '../lib/api';

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

  // De rijknop ligt onder de voet van het paneel dat ze opent, en de grendel
  // dekt alleen de eerste 0,7 s: een tweede klik op dezelfde plek daarna viel op
  // Afwijzen van de voet en wees af zonder bevestiging (gemeten op 1920 px, en
  // op 1280 en 1440 px met een goedgekeurde rij in de tabel). Opende het paneel
  // langs de rijknop, dan vraagt Afwijzen in de voet daarom dezelfde bevestiging
  // als in de rij. Via de naam blijft het paneel zoals het was: één klik.
  it('paneel geopend langs de rijknop: Afwijzen in de voet vraagt eerst de bevestiging en geeft de status mee die de planner zag', async () => {
    const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
    await klik(tabel().getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd' }));
    await klik(within(await paneel()).getByRole('button', { name: 'Afwijzen' }));
    const vraag = await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' });
    expect(vraag.textContent).toContain('De aanvraag van Chauffeur A met Alex Collega voor dienst 2505 op ');
    expect(onDecide).not.toHaveBeenCalled();
    await klik(within(vraag).getByRole('button', { name: 'Afwijzen' }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'accepted');
  });

  it('admin, paneel geopend langs Direct goedkeuren: ook daar vraagt Afwijzen in de voet de bevestiging, met de status pending', async () => {
    const { onDecide } = toonBeheer(ADMIN, [ruil({ status: 'pending', rust: TE_KORT })]);
    await klik(tabel().getByRole('button', { name: 'Direct goedkeuren, bekijk eerst de rusttijd' }));
    await klik(within(await paneel()).getByRole('button', { name: 'Afwijzen' }));
    const vraag = await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' });
    expect(onDecide).not.toHaveBeenCalled();
    await klik(within(vraag).getByRole('button', { name: 'Afwijzen' }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'pending');
  });

  it('via de naam blijft het paneel zoals het was: Afwijzen beslist in één klik, ook nadat het eerst langs de rijknop open stond', async () => {
    const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
    await klik(tabel().getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd' }));
    await klik(within(await paneel()).getByRole('button', { name: 'Sluiten' }));
    // Het paneel schuift eerst uit (±0,3 s) en verdwijnt dan uit de boom.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
    expect(onDecide).not.toHaveBeenCalled();

    await klik(tabel().getByTitle('Details bekijken'));
    const open = await paneel();
    // Ook de grendel van de voet is met het paneel mee gesloten: wie het binnen
    // 0,7 s via de naam heropent, krijgt geen dode knoppen.
    expect(within(open).getByRole('button', { name: 'Afwijzen' }).parentElement?.className).not.toContain('pointer-events-none');
    await klik(within(open).getByRole('button', { name: 'Afwijzen' }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'accepted');
    expect(screen.queryByRole('dialog', { name: 'Dienstruil afwijzen?' })).toBeNull();
  });

  // Herstelronde 2: de plaatsgrendel. Ook na de 0,7 s ligt Goedkeuren van de
  // voet onder de rijknop: wie opnieuw op dezelfde plek klikte ("de eerste klik
  // pakte niet") keurde goed zonder de rustregels te lezen. De rijknop onthoudt
  // daarom het punt van de klik; zolang de aanwijzer daar niet weg is geweest,
  // doet een klik in de voet op dat punt niets. jsdom kent `pointer-events`
  // niet: de tijdgrendel houdt hier niets tegen, deze tests meten alleen de
  // plaats. De echte geometrie en de wachttijden staan in de e2e-spec.
  describe('plaatsgrendel van de voet', () => {
    const P = { x: 900, y: 560 };
    type Punt = { x: number; y: number };
    /** Een klik met een aanwijzer of een vinger: detail 1 en een plaats. De
     *  `klik` van hierboven is voor de code een toetsenbordklik (detail 0). */
    const wijs = async (knop: HTMLElement, punt: Punt = P) => {
      await act(async () => { fireEvent.click(knop, { detail: 1, clientX: punt.x, clientY: punt.y }); });
    };
    /** De aanwijzer beweegt, of een vinger raakt het scherm. */
    const aanwijzer = async (soort: 'pointermove' | 'pointerdown', punt: Punt) => {
      await act(async () => { window.dispatchEvent(new MouseEvent(soort, { clientX: punt.x, clientY: punt.y, bubbles: true })); });
    };
    const openLangsRijknop = async (naam = 'Goedkeuren, bekijk eerst de rusttijd') => {
      await wijs(tabel().getByRole('button', { name: naam }));
      return paneel();
    };
    const inVoet = (open: HTMLElement, naam: string) => within(open).getByRole('button', { name: naam });

    it('een klik in de voet op (bijna) het punt van de openingsklik doet niets: geen beslissing, geen bevestiging, wel de rustregels in beeld', async () => {
      const inBeeld = vi.spyOn(Element.prototype, 'scrollIntoView');
      const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      const open = await openLangsRijknop();
      expect(inBeeld).not.toHaveBeenCalled();
      await wijs(inVoet(open, 'Goedkeuren'));
      await wijs(inVoet(open, 'Goedkeuren'), { x: P.x + 11, y: P.y });
      await wijs(inVoet(open, 'Afwijzen'), { x: P.x - 8, y: P.y + 8 });
      await wijs(inVoet(open, 'Wijzigingsgeschiedenis'));
      expect(onDecide).not.toHaveBeenCalled();
      // Alleen het paneel: geen bevestiging, geen geschiedenis.
      expect(screen.getAllByRole('dialog')).toEqual([open]);
      expect(inBeeld).toHaveBeenCalledTimes(4);
      expect(inBeeld.mock.contexts.at(-1)).toBe(within(open).getByRole('region', { name: 'Rusttijd' }));
      expect(inBeeld).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' });
      inBeeld.mockRestore();
    });

    it('admin, geopend langs Direct goedkeuren: Goedkeuren in de voet op hetzelfde punt opent de bevestiging niet', async () => {
      const { onDecide } = toonBeheer(ADMIN, [ruil({ status: 'pending', rust: TE_KORT })]);
      const open = await openLangsRijknop('Direct goedkeuren, bekijk eerst de rusttijd');
      await wijs(inVoet(open, 'Goedkeuren'));
      expect(screen.queryByRole('dialog', { name: 'Direct goedkeuren' })).toBeNull();
      expect(screen.getAllByRole('dialog')).toEqual([open]);
      expect(onDecide).not.toHaveBeenCalled();
    });

    it('minder beweging: de rustregels komen zonder schuifanimatie in beeld', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
      }));
      const inBeeld = vi.spyOn(Element.prototype, 'scrollIntoView');
      toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      await wijs(inVoet(await openLangsRijknop(), 'Goedkeuren'));
      expect(inBeeld).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' });
      inBeeld.mockRestore();
    });

    it('een klik op een ander punt gaat gewoon door, vanaf de straal zelf (12 px)', async () => {
      const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      const open = await openLangsRijknop();
      await wijs(inVoet(open, 'Goedkeuren'), { x: P.x + 12, y: P.y });
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'accepted');
    });

    // "Dezelfde plek" is voor de planner het icoon, niet één punt: een tweede
    // klik of tik elders op hetzelfde rij-icoon viel buiten de straal en keurde
    // goed. Het vak van de rijknop telt daarom mee, met een marge van 8 px.
    // jsdom meet niets (elk vak is 0 x 0, en dan geldt alleen de straal): hier
    // krijgt de rijknop het vak van een icoon van 40 x 32 px.
    describe('het vak van de rijknop', () => {
      const VAK = { left: 880, right: 920, top: 544, bottom: 576, width: 40, height: 32, x: 880, y: 544, toJSON: () => ({}) } as DOMRect;
      const HOEK = { x: VAK.left + 4, y: VAK.top + 4 };
      const openOpIcoon = async () => {
        const rijKnop = tabel().getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd' });
        vi.spyOn(rijKnop, 'getBoundingClientRect').mockReturnValue(VAK);
        await wijs(rijKnop, HOEK);
        return paneel();
      };

      it('een klik elders op het icoon, of binnen de marge ernaast, is geslikt, ook ver buiten de straal rond het punt', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const open = await openOpIcoon();
        // De andere hoek van het icoon: 40 px van het punt van de eerste klik.
        await wijs(inVoet(open, 'Goedkeuren'), { x: VAK.right - 4, y: VAK.bottom - 4 });
        await wijs(inVoet(open, 'Goedkeuren'), { x: VAK.right + 8, y: VAK.bottom + 8 });
        await wijs(inVoet(open, 'Afwijzen'), { x: VAK.left - 8, y: VAK.top - 8 });
        expect(onDecide).not.toHaveBeenCalled();
        expect(screen.getAllByRole('dialog')).toEqual([open]);
      });

      it('net buiten de marge gaat de klik gewoon door', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        await wijs(inVoet(await openOpIcoon(), 'Goedkeuren'), { x: VAK.right + 9, y: VAK.bottom - 4 });
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'accepted');
      });

      it('de straal rond het punt blijft gelden waar ze buiten het vak met marge valt', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const rijKnop = tabel().getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd' });
        vi.spyOn(rijKnop, 'getBoundingClientRect').mockReturnValue(VAK);
        // De klik valt op de linkerrand van het icoon; 11 px verder naar links
        // is buiten vak plus marge (8 px), binnen de straal (12 px).
        await wijs(rijKnop, { x: VAK.left, y: 560 });
        const open = await paneel();
        await wijs(inVoet(open, 'Goedkeuren'), { x: VAK.left - 11, y: 560 });
        expect(onDecide).not.toHaveBeenCalled();
        await wijs(inVoet(open, 'Goedkeuren'), { x: VAK.left - 12, y: 560 });
        expect(onDecide).toHaveBeenCalledTimes(1);
      });

      it('een beweging of aanraking binnen het vak lost de grendel niet, pas buiten het vak met marge', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const open = await openOpIcoon();
        await aanwijzer('pointermove', { x: VAK.right - 2, y: VAK.bottom - 2 });
        await aanwijzer('pointerdown', { x: VAK.right + 8, y: VAK.top });
        await wijs(inVoet(open, 'Goedkeuren'), HOEK);
        expect(onDecide).not.toHaveBeenCalled();
        await aanwijzer('pointermove', { x: VAK.right + 9, y: VAK.top });
        await wijs(inVoet(open, 'Goedkeuren'), HOEK);
        expect(onDecide).toHaveBeenCalledTimes(1);
      });
    });

    // De geslikte klik annuleerde alleen de klik: het indrukken ervoor gaf de
    // knop van de voet al de focus, zonder focusring. Spatie of Enter keurde dan
    // goed zonder dat de aanwijzer bewoog en zonder dat de rustregels gelezen
    // waren. Het indrukken op de plek geeft daarom geen focus meer, en na de
    // geslikte klik staat de focus op het paneel.
    describe('focus na een geslikte klik', () => {
      /** Indrukken met een aanwijzer; `false` = de standaardactie (focus geven) is tegengehouden. */
      const drukIn = (knop: HTMLElement, punt: Punt = P) => fireEvent.mouseDown(knop, { detail: 1, clientX: punt.x, clientY: punt.y });

      it('indrukken op de plek geeft de knop eronder geen focus; elders en na wegbewegen wel', async () => {
        toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const open = await openLangsRijknop();
        expect(drukIn(inVoet(open, 'Goedkeuren'))).toBe(false);
        expect(drukIn(inVoet(open, 'Afwijzen'), { x: P.x + 11, y: P.y })).toBe(false);
        expect(drukIn(inVoet(open, 'Goedkeuren'), { x: P.x + 12, y: P.y })).toBe(true);
        await aanwijzer('pointermove', { x: P.x + 60, y: P.y });
        expect(drukIn(inVoet(open, 'Goedkeuren'))).toBe(true);
      });

      it('na de geslikte klik staat de focus op het paneel, ook als de knop ze toch kreeg', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const open = await openLangsRijknop();
        const knop = inVoet(open, 'Goedkeuren');
        // Een browser die de focus geeft vóór het indrukken geannuleerd kan worden.
        knop.focus();
        expect(document.activeElement).toBe(knop);
        await wijs(knop);
        expect(document.activeElement).toBe(open);
        expect(onDecide).not.toHaveBeenCalled();
      });

      it('buiten een venster (de pagina, de achtergrond) blijft een klik op de plek wat hij was', async () => {
        toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        await openLangsRijknop();
        const buiten = screen.getByRole('table', { name: 'Dienstruilen' });
        const opRij = vi.fn();
        buiten.addEventListener('click', opRij);
        expect(drukIn(buiten)).toBe(true);
        await wijs(buiten);
        expect(opRij).toHaveBeenCalledTimes(1);
        buiten.removeEventListener('click', opRij);
      });

      it('toetsenbord in de voet blijft gewoon werken: Tab naar Goedkeuren, Enter keurt goed', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const open = await openLangsRijknop();
        const knop = inVoet(open, 'Goedkeuren');
        knop.focus();
        // Enter of spatie op een knop geeft een klik met detail 0.
        await klik(knop);
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'accepted');
      });
    });

    it('op een ander punt vraagt Afwijzen de bevestiging van de rijknop, zoals voorheen', async () => {
      const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      await wijs(inVoet(await openLangsRijknop(), 'Afwijzen'), { x: P.x - 60, y: P.y });
      expect(await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' })).toBeTruthy();
      expect(onDecide).not.toHaveBeenCalled();
    });

    it('na wegbewegen werkt het punt zelf weer; een beweging binnen de straal lost de grendel niet', async () => {
      const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      const open = await openLangsRijknop();
      await aanwijzer('pointermove', { x: P.x + 8, y: P.y + 8 });
      await wijs(inVoet(open, 'Goedkeuren'));
      expect(onDecide).not.toHaveBeenCalled();
      // De planner leest de rustregels (de aanwijzer gaat erheen) en komt terug.
      await aanwijzer('pointermove', { x: P.x - 150, y: P.y - 300 });
      await aanwijzer('pointermove', P);
      await wijs(inVoet(open, 'Goedkeuren'));
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'accepted');
    });

    it('een aanraking elders lost de grendel ook; een aanraking op het punt zelf niet', async () => {
      const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      const open = await openLangsRijknop();
      await aanwijzer('pointerdown', P);
      await wijs(inVoet(open, 'Goedkeuren'));
      expect(onDecide).not.toHaveBeenCalled();
      await aanwijzer('pointerdown', { x: P.x, y: P.y - 200 });
      await wijs(inVoet(open, 'Goedkeuren'));
      expect(onDecide).toHaveBeenCalledTimes(1);
    });

    it('toetsenbord in de voet (detail 0) valt niet onder de plaatsgrendel, ook niet met de plaats van de openingsklik', async () => {
      const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      const open = await openLangsRijknop();
      await act(async () => { fireEvent.click(inVoet(open, 'Goedkeuren'), { clientX: P.x, clientY: P.y }); });
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide).toHaveBeenCalledWith('r1', 'approved', 'accepted');
    });

    it('geopend met Enter of spatie: de focus staat op het paneel, niet op een knop die beslist, en er is geen plaatsgrendel', async () => {
      const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
      // Enter of spatie op de rijknop geeft een klik met detail 0 op (0, 0).
      await klik(tabel().getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd' }));
      const open = await paneel();
      expect(document.activeElement).toBe(open);
      expect(onDecide).not.toHaveBeenCalled();
      await wijs(inVoet(open, 'Goedkeuren'), { x: 0, y: 0 });
      expect(onDecide).toHaveBeenCalledTimes(1);
    });

    describe('opruiming', () => {
      /** Luisteraars op window voor de aanwijzer die er nog hangen: de twee die
       *  de grendel lossen (beweging, aanraking) en de twee die op de plek
       *  slikken (indrukken, klik). */
      const bespied = () => {
        const erbij = vi.spyOn(window, 'addEventListener');
        const eraf = vi.spyOn(window, 'removeEventListener');
        const hangend = () => erbij.mock.calls
          .filter(([soort, fn]) => /^(pointer(move|down)|mousedown|click)$/.test(soort) && !eraf.mock.calls.some(([s, f]) => s === soort && f === fn))
          .map(([soort]) => soort).sort();
        return { hangend, klaar: () => { erbij.mockRestore(); eraf.mockRestore(); } };
      };
      const GRENDEL = ['click', 'mousedown', 'pointerdown', 'pointermove'];

      it('het paneel sluiten wist de grendel en haalt de luisteraars van window; via de naam werkt het oude punt meteen', async () => {
        const { hangend, klaar } = bespied();
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const open = await openLangsRijknop();
        expect(hangend()).toEqual(GRENDEL);
        await klik(within(open).getByRole('button', { name: 'Sluiten' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
        expect(hangend()).toEqual([]);

        await klik(tabel().getByTitle('Details bekijken'));
        await wijs(inVoet(await paneel(), 'Goedkeuren'));
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(hangend()).toEqual([]);
        klaar();
      });

      it('wegbewegen haalt de luisteraars weg; het scherm verlaten met de grendel aan ook', async () => {
        const { hangend, klaar } = bespied();
        const { unmount } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const open = await openLangsRijknop();
        expect(hangend()).toEqual(GRENDEL);
        await aanwijzer('pointermove', { x: P.x + 40, y: P.y });
        expect(hangend()).toEqual([]);

        // Dicht en opnieuw langs de rijknop: de grendel staat er weer, het scherm verdwijnt.
        await klik(within(open).getByRole('button', { name: 'Sluiten' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
        await openLangsRijknop();
        expect(hangend()).toEqual(GRENDEL);
        unmount();
        expect(hangend()).toEqual([]);
        klaar();
      });

      it('toont het paneel een andere ruil, dan geldt de grendel van de vorige niet meer', async () => {
        const { hangend, klaar } = bespied();
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT }), ruil({ id: 'r2', shiftLine: '2606', rust: TE_KORT })]);
        const rij = (dienst: string) => within(screen.getAllByRole('row').find((r) => r.textContent?.includes(`Dienst ${dienst}`))!);
        await wijs(rij('2505').getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd' }));
        await paneel();
        expect(hangend()).toEqual(GRENDEL);
        // In het echt een link of de terugknop; jsdom kent de achtergrond van
        // het paneel niet, dus de naam van de andere rij is hier aanklikbaar.
        await klik(rij('2606').getByTitle('Details bekijken'));
        expect(hangend()).toEqual([]);
        await wijs(inVoet(await paneel(), 'Goedkeuren'));
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenCalledWith('r2', 'approved', 'accepted');
        klaar();
      });

      it('de bevestiging van Afwijzen in de rij sluiten wist de grendel en haalt de luisteraars van window, na Annuleren en na bevestigen', async () => {
        const { hangend, klaar } = bespied();
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        await wijs(tabel().getByRole('button', { name: 'Afwijzen' }));
        const vraag = await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' });
        expect(hangend()).toEqual(GRENDEL);
        // Annuleren met het toetsenbord: de aanwijzer bewoog niet.
        await klik(within(vraag).getByRole('button', { name: 'Annuleren' }));
        expect(hangend()).toEqual([]);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
        // De plek is gewist: in het paneel via de naam beslist een klik op het oude punt gewoon.
        await klik(tabel().getByTitle('Details bekijken'));
        const open = await paneel();
        await wijs(inVoet(open, 'Goedkeuren'));
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenLastCalledWith('r1', 'approved', 'accepted');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });

        // Opnieuw, en nu bevestigen op een andere plek: ook dan is alles weg.
        await wijs(tabel().getByRole('button', { name: 'Afwijzen' }));
        expect(hangend()).toEqual(GRENDEL);
        await wijs(within(await screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' })).getByRole('button', { name: 'Afwijzen' }), { x: P.x - 60, y: P.y });
        expect(onDecide).toHaveBeenLastCalledWith('r1', 'rejected', 'accepted');
        await waitFor(() => expect(hangend()).toEqual([]));
        klaar();
      });
    });

    // Afwijzen in de rij opent de bevestiging midden in het venster. Op 768 tot
    // ±800 px breed, met de tabel naar rechts geschoven, ligt haar knop Afwijzen
    // onder Afwijzen van de rij: de tweede klik van een dubbelklik (of een
    // herhaalde klik later) bevestigde de vraag ongelezen. De rijknop zet daarom
    // dezelfde plaatsgrendel; de geometrie zelf staat in de e2e-spec.
    describe('Afwijzen in de rij', () => {
      const openVraag = async (hoe: (knop: HTMLElement) => Promise<void> = wijs) => {
        await hoe(tabel().getByRole('button', { name: 'Afwijzen' }));
        return screen.findByRole('dialog', { name: 'Dienstruil afwijzen?' });
      };

      it('een klik in de bevestiging op de plek van de rijknop bevestigt niets en sluit niets; elders op de knop wijst de klik af', async () => {
        // Ook zonder rustwaarschuwing: Afwijzen vraagt in elke rij een bevestiging.
        const { onDecide } = toonBeheer(PLANNER, [ruil()]);
        const vraag = await openVraag();
        const bevestig = within(vraag).getByRole('button', { name: 'Afwijzen' });
        expect(fireEvent.mouseDown(bevestig, { detail: 1, clientX: P.x, clientY: P.y }), 'indrukken op de plek geeft de knop geen focus').toBe(false);
        await wijs(bevestig);
        await wijs(bevestig, { x: P.x + 11, y: P.y });
        await wijs(within(vraag).getByRole('button', { name: 'Annuleren' }), { x: P.x - 8, y: P.y + 8 });
        expect(onDecide).not.toHaveBeenCalled();
        expect(screen.getAllByRole('dialog')).toEqual([vraag]);
        expect(document.activeElement).toBe(vraag);

        await wijs(bevestig, { x: P.x - 60, y: P.y });
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'accepted');
      });

      it('na wegbewegen bevestigt een klik op het punt zelf weer gewoon', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const vraag = await openVraag();
        // De planner leest de vraag (de aanwijzer gaat erheen) en komt terug.
        await aanwijzer('pointermove', { x: P.x - 200, y: P.y - 80 });
        await wijs(within(vraag).getByRole('button', { name: 'Afwijzen' }));
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'accepted');
      });

      it('admin bij een ruil die op de collega wacht: dezelfde grendel, met de status pending', async () => {
        const { onDecide } = toonBeheer(ADMIN, [ruil({ status: 'pending' })]);
        const vraag = await openVraag();
        await wijs(within(vraag).getByRole('button', { name: 'Afwijzen' }));
        expect(onDecide).not.toHaveBeenCalled();
        await wijs(within(vraag).getByRole('button', { name: 'Afwijzen' }), { x: P.x, y: P.y + 40 });
        expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'pending');
      });

      it('geopend met Enter of spatie is er geen plaatsgrendel: de bevestiging werkt op elk punt', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const vraag = await openVraag(klik);
        await wijs(within(vraag).getByRole('button', { name: 'Afwijzen' }), { x: 0, y: 0 });
        expect(onDecide).toHaveBeenCalledTimes(1);
      });

      it('toetsenbord in de bevestiging (detail 0) valt niet onder de grendel', async () => {
        const { onDecide } = toonBeheer(PLANNER, [ruil({ rust: TE_KORT })]);
        const vraag = await openVraag();
        await act(async () => { fireEvent.click(within(vraag).getByRole('button', { name: 'Afwijzen' }), { clientX: P.x, clientY: P.y }); });
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenCalledWith('r1', 'rejected', 'accepted');
      });
    });
  });
});

// Tegenlezing 12-11 (ronde 6, punt 12): de uren van het bord tellen alleen als
// ze vers van de server kwamen, na de doorvoer komen ze uit de eigen planning
// (alle delen), en alleen stap 3 verstuurt de aanvraag.
describe('Dienstruil: uren van een dienst en wat de wizard verstuurt (tegenlezing 12-11)', () => {
  const ALEX = { id: 'c2', name: 'Alex Collega', employeeId: 'C2', role: 'chauffeur', isActive: true } as User;
  const UREN = /\d{2}:\d{2}–\d{2}:\d{2}/;
  const voorstel = (extra: Partial<SwapRequest> = {}): SwapRequest => ({
    id: 'v1', shiftId: 'x1', requesterId: ALEX.id, targetDriverId: CHAUFFEUR.id, status: 'pending',
    createdAt: '2026-11-04T08:00:00.000Z', shiftDate: '2026-12-05', shiftLine: '2323', returnDate: '2026-12-12', returnCode: 'vrij', ...extra,
  });
  const BORD = { month: '2026-12', dates: [], drivers: [], cells: { [ALEX.id]: { '2026-12-05': { code: '2323', kind: 'service', label: 'Dienst 2323', segments: ['06:45–10:00 (loop 4500)', '15:45–19:35'] } } } };
  /** apiFetch zoals de app hem ziet: het bord met de gegeven koppen, de rest leeg. */
  const bordAntwoord = (koppen: Record<string, string> = {}) => vi.mocked(apiFetch).mockImplementation(async (url) => (
    String(url).startsWith('/api/month-planning')
      ? new Response(JSON.stringify(BORD), { status: 200, headers: { 'content-type': 'application/json', ...koppen } })
      : new Response('{}', { status: 200 })
  ));
  const bordVerzoeken = () => vi.mocked(apiFetch).mock.calls.filter(([url]) => String(url).startsWith('/api/month-planning'));
  const kaart = (id: string) => document.querySelector<HTMLElement>(`[data-record="${id}"]`)!;
  const zetStandaard = () => { vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockImplementation(async () => new Response('{}', { status: 200 })); };
  // jsdom kent scrollTo op een element niet; de wizard scrolt bij elke stapwissel naar boven.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  beforeEach(zetStandaard);
  afterEach(zetStandaard);

  it('een bord uit de cache van de service worker (zonder bereik) toont geen uren; een vers antwoord wel', async () => {
    bordAntwoord({ 'X-VHB-Bron': 'cache' });
    const eerste = toon([CHAUFFEUR, ALEX], [voorstel()]);
    await waitFor(() => expect(bordVerzoeken()).toHaveLength(1));
    expect(bordVerzoeken()[0][0]).toBe('/api/month-planning?month=2026-12');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(kaart('v1').textContent).toContain('Dienst 2323');
    expect(kaart('v1').textContent).not.toMatch(UREN);
    eerste.unmount();

    bordAntwoord();
    toon([CHAUFFEUR, ALEX], [voorstel()]);
    await waitFor(() => expect(kaart('v1').textContent).toMatch(/06:45–10:00\s·\s15:45–19:35/));
  });

  it('na de doorvoer: de uren van alle delen uit de eigen planning, en het bord wordt er niet voor gevraagd', async () => {
    const shifts = [
      { id: 'g1', date: '2026-12-06', startTime: '06:00', endTime: '10:00', line: '2404', busNumber: '', loopnr: '', driverId: CHAUFFEUR.id },
      { id: 'g2', date: '2026-12-06', startTime: '15:00', endTime: '19:00', line: '2404', busNumber: '', loopnr: '', driverId: CHAUFFEUR.id },
    ];
    render(<SwapRequestsView user={CHAUFFEUR} swaps={[voorstel({ id: 'a1', shiftId: 'g1', status: 'approved', shiftDate: '2026-12-06', shiftLine: '2404' })]} shifts={shifts} users={[CHAUFFEUR, ALEX]} onSave={vi.fn().mockResolvedValue(true)} onConfirmSeen={vi.fn()} />);
    expect(within(kaart('a1')).getByRole('button', { name: 'Begrepen, ik rijd deze dienst' })).toBeTruthy();
    // Vroeger alleen het eerste deel (de rij van de ruil): "06:00–10:00".
    expect(kaart('a1').textContent).toMatch(/06:00–10:00\s·\s15:00–19:00/);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(bordVerzoeken()).toHaveLength(0);
  });

  it('alleen stap 3 verstuurt: een submit vanuit stap 2 (Enter in het zoekveld) laat niets vertrekken, ook niet met alles al gekozen', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    apiJsonMock.mockImplementation(async (url: string) => {
      // De dag van mijn dienst (met takeover), daarna de komende weken van de collega.
      if (url.includes('takeover=1')) return { days: [{ date: '2026-11-20', working: [CHAUFFEUR.id, ALEX.id], leave: [], free: [], lines: { [CHAUFFEUR.id]: '2101', [ALEX.id]: '2303' } }] };
      if (url.startsWith('/api/availability')) return { days: [{ date: '2026-11-25', working: [ALEX.id], leave: [], free: [], lines: { [ALEX.id]: '2202' } }] };
      return { ruilen: [], totaal: 0 };
    });
    const mijnDienst = { id: 's1', date: '2026-11-20', startTime: '08:00', endTime: '16:00', line: '2101', busNumber: '', loopnr: '', driverId: CHAUFFEUR.id };
    render(<SwapRequestsView user={CHAUFFEUR} swaps={[]} shifts={[mijnDienst]} users={[CHAUFFEUR, ALEX]} onSave={onSave} />);
    const klik = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
    await klik(screen.getByRole('button', { name: 'Dienstruil aanvragen' }));
    const wizard = await screen.findByRole('dialog');
    await klik(within(wizard).getByRole('button', { name: /Dienst 2101/ }));
    await klik(await within(wizard).findByRole('button', { name: /Alex Collega/ }));
    await klik(await within(wizard).findByRole('button', { name: /Dienst 2202/ }));
    expect(within(wizard).getByRole('button', { name: 'Ruilverzoek versturen' })).toHaveProperty('disabled', false);

    // Terug naar stap 2: dienst, collega en tegenprestatie zijn gekozen. Een
    // submit van het formulier (zoals Enter in het zoekveld) doet niets.
    await klik(within(wizard).getByRole('button', { name: 'Vorige stap' }));
    expect(within(wizard).getByText('Stap 2 van 3')).toBeTruthy();
    await act(async () => { fireEvent.submit(wizard.querySelector('form')!); });
    expect(onSave).not.toHaveBeenCalled();
    expect(within(wizard).getByText('Stap 2 van 3')).toBeTruthy();
    expect(within(wizard).queryByRole('alert')).toBeNull();

    // In stap 3 verstuurt dezelfde submit gewoon, zoals vroeger.
    await klik(within(wizard).getByRole('button', { name: /Alex Collega/ }));
    await klik(await within(wizard).findByRole('button', { name: /Dienst 2202/ }));
    await act(async () => { fireEvent.submit(wizard.querySelector('form')!); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].at(-1)).toMatchObject({ shiftId: 's1', targetDriverId: ALEX.id, returnDate: '2026-11-25', returnCode: '2202', status: 'pending' });
  });
});
