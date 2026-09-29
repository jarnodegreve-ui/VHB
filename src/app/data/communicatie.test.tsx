import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Diversion, Update } from '../../types';

/**
 * "Ongedaan maken" na het verwijderen van een omleiding of update (controle-
 * ronde 29-09, nr. 12): het herstel stuurt het record mét zijn bijlagen en de
 * herstel-header, en de toast zegt eerlijk wat er terugkwam. De server is
 * hier een nep-API die bijhoudt wat ze ontving.
 *
 * Het herstel zelf (src/lib/herstel.ts) zit niet in de startbundel: het laadt
 * pas bij de klik op "Ongedaan maken". Wat er gebeurt als dat laden mislukt
 * staat in communicatieHerstelFaalt.test.tsx.
 */
const net = vi.hoisted(() => ({
  // Hoe vaak de herstelmodule echt geladen is (de fabriek loopt één keer).
  herstelGeladen: 0,
  verzoeken: [] as Array<{ url: string; method: string; headers: Record<string, string>; body: any }>,
  antwoord: (_url: string, _method: string, _body: any): { status?: number; body: unknown } => ({ body: {} }),
}));

vi.mock('../../lib/api', () => ({
  apiFetch: async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    net.verzoeken.push({ url, method, headers: init.headers ?? {}, body });
    const { status = 200, body: uit } = net.antwoord(url, method, body);
    return new Response(JSON.stringify(uit), { status, headers: { 'content-type': 'application/json' } });
  },
}));
vi.mock('../../lib/tik', () => ({ tik: () => {} }));
vi.mock('../../lib/herstel', async (importOriginal) => {
  net.herstelGeladen += 1;
  return importOriginal<typeof import('../../lib/herstel')>();
});

const { useDataKern } = await import('./kern');
const { useCommunicatieData } = await import('./communicatie');

type Toast = { tekst: string; toon?: string; actie?: { label: string; run: () => void } };

const omleiding: Diversion = {
  id: 'o-1', line: '12', title: 'Werken N70', description: 'Omrijden', startDate: '2026-09-01',
  bijlagen: [
    { slot: 1, filename: 'plan.pdf', sizeBytes: 10, url: 'https://opslag.test/o-1-1.pdf?sig=oud' },
    { slot: 2, filename: 'haltes.pdf', sizeBytes: 20, url: 'https://opslag.test/o-1-2.pdf?sig=oud' },
  ],
};
const update: Update = {
  id: 'u-1', date: '01/09/2026', title: 'Nieuwe halte', content: 'Vanaf maandag',
  bijlagen: [{ slot: 1, filename: 'mededeling.pdf', sizeBytes: 10, url: 'https://opslag.test/u-1-1.pdf?sig=oud' }],
} as Update;

describe('ongedaan maken van een verwijderde omleiding of update', () => {
  let root: Root;
  let el: HTMLDivElement;
  let toasts: Toast[];
  let data: ReturnType<typeof useCommunicatieData> | null;

  beforeEach(async () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    toasts = [];
    data = null;
    net.verzoeken = [];
    net.antwoord = (url, method) => {
      if (method === 'GET' && url === '/api/diversions') return { body: [{ ...omleiding, _rev: 'rev-o1' }] };
      if (method === 'GET' && url === '/api/updates') return { body: [{ ...update, _rev: 'rev-u1' }] };
      return { body: { success: true } };
    };
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
  });

  /** Klikt op "Ongedaan maken" en wacht tot het herstel zijn melding gaf en
   *  de lijst ververst is (het herstel laadt eerst zijn module). */
  const klikOngedaan = async () => {
    const metKnop = toasts.find((t) => t.actie);
    expect(metKnop?.actie?.label).toBe('Ongedaan maken');
    const voor = toasts.length;
    await act(async () => {
      metKnop!.actie!.run();
      await vi.waitFor(() => {
        expect(toasts.length).toBeGreaterThan(voor);
        expect(net.verzoeken.at(-1)?.method).toBe('GET');
      });
    });
  };

  it('verwijderen toont de toast meteen en wacht niet op de herstelmodule: die laadt pas bij de klik', async () => {
    const geladenVoor = net.herstelGeladen;
    await act(async () => { await data!.deleteDiversion('o-1'); });
    // De toast met de knop staat er zodra de verwijdering gelukt is.
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tekst: 'Omleiding ‘Werken N70’ verwijderd.', toon: 'success' });
    expect(toasts[0].actie?.label).toBe('Ongedaan maken');
    expect(net.verzoeken.map((v) => `${v.method} ${v.url}`)).toEqual(['DELETE /api/diversions/o-1']);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(net.herstelGeladen).toBe(geladenVoor);

    net.antwoord = (url, method, body) => {
      if (method === 'POST' && url === '/api/diversions/one') return { status: 201, body: { success: true, diversion: { ...body, _rev: 'rev-nieuw' } } };
      if (method === 'GET' && url === '/api/diversions') return { body: [{ ...omleiding, _rev: 'rev-nieuw' }] };
      return { body: {} };
    };
    await klikOngedaan();
    // De fabriek van de module loopt één keer per testbestand.
    expect(net.herstelGeladen).toBe(1);
    expect(toasts.at(-1)).toMatchObject({ tekst: 'Omleiding hersteld.', toon: 'success' });
  });

  it('omleiding: post het record met de herstel-header en meldt gewoon "hersteld" als alle PDF’s terug zijn', async () => {
    await act(async () => { await data!.deleteDiversion('o-1'); });
    expect(net.verzoeken.map((v) => `${v.method} ${v.url}`)).toEqual(['DELETE /api/diversions/o-1']);
    expect(data!.diversions).toEqual([]);

    net.antwoord = (url, method, body) => {
      if (method === 'POST' && url === '/api/diversions/one') return { status: 201, body: { success: true, diversion: { ...body, _rev: 'rev-nieuw' } } };
      if (method === 'GET' && url === '/api/diversions') return { body: [{ ...omleiding, _rev: 'rev-nieuw' }] };
      return { body: {} };
    };
    await klikOngedaan();

    const post = net.verzoeken.find((v) => v.method === 'POST');
    expect(post?.url).toBe('/api/diversions/one');
    expect(post?.headers['X-Herstel']).toBe('1');
    expect(post?.body.bijlagen.map((b: { slot: number }) => b.slot)).toEqual([1, 2]);
    expect(toasts.at(-1)).toMatchObject({ tekst: 'Omleiding hersteld.', toon: 'success' });
    expect(data!.diversions.map((d) => d.id)).toEqual(['o-1']);
  });

  it('omleiding: zegt eerlijk hoeveel PDF’s niet mee terugkwamen', async () => {
    await act(async () => { await data!.deleteDiversion('o-1'); });
    const zonderTweede = { ...omleiding, bijlagen: [omleiding.bijlagen![0]] };
    net.antwoord = (url, method) => {
      if (method === 'POST' && url === '/api/diversions/one') return { status: 201, body: { success: true, diversion: { ...zonderTweede, _rev: 'rev-nieuw' } } };
      if (method === 'GET' && url === '/api/diversions') return { body: [{ ...zonderTweede, _rev: 'rev-nieuw' }] };
      return { body: {} };
    };
    await klikOngedaan();
    expect(toasts.at(-1)).toMatchObject({ tekst: 'Omleiding hersteld, maar 1 van de 2 PDF’s kwam niet mee terug. Voeg hem opnieuw toe.', toon: 'info' });
  });

  it('update: zegt eerlijk dat de PDF niet mee terugkwam', async () => {
    await act(async () => { await data!.deleteUpdate('u-1'); });
    const { bijlagen: _weg, ...zonder } = update;
    net.antwoord = (url, method) => {
      if (method === 'POST' && url === '/api/updates/one') return { status: 201, body: { success: true, update: { ...zonder, _rev: 'rev-nieuw' } } };
      if (method === 'GET' && url === '/api/updates') return { body: [{ ...zonder, _rev: 'rev-nieuw' }] };
      return { body: {} };
    };
    await klikOngedaan();
    const post = net.verzoeken.find((v) => v.method === 'POST');
    expect(post?.headers['X-Herstel']).toBe('1');
    expect(post?.body.bijlagen).toHaveLength(1);
    expect(toasts.at(-1)).toMatchObject({ tekst: 'Update hersteld, maar de PDF kwam niet mee terug. Voeg hem opnieuw toe.', toon: 'info' });
  });

  it('update: alles terug geeft de gewone melding', async () => {
    await act(async () => { await data!.deleteUpdate('u-1'); });
    net.antwoord = (url, method, body) => {
      if (method === 'POST' && url === '/api/updates/one') return { status: 201, body: { success: true, update: { ...body, _rev: 'rev-nieuw' } } };
      if (method === 'GET' && url === '/api/updates') return { body: [{ ...update, _rev: 'rev-nieuw' }] };
      return { body: {} };
    };
    await klikOngedaan();
    expect(toasts.at(-1)).toMatchObject({ tekst: 'Update hersteld.', toon: 'success' });
  });

  it('mislukt de post van het herstel, dan komt er geen "hersteld" en ververst de lijst', async () => {
    await act(async () => { await data!.deleteDiversion('o-1'); });
    net.antwoord = (url, method) => {
      if (method === 'POST' && url === '/api/diversions/one') return { status: 409, body: { error: 'Er bestaat al een omleiding met dit id.', conflict: 'exists' } };
      if (method === 'GET' && url === '/api/diversions') return { body: [] };
      return { body: {} };
    };
    await klikOngedaan();
    expect(toasts.some((t) => /hersteld/.test(t.tekst))).toBe(false);
    expect(toasts.at(-1)).toMatchObject({ tekst: 'Er bestaat al een omleiding met dit id.', toon: 'info' });
    expect(data!.diversions).toEqual([]);
  });
});
