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
vi.mock('../../lib/api', () => ({ apiFetch: apiFetchMock }));
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

  // 29-09 (rollabels): de tekst in de DOM was 'chauffeur + technieker' en
  // kreeg zijn hoofdletters van CSS capitalize; het label komt nu uit
  // shared/rollen.ts en staat er zoals je het leest.
  it('de lijst toont "Chauffeur + Technieker" bij wie hem aan heeft', () => {
    dataCtx.users = [ADMIN, PLANNER, { ...CHAUFFEUR, ookTechnieker: true }, GEPAUZEERD];
    render(<ManageUsersView currentUser={ADMIN} />);
    expect(screen.getAllByText('Chauffeur + Technieker')).toHaveLength(2);
    expect(screen.queryByText('chauffeur + technieker')).toBeNull();
  });
});

// Rollabels (29-09): de rol heet in Gebruikers zoals overal (shared/rollen.ts)
// en het rolfilter kent alle vier de rollen.
describe('Gebruikers: rollabels en rolfilter', () => {
  const TECHNIEKER = { id: '5', name: 'Tom Technieker', email: 't@vhb.be', role: 'technieker', isActive: true } as User;
  const BEIDE = { id: '6', name: 'Bea Beide', email: 'b@vhb.be', role: 'chauffeur', ookTechnieker: true, isActive: true } as User;
  const ALLEN = [ADMIN, PLANNER, CHAUFFEUR, GEPAUZEERD, TECHNIEKER, BEIDE];

  beforeEach(() => { dataCtx.users = ALLEN; });

  const filter = () => screen.getByRole('group', { name: 'Rol' });
  const kies = async (label: string) => {
    await act(async () => { fireEvent.click(within(filter()).getByRole('button', { name: label })); });
  };
  /** Namen in de tabel (desktop); de kaartlijst toont dezelfde lijst. */
  const inTabel = () => Array.from(document.querySelectorAll('table tbody tr'))
    .map((tr) => ALLEN.find((u) => tr.textContent?.includes(u.name))?.name)
    .filter((n): n is string => Boolean(n));

  it('het filter toont Alles en de vier rollen, in vaste volgorde, met Alles gekozen', () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const knoppen = within(filter()).getAllByRole('button');
    expect(knoppen.map((k) => k.textContent)).toEqual(['Alles', 'Chauffeur', 'Technieker', 'Planner', 'Beheerder']);
    expect(knoppen.map((k) => k.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(inTabel()).toHaveLength(ALLEN.length);
  });

  it('Technieker toont de techniekers, en de chauffeur met "Ook technieker"', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    await kies('Technieker');
    // waitFor: een rij die wegvalt speelt eerst haar uitgang af (LijstRij).
    await waitFor(() => expect(inTabel()).toEqual([BEIDE.name, TECHNIEKER.name]));
  });

  it('Chauffeur, Planner en Beheerder filteren op de rol, zoals voorheen', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    await kies('Chauffeur');
    await waitFor(() => expect(inTabel()).toEqual([BEIDE.name, CHAUFFEUR.name, GEPAUZEERD.name]));
    await kies('Planner');
    await waitFor(() => expect(inTabel()).toEqual([PLANNER.name]));
    await kies('Beheerder');
    await waitFor(() => expect(inTabel()).toEqual([ADMIN.name]));
    await kies('Alles');
    await waitFor(() => expect(inTabel()).toHaveLength(ALLEN.length));
  });

  it('de rolregel in rij en kaart is het label, niet de rolwaarde', () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    for (const [u, label] of [[ADMIN, 'Beheerder'], [PLANNER, 'Planner'], [TECHNIEKER, 'Technieker'], [CHAUFFEUR, 'Chauffeur'], [BEIDE, 'Chauffeur + Technieker']] as const) {
      const rijen = screen.getAllByRole('checkbox', { name: `Selecteer ${u.name}` }).map((c) => c.closest('tr, li, article, [data-record]') ?? c.parentElement!.parentElement!);
      expect(rijen).toHaveLength(2);
      for (const rij of rijen) expect(within(rij as HTMLElement).getByText(label, { selector: 'span' })).toBeTruthy();
    }
    expect(screen.queryByText('admin')).toBeNull();
    expect(screen.queryByText('planner')).toBeNull();
  });

  it('de rolkeuze in het formulier: de waarde is de rol, de tekst het label', async () => {
    render(<ManageUsersView currentUser={ADMIN} />);
    const rij = screen.getAllByText(PLANNER.name).map((el) => el.closest('tr')).find((tr): tr is HTMLTableRowElement => tr !== null)!;
    await act(async () => { fireEvent.click(within(rij).getByRole('button', { name: 'Bewerken' })); });
    const dialoog = await screen.findByRole('dialog');
    const keuze = within(dialoog).getByLabelText('Rol') as HTMLSelectElement;
    expect(keuze.value).toBe('planner');
    expect(Array.from(keuze.options).map((o) => [o.value, o.textContent])).toEqual([
      ['chauffeur', 'Chauffeur'], ['technieker', 'Technieker'], ['planner', 'Planner'], ['admin', 'Beheerder'],
    ]);
  });
});
