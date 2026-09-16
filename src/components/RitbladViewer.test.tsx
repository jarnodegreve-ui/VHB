import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { apiFetchMock, openPdfMock, laadDocumentMock, zoekPaginasMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(), openPdfMock: vi.fn(), laadDocumentMock: vi.fn(), zoekPaginasMock: vi.fn(),
}));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
}));
vi.mock('../lib/ritbladPaginas', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ritbladPaginas')>(),
  laadRitbladDocument: laadDocumentMock,
  zoekPaginasVoorDienstGecached: zoekPaginasMock,
}));
vi.mock('../lib/ritbladCache', () => ({ isRitbladOpgeslagen: async () => false }));

import { RitbladViewer } from './RitbladViewer';

const OUD = 'https://test.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=verlopen';
const NIEUW = 'https://test.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=vers';
const antwoord = (url: string) => new Response(JSON.stringify({ url, uploadedAt: '2026-09-01T08:00:00Z' }));

beforeEach(() => {
  apiFetchMock.mockReset();
  openPdfMock.mockReset();
  laadDocumentMock.mockReset();
  zoekPaginasMock.mockReset();
  laadDocumentMock.mockResolvedValue({ numPages: 3, loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) } });
  // Alleen de bereik-ping gebruikt fetch; metadata gaat via apiFetchMock.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(async () => {
  cleanup();
  // Modal ruimt zijn browserhistoriek asynchroon op na unmount.
  await waitFor(() => expect(window.history.state?.vhbOverlay).toBeUndefined());
  vi.unstubAllGlobals();
});

describe('Ritbladviewer: volledige bundel openen', () => {
  it.each([
    { toestand: 'dienstpagina gevonden', paginas: [2], knop: 'Volledige bundel' },
    { toestand: 'geen dienstpagina gevonden', paginas: [], knop: 'Volledige bundel openen' },
  ])('haalt een verse link op bij $toestand, ook als de viewer al langer openstaat', async ({ paginas, knop }) => {
    apiFetchMock.mockResolvedValueOnce(antwoord(OUD)).mockResolvedValueOnce(antwoord(NIEUW));
    zoekPaginasMock.mockResolvedValue(paginas);
    render(<RitbladViewer dienstnummer="2101" open onClose={() => {}} />);
    const openen = await screen.findByRole('button', { name: knop });
    expect(laadDocumentMock).toHaveBeenCalledWith(OUD, expect.any(Function));

    // De viewer bevat nog OUD. De echte openHuidigRitblad moet metadata
    // opnieuw lezen voordat de bundel in een extern venster opengaat.
    fireEvent.click(openen);
    await waitFor(() => expect(openPdfMock).toHaveBeenCalledWith(NIEUW));
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/ritblaadje', { cache: 'no-store' });
    expect(openPdfMock).not.toHaveBeenCalledWith(OUD);
  });
});
