import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { User } from '../types';

/**
 * De laadbeurt van de datalaag (src/app/useAppData.ts). Hier staat wat niet
 * uit een domeinmodule alleen te lezen is: welk token een uitgestelde
 * collectie meekrijgt, bij de laadbeurt zelf en bij een latere herkansing.
 */
const net = vi.hoisted(() => ({
  verzoeken: [] as Array<{ url: string; accessToken: string | undefined }>,
  /** vers = gewoon antwoord; cache = uit de service worker (met Date); fout = netwerkfout. */
  modus: 'vers' as 'vers' | 'cache' | 'fout',
}));
const CACHE_DATUM = 'Tue, 03 Nov 2026 06:12:00 GMT';

vi.mock('../lib/api', () => {
  const apiFetch = async (url: string, init: { method?: string; accessToken?: string } = {}) => {
    if ((init.method ?? 'GET') === 'GET') net.verzoeken.push({ url, accessToken: init.accessToken });
    if (net.modus === 'fout') throw new TypeError('Failed to fetch');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (net.modus === 'cache') { headers['x-vhb-bron'] = 'cache'; headers.date = CACHE_DATUM; }
    return new Response('[]', { status: 200, headers });
  };
  const apiLijst = async (url: string, init: { accessToken?: string } = {}) => {
    const response = await apiFetch(url, init);
    return { response, data: await response.json() };
  };
  const apiJson = async (url: string, init: { accessToken?: string } = {}) => (await apiFetch(url, init)).json();
  return { apiFetch, apiLijst, apiJson };
});
vi.mock('../lib/tik', () => ({ tik: () => {} }));
vi.mock('./router', () => ({ navigeer: () => {} }));

const { useAppData, syncTijdNa } = await import('./useAppData');

const chauffeur = { id: 'u-jan', name: 'Jan Peeters', role: 'chauffeur' } as User;

describe('useAppData: het token van de laadbeurt', () => {
  let root: Root;
  let el: HTMLDivElement;
  let data: ReturnType<typeof useAppData> | null;

  function Proef() {
    data = useAppData({ session: null, currentUser: chauffeur, dataKlaar: true, currentView: 'dashboard', showToast: () => {}, meldLaadfout: () => {} });
    return null;
  }

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    data = null;
    net.verzoeken = [];
    net.modus = 'vers';
    await act(async () => { root.render(<Proef />); });
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  it('de laadbeurt geeft haar token mee; een latere herkansing vertrekt zonder, op de live sessie', async () => {
    await act(async () => { await data!.loadAppData(chauffeur, 'token-bij-inloggen', { wachtOpAlles: true }); });
    const users = net.verzoeken.filter((v) => v.url === '/api/users');
    expect(users).toHaveLength(1);
    expect(users[0].accessToken).toBe('token-bij-inloggen');
    // Uren later "Opnieuw proberen" op de Foutkaart (herlaadCollectie): niet
    // meer met het token van toen (verlopen, eerst een 401 en een refresh),
    // maar zonder expliciet token zodat apiFetch de huidige sessie neemt.
    net.verzoeken = [];
    await act(async () => { await data!.herlaadCollectie('users'); });
    const opnieuw = net.verzoeken.filter((v) => v.url === '/api/users');
    expect(opnieuw).toHaveLength(1);
    expect(opnieuw[0].accessToken).toBeUndefined();
  });
});

/**
 * De synctijd ("gegevens van hh:mm") na een laadronde of een stille catch-up
 * (05-11): verschuift alleen als er echt een antwoord kwam. Tot dan zette de
 * online-catch-up in App.tsx de tijd ook als elke call mislukt was.
 */
describe('syncTijdNa', () => {
  const NU = Date.parse('2026-11-05T10:00:00Z');
  const OUD = Date.parse('2026-11-03T06:12:00Z');

  it('alles vers = nu; iets uit de cache = het oudste gecachte antwoord, nooit later dan wat er stond', () => {
    expect(syncTijdNa({ vers: 3, uitCache: 0, oudste: null }, null, NU)).toBe(NU);
    expect(syncTijdNa({ vers: 2, uitCache: 1, oudste: OUD }, null, NU)).toBe(OUD);
    expect(syncTijdNa({ vers: 2, uitCache: 1, oudste: OUD }, OUD - 1000, NU)).toBe(OUD - 1000);
    expect(syncTijdNa({ vers: 0, uitCache: 1, oudste: null }, NU - 5000, NU)).toBe(NU - 5000);
  });

  it('geen enkel antwoord (alles mislukt) laat de vorige waarde staan', () => {
    expect(syncTijdNa({ vers: 0, uitCache: 0, oudste: null }, null, NU)).toBeNull();
    expect(syncTijdNa({ vers: 0, uitCache: 0, oudste: null }, NU - 5000, NU)).toBe(NU - 5000);
  });
});

describe('useAppData: boekSync', () => {
  let root: Root;
  let el: HTMLDivElement;
  let data: ReturnType<typeof useAppData> | null;

  function Proef() {
    data = useAppData({ session: null, currentUser: chauffeur, dataKlaar: true, currentView: 'dashboard', showToast: () => {}, meldLaadfout: () => {} });
    return null;
  }

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    data = null;
    net.verzoeken = [];
    net.modus = 'vers';
    await act(async () => { root.render(<Proef />); });
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  it('een ronde zonder enig antwoord verschuift de synctijd niet; een ronde met antwoord wel', async () => {
    net.modus = 'fout';
    await act(async () => { await data!.boekSync(() => Promise.allSettled([data!.fetchLeave(), data!.fetchSwaps()])); });
    expect(data!.lastSyncedAt).toBeNull();
    net.modus = 'cache';
    await act(async () => { await data!.boekSync(() => data!.fetchLeave()); });
    expect(data!.lastSyncedAt).toBe(Date.parse(CACHE_DATUM));
    net.modus = 'vers';
    const voor = Date.now();
    await act(async () => { await data!.boekSync(() => data!.fetchLeave()); });
    expect(data!.lastSyncedAt).toBeGreaterThanOrEqual(voor);
  });
});
