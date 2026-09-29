import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '../types';

/**
 * Documenten: de link is 15 minuten geldig (controle-ronde 29-09, nr. 15).
 * Wie de app wegzet en later terugkomt, moet op het moment van tikken een
 * geldige link krijgen, een nette melding als dat niet lukt, en de
 * leesbevestiging mag pas weg na een geslaagde opening.
 */
const { apiFetchMock, openPdfMock, notifyMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  openPdfMock: vi.fn(),
  notifyMock: vi.fn(),
}));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
// useOnline pingt /api/health; hier is er altijd bereik.
vi.mock('../lib/useOnline', () => ({ useOnline: () => true }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
  notify: notifyMock,
}));

import { DocumentsView } from './DocumentsView';
import { DOCUMENT_LINK_GELDIG_MS, DOCUMENT_VERVERS_NA_MS, linkNogGeldig } from '../lib/documentLink';

const CHAUFFEUR = { id: 'c-1', name: 'Test Chauffeur', role: 'chauffeur' } as User;
const START = new Date('2026-09-29T08:00:00+02:00').getTime();
const url = (token: string) => `https://test.supabase.co/storage/v1/object/sign/user-documents/c-1/attest.pdf?token=${token}`;
const lijst = (token: string | null) => [{
  id: 'doc-1', userId: 'c-1', filename: 'Attest.pdf', category: 'Attest', sizeBytes: 2048,
  uploadedAt: '2026-09-01T08:00:00Z', uploadedBy: 'Admin', url: token ? url(token) : null,
}];

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
const bevestigingen = () => aanroepen.filter((a) => a.pad === '/api/documents/doc-1/opened' && a.method === 'POST').length;

/** Microtaken laten aflopen onder fake timers. */
const rust = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const openKnop = () => screen.getAllByRole('button', { name: 'Open Attest.pdf' })[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(START);
  apiFetchMock.mockReset();
  openPdfMock.mockReset();
  notifyMock.mockReset();
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
  it('een verse link opent meteen, zonder extra lading, en bevestigt daarna het openen', async () => {
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    fireEvent.click(openKnop());
    await rust();
    expect(openPdfMock).toHaveBeenCalledExactlyOnceWith(url('eerste'));
    expect(documentLadingen()).toBe(1);
    expect(bevestigingen()).toBe(1);
  });

  it('na meer dan 15 minuten haalt de tik eerst een verse link en opent die', async () => {
    tokens = ['eerste', 'vers'];
    render(<DocumentsView currentUser={CHAUFFEUR} />);
    await rust();
    vi.setSystemTime(START + 16 * 60_000);
    fireEvent.click(openKnop());
    await rust();
    expect(documentLadingen()).toBe(2);
    expect(openPdfMock).toHaveBeenCalledExactlyOnceWith(url('vers'));
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

describe('Documenten: verversen bij het hervatten van de app', () => {
  const hervat = async () => {
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
  };

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
    expect(openPdfMock).toHaveBeenCalledExactlyOnceWith(url('na-hervatten'));
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
