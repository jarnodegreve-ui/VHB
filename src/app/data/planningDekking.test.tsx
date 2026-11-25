import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * De dekking van het dashboard en haar grens komen uit één antwoord (24-11,
 * tegenlezing dekking-grens): `dekkingTot` is `planningTot` van hetzelfde
 * /api/coverage-gaps-antwoord als `coverageDays`, nooit x-planning-tot van
 * /api/planning (een ander verzoek op een ander moment; daar kon de grens
 * ontbreken of ouder zijn terwijl de dagen al afgekapt waren).
 */
const net = vi.hoisted(() => ({
  dekking: [] as Array<unknown>,
  planningTot: null as string | null,
}));

vi.mock('../../lib/coverage', () => ({
  fetchCoverageGaps: async () => {
    const volgende = net.dekking.shift();
    if (volgende instanceof Error) throw volgende;
    return volgende;
  },
}));
vi.mock('../../lib/api', () => ({
  apiFetch: async () => new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json', ...(net.planningTot ? { 'x-planning-tot': net.planningTot } : {}) },
  }),
  apiLijst: async () => ({ response: new Response('[]'), data: [] }),
}));
vi.mock('../../lib/tik', () => ({ tik: () => {} }));
vi.mock('../router', () => ({ navigeer: () => {} }));

const { useDataKern } = await import('./kern');
const { usePlanningData } = await import('./planning');

const dag = (date: string, missing: string[] = []) => ({ date, dayType: 'schooldag', expected: 2, covered: 2 - missing.length, missing, unknown: [] });

describe('de dekking van het dashboard en haar grens', () => {
  let root: Root;
  let el: HTMLDivElement;
  let data: ReturnType<typeof usePlanningData> | null;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    data = null;
    net.dekking = [];
    net.planningTot = null;
    function Proef() {
      const ctx = useDataKern({
        session: null,
        currentUser: { id: 'u-admin', role: 'admin' },
        dataKlaar: true,
        showToast: () => {},
        meldLaadfout: () => {},
        fetchActivityLog: async () => {},
      } as unknown as Parameters<typeof useDataKern>[0]);
      data = usePlanningData(ctx);
      return null;
    }
    await act(async () => { root.render(<Proef />); });
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  });

  it('dagen en grens komen samen binnen; een volgend antwoord met dezelfde dagen en een andere grens zet de grens bij', async () => {
    expect(data!.coverageDays).toBeNull();
    expect(data!.dekkingTot).toBeNull();
    net.dekking = [
      { from: '2026-12-30', to: '2027-01-05', planningTot: '2027-01-03', days: [dag('2026-12-30'), dag('2026-12-31', ['2607'])] },
      { from: '2026-12-30', to: '2027-01-05', planningTot: '2027-01-31', days: [dag('2026-12-30'), dag('2026-12-31', ['2607'])] },
    ];
    await act(async () => { await data!.refreshCoverageGaps(); });
    expect(data!.coverageDays?.map((d) => d.date)).toEqual(['2026-12-30', '2026-12-31']);
    expect(data!.dekkingTot).toBe('2027-01-03');
    await act(async () => { await data!.refreshCoverageGaps(); });
    expect(data!.dekkingTot).toBe('2027-01-31');
  });

  it('zonder geldige grens in het antwoord: null (niet afgekapt), ook als x-planning-tot er wel is', async () => {
    net.planningTot = '2027-01-03';
    await act(async () => { await data!.fetchPlanning(); });
    expect(data!.planningTot).toBe('2027-01-03');
    expect(data!.dekkingTot).toBeNull();
    net.dekking = [
      { from: '2026-12-30', to: '2027-01-05', planningTot: null, days: [dag('2026-12-30')] },
      { from: '2026-12-30', to: '2027-01-05', planningTot: '03/01/2027', days: [dag('2026-12-30')] },
    ];
    await act(async () => { await data!.refreshCoverageGaps(); });
    expect(data!.dekkingTot).toBeNull();
    await act(async () => { await data!.refreshCoverageGaps(); });
    expect(data!.dekkingTot).toBeNull();
  });

  it('een mislukte verversing houdt dagen en grens van het vorige antwoord samen', async () => {
    net.dekking = [
      { from: '2026-12-30', to: '2027-01-05', planningTot: '2027-01-03', days: [dag('2026-12-30')] },
      new Error('netwerk'),
    ];
    await act(async () => { await data!.refreshCoverageGaps(); });
    await act(async () => { await data!.refreshCoverageGaps(); });
    expect(data!.coverageDays?.map((d) => d.date)).toEqual(['2026-12-30']);
    expect(data!.dekkingTot).toBe('2027-01-03');
  });
});
