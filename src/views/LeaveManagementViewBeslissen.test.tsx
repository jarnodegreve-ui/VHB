import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LeaveRequest, User } from '../types';
import { BESLIS_SLOT_MS } from '../components/VerlofBeoordeling';

// Verlof beslissen met alles in beeld (ronde 6, punt 15), de kant van het
// scherm: na een geslaagde beslissing opent het paneel de volgende wachtende
// aanvraag in de volgorde van de lijst, bij de laatste en bij een mislukte
// beslissing sluit het zoals vroeger, de toast noemt wie en wat, en "Ook
// aangevraagd voor deze periode" wisselt naar een andere wachtende aanvraag.
// Doorschakelen gebeurt alleen waar de bevestiging de kop van het paneel
// vrijlaat: onder 768 px en vanaf 1195 px breed; ertussen sluit het paneel.
// De echte invoer (muis, vinger, Enter binnen 300 ms), de historiek en de
// gemeten plaats van toast en kop staan in
// e2e/deeplinks-verlof-beslissen.spec.ts; dit is de snelle bewaker.
// Een eigen bestand naast LeaveManagementView.test.tsx: aan dat bestand werkt
// in dezelfde ronde een andere wijziging.

const { apiJsonMock } = vi.hoisted(() => ({ apiJsonMock: vi.fn() }));
vi.mock('../lib/api', () => ({
  apiJson: apiJsonMock,
  apiFetch: vi.fn(async () => new Response('{}', { status: 200 })),
}));

import { LeaveManagementView } from './LeaveManagementView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const PLANNER = { id: 'p1', name: 'Petra Planner', employeeId: 'P1', role: 'planner', isActive: true } as User;
const ALEX = { id: 'c1', name: 'Alex Du Priez', employeeId: 'C1', role: 'chauffeur', isActive: true } as User;
const DIETHER = { id: 'c2', name: 'Diether Van Haute', employeeId: 'C2', role: 'chauffeur', isActive: true } as User;
const ELS = { id: 'c3', name: 'Els Goossens', employeeId: 'C3', role: 'chauffeur', isActive: true } as User;
const USERS = [PLANNER, ALEX, DIETHER, ELS];

const aanvraag = (id: string, userId: string, van: string, tot: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id, userId, startDate: van, endDate: tot, type: 'betaald_verlof', status: 'pending', createdAt: '2026-11-01T08:00:00.000Z', ...extra,
});
/** w1 en w2 raken elkaar (w2 is de oudste aanvraag), w3 ligt later. */
const DRIE = (): LeaveRequest[] => [
  aanvraag('w1', 'c1', '2026-12-07', '2026-12-11', { createdAt: '2026-11-03T08:00:00.000Z' }),
  aanvraag('w2', 'c2', '2026-12-08', '2026-12-08', { createdAt: '2026-11-02T08:00:00.000Z' }),
  aanvraag('w3', 'c3', '2026-12-21', '2026-12-22', { createdAt: '2026-11-01T08:00:00.000Z' }),
];

type Toast = { message: string; tone: string };
type Beslissing = { id: string; status: string; gezien?: string; reden?: string };
let toasts: Toast[] = [];
const opToast = (e: Event) => { toasts.push((e as CustomEvent<Toast>).detail); };

// De eerste test wacht twee keer echt op het slot (2 × 710 ms); met de ruime
// wachttijden hierboven is de standaard van 5 s voor een test te krap.
vi.setConfig({ testTimeout: 20_000 });

/** De breedte van het venster in de test. Elke vraag `(min-width: N px)` (het
 *  paneel op 1024, de regel van het doorschakelen op 768 en 1195) antwoordt
 *  zoals een browser van die breedte; al de rest (minder beweging) is "nee". */
let vensterBreedte = 390;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T10:00:00+01:00'), toFake: ['Date'] });
  apiJsonMock.mockReset();
  apiJsonMock.mockResolvedValue({});
  // Telefoonopbouw: het paneel is een SlideOver (role=dialog met de naam van de aanvrager).
  vensterBreedte = 390;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      const grens = /^\(min-width: (\d+)px\)$/.exec(query);
      return grens ? vensterBreedte >= Number(grens[1]) : false;
    },
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
  toasts = [];
  window.addEventListener('vhb-toast', opToast);
});
afterEach(() => { window.removeEventListener('vhb-toast', opToast); cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** Het scherm met een lijst die elke beslissing toepast, zoals de datalaag na een geslaagde PATCH. */
function Scherm({ start, beslissingen, slaagt = () => true }: { start: LeaveRequest[]; beslissingen: Beslissing[]; slaagt?: (id: string) => boolean }) {
  const [lijst, setLijst] = useState(start);
  return (
    <LeaveManagementView
      user={PLANNER}
      users={USERS}
      leaveRequests={lijst}
      onSave={vi.fn()}
      onDecide={async (id, status, gezien, reden) => {
        beslissingen.push({ id, status, gezien, reden });
        if (!slaagt(id)) return false;
        setLijst((huidig) => huidig.map((r) => (r.id === id ? { ...r, status, decidedAt: '2026-11-05T09:00:00.000Z' } : r)));
        return true;
      }}
    />
  );
}

/** Ruim wachten: de SlideOver sluit met een animatie van 320 ms en wisselt zijn
 *  inhoud met een fade; de standaard van waitFor (1 s) is op een drukke
 *  machine te krap. */
const RUIM = { timeout: 6000 };
const paneel = (naam: string) => screen.queryByRole('dialog', { name: naam });
const paneelDicht = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), RUIM);
const inPaneel = (naam: string) => within(screen.getByRole('dialog', { name: naam }));
const wachtOpPaneel = (naam: string) => waitFor(() => expect(paneel(naam)).not.toBeNull(), RUIM);
/** De rij van een aanvrager in "Wachtend op goedkeuring" openen. */
const openRij = async (naam: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${naam}`) })); });
  await wachtOpPaneel(naam);
};
const klikInPaneel = async (naam: string, knop: string) => {
  await act(async () => { fireEvent.click(inPaneel(naam).getByRole('button', { name: knop })); });
};
/** Het slot op de beslisknoppen na een wissel laten aflopen (echte tijd). */
const naHetSlot = () => act(async () => { await new Promise((klaar) => setTimeout(klaar, BESLIS_SLOT_MS + 60)); });

// Het paneel op elke breedte: de SlideOver (dialog) onder 1024 px, de kaart
// naast de lijst (een section met de naam van de aanvrager) vanaf 1024 px.
const NAMEN = ['Alex Du Priez', 'Diether Van Haute', 'Els Goossens'];
const vak = (naam: string) => screen.queryByRole('dialog', { name: naam }) ?? screen.queryByRole('region', { name: naam });
const wachtOpVak = (naam: string) => waitFor(() => expect(vak(naam)).not.toBeNull(), RUIM);
const allesDicht = () => waitFor(() => expect(NAMEN.filter((naam) => vak(naam) !== null)).toEqual([]), RUIM);
/** De rij van Alex openen en in zijn paneel op Goedkeuren klikken, op elke breedte. */
const openAlex = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Alex Du Priez/ })); });
  await wachtOpVak('Alex Du Priez');
};
const keurAlexGoed = async () => {
  await act(async () => { fireEvent.click(within(vak('Alex Du Priez')!).getByRole('button', { name: 'Goedkeuren' })); });
};
const TOAST_ALEX = { message: 'Verlof goedgekeurd: Alex Du Priez, 07/12/2026 t/m 11/12/2026.', tone: 'success' };

describe('Verlof beslissen: door naar de volgende wachtende', () => {
  it('na Goedkeuren opent de volgende van de lijst, de toast noemt wie en wat; de laatste sluit het paneel', async () => {
    const beslissingen: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={beslissingen} />);
    await openRij('Alex Du Priez');

    await klikInPaneel('Alex Du Priez', 'Goedkeuren');
    await wachtOpPaneel('Diether Van Haute');
    expect(paneel('Alex Du Priez')).toBeNull();
    expect(beslissingen).toEqual([{ id: 'w1', status: 'approved', gezien: 'pending', reden: undefined }]);
    expect(toasts).toEqual([{ message: 'Verlof goedgekeurd: Alex Du Priez, 07/12/2026 t/m 11/12/2026.', tone: 'success' }]);

    // Een tweede klik op dezelfde knop, meteen na de wissel, beslist niets.
    await klikInPaneel('Diether Van Haute', 'Goedkeuren');
    await klikInPaneel('Diether Van Haute', 'Afwijzen');
    expect(beslissingen).toHaveLength(1);
    expect(inPaneel('Diether Van Haute').queryByLabelText('Reden van afwijzing')).toBeNull();

    // Eén dag = die ene datum.
    await naHetSlot();
    await klikInPaneel('Diether Van Haute', 'Goedkeuren');
    await wachtOpPaneel('Els Goossens');
    expect(beslissingen[1]).toEqual({ id: 'w2', status: 'approved', gezien: 'pending', reden: undefined });
    expect(toasts[1]).toEqual({ message: 'Verlof goedgekeurd: Diether Van Haute, 08/12/2026.', tone: 'success' });

    // De laatste: afwijzen met een reden, daarna sluit het paneel zoals vroeger.
    await naHetSlot();
    await klikInPaneel('Els Goossens', 'Afwijzen');
    await act(async () => { fireEvent.change(inPaneel('Els Goossens').getByLabelText('Reden van afwijzing'), { target: { value: 'Te veel collega\'s al vrij.' } }); });
    await klikInPaneel('Els Goossens', 'Afwijzen');
    await paneelDicht();
    expect(beslissingen[2]).toEqual({ id: 'w3', status: 'rejected', gezien: 'pending', reden: 'Te veel collega\'s al vrij.' });
    expect(toasts[2]).toEqual({ message: 'Verlof afgewezen: Els Goossens, 21/12/2026 t/m 22/12/2026.', tone: 'success' });
    expect(screen.getByText('Alles beoordeeld')).toBeTruthy();
  });

  it('de laatste van de lijst sluit het paneel, ook als er erboven nog wachten (geen terugloop naar het begin)', async () => {
    const beslissingen: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={beslissingen} />);
    await openRij('Els Goossens');
    await klikInPaneel('Els Goossens', 'Goedkeuren');
    await paneelDicht();
    expect(beslissingen).toHaveLength(1);
    // De twee erboven wachten nog, ongemoeid.
    expect(screen.getByRole('button', { name: /^Alex Du Priez/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Diether Van Haute/ })).toBeTruthy();
  });

  it('mislukt de beslissing, dan sluit het paneel zoals vroeger: geen volgende, geen toast van het scherm', async () => {
    const beslissingen: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={beslissingen} slaagt={() => false} />);
    await openRij('Alex Du Priez');
    await klikInPaneel('Alex Du Priez', 'Goedkeuren');
    await paneelDicht();
    expect(beslissingen).toHaveLength(1);
    expect(toasts).toEqual([]);
    // Alle drie wachten nog.
    expect(screen.getByRole('button', { name: /^Alex Du Priez/ })).toBeTruthy();
  });

  /** Een scherm waarvan de test zelf bepaalt wanneer de server antwoordt en wat er intussen live wijzigt. */
  const traag = () => {
    const greep = { beslissingen: [] as Beslissing[], antwoord: (_ok: boolean) => {}, wijzig: (_f: (l: LeaveRequest[]) => LeaveRequest[]) => {} };
    function Traag() {
      const [lijst, setLijst] = useState(DRIE());
      greep.wijzig = setLijst;
      return (
        <LeaveManagementView
          user={PLANNER}
          users={USERS}
          leaveRequests={lijst}
          onSave={vi.fn()}
          onDecide={(id, status) => new Promise<boolean>((klaar) => {
            greep.beslissingen.push({ id, status });
            greep.antwoord = (ok) => {
              if (ok) setLijst((l) => l.map((r) => (r.id === id ? { ...r, status } : r)));
              klaar(ok);
            };
          })}
        />
      );
    }
    return { greep, Traag };
  };

  it('wat intussen door een collega beslist is, slaat het paneel over', async () => {
    const { greep, Traag } = traag();
    render(<Traag />);
    await openRij('Alex Du Priez');
    await klikInPaneel('Alex Du Priez', 'Goedkeuren');
    // Terwijl de beslissing onderweg is, keurt een collega w2 goed (live bijgewerkt).
    await act(async () => { greep.wijzig((l) => l.map((r) => (r.id === 'w2' ? { ...r, status: 'approved' } : r))); });
    expect(paneel('Alex Du Priez')).not.toBeNull();
    await act(async () => { greep.antwoord(true); });
    await wachtOpPaneel('Els Goossens');
    expect(paneel('Diether Van Haute')).toBeNull();
    expect(greep.beslissingen).toEqual([{ id: 'w1', status: 'approved' }]);
  });

  it('een aanvraag die tijdens het wachten binnenkwam, opent nooit vanzelf', async () => {
    const { greep, Traag } = traag();
    render(<Traag />);
    await openRij('Els Goossens');
    await klikInPaneel('Els Goossens', 'Goedkeuren');
    // Els was de laatste van de lijst; intussen komt er een nieuwe aanvraag achteraan bij.
    await act(async () => { greep.wijzig((l) => [...l, aanvraag('w4', 'c1', '2027-01-04', '2027-01-05')]); });
    await act(async () => { greep.antwoord(true); });
    await paneelDicht();
    expect(greep.beslissingen).toHaveLength(1);
  });

  it('koos de beslisser intussen zelf een andere aanvraag, dan schakelt het paneel niet door (het sluit, zoals vroeger)', async () => {
    const { greep, Traag } = traag();
    render(<Traag />);
    await openRij('Alex Du Priez');
    await klikInPaneel('Alex Du Priez', 'Goedkeuren');
    // De SlideOver ligt over de lijst; de rij erachter is er nog en wordt hier rechtstreeks aangetikt.
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Els Goossens/, hidden: true })[0]); });
    await wachtOpPaneel('Els Goossens');
    await act(async () => { greep.antwoord(true); });
    await paneelDicht();
    expect(greep.beslissingen).toEqual([{ id: 'w1', status: 'approved' }]);
  });

  it('de opstelling wordt gelezen als het antwoord er is (dan komt de toast): versmalt het venster tijdens het wachten, dan sluit het paneel', async () => {
    vensterBreedte = 1280;
    const { greep, Traag } = traag();
    render(<Traag />);
    await openAlex();
    await keurAlexGoed();
    vensterBreedte = 960;
    await act(async () => { greep.antwoord(true); });
    await allesDicht();
    expect(greep.beslissingen).toEqual([{ id: 'w1', status: 'approved' }]);
    expect(toasts).toEqual([TOAST_ALEX]);
  });
});

// De bevestiging ("Verlof goedgekeurd: …") staat vanaf 768 px rechtsboven.
// Gemeten in de browser (11-11): van 768 tot 1023 px ligt ze over de kop van
// de SlideOver, van 1024 tot 1194 px overlapt ze de kaart nog horizontaal en
// raakt ze de kop op een gescrolde pagina; onder 768 px (toast onderaan) en
// vanaf 1195 px (toast naast de kaart) blijft de kop vrij. Alleen daar
// schakelt het paneel door; ertussen sluit het zoals vroeger.
describe('Verlof beslissen: doorschakelen alleen waar de bevestiging de kop van het paneel vrijlaat', () => {
  it.each([
    [390, 'door'],
    [767, 'door'],
    [768, 'dicht'],
    [960, 'dicht'],
    [1023, 'dicht'],
    [1024, 'dicht'],
    [1100, 'dicht'],
    [1194, 'dicht'],
    [1195, 'door'],
    [1280, 'door'],
    [1440, 'door'],
  ] as const)('%i px breed: na Goedkeuren %s', async (breedte, verwacht) => {
    vensterBreedte = breedte;
    const beslissingen: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={beslissingen} />);
    await openAlex();
    await keurAlexGoed();
    if (verwacht === 'door') {
      await wachtOpVak('Diether Van Haute');
      expect(vak('Alex Du Priez')).toBeNull();
    } else {
      await allesDicht();
      // De twee anderen wachten nog, ongemoeid.
      expect(screen.getByRole('button', { name: /^Diether Van Haute/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Els Goossens/ })).toBeTruthy();
    }
    // Op elke breedte: precies één beslissing, en de toast noemt wie en wat.
    expect(beslissingen).toEqual([{ id: 'w1', status: 'approved', gezien: 'pending', reden: undefined }]);
    expect(toasts).toEqual([TOAST_ALEX]);
  });

  it('afwijzen met een reden volgt dezelfde regel: op 960 px sluit het paneel', async () => {
    vensterBreedte = 960;
    const beslissingen: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={beslissingen} />);
    await openRij('Alex Du Priez');
    await klikInPaneel('Alex Du Priez', 'Afwijzen');
    await act(async () => { fireEvent.change(inPaneel('Alex Du Priez').getByLabelText('Reden van afwijzing'), { target: { value: 'Te veel collega\'s al vrij.' } }); });
    await klikInPaneel('Alex Du Priez', 'Afwijzen');
    await allesDicht();
    expect(beslissingen).toEqual([{ id: 'w1', status: 'rejected', gezien: 'pending', reden: 'Te veel collega\'s al vrij.' }]);
    expect(toasts).toEqual([{ message: 'Verlof afgewezen: Alex Du Priez, 07/12/2026 t/m 11/12/2026.', tone: 'success' }]);
  });

  it('de breedte telt bij de beslissing, niet bij het laden: versmald na het openen sluit het paneel, verbreed schakelt het door', async () => {
    // Geladen en geopend op 1280 px, daarna versleept naar 960 px.
    vensterBreedte = 1280;
    const smal: Beslissing[] = [];
    const eerste = render(<Scherm start={DRIE()} beslissingen={smal} />);
    await openAlex();
    vensterBreedte = 960;
    await keurAlexGoed();
    await allesDicht();
    expect(smal).toHaveLength(1);
    eerste.unmount();

    // Omgekeerd: geladen en geopend op 960 px, daarna verbreed naar 1280 px.
    vensterBreedte = 960;
    const breed: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={breed} />);
    await openAlex();
    vensterBreedte = 1280;
    await keurAlexGoed();
    await wachtOpVak('Diether Van Haute');
    expect(breed).toHaveLength(1);
  });

  it('"Ook aangevraagd voor deze periode" blijft ook op 960 px wisselen: de planner kiest zelf een naam, er komt geen toast', async () => {
    vensterBreedte = 960;
    const beslissingen: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={beslissingen} />);
    await openRij('Alex Du Priez');
    const blok = inPaneel('Alex Du Priez').getByText('Ook aangevraagd voor deze periode').parentElement!;
    await act(async () => { fireEvent.click(within(blok).getByRole('button')); });
    await wachtOpPaneel('Diether Van Haute');
    expect(beslissingen).toEqual([]);
    expect(toasts).toEqual([]);
  });
});

describe('Verlof beslissen: ook aangevraagd voor deze periode', () => {
  it('noemt de andere wachtende aanvragen die de periode raken en wisselt het paneel, zonder iets te beslissen', async () => {
    const beslissingen: Beslissing[] = [];
    render(<Scherm start={DRIE()} beslissingen={beslissingen} />);
    await openRij('Alex Du Priez');
    const blok = inPaneel('Alex Du Priez').getByText('Ook aangevraagd voor deze periode').parentElement!;
    const regels = within(blok).getAllByRole('button');
    // Alleen wie de periode raakt: Diether wel, Els (later in december) niet.
    expect(regels.map((r) => r.textContent)).toEqual([expect.stringContaining('Diether Van Haute')]);
    expect(regels[0].textContent).toContain('08/12/2026');

    await act(async () => { fireEvent.click(regels[0]); });
    await wachtOpPaneel('Diether Van Haute');
    // Het slot zit erop: een klik op Goedkeuren beslist nu niets.
    await klikInPaneel('Diether Van Haute', 'Goedkeuren');
    expect(beslissingen).toEqual([]);
    // In het paneel van Diether staat wie zíjn periode raakt (zodra de vorige inhoud uitgefaded is).
    const blok2 = await waitFor(() => inPaneel('Diether Van Haute').getByText('Ook aangevraagd voor deze periode').parentElement!, RUIM);
    expect(within(blok2).getAllByRole('button').map((r) => r.textContent)).toEqual([expect.stringContaining('Alex Du Priez')]);
  });

  it('geen andere wachtenden voor de periode: het blok staat er niet', async () => {
    render(<Scherm start={DRIE()} beslissingen={[]} />);
    await openRij('Els Goossens');
    expect(inPaneel('Els Goossens').queryByText('Ook aangevraagd voor deze periode')).toBeNull();
  });
});
