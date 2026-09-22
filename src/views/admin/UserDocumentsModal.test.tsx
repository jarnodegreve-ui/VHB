import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '../../types';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../lib/api', () => ({ apiFetch: apiFetchMock }));

import { UserDocumentsModal } from './UserDocumentsModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const CHAUFFEUR = { id: '3', name: 'Chauffeur A', role: 'chauffeur' } as User;

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(new Response('[]'));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Documenten van een gebruiker: categorie en upload', () => {
  it('Enter in de categorie opent de bestandskiezer niet; alleen de knop doet dat', async () => {
    const kiezer = vi.spyOn(HTMLInputElement.prototype, 'click');
    render(<UserDocumentsModal user={CHAUFFEUR} onClose={vi.fn()} />);
    const categorie = screen.getByLabelText('Categorie (optioneel)') as HTMLInputElement;
    fireEvent.change(categorie, { target: { value: 'attest' } });
    // Enter in een tekstveld = impliciete submit van het formulier.
    await act(async () => { fireEvent.submit(categorie.form!); });
    expect(kiezer).not.toHaveBeenCalled();
    expect(categorie.value).toBe('attest');
    expect(apiFetchMock).not.toHaveBeenCalledWith('/api/documents', expect.anything());

    fireEvent.click(screen.getByText(/Document toevoegen/).closest('button')!);
    expect(kiezer).toHaveBeenCalledTimes(1);
    expect((kiezer.mock.contexts[0] as HTMLInputElement).type).toBe('file');
  });

  it('een ingevulde categorie blijft beschermd: sluiten vraagt eerst "Wijzigingen niet bewaren?"', async () => {
    const onClose = vi.fn();
    render(<UserDocumentsModal user={CHAUFFEUR} onClose={onClose} />);
    const categorie = screen.getByLabelText('Categorie (optioneel)') as HTMLInputElement;
    fireEvent.change(categorie, { target: { value: 'loonbrief' } });
    await act(async () => { fireEvent.submit(categorie.form!); });
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Wijzigingen niet bewaren?', { selector: 'h2' })).toBeTruthy();
  });
});
