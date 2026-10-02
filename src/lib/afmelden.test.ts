import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AFGEMELD, LAATSTE_AUTH_KEY, SCHIL_CACHE_PREFIX, WIS_PRIVE_BERICHT,
  bevestigGebruiker, borgGebruiker, isAndereGebruiker, isPriveCache, kanHerladen, magProfiel, meldAfBijSupabase, onthoudGebruiker, wisPriveCaches,
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

describe('wie is dit: iemand anders dan de vorige op dit toestel?', () => {
  it('alleen als er een id bewaard is dat niet het huidige is', () => {
    expect(isAndereGebruiker('auth-a', 'auth-b')).toBe(true);
    expect(isAndereGebruiker('auth-a', undefined)).toBe(true);
    expect(isAndereGebruiker(AFGEMELD, 'auth-a')).toBe(true);
    expect(isAndereGebruiker('auth-a', 'auth-a')).toBe(false);
    // Nog niets bewaard (toestel van vóór deze regel): niet te zeggen, dus nee.
    expect(isAndereGebruiker(null, 'auth-a')).toBe(false);
    expect(isAndereGebruiker('', 'auth-a')).toBe(false);
    expect(isAndereGebruiker(null, undefined)).toBe(false);
  });

  describe('borgGebruiker', () => {
    let nep: ReturnType<typeof nepCaches>;
    const ALLES = [SCHIL, 'vhb-ritbladen', BIJLAGEN_CACHE];
    beforeEach(() => {
      nep = nepCaches({ [SCHIL]: ['/'], 'vhb-ritbladen': ['/api/me', '/api/meldingen'], [BIJLAGEN_CACHE]: ['https://x/plan.pdf'] });
      vi.stubGlobal('caches', nep.api);
    });

    it('dezelfde gebruiker: de caches blijven en een profiel uit de cache mag (Mijn dag zonder bereik)', async () => {
      onthoudGebruiker('auth-a');
      expect(await borgGebruiker('auth-a')).toBe(true);
      expect([...nep.opslag.keys()]).toEqual(ALLES);
    });

    it('een andere gebruiker: eerst de privé-caches weg, en geen profiel uit de cache', async () => {
      onthoudGebruiker('auth-a');
      expect(await borgGebruiker('auth-b')).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('nog geen id bewaard terwijl er caches staan: zoals vroeger, de caches blijven en de cache mag', async () => {
      expect(await borgGebruiker('auth-a')).toBe(true);
      expect([...nep.opslag.keys()]).toEqual(ALLES);
    });

    it('het oude kenmerk alleen (profiel-id in vhb-last-user-id) is geen bewaard auth-id', async () => {
      window.localStorage.setItem('vhb-last-user-id', '42');
      expect(await borgGebruiker('auth-a')).toBe(true);
      expect([...nep.opslag.keys()]).toEqual(ALLES);
    });

    it('na een afmelding is iedereen iemand anders, ook dezelfde gebruiker', async () => {
      onthoudGebruiker('auth-a');
      onthoudGebruiker(AFGEMELD);
      expect(await borgGebruiker('auth-a')).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('een bewaard id en een sessie zonder id: iemand anders', async () => {
      onthoudGebruiker('auth-a');
      expect(await borgGebruiker(undefined)).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('geblokkeerde opslag telt als niets bewaard, en het breekt niet', async () => {
      onthoudGebruiker('auth-a');
      opslag.getItem = () => { throw new Error('geblokkeerd'); };
      expect(await borgGebruiker('auth-b')).toBe(true);
      expect([...nep.opslag.keys()]).toEqual(ALLES);
    });
  });

  describe('bevestigGebruiker: na een profiel van de server', () => {
    let nep: ReturnType<typeof nepCaches>;
    const ALLES = [SCHIL, 'vhb-ritbladen', BIJLAGEN_CACHE];
    beforeEach(() => {
      nep = nepCaches({ [SCHIL]: ['/'], 'vhb-ritbladen': ['/api/me'], [BIJLAGEN_CACHE]: ['https://x/plan.pdf'] });
      vi.stubGlobal('caches', nep.api);
    });

    it('bewaart het auth-id; vanaf dan geldt de volledige controle', async () => {
      await bevestigGebruiker('auth-a', '42');
      expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBe('auth-a');
      expect([...nep.opslag.keys()]).toEqual(ALLES);
      expect(await borgGebruiker('auth-b')).toBe(false);
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
    });

    it('toestel van vóór deze regel, zelfde profiel als de vorige keer: de caches blijven', async () => {
      window.localStorage.setItem('vhb-last-user-id', '42');
      await bevestigGebruiker('auth-a', '42');
      expect([...nep.opslag.keys()]).toEqual(ALLES);
      expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBe('auth-a');
    });

    it('toestel van vóór deze regel, een ander profiel dan de vorige keer: de caches weg, zoals vroeger', async () => {
      window.localStorage.setItem('vhb-last-user-id', '42');
      await bevestigGebruiker('auth-b', '43');
      expect([...nep.opslag.keys()]).toEqual([SCHIL]);
      expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBe('auth-b');
    });

    it('is er al een auth-id bewaard, dan telt het oude kenmerk niet meer', async () => {
      window.localStorage.setItem('vhb-last-user-id', '99');
      onthoudGebruiker('auth-a');
      await bevestigGebruiker('auth-a', '42');
      expect([...nep.opslag.keys()]).toEqual(ALLES);
    });

    it('zonder auth-id wordt er niets bewaard', async () => {
      await bevestigGebruiker(undefined, '42');
      expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBeNull();
    });
  });

  it('onthoudGebruiker bewaart wat het krijgt, en niets zonder waarde', () => {
    onthoudGebruiker(undefined);
    expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBeNull();
    onthoudGebruiker('auth-b');
    expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBe('auth-b');
    onthoudGebruiker(AFGEMELD);
    expect(window.localStorage.getItem(LAATSTE_AUTH_KEY)).toBe(AFGEMELD);
    expect(AFGEMELD).not.toBe('');
  });
});

describe('meldAfBijSupabase: de sessie gaat hoe dan ook uit de opslag', () => {
  const SLEUTEL = 'sb-project-auth-token';
  const client = (signOut: () => Promise<{ error: unknown }>) => ({ signOut, storageKey: SLEUTEL });
  beforeEach(() => {
    window.localStorage.setItem(SLEUTEL, '{"access_token":"verlopen","refresh_token":"r"}');
    window.localStorage.setItem('vhb-theme', 'dark');
  });

  it('signOut geeft een fout en liet de sessie staan (verlopen token, aanmeldserver onbereikbaar): toch weg', async () => {
    await meldAfBijSupabase(client(async () => ({ error: new Error('refresh mislukt') })));
    expect(window.localStorage.getItem(SLEUTEL)).toBeNull();
    // Alleen de sessie: de rest van de opslag blijft.
    expect(window.localStorage.getItem('vhb-theme')).toBe('dark');
  });

  it('signOut gooit: ook weg', async () => {
    await meldAfBijSupabase(client(async () => { throw new Error('lock'); }));
    expect(window.localStorage.getItem(SLEUTEL)).toBeNull();
  });

  it('signOut lukt: de client ruimde zelf op, wij raken de opslag niet aan', async () => {
    const verwijder = vi.spyOn(opslag, 'removeItem');
    await meldAfBijSupabase(client(async () => ({ error: null })));
    expect(verwijder).not.toHaveBeenCalled();
  });

  it('de sleutel komt van de client, niet uit een vaste naam', async () => {
    window.localStorage.setItem('eigen-sleutel', 'sessie');
    await meldAfBijSupabase({ signOut: async () => ({ error: new Error('x') }), storageKey: 'eigen-sleutel' } as never);
    expect(window.localStorage.getItem('eigen-sleutel')).toBeNull();
    expect(window.localStorage.getItem(SLEUTEL)).not.toBeNull();
  });

  it('zonder client of met een geblokkeerde opslag breekt het niet', async () => {
    await expect(meldAfBijSupabase(null)).resolves.toBeUndefined();
    opslag.removeItem = () => { throw new Error('geblokkeerd'); };
    await expect(meldAfBijSupabase(client(async () => ({ error: new Error('x') })))).resolves.toBeUndefined();
  });

  it('de echte client heeft die sleutel: sb-<project>-auth-token', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const echt = createClient('https://project.supabase.co', 'anon', { auth: { persistSession: false, autoRefreshToken: false } });
    expect((echt.auth as unknown as { storageKey: string }).storageKey).toBe(SLEUTEL);
  });
});

describe('magProfiel: een profiel uit de cache alleen als de start het toeliet', () => {
  it('van de server altijd', () => {
    expect(magProfiel(false, true)).toBe(true);
    expect(magProfiel(false, false)).toBe(true);
  });
  it('uit de cache niet voor iemand anders dan de vorige gebruiker', () => {
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
