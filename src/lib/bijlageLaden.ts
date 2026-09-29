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
 */

export type BijlageBron = {
  soort: BijlageSoort;
  recordId: string;
  slot: number;
  filename: string;
  sizeBytes?: number;
  uploadedAt?: string;
  url: string;
};

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

export type VerseBijlage =
  | { status: 'vers'; bron: BijlageBron }
  /** De verse lijst kent deze bijlage niet meer. */
  | { status: 'weg' }
  /** Geen verse lijst te krijgen (geen bereik, serverfout, lijst uit de cache). */
  | { status: 'onbekend' };

/** De bijlage zoals de server ze NU kent, met een verse link. */
export async function haalVerseBijlage(bron: Pick<BijlageBron, 'soort' | 'recordId' | 'slot'>, signal?: AbortSignal): Promise<VerseBijlage> {
  try {
    const response = await apiFetch(LIJST_PAD[bron.soort], { cache: 'no-store', signal });
    if (!response.ok || response.headers.get('x-vhb-bron') === 'cache') return { status: 'onbekend' };
    const lijst = (await response.json()) as unknown;
    if (!Array.isArray(lijst)) return { status: 'onbekend' };
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

const download = async (url: string, signal: AbortSignal | undefined, deps: Deps): Promise<Uint8Array | null> => {
  try {
    const res = await deps.fetch(url, { signal });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return isPdf(bytes) ? bytes : null;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
};

export async function laadBijlage(bron: BijlageBron, signal?: AbortSignal, deps: Partial<Deps> = {}): Promise<GeladenBijlage> {
  const d: Deps = { ...STANDAARD, ...deps };
  let huidig = bron;
  let sleutel = bijlageSleutel(huidig.url);

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
    sleutel = bijlageSleutel(huidig.url);
    return true;
  };

  if (linkVerlopen(huidig.url, d.nu())) await ververs();
  let bytes = await download(huidig.url, signal, d);
  if (!bytes && !verseGevraagd && (await ververs())) bytes = await download(huidig.url, signal, d);
  if (!bytes) throw new Error('Bijlage ophalen mislukte.');

  const bewaard = sleutel ? await d.bewaar(sleutel, huidig.soort, bijlageVersie(huidig), bytes, d.nu()) : false;
  return { bytes, bewaard, url: huidig.url, sleutel };
}
