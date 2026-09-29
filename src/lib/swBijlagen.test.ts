// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as pagina from './bijlageCache';

/**
 * public/sw-bijlagen.js is een klassiek script (importScripts in de service
 * worker). We laden het met een nep-`self`, precies zoals de SW dat doet, en
 * draaien daarnaast de échte handlers van public/sw.js met een nep-Cache
 * Storage en een nep-netwerk.
 */
type Entry = { sleutel: string; soort: string; versie: string };
type Api = {
  BIJLAGEN_CACHE: string;
  KOP_SOORT: string;
  KOP_VERSIE: string;
  KOP_GEBRUIKT: string;
  KOP_BYTES: string;
  bijlageSleutel: (url: string) => string | null;
  bijlageVersie: (b: { filename?: string; sizeBytes?: number; uploadedAt?: string; url?: string }) => string;
  teVerwijderen: (soort: string, entries: Entry[], lijst: unknown) => string[];
};

const bron = (naam: string) => readFileSync(resolve(__dirname, `../../public/${naam}`), 'utf8');
const laad = (): Api => {
  const self: Record<string, unknown> = {};
  new Function('self', bron('sw-bijlagen.js'))(self);
  return self.VHB_BIJLAGEN as Api;
};

const OPSLAG = 'https://x.supabase.co/storage/v1/object/sign';
const url = (bucket: string, bestand: string, token = 't') => `${OPSLAG}/${bucket}/${bestand}?token=${token}`;
const PLAN = { slot: 1, filename: 'plan.pdf', sizeBytes: 1200, url: url('diversions', 'o-1-1.pdf') };
const HALTES = { slot: 2, filename: 'haltes.pdf', sizeBytes: 800, url: url('diversions', 'o-1-2.pdf') };
const MEDEDELING = { slot: 1, filename: 'mededeling.pdf', sizeBytes: 500, url: url('update-bijlagen', 'u-1-1.pdf') };

describe('sw-bijlagen.js: sleutel en versie', () => {
  const api = laad();

  it('geeft dezelfde sleutel, versie, cachenaam en koppen als de pagina', () => {
    expect(api.BIJLAGEN_CACHE).toBe(pagina.BIJLAGEN_CACHE);
    expect([api.KOP_SOORT, api.KOP_VERSIE, api.KOP_GEBRUIKT, api.KOP_BYTES]).toEqual([pagina.KOP_SOORT, pagina.KOP_VERSIE, pagina.KOP_GEBRUIKT, pagina.KOP_BYTES]);
    const urls = [PLAN.url, MEDEDELING.url, 'https://x.test/a%20b.pdf?x=1#anker', 'geen url', ''];
    for (const u of urls) expect(api.bijlageSleutel(u)).toBe(pagina.bijlageSleutel(u));
    const bijlagen = [
      PLAN,
      { filename: 'omleiding.pdf' },
      { filename: 'Omleiding lijn 58 – halte Café “De Kroon”.pdf', sizeBytes: 0 },
      { filename: 'plan.pdf', sizeBytes: 1200, uploadedAt: '2026-09-29T08:00:00Z' },
    ];
    for (const b of bijlagen) expect(api.bijlageVersie(b)).toBe(pagina.bijlageVersie(b));
  });

  it('sleutelt zonder token en onderscheidt een vervanging van een heropening', () => {
    expect(api.bijlageSleutel(url('diversions', 'o-1-1.pdf', 'gisteren'))).toBe(api.bijlageSleutel(url('diversions', 'o-1-1.pdf', 'vandaag')));
    expect(api.bijlageVersie(PLAN)).toBe(api.bijlageVersie({ ...PLAN, url: url('diversions', 'o-1-1.pdf', 'ander-token') }));
    expect(api.bijlageVersie({ ...PLAN, sizeBytes: 1201 })).not.toBe(api.bijlageVersie(PLAN));
    expect(api.bijlageVersie({ ...PLAN, filename: 'plan-v2.pdf' })).not.toBe(api.bijlageVersie(PLAN));
  });
});

describe('sw-bijlagen.js: opruimregels', () => {
  const api = laad();
  const entry = (b: typeof PLAN, soort: string): Entry => ({ sleutel: api.bijlageSleutel(b.url)!, soort, versie: api.bijlageVersie(b) });
  const bewaard = [entry(PLAN, 'omleiding'), entry(HALTES, 'omleiding'), entry(MEDEDELING, 'update')];

  it('laat alles staan wat nog in de lijst staat, ook met een nieuw token', () => {
    const lijst = [{ id: 'o-1', bijlagen: [{ ...PLAN, url: url('diversions', 'o-1-1.pdf', 'nieuw') }, HALTES] }];
    expect(api.teVerwijderen('omleiding', bewaard, lijst)).toEqual([]);
  });

  it('record weg: de bijlagen van dat record gaan uit de cache', () => {
    expect(api.teVerwijderen('omleiding', bewaard, [{ id: 'o-2', bijlagen: [] }])).toEqual([entry(PLAN, 'omleiding').sleutel, entry(HALTES, 'omleiding').sleutel]);
    expect(api.teVerwijderen('omleiding', bewaard, [])).toHaveLength(2);
  });

  it('plaats weg: alleen de verwijderde bijlage gaat', () => {
    expect(api.teVerwijderen('omleiding', bewaard, [{ id: 'o-1', bijlagen: [PLAN] }])).toEqual([entry(HALTES, 'omleiding').sleutel]);
  });

  it('vervangen op dezelfde plaats: het oude bestand gaat', () => {
    const lijst = [{ id: 'o-1', bijlagen: [{ ...PLAN, filename: 'plan-nieuw.pdf', sizeBytes: 1350 }, HALTES] }];
    expect(api.teVerwijderen('omleiding', bewaard, lijst)).toEqual([entry(PLAN, 'omleiding').sleutel]);
  });

  it('een lijst omleidingen zegt niets over de bijlage van een update, en omgekeerd', () => {
    expect(api.teVerwijderen('omleiding', bewaard, [])).not.toContain(entry(MEDEDELING, 'update').sleutel);
    expect(api.teVerwijderen('update', bewaard, [])).toEqual([entry(MEDEDELING, 'update').sleutel]);
  });

  it('geen lijst (foutantwoord, onverwachte vorm) ruimt niets op', () => {
    for (const geenLijst of [null, undefined, { error: 'Gegevens laden is mislukt.' }, 'tekst', 42]) {
      expect(api.teVerwijderen('omleiding', bewaard, geenLijst)).toEqual([]);
    }
  });
});

/** De echte sw.js met een nep-Cache Storage waarin al bijlagen staan. */
function worker(netwerk: (req: Request) => Promise<Response>, extraCaches: string[] = []) {
  const api = laad();
  const opslag = new Map<string, Map<string, Response>>();
  const sleutel = (req: Request | string | { url: string }) => (typeof req === 'string' ? req : req.url);
  const open = async (naam: string) => {
    if (!opslag.has(naam)) opslag.set(naam, new Map());
    const inhoud = opslag.get(naam)!;
    return {
      match: async (req: Request | string) => inhoud.get(sleutel(req))?.clone(),
      put: async (req: Request | string, res: Response) => { inhoud.set(sleutel(req), res.clone()); },
      delete: async (req: Request | string) => inhoud.delete(sleutel(req)),
      keys: async () => [...inhoud.keys()].map((u) => ({ url: u })),
    };
  };
  const caches = {
    open,
    has: async (naam: string) => opslag.has(naam),
    keys: async () => [...opslag.keys()],
    delete: async (naam: string) => opslag.delete(naam),
    match: async () => undefined,
  };
  const bijlagen = new Map<string, Response>();
  for (const [b, soort] of [[PLAN, 'omleiding'], [HALTES, 'omleiding'], [MEDEDELING, 'update']] as const) {
    bijlagen.set(api.bijlageSleutel(b.url)!, new Response('%PDF-', { headers: { [api.KOP_SOORT]: soort, [api.KOP_VERSIE]: api.bijlageVersie(b) } }));
  }
  opslag.set(api.BIJLAGEN_CACHE, bijlagen);
  for (const naam of extraCaches) opslag.set(naam, new Map([['/', new Response('x')]]));

  type Gebeurtenis = { request?: Request; respondWith?: (p: Promise<Response>) => void; waitUntil: (p: Promise<unknown>) => void };
  const handlers = new Map<string, (event: Gebeurtenis) => void>();
  const self: Record<string, unknown> = {
    location: { origin: 'https://vhb.test' },
    clients: { claim: async () => undefined },
    addEventListener: (naam: string, handler: (event: Gebeurtenis) => void) => handlers.set(naam, handler),
  };
  new Function('self', bron('sw-ritbladen.js'))(self);
  new Function('self', bron('sw-bijlagen.js'))(self);
  new Function('self', 'importScripts', 'caches', 'fetch', bron('sw.js'))(self, () => {}, caches, netwerk);

  return {
    api,
    opslag,
    bewaard: () => [...(opslag.get(api.BIJLAGEN_CACHE)?.keys() ?? [])],
    /** Eén GET door de fetch-handler; wacht ook op wat de SW via waitUntil nog doet. */
    haal: async (pad: string) => {
      const wachten: Promise<unknown>[] = [];
      const antwoord = await new Promise<Response>((klaar, mis) => {
        handlers.get('fetch')!({ request: new Request(`https://vhb.test${pad}`), respondWith: (p) => p.then(klaar, mis), waitUntil: (p) => wachten.push(p) });
      });
      await Promise.all(wachten);
      return antwoord;
    },
    activeer: async () => {
      let klaar: Promise<unknown> = Promise.resolve();
      handlers.get('activate')!({ waitUntil: (p) => { klaar = p; } });
      await klaar;
    },
  };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('sw.js: bijlagen opruimen op een verse lijst', () => {
  it('ruimt op wat niet meer in de verse lijst van de server staat', async () => {
    const sw = worker(async () => json([{ id: 'o-1', bijlagen: [PLAN] }]));
    const res = await sw.haal('/api/diversions');
    // Het antwoord aan de app is het ongewijzigde antwoord van de server.
    expect(await res.json()).toEqual([{ id: 'o-1', bijlagen: [PLAN] }]);
    expect(sw.bewaard().sort()).toEqual([sw.api.bijlageSleutel(MEDEDELING.url), sw.api.bijlageSleutel(PLAN.url)].sort());
  });

  it('een vervangen bijlage gaat weg, een bijlage met alleen een nieuw token blijft', async () => {
    const sw = worker(async () => json([{ id: 'o-1', bijlagen: [{ ...PLAN, sizeBytes: 1350 }, { ...HALTES, url: url('diversions', 'o-1-2.pdf', 'nieuw') }] }]));
    await sw.haal('/api/diversions');
    expect(sw.bewaard()).not.toContain(sw.api.bijlageSleutel(PLAN.url));
    expect(sw.bewaard()).toContain(sw.api.bijlageSleutel(HALTES.url));
  });

  it('zonder bereik komt de lijst uit de cache en blijft elke bijlage staan', async () => {
    const sw = worker(async () => { throw new TypeError('offline'); });
    // Een oudere, lege lijst in de cache van de SW: die mag nooit opruimen.
    sw.opslag.set('vhb-ritbladen', new Map([['https://vhb.test/api/diversions', json([])]]));
    const res = await sw.haal('/api/diversions');
    expect(res.headers.get('X-VHB-Bron')).toBe('cache');
    expect(sw.bewaard()).toHaveLength(3);
  });

  it.each([401, 403, 500, 503])('een mislukte ophaling (HTTP %s) ruimt niets op', async (status) => {
    const sw = worker(async () => json({ error: 'Gegevens laden is mislukt.' }, status));
    expect((await sw.haal('/api/diversions')).status).toBe(status);
    expect(sw.bewaard()).toHaveLength(3);
  });

  it('een geslaagd antwoord dat geen lijst is ruimt niets op', async () => {
    const sw = worker(async () => json({ error: 'onverwacht' }));
    await sw.haal('/api/updates');
    expect(sw.bewaard()).toHaveLength(3);
  });

  it('de lijst updates raakt alleen de bijlagen van updates', async () => {
    const sw = worker(async () => json([]));
    await sw.haal('/api/updates');
    expect(sw.bewaard().sort()).toEqual([sw.api.bijlageSleutel(PLAN.url), sw.api.bijlageSleutel(HALTES.url)].sort());
  });

  it('andere API-paden en een gefilterde lijst ruimen niets op', async () => {
    const netwerk = vi.fn(async () => json([]));
    const sw = worker(netwerk);
    await sw.haal('/api/users');
    await sw.haal('/api/diversions?lijn=58');
    expect(netwerk).toHaveBeenCalledTimes(2);
    expect(sw.bewaard()).toHaveLength(3);
  });
});

describe('sw.js: activate en de bijlagen-cache', () => {
  it('een deploy laat de bijlagen staan en gooit een cache met een ouder versienummer weg', async () => {
    const sw = worker(async () => json([]), ['vhb-portaal-vorige-build', 'vhb-bijlagen-v0', 'vhb-ritbladen']);
    // De nieuwe versie heeft haar shell: pas dan ruimt activate op.
    expect([...sw.opslag.keys()]).toContain('vhb-bijlagen-v0');
    sw.opslag.set('vhb-portaal-__VHB_BUILD_ID__', new Map([['/', new Response('shell')]]));
    await sw.activeer();
    const over = [...sw.opslag.keys()].sort();
    expect(over).toEqual(['vhb-bijlagen-v1', 'vhb-portaal-__VHB_BUILD_ID__', 'vhb-ritbladen']);
    expect(sw.bewaard()).toHaveLength(3);
  });
});
