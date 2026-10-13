import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => ({ bundels: [] as Array<{ versie: { status: string } | null; bundel: { url?: string } | null }>, faalt: false }));
vi.mock('./ritbladenApi', () => ({
  haalRitbladen: vi.fn(async () => {
    if (mem.faalt) throw new Error('offline');
    return { bundels: mem.bundels };
  }),
}));

import { _resetRitbladWarm, isRitbladOpgeslagen, meldRitbladenAanSw, ritbladCacheKey, verwijderRitbladUitCache, warmRitbladCache } from './ritbladCache';

const PDF = 'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=abc';
const PDF_VOLGENDE = 'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/januari.pdf?token=def';
const PDF_VORIGE = 'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/september.pdf?token=ghi';

describe('ritbladCache (client → service worker)', () => {
  const berichten: unknown[] = [];
  beforeEach(() => {
    berichten.length = 0;
    // Huidige én toekomstige bundel gaan mee, de vorige niet (13-10).
    mem.bundels = [
      { versie: { status: 'verlopen' }, bundel: { url: PDF_VORIGE } },
      { versie: { status: 'huidig' }, bundel: { url: PDF } },
      { versie: { status: 'toekomstig' }, bundel: { url: PDF_VOLGENDE } },
      { versie: { status: 'toekomstig' }, bundel: null },
    ];
    mem.faalt = false;
    _resetRitbladWarm();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: { postMessage: (m: unknown) => berichten.push(m) } },
    });
  });
  afterEach(() => {
    // @ts-expect-error opruimen van de nep-SW
    delete navigator.serviceWorker;
  });

  it('sleutelt zonder query, zoals de SW', () => {
    expect(ritbladCacheKey(PDF)).toBe('https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf');
  });

  it('meldt de huidige en de volgende bundel aan de SW en throttlet daarna een half uur', async () => {
    await warmRitbladCache();
    await warmRitbladCache();
    expect(berichten).toEqual([{ type: 'cache-ritbladen', urls: [PDF, PDF_VOLGENDE] }]);
    await warmRitbladCache({ force: true });
    expect(berichten).toHaveLength(2);
  });

  it('doet niets zonder actieve SW of zonder bundel, en probeert na een fout opnieuw', async () => {
    mem.bundels = [];
    await warmRitbladCache();
    expect(berichten).toEqual([]);
    _resetRitbladWarm();
    mem.faalt = true;
    await warmRitbladCache();
    mem.faalt = false;
    mem.bundels = [{ versie: null, bundel: { url: PDF } }];
    await warmRitbladCache(); // throttle is na de fout teruggezet
    expect(berichten).toHaveLength(1);
    // @ts-expect-error geen controller
    navigator.serviceWorker.controller = null;
    expect(meldRitbladenAanSw([PDF])).toBe(false);
  });

  it('verwijderRitbladUitCache haalt het exemplaar op de query-loze sleutel weg en zegt of er iets stond', async () => {
    const gewist: string[] = [];
    vi.stubGlobal('caches', {
      open: async (naam: string) => {
        expect(naam).toBe('vhb-ritbladen');
        return { delete: async (key: string) => { gewist.push(key); return key.endsWith('bundel.pdf'); } };
      },
    });
    expect(await verwijderRitbladUitCache(PDF)).toBe(true);
    expect(gewist).toEqual(['https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf']);
    expect(await verwijderRitbladUitCache('https://x.supabase.co/ritblaadjes/ander.pdf?x=1')).toBe(false);
    vi.unstubAllGlobals();
    // Zonder Cache API (privémodus): false, geen fout.
    vi.stubGlobal('caches', undefined);
    expect(await verwijderRitbladUitCache(PDF)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('isRitbladOpgeslagen kijkt in de ritbladen-cache op de query-loze sleutel', async () => {
    const gevraagd: string[] = [];
    vi.stubGlobal('caches', {
      open: async (naam: string) => {
        expect(naam).toBe('vhb-ritbladen');
        return { match: async (key: string) => { gevraagd.push(key); return key.endsWith('bundel.pdf') ? {} : undefined; } };
      },
    });
    expect(await isRitbladOpgeslagen(PDF)).toBe(true);
    expect(gevraagd).toEqual(['https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf']);
    expect(await isRitbladOpgeslagen('https://x.supabase.co/ritblaadjes/ander.pdf?x=1')).toBe(false);
    vi.unstubAllGlobals();
  });
});
