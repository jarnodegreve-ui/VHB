import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '../../types';
import type { DocumentViewerProps } from '../../components/BijlageViewer';

const { apiFetchMock, openPdfMock, viewerProps } = vi.hoisted(() => ({ apiFetchMock: vi.fn(), openPdfMock: vi.fn(), viewerProps: [] as unknown[] }));
vi.mock('../../lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
}));
// De viewer is hier een stand-in; zijn gedrag staat in src/components/documentViewer.test.tsx.
vi.mock('../../components/BijlageViewer', () => ({
  default: (props: DocumentViewerProps) => {
    viewerProps.push(props);
    return props.document ? (
      <div role="dialog" aria-label={props.document.filename}>
        <button type="button" onClick={props.onClose}>Terug</button>
      </div>
    ) : null;
  },
}));

import { UserDocumentsModal } from './UserDocumentsModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const CHAUFFEUR = { id: '3', name: 'Chauffeur A', role: 'chauffeur' } as User;

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(new Response('[]'));
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

  // PDF in de app (29-09): het beheer opent een PDF in dezelfde viewer als de
  // chauffeur, niets blijft op het toestel; een foto gaat de oude weg.
  it('"Openen": een PDF in de viewer met de lijst van deze gebruiker, een foto extern; nooit een leesbevestiging', async () => {
    const pdf = { id: 'doc-1', userId: '3', filename: 'Loonbrief september.pdf', category: 'loonbrief', sizeBytes: 2048, uploadedAt: '2026-09-28T08:00:00Z', uploadedBy: 'Admin', url: 'https://x.supabase.co/storage/v1/object/sign/user-documents/3/a-loonbrief.pdf?token=t' };
    const foto = { ...pdf, id: 'doc-2', filename: 'Rijbewijs.jpg', url: 'https://x.supabase.co/storage/v1/object/sign/user-documents/3/b-rijbewijs.jpg?token=t' };
    apiFetchMock.mockImplementation(async (pad: string) => new Response(JSON.stringify(pad === '/api/documents?userId=3' ? [pdf, foto] : [])));
    render(<UserDocumentsModal user={CHAUFFEUR} onClose={vi.fn()} />);
    await screen.findByText(/Loonbrief september\.pdf/);
    const [openPdf, openFoto] = screen.getAllByRole('button', { name: 'Openen' });

    fireEvent.click(openFoto);
    expect(openPdfMock).toHaveBeenCalledExactlyOnceWith(foto.url);
    expect(viewerProps).toHaveLength(0);

    fireEvent.click(openPdf);
    expect(await screen.findByRole('dialog', { name: 'Loonbrief september.pdf' })).toBeTruthy();
    expect(viewerProps.at(-1)).toMatchObject({ soort: 'document', lijst: '/api/documents?userId=3', document: { id: 'doc-1', url: pdf.url } });
    // Openen door het beheer is geen leesbevestiging.
    expect((viewerProps.at(-1) as DocumentViewerProps).onGeopend).toBeUndefined();
    expect(openPdfMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls.some(([pad]) => String(pad).endsWith('/opened'))).toBe(false);

    // Terug sluit alleen de viewer, het beheer blijft open.
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    expect(screen.queryByRole('dialog', { name: 'Loonbrief september.pdf' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Documenten, Chauffeur A' })).toBeTruthy();
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
