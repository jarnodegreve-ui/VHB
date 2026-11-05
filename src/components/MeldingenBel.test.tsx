import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppDataProvider } from '../app/AppDataContext';
import type { AppData } from '../app/useAppData';

/**
 * De bel staat in de topbar, buiten de foutgrens van het scherm. Zijn paneel
 * laadt lui; op een tabblad van vóór een deploy bestaat die chunk niet meer.
 * Tot 05-11 gaf de voorlading bij hover dan een onafgehandelde afwijzing (en
 * een foutrapport) en de klik het crashscherm van de hele app. Nu slikt de
 * voorlading haar fout en laadt het paneel met het vangnet van lazyWithRetry
 * (dat gedrag zelf staat in src/lib/lazyRetry.test.ts).
 */
const chunk = vi.hoisted(() => ({ weg: false, pogingen: 0 }));
vi.mock('./MeldingenPaneel', async (importOriginal) => {
  chunk.pogingen += 1;
  if (chunk.weg) throw new Error('Failed to fetch dynamically imported module');
  return importOriginal();
});

import { MeldingenBel } from './MeldingenBel';

const data = { ongelezenMeldingen: 2 } as unknown as AppData;

beforeEach(() => {
  chunk.weg = true;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('MeldingenBel: voorladen van het paneel', () => {
  it('een mislukte voorlading bij hover of focus blijft stil; de bel en zijn teller staan er nog', async () => {
    // Vitest laat een test falen op een onafgehandelde afwijzing: deze test
    // bewaakt dus dat de voorlading haar fout zelf slikt.
    render(<AppDataProvider value={data}><MeldingenBel onNavigate={() => {}} /></AppDataProvider>);
    const bel = screen.getByRole('button', { name: 'Meldingen (2 ongelezen)' });
    fireEvent.pointerEnter(bel);
    fireEvent.focus(bel);
    await new Promise((r) => setTimeout(r, 0));
    expect(chunk.pogingen).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Meldingen (2 ongelezen)' })).toBeTruthy();
  });
});
