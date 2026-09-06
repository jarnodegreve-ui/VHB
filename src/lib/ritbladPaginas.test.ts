import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_NUMMERS_PER_BLAD,
  PAGINAS_CACHE_KEY,
  dienstnummerRegex,
  haalBundelBytes,
  haalRitbladMeta,
  telViercijferigeNummers,
  zoekPaginasVoorDienst,
  zoekPaginasVoorDienstGecached,
  type RitbladDocument,
} from './ritbladPaginas';

// apiFetch trekt de Supabase-client mee; hier alleen de aanroep vastleggen.
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ apiFetch: apiFetchMock }));

/** Gemockte pdfjs-doc: één string per pagina, gesplitst in tekst-items
 *  zoals pdfjs dat doet (per woord/positie). */
const maakDoc = (paginas: string[][]): RitbladDocument & { getPage: ReturnType<typeof vi.fn> } => {
  const getPage = vi.fn(async (n: number) => ({
    getTextContent: async () => ({ items: paginas[n - 1].map((str) => ({ str })) }),
  }));
  return { numPages: paginas.length, getPage };
};

/** Inhoudsopgave-achtige pagina: 2101 … 2101+n als losse items. */
const overzicht = (aantal: number) => Array.from({ length: aantal }, (_, i) => `Dienst ${2101 + i}`);

describe('dienstnummerRegex', () => {
  it('matcht het nummer als los woord en in gangbare varianten', () => {
    const re = dienstnummerRegex('2116');
    expect(re.test('2116')).toBe(true);
    expect(re.test('Dienst 2116')).toBe(true);
    expect(re.test('2116/1 Gent')).toBe(true);
    expect(re.test('D-2116')).toBe(true);
    expect(re.test('dienst:2116.')).toBe(true);
  });

  it('matcht niet als het nummer deel is van een langer getal', () => {
    const re = dienstnummerRegex('2116');
    expect(re.test('12116')).toBe(false);
    expect(re.test('21160')).toBe(false);
    expect(re.test('bus 121161')).toBe(false);
  });
});

describe('telViercijferigeNummers', () => {
  it('telt verschillende losse viercijferige nummers', () => {
    expect(telViercijferigeNummers('2116 2116 2117 12118 06:15 2026')).toBe(3);
  });
});

describe('zoekPaginasVoorDienst', () => {
  it('geeft de pagina terug waarop het dienstnummer als los woord staat', async () => {
    const doc = maakDoc([
      ['Ritblad', 'Dienst', '2115'],
      ['Ritblad', 'Dienst', '2116', 'Gent', 'Sint-Pieters'],
      ['Vervolg', '2116/2'],
      ['Ritblad', 'Dienst', '2117'],
    ]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([2, 3]);
  });

  it('negeert 12116 (nummer als deel van een langer getal)', async () => {
    const doc = maakDoc([['Bus', '12116', 'rijdt', 'lijn', '21160']]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([]);
  });

  it('plakt tekst-items niet aan elkaar (1 + 2116 wordt geen 12116)', async () => {
    const doc = maakDoc([['Blad', '1', '2116']]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([1]);
  });

  it('negeert een inhoudsopgave-pagina met veel verschillende dienstnummers', async () => {
    const doc = maakDoc([
      overzicht(MAX_NUMMERS_PER_BLAD + 4), // bevat 2116 óók, maar is een overzicht
      ['Ritblad', 'Dienst', '2116'],
    ]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([2]);
  });

  it('laat een blad met een handvol nummers wél toe (eigen dienst + aflossing)', async () => {
    const doc = maakDoc([['Dienst', '2116', 'aflossing', '2118', 'bus', '3045', 'jaar', '2026']]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([1]);
  });

  it('laat een vermelding op andermans blad vallen als het nummer elders in de kop staat', async () => {
    const vulling = Array.from({ length: 20 }, (_, i) => `06:${10 + i} halte ${i}`);
    const doc = maakDoc([
      ['Ritblad', 'Dienst', '2114', ...vulling, 'aflossing', 'dienst', '2116'],
      ['Ritblad', 'Dienst', '2116', ...vulling],
      ['Ritblad', 'Dienst', '2116/2', '(vervolg)', ...vulling],
    ]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([2, 3]);
  });

  it('valt terug op vermeldingen elders als het nummer nergens in een kop staat', async () => {
    const vulling = Array.from({ length: 20 }, (_, i) => `06:${10 + i} halte ${i}`);
    const doc = maakDoc([
      ['Ritblad', 'Dienst', '2114', ...vulling, 'aflossing', 'dienst', '2116'],
      ['Ritblad', 'Dienst', '2117', ...vulling],
    ]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([1]);
  });

  it('geeft [] bij een scan zonder tekstlaag', async () => {
    const doc = maakDoc([[], [], []]);
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([]);
  });

  it('geeft [] bij een leeg dienstnummer zonder pagina\'s te lezen', async () => {
    const doc = maakDoc([['2116']]);
    await expect(zoekPaginasVoorDienst(doc, '  ')).resolves.toEqual([]);
    expect(doc.getPage).not.toHaveBeenCalled();
  });

  it('slaat een pagina over die niet gelezen kan worden', async () => {
    const doc = maakDoc([['Dienst', '2116'], ['Dienst', '2116']]);
    doc.getPage.mockImplementationOnce(async () => { throw new Error('kapot'); });
    await expect(zoekPaginasVoorDienst(doc, '2116')).resolves.toEqual([2]);
  });

  it('stopt met een AbortError zodra het signaal afgebroken is (viewer gesloten)', async () => {
    const doc = maakDoc([['Dienst', '2116'], ['Dienst', '2116'], ['Dienst', '2116']]);
    const afbreker = new AbortController();
    // Sluiten midden in de zoektocht: het document wordt dan vernietigd en
    // elke volgende getPage faalt — dat mag niet als "pagina overslaan" tellen.
    doc.getPage.mockImplementationOnce(async () => {
      afbreker.abort();
      throw new Error('Worker was destroyed');
    });
    await expect(zoekPaginasVoorDienst(doc, '2116', afbreker.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(doc.getPage).toHaveBeenCalledTimes(1);
  });
});

/** In-memory localStorage: Node ≥ 22 zet zelf een (lege, functieloze)
 *  `localStorage`-global die jsdom's exemplaar in vitest verdringt. */
const maakOpslag = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
};

describe('zoekPaginasVoorDienstGecached', () => {
  beforeEach(() => {
    const opslag = maakOpslag();
    vi.stubGlobal('localStorage', opslag);
    if (window !== (globalThis as unknown as Window)) Object.defineProperty(window, 'localStorage', { value: opslag, configurable: true });
  });

  it('leest de tekstlaag één keer per bundel en dienstnummer (cache-hit)', async () => {
    const doc = maakDoc([['Dienst', '2116'], ['Dienst', '2117']]);
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', '2026-09-03T06:00:00Z')).resolves.toEqual([1]);
    expect(doc.getPage).toHaveBeenCalledTimes(2);

    doc.getPage.mockClear();
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', '2026-09-03T06:00:00Z')).resolves.toEqual([1]);
    expect(doc.getPage).not.toHaveBeenCalled();
  });

  it('bewaart ook een leeg resultaat, zodat niet elke keer opnieuw gezocht wordt', async () => {
    const doc = maakDoc([['Dienst', '2117']]);
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', 'v1')).resolves.toEqual([]);
    doc.getPage.mockClear();
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', 'v1')).resolves.toEqual([]);
    expect(doc.getPage).not.toHaveBeenCalled();
  });

  it('zoekt opnieuw bij een nieuwe bundel (andere uploadedAt) en gooit de oude cache weg', async () => {
    const oud = maakDoc([['Dienst', '2116']]);
    await zoekPaginasVoorDienstGecached(oud, '2116', 'v1');

    const nieuw = maakDoc([['Overzicht'], ['Dienst', '2116']]);
    await expect(zoekPaginasVoorDienstGecached(nieuw, '2116', 'v2')).resolves.toEqual([2]);
    expect(nieuw.getPage).toHaveBeenCalledTimes(2);

    const cache = JSON.parse(window.localStorage.getItem(PAGINAS_CACHE_KEY)!);
    expect(cache).toEqual({ uploadedAt: 'v2', paginas: { '2116': [2] } });
  });

  it('houdt meerdere dienstnummers per bundel naast elkaar', async () => {
    const doc = maakDoc([['Dienst', '2116'], ['Dienst', '2117']]);
    await zoekPaginasVoorDienstGecached(doc, '2116', 'v1');
    await zoekPaginasVoorDienstGecached(doc, '2117', 'v1');
    const cache = JSON.parse(window.localStorage.getItem(PAGINAS_CACHE_KEY)!);
    expect(cache.paginas).toEqual({ '2116': [1], '2117': [2] });
  });

  it('bewaart een resultaat met leesfouten niet: de volgende keer wordt opnieuw gezocht (controle 05-09, nr. 36)', async () => {
    const doc = maakDoc([['Dienst', '2116'], ['Dienst', '2116']]);
    // Tijdelijke getTextContent-fout op pagina 1: het resultaat is dan
    // onvolledig ([2]) en mag niet als waarheid voor de hele bundel vastliggen.
    doc.getPage.mockImplementationOnce(async () => { throw new Error('tijdelijk'); });
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', 'v1')).resolves.toEqual([2]);
    expect(window.localStorage.getItem(PAGINAS_CACHE_KEY)).toBeNull();

    doc.getPage.mockClear();
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', 'v1')).resolves.toEqual([1, 2]);
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem(PAGINAS_CACHE_KEY)!).paginas).toEqual({ '2116': [1, 2] });
  });

  it('bewaart een leeg resultaat mét leesfout evenmin (een scan zonder tekst wél — die is compleet gelezen)', async () => {
    const kapot = maakDoc([['Dienst', '2117']]);
    kapot.getPage.mockImplementationOnce(async () => { throw new Error('tijdelijk'); });
    await expect(zoekPaginasVoorDienstGecached(kapot, '2116', 'v1')).resolves.toEqual([]);
    expect(window.localStorage.getItem(PAGINAS_CACHE_KEY)).toBeNull();

    const scan = maakDoc([[], []]);
    await expect(zoekPaginasVoorDienstGecached(scan, '2116', 'v1')).resolves.toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(PAGINAS_CACHE_KEY)!).paginas).toEqual({ '2116': [] });
  });

  it('overleeft een kapotte cache-waarde', async () => {
    window.localStorage.setItem(PAGINAS_CACHE_KEY, '{niet-json');
    const doc = maakDoc([['Dienst', '2116']]);
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', 'v1')).resolves.toEqual([1]);
  });

  it('bewaart een afgebroken zoektocht niet (anders stond een onvolledig resultaat vast voor de hele bundel)', async () => {
    const doc = maakDoc([['Dienst', '2116'], ['Dienst', '2116']]);
    const afbreker = new AbortController();
    doc.getPage.mockImplementationOnce(async () => {
      afbreker.abort();
      throw new Error('Worker was destroyed');
    });
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', 'v1', afbreker.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(window.localStorage.getItem(PAGINAS_CACHE_KEY)).toBeNull();
  });
});

describe('haalRitbladMeta', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('vraagt de metadata altijd vers op (cache: no-store — de SW doet dan network-first)', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ url: 'https://s/ritblaadjes/x.pdf?token=1', uploadedAt: 'v1' })));
    await expect(haalRitbladMeta()).resolves.toEqual({ url: 'https://s/ritblaadjes/x.pdf?token=1', uploadedAt: 'v1' });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje', { cache: 'no-store' });
  });

  it('geeft null door als er geen bundel is en gooit bij een serverfout', async () => {
    apiFetchMock.mockResolvedValueOnce(new Response('null'));
    await expect(haalRitbladMeta()).resolves.toBeNull();
    apiFetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(haalRitbladMeta()).rejects.toThrow('500');
  });
});

describe('haalBundelBytes', () => {
  const OUD = 'https://s/ritblaadjes/x.pdf?token=oud';
  const NIEUW = 'https://s/ritblaadjes/x.pdf?token=nieuw';
  const pdf = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
  const fetchMock = vi.fn<(url: string) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('geeft de bytes terug bij een geslaagde fetch zonder de verse URL te vragen', async () => {
    fetchMock.mockResolvedValue(pdf());
    const versUrl = vi.fn(async () => NIEUW);
    await expect(haalBundelBytes(OUD, versUrl)).resolves.toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(versUrl).not.toHaveBeenCalled();
  });

  it('haalt bij een verlopen signed URL (400) één keer verse metadata en probeert opnieuw', async () => {
    fetchMock.mockResolvedValueOnce(new Response('expired', { status: 400 })).mockResolvedValueOnce(pdf());
    const versUrl = vi.fn(async () => NIEUW);
    await expect(haalBundelBytes(OUD, versUrl)).resolves.toHaveLength(4);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([OUD, NIEUW]);
    expect(versUrl).toHaveBeenCalledTimes(1);
  });

  it('gooit als ook de verse URL faalt, of als er geen verse URL komt', async () => {
    fetchMock.mockResolvedValue(new Response('expired', { status: 400 }));
    await expect(haalBundelBytes(OUD, async () => NIEUW)).rejects.toThrow('400');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear();
    await expect(haalBundelBytes(OUD, async () => null)).rejects.toThrow('400');
    expect(fetchMock).toHaveBeenCalledTimes(1); // dezelfde/geen URL opnieuw proberen heeft geen zin
  });

  it('offline: de service worker beantwoordt de fetch uit zijn cache (query-loos pad) — geen herkansing nodig', async () => {
    // De SW matcht /ritblaadjes/ ongeacht de (verlopen) token en geeft de
    // gecachte PDF; vanuit de app is dat gewoon een geslaagde fetch. De
    // metadata kwam dan uit de SW-fallback; een verse URL is er niet.
    fetchMock.mockImplementation(async (url) => (url.includes('/ritblaadjes/') ? pdf() : Promise.reject(new TypeError('Failed to fetch'))));
    const versUrl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(haalBundelBytes(OUD, versUrl)).resolves.toHaveLength(4);
    expect(versUrl).not.toHaveBeenCalled();
  });

  it('gooit de netwerkfout door als er ook geen gecachte PDF is (koud offline)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(haalBundelBytes(OUD)).rejects.toThrow('Failed to fetch');
  });
});
