import { apiFetch } from './api';
import { bewaarBijlage, bijlageSleutel, bijlageVersie, leesBijlage, type BijlageSoort } from './bijlageCache';

/**
 * De bytes van één bijlage ophalen voor de viewer in de app.
 *
 * Volgorde:
 *  1. staat ze bewaard (zelfde plaats, zelfde versie), dan komt ze van het
 *     toestel: geen netwerk nodig, dus ook zonder bereik en ook met een link
 *     die intussen verlopen is;
 *  2. anders downloaden. De link in de lijst is ondertekend en leeft 12 uur;
 *     wie de app na een nacht hervat heeft een verlopen link in handen. Is de
 *     link (bijna) verlopen, dan vragen we eerst een verse; geeft de download
 *     toch een fout, dan één keer een verse link en opnieuw;
 *  3. na een geslaagde download gaat het bestand in de cache.
 *
 * Een verse link komt uit de lijst zelf (`/api/diversions`, `/api/updates`):
 * er is geen route per bijlage, de server ondertekent bij elke lijst. Komt
 * die lijst uit de cache van de service worker (geen bereik), dan is ze niet
 * vers en zegt ze niets.
 *
 * **Zonder bewaren** (29-09, persoonlijke documenten: loonbrieven, attesten).
 * Jarno: "mogen intern openen, maar mogen niet persistent offline op het
 * toestel worden opgeslagen". Dezelfde lader in een uitdrukkelijke modus,
 * `bewaren: false`, geen tweede lader: stap 1 en 3 vallen weg (geen lezen
 * uit en geen schrijven naar de cache op het toestel) en de download gaat met
 * `cache: 'no-store'`, zodat ook de HTTP-cache van de browser niets bijhoudt
 * (de opslag stuurt een Cache-Control-kop mee). De bytes gaan daarna alleen
 * naar pdfjs, nooit naar een object-URL. Een DocumentBron zonder
 * `bewaren: false` is een typefout, en `magBewaren` weigert een persoonlijk
 * document ook als iemand de typecheck omzeilt.
 */

/** Een bijlage van een omleiding of update: na een geslaagde download op het
 *  toestel bewaard, zodat ze ook zonder bereik opent (bijlageCache.ts). */
export type BijlageBron = {
  soort: BijlageSoort;
  /** Weglaten = bewaren. Er bestaat maar één andere modus, en die hoort bij
   *  een persoonlijk document (DocumentBron). */
  bewaren?: true;
  recordId: string;
  slot: number;
  filename: string;
  sizeBytes?: number;
  uploadedAt?: string;
  url: string;
};

/** Een persoonlijk document zoals /api/documents het geeft, voor zover de
 *  viewer het nodig heeft. */
export type PersoonlijkDocument = { id: string; filename: string; sizeBytes?: number | null; url: string | null };

/**
 * Een persoonlijk document (loonbrief, attest): opent in de app, maar blijft
 * NOOIT op het toestel. `bewaren: false` is verplicht.
 */
export type DocumentBron = {
  soort: 'document';
  bewaren: false;
  /** Id van het document. */
  recordId: string;
  /** De documentenlijst waar een verse link uit komt: `/api/documents` voor
   *  de eigen documenten, `/api/documents?userId=…` in het beheer. */
  lijst: string;
  filename: string;
  sizeBytes?: number;
  url: string;
};

/** Wat de lader aanneemt: een bijlage (bewaren) of een persoonlijk document (niet). */
export type LaadBron = BijlageBron | DocumentBron;

/** Mag dit bestand op het toestel blijven? Een persoonlijk document nooit,
 *  ook niet als de modus ontbreekt; een bijlage alleen zonder `bewaren: false`. */
export const magBewaren = (bron: { soort: string; bewaren?: boolean }): boolean =>
  bron.soort !== 'document' && bron.bewaren !== false;

/**
 * De bron voor de lader, uit een bijlage zoals de server ze in de lijst geeft.
 * Alles wat de versie in de cache bepaalt gaat mee (bestandsnaam, grootte en
 * sinds 29-09 het uploadmoment van de server), zodat een vervanging met
 * dezelfde naam en grootte nooit het vorige bestand van het toestel toont.
 * Een bijlage zonder uploadmoment (van vóór 29-09) houdt haar vaste versie.
 */
export const bronVanBijlage = (
  soort: BijlageSoort,
  recordId: string,
  b: { slot: number; filename: string; sizeBytes?: number; uploadedAt?: string; url?: string },
): BijlageBron => ({
  soort,
  recordId,
  slot: b.slot,
  filename: b.filename,
  sizeBytes: b.sizeBytes,
  uploadedAt: b.uploadedAt,
  url: b.url ?? '',
});

/** De bron voor de lader, uit een persoonlijk document: altijd zonder bewaren. */
export const bronVanDocument = (doc: PersoonlijkDocument, lijst: string): DocumentBron => ({
  soort: 'document',
  bewaren: false,
  recordId: doc.id,
  lijst,
  filename: doc.filename,
  sizeBytes: typeof doc.sizeBytes === 'number' ? doc.sizeBytes : undefined,
  url: doc.url ?? '',
});

export type GeladenBijlage = {
  bytes: Uint8Array;
  /** Staat het bestand (nu) op het toestel? */
  bewaard: boolean;
  /** De laatst bekende link, voor "Extern openen". */
  url: string;
  sleutel: string | null;
};

/** De bijlage staat niet meer in de verse lijst: verwijderd, of het record is weg. */
export class BijlageWeg extends Error {
  constructor() {
    super('De bijlage bestaat niet meer.');
    this.name = 'BijlageWeg';
  }
}

/** Marge vóór het verlopen waarbinnen we de link al als verlopen behandelen:
 *  een download van 3,5 MB op een trage verbinding mag niet halverwege stranden. */
export const LINK_MARGE_MS = 2 * 60 * 1000;

/** Verloopmoment (ms) uit het token van een ondertekende URL, of null als de
 *  URL er geen draagt dat we kunnen lezen. */
export const linkVerlooptOp = (url: string): number | null => {
  try {
    const token = new URL(url).searchParams.get('token');
    const deel = token?.split('.')[1];
    if (!deel) return null;
    const json = atob(deel.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = Number((JSON.parse(json) as { exp?: unknown }).exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
};

/** Is de link verlopen of verloopt hij binnen de marge? Onbekend = nee: dan
 *  proberen we gewoon, en een fout haalt alsnog een verse link op. */
export const linkVerlopen = (url: string, nu = Date.now()): boolean => {
  const op = linkVerlooptOp(url);
  return op !== null && op - LINK_MARGE_MS <= nu;
};

const LIJST_PAD: Record<BijlageSoort, string> = { omleiding: '/api/diversions', update: '/api/updates' };

type LijstBijlage = { slot?: unknown; filename?: unknown; sizeBytes?: unknown; uploadedAt?: unknown; url?: unknown };
type LijstRecord = { id?: unknown; bijlagen?: unknown };
type LijstDocument = { id?: unknown; filename?: unknown; sizeBytes?: unknown; url?: unknown };

/** Wat nodig is om een verse link te vragen. */
export type VerseVraag = Pick<BijlageBron, 'soort' | 'recordId' | 'slot'> | Pick<DocumentBron, 'soort' | 'bewaren' | 'recordId' | 'lijst'>;

export type VerseBijlage =
  | { status: 'vers'; bron: LaadBron }
  /** De verse lijst kent deze bijlage niet meer. */
  | { status: 'weg' }
  /** Geen verse lijst te krijgen (geen bereik, serverfout, lijst uit de cache). */
  | { status: 'onbekend' };

/** De bijlage (of het persoonlijke document) zoals de server ze NU kent, met een verse link. */
export async function haalVerseBijlage(bron: VerseVraag, signal?: AbortSignal): Promise<VerseBijlage> {
  try {
    const response = await apiFetch(bron.soort === 'document' ? bron.lijst : LIJST_PAD[bron.soort], { cache: 'no-store', signal });
    if (!response.ok || response.headers.get('x-vhb-bron') === 'cache') return { status: 'onbekend' };
    const lijst = (await response.json()) as unknown;
    if (!Array.isArray(lijst)) return { status: 'onbekend' };
    if (bron.soort === 'document') {
      // Een persoonlijk document is zelf het record: geen plaats in een lijst.
      const d = (lijst as LijstDocument[]).find((x) => String(x?.id) === bron.recordId);
      if (!d || typeof d.url !== 'string' || !d.url) return { status: 'weg' };
      return {
        status: 'vers',
        bron: {
          soort: 'document',
          bewaren: false,
          recordId: bron.recordId,
          lijst: bron.lijst,
          filename: String(d.filename ?? ''),
          sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : undefined,
          url: d.url,
        },
      };
    }
    const record = (lijst as LijstRecord[]).find((r) => String(r?.id) === bron.recordId);
    const bijlagen = Array.isArray(record?.bijlagen) ? (record.bijlagen as LijstBijlage[]) : [];
    const b = bijlagen.find((x) => Number(x?.slot) === bron.slot);
    if (!b || typeof b.url !== 'string' || !b.url) return { status: 'weg' };
    return {
      status: 'vers',
      bron: {
        ...bron,
        filename: String(b.filename ?? ''),
        sizeBytes: typeof b.sizeBytes === 'number' ? b.sizeBytes : undefined,
        uploadedAt: typeof b.uploadedAt === 'string' ? b.uploadedAt : undefined,
        url: b.url,
      },
    };
  } catch {
    return { status: 'onbekend' };
  }
}

/** Begint dit bestand als een PDF? De kop "%PDF-" staat binnen de eerste
 *  1024 bytes. Een foutpagina met status 200 (inlogscherm van een wifi-
 *  netwerk, de SPA-terugval) mag nooit als bijlage bewaard worden. */
export const isPdf = (bytes: Uint8Array): boolean => {
  const kop = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const tot = Math.min(bytes.length, 1024) - kop.length;
  for (let i = 0; i <= tot; i++) {
    if (kop.every((teken, j) => bytes[i + j] === teken)) return true;
  }
  return false;
};

type Deps = {
  fetch: typeof fetch;
  lees: typeof leesBijlage;
  bewaar: typeof bewaarBijlage;
  vers: typeof haalVerseBijlage;
  nu: () => number;
};

const STANDAARD: Deps = {
  fetch: (...args) => fetch(...args),
  lees: leesBijlage,
  bewaar: bewaarBijlage,
  vers: haalVerseBijlage,
  nu: () => Date.now(),
};

const download = async (url: string, signal: AbortSignal | undefined, deps: Deps, bewaren: boolean): Promise<Uint8Array | null> => {
  // Geen link (een document dat de server niet kon ondertekenen): dan eerst een verse.
  if (!url) return null;
  try {
    // Wat niet op het toestel mag blijven, gaat ook niet in de HTTP-cache.
    const res = await deps.fetch(url, bewaren ? { signal } : { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return isPdf(bytes) ? bytes : null;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
};

export async function laadBijlage(bron: LaadBron, signal?: AbortSignal, deps: Partial<Deps> = {}): Promise<GeladenBijlage> {
  const d: Deps = { ...STANDAARD, ...deps };
  // Eén keer bepaald, op de bron zoals ze binnenkwam: een verse link
  // verandert nooit de modus.
  const bewaren = magBewaren(bron);
  let huidig: LaadBron = bron;
  let sleutel = bewaren ? bijlageSleutel(huidig.url) : null;

  if (sleutel) {
    const bewaard = await d.lees(sleutel, bijlageVersie(huidig), d.nu());
    if (bewaard) return { bytes: bewaard, bewaard: true, url: huidig.url, sleutel };
  }

  // Eén keer een verse link per poging: vooraf als de link al verlopen is,
  // anders pas na een mislukte download.
  let verseGevraagd = false;
  const ververs = async (): Promise<boolean> => {
    verseGevraagd = true;
    const vers = await d.vers(huidig, signal);
    if (vers.status === 'weg') throw new BijlageWeg();
    if (vers.status !== 'vers') return false;
    huidig = vers.bron;
    sleutel = bewaren ? bijlageSleutel(huidig.url) : null;
    return true;
  };

  if (linkVerlopen(huidig.url, d.nu())) await ververs();
  let bytes = await download(huidig.url, signal, d, bewaren);
  if (!bytes && !verseGevraagd && (await ververs())) bytes = await download(huidig.url, signal, d, bewaren);
  if (!bytes) throw new Error('Bijlage ophalen mislukte.');

  const bewaard = sleutel && huidig.soort !== 'document' ? await d.bewaar(sleutel, huidig.soort, bijlageVersie(huidig), bytes, d.nu()) : false;
  return { bytes, bewaard, url: huidig.url, sleutel };
}
