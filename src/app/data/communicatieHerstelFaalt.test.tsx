import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Diversion, Update } from '../../types';

/**
 * Het herstel na "Ongedaan maken" zit niet in de startbundel
 * (src/lib/herstel.ts, geladen bij de klik). Hier mislukt dat laden
 * altijd, zoals offline of vlak na een nieuwe release: de gebruiker krijgt
 * een nette melding, er wordt niets gepost en het record blijft verwijderd,
 * nooit half hersteld. De gewone weg staat in communicatie.test.tsx.
 */
const net = vi.hoisted(() => ({
  laadpogingen: 0,
  verzoeken: [] as Array<{ url: string; method: string }>,
}));

vi.mock('../../lib/herstel', () => {
  net.laadpogingen += 1;
  throw new TypeError('Failed to fetch dynamically imported module');
});
vi.mock('../../lib/api', () => ({
  apiFetch: async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    net.verzoeken.push({ url, method });
    const body = method === 'GET' && url === '/api/diversions' ? [{ ...omleiding, _rev: 'rev-o1' }]
      : method === 'GET' && url === '/api/updates' ? [{ ...update, _rev: 'rev-u1' }]
        : { success: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  },
}));
vi.mock('../../lib/tik', () => ({ tik: () => {} }));

const omleiding: Diversion = {
  id: 'o-1', line: '12', title: 'Werken N70', description: 'Omrijden', startDate: '2026-09-01',
  bijlagen: [{ slot: 1, filename: 'plan.pdf', sizeBytes: 10, url: 'https://opslag.test/o-1-1.pdf?sig=oud' }],
};
const update = { id: 'u-1', date: '01/09/2026', title: 'Nieuwe halte', content: 'Vanaf maandag' } as Update;

const { useDataKern } = await import('./kern');
const { useCommunicatieData } = await import('./communicatie');

type Toast = { tekst: string; toon?: string; actie?: { label: string; run: () => void } };

describe('ongedaan maken als de herstelmodule niet te laden is', () => {
  let root: Root;
  let el: HTMLDivElement;
  let toasts: Toast[];
  let data: ReturnType<typeof useCommunicatieData> | null;
  let stil: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stil = vi.spyOn(console, 'error').mockImplementation(() => {});
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    toasts = [];
    data = null;
    function Proef() {
      const ctx = useDataKern({
        session: null,
        currentUser: null,
        showToast: (tekst: string, toon?: string, actie?: Toast['actie']) => { toasts.push({ tekst, toon, actie }); },
        meldLaadfout: () => {},
        fetchActivityLog: async () => {},
      } as unknown as Parameters<typeof useDataKern>[0]);
      data = useCommunicatieData({ ...ctx, users: [] });
      return null;
    }
    await act(async () => { root.render(<Proef />); });
    await act(async () => { await data!.fetchDiversions(); await data!.fetchUpdates(); });
    net.verzoeken = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    stil.mockRestore();
  });

  const klikOngedaan = async () => {
    const metKnop = toasts.find((t) => t.actie);
    expect(metKnop?.actie?.label).toBe('Ongedaan maken');
    const voor = toasts.length;
    await act(async () => {
      metKnop!.actie!.run();
      await vi.waitFor(() => expect(toasts.length).toBeGreaterThan(voor));
    });
  };

  it('het verwijderen zelf hangt niet van de module af: de toast met de knop verschijnt gewoon', async () => {
    let gelukt = false;
    await act(async () => { gelukt = await data!.deleteDiversion('o-1'); });
    expect(gelukt).toBe(true);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tekst: 'Omleiding ‘Werken N70’ verwijderd.', toon: 'success' });
    expect(data!.diversions).toEqual([]);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(toasts).toHaveLength(1);
    expect(net.laadpogingen).toBe(0);
  });

  it('omleiding: de klik geeft een nette foutmelding, post niets en laat het record verwijderd', async () => {
    await act(async () => { await data!.deleteDiversion('o-1'); });
    await klikOngedaan();
    expect(toasts).toHaveLength(2);
    expect(toasts[1].toon).toBe('error');
    expect(toasts[1].tekst).toMatch(/^Ongedaan maken is mislukt\. /);
    // Een vervolgstap, geen technische tekst.
    expect(toasts[1].tekst).toMatch(/probeer het (zo )?opnieuw/i);
    expect(toasts[1].tekst).not.toMatch(/module|import|vitest|TypeError/i);
    // Niets half hersteld: geen POST, geen record terug in de lijst.
    expect(net.verzoeken.map((v) => `${v.method} ${v.url}`)).toEqual(['DELETE /api/diversions/o-1']);
    expect(data!.diversions).toEqual([]);
    expect(net.laadpogingen).toBeGreaterThan(0);
  });

  it('update: zelfde gedrag', async () => {
    await act(async () => { await data!.deleteUpdate('u-1'); });
    await klikOngedaan();
    expect(toasts.at(-1)?.toon).toBe('error');
    expect(toasts.at(-1)?.tekst).toMatch(/^Ongedaan maken is mislukt\. /);
    expect(net.verzoeken.map((v) => `${v.method} ${v.url}`)).toEqual(['DELETE /api/updates/u-1']);
    expect(data!.updates).toEqual([]);
  });
});
