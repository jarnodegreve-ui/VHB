import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseImportET } from './importET';
import { looncomponentenVanSegmenten, splitsStationnement } from './looncomponenten';
import { loonParametersVanSegmenten, nachtMinuten } from './loonparameters';
import { controleerSegmenten } from './controles';
import { ritbladVanSegmenten } from './ritblad';
import { formatEasypayTijd, parseUurNotatie } from './tijd';
import type { Segment } from '../dienst';

const hier = dirname(fileURLToPath(import.meta.url));

/** Kleine CSV-lezer voor de fixtures (mdb-export: komma, dubbele aanhalingstekens). */
const leesCsv = (naam: string): Array<Record<string, string>> => {
  const tekst = readFileSync(join(hier, '__fixtures__', naam), 'utf8');
  const regels = tekst.split(/\r?\n/).filter((r) => r.length > 0);
  const splits = (r: string): string[] => {
    const uit: string[] = []; let cur = ''; let inQ = false;
    for (let i = 0; i < r.length; i += 1) {
      const c = r[i];
      if (inQ) { if (c === '"' && r[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') inQ = false; else cur += c; }
      else if (c === '"') inQ = true; else if (c === ',') { uit.push(cur); cur = ''; } else cur += c;
    }
    uit.push(cur);
    return uit;
  };
  const kop = splits(regels[0]);
  return regels.slice(1).map((r) => Object.fromEntries(splits(r).map((v, i) => [kop[i], v])));
};

/**
 * Golden test tegen Access (dienstregeling.accdb, 13-09-2026): tbl-importDienstenET
 * (1.234 ritdelen, 67 diensten) → tblLoondienstCSVeasypay (1.358 rijen, 66 diensten).
 * Negen diensten verschillen in de bron zelf (de ET-tabel kreeg na de laatste
 * Access-export een extra ATU/ANW vóór de onderbreking, o.a. de verdachte duur
 * van 2115) en drie diensten (7114, 7216, 7414) staan niet in de oude export;
 * die blijven buiten de vergelijking, de overige 55 moeten rij voor rij gelijk zijn.
 */
const GEWIJZIGD_IN_BRON = new Set(['2110', '2113', '2114', '2115', '2214', '2311', '2313', '2314', '2316']);

describe('dienstopbouw (golden, dienstregeling 2026-09)', () => {
  const { segments, waarschuwingen, dagtypes } = parseImportET(leesCsv('importET-2026.csv'));
  const verwacht = leesCsv('loondienstCSV-2026.csv');

  it('leest de ET-export: 1.234 ritdelen, 67 diensten, 9 dagtypes, geen waarschuwingen', () => {
    expect(segments.length).toBe(1234);
    expect(new Set(segments.map((s) => s.serviceNumber)).size).toBe(67);
    expect(dagtypes).toEqual(['21/0', '22/0', '23/0', '25/0', '26/0', '27/0', '31/0', '34/0', '35/0']);
    expect(waarschuwingen).toEqual([]);
    const d2102 = segments.filter((s) => s.serviceNumber === '2102');
    // Let op: Access tblDienstNummerGegevens zegt voor 2102 nog tiktijd 05:28; de
    // dienstregeling van 2026-09 begint om 05:01. Die Access-tabel is dus verouderd.
    expect(d2102[0]).toMatchObject({ volgorde: 1, type: 'AVO', startMin: 5 * 60 + 1 });
  });

  it('looncomponenten zijn rij voor rij gelijk aan tblLoondienstCSVeasypay (55 ongewijzigde diensten)', () => {
    const inCsv = new Set(verwacht.map((r) => r.Service));
    const inEt = new Set(segments.map((s) => s.serviceNumber));
    // 2514 en 2515 staan wel in de oude export maar niet meer in de ET-tabel.
    const vergelijkbaar = (svc: string) => inCsv.has(svc) && inEt.has(svc) && !GEWIJZIGD_IN_BRON.has(svc);
    const mijn = looncomponentenVanSegmenten(segments.filter((s) => vergelijkbaar(s.serviceNumber)))
      .map((r) => `${r.service}|${r.hd}|${r.ha}|${r.duree}|${r.typprest}|${r.decimal1}|${r.jd}|${r.ja}`).sort();
    const access = verwacht.filter((r) => vergelijkbaar(r.Service))
      .map((r) => `${r.Service}|${r.HD}|${r.HA}|${r.Duree}|${Number(r.TYPPREST)}|${Number(r.Decimal1)}|${Number(r.JD)}|${Number(r.JA)}`).sort();
    expect(mijn.length).toBe(access.length);
    expect(mijn).toEqual(access);
    expect(new Set(mijn.map((r) => r.split('|')[0])).size).toBe(55);
  });

  it('controles: de actuele dienstregeling heeft geen gaten of overlap, wel de bekende duurafwijkingen', () => {
    const b = controleerSegmenten(segments);
    expect(b.filter((x) => x.soort === 'gat' || x.soort === 'overlap' || x.soort === 'einde_voor_start')).toEqual([]);
    const duur = b.filter((x) => x.soort === 'duur_klopt_niet');
    expect(duur.map((x) => `${x.serviceNumber}:${x.volgorde}`)).toEqual(['2115:8', '2214:6']);
  });
});

const seg = (p: Partial<Segment> & { type: Segment['type']; startMin: number; eindeMin: number; volgorde: number }): Segment => ({
  serviceNumber: '2102', dagtypeCode: '21/0', duurMin: p.eindeMin - p.startMin, loop: null, internLoop: null, lijn: null, variant: null, rit: null, voertuig: null,
  vertrek: null, vertrekCode: null, aankomst: null, aankomstCode: null, afstandKm: null, atTijd: null, vtTijd: null, ...p,
});

describe('dienstopbouw, rekenregels', () => {
  it('tijdnotatie: 07u24, 25u10 (na middernacht) en Easypay-uren boven 23', () => {
    expect(parseUurNotatie('07u24')).toBe(444);
    expect(parseUurNotatie('25u10')).toBe(1510);
    expect(parseUurNotatie('')).toBeNull();
    expect(formatEasypayTijd(1510)).toBe('01:10');
    expect(formatEasypayTijd(444)).toBe('07:24');
  });

  it('stationnement splitst in 15 / hooguit 30 / rest', () => {
    expect(splitsStationnement(10)).toEqual({ at: 10, nat100: 0, nat50: 0 });
    expect(splitsStationnement(15)).toEqual({ at: 15, nat100: 0, nat50: 0 });
    expect(splitsStationnement(40)).toEqual({ at: 15, nat100: 25, nat50: 0 });
    expect(splitsStationnement(45)).toEqual({ at: 15, nat100: 30, nat50: 0 });
    expect(splitsStationnement(78)).toEqual({ at: 15, nat100: 30, nat50: 33 });
  });

  it('nachtminuten: vóór 06:00 en vanaf 20:00, klok loopt door', () => {
    expect(nachtMinuten(5 * 60, 7 * 60)).toBe(60);
    expect(nachtMinuten(19 * 60, 21 * 60)).toBe(60);
    expect(nachtMinuten(22 * 60, 25 * 60)).toBe(180);
    expect(nachtMinuten(8 * 60, 12 * 60)).toBe(0);
  });

  it('loonparameters: rijtijd, stationnement, onderbrekingen, administratie, nacht en tiktijden per dienstdeel', () => {
    const s = [
      seg({ volgorde: 1, type: 'AVO', startMin: 5 * 60, eindeMin: 5 * 60 + 5 }),
      seg({ volgorde: 2, type: 'LED', startMin: 5 * 60 + 5, eindeMin: 5 * 60 + 15 }),
      seg({ volgorde: 3, type: 'RIT', startMin: 5 * 60 + 15, eindeMin: 8 * 60 }),
      seg({ volgorde: 4, type: 'STA', startMin: 8 * 60, eindeMin: 8 * 60 + 50 }),
      seg({ volgorde: 5, type: 'RIT', startMin: 8 * 60 + 50, eindeMin: 12 * 60 }),
      seg({ volgorde: 6, type: 'ONE', startMin: 12 * 60, eindeMin: 15 * 60 }),
      seg({ volgorde: 7, type: 'RIT', startMin: 15 * 60, eindeMin: 20 * 60 + 30 }),
      seg({ volgorde: 8, type: 'ANW', startMin: 20 * 60 + 30, eindeMin: 20 * 60 + 40 }),
      seg({ volgorde: 9, type: 'ANA', startMin: 20 * 60 + 40, eindeMin: 20 * 60 + 50 }),
    ];
    const p = loonParametersVanSegmenten(s);
    expect(p).toMatchObject({ lbRijtijd: 10 + 165 + 190 + 330, lbStat100At: 15, lbStat100Nat: 30, lbStat50Nat: 5, lbOnd: 1, lbAndWrk: 10, lbAdmT: 15, lbNacht: 60 + 50, teVeelDelen: false });
    expect(p.lbArbTijd).toBe(p.lbRijtijd + 15 + 15 + 10);
    expect(p.tiktijden).toEqual([{ begin: '05:00', einde: '12:00' }, { begin: '15:00', einde: '20:50' }]);
  });

  it('controles: gat, overlap, einde vóór start, rit zonder loop, snelheid', () => {
    const b = controleerSegmenten([
      seg({ volgorde: 1, type: 'RIT', startMin: 600, eindeMin: 630, loop: '4500', afstandKm: 60 }),
      seg({ volgorde: 2, type: 'RIT', startMin: 640, eindeMin: 700 }),
      seg({ volgorde: 3, type: 'LED', startMin: 690, eindeMin: 720, loop: '4500' }),
      seg({ volgorde: 4, type: 'STA', startMin: 730, eindeMin: 725, duurMin: 5 }),
    ]);
    expect(b.map((x) => x.soort)).toEqual(['snelheid', 'zonder_loop', 'gat', 'overlap', 'einde_voor_start', 'gat']);
    expect(b.filter((x) => x.ernst === 'fout').length).toBe(4);
  });

  it('ritblad: zonder stationnement, ledige ritten als "led", loop in de via-kolom vanaf de stelplaats', () => {
    const r = ritbladVanSegmenten([
      seg({ volgorde: 1, type: 'LED', startMin: 442, eindeMin: 444, loop: '4506', vertrek: 'Garage Van Hoorebeke', aankomst: 'Maldegem Markt' }),
      seg({ volgorde: 2, type: 'RIT', startMin: 444, eindeMin: 482, loop: '4506', lijn: '871', variant: '01c', rit: '51', vertrek: 'Maldegem Markt', aankomst: 'Aalter Station' }),
      seg({ volgorde: 3, type: 'STA', startMin: 482, eindeMin: 500 }),
      seg({ volgorde: 4, type: 'ONE', startMin: 500, eindeMin: 1500 }),
    ], (v) => (v === '01c' ? 'Kleit' : ''));
    expect(r).toEqual([
      { type: 'LED', lijn: '', rit: 'led', loop: '4506', vertrek: 'Garage Van Hoorebeke', start: '07:22', aankomst: 'Maldegem Markt', einde: '07:24', via: '4506' },
      { type: 'RIT', lijn: '871', rit: '51', loop: '4506', vertrek: 'Maldegem Markt', start: '07:24', aankomst: 'Aalter Station', einde: '08:02', via: 'Kleit' },
      { type: 'ONE', lijn: '', rit: 'one', loop: '', vertrek: '', start: '08:20', aankomst: '', einde: '01:00', via: '' },
    ]);
  });
});
