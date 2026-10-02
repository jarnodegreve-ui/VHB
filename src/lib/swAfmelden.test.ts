// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Afmelden in de service worker (public/sw.js, bericht 'wis-prive'): de
 * privé-caches gaan weg, de schil blijft, en een API-antwoord dat pas na het
 * bericht binnenkomt (een traag verzoek van de vorige gebruiker) wordt niet
 * meer bewaard. De echte handlers, met een nep-Cache Storage en nep-netwerk.
 */
const ME = 'https://vhb.test/api/me';
const MELDINGEN = 'https://vhb.test/api/meldingen';
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const tik = () => new Promise((klaar) => setImmediate(klaar));

function worker() {
  const opslag = new Map<string, Map<string, Response>>();
  const sleutel = (req: Request | string) => (typeof req === 'string' ? req : req.url);
  const caches = {
    open: async (naam: string) => {
      if (!opslag.has(naam)) opslag.set(naam, new Map());
      const inhoud = opslag.get(naam)!;
      return {
        match: async (req: Request | string) => inhoud.get(sleutel(req))?.clone(),
        put: async (req: Request | string, res: Response) => { inhoud.set(sleutel(req), res.clone()); },
        keys: async () => [...inhoud.keys()].map((url) => ({ url })),
        delete: async (req: Request | string) => inhoud.delete(sleutel(req)),
      };
    },
    has: async (naam: string) => opslag.has(naam),
    keys: async () => [...opslag.keys()],
    delete: async (naam: string) => opslag.delete(naam),
  };
  const wachtend = new Map<string, (res: Response) => void>();
  const netwerk = (req: Request) => new Promise<Response>((los) => { wachtend.set(req.url, los); });

  type Handler = (event: Record<string, unknown>) => void;
  const handlers = new Map<string, Handler>();
  const self = {
    location: { origin: 'https://vhb.test' },
    addEventListener: (naam: string, handler: Handler) => handlers.set(naam, handler),
  };
  for (const helper of ['sw-ritbladen.js', 'sw-bijlagen.js']) {
    new Function('self', readFileSync(resolve(__dirname, '../../public', helper), 'utf8'))(self);
  }
  new Function('self', 'importScripts', 'caches', 'fetch', readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8'))(self, () => {}, caches, netwerk);

  return {
    opslag,
    /** Start een GET door de fetch-handler; het antwoord komt met `antwoord`. */
    haal: (url: string) => new Promise<Response>((los) => {
      handlers.get('fetch')!({ request: new Request(url), respondWith: (p: Promise<Response>) => los(p), waitUntil: () => {} });
    }),
    antwoord: (url: string, data: unknown) => wachtend.get(url)!(json(data)),
    bericht: async (data: unknown) => {
      const klaar: Promise<unknown>[] = [];
      handlers.get('message')!({ data, waitUntil: (p: Promise<unknown>) => klaar.push(p) });
      await Promise.all(klaar);
    },
    bewaard: (naam: string) => [...(opslag.get(naam)?.keys() ?? [])],
  };
}

describe('service worker: afmelden (wis-prive)', () => {
  it('zonder afmelding bewaart hij het antwoord, zoals altijd', async () => {
    const sw = worker();
    const res = sw.haal(ME);
    await tik();
    sw.antwoord(ME, { id: '42' });
    expect(await (await res).json()).toEqual({ id: '42' });
    await tik();
    expect(sw.bewaard('vhb-ritbladen')).toEqual([ME]);
  });

  it('wist de privé-caches en laat de schil staan', async () => {
    const sw = worker();
    sw.opslag.set('vhb-ritbladen', new Map([[ME, json({ id: '42' })]]));
    sw.opslag.set('vhb-bijlagen-v1', new Map([['https://x/plan.pdf', new Response('pdf')]]));
    sw.opslag.set('vhb-portaal-__VHB_BUILD_ID__', new Map([['https://vhb.test/', new Response('schil')]]));
    await sw.bericht({ type: 'wis-prive' });
    expect([...sw.opslag.keys()]).toEqual(['vhb-portaal-__VHB_BUILD_ID__']);
  });

  it('een antwoord dat na de afmelding binnenkomt, gaat niet meer in de cache', async () => {
    const sw = worker();
    // De vorige gebruiker: profiel en meldingen zijn nog onderweg.
    const profiel = sw.haal(ME);
    const meldingen = sw.haal(MELDINGEN);
    await tik();
    await sw.bericht({ type: 'wis-prive' });
    sw.antwoord(ME, { id: '42', name: 'Vorige gebruiker' });
    sw.antwoord(MELDINGEN, { meldingen: [{ id: 'a1' }], ongelezen: 1 });
    // Het antwoord zelf gaat nog naar wie het vroeg; de cache blijft leeg.
    expect((await (await profiel).json()).name).toBe('Vorige gebruiker');
    await meldingen;
    await tik();
    expect(sw.bewaard('vhb-ritbladen')).toEqual([]);
    expect(await sw.opslag.has('vhb-ritbladen')).toBe(false);
  });

  it('wie zich daarna aanmeldt, krijgt zijn eigen antwoorden wel bewaard', async () => {
    const sw = worker();
    const oud = sw.haal(MELDINGEN);
    await tik();
    await sw.bericht({ type: 'wis-prive' });
    const nieuw = sw.haal(ME);
    await tik();
    sw.antwoord(ME, { id: '43', name: 'Volgende gebruiker' });
    await nieuw;
    await tik();
    sw.antwoord(MELDINGEN, { meldingen: [{ id: 'a1' }], ongelezen: 1 });
    await oud;
    await tik();
    expect(sw.bewaard('vhb-ritbladen')).toEqual([ME]);
    const cache = sw.opslag.get('vhb-ritbladen')!;
    expect(await cache.get(ME)!.clone().json()).toEqual({ id: '43', name: 'Volgende gebruiker' });
  });
});
