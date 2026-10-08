import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { apiFetchMock, openPdfMock, laadDocumentMock, zoekPaginasMock, verwijderMock, meldFoutMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(), openPdfMock: vi.fn(), laadDocumentMock: vi.fn(), zoekPaginasMock: vi.fn(), verwijderMock: vi.fn(), meldFoutMock: vi.fn(),
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
vi.mock('../lib/ritbladCache', () => ({ isRitbladOpgeslagen: async () => false, verwijderRitbladUitCache: verwijderMock }));
vi.mock('../lib/monitoring', () => ({ reportHandledError: meldFoutMock }));

import { RitbladViewer } from './RitbladViewer';

const OUD = 'https://test.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=verlopen';
const NIEUW = 'https://test.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=vers';
const antwoord = (url: string) => new Response(JSON.stringify({ url, uploadedAt: '2026-09-01T08:00:00Z' }));

beforeEach(() => {
  apiFetchMock.mockReset();
  openPdfMock.mockReset();
  laadDocumentMock.mockReset();
  zoekPaginasMock.mockReset();
  verwijderMock.mockReset();
  meldFoutMock.mockReset();
  // Standaard stond er niets in de ritbladen-cache: dan is er geen tweede poging.
  verwijderMock.mockResolvedValue(false);
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
  ])('toont de hele bundel in de app bij $toestand, zonder de app te verlaten', async ({ paginas, knop }) => {
    // Per aanroep een verse Response: een body is maar één keer leesbaar, en
    // de viewer haalt de metadata opnieuw op als hij naar de bundel schakelt.
    apiFetchMock.mockImplementation(async () => antwoord(OUD));
    zoekPaginasMock.mockResolvedValue(paginas);
    render(<RitbladViewer dienstnummer="2101" open onClose={() => {}} />);
    const openen = await screen.findByRole('button', { name: knop });
    expect(laadDocumentMock).toHaveBeenCalledWith(OUD, expect.any(Function));

    // De bundel blijft binnen de viewer, dus binnen de PWA-schil en de
    // service-worker-cache (controle 16-09, nr. 10): geen extern venster.
    fireEvent.click(openen);
    await waitFor(() => expect(screen.getByText('Ritblad · volledige bundel')).toBeTruthy());
    expect(openPdfMock).not.toHaveBeenCalled();
    // Alle pagina's van de bundel, niet alleen die van de dienst.
    await waitFor(() => expect(screen.getByText(/pagina's 1–3 van 3/)).toBeTruthy());
  });

  it('valt terug op de externe PDF als het document niet te laden is', async () => {
    apiFetchMock.mockResolvedValueOnce(antwoord(OUD)).mockResolvedValueOnce(antwoord(NIEUW));
    laadDocumentMock.mockRejectedValueOnce(new Error('stuk'));
    render(<RitbladViewer dienstnummer="2101" open onClose={() => {}} />);
    const openen = await screen.findByRole('button', { name: 'Volledige bundel openen' });

    // De viewer kreeg het document niet geladen, dus in de app tonen kan niet.
    // Dan wél de oude route, met een verse link (de eerste kan verlopen zijn).
    fireEvent.click(openen);
    await waitFor(() => expect(openPdfMock).toHaveBeenCalledWith(NIEUW));
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/ritblaadje', { cache: 'no-store' });
    expect(openPdfMock).not.toHaveBeenCalledWith(OUD);
    // En de reden staat als foutgroep in Systeemstatus › Fouten (melding chauffeurs 07-10).
    expect(meldFoutMock).toHaveBeenCalledWith('Ritblad laden mislukte voor dienst 2101: Error: stuk');
  });
});

describe('Ritbladviewer: zelfherstel en meldingen (melding chauffeurs 07-10)', () => {
  it('gooit bij een document dat niet opent het bewaarde exemplaar weg en haalt de bundel één keer vers op', async () => {
    apiFetchMock.mockResolvedValueOnce(antwoord(OUD)).mockResolvedValueOnce(antwoord(NIEUW));
    laadDocumentMock.mockRejectedValueOnce(new Error('Invalid PDF structure'));
    verwijderMock.mockResolvedValue(true);
    zoekPaginasMock.mockResolvedValue([2]);
    render(<RitbladViewer dienstnummer="2101" open onClose={() => {}} />);
    // Tweede poging met een verse link; daarna gewoon het blad van de dienst.
    await waitFor(() => expect(laadDocumentMock).toHaveBeenCalledTimes(2));
    expect(verwijderMock).toHaveBeenCalledWith(OUD);
    expect(laadDocumentMock).toHaveBeenLastCalledWith(NIEUW, expect.any(Function));
    await screen.findByRole('button', { name: 'Volledige bundel' });
    expect(meldFoutMock).not.toHaveBeenCalled();
  });

  it('probeert zonder bereik niet opnieuw en meldt de fout', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    apiFetchMock.mockResolvedValue(antwoord(OUD));
    laadDocumentMock.mockRejectedValue(new Error('Load failed'));
    verwijderMock.mockResolvedValue(true);
    render(<RitbladViewer dienstnummer="2101" open onClose={() => {}} />);
    await screen.findByText('Ritblad kon niet geladen worden');
    expect(laadDocumentMock).toHaveBeenCalledTimes(1);
    expect(verwijderMock).not.toHaveBeenCalled();
    expect(meldFoutMock).toHaveBeenCalledWith('Ritblad laden mislukte voor dienst 2101: Error: Load failed');
  });

  it('meldt "geen apart blad gevonden" als foutgroep, met bundel en omvang', async () => {
    apiFetchMock.mockImplementation(async () => antwoord(OUD));
    zoekPaginasMock.mockResolvedValue([]);
    render(<RitbladViewer dienstnummer={['2101', '2301']} open onClose={() => {}} />);
    await screen.findByText('Geen apart blad gevonden voor diensten 2101 / 2301');
    expect(meldFoutMock).toHaveBeenCalledWith("Ritblad: geen apart blad gevonden voor diensten 2101 / 2301 (bundel van 1 sep, 3 pagina's)");
  });
});
