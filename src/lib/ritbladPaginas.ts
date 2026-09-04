/**
 * Ritblad per dienst: de ritblad-bundel is één PDF met de bladen van álle
 * diensten. Deze module vindt client-side de pagina('s) van één dienst-
 * nummer door per pagina de tekstlaag te lezen (pdfjs), zodat een chauffeur
 * meteen zíjn blad ziet i.p.v. door 48 pagina's te bladeren.
 *
 * pdfjs wordt lazy geladen (aparte chunk, ±400 kB) — alleen wie de viewer
 * opent betaalt dat. De worker komt uit de eigen bundel (CSP: script-src en
 * worker-src 'self'), niet van een CDN.
 *
 * Het zoekresultaat gaat per bundel (uploadedAt) + dienstnummer in
 * localStorage: de bundel wisselt hooguit een paar keer per jaar, de
 * tekstlaag lezen kost op een oudere iPhone een paar seconden.
 */

// Minimale vorm van wat we van pdfjs gebruiken — zo blijven de tests vrij
// van een echte PDF én van de pdfjs-import (die in jsdom geen worker heeft).
// (items zijn `unknown`: pdfjs mengt TextItem en TextMarkedContent — wij
// lezen alleen `str` waar dat een string is.)
export type RitbladPagina = { getTextContent(): Promise<{ items: readonly unknown[] }> };
export type RitbladDocument = { numPages: number; getPage(nummer: number): Promise<RitbladPagina> };

export const PAGINAS_CACHE_KEY = 'vhb-ritblad-paginas';

/** Boven dit aantal verschillende viercijferige nummers is een pagina
 *  geen ritblad maar een inhoudsopgave/overzicht (die bevat álle diensten)
 *  en telt hij niet mee. Een echt blad noemt hooguit een paar nummers
 *  (eigen dienst, aflossing). */
export const MAX_NUMMERS_PER_BLAD = 8;

const VIERCIJFERIG = /(^|[^0-9])(\d{4})(?![0-9])/g;

/** Regex voor het dienstnummer als los getal: niet geplakt aan een ander
 *  cijfer ("12116" telt niet), maar wel na een letter, spatie, streep of
 *  slash ("Dienst 2116", "2116/1", "D-2116"). Geen lookbehind: oudere iOS. */
export const dienstnummerRegex = (dienstnummer: string): RegExp => {
  const veilig = dienstnummer.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9])${veilig}(?![0-9])`);
};

/** Tekst van één pagina als één string. Items krijgen een spatie ertussen:
 *  pdfjs knipt op woord-/positieniveau, en aan elkaar plakken zou van
 *  "1" + "2116" een vals "12116" maken. */
export const paginaTekst = (items: readonly unknown[]): string =>
  items
    .map((item) => {
      const str = (item as { str?: unknown } | null)?.str;
      return typeof str === 'string' ? str : '';
    })
    .join(' ');

export const telViercijferigeNummers = (tekst: string): number => {
  const gezien = new Set<string>();
  for (const m of tekst.matchAll(VIERCIJFERIG)) gezien.add(m[2]);
  return gezien.size;
};

/** Een treffer in het eerste deel van de paginatekst (de kop: "Ritblad
 *  dienst 2116") weegt zwaarder dan een vermelding verderop ("aflossing
 *  dienst 2116" op het blad van een ándere dienst). */
const KOP_AANDEEL = 0.3;
const KOP_MIN_TEKENS = 80;

export const staatInKop = (tekst: string, re: RegExp): boolean => {
  const m = re.exec(tekst);
  if (!m) return false;
  const positie = m.index + m[1].length;
  return positie < Math.max(KOP_MIN_TEKENS, tekst.length * KOP_AANDEEL);
};

/**
 * Pagina's (1-gebaseerd, oplopend) waarop het dienstnummer als los getal
 * voorkomt. Staat het nummer op minstens één pagina in de kop, dan tellen
 * alleen die pagina's (vermeldingen op andermans blad vallen af); anders
 * alle pagina's met een vermelding. Leeg bij een scan zonder tekstlaag of
 * als niets matcht — de viewer valt dan terug op de volledige bundel.
 */
export async function zoekPaginasVoorDienst(doc: RitbladDocument, dienstnummer: string): Promise<number[]> {
  const nummer = dienstnummer.trim();
  if (!nummer) return [];
  const re = dienstnummerRegex(nummer);
  const inKop: number[] = [];
  const elders: number[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    let tekst = '';
    try {
      const pagina = await doc.getPage(n);
      tekst = paginaTekst((await pagina.getTextContent()).items);
    } catch {
      continue; // één kapotte pagina mag de rest niet tegenhouden
    }
    if (!re.test(tekst)) continue;
    if (telViercijferigeNummers(tekst) > MAX_NUMMERS_PER_BLAD) continue;
    (staatInKop(tekst, re) ? inKop : elders).push(n);
  }
  return inKop.length ? inKop : elders;
}

type PaginaCache = { uploadedAt: string; paginas: Record<string, number[]> };

const leesCache = (): PaginaCache | null => {
  try {
    const raw = window.localStorage.getItem(PAGINAS_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as PaginaCache;
    if (!cache || typeof cache.uploadedAt !== 'string' || typeof cache.paginas !== 'object') return null;
    return cache;
  } catch {
    return null;
  }
};

export const leesPaginasUitCache = (uploadedAt: string, dienstnummer: string): number[] | null => {
  const cache = leesCache();
  if (!cache || cache.uploadedAt !== uploadedAt) return null;
  const paginas = cache.paginas[dienstnummer.trim()];
  return Array.isArray(paginas) ? paginas : null;
};

export const schrijfPaginasNaarCache = (uploadedAt: string, dienstnummer: string, paginas: number[]): void => {
  try {
    const bestaand = leesCache();
    // Nieuwe bundel → oude resultaten weg; er is maar één bundel tegelijk.
    const cache: PaginaCache = bestaand && bestaand.uploadedAt === uploadedAt ? bestaand : { uploadedAt, paginas: {} };
    cache.paginas[dienstnummer.trim()] = paginas;
    window.localStorage.setItem(PAGINAS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage geblokkeerd/vol — dan zoeken we volgende keer gewoon opnieuw
  }
};

/** Zoeken met cache per bundel: het lezen van de tekstlaag gebeurt maar
 *  één keer per bundel + dienstnummer (ook een leeg resultaat wordt bewaard). */
export async function zoekPaginasVoorDienstGecached(
  doc: RitbladDocument,
  dienstnummer: string,
  uploadedAt: string,
): Promise<number[]> {
  const gecached = leesPaginasUitCache(uploadedAt, dienstnummer);
  if (gecached) return gecached;
  const paginas = await zoekPaginasVoorDienst(doc, dienstnummer);
  schrijfPaginasNaarCache(uploadedAt, dienstnummer, paginas);
  return paginas;
}

// === pdfjs laden (lazy) ===

type Pdfjs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<Pdfjs> | null = null;

/** pdfjs + worker uit de eigen bundel, één keer per sessie. */
export function laadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    // `?worker` (niet `?url`): Vite bundelt het worker-script als eigen
    // chunk (build: assets/pdf.worker.min-*.js, zelfde origin → CSP
    // worker-src 'self') en geeft een Worker-constructor terug die in dev én
    // build klopt. Met een kaal `?url` op een node_modules-bestand
    // pre-bundelt de dev-optimizer de worker als gewone module en krijg je
    // een object i.p.v. een string ("Invalid `workerSrc` type"). Eén
    // gedeelde worker per sessie via workerPort; pdfjs beëindigt die niet
    // bij loadingTask.destroy() — bewust, de volgende opening is dan sneller.
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?worker'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerPort = new worker.default();
      return pdfjs;
    }).catch((err) => {
      pdfjsPromise = null; // volgende poging mag opnieuw proberen
      throw err;
    });
  }
  return pdfjsPromise;
}

/**
 * De bundel openen als pdfjs-document. De bytes halen we zelf op met
 * `fetch`: zo loopt het verzoek door de service worker (cache-first op het
 * /ritblaadjes/-pad → werkt offline) i.p.v. door pdfjs' eigen range-
 * requests, die de SW-cache omzeilen.
 */
export async function laadRitbladDocument(url: string): Promise<import('pdfjs-dist').PDFDocumentProxy> {
  const [pdfjs, res] = await Promise.all([laadPdfjs(), fetch(url)]);
  if (!res.ok) throw new Error(`Bundel ophalen mislukte (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  // pdfjs v6 compileert niets meer via new Function() (de oude
  // isEvalSupported-vlag bestaat niet meer) — werkt dus onder de CSP zonder
  // 'unsafe-eval'; de build-controle in het harnas bevestigt dat.
  return pdfjs.getDocument({ data }).promise;
}
