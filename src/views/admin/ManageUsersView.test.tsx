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
    await waitFor(() => expect(screen.getAllByText(/^Uitgenodigd \d{2}\/\d{2}/)).toHaveLength(2));
    expect(screen.getAllByText('Uitnodiging verlopen')).toHaveLength(2);
    expect(labels((await menusVoor(CHAUFFEUR.name)).desktop)).toContain('Uitnodiging opnieuw sturen');
  });

  it('bulkbalk: uit bij een selectie zonder uitnodigbare mensen; anders voorbeeld, versturen en de lijst opnieuw ophalen', async () => {
    apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== '/api/users/uitnodigen') return new Response('[]', { status: 200 });
      const body = JSON.parse(String(init?.body));
      return body.droog
        ? Response.json({ droog: true, aantal: 1, ontvangers: [{ adres: 'a@vhb.be', naam: CHAUFFEUR.name }], html: '<p>voorbeeld</p>', overgeslagen: [{ id: INGELOGD.id, naam: INGELOGD.name, reden: 'al-ingelogd' }] })
        : Response.json({ droog: false, aantal: 1, gelukt: 1, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, mocked: false, overgeslagen: false, resterend: [], onzekerAdressen: [], uitgenodigd: [{ userId: CHAUFFEUR.id, op: '2026-09-30T14:00:00.000Z', tot: '2026-10-07T14:00:00.000Z' }] });
    });
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
  });
});
