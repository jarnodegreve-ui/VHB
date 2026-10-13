import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { User } from '../types';

const { apiFetchMock, openPdfMock, notifyMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  openPdfMock: vi.fn(),
  notifyMock: vi.fn(),
}));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
// De mededelingstrook haalt zelf /api/mededeling op; buiten beeld houden.
vi.mock('../lib/mededeling', () => ({ useMededeling: () => null }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  openPdfInNewTab: openPdfMock,
  notify: notifyMock,
}));
vi.mock('../lib/dataUrl', () => ({ leesAlsDataUrl: async () => 'data:application/pdf;base64,JVBERi0=' }));
// Het beheerblok van de mededeling is lui en brengt zod mee: niet nodig hier.
vi.mock('../components/MededelingBeheer', () => ({ default: () => null }));

import { RitblaadjesView } from './RitblaadjesView';

/**
 * Ritbladen per dienstregelingversie (13-10, keuzes Jarno): één kaart per
 * versie, een toekomstige bundel vooraf te openen, de vorige zolang haar
 * versie bestaat, "nog geen ritbladen" met een knop naar de vorige, en de
 * upload per versie met de schakelaar voor de push.
 */
const PDF = (naam: string, token = 'vers') => `https://test.supabase.co/storage/v1/object/sign/ritblaadjes/${naam}.pdf?token=${token}`;
const CHAUFFEUR = { id: 'test-chauffeur', name: 'Test Chauffeur', role: 'chauffeur' } as User;
const ADMIN = { id: 'test-admin', name: 'Test Admin', role: 'admin' } as User;
const VANDAAG = '2026-11-20';

const versie = (id: string, geldigVanaf: string, status: 'verlopen' | 'huidig' | 'toekomstig', geldigTot: string | null, naam: string | null = null) => ({ id, naam, geldigVanaf, geldigTot, status });
const bundel = (naam: string) => ({ filename: `${naam}.pdf`, storagePath: `${naam}.pdf`, uploadedAt: '2026-09-01T08:00:00Z', uploadedBy: 'Jarno', sizeBytes: 2048, dienstregelingId: naam, url: PDF(naam) });
const SEP = versie('v-sep', '2026-09-01', 'verlopen', '2026-11-08', 'September 2026');
const NOV = versie('v-nov', '2026-11-09', 'huidig', '2026-12-31');
const JAN = versie('v-jan', '2027-01-01', 'toekomstig', null, 'Januari 2027');

const lijst = (opties: { jan?: boolean } = {}) => ({
  datum: VANDAAG,
  versie: NOV,
  bundel: bundel('nov'),
  vorige: null,
  bundels: [
    { versie: SEP, bundel: bundel('sep') },
    { versie: NOV, bundel: bundel('nov') },
    { versie: JAN, bundel: opties.jan ? bundel('jan') : null },
  ],
});
const json = (body: unknown) => new Response(JSON.stringify(body));
/** Standaard antwoorden per pad; `meta` is wat /api/ritblaadje?datum= geeft. */
const mockApi = (opties: { lijst?: unknown; meta?: (datum: string | null) => unknown } = {}) => {
  apiFetchMock.mockImplementation(async (pad: string, init?: RequestInit) => {
    if (pad.startsWith('/api/ritbladen')) return json(opties.lijst ?? lijst());
    if (pad.startsWith('/api/ritblaadje') && (!init?.method || init.method === 'GET')) {
      const datum = new URL(pad, 'http://x').searchParams.get('datum');
      return json(opties.meta ? opties.meta(datum) : { ...bundel('nov'), url: PDF('nov', `voor-${datum ?? 'vandaag'}`) });
    }
    return json({ filename: 'x.pdf', versie: null });
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${VANDAAG}T10:00:00`));
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
  vi.useRealTimers();
});

describe('Ritbladen per dienstregelingversie', () => {
  it('toont een kaart per versie: de huidige eerst, dan de toekomstige, dan de vorige', async () => {
    mockApi();
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    const kaarten = await screen.findAllByRole('region');
    const titels = kaarten.map((k) => k.getAttribute('aria-label'));
    expect(titels).toEqual(['Ritblad per dienst', 'Huidige ritbladen', 'Vanaf 01/01/2027', 'Tot en met 08/11/2026']);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/ritbladen', { cache: 'no-store' });
    expect(screen.getByText('Nu geldig')).toBeTruthy();
    expect(screen.getByText('Toekomstig')).toBeTruthy();
    expect(screen.getByText('Vorige')).toBeTruthy();
    // Beheerinfo (bestand, uploader) is niets voor een chauffeur.
    expect(screen.queryByText(/door Jarno/)).toBeNull();
    // De lijst staat als offline-kopie klaar, zonder tokens.
    const bewaard = localStorage.getItem('vhb-ritbladen-lijst')!;
    expect(bewaard).not.toContain('token=');
    expect(JSON.parse(bewaard).bundels[1].bundel.url).toBe(PDF('nov').split('?')[0]);
  });

  it('een versie zonder bundel zegt dat, met een knop naar de vorige ritbladen; Openen vraagt per versie een verse link voor haar dag', async () => {
    mockApi();
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    const jan = within(await screen.findByRole('region', { name: 'Vanaf 01/01/2027' }));
    expect(jan.getByText(/Nog geen ritbladen voor deze dienstregeling/)).toBeTruthy();
    // De vorige voor januari is de huidige (november): die opent op vandaag.
    fireEvent.click(jan.getByRole('button', { name: 'Vorige ritbladen openen' }));
    await waitFor(() => expect(openPdfMock).toHaveBeenCalledWith(PDF('nov', 'voor-vandaag')));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje', { cache: 'no-store' });
    // De vorige versie opent op haar laatste dag.
    const sep = within(screen.getByRole('region', { name: 'Tot en met 08/11/2026' }));
    fireEvent.click(sep.getByRole('button', { name: 'Openen' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje?datum=2026-11-08', { cache: 'no-store' }));
    await waitFor(() => expect(openPdfMock).toHaveBeenCalledWith(PDF('nov', 'voor-2026-11-08')));
    expect(openPdfMock).not.toHaveBeenCalledWith(PDF('sep'));
  });

  it('een toekomstige bundel is vooraf te openen op haar eerste dag', async () => {
    mockApi({ lijst: lijst({ jan: true }) });
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    const jan = within(await screen.findByRole('region', { name: 'Vanaf 01/01/2027' }));
    expect(jan.queryByText(/Nog geen ritbladen/)).toBeNull();
    fireEvent.click(jan.getByRole('button', { name: 'Openen' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje?datum=2027-01-01', { cache: 'no-store' }));
  });

  it('valt zonder bereik terug op de bewaarde lijst en zegt dat', async () => {
    mockApi();
    const eerste = render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    await screen.findByRole('region', { name: 'Huidige ritbladen' });
    eerste.unmount();
    apiFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<RitblaadjesView currentUser={CHAUFFEUR} />);
    await screen.findByText('Offline', { exact: true });
    expect(screen.getByRole('region', { name: 'Vanaf 01/01/2027' })).toBeTruthy();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('admin: upload per versie stuurt de versie en de schakelaar "Chauffeurs verwittigen" mee', async () => {
    mockApi();
    render(<RitblaadjesView currentUser={ADMIN} />);
    const jan = within(await screen.findByRole('region', { name: 'Vanaf 01/01/2027' }));
    // Beheerinfo wél voor staf.
    expect(screen.getAllByText(/door Jarno/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Chauffeurs verwittigen' }));
    fireEvent.click(jan.getByRole('button', { name: 'Upload PDF' }));
    const bestand = new File(['%PDF-1.4'], 'januari.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('PDF kiezen'), { target: { files: [bestand] } });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje?versie=v-jan', expect.objectContaining({ method: 'POST' })));
    const aanroep = apiFetchMock.mock.calls.find((c) => c[0] === '/api/ritblaadje?versie=v-jan')!;
    expect(JSON.parse(aanroep[1].body)).toMatchObject({ filename: 'januari.pdf', melden: false });
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith('Ritbladen bijgewerkt.', 'success'));
  });

  it('admin: verwijderen vraagt een bevestiging en richt zich op die versie', async () => {
    mockApi();
    render(<RitblaadjesView currentUser={ADMIN} />);
    const sep = within(await screen.findByRole('region', { name: 'Tot en met 08/11/2026' }));
    fireEvent.click(sep.getByRole('button', { name: 'Verwijder tot en met 08/11/2026' }));
    const dialoog = await screen.findByRole('dialog');
    fireEvent.click(within(dialoog).getByRole('button', { name: /^Verwijderen$|^Bevestigen$|^Ja/ }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje?versie=v-sep', { method: 'DELETE' }));
  });
});
