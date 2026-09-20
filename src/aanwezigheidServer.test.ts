import { describe, it, expect, beforeEach } from 'vitest';
import { HARTSLAG_MS, LOCATIE_MAX, SESSIE_GAT_MS, hoortBijSessie, locatieUitHeaders, magSchrijven, vergeetHartslagen } from '../api/_lib/aanwezigheid';

/**
 * De twee beslissingen die bepalen hoeveel het bijhouden van aanwezigheid het
 * portaal kost, en hoe het beeld eruitziet:
 *
 *  - magSchrijven: de rem. Zonder deze rem zou élk geauthenticeerd verzoek
 *    een schrijfactie worden, en het portaal doet er per zichtbaar tabblad
 *    al één per minuut.
 *  - hoortBijSessie: oprekken of een nieuwe rij. Te streng knipt een dienst
 *    in stukken, te soepel plakt een ochtend- en avonddienst aan elkaar.
 */

beforeEach(() => vergeetHartslagen());

describe('magSchrijven', () => {
  it('laat de eerste keer altijd door', () => {
    expect(magSchrijven('u1', 1_000_000)).toBe(true);
  });

  it('houdt alles binnen het hartslagvenster tegen', () => {
    const nu = 1_000_000;
    expect(magSchrijven('u1', nu)).toBe(true);
    expect(magSchrijven('u1', nu + 1000)).toBe(false);
    expect(magSchrijven('u1', nu + HARTSLAG_MS - 1)).toBe(false);
  });

  it('laat weer door zodra het venster om is', () => {
    const nu = 1_000_000;
    expect(magSchrijven('u1', nu)).toBe(true);
    expect(magSchrijven('u1', nu + HARTSLAG_MS)).toBe(true);
  });

  it('remt per gebruiker, niet globaal', () => {
    const nu = 1_000_000;
    expect(magSchrijven('u1', nu)).toBe(true);
    expect(magSchrijven('u2', nu)).toBe(true);
  });

  it('laat gelijktijdige verzoeken van dezelfde persoon er samen één door', () => {
    // Twee tabbladen die op hetzelfde moment pollen: de eerste registreert,
    // de tweede ziet dat en houdt zijn mond.
    const nu = 1_000_000;
    const uitkomsten = [magSchrijven('u1', nu), magSchrijven('u1', nu), magSchrijven('u1', nu)];
    expect(uitkomsten.filter(Boolean)).toHaveLength(1);
  });
});

describe('hoortBijSessie', () => {
  const nu = Date.parse('2026-09-18T09:00:00Z');
  const geleden = (ms: number) => new Date(nu - ms).toISOString();

  it('rekt de lopende sessie op bij een verse hartslag', () => {
    expect(hoortBijSessie(geleden(3 * 60 * 1000), nu)).toBe(true);
  });

  it('rekt nog op precies op de rand van het sessiegat', () => {
    expect(hoortBijSessie(geleden(SESSIE_GAT_MS), nu)).toBe(true);
  });

  it('begint een nieuwe sessie na een langere stilte', () => {
    expect(hoortBijSessie(geleden(SESSIE_GAT_MS + 1000), nu)).toBe(false);
    expect(hoortBijSessie(geleden(4 * 60 * 60 * 1000), nu)).toBe(false);
  });

  it('begint een nieuwe sessie als er nog nooit iets was', () => {
    expect(hoortBijSessie(null, nu)).toBe(false);
  });

  it('begint een nieuwe sessie bij onleesbare invoer', () => {
    expect(hoortBijSessie('geen-datum', nu)).toBe(false);
  });

  it('overleeft een klok die voorloopt', () => {
    // Twee serverless-instanties kunnen een paar seconden uiteenlopen. Zonder
    // deze regel opent elke scheve klok een nieuwe sessie.
    expect(hoortBijSessie(new Date(nu + 5000).toISOString(), nu)).toBe(true);
  });

  it('houdt een gesplitste dienst uit elkaar', () => {
    // Ochtenddeel om 06:00 afgelopen, avonddeel begint om 16:00: dat hoort
    // twee blokken te worden, geen doorlopende balk van tien uur.
    const ochtendEinde = Date.parse('2026-09-18T06:00:00Z');
    const avondStart = Date.parse('2026-09-18T16:00:00Z');
    expect(hoortBijSessie(new Date(ochtendEinde).toISOString(), avondStart)).toBe(false);
  });
});

/**
 * De plaats van aanmelden komt uit headers, dus uit invoer van buitenaf. Wat
 * er ook binnenkomt: het resultaat is een nette plaats of null, nooit een
 * exception (de aanroeper zit in de auth-middleware) en nooit een waarde die
 * de check-constraints in 2026-09-20_user_presence_locatie.sql zou breken.
 */
describe('locatieUitHeaders', () => {
  it('leest land, regio en stad uit de Vercel-headers', () => {
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-country-region': 'VOV', 'x-vercel-ip-city': 'Gent' }))
      .toEqual({ land: 'BE', regio: 'VOV', stad: 'Gent' });
  });

  it('decodeert een URL-gecodeerde plaatsnaam', () => {
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BR', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' })?.stad).toBe('São Paulo');
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': 'Sint-Pieters-Leeuw' })?.stad).toBe('Sint-Pieters-Leeuw');
  });

  it('geeft null zonder headers: lokaal en in tests zet niemand ze', () => {
    expect(locatieUitHeaders({})).toBeNull();
    expect(locatieUitHeaders(undefined)).toBeNull();
    expect(locatieUitHeaders(null)).toBeNull();
    expect(locatieUitHeaders({ 'x-vercel-ip-city': 'Gent' })).toBeNull();
  });

  it('houdt het land over wanneer regio of stad ontbreken', () => {
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'NL' })).toEqual({ land: 'NL', regio: null, stad: null });
  });

  it('zet het land in hoofdletters en weigert wat geen landcode is', () => {
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'be' })?.land).toBe('BE');
    for (const kapot of ['', 'B', 'BEL', 'B3', 'XX', '<script>', '  ']) {
      expect(locatieUitHeaders({ 'x-vercel-ip-country': kapot, 'x-vercel-ip-city': 'Gent' })).toBeNull();
    }
  });

  it('overleeft een kapot gecodeerde plaatsnaam: stad null, land blijft', () => {
    // decodeURIComponent gooit een URIError op een losse % of een afgebroken reeks.
    for (const kapot of ['%', '%E0%A4%A', 'Gent%', '%C3']) {
      expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': kapot })).toEqual({ land: 'BE', regio: null, stad: null });
    }
  });

  it('weigert een te lange plaatsnaam in plaats van hem af te kappen', () => {
    const opDeRand = 'x'.repeat(LOCATIE_MAX.stad);
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': opDeRand })?.stad).toBe(opDeRand);
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': `${opDeRand}x` })?.stad).toBeNull();
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': 'x'.repeat(5000) })?.stad).toBeNull();
    // Gecodeerd kort genoeg lijken telt niet: de grens geldt ná het decoderen,
    // en omgekeerd mag een lange codering van een korte naam gewoon door.
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': '%C3%A9'.repeat(LOCATIE_MAX.stad) })?.stad).toHaveLength(LOCATIE_MAX.stad);
  });

  it('weigert een regio die geen ISO-deel kan zijn', () => {
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-country-region': 'vov' })?.regio).toBe('VOV');
    for (const kapot of ['VOVX', 'V-B', '', '%20']) {
      expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-country-region': kapot })?.regio).toBeNull();
    }
  });

  it('haalt stuurtekens en regeleindes uit de plaatsnaam', () => {
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': 'Gent%0D%0AX-Kwaad%3A%201' })?.stad).toBe('Gent X-Kwaad: 1');
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 'BE', 'x-vercel-ip-city': '%20%09%20' })?.stad).toBeNull();
  });

  it('neemt bij een herhaalde header de eerste waarde', () => {
    expect(locatieUitHeaders({ 'x-vercel-ip-country': ['BE', 'FR'], 'x-vercel-ip-city': ['Gent', 'Lille'] })).toEqual({ land: 'BE', regio: null, stad: 'Gent' });
  });

  it('gooit nooit, ook niet op onzin', () => {
    expect(() => locatieUitHeaders({ 'x-vercel-ip-country': 42 as unknown as string })).not.toThrow();
    expect(locatieUitHeaders({ 'x-vercel-ip-country': 42 as unknown as string })).toBeNull();
  });
});
