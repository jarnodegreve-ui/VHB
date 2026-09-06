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

describe('parsePlanningMatrixXlsxMetWaarschuwingen, kolommen ná "aantal"', () => {
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

  it('waarschuwt niet voor chauffeurnamen die het tellingen-blok herhaalt', async () => {
    const { parsePlanningMatrixXlsxMetWaarschuwingen } = await import('../api/helpers');
    // De praktijk-tab van VHB herhaalt ná "aantal" elke chauffeur als kopje van
    // de tellingen (25-08: 114 meldingen bij 38 chauffeurs). Alleen een naam
    // die vóór "aantal" ontbreekt is mogelijk een vergeten chauffeur.
    const buffer = buildXlsx([
      ['datum', 'dagtype', 'Jan Peeters', 'Mia Claes', 'aantal', 'Jan Peeters', 'Mia Claes', 'uur', 'Peeters Jan', 'Cherlet Luc'],
      [serial('2026-07-06'), 'W', '4101', '4102', 2, 1, 1, '', 1, '4103'],
    ]);
    const { rows, waarschuwingen } = parsePlanningMatrixXlsxMetWaarschuwingen(buffer);
    expect(rows[0].assignments).toEqual({ 'Jan Peeters': '4101', 'Mia Claes': '4102' });
    expect(waarschuwingen).toHaveLength(1);
    expect(waarschuwingen[0]).toContain('Cherlet Luc');
  });
});

describe('parsePlanningMatrixXlsxMetWaarschuwingen, golden file: echte praktijk-structuur', () => {
  // Structuurgetrouwe kopie van de echte VHB-praktijk-tab (geanonimiseerd):
  // 38 chauffeurskolommen, dan "aantal", dan het tellingen-blok dat elke
  // chauffeursnaam nóg drie keer als kopje herhaalt. Precies die herhaling
  // zorgde op 25-08 voor 114 valse "kolom ná aantal"-meldingen — deze test
  // laat elke toekomstige parser-wijziging tegen de echte vorm draaien.
  it('parseert 30 dagen × 38 chauffeurs zonder waarschuwingen', async () => {
    const { parsePlanningMatrixXlsxMetWaarschuwingen } = await import('../api/helpers');
    const chauffeurs = Array.from({ length: 38 }, (_, i) =>
      `Testman ${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
    const codeVoor = (dag: number, chauffeur: number) => {
      if ((dag + chauffeur) % 9 === 0) return '';        // vrije dag
      if ((dag + chauffeur) % 7 === 0) return 'V';       // verlofcode
      return String(2101 + ((dag * 7 + chauffeur) % 17)); // dienstcodes 2101-2117
    };
    const header = [
      'datum', 'dagtype', ...chauffeurs, 'aantal',
      ...chauffeurs, 'uur', ...chauffeurs, '', ...chauffeurs,
    ];
    const rows: unknown[][] = [header];
    for (let dag = 0; dag < 30; dag++) {
      const iso = `2026-09-${String(dag + 1).padStart(2, '0')}`;
      const weekdag = new Date(`${iso}T00:00:00Z`).getUTCDay();
      const dagtype = weekdag === 0 ? 'Zo' : weekdag === 6 ? 'Za' : 'W';
      const codes = chauffeurs.map((_, i) => codeVoor(dag, i));
      const aantal = codes.filter((c) => /^\d+$/.test(c)).length;
      const tellingen = chauffeurs.map((_, i) => (codes[i] ? 1 : 0));
      rows.push([serial(iso), dagtype, ...codes, aantal, ...tellingen, '', ...tellingen, '', ...tellingen]);
    }
    const { rows: parsed, waarschuwingen } = parsePlanningMatrixXlsxMetWaarschuwingen(buildXlsx(rows));
    expect(waarschuwingen).toEqual([]);
    expect(parsed).toHaveLength(30);
    // Lege cellen laat de parser bewust weg — per dag dus precies de
    // niet-lege codes, en over alle dagen samen alle 38 chauffeurs.
    parsed.forEach((rij, dag) => {
      const verwacht = chauffeurs.filter((_, i) => codeVoor(dag, i) !== '').length;
      expect(Object.keys(rij.assignments)).toHaveLength(verwacht);
    });
    const alleNamen = new Set(parsed.flatMap((rij) => Object.keys(rij.assignments)));
    expect(alleNamen.size).toBe(38);
    expect(parsed[0].source_date).toBe('2026-09-01');
    expect(parsed[0].assignments['Testman Ab']).toBe(codeVoor(0, 1));
  });
});
