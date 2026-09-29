import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Modal draagt zelf geen padding (nr. 3): de twee modals van twee-staps-
// verificatie hadden een kop met marge en daaronder inhoud die tegen de rand
// van het venster stond. De inhoud hoort in een body met p-6, zoals elke
// andere modal (zie de voorbeelden in het designsysteem).

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));
vi.mock('../lib/tweeStaps', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/tweeStaps')>(),
  leesTweeStapsStatus: statusMock,
}));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  apiJson: vi.fn(async () => ({ staf: true, mfaVerplicht: false, aal: 'aal2', aanmeldingen: [] })),
}));
vi.mock('../lib/tweeStapsBeheer', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/tweeStapsBeheer')>(),
  startInschrijving: vi.fn(() => new Promise(() => {})),
}));

import { BeveiligingSectie } from './InstellingenView';
import type { User } from '../types';

const ADMIN = { id: '1', name: 'Annelies Admin', email: 'admin@vhb.be', role: 'admin', isActive: true } as unknown as User;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Het dichtste voorouder-element binnen de dialoog dat zelf padding draagt. */
const metMarge = (el: HTMLElement) => el.closest('[class~="p-6"], [class*=" p-6"], [class^="p-6"]');

describe('modals van twee-stapsverificatie', () => {
  it('uitschakelen: kop als h2, uitleg in de kop en de knoppen in een body met binnenmarge', async () => {
    statusMock.mockResolvedValue({ factorId: 'f-1', huidig: 'aal2', volgend: 'aal2' });
    render(<BeveiligingSectie user={ADMIN} onChangePassword={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Uitschakelen' }));
    const dialoog = await screen.findByRole('dialog', { name: 'Twee-stapsverificatie uitschakelen' });
    const kop = await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Twee-stapsverificatie uitschakelen' }));
    expect(kop.className).toContain('text-section-title');
    const uitleg = screen.getByText(/Daarna is je wachtwoord weer de enige sleutel/);
    expect(dialoog.contains(uitleg)).toBe(true);
    expect(metMarge(uitleg)).not.toBeNull();
    const annuleren = screen.getByRole('button', { name: 'Annuleren' });
    expect(dialoog.contains(metMarge(annuleren))).toBe(true);
  }, 20_000);

  it('instellen: het formulier staat in een body met binnenmarge', async () => {
    statusMock.mockResolvedValue({ factorId: null, huidig: 'aal1', volgend: 'aal1' });
    render(<BeveiligingSectie user={ADMIN} onChangePassword={() => {}} />);
    const knop = await screen.findByRole('button', { name: 'Instellen' });
    await waitFor(() => expect((knop as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(knop);
    const dialoog = await screen.findByRole('dialog', { name: 'Twee-stapsverificatie instellen' });
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Twee-stapsverificatie instellen' }));
    // Alles onder de kop zit in één body met p-6.
    const kinderen = [...dialoog.children].filter((k) => !k.querySelector('h2'));
    expect(kinderen.length).toBeGreaterThan(0);
    for (const kind of kinderen) expect((kind as HTMLElement).className, kind.outerHTML.slice(0, 80)).toMatch(/(^|\s)p-6(\s|$)/);
  }, 20_000);
});
