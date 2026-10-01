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

  it('een 200 zonder lijst is geen bevestiging: het venster blijft open en de lijst wordt niet gewist', async () => {
    for (const body of ['<html>Meld je aan op dit netwerk</html>', '', JSON.stringify({ ok: true })]) {
      apiFetchMock.mockReset();
      notifyMock.mockReset();
      apiFetchMock.mockResolvedValue(new Response(body, { status: 200 }));
      const onKlaar = vi.fn();
      const onSluit = vi.fn();
      const { unmount } = render(<FilmnummerImport bestand={bestand(CSV)} huidig={[]} onKlaar={onKlaar} onSluit={onSluit} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Lijst importeren' }));
      await waitFor(() => expect(notifyMock).toHaveBeenCalled());
      expect(String(notifyMock.mock.calls[0][0])).toContain('Importeren is mislukt.');
      expect(notifyMock.mock.calls[0][1]).toBe('error');
      expect(onKlaar, body).not.toHaveBeenCalled();
      expect(onSluit, body).not.toHaveBeenCalled();
      // De knop is weer vrij voor een nieuwe poging.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lijst importeren' }).getAttribute('aria-busy')).not.toBe('true'));
      unmount();
    }
  });

  it('waarschuwt als meer dan de helft van de lijst verdwijnt, en vraagt dan een bewuste bevestiging', async () => {
    const huidig = [...GELEZEN, f('8716', '871', 'Deinze Station'), f('8830', '883', 'Tielt Station'), f('9070', '907', 'Mariakerke VISO-AHS')];
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [f('1', '', 'Geen dienst'), f('94', '', 'Stelplaats')], bijgewerktOp: '2026-10-02T08:00:00.000Z' })));
    const onKlaar = vi.fn();
    render(<FilmnummerImport bestand={bestand('1;Geen dienst\r\n94;Stelplaats')} huidig={huidig} onKlaar={onKlaar} onSluit={vi.fn()} />);
    const dialoog = await screen.findByRole('dialog', { name: 'Filmnummers importeren' });
    await waitFor(() => expect(dialoog.textContent).toContain('6 verdwijnen'));
    expect(dialoog.textContent).toContain('Meer dan de helft van de lijst verdwijnt');
    expect(dialoog.textContent).toContain('De lijst telt nu 8 nummers; na deze import blijven er 2 over.');
    expect(screen.queryByRole('button', { name: 'Lijst vervangen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toch vervangen' }));
    await waitFor(() => expect(onKlaar).toHaveBeenCalled());
  });

  it('zegt hoe het bestand gelezen is, ook als er iets in een derde kolom staat', async () => {
    render(<FilmnummerImport bestand={bestand('1;Geen dienst\r\n5000;50 Brugge Station;altijd bij uitrukken')} huidig={[]} onKlaar={vi.fn()} onSluit={vi.fn()} />);
    const dialoog = await screen.findByRole('dialog', { name: 'Filmnummers importeren' });
    await waitFor(() => expect(dialoog.textContent).toContain('2 filmnummers gevonden: 1 bestemming op 1 lijn en 1 algemene boodschap.'));
    expect(dialoog.textContent).toContain('Kolom 1 is het nummer, kolom 2 de tekst van de film. Bij een nummer van vier cijfers of meer is het begin van de tekst de lijn (5000: 50 Brugge Station).');
    expect(dialoog.textContent).toContain('Bij 1 regel staat ook iets in een derde kolom; dat is niet gelezen.');
  });

  it('een bestand van meer dan 2 MB wordt niet gelezen', async () => {
    const groot = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'groot.csv', { type: 'text/csv' });
    render(<FilmnummerImport bestand={groot} huidig={[]} onKlaar={vi.fn()} onSluit={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Dit bestand is groter dan 2 MB');
    expect(screen.queryByRole('button', { name: /Lijst (vervangen|importeren)/ })).toBeNull();
  });
});
