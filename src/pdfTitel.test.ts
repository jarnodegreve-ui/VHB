// @vitest-environment node
/**
 * Ritblad-upload zet de PDF-titel op "Ritblad" (08-09-2026): de browser
 * toont die titel in de PDF-balk, en het planningspakket levert "ritbladje".
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { metPdfTitel, pdfTitel } from '../api/_lib/pdfTitel';

const maakPdf = async (titel?: string) => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 100]);
  if (titel) doc.setTitle(titel);
  return Buffer.from(await doc.save());
};

describe('metPdfTitel', () => {
  it('overschrijft de titel-metadata en laat de inhoud heel', async () => {
    const bron = await maakPdf('ritbladje');
    expect(await pdfTitel(bron)).toBe('ritbladje');
    const uit = await metPdfTitel(bron, 'Ritblad');
    expect(await pdfTitel(uit)).toBe('Ritblad');
    expect((await PDFDocument.load(uit)).getPageCount()).toBe(1);
  });
  it('zet een titel op een PDF zonder metadata', async () => {
    const uit = await metPdfTitel(await maakPdf(), 'Ritblad');
    expect(await pdfTitel(uit)).toBe('Ritblad');
  });
  it('geeft het origineel terug als het geen PDF is', async () => {
    const rommel = Buffer.from('dit is geen pdf');
    expect(await metPdfTitel(rommel, 'Ritblad')).toBe(rommel);
    expect(await pdfTitel(rommel)).toBeUndefined();
  });
});
