import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { verwijderMock, notifyMock } = vi.hoisted(() => ({ verwijderMock: vi.fn(), notifyMock: vi.fn() }));
vi.mock('../../lib/techniek', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/techniek')>(),
  verwijderVoertuig: verwijderMock,
}));
vi.mock('../../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/ui')>(),
  notify: notifyMock,
}));

import { BewerkModal } from './VoertuigenView';
import { TechniekFout, type Vehicle } from '../../lib/techniek';

const BUS = {
  id: 'bus-1', busnr: '613 026', kortNr: 26, nummerplaat: '1-ABC-123', chassisnr: null, merk: 'Van Hool', type: 'standaard',
  categorie: 'bus', aandrijving: null, status: 'actief', inDienst: null, uitDienst: null, zitplaatsen: 40, opmerking: null,
} as unknown as Vehicle;

beforeEach(() => {
  verwijderMock.mockReset();
  notifyMock.mockReset();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const opent = () => {
  const onVerwijderd = vi.fn();
  render(<BewerkModal voertuig={BUS} onClose={vi.fn()} onKlaar={vi.fn()} onVerwijderd={onVerwijderd} />);
  return onVerwijderd;
};

describe('Voertuig verwijderen', () => {
  it('stuurt de DELETE pas na de bevestiging', async () => {
    let klaar!: () => void;
    verwijderMock.mockImplementation(() => new Promise<{ success: true }>((r) => { klaar = () => r({ success: true }); }));
    const onVerwijderd = opent();

    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    const dialoog = await screen.findByRole('dialog', { name: 'Voertuig verwijderen?' });
    expect(dialoog.textContent).toContain('613 026');
    expect(verwijderMock).not.toHaveBeenCalled();

    const knoppen = screen.getAllByRole('button', { name: 'Verwijderen' });
    fireEvent.click(knoppen[knoppen.length - 1]);
    expect(verwijderMock).toHaveBeenCalledWith('bus-1');
    // Server-confirmed: de dialoog blijft open tot de server antwoordt.
    expect(screen.getByRole('dialog', { name: 'Voertuig verwijderen?' })).toBeTruthy();
    expect(onVerwijderd).not.toHaveBeenCalled();

    klaar();
    await waitFor(() => expect(onVerwijderd).toHaveBeenCalledWith('bus-1'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Voertuig verwijderen?' })).toBeNull());
  });

  it('annuleren stuurt niets', async () => {
    opent();
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    const dialoog = await screen.findByRole('dialog', { name: 'Voertuig verwijderen?' });
    fireEvent.click(within(dialoog).getByRole('button', { name: 'Annuleren' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Voertuig verwijderen?' })).toBeNull());
    expect(verwijderMock).not.toHaveBeenCalled();
  });

  it('meldt een fout met vervolgstap en Opnieuw proberen', async () => {
    verwijderMock.mockRejectedValueOnce(new TechniekFout('Dit voertuig heeft meldingen of werkprestaties.', 409, null));
    const onVerwijderd = opent();
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    await screen.findByRole('dialog', { name: 'Voertuig verwijderen?' });
    const knoppen = screen.getAllByRole('button', { name: 'Verwijderen' });
    fireEvent.click(knoppen[knoppen.length - 1]);
    await waitFor(() => expect(notifyMock).toHaveBeenCalled());
    const [tekst, toon, opties] = notifyMock.mock.calls[0];
    expect(tekst).toMatch(/^Verwijderen is mislukt\. Dit voertuig heeft meldingen/);
    expect(toon).toBe('error');
    expect(opties?.action?.label).toBe('Opnieuw proberen');
    expect(onVerwijderd).not.toHaveBeenCalled();
  });
});
