import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { LeaveRequest } from '../../types';

/**
 * Een lijst die vóór een eigen geslaagde beslissing vertrok, zet die
 * beslissing niet terug (15-11-2026). In een bulk met één aanvraag die al
 * behandeld was (409) ververst de datalaag de lijst zonder erop te wachten,
 * terwijl de volgende beslissing vertrekt. Kwam het antwoord van die
 * verversing na de beslissing binnen, dan stond de net goedgekeurde aanvraag
 * weer als "in behandeling" in de lijst, tot de volgende verversing.
 *
 * De late lijst telt nog altijd volledig (ook haar revisie, zoals vroeger);
 * alleen een aanvraag die ze nog toont in de status van vóór de eigen
 * beslissing, houdt het antwoord van die beslissing. Geen extra verzoek.
 */
type Antwoord = { status?: number; body: unknown; revisie?: string };
const net = vi.hoisted(() => ({
  verzoeken: [] as Array<{ url: string; method: string; revisie: string | null }>,
  antwoord: (_url: string, _method: string): Antwoord | Promise<Antwoord> => ({ body: [] }),
}));

vi.mock('../../lib/api', () => {
  const apiFetch = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? 'GET';
    const kop = Object.entries(init.headers ?? {}).find(([naam]) => naam.toLowerCase() === 'x-collection-revision');
    net.verzoeken.push({ url, method, revisie: kop ? kop[1] : null });
    const { status = 200, body, revisie } = await net.antwoord(url, method);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(revisie ? { 'x-collection-revision': revisie } : {}) } });
  };
  const apiJson = async () => [];
  return { apiFetch, apiJson };
});

const { useDataKern } = await import('./kern');
const { useVerlofData } = await import('./verlof');

const aanvraag = (id: string, status: LeaveRequest['status'] = 'pending'): LeaveRequest => ({
  id, userId: `u-${id}`, startDate: '2026-12-01', endDate: '2026-12-02', type: 'betaald_verlof', status, createdAt: '2026-11-15T09:00:00.000Z',
});

/** Een antwoord dat de test zelf vrijgeeft. */
function uitgesteld() {
  let los = (_a: Antwoord) => {};
  const belofte = new Promise<Antwoord>((klaar) => { los = klaar; });
  return { belofte, los };
}

describe('fetchLeave en een eigen beslissing onderweg', () => {
  let root: Root;
  let el: HTMLDivElement;
  let data: ReturnType<typeof useVerlofData> | null;
  /** De stand op de server. */
  let server: LeaveRequest[];
  /** Elke status van w3 die ooit getekend werd, in volgorde (zonder herhaling). */
  let w3InBeeld: Array<string | undefined>;

  const gets = () => net.verzoeken.filter((v) => v.method === 'GET' && v.url === '/api/leave');
  const status = (id: string) => data!.leaveRequests.find((r) => r.id === id)?.status;
  const patch = (url: string): Antwoord => {
    const id = url.split('/').pop()!;
    server = server.map((r) => (r.id === id ? { ...r, status: 'approved' } : r));
    return { body: { leave: server.find((r) => r.id === id) }, revisie: 'na-patch' };
  };
  const kopie = () => server.map((r) => ({ ...r }));

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    data = null;
    w3InBeeld = [];
    server = [aanvraag('w1'), aanvraag('w2'), aanvraag('w3')];
    net.verzoeken = [];
    net.antwoord = (url, method) => (method === 'GET' ? { body: server, revisie: 'begin' } : patch(url));
    function Proef() {
      const ctx = useDataKern({
        session: null,
        currentUser: { id: 'u-planner', role: 'planner' },
        showToast: () => {},
        meldLaadfout: () => {},
        fetchActivityLog: async () => {},
      } as unknown as Parameters<typeof useDataKern>[0]);
      data = useVerlofData({ ...ctx, refreshCoverageGaps: async () => {} });
      const nu = data.leaveRequests.find((r) => r.id === 'w3')?.status;
      if (w3InBeeld.at(-1) !== nu) w3InBeeld.push(nu);
      return null;
    }
    await act(async () => { root.render(<Proef />); });
    await act(async () => { await data!.fetchLeave(); });
    net.verzoeken = [];
    w3InBeeld = [status('w3')];
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  /** Een lezing vertrekt en blijft hangen; daarna slaagt de beslissing over w3. */
  async function lezingKruistBeslissing() {
    const traag = uitgesteld();
    net.antwoord = (url, method) => (method === 'GET' ? traag.belofte : patch(url));
    let lezing!: Promise<void>;
    act(() => { lezing = data!.fetchLeave(); });
    let ok: boolean | undefined;
    await act(async () => { ok = await data!.decideLeave('w3', 'approved', 'pending'); });
    expect(ok).toBe(true);
    expect(status('w3')).toBe('approved');
    net.antwoord = (url, method) => (method === 'GET' ? { body: server, revisie: 'vers' } : patch(url));
    return { los: async (antwoord: Antwoord) => { await act(async () => { traag.los(antwoord); await lezing; }); } };
  }

  it('een lezing die vóór de beslissing vertrok en erna binnenkomt, zet de beslissing niet terug: nooit in beeld, zonder extra verzoek', async () => {
    const voor = kopie(); // w3 wacht nog
    const { los } = await lezingKruistBeslissing();
    await los({ body: voor, revisie: 'oud' });
    expect(status('w3')).toBe('approved');
    expect(w3InBeeld).toEqual(['pending', 'approved']);
    expect(gets()).toHaveLength(1);
  });

  it('wat een collega intussen deed, komt uit de late lijst gewoon mee', async () => {
    const voor = [...kopie(), aanvraag('w4')].map((r) => (r.id === 'w1' ? { ...r, status: 'rejected' as const } : r));
    const { los } = await lezingKruistBeslissing();
    await los({ body: voor, revisie: 'oud' });
    expect(data!.leaveRequests.map((r) => `${r.id}:${r.status}`)).toEqual(['w1:rejected', 'w2:pending', 'w3:approved', 'w4:pending']);
  });

  it('toont de late lijst de aanvraag in een andere status dan vóór de beslissing, dan geldt de lijst', async () => {
    const { los } = await lezingKruistBeslissing();
    await los({ body: kopie().map((r) => (r.id === 'w3' ? { ...r, status: 'cancelled' as const } : r)), revisie: 'oud' });
    expect(status('w3')).toBe('cancelled');
  });

  it('de revisie volgt de late lijst, zoals vroeger: een opslag daarna stuurt de oudere revisie mee', async () => {
    const { los } = await lezingKruistBeslissing();
    await los({ body: [aanvraag('w1'), aanvraag('w2'), aanvraag('w3')], revisie: 'oud' });
    net.antwoord = (_url, method) => (method === 'GET' ? { body: server, revisie: 'vers' } : { body: { success: true }, revisie: 'na-opslag' });
    await act(async () => { await data!.saveLeave(data!.leaveRequests); });
    const post = net.verzoeken.find((v) => v.method === 'POST' && v.url === '/api/leave');
    expect(post?.revisie).toBe('oud');
  });

  it('een lezing die ná de beslissing vertrok, telt zoals ze is', async () => {
    await act(async () => { await data!.decideLeave('w3', 'approved', 'pending'); });
    // De server zegt daarna toch "in behandeling" (iemand zette ze terug): dat is de waarheid.
    net.antwoord = (_url, method) => (method === 'GET' ? { body: [aanvraag('w1'), aanvraag('w2'), aanvraag('w3')], revisie: 'later' } : { body: {} });
    await act(async () => { await data!.fetchLeave(); });
    expect(status('w3')).toBe('pending');
  });

  it('na een gekruiste lezing telt de volgende lezing altijd, ook met hetzelfde antwoord', async () => {
    const voor = kopie();
    const { los } = await lezingKruistBeslissing();
    await los({ body: voor, revisie: 'oud' });
    expect(status('w3')).toBe('approved');
    // Dezelfde inhoud en dezelfde revisie als het late antwoord, maar nu vers gelezen.
    net.antwoord = (_url, method) => (method === 'GET' ? { body: voor, revisie: 'oud' } : { body: {} });
    await act(async () => { await data!.fetchLeave(); });
    expect(status('w3')).toBe('pending');
  });

  it('bulk met een 409 in het midden: de verversing na de 409 zet de beslissing erna niet terug, in één verzoek', async () => {
    const traag = uitgesteld();
    let momentopname: LeaveRequest[] = [];
    net.antwoord = (url, method) => {
      if (method === 'GET') {
        // De stand op het moment dat de verversing vertrekt: w3 wacht nog.
        momentopname = kopie();
        return traag.belofte.then(() => ({ body: momentopname, revisie: 'oud' }));
      }
      if (url.endsWith('/w2')) return { status: 409, body: { error: 'Deze aanvraag is intussen al behandeld.', currentStatus: 'approved' } };
      return patch(url);
    };
    const uitkomst: boolean[] = [];
    await act(async () => {
      for (const id of ['w1', 'w2', 'w3']) uitkomst.push(await data!.decideLeave(id, 'approved', 'pending'));
    });
    expect(uitkomst).toEqual([true, false, true]);
    expect(gets()).toHaveLength(1); // de verversing na de 409, nog onderweg
    expect(momentopname.find((r) => r.id === 'w3')?.status).toBe('pending');
    let afgeleverd = false;
    void traag.belofte.then(() => { afgeleverd = true; });
    await act(async () => { traag.los({ body: null }); await vi.waitFor(() => expect(afgeleverd).toBe(true)); await new Promise((klaar) => setTimeout(klaar, 0)); });
    expect(status('w1')).toBe('approved');
    expect(status('w3')).toBe('approved');
    expect(w3InBeeld).toEqual(['pending', 'approved']);
    expect(gets()).toHaveLength(1);
  });

  it('twee lezingen tegelijk onderweg (de echo en de verversing na een 409): geen van beide zet de beslissing terug', async () => {
    const voor = kopie();
    const eerste = uitgesteld();
    const tweede = uitgesteld();
    const wachtrij = [eerste, tweede];
    net.antwoord = (url, method) => (method === 'GET' ? wachtrij.shift()!.belofte : patch(url));
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => { a = data!.fetchLeave(); b = data!.fetchLeave(); });
    await act(async () => { await data!.decideLeave('w3', 'approved', 'pending'); });
    await act(async () => { eerste.los({ body: voor, revisie: 'oud-1' }); await a; });
    expect(status('w3')).toBe('approved');
    await act(async () => { tweede.los({ body: voor.map((r) => ({ ...r })), revisie: 'oud-2' }); await b; });
    expect(status('w3')).toBe('approved');
    expect(w3InBeeld).toEqual(['pending', 'approved']);
  });

  it('hangt er nog een oudere lezing, dan telt een lezing die ná de beslissing vertrok toch zoals ze is', async () => {
    const oud = uitgesteld();
    net.antwoord = (url, method) => (method === 'GET' ? oud.belofte : patch(url));
    let hangend!: Promise<void>;
    act(() => { hangend = data!.fetchLeave(); });
    await act(async () => { await data!.decideLeave('w3', 'approved', 'pending'); });
    // Vertrekt na de beslissing; de server zegt "in behandeling" (iemand zette ze terug).
    net.antwoord = (_url, method) => (method === 'GET' ? { body: [aanvraag('w1'), aanvraag('w2'), aanvraag('w3')], revisie: 'later' } : { body: {} });
    await act(async () => { await data!.fetchLeave(); });
    expect(status('w3')).toBe('pending');
    await act(async () => { oud.los({ body: [], revisie: 'x' }); await hangend; });
  });

  it('het hele antwoord van de beslissing blijft over de late lijst staan, niet alleen de status', async () => {
    const voor = kopie();
    const traag = uitgesteld();
    net.antwoord = (url, method) => {
      if (method === 'GET') return traag.belofte;
      const { body } = patch(url) as { body: { leave: LeaveRequest } };
      return { body: { leave: { ...body.leave, decidedAt: '2026-11-15T16:00:00.000Z', beslisReden: 'Akkoord' } }, revisie: 'na-patch' };
    };
    let lezing!: Promise<void>;
    act(() => { lezing = data!.fetchLeave(); });
    await act(async () => { await data!.decideLeave('w3', 'approved', 'pending'); });
    await act(async () => { traag.los({ body: voor, revisie: 'oud' }); await lezing; });
    expect(data!.leaveRequests.find((r) => r.id === 'w3')).toMatchObject({ status: 'approved', decidedAt: '2026-11-15T16:00:00.000Z', beslisReden: 'Akkoord' });
  });

  it('goedkeuren en daarna annuleren terwijl één lezing onderweg is: de late lijst toont geannuleerd', async () => {
    const voor = kopie();
    const traag = uitgesteld();
    net.antwoord = (url, method) => {
      if (method === 'GET') return traag.belofte;
      const id = url.split('/').pop()!;
      const huidig = server.find((r) => r.id === id)!;
      const volgende: LeaveRequest['status'] = huidig.status === 'pending' ? 'approved' : 'cancelled';
      server = server.map((r) => (r.id === id ? { ...r, status: volgende } : r));
      return { body: { leave: server.find((r) => r.id === id) }, revisie: 'na-patch' };
    };
    let lezing!: Promise<void>;
    act(() => { lezing = data!.fetchLeave(); });
    await act(async () => { await data!.decideLeave('w3', 'approved', 'pending'); });
    await act(async () => { await data!.decideLeave('w3', 'cancelled'); });
    expect(status('w3')).toBe('cancelled');
    await act(async () => { traag.los({ body: voor, revisie: 'oud' }); await lezing; });
    expect(status('w3')).toBe('cancelled');
    expect(w3InBeeld).toEqual(['pending', 'approved', 'cancelled']);
  });

  it('zonder beslissing onderweg telt het antwoord gewoon, en een gelijk antwoord zet niets opnieuw', async () => {
    server = [aanvraag('w1', 'approved'), aanvraag('w2'), aanvraag('w3')];
    await act(async () => { await data!.fetchLeave(); });
    expect(status('w1')).toBe('approved');
    const lijst = data!.leaveRequests;
    await act(async () => { await data!.fetchLeave(); });
    expect(data!.leaveRequests).toBe(lijst);
    expect(gets()).toHaveLength(2);
  });
});
