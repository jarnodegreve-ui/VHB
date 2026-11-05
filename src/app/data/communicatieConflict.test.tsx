import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Diversion, Update } from '../../types';

/**
 * saveUpdates en saveDiversions en een 409 van de server (05-11-2026,
 * gespiegeld aan ruil.test): tot dan las elke save een 409 of 428 als
 * "intussen door iemand anders gewijzigd" en ververste hij. De
 * massa-verwijder-rem (api/_lib/collectie.ts, `details`) kwam zo nooit in
 * beeld. Alleen het antwoord van de revisiecheck (conflict 'revision', of
 * 428) is een conflict.
 */
const net = vi.hoisted(() => ({
  verzoeken: [] as Array<{ url: string; method: string }>,
  antwoord: (_url: string, _method: string): { status?: number; body: unknown } => ({ body: {} }),
}));

vi.mock('../../lib/api', () => ({
  apiFetch: async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    net.verzoeken.push({ url, method });
    const { status = 200, body } = net.antwoord(url, method);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  },
}));
vi.mock('../../lib/tik', () => ({ tik: () => {} }));

const { useDataKern } = await import('./kern');
const { useCommunicatieData } = await import('./communicatie');

type Toast = { tekst: string; toon?: string };

const omleiding: Diversion = { id: 'o-1', line: '12', title: 'Werken N70', description: 'Omrijden', startDate: '2026-11-01' } as Diversion;
const update: Update = { id: 'u-1', date: '01/11/2026', title: 'Nieuwe halte', content: 'Vanaf maandag' } as Update;

const REM = 'Deze opslag zou 9 van de 12 updates verwijderen. Vermoedelijk was je scherm niet volledig geladen, vernieuw de pagina en probeer opnieuw, of verwijder in kleinere stappen.';
const REVISIE = { error: 'Gewijzigd door iemand anders', details: 'De lijst is intussen door iemand anders aangepast.', conflict: 'revision' };

describe('saveUpdates en saveDiversions en een 409 van de server', () => {
  let root: Root;
  let el: HTMLDivElement;
  let toasts: Toast[];
  let data: ReturnType<typeof useCommunicatieData> | null;

  const gets = (url: string) => net.verzoeken.filter((v) => v.method === 'GET' && v.url === url);
  const bijPost = (uit: { status: number; body: unknown }) => {
    net.antwoord = (_url, method) => (method === 'POST' ? uit : { body: [] });
  };

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
      data = useCommunicatieData({ ...ctx, users: [] });
      return null;
    }
    await act(async () => { root.render(<Proef />); });
    // De collecties moeten geladen zijn, anders weigert guardCollectionLoaded de save.
    await act(async () => { await Promise.all([data!.fetchUpdates(), data!.fetchDiversions()]); });
    net.verzoeken = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  it('saveUpdates: de massa-verwijder-rem komt als fout in beeld, zonder verversing', async () => {
    bijPost({ status: 409, body: { error: 'Bulk-verwijdering geblokkeerd', details: REM } });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.saveUpdates([update]); });
    expect(ok).toBe(false);
    // De fouttekst laadt lui (foutenLui.ts): even wachten op de toast.
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toBe(`Opslaan van updates is mislukt. ${REM}`);
    expect(gets('/api/updates')).toHaveLength(0);
  });

  it('saveUpdates: een revisieconflict ververst en vraagt opnieuw te proberen', async () => {
    bijPost({ status: 409, body: REVISIE });
    await act(async () => { await data!.saveUpdates([update]); });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(toasts[0].tekst).toBe('De updates zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.');
    expect(gets('/api/updates')).toHaveLength(1);
  });

  it('saveDiversions: een reden is een fout, een revisieconflict ververst', async () => {
    bijPost({ status: 409, body: { error: 'Bulk-verwijdering geblokkeerd', details: REM.replace('updates', 'omleidingen') } });
    await act(async () => { await data!.saveDiversions([omleiding]); });
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toMatch(/^Opslaan van omleidingen is mislukt\. Deze opslag zou 9 van de 12 omleidingen verwijderen\./);
    expect(gets('/api/diversions')).toHaveLength(0);

    toasts = [];
    bijPost({ status: 409, body: REVISIE });
    await act(async () => { await data!.saveDiversions([omleiding]); });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(toasts[0].tekst).toBe('De omleidingen zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.');
    expect(gets('/api/diversions')).toHaveLength(1);
  });
});
