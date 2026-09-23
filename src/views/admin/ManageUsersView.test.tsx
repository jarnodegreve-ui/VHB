import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
