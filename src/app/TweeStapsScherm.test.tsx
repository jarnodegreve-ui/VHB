import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TweeStapsScherm } from './TweeStapsScherm';
import { leesTweeStapsStatus } from '../lib/tweeStaps';

/**
 * 07-10, "niets laden vóór aal2": het codescherm leest de status van de
 * tweede stap zelf wanneer de server de code eist maar de client ze niet kon
 * lezen (stap 'code' zonder factor-id), met een weg terug als dat mislukt.
 */
vi.mock('../lib/tweeStaps', () => ({ leesTweeStapsStatus: vi.fn() }));
vi.mock('../components/TweeStapsInschrijving', () => ({
  TweeStapsCode: ({ factorId }: { factorId: string }) => <div>codeformulier {factorId}</div>,
  TweeStapsInschrijving: () => <div>inschrijfformulier</div>,
}));
vi.mock('./PreAppScreens', () => ({ CarbonScherm: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const lezing = vi.mocked(leesTweeStapsStatus);
const scherm = (stap: 'code' | 'inschrijven', factorId: string | null) =>
  render(<TweeStapsScherm stap={stap} factorId={factorId} onKlaar={() => {}} onLogout={() => {}} />);

describe('TweeStapsScherm', () => {
  beforeEach(() => { lezing.mockReset(); });
  afterEach(() => { cleanup(); });

  it('met een factor-id staat het codeformulier er meteen, zonder eigen lezing', () => {
    scherm('code', 'f1');
    expect(screen.getByText('codeformulier f1')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Code uit je authenticator' })).toBeTruthy();
    expect(lezing).not.toHaveBeenCalled();
  });

  it('inschrijven toont het inschrijfformulier, zonder eigen lezing', () => {
    scherm('inschrijven', null);
    expect(screen.getByText('inschrijfformulier')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Twee-stapsverificatie instellen' })).toBeTruthy();
    expect(lezing).not.toHaveBeenCalled();
  });

  it('code zonder factor-id: leest de status zelf en toont dan het codeformulier met de gevonden factor', async () => {
    lezing.mockResolvedValueOnce({ factorId: 'f9', huidig: 'aal1' });
    scherm('code', null);
    expect(screen.getByRole('status').textContent).toContain('Status van je tweede stap lezen');
    expect(await screen.findByText('codeformulier f9')).toBeTruthy();
    expect(lezing).toHaveBeenCalledTimes(1);
  });

  it('code zonder factor-id, maar de status zegt dat er geen authenticator is: inschrijven', async () => {
    lezing.mockResolvedValueOnce({ factorId: null, huidig: 'aal1' });
    scherm('code', null);
    expect(await screen.findByText('inschrijfformulier')).toBeTruthy();
  });

  it('lukt het lezen niet, dan een uitleg met Opnieuw proberen, en die leest opnieuw', async () => {
    lezing.mockResolvedValueOnce(null).mockResolvedValueOnce({ factorId: 'f1', huidig: 'aal1' });
    scherm('code', null);
    const knop = await screen.findByRole('button', { name: 'Opnieuw proberen' });
    expect(screen.getByText(/kon niet gelezen worden/)).toBeTruthy();
    // De kop blijft die van de code: de server eist de code, dat staat vast.
    expect(screen.getByRole('heading', { name: 'Code uit je authenticator' })).toBeTruthy();
    fireEvent.click(knop);
    expect(await screen.findByText('codeformulier f1')).toBeTruthy();
    expect(lezing).toHaveBeenCalledTimes(2);
  });

  it('komt de factor intussen via de props binnen, dan wint die van een late lezing', async () => {
    let geefTerug: (s: null) => void = () => {};
    lezing.mockImplementationOnce(() => new Promise((r) => { geefTerug = r; }));
    const { rerender } = scherm('code', null);
    rerender(<TweeStapsScherm stap="code" factorId="f2" onKlaar={() => {}} onLogout={() => {}} />);
    expect(await screen.findByText('codeformulier f2')).toBeTruthy();
    geefTerug(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('codeformulier f2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Opnieuw proberen' })).toBeNull();
  });
});
