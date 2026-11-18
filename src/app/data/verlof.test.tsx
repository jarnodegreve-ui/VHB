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
 * Een nog bruikbare late lijst behoudt het antwoord van een eigen beslissing
 * zolang ze die aanvraag in de oude status toont. De samengestelde lijst
 * mag niet als basis dienen om de volledige collectie op te slaan.
 */
type Antwoord = { status?: number; body: unknown; revisie?: string; uitCache?: boolean };
const net = vi.hoisted(() => ({
  verzoeken: [] as Array<{ url: string; method: string; revisie: string | null }>,
  antwoord: (_url: string, _method: string): Antwoord | Promise<Antwoord> => ({ body: [] }),
}));

vi.mock('../../lib/api', () => {
  const apiFetch = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? 'GET';
    const kop = Object.entries(init.headers ?? {}).find(([naam]) => naam.toLowerCase() === 'x-collection-revision');
    net.verzoeken.push({ url, method, revisie: kop ? kop[1] : null });
    const { status = 200, body, revisie, uitCache } = await net.antwoord(url, method);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (revisie) headers['x-collection-revision'] = revisie;
    if (uitCache) headers['x-vhb-bron'] = 'cache';
    return new Response(JSON.stringify(body), { status, headers });
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
  let ctx: ReturnType<typeof useDataKern>;
  let wisselAccount: () => Promise<void>;
  const toon = vi.fn();
  const meldLaadfout = vi.fn();
  const fetchActivityLog = vi.fn(async () => {});
  const refreshCoverageGaps = vi.fn(async () => {});
  /** De stand op de server. */
  let server: LeaveRequest[];
  /** Elke status van w3 die ooit getekend werd, in volgorde (zonder herhaling). */
  let w3InBeeld: Array<string | undefined>;

  const gets = () => net.verzoeken.filter((v) => v.method === 'GET' && v.url === '/api/leave');
  const posts = () => net.verzoeken.filter((v) => v.method === 'POST' && v.url === '/api/leave');
  const revisie = () => ctx.revisionHeader('leave')['x-collection-revision'];
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
    let account = 'a';
    toon.mockClear();
    meldLaadfout.mockClear();
    fetchActivityLog.mockClear();
    refreshCoverageGaps.mockClear();
    function Proef() {
      ctx = useDataKern({
        session: null,
        currentUser: { id: account, role: 'admin' },
        showToast: toon,
        meldLaadfout,
        fetchActivityLog,
      } as unknown as Parameters<typeof useDataKern>[0]);
      data = useVerlofData({ ...ctx, refreshCoverageGaps });
      const nu = data.leaveRequests.find((r) => r.id === 'w3')?.status;
      if (w3InBeeld.at(-1) !== nu) w3InBeeld.push(nu);
      return null;
    }
    await act(async () => { root.render(<Proef />); });
    await act(async () => { await data!.fetchLeave(); });
    wisselAccount = async () => {
      await act(async () => {
        ctx.clearLoadedCollections();
        data!.resetVerlof();
        account = 'b';
        root.render(<Proef />);
      });
    };
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

  it('een samengestelde lijst neemt de revisie niet over en ververst vóór een volledige opslag', async () => {
    const { los } = await lezingKruistBeslissing();
    const vers = uitgesteld();
    const exact = [aanvraag('w1'), aanvraag('w2'), aanvraag('w3')];
    // De server mag w3 intussen hebben teruggezet. Zelfs wanneer de revisie
    // nog echt geldt, past die niet bij de getoonde (samengestelde) lijst.
    await los({ body: exact, revisie: 'actueel-op-server' });
    expect(status('w3')).toBe('approved');
    expect(revisie()).toBe('na-patch');
    net.antwoord = (_url, method) => (method === 'GET' ? vers.belofte : { body: { success: true }, revisie: 'na-opslag' });
    let opslag!: Promise<boolean>;
    act(() => { opslag = data!.saveLeave(data!.leaveRequests); });
    expect(posts()).toHaveLength(0);
    expect(gets()).toHaveLength(2);
    expect(toon).toHaveBeenCalledWith('De verlofaanvragen worden ververst. Probeer je wijziging opnieuw.', 'info');
    await act(async () => {
      vers.los({ body: exact, revisie: 'actueel-op-server' });
      expect(await opslag).toBe(false);
    });
    expect(status('w3')).toBe('pending');
    expect(revisie()).toBe('actueel-op-server');
    await act(async () => { expect(await data!.saveLeave(data!.leaveRequests)).toBe(true); });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.revisie).toBe('actueel-op-server');
    expect(revisie()).toBe('na-opslag');
  });

  it('een opslag uit de vorige render mag haar samengestelde lijst niet sturen met de verse revisie', async () => {
    const voor = kopie();
    const { los } = await lezingKruistBeslissing();
    await los({ body: voor, revisie: 'oud' });
    const opslaanUitOudeRender = data!.saveLeave;
    const oudeLijst = data!.leaveRequests;
    net.antwoord = (_url, method) => (method === 'GET' ? { body: voor, revisie: 'vers' } : { body: { success: true } });
    await act(async () => {
      await data!.fetchLeave();
      expect(revisie()).toBe('vers');
      // React heeft de verse lijst nog niet getekend. De oude knop kan nog
      // de oude lijst aanbieden, hoewel de nieuwe revisie al bekend is.
      expect(data!.leaveRequests).toBe(oudeLijst);
      expect(await opslaanUitOudeRender(oudeLijst)).toBe(false);
    });
    expect(posts()).toHaveLength(0);
    expect(status('w3')).toBe('pending');
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

  it.each(['oud eerst', 'nieuw eerst'])('een jongere lezing mag een echte terugzetting tonen (%s), en bepaalt de revisie', async (volgorde) => {
    const oud = uitgesteld();
    const nieuw = uitgesteld();
    const wachtrij = [oud, nieuw];
    net.antwoord = (url, method) => (method === 'GET' ? wachtrij.shift()!.belofte : patch(url));
    let lezingOud!: Promise<void>;
    let lezingNieuw!: Promise<void>;
    act(() => { lezingOud = data!.fetchLeave(); });
    await act(async () => { await data!.decideLeave('w3', 'approved', 'pending'); });
    act(() => { lezingNieuw = data!.fetchLeave(); });
    const geefOud = () => act(async () => { oud.los({ body: [aanvraag('w3'), aanvraag('w4')], revisie: 'oud' }); await lezingOud; });
    const geefNieuw = () => act(async () => { nieuw.los({ body: [aanvraag('w3'), aanvraag('w5')], revisie: 'later' }); await lezingNieuw; });
    if (volgorde === 'oud eerst') {
      await geefOud();
      expect(status('w3')).toBe('approved');
      expect(status('w4')).toBe('pending');
      expect(revisie()).toBe('na-patch');
      await geefNieuw();
    } else {
      await geefNieuw();
      expect(status('w3')).toBe('pending');
      await geefOud();
    }
    expect(status('w3')).toBe('pending');
    expect(status('w4')).toBeUndefined();
    expect(status('w5')).toBe('pending');
    expect(w3InBeeld).toEqual(['pending', 'approved', 'pending']);
    expect(revisie()).toBe('later');
  });

  it.each([
    { status: 500, body: [aanvraag('w5')], revisie: 'fout' },
    { status: 200, body: [null], revisie: 'onbruikbaar' },
  ])('na een onbruikbare nieuwere lezing telt een oudere geldige lezing ($revisie)', async (antwoord) => {
    const oud = uitgesteld();
    const nieuw = uitgesteld();
    const wachtrij = [oud, nieuw];
    net.antwoord = (url, method) => (method === 'GET' ? wachtrij.shift()!.belofte : patch(url));
    let lezingOud!: Promise<void>;
    let lezingNieuw!: Promise<void>;
    act(() => { lezingOud = data!.fetchLeave(); });
    await act(async () => { await data!.decideLeave('w3', 'approved', 'pending'); });
    act(() => { lezingNieuw = data!.fetchLeave(); });
    await act(async () => { nieuw.los(antwoord); await lezingNieuw; });
    expect(status('w3')).toBe('approved');
    expect(status('w5')).toBeUndefined();
    expect(revisie()).toBe('na-patch');
    await act(async () => { oud.los({ body: [aanvraag('w3'), aanvraag('w4')], revisie: 'oud' }); await lezingOud; });
    expect(status('w3')).toBe('approved');
    expect(status('w4')).toBe('pending');
    expect(revisie()).toBe('na-patch');
  });

  it('een jongere cachelezing maakt een eerder gestarte verse lezing niet achterhaald', async () => {
    const vers = uitgesteld();
    net.antwoord = () => vers.belofte;
    let lezingVers!: Promise<void>;
    act(() => { lezingVers = data!.fetchLeave(); });
    net.antwoord = () => ({ body: [aanvraag('w3', 'rejected')], revisie: 'cache', uitCache: true });
    await act(async () => { await data!.fetchLeave(); });
    expect(status('w3')).toBe('rejected');
    expect(revisie()).toBe('cache');
    await act(async () => {
      vers.los({ body: [aanvraag('w3', 'approved')], revisie: 'vers' });
      await lezingVers;
    });
    expect(status('w3')).toBe('approved');
    expect(revisie()).toBe('vers');
  });

  it.each([200, 409, 500])('lezing en beslissing van vóór de accountwissel raken de nieuwe gebruiker niet (PATCH %i)', async (httpStatus) => {
    const lezingVanA = uitgesteld();
    const besluitVanA = uitgesteld();
    net.antwoord = (_url, method) => (method === 'GET' ? lezingVanA.belofte : besluitVanA.belofte);
    let lezing!: Promise<void>;
    let beslissing!: Promise<boolean>;
    act(() => {
      lezing = data!.fetchLeave();
      beslissing = data!.decideLeave('w3', 'approved', 'pending');
    });
    await wisselAccount();
    expect(revisie()).toBeUndefined();
    expect(data!.leaveRequests).toEqual([]);
    net.antwoord = () => ({ body: [aanvraag('w3'), aanvraag('wB')], revisie: 'b' });
    await act(async () => { await data!.fetchLeave(); });
    await act(async () => {
      lezingVanA.los({ body: [aanvraag('wA')], revisie: 'a-laat' });
      await lezing;
      besluitVanA.los({
        status: httpStatus,
        body: httpStatus === 200 ? { leave: aanvraag('w3', 'approved') } : { error: 'Fout van het vorige account' },
        revisie: 'a-besluit',
      });
      expect(await beslissing).toBe(false);
    });
    expect(data!.leaveRequests.map((r) => r.id)).toEqual(['w3', 'wB']);
    expect(status('w3')).toBe('pending');
    expect(revisie()).toBe('b');
    expect(gets()).toHaveLength(2);
    expect(toon).not.toHaveBeenCalled();
    expect(meldLaadfout).not.toHaveBeenCalled();
    expect(fetchActivityLog).not.toHaveBeenCalled();
    expect(refreshCoverageGaps).not.toHaveBeenCalled();
  });

  it('een ziekmelding die pas na de accountwissel antwoordt, start geen verversing en geeft geen melding', async () => {
    const meldingVanA = uitgesteld();
    net.antwoord = (_url, method) => (method === 'POST' ? meldingVanA.belofte : { body: [aanvraag('wB')], revisie: 'b' });
    let melding!: Promise<boolean>;
    act(() => { melding = data!.reportSick({ userId: 'a' }); });
    await wisselAccount();
    await act(async () => { await data!.fetchLeave(); });
    await act(async () => {
      meldingVanA.los({ body: { success: true } });
      expect(await melding).toBe(false);
    });
    expect(gets()).toHaveLength(1);
    expect(revisie()).toBe('b');
    expect(toon).not.toHaveBeenCalled();
    expect(refreshCoverageGaps).not.toHaveBeenCalled();
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
