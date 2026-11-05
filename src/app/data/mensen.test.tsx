import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { User } from '../../types';

/**
 * saveUsers en een 409 van de server (05-11-2026, gespiegeld aan ruil.test):
 * tot dan las de save élke 409 of 428 als "intussen door iemand anders
 * gewijzigd" en ververste hij de lijst. Daardoor kwamen de twee andere 409's
 * van POST /api/users nooit in beeld: de massa-verwijder-rem
 * (api/_lib/collectie.ts, `details`) en "e-mail al in gebruik"
 * (api/_lib/gebruikersRoutes.ts, `conflict: 'email'`). Alleen het antwoord
 * van de revisiecheck (conflict 'revision', of 428) is een conflict.
 */
const net = vi.hoisted(() => ({
  verzoeken: [] as Array<{ url: string; method: string }>,
  antwoord: (_url: string, _method: string): { status?: number; body: unknown } => ({ body: {} }),
}));

vi.mock('../../lib/api', () => {
  const apiFetch = async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    net.verzoeken.push({ url, method });
    const { status = 200, body } = net.antwoord(url, method);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  const apiLijst = async (url: string, init: { method?: string } = {}) => {
    const response = await apiFetch(url, init);
    return { response, data: await response.json() };
  };
  const apiJson = async (url: string, init: { method?: string } = {}) => (await apiFetch(url, init)).json();
  return { apiFetch, apiLijst, apiJson };
});
vi.mock('../../lib/tik', () => ({ tik: () => {} }));

const { useDataKern } = await import('./kern');
const { useMensenData } = await import('./mensen');

type Toast = { tekst: string; toon?: string };

const jan: User = { id: 'u-jan', name: 'Jan Peeters', role: 'chauffeur', email: 'jan@vhb.be' } as User;

const REM = 'Deze opslag zou 12 van de 20 gebruikers verwijderen. Vermoedelijk was je scherm niet volledig geladen, vernieuw de pagina en probeer opnieuw, of verwijder in kleinere stappen.';
const EMAIL = 'Dit e-mailadres is al in gebruik bij een ander account.';

describe('saveUsers en een 409 van de server', () => {
  let root: Root;
  let el: HTMLDivElement;
  let toasts: Toast[];
  let data: ReturnType<typeof useMensenData> | null;

  const gets = () => net.verzoeken.filter((v) => v.method === 'GET' && v.url === '/api/users');

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    toasts = [];
    data = null;
    net.verzoeken = [];
    net.antwoord = (_url, method) => (method === 'GET' ? { body: [] } : { body: { success: true } });
    function Proef() {
      const ctx = useDataKern({
        session: null,
        currentUser: { id: 'u-admin', role: 'admin' },
        dataKlaar: true,
        showToast: (tekst: string, toon?: string) => { toasts.push({ tekst, toon }); },
        meldLaadfout: () => {},
        fetchActivityLog: async () => {},
      } as unknown as Parameters<typeof useDataKern>[0]);
      data = useMensenData(ctx);
      return null;
    }
    await act(async () => { root.render(<Proef />); });
    // De lijst moet geladen zijn, anders weigert guardCollectionLoaded de save.
    await act(async () => { await data!.fetchUsers(); });
    net.verzoeken = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  it('de massa-verwijder-rem komt als fout in beeld, met de reden en zonder verversing', async () => {
    net.antwoord = (_url, method) => (method === 'POST' ? { status: 409, body: { error: 'Bulk-verwijdering geblokkeerd', details: REM } } : { body: [] });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.saveUsers([jan]); });
    expect(ok).toBe(false);
    // De fouttekst laadt lui (foutenLui.ts): even wachten op de toast.
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toBe(`Opslaan van gebruikers is mislukt. ${REM}`);
    expect(toasts[0].tekst).not.toMatch(/iemand anders/i);
    expect(gets()).toHaveLength(0);
  });

  it('"e-mail al in gebruik" (conflict email) is een reden, geen revisieconflict', async () => {
    net.antwoord = (_url, method) => (method === 'POST' ? { status: 409, body: { error: EMAIL, conflict: 'email' } } : { body: [] });
    await act(async () => { await data!.saveUsers([jan]); });
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toBe(`Opslaan van gebruikers is mislukt. ${EMAIL}`);
    expect(gets()).toHaveLength(0);
  });

  it('een revisieconflict van de lijst ververst en vraagt opnieuw te proberen', async () => {
    net.antwoord = (_url, method) => (method === 'POST'
      ? { status: 409, body: { error: 'Gewijzigd door iemand anders', details: 'De gebruikerslijst is intussen door iemand anders aangepast.', conflict: 'revision' } }
      : { body: [] });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.saveUsers([jan]); });
    expect(ok).toBe(false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(toasts[0].tekst).toBe('De gebruikerslijst is intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.');
    expect(gets()).toHaveLength(1);
  });
});
