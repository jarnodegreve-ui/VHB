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
}));

vi.mock('../lib/api', () => {
  const apiFetch = async (url: string, init: { method?: string; accessToken?: string } = {}) => {
    if ((init.method ?? 'GET') === 'GET') net.verzoeken.push({ url, accessToken: init.accessToken });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
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

const { useAppData } = await import('./useAppData');

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
