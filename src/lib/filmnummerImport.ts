import {
  FILMNUMMER_CODE, MAX_FILMNUMMERS, MAX_FILM_LIJN, MAX_FILM_TEKST, filmTekst, normaliseerFilmnummers, type Filmnummer,
} from '../../shared/filmnummers';

/**
 * Import van de filmnummers (admin): een CSV- of Excel-bestand → de lijst die
 * naar PUT /api/filmnummers gaat. Alleen het importvenster laadt deze module;
 * het scherm van de chauffeur niet.
 *
 * Het bestand van VHB ("Filmbeelden", 01-10) heeft twee kolommen zonder
 * kopregel: het nummer en de tekst van de film, met de lijn vooraan in die
 * tekst ("50 Brugge Station", "G50 Eeklo Markt"). De lezer haalt de lijn daar
 * dan uit. Heeft het bestand wel een kopregel ("Code", "Lijn nummer",
 * "Boodschap", of een gangbare andere naam), dan volgt hij die, ook als er
 * meerdere blokken naast of onder elkaar op het blad staan; met drie kolommen
 * zonder kopregel geldt nummer, lijn, tekst. Wat hij niet kan lezen slaat hij
 * over en meldt hij met de regel erbij, zodat de admin het ziet vóór hij de
 * lijst vervangt.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type OvergeslagenRegel = { regel: number; inhoud: string; reden: string };

export type FilmImport = {
  items: Filmnummer[];
  overgeslagen: OvergeslagenRegel[];
  /** Hoe het bestand gelezen is, voor de uitleg in het voorbeeld. */
  gelezen: {
    /** Er stond een kopregel in het bestand. */
    kopregel: boolean;
    /** De lijn komt uit een eigen kolom (anders uit het begin van de tekst). */
    lijnKolom: boolean;
    /** De kopregel heeft een kolom Lijn die bij geen blok past en niet gebruikt is. */
    lijnKolomOngebruikt: boolean;
    /** Regels met iets in een kolom te veel, dat niet gelezen is. */
    extraCellen: number;
  };
};

/** "50 Brugge Station" → lijn 50, tekst "Brugge Station". Een lijn is een
 *  getal van hooguit drie cijfers, eventueel met een letter ervoor of erna
 *  (G50); "100% Electric" en "L Opleiding" zijn dus geen lijn. */
const LIJN_VOORAAN = /^([A-Za-z]{0,2}\d{1,3}[A-Za-z]?)\s+(\S.*)$/;
const LIJKT_LIJN = /^[A-Za-z]{0,2}\d{1,3}[A-Za-z]?$/;

/**
 * De lijn uit de tekst halen doet de lezer alleen bij een nummer van vier
 * cijfers of meer. In het bestand van VHB zijn dat de bestemmingen (5000
 * "50 Brugge Station"); de algemene boodschappen hebben een kort nummer (1
 * "Geen dienst", 94 "Stelplaats") en geen lijn, ook niet als hun tekst met
 * een getal begint ("24 uur van Maldegem", "11 juli").
 */
const LIJN_UIT_TEKST_VANAF = 4;

type Blok = { code: number; lijn: number | null; tekst: number };

const sleutel = (cel: unknown): string => filmTekst(cel).toLowerCase().replace(/[^a-z0-9]/g, '');

const CODE_KOPPEN = new Set(['code', 'codes', 'filmcode', 'filmnummer', 'filmnummers', 'filmnr', 'film', 'nummer', 'nr']);
// "Lijn nummer" is de lijn, niet het nummer; "Lijnnaam" is geen van beide.
const LIJN_KOPPEN = new Set(['lijn', 'lijnen', 'lijnnummer', 'lijnnr', 'line']);
const TEKST_KOPPEN = new Set(['boodschap', 'bestemming', 'eindbestemming', 'tekst', 'filmtekst', 'filmbeeld', 'omschrijving', 'benaming', 'naam']);

const soortKop = (cel: unknown): 'code' | 'lijn' | 'tekst' | null => {
  const k = sleutel(cel);
  if (LIJN_KOPPEN.has(k)) return 'lijn';
  if (CODE_KOPPEN.has(k)) return 'code';
  if (TEKST_KOPPEN.has(k)) return 'tekst';
  return null;
};

/**
 * Blokken (nummer, lijn, tekst) in een kopregel; leeg als het geen kopregel
 * is. De volgorde van de kolommen doet er niet toe. Staan er meerdere blokken
 * naast elkaar, dan hoort de zoveelste nummerkolom bij de zoveelste tekst- en
 * lijnkolom. Zijn er niet evenveel lijn- als nummerkolommen, dan is niet te
 * zeggen welke lijn bij welk blok hoort: de lijnkolom blijft dan ongebruikt
 * (`lijnOngebruikt`) en de lijn komt uit de tekst.
 */
const leesKop = (rij: readonly unknown[]): { blokken: Blok[]; lijnOngebruikt: boolean } => {
  const waar = (soort: 'code' | 'lijn' | 'tekst') => rij.flatMap((cel, i) => (soortKop(cel) === soort ? [i] : []));
  const codes = waar('code');
  const lijnen = waar('lijn');
  const teksten = waar('tekst');
  const gekoppeld = lijnen.length === codes.length;
  return {
    blokken: codes.slice(0, teksten.length).map((code, k) => ({ code, lijn: gekoppeld ? lijnen[k] : null, tekst: teksten[k] })),
    lijnOngebruikt: lijnen.length > 0 && !gekoppeld,
  };
};

const isLeeg = (rij: readonly unknown[]): boolean => rij.every((c) => filmTekst(c) === '');

/** Een getal uit Excel (5800) of tekst ("5800") → het nummer als tekst. */
const alsCode = (cel: unknown): string => (typeof cel === 'number' && Number.isInteger(cel) ? String(cel) : filmTekst(cel));

const alsLijn = (cel: unknown): string => alsCode(cel).replace(/^lijn\s*/i, '');

/**
 * De indeling zonder kopregel: nummer, lijn, tekst als de meeste regels iets
 * in een derde kolom hebben én de tweede kolom er als een lijn uitziet;
 * anders nummer, tekst. De meerderheid beslist, niet de breedste regel: één
 * opmerking naast een regel mag het hele bestand niet kantelen.
 */
const blokZonderKop = (rijen: readonly (readonly unknown[])[]): Blok => {
  const gevuld = rijen.filter((r) => !isLeeg(r));
  const metDerde = gevuld.filter((r) => filmTekst(r[2]) !== '');
  // Een algemene boodschap heeft een lege lijn: alleen de gevulde cellen tellen.
  const tweede = metDerde.map((r) => alsLijn(r[1])).filter(Boolean);
  const tweedeIsLijn = tweede.filter((l) => LIJKT_LIJN.test(l)).length * 2 >= tweede.length;
  return metDerde.length * 2 > gevuld.length && tweedeIsLijn ? { code: 0, lijn: 1, tekst: 2 } : { code: 0, lijn: null, tekst: 1 };
};

/** Rijen uit het bestand (cellen als tekst of getal) → de filmnummers, met wat overgeslagen is. */
export function filmnummersUitRijen(rijen: readonly (readonly unknown[])[]): FilmImport {
  const overgeslagen: OvergeslagenRegel[] = [];
  const gelezen = { kopregel: false, lijnKolom: false, lijnKolomOngebruikt: false, extraCellen: 0 };
  let blokken: Blok[] = [];
  const neemKop = (kop: ReturnType<typeof leesKop>) => {
    blokken = kop.blokken;
    gelezen.kopregel = true;
    gelezen.lijnKolom ||= kop.blokken.some((b) => b.lijn !== null);
    gelezen.lijnKolomOngebruikt ||= kop.lijnOngebruikt;
  };

  // De kopregel staat bovenaan, soms onder een titel: de eerste tien regels.
  let kopRegel = -1;
  for (let i = 0; i < Math.min(rijen.length, 10); i++) {
    const kop = leesKop(rijen[i]);
    if (kop.blokken.length > 0) { kopRegel = i; neemKop(kop); break; }
  }
  if (kopRegel < 0) {
    blokken = [blokZonderKop(rijen)];
    gelezen.lijnKolom = blokken[0].lijn !== null;
  }
  // Wat boven de kopregel staat is een titel. Een regel met een nummer erin
  // is dat niet: die valt niet stil weg.
  for (let i = 0; i < kopRegel; i++) {
    for (const b of blokken) {
      const code = alsCode(rijen[i][b.code]);
      if (FILMNUMMER_CODE.test(code)) {
        overgeslagen.push({ regel: i + 1, inhoud: [code, filmTekst(rijen[i][b.tekst])].filter(Boolean).join(' · '), reden: 'Staat boven de kopregel' });
      }
    }
  }

  const geldig: Filmnummer[] = [];
  const regelVan = new Map<string, number>();
  for (let i = kopRegel + 1; i < rijen.length; i++) {
    const rij = rijen[i];
    if (isLeeg(rij)) continue;
    // Een kopregel verderop (een tweede blok onder het eerste) bepaalt de
    // indeling van de regels eronder.
    const kop = leesKop(rij);
    if (kop.blokken.length > 0) { neemKop(kop); continue; }
    // Twee kolommen zonder kopregel: wat er nog naast staat (een opmerking)
    // wordt niet gelezen, en dat zegt het voorbeeld.
    if (!gelezen.kopregel && blokken[0].lijn === null && rij.some((c, k) => k > 1 && filmTekst(c) !== '')) gelezen.extraCellen += 1;
    for (const b of blokken) {
      const code = alsCode(rij[b.code]);
      let lijn = b.lijn === null ? '' : alsLijn(rij[b.lijn]);
      let tekst = filmTekst(rij[b.tekst]);
      if (b.lijn === null && code.length >= LIJN_UIT_TEKST_VANAF) {
        const vooraan = LIJN_VOORAAN.exec(tekst);
        if (vooraan) { lijn = vooraan[1]; tekst = vooraan[2]; }
      }
      if (!code && !lijn && !tekst) continue;
      const sla = (reden: string) => overgeslagen.push({ regel: i + 1, inhoud: [code, lijn, tekst].filter(Boolean).join(' · '), reden });
      if (!FILMNUMMER_CODE.test(code)) { sla(code ? 'Het nummer bestaat niet uit 1 tot 6 cijfers' : 'Geen nummer'); continue; }
      if (!tekst) { sla('Geen boodschap'); continue; }
      // Een datum die Excel van de tekst maakte ("1 mei") komt als getal binnen.
      if (typeof rij[b.tekst] === 'number') { sla('De boodschap is een getal; staat er in Excel een datum of een getal in die cel?'); continue; }
      if (tekst.length > MAX_FILM_TEKST) { sla(`De boodschap is langer dan ${MAX_FILM_TEKST} tekens`); continue; }
      if (lijn.length > MAX_FILM_LIJN) { sla(`De lijn is langer dan ${MAX_FILM_LIJN} tekens`); continue; }
      const eerder = regelVan.get(code);
      if (eerder !== undefined) { sla(`Nummer ${code} staat al op regel ${eerder}`); continue; }
      regelVan.set(code, i + 1);
      geldig.push({ code, lijn, tekst });
    }
  }
  const items = normaliseerFilmnummers(geldig);
  if (items.length > MAX_FILMNUMMERS) {
    return { items: [], overgeslagen: [{ regel: 0, inhoud: `${items.length} nummers`, reden: `Een lijst telt hooguit ${MAX_FILMNUMMERS} filmnummers` }], gelezen };
  }
  return { items, overgeslagen, gelezen };
}

/**
 * CSV-tekst → rijen. Het scheidingsteken volgt uit het bestand zelf: Excel
 * schrijft in België een puntkomma, andere programma's een komma of een tab,
 * en een eerste regel "sep=;" zegt het uitdrukkelijk. Aanhalingstekens rond
 * een cel (met een verdubbeld aanhalingsteken erin) worden gelezen zoals
 * Excel ze schrijft, ook als de cel een regeleinde bevat.
 */
export function leesCsv(tekst: string): string[][] {
  let bron = tekst.replace(/^﻿/, '');
  let scheiding = '';
  const sep = /^sep=(.)\r?\n/i.exec(bron);
  if (sep) { scheiding = sep[1]; bron = bron.slice(sep[0].length); }
  if (!scheiding) {
    const kop = bron.split(/\r?\n/).filter((r) => r.trim()).slice(0, 10).join('\n').replace(/"[^"]*"/g, '');
    const tel = (teken: string) => kop.split(teken).length - 1;
    scheiding = [';', '\t', ',', '|'].map((t) => ({ t, n: tel(t) })).sort((a, b) => b.n - a.n)[0].t;
  }
  // De "sep="-regel telt mee als (lege) regel, zodat "regel 12" in een melding
  // ook regel 12 in het bestand is.
  const rijen: string[][] = sep ? [[]] : [];
  let rij: string[] = [];
  let cel = '';
  let inAanhaling = false;
  for (let i = 0; i < bron.length; i++) {
    const c = bron[i];
    if (inAanhaling) {
      if (c === '"' && bron[i + 1] === '"') { cel += '"'; i++; }
      else if (c === '"') inAanhaling = false;
      else cel += c;
    } else if (c === '"' && cel === '') inAanhaling = true;
    else if (c === scheiding) { rij.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && bron[i + 1] === '\n') i++;
      rij.push(cel); cel = '';
      rijen.push(rij); rij = [];
    } else cel += c;
  }
  if (cel !== '' || rij.length > 0) { rij.push(cel); rijen.push(rij); }
  return rijen;
}

/**
 * Excel bewaart een CSV op Windows als Windows-1252, andere programma's als
 * UTF-8, en "Unicode-tekst (.txt)" als UTF-16 met een BOM vooraan.
 */
export function decodeerTekst(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Is dit een Excel-werkmap (.xlsx is een zip, .xls een OLE-bestand), wat de naam ook zegt? */
const isWerkmap = (bytes: Uint8Array): boolean =>
  (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0);

/** Het gekozen bestand → rijen. Excel leest het eerste werkblad, via de luie xlsx-bundel. */
export async function rijenUitBestand(bestand: Blob): Promise<unknown[][]> {
  const bytes = new Uint8Array(await bestand.arrayBuffer());
  if (!isWerkmap(bytes)) return leesCsv(decodeerTekst(bytes));
  const XLSX = await import('xlsx');
  const werkmap = XLSX.read(bytes, { type: 'array' });
  const blad = werkmap.Sheets[werkmap.SheetNames[0]];
  if (!blad) return [];
  // `range: 0`: vanaf de eerste regel van het blad, zodat "regel 12" in een
  // melding ook regel 12 in Excel is.
  return XLSX.utils.sheet_to_json<unknown[]>(blad, { header: 1, defval: '', blankrows: true, range: 0 });
}

export type FilmVerschil = {
  nieuw: Filmnummer[];
  gewijzigd: Array<{ voor: Filmnummer; na: Filmnummer }>;
  weg: Filmnummer[];
};

/** Wat een import verandert aan de lijst die er staat, per nummer. */
export function vergelijkFilmnummers(huidig: readonly Filmnummer[], volgende: readonly Filmnummer[]): FilmVerschil {
  const voor = new Map(huidig.map((f) => [f.code, f]));
  const na = new Map(volgende.map((f) => [f.code, f]));
  return {
    nieuw: volgende.filter((f) => !voor.has(f.code)),
    gewijzigd: volgende.flatMap((f) => {
      const oud = voor.get(f.code);
      return oud && (oud.lijn !== f.lijn || oud.tekst !== f.tekst) ? [{ voor: oud, na: f }] : [];
    }),
    weg: huidig.filter((f) => !na.has(f.code)),
  };
}
