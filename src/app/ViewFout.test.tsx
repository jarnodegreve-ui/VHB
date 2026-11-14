import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLaatsteReferentie, reportBoundaryError, resetMonitoring } from '../lib/monitoring';
import { FoutReferentie } from './FoutReferentie';
import { ViewFout } from './ViewFout';

/**
 * Het foutscherm van een view (ronde 6, punt 10): "Opnieuw proberen" en de
 * foutreferentie staan links onder de tekst, zoals de EmptyState zelf. In een
 * gecentreerde kolom stond de knop eerst links en sprong hij naar het midden
 * zodra de referentie binnenkwam, onder de muis. FoutReferentie zonder
 * className blijft gecentreerd: dat is het crashscherm van de hele app
 * (src/main.tsx). De referentie komt langs de echte weg binnen: het rapport
 * van de foutgrens en het antwoord van POST /api/client-errors.
 */
const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, referentie: 'A7F3C1' }) }) as unknown as Response);

beforeEach(() => {
  // Vóór de render: resetMonitoring wist ook de luisteraars van de referentie.
  resetMonitoring();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetMonitoring();
});

/** De foutgrens meldt de crash; het antwoord van de server draagt de referentie. */
async function referentieKomtBinnen() {
  await act(async () => {
    reportBoundaryError(new Error('Testcrash'));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('ViewFout', () => {
  it('zet knop en referentie links onder de tekst, vóór en na het binnenkomen van de referentie', async () => {
    render(<ViewFout onRetry={() => {}} />);
    const knop = screen.getByRole('button', { name: 'Opnieuw proberen' });
    const kolom = knop.parentElement!;
    expect(kolom.className).toMatch(/\bitems-start\b/);
    expect(kolom.className).not.toMatch(/\bitems-center\b/);
    // Nog geen rapport: alleen de knop.
    expect(screen.queryByText(/Referentie/)).toBeNull();

    await referentieKomtBinnen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const referentie = (await screen.findByText('A7F3C1')).closest('div')!;
    expect(referentie.parentElement).toBe(kolom);
    expect(referentie.className).toMatch(/\bitems-start\b/);
    expect(referentie.className).not.toMatch(/\bitems-center\b/);
    // Dezelfde knop in dezelfde kolom, die nog altijd links uitlijnt.
    expect(screen.getByRole('button', { name: 'Opnieuw proberen' })).toBe(knop);
    expect(knop.parentElement).toBe(kolom);
    expect(kolom.className).toMatch(/\bitems-start\b/);
  });

  it('Opnieuw proberen wist de referentie en probeert opnieuw', async () => {
    const onRetry = vi.fn();
    render(<ViewFout onRetry={onRetry} />);
    await referentieKomtBinnen();
    await screen.findByText('A7F3C1');
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(getLaatsteReferentie()).toBeNull();
    expect(screen.queryByText('A7F3C1')).toBeNull();
  });
});

describe('FoutReferentie', () => {
  it('zonder className blijft ze gecentreerd (crashscherm van main.tsx)', async () => {
    render(<FoutReferentie />);
    expect(screen.queryByText(/Referentie/)).toBeNull();
    await referentieKomtBinnen();
    const referentie = (await screen.findByText('A7F3C1')).closest('div')!;
    expect(referentie.className).toMatch(/\bitems-center\b/);
    expect(referentie.className).not.toMatch(/\bitems-start\b/);
  });
});
