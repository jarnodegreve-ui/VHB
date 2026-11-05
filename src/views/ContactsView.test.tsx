import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '../types';
import { AppDataProvider } from '../app/AppDataContext';
import type { AppData } from '../app/useAppData';
import { ContactsView } from './ContactsView';

/**
 * Laadfout ≠ leeg (05-11): `usersGeladen` zegt alleen dat de eerste poging
 * rond is, ook na een fout. Een gebruikerslijst die nooit laadde toonde tot
 * dan "Geen contacten gevonden"; nu de Foutkaart met de herkansing van de
 * datalaag (useCollectieStaat, herlaadCollectie).
 */
const ik = { id: 'u-ik', name: 'Ik Zelf', role: 'chauffeur' } as User;

const schil = (staat: { geslaagd: boolean; mislukt: boolean } | undefined, herlaad: (k: string) => Promise<void>) =>
  ({ collectieStaat: staat ? { users: staat } : {}, herlaadCollectie: herlaad } as unknown as AppData);

beforeEach(() => {
  // matchMedia ontbreekt in jsdom (useMinWidth): de mobiele indeling.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ContactsView en een gebruikerslijst die niet laadde', () => {
  it('nooit geladen = Foutkaart, en Opnieuw proberen herlaadt de collectie users', async () => {
    const herlaad = vi.fn(async () => {});
    render(<AppDataProvider value={schil({ geslaagd: false, mislukt: true }, herlaad)}><ContactsView users={[]} currentUser={ik} /></AppDataProvider>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('De gebruikerslijst kon niet laden.')).toBeTruthy();
    expect(screen.queryByText('Geen contacten gevonden')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(herlaad).toHaveBeenCalledWith('users');
  });

  it('wel geladen en echt leeg = de gewone lege staat', () => {
    render(<AppDataProvider value={schil({ geslaagd: true, mislukt: false }, async () => {})}><ContactsView users={[]} currentUser={ik} /></AppDataProvider>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Geen contacten gevonden')).toBeTruthy();
  });
});
