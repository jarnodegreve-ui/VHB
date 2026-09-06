import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => ({ meta: null as null | { url?: string }, faalt: false }));
vi.mock('./ritbladPaginas', () => ({
  haalRitbladMeta: vi.fn(async () => {
    if (mem.faalt) throw new Error('offline');
    return mem.meta;
  }),
}));

import { _resetRitbladWarm, isRitbladOpgeslagen, meldRitbladenAanSw, ritbladCacheKey, warmRitbladCache } from './ritbladCache';

const PDF = 'https://x.supabase.co/storage/v1/object/sign/ritblaadjes/bundel.pdf?token=abc';

describe('ritbladCache (client → service worker)', () => {
  const berichten: unknown[] = [];
  beforeEach(() => {
    berichten.length = 0;
    mem.meta = { url: PDF };
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

  it('meldt de bundel aan de SW en throttlet daarna een half uur', async () => {
    await warmRitbladCache();
    await warmRitbladCache();
    expect(berichten).toEqual([{ type: 'cache-ritbladen', urls: [PDF] }]);
    await warmRitbladCache({ force: true });
    expect(berichten).toHaveLength(2);
  });

  it('doet niets zonder actieve SW of zonder bundel, en probeert na een fout opnieuw', async () => {
    mem.meta = null;
    await warmRitbladCache();
    expect(berichten).toEqual([]);
    _resetRitbladWarm();
    mem.faalt = true;
    await warmRitbladCache();
    mem.faalt = false;
    mem.meta = { url: PDF };
    await warmRitbladCache(); // throttle is na de fout teruggezet
    expect(berichten).toHaveLength(1);
    // @ts-expect-error geen controller
    navigator.serviceWorker.controller = null;
    expect(meldRitbladenAanSw([PDF])).toBe(false);
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
