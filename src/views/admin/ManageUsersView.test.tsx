import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Role, User } from '../../types';
import { magView } from '../../app/routes';

// Gebruikers: rijmenu op de telefoon (kaart) en op desktop (tabelrij) moet
// dezelfde acties tonen met dezelfde blokkades (tranche 3B, eis B van Jarno).
// De schermkeuze gebeurt in CSS (`hidden md:block` / `md:hidden`), dus in
// jsdom staan tabelrij en kaart er allebei: per breedte vergelijken we het
// menu van de rij met dat van de kaart voor dezelfde medewerker.

const { apiFetchMock, dataCtx } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  dataCtx: { users: [] as unknown[] },
}));
vi.mock('../../lib/api', () => ({
  apiFetch: apiFetchMock,
  // Zelfde contract als de echte: niet-ok = gooien, anders de JSON.
  apiJson: async (url: string, init?: RequestInit) => {
    const res: Response = await apiFetchMock(url, init);
    if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({})))?.error ?? 'fout'), { status: res.status });
    return res.json();
  },
}));
vi.mock('../../components/AanwezigOpScherm', () => ({ AanwezigOpScherm: () => null }));
vi.mock('../../app/AppDataContext', () => ({ useAppDataContext: () => dataCtx }));

import { ManageUsersView } from './ManageUsersView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const ADMIN = { id: '1', name: 'Annelies Admin', email: 'admin@vhb.be', role: 'admin', isActive: true } as User;
const PLANNER = { id: '2', name: 'Pieter Planner', email: 'planner@vhb.be', role: 'planner', isActive: true } as User;
const CHAUFFEUR = { id: '3', name: 'Chauffeur A', email: 'a@vhb.be', role: 'chauffeur', isActive: true } as User;
const GEPAUZEERD = { id: '4', name: 'Chauffeur Pauze', email: 'p@vhb.be', role: 'chauffeur', isActive: false } as User;
const USERS = [ADMIN, PLANNER, CHAUFFEUR, GEPAUZEERD];

/** matchMedia die min-/max-width tegen een gekozen schermbreedte beantwoordt. */
const zetBreedte = (px: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (min ? px >= Number(min[1]) : true) && (max ? px <= Number(max[1]) : true) && (min !== null || max !== null);
    return { matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() };
  });
};

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async () => new Response('[]', { status: 200 }));
  Object.assign(dataCtx, {
    users: USERS,
    saveUsers: vi.fn().mockResolvedValue(true),
    saveUser: vi.fn().mockResolvedValue(true),
    createUser: vi.fn().mockResolvedValue(true),
    deleteUser: vi.fn().mockResolvedValue(true),
    fetchUsers: vi.fn().mockResolvedValue(undefined),
    shifts: [], leaveRequests: [], swaps: [],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Item = { label: string; disabled: boolean };

/** Opent één rijmenu en leest de items (label + uitgeschakeld), sluit het weer. */
const leesMenu = async (trigger: HTMLElement): Promise<Item[]> => {
  await act(async () => { fireEvent.click(trigger); });
  const id = trigger.getAttribute('aria-controls')!;
  const menu = await waitFor(() => {
    const el = document.getElementById(id);
    expect(el).toBeTruthy();
    return el!;
  });
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .map((b) => ({ label: b.textContent?.trim() ?? '', disabled: b.disabled }));
  await act(async () => { fireEvent.click(trigger); });
  return items;
};

/** Het menu van de tabelrij (desktop) en dat van de kaart (telefoon) voor één medewerker. */
const menusVoor = async (naam: string) => {
  const triggers = screen.getAllByRole('button', { name: `Meer acties voor ${naam}` });
  // Eerst de tabel (hidden md:block), dan de kaartlijst (md:hidden).
  expect(triggers).toHaveLength(2);
  const [desktop, telefoon] = triggers;
  expect(desktop.closest('table')).toBeTruthy();
  expect(telefoon.closest('table')).toBeNull();
  return { desktop: await leesMenu(desktop), telefoon: await leesMenu(telefoon) };
};

const labels = (items: Item[]) => items.map((i) => i.label);
const item = (items: Item[], label: string) => items.find((i) => i.label === label);

describe('Gebruikers: wie het scherm mag openen', () => {
  it('alleen een admin; planner, chauffeur en technieker komen er niet (routetabel + magView)', () => {
    const rollen: Role[] = ['admin', 'planner', 'chauffeur', 'technieker'];
    expect(rollen.filter((r) => magView(r, 'gebruikers'))).toEqual(['admin']);
  });
});

describe.each([
  ['telefoon (375 px)', 375],
  ['desktop (1280 px)', 1280],
])('Gebruikers: rijmenu, %s', (_naam, breedte) => {
  beforeEach(() => zetBreedte(breedte));

  it('een staflid (planner): kaart en tabelrij tonen exact dezelfde acties, met pauzeren en de 2FA-reset', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const { desktop, telefoon } = await menusVoor(PLANNER.name);
    expect(telefoon).toEqual(desktop);
    expect(labels(desktop)).toEqual([
      'Verlof- en dienstruilhistoriek',
      'Documenten beheren',
      'Wijzigingsgeschiedenis',
      // Nog nooit ingelogd, met een adres: uitnodigen kan (30-09).
      'Uitnodigen voor het portaal',
      'Nieuw tijdelijk wachtwoord',
      'Twee-stapsverificatie resetten',
      'Gebruiker pauzeren',
      'Uit dienst',
      'Gebruiker verwijderen',
    ]);
    expect(item(desktop, 'Gebruiker pauzeren')?.disabled).toBe(false);
    expect(item(desktop, 'Twee-stapsverificatie resetten')?.disabled).toBe(false);
  });

  it('een chauffeur: geen 2FA-reset (chauffeurs hebben geen twee-stapsverificatie), wel pauzeren, op beide weergaven', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const { desktop, telefoon } = await menusVoor(CHAUFFEUR.name);
    expect(telefoon).toEqual(desktop);
    expect(labels(desktop)).not.toContain('Twee-stapsverificatie resetten');
    expect(item(desktop, 'Gebruiker pauzeren')?.disabled).toBe(false);
  });

  it('een gepauzeerde collega: Activeren in plaats van pauzeren, geen Uit dienst, op beide weergaven', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const { desktop, telefoon } = await menusVoor(GEPAUZEERD.name);
    expect(telefoon).toEqual(desktop);
    expect(labels(desktop)).toContain('Gebruiker activeren');
    expect(labels(desktop)).not.toContain('Gebruiker pauzeren');
    expect(labels(desktop)).not.toContain('Uit dienst');
  });

  it('de laatste actieve admin (en tegelijk jezelf): pauzeren, uit dienst en verwijderen staan uit, op beide weergaven', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const { desktop, telefoon } = await menusVoor(ADMIN.name);
    expect(telefoon).toEqual(desktop);
    expect(item(desktop, 'Gebruiker pauzeren')?.disabled).toBe(true);
    expect(item(desktop, 'Uit dienst')?.disabled).toBe(true);
    expect(item(desktop, 'Gebruiker verwijderen')?.disabled).toBe(true);
    // Een staflid: de 2FA-reset blijft beschikbaar (eigen toestel kwijt).
    expect(item(desktop, 'Twee-stapsverificatie resetten')?.disabled).toBe(false);
  });

  it('de selectievakjes volgen dezelfde bescherming op kaart en tabelrij', () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    for (const u of USERS) {
      const vakjes = screen.getAllByRole('checkbox', { name: `Selecteer ${u.name}` }) as HTMLInputElement[];
      expect(vakjes).toHaveLength(2);
      expect(vakjes[1].disabled).toBe(vakjes[0].disabled);
    }
    expect((screen.getAllByRole('checkbox', { name: `Selecteer ${ADMIN.name}` })[0] as HTMLInputElement).disabled).toBe(true);
  });
});

// "Ook technieker" (28-09): een chauffeur die ook in de garage werkt. De
// schakelaar staat alleen bij de rol chauffeur en reist mee in de save; de
// lijst zegt het in de rolregel, op tabelrij én kaart.
describe('Gebruikers: Ook technieker', () => {
  const saveUser = () => (dataCtx as unknown as { saveUser: ReturnType<typeof vi.fn> }).saveUser;
  const bewerk = async (naam: string) => {
    const rij = screen.getAllByText(naam).map((el) => el.closest('tr')).find((tr): tr is HTMLTableRowElement => tr !== null)!;
    await act(async () => { fireEvent.click(within(rij).getByRole('button', { name: 'Bewerken' })); });
    return screen.findByRole('dialog');
  };

  it('staat bij een chauffeur, en gaat mee bij opslaan', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const dialoog = await bewerk(CHAUFFEUR.name);
    const schakelaar = within(dialoog).getByRole('switch', { name: 'Ook technieker' });
    expect(schakelaar.getAttribute('aria-checked')).toBe('false');
    await act(async () => { fireEvent.click(schakelaar); });
    expect(schakelaar.getAttribute('aria-checked')).toBe('true');
    await act(async () => { fireEvent.click(within(dialoog).getByRole('button', { name: 'Opslaan' })); });
    await waitFor(() => expect(saveUser()).toHaveBeenCalled());
    expect(saveUser().mock.calls[0][0]).toMatchObject({ id: '3', role: 'chauffeur', ookTechnieker: true });
  });

  it('staat niet bij een planner of een admin', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const dialoog = await bewerk(PLANNER.name);
    expect(within(dialoog).queryByRole('switch', { name: 'Ook technieker' })).toBeNull();
  });

  it('de lijst toont "chauffeur + technieker" bij wie hem aan heeft', () => {
    dataCtx.users = [ADMIN, PLANNER, { ...CHAUFFEUR, ookTechnieker: true }, GEPAUZEERD];
    render(<ManageUsersView currentUser={ADMIN} />);
    expect(screen.getAllByText('chauffeur + technieker')).toHaveLength(2);
  });
});

// Uitnodigen voor het portaal (30-09): alleen wie nog nooit inlogde, een adres
// heeft en actief is; wie al uitgenodigd is, krijgt "opnieuw sturen" en een
// regel onder "Nooit". Het versturen zelf loopt via de gedeelde bevestiging.
describe('Gebruikers: uitnodigen', () => {
  const INGELOGD = { id: '5', name: 'Chauffeur Actief', email: 'actief@vhb.be', role: 'chauffeur', isActive: true, lastLogin: '2026-09-20T07:00:00.000Z' } as User;
  const ZONDER_ADRES = { id: '6', name: 'Chauffeur Zonder Adres', email: '', role: 'chauffeur', isActive: true } as User;
  const aanroepen = (pad: string) => apiFetchMock.mock.calls.filter(([url]) => url === pad);

  beforeEach(() => {
    zetBreedte(1280);
    dataCtx.users = [...USERS, INGELOGD, ZONDER_ADRES];
  });

  it('staat in het rijmenu bij wie nog nooit inlogde, niet bij wie al inlogde, gepauzeerd is of geen adres heeft', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    expect(labels((await menusVoor(CHAUFFEUR.name)).desktop)).toContain('Uitnodigen voor het portaal');
    for (const u of [INGELOGD, GEPAUZEERD, ZONDER_ADRES]) {
      const { desktop, telefoon } = await menusVoor(u.name);
      expect(telefoon).toEqual(desktop);
      expect(labels(desktop).some((l) => l.startsWith('Uitnodig'))).toBe(false);
    }
  });

  it('al uitgenodigd: "Uitnodiging opnieuw sturen" en "Uitgenodigd" onder Nooit; verlopen staat er ook', async () => {
    const nu = Date.now();
    apiFetchMock.mockImplementation(async (url: string) => (url === '/api/users/uitnodigingen'
      ? Response.json({ uitnodigingen: [
          { userId: CHAUFFEUR.id, op: new Date(nu - 86_400_000).toISOString(), tot: new Date(nu + 6 * 86_400_000).toISOString() },
          { userId: PLANNER.id, op: new Date(nu - 8 * 86_400_000).toISOString(), tot: new Date(nu - 86_400_000).toISOString() },
        ] })
      : new Response('[]', { status: 200 })));
    render(<ManageUsersView currentUser={ADMIN} />);
    await waitFor(() => expect(screen.getAllByText(/^Uitgenodigd [1-9]\d? (jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)$/)).toHaveLength(2));
    expect(screen.getAllByText('Uitnodiging verlopen')).toHaveLength(2);
    expect(labels((await menusVoor(CHAUFFEUR.name)).desktop)).toContain('Uitnodiging opnieuw sturen');
  });

  it('bulkbalk: uit bij een selectie zonder uitnodigbare mensen; anders voorbeeld, versturen en de lijst opnieuw ophalen', async () => {
    apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== '/api/users/uitnodigen') return new Response('[]', { status: 200 });
      const body = JSON.parse(String(init?.body));
      // De echte vorm van de server: `overgeslagen` is de vlag van de reeks,
      // de mensen die niet uitgenodigd worden staan in `nietUitgenodigd`.
      return body.droog
        ? Response.json({ droog: true, aantal: 1, ontvangers: [{ adres: 'a@vhb.be', naam: CHAUFFEUR.name }], html: '<p>voorbeeld</p>', nietUitgenodigd: [{ id: INGELOGD.id, naam: INGELOGD.name, reden: 'al-ingelogd' }] })
        : Response.json({ droog: false, aantal: 1, gelukt: 1, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, mocked: false, overgeslagen: false, resterend: [], onzekerAdressen: [], uitgenodigd: [{ userId: CHAUFFEUR.id, op: '2026-09-30T14:00:00.000Z', tot: '2026-10-07T14:00:00.000Z' }], nietUitgenodigd: [{ id: INGELOGD.id, naam: INGELOGD.name, reden: 'al-ingelogd' }] });
    });
    const toasts: Array<{ message: string; tone: string }> = [];
    const opToast = (e: Event) => { toasts.push((e as CustomEvent).detail); };
    window.addEventListener('vhb-toast', opToast);
    render(<ManageUsersView currentUser={ADMIN} />);
    const vink = async (u: User) => { await act(async () => { fireEvent.click(screen.getAllByRole('checkbox', { name: `Selecteer ${u.name}` })[0]); }); };

    await vink(INGELOGD);
    const knop = screen.getByRole('button', { name: 'Uitnodigen' }) as HTMLButtonElement;
    expect(knop.disabled).toBe(true);

    await vink(CHAUFFEUR);
    expect(knop.disabled).toBe(false);
    await act(async () => { fireEvent.click(knop); });
    const venster = await screen.findByRole('dialog', { name: 'Voorbeeld van de uitnodiging' });
    expect(within(venster).getByText(/Niet uitgenodigd: Chauffeur Actief \(al eens ingelogd\)/)).toBeTruthy();
    expect(JSON.parse(String(aanroepen('/api/users/uitnodigen')[0][1].body))).toEqual({ ids: [INGELOGD.id, CHAUFFEUR.id], droog: true });

    const voor = aanroepen('/api/users/uitnodigingen').length;
    await act(async () => { fireEvent.click(within(venster).getByRole('button', { name: 'Versturen naar 1' })); });
    await waitFor(() => expect(aanroepen('/api/users/uitnodigen')).toHaveLength(2));
    expect(JSON.parse(String(aanroepen('/api/users/uitnodigen')[1][1].body))).toEqual({ ids: [INGELOGD.id, CHAUFFEUR.id] });
    await waitFor(() => expect(aanroepen('/api/users/uitnodigingen').length).toBe(voor + 1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Voorbeeld van de uitnodiging' })).toBeNull());
    // Na een bulkactie is de selectie leeg, zoals bij pauzeren en activeren.
    expect((screen.getAllByRole('checkbox', { name: `Selecteer ${CHAUFFEUR.name}` })[0] as HTMLInputElement).checked).toBe(false);
    // En de melding zegt dat er verstuurd is, niet "Mail staat uit" (review 30-09).
    expect(toasts).toContainEqual(expect.objectContaining({ message: 'Uitnodiging verstuurd naar 1 ontvanger.', tone: 'success' }));
    window.removeEventListener('vhb-toast', opToast);
  });
});

// Vervaldata (Code 95, medische schifting) komen uit een aparte GET. Opende
// de planner Bewerken vóór dat antwoord binnen was, dan bleef de draft leeg
// en stuurde Opslaan voor elke soort validUntil: null: de vervaldata werden
// stil gewist (controle 04-11). Nu staan de velden uit tot ze geladen zijn,
// zaait de draft alsnog zodra ze binnen zijn, en slaat Opslaan ze over
// zolang ze onbekend zijn.
describe('Gebruikers: vervaldata die pas na het openen van Bewerken binnenkomen', () => {
  const saveUser = () => (dataCtx as unknown as { saveUser: ReturnType<typeof vi.fn> }).saveUser;
  const putsNaar = (pad: string) => apiFetchMock.mock.calls.filter(([url, init]) => url === pad && (init as RequestInit | undefined)?.method === 'PUT');
  const bewerk = async (naam: string) => {
    const rij = screen.getAllByText(naam).map((el) => el.closest('tr')).find((tr): tr is HTMLTableRowElement => tr !== null)!;
    await act(async () => { fireEvent.click(within(rij).getByRole('button', { name: 'Bewerken' })); });
    return screen.findByRole('dialog');
  };
  /** GET /api/user-expiries blijft hangen tot de test hem vrijgeeft. */
  const vervaldataLaterMet = (rows: Array<{ userId: string; soort: string; validUntil: string }>) => {
    let geef!: () => void;
    apiFetchMock.mockImplementation((url: string) => {
      if (url === '/api/user-expiries') return new Promise<Response>((r) => { geef = () => r(Response.json(rows)); });
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    return () => act(async () => { geef(); });
  };

  beforeEach(() => zetBreedte(1280));

  it('de velden staan uit tot de vervaldata er zijn en tonen dan de bewaarde datum', async () => {
    const geefVervaldata = vervaldataLaterMet([{ userId: CHAUFFEUR.id, soort: 'code95', validUntil: '2027-03-01' }]);
    render(<ManageUsersView currentUser={ADMIN} />);
    const dialoog = await bewerk(CHAUFFEUR.name);
    const code95 = within(dialoog).getByLabelText('Code 95') as HTMLInputElement;
    expect(code95.disabled).toBe(true);
    expect(within(dialoog).getByText(/nog niet geladen/)).toBeTruthy();

    await geefVervaldata();
    await waitFor(() => expect(code95.disabled).toBe(false));
    expect(code95.value).toBe('01/03/2027');
  });

  it('Opslaan vóór de vervaldata binnen zijn: de gebruiker wordt bewaard, de vervaldata blijven onaangeroerd', async () => {
    vervaldataLaterMet([{ userId: CHAUFFEUR.id, soort: 'code95', validUntil: '2027-03-01' }]);
    render(<ManageUsersView currentUser={ADMIN} />);
    const dialoog = await bewerk(CHAUFFEUR.name);
    await act(async () => { fireEvent.click(within(dialoog).getByRole('button', { name: 'Opslaan' })); });
    await waitFor(() => expect(saveUser()).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // De lus over de soorten wordt overgeslagen zolang de vervaldata onbekend zijn.
    expect(putsNaar('/api/user-expiries')).toHaveLength(0);
  });

  it('na het laden gaat alleen een echt gewijzigde soort naar de server (vroeger ook Code 95 met null)', async () => {
    const geefVervaldata = vervaldataLaterMet([{ userId: CHAUFFEUR.id, soort: 'code95', validUntil: '2027-03-01' }]);
    render(<ManageUsersView currentUser={ADMIN} />);
    const dialoog = await bewerk(CHAUFFEUR.name);
    await geefVervaldata();
    const schifting = within(dialoog).getByLabelText('Medische schifting') as HTMLInputElement;
    await waitFor(() => expect(schifting.disabled).toBe(false));
    fireEvent.change(schifting, { target: { value: '15/06/2027' } });
    fireEvent.blur(schifting);
    await act(async () => { fireEvent.click(within(dialoog).getByRole('button', { name: 'Opslaan' })); });
    await waitFor(() => expect(saveUser()).toHaveBeenCalled());
    await waitFor(() => expect(putsNaar('/api/user-expiries')).toHaveLength(1));
    expect(JSON.parse(String(putsNaar('/api/user-expiries')[0][1].body))).toEqual({ userId: CHAUFFEUR.id, soort: 'medische_schifting', validUntil: '2027-06-15' });
  });
});

// Meldingen en toestellen komen uit twee aparte GET's. Vroeger toonde de lijst
// meteen "Uit" en 0, ook vóór die antwoorden er waren of als ze mislukten:
// "Uit" las dan als "hij krijgt niets". Nu een plaatshouder tot ze binnen
// zijn, en "onbekend" als het laden mislukt (controle 04-11).
describe('Gebruikers: meldingen en toestellen pas tonen als de lijsten binnen zijn', () => {
  beforeEach(() => zetBreedte(1280));
  /** De waarde onder elk kopje Toestellen (kaarten op de telefoon), zonder de kolomkop van de tabel. */
  const toestellenKaarten = () => screen.getAllByText('Toestellen').filter((el) => !el.closest('th')).map((el) => el.nextElementSibling?.textContent ?? '');

  it('zolang de antwoorden uitblijven: geen Uit, geen 0 en geen teller in de kop', () => {
    const hangend = new Promise<Response>(() => {});
    apiFetchMock.mockImplementation((url: string) => ((url === '/api/push/subscribers' || url === '/api/devices') ? hangend : Promise.resolve(new Response('[]', { status: 200 }))));
    render(<ManageUsersView currentUser={ADMIN} />);
    expect(screen.queryByText('Uit')).toBeNull();
    expect(screen.queryByText('Meldingen uit')).toBeNull();
    expect(screen.queryByText(/van \d+ met meldingen/)).toBeNull();
    expect(toestellenKaarten().every((t) => t === '')).toBe(true);
  });

  it('binnen: Aan/Uit per rij, de teller in de kop en het aantal goedgekeurde toestellen', async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/push/subscribers') return Response.json({ userIds: [PLANNER.id] });
      if (url === '/api/devices') return Response.json([{ userId: CHAUFFEUR.id, status: 'approved' }, { userId: CHAUFFEUR.id, status: 'approved' }, { userId: PLANNER.id, status: 'pending' }]);
      return new Response('[]', { status: 200 });
    });
    render(<ManageUsersView currentUser={ADMIN} />);
    // Actieve medewerkers: admin, planner en chauffeur (de gepauzeerde telt niet mee).
    await screen.findByText('1 van 3 met meldingen');
    expect(screen.getAllByText('Aan')).toHaveLength(1);
    expect(screen.getAllByText('Meldingen aan')).toHaveLength(1);
    expect(screen.getAllByText('Uit')).toHaveLength(3);
    const kaart = screen.getAllByText(CHAUFFEUR.name).find((el) => !el.closest('tr'))!.closest('.p-5') as HTMLElement;
    expect(within(kaart).getByText('2')).toBeTruthy();
  });

  it('mislukt het laden: onbekend, niet Uit en niet 0', async () => {
    apiFetchMock.mockImplementation(async (url: string) => ((url === '/api/push/subscribers' || url === '/api/devices') ? new Response('{}', { status: 500 }) : new Response('[]', { status: 200 })));
    render(<ManageUsersView currentUser={ADMIN} />);
    await screen.findByText('Meldingen niet geladen');
    expect(screen.queryByText('Uit')).toBeNull();
    expect(screen.queryByText('Meldingen uit')).toBeNull();
    expect(screen.getAllByText('Onbekend').length).toBe(USERS.length);
    await waitFor(() => expect(toestellenKaarten().every((t) => t === 'onbekend')).toBe(true));
  });
});

// Nr. 48 (05-11): wie uit dienst gaat of gepauzeerd wordt, houdt zijn
// toekomstige diensten op naam. Het scherm zegt dat vooraf, en schrijft niets extra.
describe('Gebruikers: waarschuwing over toekomstige diensten op naam', () => {
  const saveUser = () => (dataCtx as unknown as { saveUser: ReturnType<typeof vi.fn> }).saveUser;
  const toekomst = [
    { id: 's1', driverId: '3', date: '2099-01-05', line: '2116', startTime: '06:00', endTime: '10:00' },
    { id: 's2', driverId: '3', date: '2099-01-05', line: '2116', startTime: '14:00', endTime: '18:00' },
    { id: 's3', driverId: '3', date: '2099-01-06', line: '2214', startTime: '06:00', endTime: '14:00' },
    { id: 's4', driverId: '4', date: '2099-01-06', line: '2300', startTime: '06:00', endTime: '14:00' },
  ];
  const kiesActie = async (naam: string, label: string) => {
    const trigger = screen.getAllByRole('button', { name: `Meer acties voor ${naam}` })[0];
    await act(async () => { fireEvent.click(trigger); });
    const menu = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    const knop = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent?.trim() === label)!;
    await act(async () => { fireEvent.click(knop); });
  };

  it('Uit dienst toont hoeveel diensten er nog op naam staan (gesplitste dienst één keer) en de eerste dag', async () => {
    Object.assign(dataCtx, { shifts: toekomst });
    render(<ManageUsersView currentUser={ADMIN} />);
    await kiesActie(CHAUFFEUR.name, 'Uit dienst');
    const dialoog = await screen.findByRole('dialog', { name: 'Uit dienst' });
    expect(dialoog.textContent).toContain('Staat nog op 2 diensten vanaf vandaag (eerste 05/01/2099). De diensten blijven op naam staan en verschijnen in Openstaande diensten.');
  });

  it('Pauzeren vraagt eerst een bevestiging als er diensten op naam staan, en slaat pas daarna op', async () => {
    Object.assign(dataCtx, { shifts: toekomst });
    render(<ManageUsersView currentUser={ADMIN} />);
    await kiesActie(CHAUFFEUR.name, 'Gebruiker pauzeren');
    expect(saveUser()).not.toHaveBeenCalled();
    const dialoog = await screen.findByRole('dialog');
    expect(dialoog.textContent).toContain('Chauffeur A staat nog op 2 diensten vanaf vandaag');
    await act(async () => { fireEvent.click(within(dialoog).getByRole('button', { name: 'Toch pauzeren' })); });
    await waitFor(() => expect(saveUser()).toHaveBeenCalled());
    expect(saveUser().mock.calls[0][0]).toMatchObject({ id: '3', isActive: false });
  });

  it('zonder diensten op naam pauzeert het meteen, zoals voorheen', async () => {
    Object.assign(dataCtx, { shifts: toekomst });
    render(<ManageUsersView currentUser={ADMIN} />);
    await kiesActie(PLANNER.name, 'Gebruiker pauzeren');
    await waitFor(() => expect(saveUser()).toHaveBeenCalled());
    expect(saveUser().mock.calls[0][0]).toMatchObject({ id: '2', isActive: false });
    expect(screen.queryByRole('button', { name: 'Toch pauzeren' })).toBeNull();
  });
});
