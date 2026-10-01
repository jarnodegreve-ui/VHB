import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { apiFetchMock, notifyMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn(), notifyMock: vi.fn() }));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  notify: notifyMock,
}));

import FilmnummerImport from './FilmnummerImport';
import type { Filmnummer } from '../../shared/filmnummers';

const f = (code: string, lijn: string, tekst: string): Filmnummer => ({ code, lijn, tekst });
const bestand = (inhoud: string, naam = 'Filmbeelden.csv') => new File([inhoud], naam, { type: 'text/csv' });

// De opbouw van het bestand van VHB: nummer, tekst; de lijn vooraan in de tekst.
const CSV = ['1;Geen dienst', '94;Stelplaats', '5000;50 Brugge Station', '5001;50 Maldegem', '8714;871 Aalter Europalaan'].join('\r\n');
const GELEZEN = [f('1', '', 'Geen dienst'), f('94', '', 'Stelplaats'), f('5000', '50', 'Brugge Station'), f('5001', '50', 'Maldegem'), f('8714', '871', 'Aalter Europalaan')];

beforeEach(() => {
  apiFetchMock.mockReset();
  notifyMock.mockReset();
});
afterEach(() => cleanup());

describe('FilmnummerImport', () => {
  it('toont wat er in het bestand staat en wat er verandert, en vervangt de lijst pas na bevestiging', async () => {
    const opgeslagen = { items: GELEZEN, bijgewerktOp: '2026-10-01T13:30:00.000Z' };
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify(opgeslagen)));
    const onKlaar = vi.fn();
    const onSluit = vi.fn();
    const huidig = [f('1', '', 'Geen dienst'), f('5000', '50', 'Brugge'), f('7000', '70', 'Oude lijn')];
    render(<FilmnummerImport bestand={bestand(CSV)} huidig={huidig} onKlaar={onKlaar} onSluit={onSluit} />);

    const dialoog = await screen.findByRole('dialog', { name: 'Filmnummers importeren' });
    await waitFor(() => expect(dialoog.textContent).toContain('5 filmnummers gevonden: 3 bestemmingen op 2 lijnen en 2 algemene boodschappen.'));
    expect(dialoog.textContent).toContain('3 nieuw: 94 Stelplaats, 5001 Maldegem, 8714 Aalter Europalaan');
    expect(dialoog.textContent).toContain('1 gewijzigd: 5000 Brugge Station');
    expect(dialoog.textContent).toContain('1 verdwijnt: 7000 Oude lijn');
    expect(apiFetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lijst vervangen' }));
    await waitFor(() => expect(onKlaar).toHaveBeenCalledWith(opgeslagen));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/filmnummers', { method: 'PUT', body: JSON.stringify({ items: GELEZEN }) });
    expect(onSluit).toHaveBeenCalled();
  });

  it('meldt overgeslagen regels met regelnummer en reden', async () => {
    render(<FilmnummerImport bestand={bestand('1;Geen dienst\r\nABC;Geen nummer\r\n1;Dubbel')} huidig={[]} onKlaar={vi.fn()} onSluit={vi.fn()} />);
    const dialoog = await screen.findByRole('dialog', { name: 'Filmnummers importeren' });
    await waitFor(() => expect(dialoog.textContent).toContain('2 regels overgeslagen'));
    expect(dialoog.textContent).toContain('Regel 2 (ABC · Geen nummer): het nummer bestaat niet uit 1 tot 6 cijfers.');
    expect(dialoog.textContent).toContain('Regel 3 (1 · Dubbel): nummer 1 staat al op regel 1.');
    expect(dialoog.textContent).toContain('Er staat nog geen lijst; dit wordt de eerste.');
    expect(screen.getByRole('button', { name: 'Lijst importeren' })).toBeTruthy();
  });

  it('een bestand dat niets verandert valt niet op te slaan: alleen Sluiten', async () => {
    render(<FilmnummerImport bestand={bestand(CSV)} huidig={GELEZEN} onKlaar={vi.fn()} onSluit={vi.fn()} />);
    const dialoog = await screen.findByRole('dialog', { name: 'Filmnummers importeren' });
    await waitFor(() => expect(dialoog.textContent).toContain('Niets: dit bestand is gelijk aan de lijst die er staat.'));
    expect(screen.queryByRole('button', { name: /Lijst (vervangen|importeren)/ })).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('een bestand zonder filmnummers: uitleg en alleen Sluiten', async () => {
    const onSluit = vi.fn();
    render(<FilmnummerImport bestand={bestand('')} huidig={[]} onKlaar={vi.fn()} onSluit={onSluit} />);
    expect((await screen.findByRole('alert')).textContent).toContain('In dit bestand staan geen filmnummers.');
    expect(screen.queryByRole('button', { name: /Lijst (vervangen|importeren)/ })).toBeNull();
    // Het kruisje in de kop en de knop in de voet heten allebei Sluiten.
    fireEvent.click(screen.getAllByRole('button', { name: 'Sluiten' }).at(-1)!);
    expect(onSluit).toHaveBeenCalled();
  });

  it('weigert de server, dan blijft het venster open en meldt een toast de reden', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Ongeldige invoer', details: 'Rij 2 (Stelplaats): code: Een filmnummer bestaat uit 1 tot 6 cijfers' }), { status: 400 }));
    const onKlaar = vi.fn();
    const onSluit = vi.fn();
    render(<FilmnummerImport bestand={bestand(CSV)} huidig={[]} onKlaar={onKlaar} onSluit={onSluit} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lijst importeren' }));
    await waitFor(() => expect(notifyMock).toHaveBeenCalled());
    expect(String(notifyMock.mock.calls[0][0])).toContain('Importeren is mislukt.');
    expect(String(notifyMock.mock.calls[0][0])).toContain('Rij 2 (Stelplaats)');
    expect(onKlaar).not.toHaveBeenCalled();
    expect(onSluit).not.toHaveBeenCalled();
  });
});
