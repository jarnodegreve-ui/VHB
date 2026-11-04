import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SwapRequest } from '../../types';

/**
 * Een 409 op POST /api/swaps is voor een chauffeur nooit een revisieconflict
 * (de server controleert de revisie alleen voor staf, api/_lib/ruilRoutes.ts)
 * maar een regel over zijn aanvraag: de dienst loopt al, de collega staat die
 * dag niet vrij of is afwezig. Tot 04-11-2026 maakte de datalaag van élke 409
 * "intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging
 * opnieuw", en de chauffeur bleef dezelfde aanvraag indienen (Bart, 03-11).
 * Alleen het antwoord van revisionCheck (conflict 'revision', of 428) is dat.
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
  return { apiFetch, apiLijst };
});
vi.mock('../../lib/tik', () => ({ tik: () => {} }));

const { useDataKern } = await import('./kern');
const { useRuilData } = await import('./ruil');

type Toast = { tekst: string; toon?: string };

const aanvraag: SwapRequest = {
  id: 'r-1',
  shiftId: 's-2704',
  requesterId: 'u-bart',
  targetDriverId: 'u-danny',
  status: 'pending',
  createdAt: '2026-11-03T10:51:00.000Z',
  swapType: 'overname',
};

const REGEL = 'Voor Danny Van Ooteghem staat er op 08/11/2026 niets in de planning. Ruilen zonder tegenprestatie kan alleen als de collega die dag vrij/bv/tk/ta staat.';

describe('saveSwaps en een 409 van de server', () => {
  let root: Root;
  let el: HTMLDivElement;
  let toasts: Toast[];
  let data: ReturnType<typeof useRuilData> | null;

  const gets = () => net.verzoeken.filter((v) => v.method === 'GET' && v.url === '/api/swaps');

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
        currentUser: { id: 'u-bart', role: 'chauffeur' },
        showToast: (tekst: string, toon?: string) => { toasts.push({ tekst, toon }); },
        meldLaadfout: () => {},
        fetchActivityLog: async () => {},
      } as unknown as Parameters<typeof useDataKern>[0]);
      data = useRuilData(ctx);
      return null;
    }
    await act(async () => { root.render(<Proef />); });
    // De lijst moet geladen zijn, anders weigert guardCollectionLoaded de save.
    await act(async () => { await data!.fetchSwaps(); });
    net.verzoeken = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  it('een regel van de server komt als fout in beeld, met de reden en zonder "iemand anders"', async () => {
    net.antwoord = (_url, method) => (method === 'POST' ? { status: 409, body: { error: REGEL } } : { body: [] });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.saveSwaps([aanvraag]); });
    expect(ok).toBe(false);
    // De fouttekst laadt lui (foutenLui.ts): even wachten op de toast.
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toBe(`Opslaan van dienstruilen is mislukt. ${REGEL}`);
    expect(toasts[0].tekst).not.toMatch(/iemand anders/i);
    // De lijst was niet verouderd: geen verversing die de chauffeur laat denken
    // dat er iets veranderd is.
    expect(gets()).toHaveLength(0);
  });

  it('een revisieconflict van de lijst ververst en vraagt opnieuw te proberen', async () => {
    net.antwoord = (_url, method) => (method === 'POST'
      ? { status: 409, body: { error: 'Gewijzigd door iemand anders', details: 'De dienstruilen zijn intussen door iemand anders aangepast.', conflict: 'revision' } }
      : { body: [] });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.saveSwaps([aanvraag]); });
    expect(ok).toBe(false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(toasts[0].tekst).toBe('De dienstruilen zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.');
    expect(gets()).toHaveLength(1);
  });

  it('een ontbrekende revisie (428) telt ook als revisieconflict', async () => {
    net.antwoord = (_url, method) => (method === 'POST'
      ? { status: 428, body: { error: 'Revisie ontbreekt', conflict: 'revision-missing' } }
      : { body: [] });
    await act(async () => { await data!.saveSwaps([aanvraag]); });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(gets()).toHaveLength(1);
  });
});
