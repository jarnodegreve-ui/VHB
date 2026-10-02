import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAATSTE_AUTH_KEY, SCHIL_CACHE_PREFIX, WIS_PRIVE_BERICHT,
  borgGebruiker, isPriveCache, isZelfdeGebruiker, kanHerladen, magProfiel, onthoudGebruiker, wisPriveCaches,
} from './afmelden';
import { BIJLAGEN_CACHE } from './bijlageCache';

/** Nep-Cache Storage: namen met hun sleutels, zoals de browser ze heeft. */
function nepCaches(begin: Record<string, string[]>) {
  const opslag = new Map(Object.entries(begin).map(([naam, sleutels]) => [naam, new Set(sleutels)]));
  return {
    opslag,
    api: {
      keys: async () => [...opslag.keys()],
      delete: async (naam: string) => opslag.delete(naam),
      match: async (sleutel: string) => ([...opslag.values()].some((s) => s.has(sleutel)) ? new Response('schil') : undefined),
    },
  };
}

const SCHIL = `${SCHIL_CACHE_PREFIX}abc1234`;
const swBron = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
const ritbladenBron = readFileSync(resolve(__dirname, '../../public/sw-ritbladen.js'), 'utf8');

const zetController = (controller: { postMessage: (bericht: unknown) => void } | null) => {
  Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: { controller } });
};

/** In-memory localStorage: Node >= 22 zet zelf een (lege, functieloze)
 *  `localStorage`-global die jsdom's exemplaar in vitest verdringt. */
const maakOpslag = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  };
};
let opslag = maakOpslag();

beforeEach(() => {
  opslag = maakOpslag();
  vi.stubGlobal('localStorage', opslag);
  if (window !== (globalThis as unknown as Window)) Object.defineProperty(window, 'localStorage', { value: opslag, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'serviceWorker');
});

describe('welke caches privé zijn', () => {
  it('alles behalve de schil van de build', () => {
    expect(isPriveCache('vhb-ritbladen')).toBe(true);
    expect(isPriveCache(BIJLAGEN_CACHE)).toBe(true);
    expect(isPriveCache('vhb-bijlagen-v2')).toBe(true);
    expect(isPriveCache(SCHIL)).toBe(false);
  });

  it('een cache die we niet kennen is bij twijfel privé', () => {
    expect(isPriveCache('iets-nieuws')).toBe(true);
    expect(isPriveCache('')).toBe(true);
  });

  it('loopt gelijk met de service worker: de schil-cache heet daar zo, de twee andere niet', () => {
    expect(swBron).toContain(`const CACHE_NAME = '${SCHIL_CACHE_PREFIX}__VHB_BUILD_ID__';`);
    const ritbladen = ritbladenBron.match(/RITBLADEN_CACHE = '([^']+)'/)?.[1];
    expect(ritbladen).toBe('vhb-ritbladen');
    expect(isPriveCache(ritbladen!)).toBe(true);
    // De worker luistert naar hetzelfde bericht dat de pagina stuurt.
    expect(swBron).toContain(`event.data.type === '${WIS_PRIVE_BERICHT}'`);
  });
});

describe('wisPriveCaches', () => {
  it('wist de privé-caches, laat de schil staan en meldt het aan de service worker', async () => {
    const nep = nepCaches({ [SCHIL]: ['/'], 'vhb-ritbladen': ['/api/me'], [BIJLAGEN_CACHE]: ['https://x/plan.pdf'], 'iets-nieuws': ['x'] });
    vi.stubGlobal('caches', nep.api);
    const postMessage = vi.fn();
    zetController({ postMessage });
    await wisPriveCaches();
    expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    expect(postMessage).toHaveBeenCalledWith({ type: WIS_PRIVE_BERICHT });
  });

  it('zonder service worker wist de pagina zelf', async () => {
    const nep = nepCaches({ [SCHIL]: ['/'], 'vhb-ritbladen': ['/api/me'] });
    vi.stubGlobal('caches', nep.api);
    await wisPriveCaches();
    expect([...nep.opslag.keys()]).toEqual([SCHIL]);
  });

  it('een geblokkeerde Cache Storage houdt het afmelden niet tegen', async () => {
    vi.stubGlobal('caches', { keys: async () => { throw new Error('geblokkeerd'); } });
    await expect(wisPriveCaches()).resolves.toBeUndefined();
  });
});

describe('wie is dit: dezelfde gebruiker als de vorige op dit toestel?', () => {
  it('alleen bij hetzelfde auth-id; zonder bewaard of zonder huidig id niet', () => {
    expect(isZelfdeGebruiker('auth-a', 'auth-a')).toBe(true);
    expect(isZelfdeGebruiker('auth-a', 'auth-b')).toBe(false);
    expect(isZelfdeGebruiker(null, 'auth-a')).toBe(false);
    expect(isZelfdeGebruiker('auth-a', undefined)).toBe(false);
    expect(isZelfdeGebruiker(null, undefined)).toBe(false);
    expect(isZelfdeGebruiker('', '')).toBe(false);
  });

  describe('borgGebruiker', () => {
    let nep: ReturnType<typeof nepCaches>;
    beforeEach(() => {
      nep = nepCaches({ [SCHIL]: ['/'], 'vhb-ritbladen': ['/api/me', '/api/meldingen'], [BIJLAGEN_CACHE]: ['https://x/plan.pdf'] });
      vi.stubGlobal('caches', nep.api);
    });

    it('dezelfde gebruiker: de caches blijven (Mijn dag zonder bereik)', async () => {
      onthoudGebruiker('auth-a');
      expect(await borgGebruiker('auth-a')).toBe(true);
      expect([...nep.opslag.keys()]).toEqual([SCHIL, 'vhb-ritbladen', BIJLAGEN_CACHE]);
    });

    it('een andere gebruiker: eerst de privé-caches weg', async () => {
      onthoudGebruiker('auth-a');
      expect(await borgGebruiker('auth-b')).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('niemand bewaard terwijl er caches staan: ook weg', async () => {
      expect(await borgGebruiker('auth-b')).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('het oude kenmerk (profiel-id in vhb-last-user-id) telt niet als bewijs', async () => {
      window.localStorage.setItem('vhb-last-user-id', '42');
      expect(await borgGebruiker('42')).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('zonder auth-id is niemand dezelfde', async () => {
      onthoudGebruiker('auth-a');
      expect(await borgGebruiker(undefined)).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('geblokkeerde opslag: niemand is dezelfde, en het breekt niet', async () => {
      onthoudGebruiker('auth-a');
      opslag.getItem = () => { throw new Error('geblokkeerd'); };
      expect(await borgGebruiker('auth-a')).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });
  });

  it('onthoudGebruiker bewaart het auth-id, en niets zonder id', () => {
    onthoudGebruiker(undefined);
    expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBeNull();
    onthoudGebruiker('auth-b');
    expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBe('auth-b');
  });
});

describe('magProfiel: een profiel uit de cache alleen voor dezelfde gebruiker', () => {
  it('van de server altijd', () => {
    expect(magProfiel(false, true)).toBe(true);
    expect(magProfiel(false, false)).toBe(true);
  });
  it('uit de cache alleen voor wie hier ook de vorige keer aangemeld was', () => {
    expect(magProfiel(true, true)).toBe(true);
    expect(magProfiel(true, false)).toBe(false);
  });
});

describe('kanHerladen: eindigt de herlaad niet op een foutpagina?', () => {
  it('met bereik altijd', async () => {
    expect(await kanHerladen(true)).toBe(true);
  });

  it('zonder bereik alleen met een service worker die de schil heeft', async () => {
    vi.stubGlobal('caches', nepCaches({ [SCHIL]: [`/`] }).api);
    zetController({ postMessage: () => {} });
    expect(await kanHerladen(false)).toBe(true);
  });

  it('zonder bereik en zonder service worker niet', async () => {
    vi.stubGlobal('caches', nepCaches({ [SCHIL]: ['/'] }).api);
    zetController(null);
    expect(await kanHerladen(false)).toBe(false);
  });

  it('zonder bereik en zonder schil in de cache niet', async () => {
    vi.stubGlobal('caches', nepCaches({ 'vhb-ritbladen': ['/api/me'] }).api);
    zetController({ postMessage: () => {} });
    expect(await kanHerladen(false)).toBe(false);
  });

  it('een geblokkeerde Cache Storage: niet herladen', async () => {
    vi.stubGlobal('caches', { match: async () => { throw new Error('geblokkeerd'); } });
    zetController({ postMessage: () => {} });
    expect(await kanHerladen(false)).toBe(false);
  });
});
