import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

const { openPdfMock, laadBijlageMock, verseMock, getDocumentMock, vergeetMock } = vi.hoisted(() => ({
  openPdfMock: vi.fn(), laadBijlageMock: vi.fn(), verseMock: vi.fn(), getDocumentMock: vi.fn(), vergeetMock: vi.fn(),
}));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
}));
vi.mock('../lib/bijlageLaden', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/bijlageLaden')>(),
  laadBijlage: laadBijlageMock,
  haalVerseBijlage: verseMock,
}));
vi.mock('../lib/bijlageCache', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/bijlageCache')>(),
  vergeetBijlage: vergeetMock,
}));
vi.mock('../lib/ritbladPaginas', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ritbladPaginas')>(),
  laadPdfjs: async () => ({ getDocument: getDocumentMock }),
}));
vi.mock('../lib/ritbladCache', () => ({ isRitbladOpgeslagen: async () => false }));

import BijlageViewer from './BijlageViewer';
import { BijlageWeg } from '../lib/bijlageLaden';
import { actieveScrollLocks } from '../lib/scrollSlot';
import type { PdfBijlage } from '../types';

const LINK = 'https://x.supabase.co/storage/v1/object/sign/diversions/o-1-1.pdf?token=oud';
const VERS = 'https://x.supabase.co/storage/v1/object/sign/diversions/o-1-1.pdf?token=vers';
const PLAN: PdfBijlage = { slot: 1, filename: 'Omleidingsplan lijn 58.pdf', sizeBytes: 1200, url: LINK };
const document3 = () => ({ numPages: 3, loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) } });
const geladen = (url = LINK) => ({ bytes: new Uint8Array([37, 80, 68, 70]), bewaard: true, url, sleutel: 'https://x.supabase.co/storage/v1/object/sign/diversions/o-1-1.pdf' });

/** Het detail eronder: een knop die de bijlage opent, zoals OmleidingDetail. */
function Detail({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState<PdfBijlage | null>(PLAN);
  return (
    <>
      <p>Detail van de omleiding</p>
      <button type="button" onClick={() => setOpen(PLAN)}>heropen</button>
      <BijlageViewer soort="omleiding" recordId="o-1" bijlage={open} onClose={() => { onClose?.(); setOpen(null); }} />
    </>
  );
}

beforeEach(() => {
  for (const m of [openPdfMock, laadBijlageMock, verseMock, getDocumentMock, vergeetMock]) m.mockReset();
  laadBijlageMock.mockResolvedValue(geladen());
  verseMock.mockResolvedValue({ status: 'onbekend' });
  getDocumentMock.mockImplementation(() => ({ promise: Promise.resolve(document3()) }));
  // Alleen de bereik-ping gebruikt fetch.
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

describe('BijlageViewer: een bijlage in de app', () => {
  it('toont de bijlage in een laag met de bestandsnaam, het aantal pagina’s en de zoom', async () => {
    render(<Detail />);
    const laag = await screen.findByRole('dialog', { name: PLAN.filename });
    await waitFor(() => expect(screen.getByText('3 pagina’s')).toBeTruthy());
    expect(laag.textContent).toContain('100 %');
    expect(screen.getByRole('button', { name: 'Inzoomen' })).toBeTruthy();
    expect(laadBijlageMock).toHaveBeenCalledWith(
      { soort: 'omleiding', recordId: 'o-1', slot: 1, filename: PLAN.filename, sizeBytes: 1200, url: LINK },
      expect.any(AbortSignal),
    );
    // De bytes gaan naar pdfjs; de app verlaat het portaal niet.
    expect(getDocumentMock).toHaveBeenCalledWith({ data: expect.any(Uint8Array) });
    expect(openPdfMock).not.toHaveBeenCalled();
  });

  it('de terugknop sluit de viewer en laat het detail staan', async () => {
    const onClose = vi.fn();
    render(<Detail onClose={onClose} />);
    await screen.findByText('3 pagina’s');
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Detail van de omleiding')).toBeTruthy();
    expect(actieveScrollLocks()).toEqual([]);
  });

  it('browser Terug sluit alleen de viewer: één entry, en de scroll-lock komt vrij', async () => {
    const onClose = vi.fn();
    const push = vi.spyOn(window.history, 'pushState');
    render(<Detail onClose={onClose} />);
    await screen.findByText('3 pagina’s');
    // Precies één entry voor de viewer: één keer terug sluit hem, geen dode stap.
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.history.state?.vhbOverlay).toEqual(expect.any(String));
    expect(actieveScrollLocks()).toEqual(['modal']);
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Detail van de omleiding')).toBeTruthy();
    expect(actieveScrollLocks()).toEqual([]);
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('Escape sluit de viewer', async () => {
    const onClose = vi.fn();
    render(<Detail onClose={onClose} />);
    await screen.findByText('3 pagina’s');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('“Extern openen” roept het oude pad aan, rechtstreeks in de klik', async () => {
    render(<Detail />);
    await screen.findByText('3 pagina’s');
    const knop = screen.getByRole('button', { name: 'Extern openen' });
    // Secundair: de gouden knop is er één per scherm.
    expect(knop.className).not.toContain('btn-primary');
    fireEvent.click(knop);
    // Synchroon: meteen na de klik, zonder dat er iets afgewacht is.
    expect(openPdfMock).toHaveBeenCalledTimes(1);
    expect(openPdfMock).toHaveBeenCalledWith(LINK);
  });

  it('extern openen gebruikt de verse link zodra de viewer er een kreeg', async () => {
    laadBijlageMock.mockResolvedValue(geladen(VERS));
    render(<Detail />);
    await screen.findByText('3 pagina’s');
    fireEvent.click(screen.getByRole('button', { name: 'Extern openen' }));
    expect(openPdfMock).toHaveBeenCalledWith(VERS);
  });

  it('een verlopen of falende link geeft de foutstaat met twee knoppen, geen rauwe fout', async () => {
    laadBijlageMock.mockRejectedValueOnce(new Error('{"statusCode":"400","error":"InvalidJWT","message":"jwt expired"}'));
    const stil = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Detail />);
    expect(await screen.findByText('Bijlage kon niet geladen worden')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: PLAN.filename }).textContent).not.toMatch(/InvalidJWT|jwt expired|statusCode/);
    const opnieuw = screen.getByRole('button', { name: 'Opnieuw proberen' });
    const extern = screen.getByRole('button', { name: 'Extern openen' });
    expect(opnieuw.className).toContain('btn-primary');
    expect(extern.className).not.toContain('btn-primary');
    // Een laadfout is geen lege staat: er staat geen "geen bijlage" of lege viewer.
    expect(screen.queryByRole('button', { name: 'Inzoomen' })).toBeNull();

    fireEvent.click(extern);
    expect(openPdfMock).toHaveBeenCalledWith(LINK);

    // Opnieuw proberen laadt opnieuw en toont de bijlage.
    fireEvent.click(opnieuw);
    await screen.findByText('3 pagina’s');
    expect(laadBijlageMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Bijlage kon niet geladen worden')).toBeNull();
    stil.mockRestore();
  });

  it('een bestand dat geen leesbare PDF is blijft niet in de cache staan', async () => {
    getDocumentMock.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('Invalid PDF structure')) }));
    const stil = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Detail />);
    expect(await screen.findByText('Bijlage kon niet geladen worden')).toBeTruthy();
    expect(vergeetMock).toHaveBeenCalledWith('https://x.supabase.co/storage/v1/object/sign/diversions/o-1-1.pdf');
    stil.mockRestore();
  });

  it('een bijlage die intussen verwijderd is zegt dat, met de weg terug', async () => {
    laadBijlageMock.mockRejectedValueOnce(new BijlageWeg());
    const onClose = vi.fn();
    render(<Detail onClose={onClose} />);
    expect(await screen.findByText('Deze bijlage is er niet meer')).toBeTruthy();
    expect(screen.getByText(/Ga terug naar de omleiding/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Terug' })[1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sluiten tijdens het laden breekt af en vernietigt een document dat nog binnenkomt', async () => {
    const doc = document3();
    let lever!: (d: unknown) => void;
    getDocumentMock.mockImplementation(() => ({ promise: new Promise((r) => { lever = r; }) }));
    render(<Detail />);
    await waitFor(() => expect(getDocumentMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    expect((laadBijlageMock.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    await act(async () => { lever(doc); });
    expect(doc.loadingTask.destroy).toHaveBeenCalled();
    expect(screen.queryByText('Bijlage kon niet geladen worden')).toBeNull();
  });

  it('het uploadmoment van de server gaat mee naar de lader; een vervanging met dezelfde naam en grootte laadt opnieuw', async () => {
    const VROEG = '2026-09-29T08:00:00.000Z';
    const LAAT = '2026-09-29T09:30:00.000Z';
    const { rerender } = render(<BijlageViewer soort="omleiding" recordId="o-1" bijlage={{ ...PLAN, uploadedAt: VROEG }} onClose={() => {}} />);
    await screen.findByText('3 pagina’s');
    // De versie in de cache kent het uploadmoment (bijlageVersie).
    expect(laadBijlageMock).toHaveBeenCalledWith(
      { soort: 'omleiding', recordId: 'o-1', slot: 1, filename: PLAN.filename, sizeBytes: 1200, uploadedAt: VROEG, url: LINK },
      expect.any(AbortSignal),
    );
    // Alleen een nieuw token: hetzelfde bestand.
    rerender(<BijlageViewer soort="omleiding" recordId="o-1" bijlage={{ ...PLAN, uploadedAt: VROEG, url: VERS }} onClose={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(laadBijlageMock).toHaveBeenCalledTimes(1);
    // Zelfde plaats, naam en grootte, maar een later uploadmoment: vervangen.
    rerender(<BijlageViewer soort="omleiding" recordId="o-1" bijlage={{ ...PLAN, uploadedAt: LAAT, url: VERS }} onClose={() => {}} />);
    await waitFor(() => expect(laadBijlageMock).toHaveBeenCalledTimes(2));
    expect(laadBijlageMock).toHaveBeenLastCalledWith(
      { soort: 'omleiding', recordId: 'o-1', slot: 1, filename: PLAN.filename, sizeBytes: 1200, uploadedAt: LAAT, url: VERS },
      expect.any(AbortSignal),
    );
  });

  it('een nieuw token in de lijst laadt de open bijlage niet opnieuw', async () => {
    const { rerender } = render(<BijlageViewer soort="omleiding" recordId="o-1" bijlage={PLAN} onClose={() => {}} />);
    await screen.findByText('3 pagina’s');
    rerender(<BijlageViewer soort="omleiding" recordId="o-1" bijlage={{ ...PLAN, url: VERS }} onClose={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(laadBijlageMock).toHaveBeenCalledTimes(1);
    // Een andere grootte is een ander bestand: dan wel.
    rerender(<BijlageViewer soort="omleiding" recordId="o-1" bijlage={{ ...PLAN, sizeBytes: 1350, url: VERS }} onClose={() => {}} />);
    await waitFor(() => expect(laadBijlageMock).toHaveBeenCalledTimes(2));
  });
});
