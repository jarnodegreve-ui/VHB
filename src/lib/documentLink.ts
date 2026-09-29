/**
 * Versheid van de links op het scherm Documenten (controle-ronde 29-09,
 * nr. 15). De server ondertekent elke documentlink voor 15 minuten
 * (DOCUMENT_URL_TTL_SEC in api/_lib/documentRoutes.ts, bewust kort: een
 * ondertekende link omzeilt de sessie). Wie de app wegzette en later
 * terugkwam, tikte op een verlopen link en kreeg een rauwe fout van Supabase.
 *
 * Twee regels, allebei ruim binnen die 15 minuten:
 * - een link die ouder is dan `DOCUMENT_LINK_GELDIG_MS` wordt niet meer
 *   geopend; het scherm haalt eerst een verse op;
 * - bij het hervatten van de app ververst de lijst zodra ze ouder is dan
 *   `DOCUMENT_VERVERS_NA_MS`, zodat de tik zelf meestal niets hoeft op te halen.
 */
export const DOCUMENT_LINK_GELDIG_MS = 13 * 60_000;
export const DOCUMENT_VERVERS_NA_MS = 5 * 60_000;

/** Is een link die op `ondertekendOp` binnenkwam nu nog veilig te openen?
 *  Onbekend moment of een klok die terugsprong = nee. */
export const linkNogGeldig = (ondertekendOp: number | null, nu: number): boolean =>
  ondertekendOp !== null && nu >= ondertekendOp && nu - ondertekendOp < DOCUMENT_LINK_GELDIG_MS;

/**
 * Opent dit persoonlijke document in de viewer van de app (29-09)? Alleen een
 * PDF: een persoonlijk document mag ook een foto zijn (.png, .jpg, .jpeg; zie
 * de uploadschermen en POST /api/documents), en die gaat de oude weg, extern
 * openen, zoals vroeger. Het type volgt uit de bestandsnaam, die de server bij
 * de upload op die extensies controleert.
 */
export const opentInDeApp = (filename: string): boolean => /\.pdf$/i.test(filename.trim());
