import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanningCode, Service, Shift } from '../../types';

/**
 * De drie collectie-saves van de planning en een 409 van de server
 * (05-11-2026, gespiegeld aan ruil.test): tot dan las elke save een 409 of
 * 428 als "intussen door iemand anders gewijzigd" en ververste hij. De
 * massa-verwijder-rem (api/_lib/collectie.ts, `details`) en een dienstregel
 * (dubbele inplanning) kwamen zo nooit in beeld. Alleen het antwoord van de
 * revisiecheck (conflict 'revision', of 428) is een conflict.
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
vi.mock('../router', () => ({ navigeer: () => {} }));

const { useDataKern } = await import('./kern');
const { usePlanningData } = await import('./planning');

type Toast = { tekst: string; toon?: string };

const dienst: Shift = { id: 's-1', date: '2026-11-09', driverId: 'u-jan', serviceNumber: '2704' } as unknown as Shift;
const service: Service = { id: 'd-1', serviceNumber: '2704' } as unknown as Service;
const code: PlanningCode = { code: 'BUR', category: 'service', description: 'Bureau', countsAsShift: false, isPaidAbsence: false, isDayOff: false } as PlanningCode;

const REM = 'Deze opslag zou 300 van de 320 diensten verwijderen. Vermoedelijk was je scherm niet volledig geladen, vernieuw de pagina en probeer opnieuw, of verwijder in kleinere stappen.';
const DUBBEL = 'Jan Peeters rijdt op 09/11/2026 al dienst 2301. Er is niets gewijzigd. Kijk de planning na en probeer opnieuw.';
const REVISIE = { error: 'Gewijzigd door iemand anders', details: 'De lijst is intussen door iemand anders aangepast.', conflict: 'revision' };

describe('de planning-saves en een 409 van de server', () => {
  let root: Root;
  let el: HTMLDivElement;
  let toasts: Toast[];
  let data: ReturnType<typeof usePlanningData> | null;

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
      data = usePlanningData(ctx);
      return null;
    }
    await act(async () => { root.render(<Proef />); });
    // De collecties moeten geladen zijn, anders weigert guardCollectionLoaded de save.
    await act(async () => { await Promise.all([data!.fetchPlanning(), data!.fetchServices(), data!.fetchPlanningCodes()]); });
    net.verzoeken = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  it('savePlanning: een regel van de server komt als fout in beeld, zonder verversing', async () => {
    bijPost({ status: 409, body: { error: DUBBEL } });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.savePlanning([dienst]); });
    expect(ok).toBe(false);
    // De fouttekst laadt lui (foutenLui.ts): even wachten op de toast.
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toBe(`Opslaan van planning is mislukt. ${DUBBEL}`);
    expect(gets('/api/planning')).toHaveLength(0);
  });

  it('savePlanning: een revisieconflict ververst en vraagt opnieuw te proberen', async () => {
    bijPost({ status: 409, body: REVISIE });
    await act(async () => { await data!.savePlanning([dienst]); });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(toasts[0].tekst).toBe('De planning is intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.');
    expect(gets('/api/planning')).toHaveLength(1);
  });

  it('saveServices: de massa-verwijder-rem toont haar reden; een 428 blijft een revisieconflict', async () => {
    bijPost({ status: 409, body: { error: 'Bulk-verwijdering geblokkeerd', details: REM } });
    await act(async () => { await data!.saveServices([service]); });
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toBe(`Opslaan van diensten is mislukt. ${REM}`);
    expect(gets('/api/services')).toHaveLength(0);

    toasts = [];
    bijPost({ status: 428, body: { error: 'Revisie ontbreekt', conflict: 'revision-missing' } });
    await act(async () => { await data!.saveServices([service]); });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(gets('/api/services')).toHaveLength(1);
  });

  it('savePlanningCodes: een reden is een fout, een revisieconflict ververst', async () => {
    bijPost({ status: 409, body: { error: 'Code BUR wordt nog gebruikt in de planning.' } });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.savePlanningCodes([code]); });
    expect(ok).toBe(false);
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0].toon).toBe('error');
    expect(toasts[0].tekst).toBe('Opslaan van planningscodes is mislukt. Code BUR wordt nog gebruikt in de planning.');
    expect(gets('/api/planning-codes')).toHaveLength(0);

    toasts = [];
    bijPost({ status: 409, body: REVISIE });
    await act(async () => { await data!.savePlanningCodes([code]); });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].toon).toBe('info');
    expect(toasts[0].tekst).toBe('De planningscodes zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.');
    expect(gets('/api/planning-codes')).toHaveLength(1);
  });
});
