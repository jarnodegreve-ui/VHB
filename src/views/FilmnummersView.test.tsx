import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiJsonMock, apiFetchMock, notifyMock, onlineMock } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
  apiFetchMock: vi.fn(),
  notifyMock: vi.fn(),
  onlineMock: vi.fn(() => true),
}));
vi.mock('../lib/api', () => ({ apiJson: apiJsonMock, apiFetch: apiFetchMock }));
vi.mock('../lib/useOnline', () => ({ useOnline: () => onlineMock() }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  notify: notifyMock,
}));

import { FilmnummersView } from './FilmnummersView';

const SLEUTEL = 'vhb-filmnummers';
const LIJST = {
  bijgewerktOp: '2026-10-01T13:30:00.000Z',
  items: [
    { code: '1', lijn: '', tekst: 'Geen dienst' },
    { code: '94', lijn: '', tekst: 'Stelplaats' },
    { code: '5000', lijn: '50', tekst: 'Brugge Station' },
    { code: '5004', lijn: '50', tekst: 'Eeklo Station' },
    { code: '8714', lijn: '871', tekst: 'Aalter Europalaan' },
    { code: '5056', lijn: 'G50', tekst: 'Eeklo Markt via Mariakerke P' },
  ],
};

/** De nummers in een sectie, in de volgorde op het scherm. */
const codesIn = (naam: string) =>
  within(screen.getByRole('list', { name: naam })).getAllByRole('listitem').map((li) => li.lastElementChild?.textContent);

beforeEach(() => {
  apiJsonMock.mockReset();
  apiFetchMock.mockReset();
  notifyMock.mockReset();
  onlineMock.mockReturnValue(true);
  const opslag = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => opslag.get(key) ?? null,
    setItem: (key: string, value: string) => opslag.set(key, value),
    removeItem: (key: string) => opslag.delete(key),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Filmnummers: de lijst', () => {
  it('toont de bestemmingen per lijn en de algemene boodschappen apart, en bewaart een kopie op het toestel', async () => {
    apiJsonMock.mockResolvedValue(LIJST);
    render(<FilmnummersView magBeheren={false} />);
    await screen.findByText('Brugge Station');
    expect(apiJsonMock).toHaveBeenCalledWith('/api/filmnummers');
    expect(codesIn('Bestemmingen')).toEqual(['5000', '5004', '8714', '5056']);
    expect(codesIn('Algemeen')).toEqual(['1', '94']);
    expect(screen.getAllByRole('img', { name: 'Lijn 50' })).toHaveLength(2);
    expect(screen.getByText('Lijst van 01/10/2026 · 6 nummers')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(SLEUTEL)!).items).toHaveLength(6);
    // Alleen-lezen voor wie geen admin is.
    expect(screen.queryByRole('button', { name: /Lijst (vervangen|importeren)/ })).toBeNull();
  });

  it('zoeken en de lijnkeuze beperken de lijst; "Wis filters" zet alles terug', async () => {
    apiJsonMock.mockResolvedValue(LIJST);
    render(<FilmnummersView magBeheren={false} />);
    await screen.findByText('Brugge Station');

    fireEvent.click(screen.getByRole('button', { name: 'Lijn 871' }));
    expect(codesIn('Bestemmingen')).toEqual(['8714']);
    expect(screen.queryByRole('list', { name: 'Algemeen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Algemeen' }));
    expect(codesIn('Algemeen')).toEqual(['1', '94']);
    expect(screen.queryByRole('list', { name: 'Bestemmingen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Alle' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Zoek in de filmnummers' }), { target: { value: 'eeklo' } });
    expect(codesIn('Bestemmingen')).toEqual(['5004', '5056']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Zoek in de filmnummers' }), { target: { value: 'bestaat niet' } });
    expect(screen.getByText('Geen filmnummer gevonden')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wis filters' }));
    expect(codesIn('Bestemmingen')).toHaveLength(4);
  });

  it('een lege lijst: uitleg voor de chauffeur, de import voor de admin', async () => {
    apiJsonMock.mockResolvedValue({ items: [], bijgewerktOp: null });
    const { unmount } = render(<FilmnummersView magBeheren={false} />);
    await screen.findByText('Nog geen filmnummers');
    expect(screen.getByText('Zodra de lijst klaarstaat, verschijnt ze hier.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lijst importeren' })).toBeNull();
    unmount();
    render(<FilmnummersView magBeheren />);
    expect(await screen.findByRole('button', { name: 'Lijst importeren' })).toBeTruthy();
  });
});

describe('Filmnummers: de kopie op het toestel', () => {
  it('staat er meteen, vóór de server antwoordt, en wordt daarna ververst', async () => {
    localStorage.setItem(SLEUTEL, JSON.stringify({ ...LIJST, items: LIJST.items.slice(0, 3) }));
    let antwoord!: (waarde: unknown) => void;
    apiJsonMock.mockReturnValue(new Promise((resolve) => { antwoord = resolve; }));
    render(<FilmnummersView magBeheren={false} />);
    // Synchroon in beeld: geen skelet, geen wachten.
    expect(screen.getByText('Brugge Station')).toBeTruthy();
    expect(screen.queryByText('Aalter Europalaan')).toBeNull();
    antwoord(LIJST);
    await screen.findByText('Aalter Europalaan');
  });

  it('zonder bereik blijft de kopie staan, zonder foutkaart', async () => {
    localStorage.setItem(SLEUTEL, JSON.stringify(LIJST));
    onlineMock.mockReturnValue(false);
    apiJsonMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<FilmnummersView magBeheren={false} />);
    await waitFor(() => expect(apiJsonMock).toHaveBeenCalled());
    await screen.findByText('Offline');
    expect(codesIn('Bestemmingen')).toHaveLength(4);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(JSON.parse(localStorage.getItem(SLEUTEL)!).items).toHaveLength(6);
  });

  it('zonder kopie is een mislukte laad een foutkaart met opnieuw proberen, geen lege lijst', async () => {
    apiJsonMock.mockRejectedValueOnce(new Error('kapot')).mockResolvedValueOnce(LIJST);
    render(<FilmnummersView magBeheren={false} />);
    const kaart = await screen.findByRole('alert');
    expect(within(kaart).getByText('De filmnummers konden niet laden.')).toBeTruthy();
    expect(screen.queryByText('Nog geen filmnummers')).toBeNull();
    fireEvent.click(within(kaart).getByRole('button', { name: 'Opnieuw proberen' }));
    await screen.findByText('Brugge Station');
  });

  it('een antwoord in een onverwachte vorm wist de kopie niet', async () => {
    localStorage.setItem(SLEUTEL, JSON.stringify(LIJST));
    apiJsonMock.mockResolvedValue([]);
    render(<FilmnummersView magBeheren={false} />);
    await screen.findByText('Bijwerken is niet gelukt');
    expect(codesIn('Bestemmingen')).toHaveLength(4);
    expect(JSON.parse(localStorage.getItem(SLEUTEL)!).items).toHaveLength(6);
  });
});
