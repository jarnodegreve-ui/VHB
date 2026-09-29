import { metEenheid } from './format';

/**
 * Het Excel-bestand van de planning-import inpakken voor de upload (29-09).
 *
 * Een Vercel-functie neemt hoogstens 4,5 MB request body aan. Daarboven
 * weigert het platform het verzoek met een 413 nog vóór de functie draait:
 * geen JSON, dus ook geen eigen melding. Base64 maakt een bestand 4/3 groter,
 * dus een Excel boven ±3,37 MB kwam er nooit door, en de werkmap van de
 * planning groeit (2,44 MB in juli, 3,29 MB op 19-08, erover op 29-09).
 * Daarom pakt de browser het bestand in met gzip (CompressionStream, ingebouwd
 * sinds Safari 16.4, Chrome 80 en Firefox 113); een .xls wordt daar ±6× kleiner
 * van. De server pakt het uit (api/_lib/matrixUpload.ts). Zonder
 * CompressionStream gaat het bestand zoals vroeger (xlsxBase64), en dan houdt
 * de controle hieronder een te groot bestand tegen vóór het vertrekt.
 */

/** Hoeveel request body een Vercel-functie aanneemt: 4,5 MB, een grens van het
 *  platform die niet in te stellen is. Gerekend als 4.500.000 bytes, de
 *  strengste lezing (4,5 MiB zou 4.718.592 zijn). */
export const PLATFORM_GRENS_BYTES = 4_500_000;

/** Wat de client hoogstens verstuurt: de platformgrens min 100 kB marge voor
 *  wat hij zelf niet meet (hoe het platform telt of afrondt). Daarboven
 *  vertrekt er niets en zegt de melding hoe groot het is en wat de grens is. */
export const VERZOEK_GRENS_BYTES = PLATFORM_GRENS_BYTES - 100_000;

export type IngepaktBestand = {
  /** true = gzip, verstuurd als `xlsxGzipBase64`; false = het bestand zelf, als `xlsxBase64`. */
  gzip: boolean;
  base64: string;
  /** Grootte van het bestand zelf. */
  bytes: number;
};

// In stukken van 32 kB: String.fromCharCode met één argument per byte klapt
// anders over de stack-limiet (bestanden vanaf ±1 MB).
const naarBase64 = (data: ArrayBuffer): string => {
  const bytes = new Uint8Array(data);
  let binair = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binair += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binair);
};

/** Leest en pakt het bestand in. Eén keer per gekozen bestand: het voorbeeld,
 *  een andere periode en de import versturen daarna precies hetzelfde. */
export async function pakBestandIn(bestand: Blob): Promise<IngepaktBestand> {
  const gzip = typeof CompressionStream === 'function';
  const data = gzip
    ? await new Response(bestand.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
    : await bestand.arrayBuffer();
  return { gzip, base64: naarBase64(data), bytes: bestand.size };
}

/** "4,5 MB" (1 MB = 1.000.000 bytes, zoals de platformgrens), naar boven
 *  afgerond: een verzoek net boven de grens staat er nooit gelijk aan. */
const mb = (bytes: number) => metEenheid((Math.ceil(bytes / 100_000) / 10).toFixed(1).replace('.', ','), 'MB');

/**
 * Fout met status 413 en een melding die zegt waarom en wat je kunt doen.
 * Met `bytes` (de body die zou vertrekken): de controle vooraf. Zonder: het
 * platform weigerde het verzoek al, met een 413 zonder JSON.
 */
export function teGrootFout(ingepakt: IngepaktBestand, bytes?: number): Error & { status: number } {
  const wat = bytes === undefined
    ? `De server weigerde het bestand: ${ingepakt.gzip ? 'ook gecomprimeerd' : 'zonder compressie'} is het verzoek groter dan de ${mb(PLATFORM_GRENS_BYTES)} die hij aanneemt.`
    : ingepakt.gzip
      ? `Het bestand is ook gecomprimeerd nog ${mb(bytes)}, de server neemt hoogstens ${mb(VERZOEK_GRENS_BYTES)} aan.`
      : `Het bestand is ${mb(ingepakt.bytes)}, zonder compressie neemt de server hoogstens ${mb((VERZOEK_GRENS_BYTES * 3) / 4)} aan.`;
  const raad = ingepakt.gzip
    ? 'Bewaar een kopie met alleen het tabblad “praktijk” en probeer het opnieuw.'
    : 'Gebruik een recente browser of bewaar het bestand als .xlsx en probeer het opnieuw.';
  return Object.assign(new Error(`${wat} ${raad}`), { status: 413 });
}

/**
 * De JSON-body voor /api/planning-matrix/preview en /import, na de controle
 * vooraf: past hij niet binnen `VERZOEK_GRENS_BYTES`, dan gooit dit de fout
 * met grootte en grens en vertrekt er niets.
 */
export function matrixVerzoek(ingepakt: IngepaktBestand, extra: Record<string, unknown> = {}): string {
  const body = JSON.stringify({ [ingepakt.gzip ? 'xlsxGzipBase64' : 'xlsxBase64']: ingepakt.base64, ...extra });
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > VERZOEK_GRENS_BYTES) throw teGrootFout(ingepakt, bytes);
  return body;
}
