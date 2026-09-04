import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_NUMMERS_PER_BLAD,
  PAGINAS_CACHE_KEY,
  dienstnummerRegex,
  telViercijferigeNummers,
  zoekPaginasVoorDienst,
  zoekPaginasVoorDienstGecached,
  type RitbladDocument,
} from './ritbladPaginas';

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

  it('overleeft een kapotte cache-waarde', async () => {
    window.localStorage.setItem(PAGINAS_CACHE_KEY, '{niet-json');
    const doc = maakDoc([['Dienst', '2116']]);
    await expect(zoekPaginasVoorDienstGecached(doc, '2116', 'v1')).resolves.toEqual([1]);
  });
});
