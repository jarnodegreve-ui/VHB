import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BIJLAGEN_CACHE, KOP_GEBRUIKT, KOP_SOORT, KOP_VERSIE, MAX_BIJLAGEN, MAX_BIJLAGEN_BYTES,
  bewaarBijlage, bijlageSleutel, bijlageVersie, leesBijlage, teSnoeien, vergeetBijlage,
} from './bijlageCache';
import { wisPriveCaches } from './afmelden';
import { bronVanBijlage } from './bijlageLaden';

/** Nep-Cache Storage met meerdere caches, zoals de browser ze heeft. */
function nepCaches() {
  const opslag = new Map<string, Map<string, Response>>();
  const sleutel = (req: Request | string | { url: string }) => (typeof req === 'string' ? req : req.url);
  const open = async (naam: string) => {
    if (!opslag.has(naam)) opslag.set(naam, new Map());
    const inhoud = opslag.get(naam)!;
    return {
      match: async (req: Request | string) => inhoud.get(sleutel(req))?.clone(),
      put: async (req: Request | string, res: Response) => { inhoud.set(sleutel(req), res); },
      delete: async (req: Request | string) => inhoud.delete(sleutel(req)),
      keys: async () => [...inhoud.keys()].map((url) => ({ url })),
    };
  };
  return {
    opslag,
    api: {
      open,
      has: async (naam: string) => opslag.has(naam),
      keys: async () => [...opslag.keys()],
      delete: async (naam: string) => opslag.delete(naam),
    },
  };
}

const PLAN = 'https://x.supabase.co/storage/v1/object/sign/diversions/o-1-1.pdf';
const bytes = (n: number, vulling = 7) => new Uint8Array(n).fill(vulling);

describe('bijlageCache: sleutel en versie', () => {
  it('sleutelt op het pad, zonder het token in de query', () => {
    expect(bijlageSleutel(`${PLAN}?token=eerste`)).toBe(PLAN);
    expect(bijlageSleutel(`${PLAN}?token=tweede&download=1`)).toBe(PLAN);
    // Een andere plaats of een ander record is een andere sleutel.
    expect(bijlageSleutel('https://x.supabase.co/storage/v1/object/sign/diversions/o-1-2.pdf?token=a')).not.toBe(PLAN);
    expect(bijlageSleutel('https://x.supabase.co/storage/v1/object/sign/update-bijlagen/o-1-1.pdf?token=a')).not.toBe(PLAN);
    expect(bijlageSleutel('geen url')).toBeNull();
  });

  it('de versie verandert met bestandsnaam, grootte of uploadmoment, niet met de link', () => {
    const basis = { filename: 'plan.pdf', sizeBytes: 1200 };
    expect(bijlageVersie(basis)).toBe(bijlageVersie({ ...basis }));
    expect(bijlageVersie({ ...basis, filename: 'plan-v2.pdf' })).not.toBe(bijlageVersie(basis));
    expect(bijlageVersie({ ...basis, sizeBytes: 1201 })).not.toBe(bijlageVersie(basis));
    expect(bijlageVersie({ ...basis, uploadedAt: '2026-09-29T08:00:00Z' })).not.toBe(bijlageVersie(basis));
    // Zonder grootte (PDF van vóór 25-09) blijft het een geldige, vaste versie.
    expect(bijlageVersie({ filename: 'omleiding.pdf' })).toBe('omleiding.pdf||');
  });

  it('de versie is ASCII, zodat ze als responskop kan reizen', () => {
    const versie = bijlageVersie({ filename: 'Omleiding lijn 58 – halte Café “De Kroon”.pdf', sizeBytes: 10 });
    expect(versie).toMatch(/^[\x20-\x7e]+$/);
    expect(() => new Headers({ [KOP_VERSIE]: versie })).not.toThrow();
  });

  it('de cache draagt een versienummer in haar naam', () => {
    expect(BIJLAGEN_CACHE).toMatch(/^vhb-bijlagen-v\d+$/);
  });
});

describe('bijlageCache: begrenzing', () => {
  const entry = (n: number, gebruiktOp: number, grootte = 1000) => ({ sleutel: `https://x/b-${n}.pdf`, gebruiktOp, bytes: grootte });

  it('laat alles staan zolang aantal en totale grootte binnen de grens blijven', () => {
    expect(teSnoeien([entry(1, 10), entry(2, 20)], 2, 5000)).toEqual([]);
    expect(MAX_BIJLAGEN).toBe(20);
    expect(MAX_BIJLAGEN_BYTES).toBe(40 * 1024 * 1024);
  });

  it('gooit bij te veel bestanden de langst niet geopende eerst weg', () => {
    // Volgorde van invoegen zegt niets: het gebruiksmoment telt.
    const weg = teSnoeien([entry(1, 300), entry(2, 100), entry(3, 200), entry(4, 400)], 2, 1e9);
    expect(weg).toEqual(['https://x/b-2.pdf', 'https://x/b-3.pdf']);
  });

  it('gooit bij te veel bytes weg tot het totaal weer past', () => {
    const weg = teSnoeien([entry(1, 1, 3000), entry(2, 2, 3000), entry(3, 3, 3000)], 20, 6500);
    expect(weg).toEqual(['https://x/b-1.pdf']);
  });

  it('houdt het laatst geopende bestand altijd, ook als het alleen al te groot is', () => {
    expect(teSnoeien([entry(1, 1, 9000), entry(2, 2, 9000)], 20, 100)).toEqual(['https://x/b-1.pdf']);
  });
});

describe('bijlageCache: lezen en bewaren', () => {
  let nep: ReturnType<typeof nepCaches>;
  beforeEach(() => {
    nep = nepCaches();
    vi.stubGlobal('caches', nep.api);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('bewaart na een download en leest daarna dezelfde bytes terug', async () => {
    const versie = bijlageVersie({ filename: 'plan.pdf', sizeBytes: 4 });
    expect(await leesBijlage(PLAN, versie)).toBeNull();
    expect(await bewaarBijlage(PLAN, 'omleiding', versie, bytes(4), 1000)).toBe(true);
    const terug = await leesBijlage(PLAN, versie, 2000);
    expect(terug && [...terug]).toEqual([7, 7, 7, 7]);
    const bewaard = nep.opslag.get(BIJLAGEN_CACHE)!.get(PLAN)!;
    expect(bewaard.headers.get(KOP_SOORT)).toBe('omleiding');
    expect(bewaard.headers.get(KOP_VERSIE)).toBe(versie);
    // Lezen zet het gebruiksmoment op nu: zo weet de begrenzing wat oud is.
    expect(bewaard.headers.get(KOP_GEBRUIKT)).toBe('2000');
  });

  it('een vervangen bijlage op dezelfde plaats toont nooit het vorige bestand', async () => {
    const oud = bijlageVersie({ filename: 'plan.pdf', sizeBytes: 4 });
    const nieuw = bijlageVersie({ filename: 'plan.pdf', sizeBytes: 5 });
    await bewaarBijlage(PLAN, 'omleiding', oud, bytes(4, 1));
    // Zelfde pad, andere versie: niet bewaard, en het oude bestand gaat weg.
    expect(await leesBijlage(PLAN, nieuw)).toBeNull();
    expect(nep.opslag.get(BIJLAGEN_CACHE)!.has(PLAN)).toBe(false);
    await bewaarBijlage(PLAN, 'omleiding', nieuw, bytes(5, 2));
    const terug = await leesBijlage(PLAN, nieuw);
    expect(terug && [...terug]).toEqual([2, 2, 2, 2, 2]);
  });

  // Uploadmoment (29-09): de server zet het bij elke upload en de viewer geeft
  // het door (bronVanBijlage). Een vervanging met exact dezelfde naam en
  // grootte op dezelfde plaats was voor de cache vroeger hetzelfde bestand.
  it('een vervanging met dezelfde naam en grootte (ander uploadmoment) toont nooit het vorige bestand', async () => {
    const element = { slot: 1, filename: 'plan.pdf', sizeBytes: 4 };
    const oud = bronVanBijlage('omleiding', 'o-1', { ...element, uploadedAt: '2026-09-29T08:00:00.000Z', url: `${PLAN}?token=gisteren` });
    const nieuw = bronVanBijlage('omleiding', 'o-1', { ...element, uploadedAt: '2026-09-29T09:30:00.000Z', url: `${PLAN}?token=vandaag` });
    expect(bijlageSleutel(nieuw.url)).toBe(bijlageSleutel(oud.url));
    expect(bijlageVersie(nieuw)).not.toBe(bijlageVersie(oud));
    await bewaarBijlage(bijlageSleutel(oud.url)!, 'omleiding', bijlageVersie(oud), bytes(4, 1));
    // De nieuwe versie leest het oude bestand niet, en het oude gaat weg.
    expect(await leesBijlage(bijlageSleutel(nieuw.url)!, bijlageVersie(nieuw))).toBeNull();
    expect(nep.opslag.get(BIJLAGEN_CACHE)!.has(PLAN)).toBe(false);
    await bewaarBijlage(bijlageSleutel(nieuw.url)!, 'omleiding', bijlageVersie(nieuw), bytes(4, 2));
    const terug = await leesBijlage(bijlageSleutel(nieuw.url)!, bijlageVersie(nieuw));
    expect(terug && [...terug]).toEqual([2, 2, 2, 2]);
    // Een bijlage zonder uploadmoment (van vóór 29-09) houdt haar vaste versie.
    expect(bijlageVersie(bronVanBijlage('omleiding', 'o-1', { ...element, url: PLAN }))).toBe('plan.pdf|4|');
  });

  it('een gewone heropening met een nieuw token is dezelfde bijlage', async () => {
    const versie = bijlageVersie({ filename: 'plan.pdf', sizeBytes: 4 });
    await bewaarBijlage(bijlageSleutel(`${PLAN}?token=gisteren`)!, 'omleiding', versie, bytes(4));
    expect(await leesBijlage(bijlageSleutel(`${PLAN}?token=vandaag`)!, versie)).not.toBeNull();
  });

  it('begrenst bij het bewaren: de langst niet geopende gaat weg', async () => {
    for (let i = 1; i <= MAX_BIJLAGEN; i++) await bewaarBijlage(`https://x/b-${i}.pdf`, 'update', 'v', bytes(2), i);
    // De oudste opnieuw openen maakt haar de jongste.
    await leesBijlage('https://x/b-1.pdf', 'v', 500);
    await bewaarBijlage('https://x/b-nieuw.pdf', 'update', 'v', bytes(2), 600);
    const over = [...nep.opslag.get(BIJLAGEN_CACHE)!.keys()];
    expect(over).toHaveLength(MAX_BIJLAGEN);
    expect(over).toContain('https://x/b-1.pdf');
    expect(over).toContain('https://x/b-nieuw.pdf');
    expect(over).not.toContain('https://x/b-2.pdf');
  });

  it('lezen maakt geen lege cache aan, en vergeten haalt één bestand weg', async () => {
    expect(await leesBijlage(PLAN, 'v')).toBeNull();
    expect(nep.opslag.has(BIJLAGEN_CACHE)).toBe(false);
    await bewaarBijlage(PLAN, 'omleiding', 'v', bytes(3));
    await vergeetBijlage(PLAN);
    expect(await leesBijlage(PLAN, 'v')).toBeNull();
  });

  it('zonder Cache Storage opent de bijlage gewoon, alleen niet offline', async () => {
    vi.stubGlobal('caches', { has: async () => { throw new Error('geblokkeerd'); }, open: async () => { throw new Error('geblokkeerd'); } });
    expect(await leesBijlage(PLAN, 'v')).toBeNull();
    expect(await bewaarBijlage(PLAN, 'omleiding', 'v', bytes(3))).toBe(false);
  });

  it('uitloggen wist ook de bijlagen: de volgende gebruiker vindt niets van de vorige', async () => {
    await bewaarBijlage(PLAN, 'omleiding', 'v', bytes(3));
    await (await nep.api.open('vhb-ritbladen')).put('https://x/ritblaadjes/b.pdf', new Response('x'));
    expect(await nep.api.has(BIJLAGEN_CACHE)).toBe(true);
    await wisPriveCaches();
    expect(await nep.api.keys()).toEqual([]);
    expect(await leesBijlage(PLAN, 'v')).toBeNull();
  });
});
