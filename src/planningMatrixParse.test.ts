import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parsePlanningMatrixXlsxMetWaarschuwingen } from '../api/helpers';

// De parser levert { rows, waarschuwingen }; deze suite test vooral de rijen.
const parseRijen = (buffer: Buffer) => parsePlanningMatrixXlsxMetWaarschuwingen(buffer).rows;

/**
 * Fixture-tests voor het import-entrypoint (had 0 tests, terwijl de import
 * de kritiekste flow is). We bouwen in-memory .xlsx-bestanden met dezelfde
 * structuur als de praktijk-tab: kolom A = datum (Excel-serial), B = dagtype,
 * kolommen 2..'aantal' = één kolom per chauffeur.
 */
const buildXlsx = (rows: unknown[][], sheetName = 'praktijk'): Buffer => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

// 2026-07-06 als Excel-serial (dagen sinds 1899-12-30).
const serial = (iso: string) => {
  const ms = Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z');
  return Math.round(ms / 86400000);
};

describe('parsePlanningMatrixXlsxMetWaarschuwingen', () => {
  it('parseert een geldige praktijk-tab naar matrix-rijen', () => {
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'Mia Claes', 'aantal'],
      [serial('2026-07-06'), 'W', '4101', 'bv', 2],
      [serial('2026-07-07'), 'W', '', '4102', 1],
    ]);
    const rows = parseRijen(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].source_date).toBe('2026-07-06');
    expect(rows[0].day_type).toBe('W');
    expect(rows[0].assignments).toEqual({ 'Jan Peeters': '4101', 'Mia Claes': 'bv' });
    // Lege cel = geen assignment (géén lege string).
    expect(rows[1].assignments).toEqual({ 'Mia Claes': '4102' });
  });

  it('weigert een werkboek zonder praktijk-tab met een duidelijke fout', () => {
    const buffer = buildXlsx([['datum', 'dagtype', 'X', 'aantal'], [serial('2026-07-06'), 'W', '1', 1]], 'blad1');
    expect(() => parseRijen(buffer)).toThrow(/praktijk/i);
  });

  it('weigert een tab zonder aantal-kolom', () => {
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters'],
      [serial('2026-07-06'), 'W', '4101'],
    ]);
    expect(() => parseRijen(buffer)).toThrow(/aantal/i);
  });

  it('weigert dubbele datumrijen (laatste-wint zou data stil laten verdwijnen)', () => {
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'aantal'],
      [serial('2026-07-06'), 'W', '4101', 1],
      [serial('2026-07-06'), 'W', '4102', 1],
    ]);
    expect(() => parseRijen(buffer)).toThrow(/dubbele datumrijen/i);
  });

  it('weigert dubbele chauffeur-kolommen', () => {
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'Jan Peeters', 'aantal'],
      [serial('2026-07-06'), 'W', '4101', '4102', 2],
    ]);
    expect(() => parseRijen(buffer)).toThrow(/dubbele chauffeur-kolommen/i);
  });

  it('negeert spacer-kolommen zoals Flexi/invallers', () => {
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'Flexi/invallers', 'Mia Claes', 'aantal'],
      [serial('2026-07-06'), 'W', '4101', 'x', 'bv', 2],
    ]);
    const rows = parseRijen(buffer);
    expect(Object.keys(rows[0].assignments)).toEqual(['Jan Peeters', 'Mia Claes']);
  });

  it('parseert tekstuele datums (dd-mmm-jj-display) via de fallback', () => {
    // Sommige exports leveren strings i.p.v. serials; de parser valt terug op
    // normalizePlanningMatrixDate.
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'aantal'],
      ['06/07/2026', 'W', '4101', 1],
    ]);
    const rows = parseRijen(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_date).toBe('2026-07-06');
  });
});

describe('parsePlanningMatrixXlsxMetWaarschuwingen — kolommen ná "aantal"', () => {
  it('waarschuwt voor een naamachtige kolom achter de aantal-kolom', async () => {
    const { parsePlanningMatrixXlsxMetWaarschuwingen } = await import('../api/helpers');
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'aantal', 'Cherlet Luc'],
      [serial('2026-07-06'), 'W', '4101', 1, '4102'],
    ]);
    const { rows, waarschuwingen } = parsePlanningMatrixXlsxMetWaarschuwingen(buffer);
    // De kolom wordt níét gelezen (bestaand gedrag) …
    expect(rows[0].assignments).toEqual({ 'Jan Peeters': '4101' });
    // … maar verdwijnt niet langer geruisloos.
    expect(waarschuwingen).toHaveLength(1);
    expect(waarschuwingen[0]).toContain('Cherlet Luc');
    expect(waarschuwingen[0]).toContain('aantal');
  });

  it('waarschuwt niet voor tellingen-headers of losse woorden achter aantal', async () => {
    const { parsePlanningMatrixXlsxMetWaarschuwingen } = await import('../api/helpers');
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'aantal', 'uur', '17', 'Flexi', ''],
      [serial('2026-07-06'), 'W', '4101', 1, '', '', '', ''],
    ]);
    const { waarschuwingen } = parsePlanningMatrixXlsxMetWaarschuwingen(buffer);
    expect(waarschuwingen).toEqual([]);
  });
});
