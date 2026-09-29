import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BijlageViewerProps } from './BijlageViewer';

/**
 * De drie plekken waar een bijlage opent (omleiding lezen, update lezen,
 * beheer): de knop toont de bijlage in de app en verlaat het portaal niet.
 * De viewer zelf is hier een stand-in; zijn gedrag staat in
 * BijlageViewer.test.tsx.
 */
const { openPdfMock, viewerProps } = vi.hoisted(() => ({ openPdfMock: vi.fn(), viewerProps: [] as unknown[] }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
}));
vi.mock('./BijlageViewer', () => ({
  default: (props: BijlageViewerProps) => {
    viewerProps.push(props);
    return props.bijlage ? (
      <div role="dialog" aria-label={props.bijlage.filename}>
        <button type="button" onClick={props.onClose}>Terug</button>
      </div>
    ) : null;
  },
}));

import { OmleidingDetail } from './OmleidingDetail';
import { UpdateBijlagenLezen } from './UpdateBijlagenLezen';
import { PdfBijlagenLijst } from './PdfBijlagen';
import { OmleidingBijlagen } from './OmleidingBijlagen';
import { UpdateBijlagen } from './UpdateBijlagen';
import type { Diversion, Update } from '../types';

const PLAN = { slot: 1, filename: 'plan.pdf', sizeBytes: 1200, url: 'https://opslag.test/o-1-1.pdf?token=a' };
const HALTES = { slot: 2, filename: 'haltes.pdf', sizeBytes: 800, url: 'https://opslag.test/o-1-2.pdf?token=a' };
const OMLEIDING: Diversion = { id: 'o-1', line: '58', title: 'Werken Markt', description: 'Omrijden via de ring.', startDate: '2026-09-20', endDate: '2026-10-10', bijlagen: [PLAN, HALTES] };
const UPDATE: Update = { id: 'u-1', date: '2026-09-20', title: 'Mededeling', content: 'Zie bijlage.', bijlagen: [{ slot: 1, filename: 'mededeling.pdf', sizeBytes: 500, url: 'https://opslag.test/u-1-1.pdf?token=a' }] };
const laatste = () => viewerProps.at(-1) as BijlageViewerProps;

beforeEach(() => {
  openPdfMock.mockReset();
  viewerProps.length = 0;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('een bijlage openen', () => {
  it('omleiding: de knop opent de bijlage in de app, het detail blijft staan', async () => {
    render(<OmleidingDetail diversion={OMLEIDING} />);
    // Zolang niemand tikt is de viewer niet geladen.
    expect(viewerProps).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'haltes.pdf' }));
    expect(await screen.findByRole('dialog', { name: 'haltes.pdf' })).toBeTruthy();
    expect(laatste()).toMatchObject({ soort: 'omleiding', recordId: 'o-1', bijlage: HALTES });
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(screen.getByText('Omrijden via de ring.')).toBeTruthy();

    // Terug sluit de viewer; het detail en de andere bijlage staan er nog.
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(laatste().bijlage).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'plan.pdf' }));
    expect(await screen.findByRole('dialog', { name: 'plan.pdf' })).toBeTruthy();
  });

  it('update: de knop opent de bijlage in de app', async () => {
    render(<UpdateBijlagenLezen update={UPDATE} />);
    fireEvent.click(screen.getByRole('button', { name: 'mededeling.pdf' }));
    expect(await screen.findByRole('dialog', { name: 'mededeling.pdf' })).toBeTruthy();
    expect(laatste()).toMatchObject({ soort: 'update', recordId: 'u-1', bijlage: UPDATE.bijlagen![0] });
    expect(openPdfMock).not.toHaveBeenCalled();
  });

  it('beheer: “Openen” toont dezelfde viewer, met het record en de plaats van de bijlage', async () => {
    render(
      <PdfBijlagenLijst
        rijen={[{ sleutel: '2', slot: 2, filename: 'haltes.pdf', sizeBytes: 800, url: HALTES.url }]}
        bron={{ soort: 'omleiding', recordId: 'o-1' }}
        bezig={false}
        onVerwijder={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Openen' }));
    expect(await screen.findByRole('dialog', { name: 'haltes.pdf' })).toBeTruthy();
    expect(laatste()).toMatchObject({ soort: 'omleiding', recordId: 'o-1', bijlage: HALTES });
    expect(openPdfMock).not.toHaveBeenCalled();

    // Een bestand dat nog wacht op het opslaan hangt nergens: geen knop.
    cleanup();
    render(<PdfBijlagenLijst rijen={[{ sleutel: 'wacht-0', filename: 'nieuw.pdf', sizeBytes: 10, wachtend: true }]} bron={{ soort: 'omleiding', recordId: 'o-1' }} bezig={false} onVerwijder={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Openen' })).toBeNull();
  });

  // Uploadmoment (29-09): wat de server meegeeft, bereikt de viewer ook vanuit
  // het beheer, anders ziet de cache een vervanging met dezelfde naam en
  // grootte als hetzelfde bestand.
  it('beheer: het uploadmoment van de server gaat mee naar de viewer, bij omleidingen en updates', async () => {
    const MOMENT = '2026-09-29T08:00:00.000Z';
    const metMoment = { ...HALTES, uploadedAt: MOMENT };
    render(<OmleidingBijlagen diversion={{ ...OMLEIDING, bijlagen: [PLAN, metMoment] }} wachtrij={[]} onWachtrij={() => {}} onGewijzigd={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Openen' })[1]);
    expect(await screen.findByRole('dialog', { name: 'haltes.pdf' })).toBeTruthy();
    expect(laatste()).toMatchObject({ soort: 'omleiding', recordId: 'o-1', bijlage: metMoment });
    // Een bijlage zonder uploadmoment (van vóór 29-09) blijft gewoon openen.
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Openen' })[0]);
    expect(await screen.findByRole('dialog', { name: 'plan.pdf' })).toBeTruthy();
    expect(laatste().bijlage).toEqual({ ...PLAN, uploadedAt: undefined });

    cleanup();
    const mededeling = { ...UPDATE.bijlagen![0], uploadedAt: MOMENT };
    render(<UpdateBijlagen update={{ ...UPDATE, bijlagen: [mededeling] }} tonen={false} onTonenChange={() => {}} onGewijzigd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Openen' }));
    expect(await screen.findByRole('dialog', { name: 'mededeling.pdf' })).toBeTruthy();
    expect(laatste()).toMatchObject({ soort: 'update', recordId: 'u-1', bijlage: mededeling });
    expect(openPdfMock).not.toHaveBeenCalled();
  });
});
