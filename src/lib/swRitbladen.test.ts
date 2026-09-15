// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * public/sw-ritbladen.js is een klassiek script (importScripts in de service
 * worker). We laden het met een nep-`self`, precies zoals de SW dat doet.
 */
type Api = {
  RITBLADEN_CACHE: string;
  MAX_RITBLADEN: number;
  OFFLINE_API: string[];
  CACHE_BRON_HEADER: string;
  isRitbladUrl: (url: string) => boolean;
  ritbladCacheKey: (url: string) => string;
  isOfflineApi: (pathname: string) => boolean;
  markeerUitCache: (response: Response | null | undefined) => Response | null;
  snoeiSleutels: (keys: Array<string | { url: string }>, max?: number) => string[];
  ritbladUrlsUitBericht: (data: unknown) => Array<{ url: string; key: string }>;
};

const laad = (): Api => {
  const bron = readFileSync(resolve(__dirname, '../../public/sw-ritbladen.js'), 'utf8');
  const self: Record<string, unknown> = {};
  new Function('self', bron)(self);
  return self.VHB_RITBLADEN as Api;
};

const pdf = (n: number) => `https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel-${n}.pdf?token=t${n}`;

describe('sw-ritbladen.js', () => {
  const api = laad();

  it('kent de cache-naam en de offline-API-paden (Mijn dag + startlading)', () => {
    expect(api.RITBLADEN_CACHE).toBe('vhb-ritbladen');
    expect(api.MAX_RITBLADEN).toBe(6);
    for (const p of ['/api/me', '/api/planning', '/api/diversions', '/api/planning-notes', '/api/ritblaadje']) expect(api.isOfflineApi(p)).toBe(true);
    // Punt 19 (15-09): de bronnen van loadAppData die een chauffeur offline nodig heeft.
    for (const p of ['/api/users', '/api/updates', '/api/swaps', '/api/leave', '/api/meldingen']) expect(api.isOfflineApi(p)).toBe(true);
    // Exact pad: subroutes en schrijfpaden blijven buiten de cache.
    expect(api.isOfflineApi('/api/planning/assign-service')).toBe(false);
    expect(api.isOfflineApi('/api/meldingen/gelezen')).toBe(false);
    expect(api.isOfflineApi('/api/leave/sick-report')).toBe(false);
    expect(api.isOfflineApi('/api/documents')).toBe(false);
    expect(api.isOfflineApi('/api/services')).toBe(false);
    expect(api.OFFLINE_API).toHaveLength(10);
  });

  it('herkent ritblad-URL\'s en sleutelt zonder query', () => {
    expect(api.isRitbladUrl(pdf(1))).toBe(true);
    expect(api.isRitbladUrl('https://x.supabase.co/storage/v1/object/sign/documenten/a.pdf')).toBe(false);
    expect(api.isRitbladUrl('geen url')).toBe(false);
    expect(api.ritbladCacheKey(pdf(1))).toBe('https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel-1.pdf');
  });

  it('snoeit tot MAX_RITBLADEN, oudste eerst, en laat API-antwoorden staan', () => {
    const keys = [
      'https://vhbportaal.com/api/planning?driverId=42',
      ...Array.from({ length: 8 }, (_, i) => `https://x.supabase.co/storage/v1/object/sign/ritblaadjes/b-${i}.pdf`),
      'https://vhbportaal.com/api/me',
      'https://vhbportaal.com/api/swaps',
    ];
    expect(api.snoeiSleutels(keys)).toEqual([
      'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/b-0.pdf',
      'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/b-1.pdf',
    ]);
    expect(api.snoeiSleutels(keys.slice(0, 5))).toEqual([]);
    // Request-objecten (Cache.keys()) mogen ook.
    expect(api.snoeiSleutels(keys.map((url) => ({ url })), 7)).toHaveLength(1);
  });

  it('haalt alleen geldige, unieke ritblad-URL\'s uit het bericht', () => {
    const items = api.ritbladUrlsUitBericht({ type: 'cache-ritbladen', urls: [pdf(1), pdf(1).replace('t1', 't9'), 'https://evil.example/x.pdf', 42, pdf(2)] });
    expect(items.map((i) => i.key)).toEqual([
      'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel-1.pdf',
      'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel-2.pdf',
    ]);
    expect(api.ritbladUrlsUitBericht(null)).toEqual([]);
    expect(api.ritbladUrlsUitBericht({ urls: 'x' })).toEqual([]);
  });

  it('markeert een gecacht antwoord met X-VHB-Bron: cache en houdt status, body en Date', async () => {
    const origineel = new Response(JSON.stringify([{ id: 'sw1' }]), {
      status: 200,
      headers: { 'content-type': 'application/json', date: 'Tue, 15 Sep 2026 06:12:00 GMT', 'x-collection-revision': 'r9' },
    });
    const gemarkeerd = api.markeerUitCache(origineel)!;
    expect(gemarkeerd).not.toBe(origineel);
    expect(gemarkeerd.status).toBe(200);
    expect(gemarkeerd.headers.get(api.CACHE_BRON_HEADER)).toBe('cache');
    expect(gemarkeerd.headers.get('date')).toBe('Tue, 15 Sep 2026 06:12:00 GMT');
    expect(gemarkeerd.headers.get('x-collection-revision')).toBe('r9');
    expect(await gemarkeerd.json()).toEqual([{ id: 'sw1' }]);
    // Geen cache-treffer: null, zodat de SW op Response.error() terugvalt.
    expect(api.markeerUitCache(undefined)).toBeNull();
    expect(api.markeerUitCache(null)).toBeNull();
  });
});
