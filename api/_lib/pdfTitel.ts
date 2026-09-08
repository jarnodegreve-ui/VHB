import { PDFDocument } from "pdf-lib";

/**
 * PDF-titel overschrijven (verzoek Jarno 08-09-2026). Browsers tonen in de
 * PDF-balk van een <iframe> de Title-metadata van het document, niet onze
 * bestandsnaam; het ritblad uit het planningspakket heet intern "ritbladje".
 * Best-effort: lukt het laden/herschrijven niet (beveiligd of kapot PDF),
 * dan gaat het origineel ongewijzigd door, want een ritblad dat er is, is
 * belangrijker dan een nette titel.
 */
export const metPdfTitel = async (pdf: Buffer, titel: string): Promise<Buffer> => {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    doc.setTitle(titel);
    return Buffer.from(await doc.save({ useObjectStreams: false }));
  } catch (err) {
    console.warn("[pdf] titel niet herschreven, origineel gebruikt:", (err as Error)?.message ?? err);
    return pdf;
  }
};

/** Titel-metadata uitlezen (voor de tests en de systeemstatus). */
export const pdfTitel = async (pdf: Buffer): Promise<string | undefined> => {
  try {
    return (await PDFDocument.load(pdf, { updateMetadata: false })).getTitle();
  } catch {
    return undefined;
  }
};
