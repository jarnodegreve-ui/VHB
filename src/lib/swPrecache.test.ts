// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Precache van een nieuwe SW-versie (ronde 3, 19-09): gehashte assets waarvan
 * de bestandsnaam ongewijzigd is, komen uit de oude cache i.p.v. het netwerk.
 * Draait de échte install-handler van public/sw.js met een nep-Cache Storage
 * (meerdere caches, `caches.match` zoekt over allemaal) en een nep-netwerk.
 */
const OUD = 'vhb-portaal-oud';
const js = (body: string) => new Response(body, { headers: { 'content-type': 'text/javascript' } });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

const SHELL = `<!doctype html><script type="module" src="/assets/index-NIEUW123.js"></script>
<link rel="modulepreload" href="/assets/react-vendor-AAAA1111.js">
<link rel="modulepreload" href="/assets/ui-vendor-BBBB2222.js">
<link rel="stylesheet" href="/assets/index-CCCC3333.css">`;

function installeer(oudeCache: Record<string, Response>, netwerk: (pad: string) => Response) {
  const opslag = new Map<string, Map<string, Response>>([[OUD, new Map(Object.entries(oudeCache))]]);
  const sleutel = (req: Request | string) => (typeof req === 'string' ? req : new URL(req.url).pathname);
  const open = async (naam: string) => {
    if (!opslag.has(naam)) opslag.set(naam, new Map());
    const inhoud = opslag.get(naam)!;
    return {
      match: async (req: Request | string) => inhoud.get(sleutel(req))?.clone(),
      put: async (req: Request | string, res: Response) => { inhoud.set(sleutel(req), res.clone()); },
    };
  };
  const caches = {
    open,
    match: async (req: Request | string) => {
      for (const inhoud of opslag.values()) {
        const hit = inhoud.get(sleutel(req));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    keys: async () => [...opslag.keys()],
    delete: async (naam: string) => opslag.delete(naam),
  };
  const opgehaald: string[] = [];
  const fetch = vi.fn(async (req: Request | string) => {
    const pad = typeof req === 'string' ? req : new URL(req.url, 'https://vhb.test').pathname;
    opgehaald.push(pad);
    return netwerk(pad);
  });
  type InstallEvent = { waitUntil: (p: Promise<unknown>) => void };
  const handlers = new Map<string, (event: InstallEvent) => void>();
  const self: Record<string, unknown> = {
    location: { origin: 'https://vhb.test' },
    addEventListener: (naam: string, handler: (event: InstallEvent) => void) => handlers.set(naam, handler),
  };
  const helpers = readFileSync(resolve(__dirname, '../../public/sw-ritbladen.js'), 'utf8');
  const bron = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
  // Request met een relatief pad bestaat in node niet: een minimale stand-in.
  class NepRequest { url: string; constructor(pad: string) { this.url = new URL(pad, 'https://vhb.test').href; } }
  new Function('self', helpers)(self);
  new Function('self', 'importScripts', 'caches', 'fetch', 'Request', bron)(self, () => {}, caches, fetch, NepRequest);
  let klaar: Promise<unknown> = Promise.resolve();
  handlers.get('install')!({ waitUntil: (p) => { klaar = p; } });
  const nieuweCache = () => [...opslag.entries()].find(([naam]) => naam !== OUD)?.[1] ?? new Map<string, Response>();
  return { klaar: () => klaar, opgehaald, nieuweCache };
}

const netwerk = (pad: string) => (pad === '/' ? html(SHELL) : js(`vers:${pad}`));

describe('sw.js precache: ongewijzigde gehashte assets uit de oude cache', () => {
  it('kopieert vendor-chunks met dezelfde bestandsnaam en downloadt alleen wat nieuw is', async () => {
    const sw = installeer({
      '/assets/react-vendor-AAAA1111.js': js('oud:react'),
      '/assets/ui-vendor-BBBB2222.js': js('oud:ui'),
      '/assets/index-OUD00000.js': js('oud:index'),
    }, netwerk);
    await sw.klaar();
    // Alleen de shell, de nieuwe entry en de css gaan over het netwerk.
    expect(sw.opgehaald.sort()).toEqual(['/', '/assets/index-CCCC3333.css', '/assets/index-NIEUW123.js']);
    const nieuw = sw.nieuweCache();
    expect(await nieuw.get('/assets/react-vendor-AAAA1111.js')!.clone().text()).toBe('oud:react');
    expect(await nieuw.get('/assets/ui-vendor-BBBB2222.js')!.clone().text()).toBe('oud:ui');
    expect(await nieuw.get('/assets/index-NIEUW123.js')!.clone().text()).toBe('vers:/assets/index-NIEUW123.js');
    expect(nieuw.has('/')).toBe(true);
    // De oude entry-chunk reist niet mee: de nieuwe shell verwijst er niet naar.
    expect(nieuw.has('/assets/index-OUD00000.js')).toBe(false);
  });

  it('zonder oude cache (eerste installatie) komt alles van het netwerk', async () => {
    const sw = installeer({}, netwerk);
    await sw.klaar();
    expect(sw.opgehaald).toHaveLength(5);
    expect(sw.nieuweCache().size).toBe(5);
  });

  it('neemt een HTML-antwoord onder een asset-URL niet mee, maar haalt het asset vers op', async () => {
    const sw = installeer({ '/assets/react-vendor-AAAA1111.js': html('<!doctype html>') }, netwerk);
    await sw.klaar();
    expect(sw.opgehaald).toContain('/assets/react-vendor-AAAA1111.js');
    expect(await sw.nieuweCache().get('/assets/react-vendor-AAAA1111.js')!.clone().text()).toBe('vers:/assets/react-vendor-AAAA1111.js');
  });

  it('cachet geen HTML die het netwerk onder een asset-URL teruggeeft (SPA-rewrite)', async () => {
    const sw = installeer({}, (pad) => (pad === '/' ? html(SHELL) : pad.includes('ui-vendor') ? html('<!doctype html>') : js(`vers:${pad}`)));
    await sw.klaar();
    expect(sw.nieuweCache().has('/assets/ui-vendor-BBBB2222.js')).toBe(false);
    expect(sw.nieuweCache().has('/assets/react-vendor-AAAA1111.js')).toBe(true);
  });

  it('een mislukte shell-fetch laat de nieuwe cache leeg (activate houdt dan de oude aan)', async () => {
    const sw = installeer({ '/assets/react-vendor-AAAA1111.js': js('oud') }, () => new Response('stuk', { status: 503 }));
    await sw.klaar();
    expect(sw.nieuweCache().size).toBe(0);
  });
});
