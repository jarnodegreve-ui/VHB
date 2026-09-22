import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../../lib/updateReads', () => ({ fetchUpdateReadCounts: vi.fn().mockResolvedValue({ counts: {}, totalChauffeurs: 0 }) }));

import { ManageUpdatesView } from './ManageUpdatesView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom kent geen scrollIntoView (DetailPaneel en Formulier gebruiken het).
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

let desktop = false;
beforeEach(() => {
  desktop = false;
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(new Response('[]'));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const props = () => ({
  updates: [],
  onSave: vi.fn().mockResolvedValue(true),
  onSaveUpdate: vi.fn().mockResolvedValue(true),
  onCreateUpdate: vi.fn().mockResolvedValue(true),
  onDeleteUpdate: vi.fn().mockResolvedValue(true),
  onSendUrgentEmail: vi.fn().mockResolvedValue(undefined),
  canSendUrgentEmail: true,
  onHerlaad: vi.fn(),
});

describe('Beheer updates: lege velden', () => {
  it.each([false, true])('publiceren staat aan; leeg indienen toont de veldfouten, focust Titel en verstuurt niets (desktop=%s)', async (isDesktop) => {
    desktop = isDesktop;
    const p = props();
    render(<ManageUpdatesView {...p} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Nieuwe update/ })[0]);
    const knop = await screen.findByRole('button', { name: 'Update publiceren' });
    expect((knop as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(knop); });
    expect(await screen.findByText('Vul een titel in')).toBeTruthy();
    expect(screen.getByText('Schrijf een bericht')).toBeTruthy();
    const titel = screen.getByLabelText('Titel');
    expect(titel.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(titel));
    expect(p.onCreateUpdate).not.toHaveBeenCalled();
    expect(p.onSave).not.toHaveBeenCalled();
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/updates'), expect.objectContaining({ method: expect.any(String) }));
  });

  it('dubbel indienen terwijl het publiceren loopt, verstuurt één keer', async () => {
    const p = props();
    let klaar: (v: boolean) => void = () => {};
    p.onCreateUpdate.mockImplementation(() => new Promise<boolean>((r) => { klaar = r; }));
    render(<ManageUpdatesView {...p} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Nieuwe update/ })[0]);
    fireEvent.change(await screen.findByLabelText('Titel'), { target: { value: 'Omleiding markt' } });
    fireEvent.change(screen.getByLabelText('Inhoud'), { target: { value: 'Lijn 12 rijdt om.' } });
    const form = document.getElementById('update-form') as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(p.onCreateUpdate).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Update publiceren' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { klaar(true); });
  });
});

describe('Beheer updates op desktop: onbewaarde invoer', () => {
  const UPDATES = [
    { id: 'u1', date: '1/9/2026', title: 'Eerste', content: 'Tekst een', category: 'algemeen' as const },
    { id: 'u2', date: '2/9/2026', title: 'Tweede', content: 'Tekst twee', category: 'algemeen' as const },
  ];

  it('een andere update kiezen of Annuleren vraagt eerst; Verder bewerken houdt de invoer', async () => {
    desktop = true;
    render(<ManageUpdatesView {...props()} updates={UPDATES} />);
    const titel = await screen.findByLabelText('Titel') as HTMLInputElement;
    expect(titel.value).toBe('Eerste');
    fireEvent.change(titel, { target: { value: 'Eerste, aangepast' } });

    await act(async () => { fireEvent.click(screen.getByText('Tweede').closest('button')!); });
    expect(screen.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verder bewerken' })); });
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Eerste, aangepast');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Annuleren' })); });
    expect(screen.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Niet bewaren' })); });
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Eerste');

    // Schoon formulier: de wissel gaat zonder vraag (de inhoud wisselt met
    // een korte overgang, vandaar waitFor).
    await act(async () => { fireEvent.click(screen.getByText('Tweede').closest('button')!); });
    await waitFor(() => expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Tweede'));
  });
});
