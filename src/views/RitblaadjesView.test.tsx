import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '../types';

const { apiFetchMock, openPdfMock, notifyMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  openPdfMock: vi.fn(),
  notifyMock: vi.fn(),
}));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
  notify: notifyMock,
}));

import { RitblaadjesView } from './RitblaadjesView';

const OUD = 'https://test.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=verlopen';
const NIEUW = 'https://test.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=vers';
const META_KEY = 'vhb-ritblaadje-meta';
const SYNC_KEY = 'vhb-ritblaadje-synced';
const CHAUFFEUR = { id: 'test-chauffeur', name: 'Test Chauffeur', role: 'chauffeur' } as User;
const meta = (url = OUD) => ({
  filename: 'Ritbladen.pdf', storagePath: 'bundel.pdf', uploadedAt: '2026-09-01T08:00:00Z',
  uploadedBy: null, sizeBytes: 1024, url,
});
const antwoord = (url = OUD, headers?: HeadersInit) => new Response(JSON.stringify(meta(url)), { headers });

beforeEach(() => {
  apiFetchMock.mockReset();
  openPdfMock.mockReset();
  notifyMock.mockReset();
  const opslag = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => opslag.get(key) ?? null,
    setItem: (key: string, value: string) => opslag.set(key, value),
    removeItem: (key: string) => opslag.delete(key),
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)', media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Ritbladen: tijdelijke downloadlinks', () => {
  it('vraagt bij openen verse metadata, ook onder een oudere service worker', async () => {
    apiFetchMock.mockResolvedValueOnce(antwoord(NIEUW));
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    await screen.findByRole('button', { name: 'Openen' });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje', { cache: 'no-store' });
    const opgeslagen = JSON.parse(localStorage.getItem(META_KEY)!);
    expect(opgeslagen.url).toBe(NIEUW.split('?')[0]);
    expect(localStorage.getItem(META_KEY)).not.toContain('token=');
  });

  it.each(['Openen', 'Volledige bundel'])('%s gebruikt een nieuwe link als de pagina nog de oude link bevat', async (actie) => {
    apiFetchMock.mockResolvedValueOnce(antwoord(OUD)).mockResolvedValueOnce(antwoord(NIEUW));
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    const knop = await screen.findByRole('button', { name: actie === 'Openen' ? /^Openen$/ : /^Volledige bundel/ });
    // De pagina blijft gemount, zoals na lang openblijven van de PWA.
    // openHuidigRitblad is echt: uitsluitend API en het openen zijn gemockt.
    fireEvent.click(knop);
    await waitFor(() => expect(openPdfMock).toHaveBeenCalledWith(NIEUW));
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/ritblaadje', { cache: 'no-store' });
    expect(openPdfMock).not.toHaveBeenCalledWith(OUD);
  });

  it('opent geen oude link als de bundel intussen verwijderd is', async () => {
    apiFetchMock.mockResolvedValueOnce(antwoord()).mockResolvedValueOnce(new Response('null'));
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Openen' }));
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith('Er staat op dit moment geen ritblad klaar.', 'info'));
    expect(openPdfMock).not.toHaveBeenCalled();
  });

  it('markeert metadata uit de offlinecache zonder de oude bijwerktijd te overschrijven', async () => {
    const vroeger = '2026-09-12T08:25:00.000Z';
    localStorage.setItem(SYNC_KEY, vroeger);
    apiFetchMock.mockResolvedValueOnce(antwoord(OUD, { 'X-VHB-Bron': 'cache' }));
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    await screen.findByText('Offline', { exact: true });
    expect(localStorage.getItem(SYNC_KEY)).toBe(vroeger);
    expect(screen.getByText(/^12 sep/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(META_KEY)!).url).toBe(OUD.split('?')[0]);
  });
});
