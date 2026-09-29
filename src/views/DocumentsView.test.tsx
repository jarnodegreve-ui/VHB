import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '../types';
import type { DocumentViewerProps } from '../components/BijlageViewer';

/**
 * Documenten: de link is 15 minuten geldig (controle-ronde 29-09, nr. 15).
 * Wie de app wegzet en later terugkomt, moet op het moment van tikken een
 * geldige link krijgen, een nette melding als dat niet lukt, en de
 * leesbevestiging mag pas weg na een geslaagde opening.
 *
 * Sinds 29-09 (PDF in de app) opent een PDF in de viewer van de app en is
 * "geslaagd" wat de viewer meldt (onGeopend): de PDF staat in beeld. Een foto
 * gaat de oude weg (extern openen). De viewer is hier een stand-in; zijn
 * eigen gedrag staat in src/components/documentViewer.test.tsx.
 */
const { apiFetchMock, openPdfMock, notifyMock, viewerProps, bereik } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  openPdfMock: vi.fn(),
  notifyMock: vi.fn(),
  viewerProps: [] as unknown[],
  bereik: { online: true },
}));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
// useOnline pingt /api/health; hier bepaalt de test of er bereik is.
vi.mock('../lib/useOnline', () => ({ useOnline: () => bereik.online, isOnlineNu: () => bereik.online }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
  notify: notifyMock,
}));
vi.mock('../components/BijlageViewer', () => ({
  default: (props: DocumentViewerProps) => {
    viewerProps.push(props);
    return props.document ? (
      <div role="dialog" aria-label={props.document.filename}>
        <button type="button" onClick={props.onClose}>Terug</button>
      </div>
    ) : null;
  },
}));

import { DocumentsView } from './DocumentsView';
import { DOCUMENT_LINK_GELDIG_MS, DOCUMENT_VERVERS_NA_MS, linkNogGeldig, opentInDeApp } from '../lib/documentLink';

const CHAUFFEUR = { id: 'c-1', name: 'Test Chauffeur', role: 'chauffeur' } as User;
const START = new Date('2026-09-29T08:00:00+02:00').getTime();
const url = (token: string) => `https://test.supabase.co/storage/v1/object/sign/user-documents/c-1/attest.pdf?token=${token}`;
const fotoUrl = (token: string) => `https://test.supabase.co/storage/v1/object/sign/user-documents/c-1/foto.png?token=${token}`;
/** Standaard één PDF; met `foto` ook een attest als foto (geen PDF). */
let metFoto = false;
const lijst = (token: string | null) => [
  {
    id: 'doc-1', userId: 'c-1', filename: 'Attest.pdf', category: 'Attest', sizeBytes: 2048,
    uploadedAt: '2026-09-01T08:00:00Z', uploadedBy: 'Admin', url: token ? url(token) : null,
  },
  ...(metFoto ? [{
    id: 'doc-2', userId: 'c-1', filename: 'Rijbewijs.png', category: 'Attest', sizeBytes: 4096,
    uploadedAt: '2026-09-02T08:00:00Z', uploadedBy: 'Admin', url: token ? fotoUrl(token) : null,
  }] : []),
];

/** Nep-API: elke GET /api/documents geeft de volgende token uit de rij. */
let tokens: Array<string | 'fout' | 'weg'>;
let aanroepen: Array<{ pad: string; method: string }>;
const zetApi = () => {
  apiFetchMock.mockImplementation(async (pad: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    aanroepen.push({ pad, method });
    if (pad === '/api/user-expiries') return new Response('[]');
    if (pad === '/api/documents' && method === 'GET') {
      const volgende = tokens.length > 1 ? tokens.shift()! : tokens[0];
      if (volgende === 'fout') throw new TypeError('Failed to fetch');
      if (volgende === 'weg') return new Response('[]');
      return new Response(JSON.stringify(lijst(volgende)));
    }
    return new Response(JSON.stringify({ success: true }));
  });
};
const documentLadingen = () => aanroepen.filter((a) => a.pad === '/api/documents' && a.method === 'GET').length;
const bevestigingen = (id = 'doc-1') => aanroepen.filter((a) => a.pad === `/api/documents/${id}/opened` && a.method === 'POST').length;

/** Microtaken laten aflopen onder fake timers. */
const rust = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const openKnop = (naam = 'Attest.pdf') => screen.getAllByRole('button', { name: `Open ${naam}` })[0];

/** De viewer zoals het scherm hem nu rendert, en de documenten waarmee hij opende. */
const viewer = () => viewerProps.at(-1) as DocumentViewerProps | undefined;
const geopend = () => [...new Set(viewerProps.map((p) => (p as DocumentViewerProps).document).filter(Boolean))].map((d) => d!.url);
/** De viewer meldt dat de PDF in beeld staat (de echte doet dat na het laden). */
const pdfGeladen = async (id = 'doc-1') => { await act(async () => { viewer()?.onGeopend?.(id); }); await rust(); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(START);
  apiFetchMock.mockReset();
  openPdfMock.mockReset();
  notifyMock.mockReset();
  viewerProps.length = 0;
  bereik.online = true;
  metFoto = false;
  tokens = ['eerste'];
  aanroepen = [];
  zetApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('linkNogGeldig', () => {
  it('blijft ruim binnen de 15 minuten van de server', () => {
    expect(DOCUMENT_LINK_GELDIG_MS).toBeLessThan(15 * 60_000);
    expect(linkNogGeldig(START, START)).toBe(true);
    expect(linkNogGeldig(START, START + DOCUMENT_LINK_GELDIG_MS - 1)).toBe(true);
    expect(linkNogGeldig(START, START + DOCUMENT_LINK_GELDIG_MS)).toBe(false);
  });

  it('onbekend moment of een teruggesprongen klok is niet geldig', () => {
    expect(linkNogGeldig(null, START)).toBe(false);
    expect(linkNogGeldig(START, START - 1000)).toBe(false);
  });
});

describe('Documenten: geldige link op het moment van tikken', () => {
  // Gewijzigd op 29-09 (PDF in de app): opende de PDF met openPdfInNewTab en
  // bevestigde meteen. Nu opent hij in de viewer, met dezelfde verse link, en
  // bevestigt hij pas als de viewer de PDF geladen heeft.
  it('een verse link opent meteen in de viewer, zonder extra lading, en bevestigt pas als de PDF geladen is', async () => {
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    fireEvent.click(openKnop());
    await rust();
    expect(geopend()).toEqual([url('eerste')]);
    expect(viewer()).toMatchObject({ soort: 'document', lijst: '/api/documents', document: { id: 'doc-1', filename: 'Attest.pdf', url: url('eerste') } });
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(documentLadingen()).toBe(1);
    expect(bevestigingen()).toBe(0);
    await pdfGeladen();
    expect(bevestigingen()).toBe(1);
  });

  // Gewijzigd op 29-09 (PDF in de app): zelfde verse link, nu in de viewer;
  // de bevestiging komt na het laden en dus ook na de verse lijst.
  it('na meer dan 15 minuten haalt de tik eerst een verse link en opent die', async () => {
    tokens = ['eerste', 'vers'];
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    vi.setSystemTime(START + 16 * 60_000);
    fireEvent.click(openKnop());
    await rust();
    expect(documentLadingen()).toBe(2);
    expect(geopend()).toEqual([url('vers')]);
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(bevestigingen()).toBe(0);
    await pdfGeladen();
    expect(bevestigingen()).toBe(1);
    // De bevestiging gaat pas weg nadat de verse lijst binnen is.
    const volgorde = aanroepen.map((a) => `${a.method} ${a.pad}`);
    expect(volgorde.indexOf('POST /api/documents/doc-1/opened')).toBeGreaterThan(volgorde.lastIndexOf('GET /api/documents'));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('lukt het ophalen van een verse link niet, dan een nette melding, niets geopend en geen leesbevestiging', async () => {
    tokens = ['eerste', 'fout'];
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    vi.setSystemTime(START + 16 * 60_000);
    fireEvent.click(openKnop());
    await rust();
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(bevestigingen()).toBe(0);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const [tekst, toon] = notifyMock.mock.calls[0];
    expect(tekst).toMatch(/^Document openen is mislukt\./);
    expect(toon).toBe('error');
    // De knop is daarna weer bruikbaar.
    expect((openKnop() as HTMLButtonElement).disabled).toBe(false);
  });

  it('is het document intussen weggehaald, dan zegt de melding dat en wordt niets bevestigd', async () => {
    tokens = ['eerste', 'weg'];
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    vi.setSystemTime(START + 16 * 60_000);
    fireEvent.click(openKnop());
    await rust();
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(bevestigingen()).toBe(0);
    expect(notifyMock).toHaveBeenCalledExactlyOnceWith('Dit document is niet meer beschikbaar.', 'error');
  });

  it('een document zonder link wordt niet geopend en niet bevestigd', async () => {
    apiFetchMock.mockImplementation(async (pad: string, init?: { method?: string }) => {
      aanroepen.push({ pad, method: init?.method ?? 'GET' });
      if (pad === '/api/user-expiries') return new Response('[]');
      if (pad === '/api/documents') return new Response(JSON.stringify(lijst(null)));
      return new Response('{}');
    });
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    fireEvent.click(openKnop());
    await rust();
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(bevestigingen()).toBe(0);
    expect(notifyMock).toHaveBeenCalledExactlyOnceWith('Bestand is niet beschikbaar.', 'error');
  });
});

describe('Documenten: in de app, zonder iets op het toestel (29-09)', () => {
  it('een PDF opent in de viewer, een foto de oude weg: extern en meteen bevestigd', async () => {
    metFoto = true;
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    expect(opentInDeApp('Attest.pdf')).toBe(true);
    expect(opentInDeApp('Rijbewijs.png')).toBe(false);

    // Foto: zoals vroeger, extern openen en de bevestiging meteen.
    fireEvent.click(openKnop('Rijbewijs.png'));
    await rust();
    expect(openPdfMock).toHaveBeenCalledExactlyOnceWith(fotoUrl('eerste'));
    expect(bevestigingen('doc-2')).toBe(1);
    expect(geopend()).toEqual([]);

    // PDF: in de app, en nog geen bevestiging.
    fireEvent.click(openKnop('Attest.pdf'));
    await rust();
    expect(screen.getByRole('dialog', { name: 'Attest.pdf' })).toBeTruthy();
    expect(openPdfMock).toHaveBeenCalledTimes(1);
    expect(bevestigingen('doc-1')).toBe(0);
  });

  it('Terug sluit alleen de viewer; wie sluit voor de PDF geladen is, bevestigt niets', async () => {
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    fireEvent.click(openKnop());
    await rust();
    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));
    await rust();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(viewer()?.document).toBeNull();
    // Het scherm staat er nog, met zijn documenten.
    expect(screen.getByRole('heading', { level: 1, name: 'Documenten' })).toBeTruthy();
    expect(openKnop()).toBeTruthy();
    expect(bevestigingen()).toBe(0);
  });

  it('zonder bereik opent de viewer meteen (die zegt dat het niet kan); geen verse link, geen bevestiging', async () => {
    const { rerender } = render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    // Het bereik valt weg; de echte useOnline laat het scherm dan opnieuw renderen.
    bereik.online = false;
    rerender(<DocumentsView currentUser={CHAUFFEUR} />);
    // De lijst is oud: met bereik zou de tik eerst een verse link halen.
    vi.setSystemTime(START + 16 * 60_000);
    fireEvent.click(openKnop());
    await rust();
    expect(geopend()).toEqual([url('eerste')]);
    expect(documentLadingen()).toBe(1);
    expect(openPdfMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(bevestigingen()).toBe(0);
  });
});

describe('Documenten: verversen bij het hervatten van de app', () => {
  const hervat = async () => {
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  // Gewijzigd op 29-09 (PDF in de app): de verse link gaat naar de viewer in
  // plaats van naar openPdfInNewTab; de bevestiging volgt op het laden.
  it('ververst de lijst stil zodra ze ouder is dan enkele minuten, zodat de tik meteen opent', async () => {
    tokens = ['eerste', 'na-hervatten'];
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    vi.setSystemTime(START + 20 * 60_000);
    await hervat();
    expect(documentLadingen()).toBe(2);
    fireEvent.click(openKnop());
    await rust();
    expect(documentLadingen()).toBe(2);
    expect(geopend()).toEqual([url('na-hervatten')]);
    expect(openPdfMock).not.toHaveBeenCalled();
    await pdfGeladen();
    expect(bevestigingen()).toBe(1);
  });

  it('ververst niet bij elke terugkeer: binnen het interval blijft de lijst staan', async () => {
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    vi.setSystemTime(START + DOCUMENT_VERVERS_NA_MS - 1000);
    await hervat();
    expect(documentLadingen()).toBe(1);
  });
});
