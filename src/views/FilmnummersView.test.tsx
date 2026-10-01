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

// Het importvenster zelf heeft zijn eigen test; hier telt wat het scherm doet
// met de lijst die de server na een import teruggeeft.
vi.mock('../components/FilmnummerImport', () => ({
  default: ({ onKlaar, onSluit }: { onKlaar: (lijst: unknown) => void; onSluit: () => void }) => (
    <button type="button" onClick={() => { onKlaar(NA_IMPORT); onSluit(); }}>Import bevestigen</button>
  ),
}));

import { _resetFilmnummersVoorTests } from '../lib/filmnummers';
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

const NA_IMPORT = {
  bijgewerktOp: '2026-10-02T08:00:00.000Z',
  items: [
    { code: '1', lijn: '', tekst: 'Geen dienst' },
    { code: '9070', lijn: '907', tekst: 'Mariakerke VISO-AHS' },
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
  _resetFilmnummersVoorTests();
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
    expect(apiJsonMock).toHaveBeenCalledWith('/api/filmnummers', { signal: undefined });
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

  it('komt het bereik terug en slaagt de verversing, dan verschijnt er geen foutkaart', async () => {
    localStorage.setItem(SLEUTEL, JSON.stringify({ ...LIJST, items: LIJST.items.slice(0, 3) }));
    onlineMock.mockReturnValue(false);
    apiJsonMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(LIJST);
    const { rerender } = render(<FilmnummersView magBeheren={false} />);
    await screen.findByText('Offline');
    expect(screen.queryByText('Aalter Europalaan')).toBeNull();

    onlineMock.mockReturnValue(true);
    rerender(<FilmnummersView magBeheren={false} />);
    // De stille verversing brengt de volledige lijst; de fout van daarnet is weg.
    await screen.findByText('Aalter Europalaan');
    expect(apiJsonMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Bijwerken is niet gelukt')).toBeNull();
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('met bereik en een server die faalt: de kopie blijft en een kleine kaart zegt dat bijwerken niet lukte', async () => {
    localStorage.setItem(SLEUTEL, JSON.stringify(LIJST));
    apiJsonMock.mockRejectedValue(Object.assign(new Error('De filmnummers konden niet laden.'), { status: 500 }));
    render(<FilmnummersView magBeheren={false} />);
    await screen.findByText('Bijwerken is niet gelukt');
    expect(codesIn('Bestemmingen')).toHaveLength(4);
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

describe('Filmnummers: na een import door de admin', () => {
  const kiesBestand = (container: HTMLElement) => {
    const invoer = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(invoer, { target: { files: [new File(['1;Geen dienst'], 'Filmbeelden.csv', { type: 'text/csv' })] } });
  };

  it('toont de nieuwe lijst, bewaart ze op het toestel, wist de filters en meldt het', async () => {
    apiJsonMock.mockResolvedValue(LIJST);
    const { container } = render(<FilmnummersView magBeheren />);
    await screen.findByText('Brugge Station');
    // Een filter dat na de import niet meer bestaat (lijn 871 verdwijnt).
    fireEvent.click(screen.getByRole('button', { name: 'Lijn 871' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Zoek in de filmnummers' }), { target: { value: 'aalter' } });
    expect(codesIn('Bestemmingen')).toEqual(['8714']);

    kiesBestand(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Import bevestigen' }));

    await screen.findByText('Mariakerke VISO-AHS');
    expect(codesIn('Bestemmingen')).toEqual(['9070']);
    expect(codesIn('Algemeen')).toEqual(['1']);
    expect((screen.getByRole('searchbox', { name: 'Zoek in de filmnummers' }) as HTMLInputElement).value).toBe('');
    expect(JSON.parse(localStorage.getItem(SLEUTEL)!).items).toEqual(NA_IMPORT.items);
    expect(notifyMock).toHaveBeenCalledWith('Filmnummers bijgewerkt: 2 nummers.', 'success');
    // Het venster is dicht en de knop is weer vrij.
    expect(screen.queryByRole('button', { name: 'Import bevestigen' })).toBeNull();
  });

  it('een verversing die vóór de import vertrok zet het scherm en de kopie niet terug op de oude lijst', async () => {
    apiJsonMock.mockResolvedValueOnce(LIJST);
    const { container } = render(<FilmnummersView magBeheren />);
    await screen.findByText('Brugge Station');

    // Een stille verversing (terug naar het tabblad na tien minuten) die nog loopt.
    let antwoord!: (waarde: unknown) => void;
    apiJsonMock.mockReturnValueOnce(new Promise((resolve) => { antwoord = resolve; }));
    const eerder = Date.now;
    Date.now = () => eerder() + 11 * 60_000;
    try {
      fireEvent.focus(window);
      await waitFor(() => expect(apiJsonMock).toHaveBeenCalledTimes(2));
    } finally {
      Date.now = eerder;
    }

    kiesBestand(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Import bevestigen' }));
    await screen.findByText('Mariakerke VISO-AHS');

    antwoord(LIJST);
    await waitFor(() => expect(screen.queryByText('Bijwerken…')).toBeNull());
    expect(codesIn('Bestemmingen')).toEqual(['9070']);
    expect(screen.queryByText('Brugge Station')).toBeNull();
    expect(JSON.parse(localStorage.getItem(SLEUTEL)!).items).toEqual(NA_IMPORT.items);
  });
});
