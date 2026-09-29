import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

/**
 * Persoonlijke documenten in de app (29-09): de BijlageViewer in de modus
 * zonder bewaren. Hier met de échte lader (src/lib/bijlageLaden.ts) en de
 * échte cache-module, tegen een nep-Cache Storage die elke aanroep noteert:
 * zo is te zien dat er niets op het toestel belandt, ook niet bij het lezen.
 * Alleen pdfjs, de API en de bereikstatus zijn nagebootst.
 */
const { openPdfMock, getDocumentMock, apiFetchMock, bereik } = vi.hoisted(() => ({
  openPdfMock: vi.fn(),
  getDocumentMock: vi.fn(),
  apiFetchMock: vi.fn(),
  bereik: { online: true },
}));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
}));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../lib/ritbladPaginas', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ritbladPaginas')>(),
  laadPdfjs: async () => ({ getDocument: getDocumentMock }),
}));
vi.mock('../lib/ritbladCache', () => ({ isRitbladOpgeslagen: async () => false }));
vi.mock('../lib/useOnline', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/useOnline')>(),
  useOnline: () => bereik.online,
  isOnlineNu: () => bereik.online,
}));

import BijlageViewer, { type DocumentViewerProps } from './BijlageViewer';
import { actieveScrollLocks } from '../lib/scrollSlot';
import type { PersoonlijkDocument } from '../lib/bijlageLaden';

const OPSLAG = 'https://x.supabase.co/storage/v1/object/sign/user-documents/c-1/3f2a-loonbrief.pdf';
const LINK = `${OPSLAG}?token=eerste`;
const VERS = `${OPSLAG}?token=vers`;
const LOONBRIEF: PersoonlijkDocument = { id: 'doc-1', filename: 'Loonbrief september.pdf', sizeBytes: 3000, url: LINK };
const PDF = new TextEncoder().encode('%PDF-1.7\nloonbrief\n%%EOF');

/** Een pdfjs-document met twee pagina's; de test kan zien of het vernietigd is. */
const maakDoc = () => ({ numPages: 2, loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) } });
let docs: Array<ReturnType<typeof maakDoc>>;

/** Nep-Cache Storage: elke aanroep, op welke cache ook, komt in `aanroepen`. */
let aanroepen: string[];
const nepCaches = () => ({
  open: vi.fn(async (naam: string) => {
    aanroepen.push(`open ${naam}`);
    return {
      match: async () => { aanroepen.push('match'); return undefined; },
      put: async () => { aanroepen.push('put'); },
      delete: async () => { aanroepen.push('delete'); return false; },
      keys: async () => { aanroepen.push('keys'); return []; },
    };
  }),
  has: vi.fn(async (naam: string) => { aanroepen.push(`has ${naam}`); return false; }),
  keys: vi.fn(async () => { aanroepen.push('keys'); return []; }),
  match: vi.fn(async () => { aanroepen.push('match'); return undefined; }),
  delete: vi.fn(async () => { aanroepen.push('delete'); return false; }),
});

/** De opslag: per aanvraag een vers antwoord, met de Cache-Control-kop die Supabase meestuurt. */
let opslag: (url: string) => Response;
let opslagAanvragen: Array<{ url: string; init?: RequestInit }>;

/** Het scherm eronder, met een knop die het document opent, zoals Documenten. */
function Scherm({ document = LOONBRIEF, onGeopend }: { document?: PersoonlijkDocument; onGeopend?: DocumentViewerProps['onGeopend'] }) {
  const [open, setOpen] = useState<PersoonlijkDocument | null>(document);
  return (
    <>
      <p>Documenten</p>
      <button type="button" onClick={() => setOpen(document)}>heropen</button>
      <BijlageViewer soort="document" document={open} lijst="/api/documents" onClose={() => setOpen(null)} onGeopend={onGeopend} />
    </>
  );
}

const laag = () => screen.getByRole('dialog', { name: LOONBRIEF.filename });

beforeEach(() => {
  bereik.online = true;
  aanroepen = [];
  docs = [];
  opslagAanvragen = [];
  opslag = () => new Response(PDF.slice(), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'max-age=3600' } });
  for (const m of [openPdfMock, getDocumentMock, apiFetchMock]) m.mockReset();
  getDocumentMock.mockImplementation(() => {
    const doc = maakDoc();
    docs.push(doc);
    return { promise: Promise.resolve(doc) };
  });
  apiFetchMock.mockResolvedValue(new Response(JSON.stringify([{ ...LOONBRIEF, url: VERS }])));
  vi.stubGlobal('caches', nepCaches());
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    opslagAanvragen.push({ url, init });
    return opslag(url);
  }));
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
  vi.restoreAllMocks();
});

describe('BijlageViewer: een persoonlijk document, in de app en niet op het toestel', () => {
  it('opent in de laag; de bytes gaan zonder cache naar pdfjs en Cache Storage wordt nooit aangeraakt', async () => {
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    const onGeopend = vi.fn();
    render(<Scherm onGeopend={onGeopend} />);
    expect(laag()).toBeTruthy();
    await screen.findByText('2 pagina’s');
    // Eén download, met no-store: ook de HTTP-cache van de browser houdt niets bij.
    expect(opslagAanvragen).toEqual([{ url: LINK, init: { signal: expect.any(AbortSignal), cache: 'no-store' } }]);
    // De bytes gaan naar pdfjs (niet de URL, dus pdfjs haalt niets zelf op).
    expect(getDocumentMock).toHaveBeenCalledExactlyOnceWith({ data: expect.any(Uint8Array) });
    expect(aanroepen).toEqual([]);
    expect(objectUrl).not.toHaveBeenCalled();
    // Pas nu het document in beeld staat, telt het als geopend.
    expect(onGeopend).toHaveBeenCalledExactlyOnceWith('doc-1');
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(screen.getByText('Documenten')).toBeTruthy();
  });

  it('de terugknop sluit alleen de viewer: het pdfjs-document gaat weg, en een heropening haalt het opnieuw van de server', async () => {
    render(<Scherm />);
    await screen.findByText('2 pagina’s');
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(docs[0].loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Documenten')).toBeTruthy();
    expect(actieveScrollLocks()).toEqual([]);
    // Na het uitfaden houdt de viewer niets meer vast; er staat ook nergens
    // een kopie: opnieuw openen is opnieuw downloaden.
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    fireEvent.click(screen.getByRole('button', { name: 'heropen' }));
    await screen.findByText('2 pagina’s');
    expect(opslagAanvragen.map((a) => a.url)).toEqual([LINK, LINK]);
    expect(aanroepen).toEqual([]);
  });

  it('browser Terug sluit alleen de viewer', async () => {
    render(<Scherm />);
    await screen.findByText('2 pagina’s');
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(docs[0].loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Documenten')).toBeTruthy();
  });

  it('laadt het niet, dan de foutstaat zonder rauwe fout, en geen leesbevestiging; Opnieuw proberen kan', async () => {
    const stil = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let hersteld = false;
    opslag = () => (hersteld
      ? new Response(PDF.slice(), { status: 200 })
      : new Response('{"statusCode":"400","error":"InvalidJWT","message":"jwt expired"}', { status: 400 }));
    const onGeopend = vi.fn();
    render(<Scherm onGeopend={onGeopend} />);
    expect(await screen.findByText('Document kon niet geladen worden')).toBeTruthy();
    expect(laag().textContent).not.toMatch(/InvalidJWT|jwt expired|statusCode/);
    // Eén verse link uit de documentenlijst geprobeerd, zonder cache.
    expect(apiFetchMock).toHaveBeenCalledWith('/api/documents', { cache: 'no-store', signal: expect.any(AbortSignal) });
    expect(opslagAanvragen.map((a) => a.url)).toEqual([LINK, VERS]);
    expect(onGeopend).not.toHaveBeenCalled();
    // Extern openen is de oude weg, rechtstreeks in de klik, met de link
    // waarmee de viewer opende (zoals bij de bijlagen).
    const extern = screen.getByRole('button', { name: 'Extern openen' });
    expect((extern as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(extern);
    expect(openPdfMock).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(onGeopend).not.toHaveBeenCalled();

    hersteld = true;
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    await screen.findByText('2 pagina’s');
    expect(onGeopend).toHaveBeenCalledExactlyOnceWith('doc-1');
    expect(aanroepen).toEqual([]);
    stil.mockRestore();
  });

  it('zonder bereik: niets opgehaald, de uitleg dat persoonlijke documenten alleen met bereik openen, Extern openen uit', async () => {
    bereik.online = false;
    const onGeopend = vi.fn();
    const { rerender } = render(<Scherm onGeopend={onGeopend} />);
    expect(await screen.findByText('Document kon niet geladen worden')).toBeTruthy();
    expect(screen.getByText(/Persoonlijke documenten openen alleen met bereik: ze worden niet op dit toestel bewaard\./)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Extern openen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(opslagAanvragen).toEqual([]);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(aanroepen).toEqual([]);
    expect(onGeopend).not.toHaveBeenCalled();

    // Weer bereik: opnieuw proberen opent het document.
    bereik.online = true;
    rerender(<Scherm onGeopend={onGeopend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    await screen.findByText('2 pagina’s');
    expect(onGeopend).toHaveBeenCalledExactlyOnceWith('doc-1');
  });

  it('een document dat intussen weg is zegt dat, met de weg terug naar de documenten', async () => {
    opslag = () => new Response('{"error":"not_found"}', { status: 404 });
    apiFetchMock.mockResolvedValue(new Response('[]'));
    render(<Scherm />);
    expect(await screen.findByText('Dit document is er niet meer')).toBeTruthy();
    expect(screen.getByText('Het is intussen verwijderd. Ga terug naar de documenten.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Terug' })[1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sluiten tijdens het laden breekt af en vernietigt een document dat nog binnenkomt, zonder leesbevestiging', async () => {
    let lever!: (d: unknown) => void;
    const doc = maakDoc();
    getDocumentMock.mockImplementation(() => ({ promise: new Promise((r) => { lever = r; }) }));
    const onGeopend = vi.fn();
    render(<Scherm onGeopend={onGeopend} />);
    await waitFor(() => expect(getDocumentMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    await act(async () => { lever(doc); });
    expect(doc.loadingTask.destroy).toHaveBeenCalled();
    expect(onGeopend).not.toHaveBeenCalled();
  });
});
