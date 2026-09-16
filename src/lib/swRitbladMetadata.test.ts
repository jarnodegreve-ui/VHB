// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const META_URL = 'https://vhb.test/api/ritblaadje';
const oudeMeta = { filename: 'bundel.pdf', url: 'https://storage.test/ritblaadjes/bundel.pdf?token=verlopen' };
const verseMeta = { ...oudeMeta, url: 'https://storage.test/ritblaadjes/bundel.pdf?token=vers' };
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

/** Voer de echte fetch-handler uit met een geïsoleerde Cache Storage en
 *  netwerk. Zo controleren we de SW-strategie, ook zonder no-store van de
 *  aanroeper en zonder de browsercache tussen tests te delen. */
function worker(netwerk: (req: Request) => Promise<Response>, gecachet = true) {
  const opgeslagen = new Map<string, Response>(gecachet ? [[META_URL, json(oudeMeta)]] : []);
  const sleutel = (req: Request | string) => typeof req === 'string' ? req : req.url;
  const cache = {
    match: async (req: Request | string) => opgeslagen.get(sleutel(req))?.clone(),
    put: async (req: Request | string, res: Response) => { opgeslagen.set(sleutel(req), res.clone()); },
  };
  type FetchEvent = { request: Request; respondWith: (p: Promise<Response>) => void };
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const self = {
    location: { origin: 'https://vhb.test' },
    addEventListener: (naam: string, handler: (event: FetchEvent) => void) => handlers.set(naam, handler),
  };
  const helpers = readFileSync(resolve(__dirname, '../../public/sw-ritbladen.js'), 'utf8');
  const bron = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
  new Function('self', helpers)(self);
  new Function('self', 'importScripts', 'caches', 'fetch', bron)(self, () => {}, { open: async () => cache }, netwerk);
  return {
    cache,
    haal: () => new Promise<Response>((resolve) => {
      handlers.get('fetch')!({ request: new Request(META_URL), respondWith: (p) => resolve(p) });
    }),
  };
}

describe('ritblad-metadata door de service worker', () => {
  it('wacht online op een verse PDF-link, ook als een verlopen link in de cache staat', async () => {
    let antwoord!: (res: Response) => void;
    const netwerk = vi.fn(() => new Promise<Response>((resolve) => { antwoord = resolve; }));
    const sw = worker(netwerk);
    const ontvangen = vi.fn();
    const resultaat = sw.haal().then(async (res) => { ontvangen(await res.json()); });
    // De oude SW leverde hier meteen oudeMeta en vernieuwde alleen de cache.
    await new Promise((resolve) => setImmediate(resolve));
    expect(ontvangen).not.toHaveBeenCalled();
    antwoord(json(verseMeta));
    await resultaat;
    expect(ontvangen).toHaveBeenCalledWith(verseMeta);
    expect(await (await sw.cache.match(META_URL))?.json()).toEqual(verseMeta);
  });

  it('behoudt offline metadata voor de opgeslagen PDF en markeert deze als cache', async () => {
    const sw = worker(async () => { throw new TypeError('offline'); });
    const res = await sw.haal();
    expect(res.ok).toBe(true);
    expect(res.headers.get('X-VHB-Bron')).toBe('cache');
    expect(await res.json()).toEqual(oudeMeta);
  });

  it.each([401, 403, 500])('verbergt HTTP %s niet achter een gecachte succesrespons', async (status) => {
    const sw = worker(async () => new Response('Niet beschikbaar', { status }));
    expect((await sw.haal()).status).toBe(status);
    expect(await (await sw.cache.match(META_URL))?.json()).toEqual(oudeMeta);
  });

  it('geeft zonder netwerk of opgeslagen metadata een netwerkfout terug', async () => {
    const sw = worker(async () => { throw new TypeError('offline'); }, false);
    expect((await sw.haal()).type).toBe('error');
  });
});
