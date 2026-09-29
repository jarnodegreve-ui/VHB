import { constants, gunzipSync } from "node:zlib";

/**
 * De Excel van de planning-import uit de request-body halen (29-09).
 *
 * Een Vercel-functie neemt hoogstens 4,5 MB request body aan (grens van het
 * platform, niet in te stellen) en base64 maakt een bestand 4/3 groter. De
 * werkmap van de planning groeit: 2,44 MB in juli, 3,29 MB op 19-08, en op
 * 29-09 weigerde het platform de upload met een 413, nog vóór deze code
 * draaide. Daarom twee vormen, allebei base64 in JSON:
 *  - `xlsxGzipBase64`: de browser pakt het bestand eerst in met gzip
 *    (src/lib/bestandInpakken.ts); een .xls wordt daar ±6× kleiner van.
 *  - `xlsxBase64`: het bestand zelf, zoals vroeger. Blijft werken voor een
 *    nog gecachete oudere app en voor een browser zonder CompressionStream.
 * Beide vormen geven exact dezelfde bytes aan de parser.
 *
 * De grenzen gelden NA het uitpakken en hangen af van de soort, herkend aan
 * de eerste bytes (niet aan de naam):
 *  - .xls (BIFF in een OLE2-container, begint met D0 CF 11 E0): 15 MB. Geen
 *    zip, SheetJS pakt er niets verder uit. De werkmap met tien tabbladen is
 *    3,5 MB en groeit met ±0,3 MB per maand; 15 MB geeft jaren ruimte en houdt
 *    het geheugen van de functie begrensd.
 *  - .xlsx (zip, begint met PK): 5 MB zoals voorheen. Een .xlsx is zelf een
 *    zip die SheetJS uitpakt, daar zit het risico van een zip-bom; dezelfde
 *    werkmap is als .xlsx maar 1,5 MB.
 *  - iets anders (bv. een XML-werkmap van Excel 2003 of een HTML-export met
 *    de extensie .xls): 5 MB en door naar de parser, precies zoals vóór
 *    29-09. Die weigert het zelf met een 400 als er geen tabblad "praktijk"
 *    in staat; zo verandert er voor zo'n bestand niets.
 * Het uitpakken zelf is begrensd (`maxOutputLength`): een gzip-bom (klein
 * ingepakt, enorm uitgepakt) zet nooit meer dan de grootste grens in het
 * geheugen. De grootte in de melding komt uit de gzip-staart (ISIZE).
 *
 * Een te groot bestand is een 413 met een leesbare melding, een onbruikbaar
 * een 400; de fout draagt die status (`status`), de routes geven hem door.
 */
const MB = 1024 * 1024;
export const MAX_XLS_BYTES = 15 * MB;
export const MAX_XLSX_BYTES = 5 * MB;

type Soort = "xls" | "xlsx";
const GRENS: Record<Soort, number> = { xls: MAX_XLS_BYTES, xlsx: MAX_XLSX_BYTES };

const soortVan = (b: Buffer): Soort | null => {
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "xls";
  if (b[0] === 0x50 && b[1] === 0x4b) return "xlsx";
  return null;
};

/** "16,2 MB", naar boven afgerond, zodat een bestand net boven de grens
 *  nooit als de grens zelf in de melding staat. */
const mb = (bytes: number) => `${(Math.ceil((bytes / MB) * 10) / 10).toString().replace(".", ",")} MB`;

const fout = (melding: string, status: 400 | 413) => Object.assign(new Error(melding), { status });

const RAAD = "Bewaar een kopie met alleen het tabblad “praktijk” en probeer het opnieuw.";

/** Grens voor een bestand dat geen .xls of .xlsx is: die van vóór 29-09. */
const MAX_ANDERS_BYTES = 5 * MB;

/** 413 met grootte en grens. Zonder soort (het begin van het bestand is
 *  geen .xls of .xlsx) geldt de grens van vóór 29-09. */
const teGroot = (bytes: number | null, soort: Soort | null) => {
  const grens = soort ? GRENS[soort] : MAX_ANDERS_BYTES;
  const grootte = bytes !== null && bytes > grens ? mb(bytes) : `meer dan ${mb(grens)}`;
  return fout(`Het Excel-bestand is ${grootte}, de grens${soort ? ` voor een .${soort}` : ""} is ${mb(grens)}. ${RAAD}`, 413);
};

const uitBase64 = (waarde: string) => Buffer.from(waarde.replace(/^data:[^;]+;base64,/, ""), "base64");

const beschadigd = () => fout("Het ingepakte Excel-bestand is beschadigd. Kies het bestand opnieuw.", 400);

/** De soort uit het begin van de gzip, zonder alles uit te pakken: 1 kB
 *  ingepakt wordt hoogstens ±1 MB (deflate haalt hoogstens ±1:1032). */
const soortVanBegin = (gz: Buffer): Soort | null => {
  try {
    return soortVan(gunzipSync(gz.subarray(0, 1024), { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: 2 * MB }));
  } catch {
    return null;
  }
};

/** Pakt de gzip uit, hoogstens tot de grens van de soort (onbekend: de
 *  grens van vóór 29-09). */
const pakUit = (gz: Buffer): Buffer => {
  if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw beschadigd();
  const soort = soortVanBegin(gz);
  try {
    return gunzipSync(gz, { maxOutputLength: soort ? GRENS[soort] : MAX_ANDERS_BYTES });
  } catch (err: any) {
    if (err?.code !== "ERR_BUFFER_TOO_LARGE") throw beschadigd();
    // De grootte voor de melding komt uit de staart (ISIZE: de oorspronkelijke
    // grootte, mod 2^32). Alleen voor de melding: de staart kan liegen, de
    // rem is maxOutputLength hierboven.
    throw teGroot(gz.readUInt32LE(gz.length - 4), soort);
  }
};

/** De Excel-bytes uit de body van /api/planning-matrix/preview of /import. */
export const leesMatrixUpload = (body: any): Buffer => {
  const gzip = typeof body?.xlsxGzipBase64 === "string" && body.xlsxGzipBase64 ? body.xlsxGzipBase64 : "";
  const plat = typeof body?.xlsxBase64 === "string" && body.xlsxBase64 ? body.xlsxBase64 : "";
  if (!gzip && !plat) {
    throw fout("Geen Excel-bestand meegegeven (verwacht xlsxGzipBase64 of xlsxBase64 in body).", 400);
  }
  const ruw = gzip ? uitBase64(gzip) : uitBase64(plat);
  if (ruw.length === 0) throw fout("Excel-bestand is leeg.", 400);
  const buffer = gzip ? pakUit(ruw) : ruw;
  if (buffer.length === 0) throw fout("Excel-bestand is leeg.", 400);
  const soort = soortVan(buffer);
  const grens = soort ? GRENS[soort] : MAX_ANDERS_BYTES;
  if (buffer.length > grens) throw teGroot(buffer.length, soort);
  return buffer;
};
