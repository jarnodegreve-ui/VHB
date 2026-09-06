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
  MIJN_DAG_API: string[];
  isRitbladUrl: (url: string) => boolean;
  ritbladCacheKey: (url: string) => string;
  isMijnDagApi: (pathname: string) => boolean;
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

  it('kent de cache-naam en de Mijn-dag-API-paden', () => {
    expect(api.RITBLADEN_CACHE).toBe('vhb-ritbladen');
    expect(api.MAX_RITBLADEN).toBe(6);
    for (const p of ['/api/me', '/api/planning', '/api/diversions', '/api/planning-notes', '/api/ritblaadje']) expect(api.isMijnDagApi(p)).toBe(true);
    expect(api.isMijnDagApi('/api/users')).toBe(false);
    expect(api.isMijnDagApi('/api/planning/assign-service')).toBe(false);
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
});
