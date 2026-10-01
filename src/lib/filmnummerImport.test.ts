// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { decodeerTekst, filmnummersUitRijen, leesCsv, rijenUitBestand, vergelijkFilmnummers } from './filmnummerImport';
import type { Filmnummer } from '../../shared/filmnummers';

const f = (code: string, lijn: string, tekst: string): Filmnummer => ({ code, lijn, tekst });

// De opbouw van het echte bestand van VHB (01-10): twee kolommen zonder
// kopregel; lage nummers staan er als getal, de rest als tekst, en de lijn
// staat vooraan in de tekst.
const VHB_RIJEN: unknown[][] = [
  [1, 'Geen dienst'],
  [33, 'L Opleiding'],
  [94, 'Stelplaats'],
  [113, "MAN Lion's City"],
  [123, '100% Electric'],
  ['5000', '50 Brugge Station'],
  ['5056', 'G50 Eeklo Markt via Mariakerke P'],
  ['5146', 'G12 St-Martens-Leerne via Blaarm'],
  ['8716', '871 Deinze Station via Knesselar'],
  ['9070', '907 Mariakerke VISO-AHS'],
];

describe('filmnummersUitRijen, het bestand van VHB (nummer, tekst)', () => {
  it('haalt de lijn uit het begin van de tekst en laat algemene boodschappen zonder lijn', () => {
    const uit = filmnummersUitRijen(VHB_RIJEN);
    expect(uit.gelezen).toEqual({ kopregel: false, lijnKolom: false, lijnKolomOngebruikt: false, extraCellen: 0 });
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.items).toEqual([
      f('1', '', 'Geen dienst'),
      f('33', '', 'L Opleiding'),
      f('94', '', 'Stelplaats'),
      f('113', '', "MAN Lion's City"),
      f('123', '', '100% Electric'),
      f('5000', '50', 'Brugge Station'),
      f('5056', 'G50', 'Eeklo Markt via Mariakerke P'),
      f('5146', 'G12', 'St-Martens-Leerne via Blaarm'),
      f('8716', '871', 'Deinze Station via Knesselar'),
      f('9070', '907', 'Mariakerke VISO-AHS'),
    ]);
  });

  it('meldt wat hij niet kan lezen met regel en reden, en leest de rest', () => {
    const uit = filmnummersUitRijen([
      [1, 'Geen dienst'],
      ['', ''],
      ['58A', '50 Brugge'],
      ['', 'Los stuk tekst'],
      [7, ''],
      [1, 'Nog eens'],
      [12.5, 'Half nummer'],
      ['5000', '50 Brugge Station'],
    ]);
    expect(uit.items.map((x) => x.code)).toEqual(['1', '5000']);
    expect(uit.overgeslagen).toEqual([
      { regel: 3, inhoud: '58A · 50 Brugge', reden: 'Het nummer bestaat niet uit 1 tot 6 cijfers' },
      { regel: 4, inhoud: 'Los stuk tekst', reden: 'Geen nummer' },
      { regel: 5, inhoud: '7', reden: 'Geen boodschap' },
      { regel: 6, inhoud: '1 · Nog eens', reden: 'Nummer 1 staat al op regel 1' },
      { regel: 7, inhoud: '12.5 · Half nummer', reden: 'Het nummer bestaat niet uit 1 tot 6 cijfers' },
    ]);
  });

  it('een leeg bestand geeft niets, zonder fout', () => {
    expect(filmnummersUitRijen([])).toEqual({ items: [], overgeslagen: [], gelezen: { kopregel: false, lijnKolom: false, lijnKolomOngebruikt: false, extraCellen: 0 } });
    expect(filmnummersUitRijen([['', ''], []]).items).toEqual([]);
  });
});

describe('filmnummersUitRijen, andere opbouw', () => {
  it('volgt een kopregel, ook onder een titel en met de kolommen in een andere volgorde', () => {
    const uit = filmnummersUitRijen([
      ['Filmbeelden vanaf 09/01/2023'],
      [],
      ['Boodschap', 'Code', 'Lijn nummer'],
      ['Geen dienst', 1, ''],
      ['Brugge Station', 5800, 58],
      ['Tielt Station via Lotenhulle', '8830', 'Lijn 883'],
    ]);
    expect(uit.gelezen).toEqual({ kopregel: true, lijnKolom: true, lijnKolomOngebruikt: false, extraCellen: 0 });
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.items).toEqual([f('1', '', 'Geen dienst'), f('5800', '58', 'Brugge Station'), f('8830', '883', 'Tielt Station via Lotenhulle')]);
  });

  it('een kopregel zonder lijnkolom: de lijn komt uit de tekst', () => {
    const uit = filmnummersUitRijen([['Nummer', 'Bestemming'], ['5000', '50 Brugge Station'], ['94', 'Stelplaats']]);
    expect(uit.gelezen).toEqual({ kopregel: true, lijnKolom: false, lijnKolomOngebruikt: false, extraCellen: 0 });
    expect(uit.items).toEqual([f('94', '', 'Stelplaats'), f('5000', '50', 'Brugge Station')]);
  });

  it('met een eigen lijnkolom blijft een tekst die met een getal begint heel', () => {
    const uit = filmnummersUitRijen([['Code', 'Lijn', 'Boodschap'], [52, '', '24 uur van Maldegem'], [5000, 50, 'Brugge Station']]);
    expect(uit.items).toEqual([f('52', '', '24 uur van Maldegem'), f('5000', '50', 'Brugge Station')]);
  });

  it('leest meerdere blokken naast elkaar op één blad', () => {
    const uit = filmnummersUitRijen([
      ['Code', 'Lijn', 'Boodschap', '', 'Code', 'Lijn', 'Boodschap'],
      [1, '', 'Geen dienst', '', 8700, 87, 'Deinze Station'],
      [2, '', 'Versterkingsrit', '', '', '', ''],
    ]);
    expect(uit.items.map((x) => x.code)).toEqual(['1', '2', '8700']);
    expect(uit.overgeslagen).toEqual([]);
  });

  it('drie kolommen zonder kopregel: nummer, lijn, tekst', () => {
    const uit = filmnummersUitRijen([[1, '', 'Geen dienst'], [5800, 58, 'Brugge Station']]);
    expect(uit.gelezen).toEqual({ kopregel: false, lijnKolom: true, lijnKolomOngebruikt: false, extraCellen: 0 });
    expect(uit.items).toEqual([f('1', '', 'Geen dienst'), f('5800', '58', 'Brugge Station')]);
    // Alleen algemene boodschappen: de lijnkolom is overal leeg, de tekst staat in kolom 3.
    expect(filmnummersUitRijen([[1, '', 'Geen dienst'], [94, '', 'Stelplaats']]).items).toEqual([f('1', '', 'Geen dienst'), f('94', '', 'Stelplaats')]);
  });
});

describe('filmnummersUitRijen, wat het bestand niet mag kantelen (tegenlezing 01-10)', () => {
  it('één opmerking in een derde kolom verandert de indeling niet: de regel blijft, de opmerking is gemeld', () => {
    const rijen = VHB_RIJEN.map((r) => [...r]);
    rijen[5] = ['5000', '50 Brugge Station', 'altijd bij uitrukken'];
    const uit = filmnummersUitRijen(rijen);
    expect(uit.items).toEqual(filmnummersUitRijen(VHB_RIJEN).items);
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.gelezen).toEqual({ kopregel: false, lijnKolom: false, lijnKolomOngebruikt: false, extraCellen: 1 });
  });

  it('een derde kolom bij elke regel is pas een lijnkolom als de tweede er als een lijn uitziet', () => {
    const uit = filmnummersUitRijen(VHB_RIJEN.map((r) => [...r, 'opmerking']));
    expect(uit.items).toEqual(filmnummersUitRijen(VHB_RIJEN).items);
    expect(uit.gelezen).toEqual({ kopregel: false, lijnKolom: false, lijnKolomOngebruikt: false, extraCellen: VHB_RIJEN.length });
  });

  it('een komma-CSV met een komma in de tekst: de regel blijft, de rest van de tekst is gemeld als niet gelezen', () => {
    const uit = filmnummersUitRijen(leesCsv('1,Geen dienst\n90,GEEN DIENST, mijn collega pikt je op.\n5000,50 Brugge Station'));
    expect(uit.items).toEqual([f('1', '', 'Geen dienst'), f('90', '', 'GEEN DIENST'), f('5000', '50', 'Brugge Station')]);
    expect(uit.gelezen.extraCellen).toBe(1);
  });

  it('haalt alleen bij een nummer van vier cijfers of meer de lijn uit de tekst', () => {
    const uit = filmnummersUitRijen([
      [52, '24 uur van Maldegem'],
      [53, '11 juli'],
      [54, '100 jaar De Lijn'],
      [158, 'E3 Harelbeke'],
      ['5000', '50 Brugge Station'],
      ['12345', 'G50 Eeklo Markt'],
    ]);
    expect(uit.items).toEqual([
      f('52', '', '24 uur van Maldegem'),
      f('53', '', '11 juli'),
      f('54', '', '100 jaar De Lijn'),
      f('158', '', 'E3 Harelbeke'),
      f('5000', '50', 'Brugge Station'),
      f('12345', 'G50', 'Eeklo Markt'),
    ]);
  });

  it('een regel met een nummer boven de kopregel valt niet stil weg', () => {
    const uit = filmnummersUitRijen([
      ['Filmbeelden'],
      [1, 'Geen dienst'],
      ['Code', 'Bestemming'],
      ['5000', '50 Brugge Station'],
    ]);
    expect(uit.items).toEqual([f('5000', '50', 'Brugge Station')]);
    expect(uit.overgeslagen).toEqual([{ regel: 2, inhoud: '1 · Geen dienst', reden: 'Staat boven de kopregel' }]);
  });

  it('een kopregel verderop bepaalt de indeling van de regels eronder', () => {
    const uit = filmnummersUitRijen([
      ['Code', 'Boodschap'],
      [1, 'Geen dienst'],
      [],
      ['Code', 'Lijn', 'Bestemming'],
      [5000, 50, 'Brugge Station'],
      [5200, '', '24 uur van Maldegem'],
    ]);
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.items).toEqual([f('1', '', 'Geen dienst'), f('5000', '50', 'Brugge Station'), f('5200', '', '24 uur van Maldegem')]);
    expect(uit.gelezen).toEqual({ kopregel: true, lijnKolom: true, lijnKolomOngebruikt: false, extraCellen: 0 });
  });

  it('"Lijnnaam" is geen lijnkolom; een lijnkolom die bij geen blok past blijft ongebruikt en dat staat erbij', () => {
    const naam = filmnummersUitRijen([['Code', 'Lijn', 'Lijnnaam', 'Boodschap'], [5000, 50, 'Brugge - Gent', 'Brugge Station']]);
    expect(naam.items).toEqual([f('5000', '50', 'Brugge Station')]);
    expect(naam.gelezen.lijnKolomOngebruikt).toBe(false);

    const scheef = filmnummersUitRijen([
      ['Code', 'Boodschap', '', 'Code', 'Lijn', 'Boodschap'],
      [1, 'Geen dienst', '', 5000, 50, 'Brugge Station'],
    ]);
    expect(scheef.gelezen).toEqual({ kopregel: true, lijnKolom: false, lijnKolomOngebruikt: true, extraCellen: 0 });
    expect(scheef.items).toEqual([f('1', '', 'Geen dienst'), f('5000', '', 'Brugge Station')]);
  });

  it('een datum die Excel van de tekst maakte (een getal in de tekstkolom) wordt gemeld, niet als serienummer bewaard', () => {
    const uit = filmnummersUitRijen([[1, 'Geen dienst'], [52, 46143]]);
    expect(uit.items).toEqual([f('1', '', 'Geen dienst')]);
    expect(uit.overgeslagen).toEqual([{ regel: 2, inhoud: '52 · 46143', reden: 'De boodschap is een getal; staat er in Excel een datum of een getal in die cel?' }]);
  });

  it('weigert een lijst van meer dan 1000 nummers in haar geheel', () => {
    const rij = (n: number) => [String(n), `Boodschap ${n}`];
    expect(filmnummersUitRijen(Array.from({ length: 1000 }, (_, i) => rij(i + 1))).items).toHaveLength(1000);
    const teVeel = filmnummersUitRijen(Array.from({ length: 1001 }, (_, i) => rij(i + 1)));
    expect(teVeel.items).toEqual([]);
    expect(teVeel.overgeslagen).toEqual([{ regel: 0, inhoud: '1001 nummers', reden: 'Een lijst telt hooguit 1000 filmnummers' }]);
  });
});

describe('leesCsv', () => {
  it('leest de puntkomma van Excel, met een komma in de tekst', () => {
    expect(leesCsv('1;Geen dienst\r\n90;GEEN DIENST, mijn collega pikt je op.\r\n')).toEqual([
      ['1', 'Geen dienst'],
      ['90', 'GEEN DIENST, mijn collega pikt je op.'],
    ]);
  });

  it('leest komma en tab, aanhalingstekens, een BOM en de sep-regel van Excel', () => {
    expect(leesCsv('﻿5000,"50 Brugge, Station"\n94,"Een ""stelplaats"""')).toEqual([['5000', '50 Brugge, Station'], ['94', 'Een "stelplaats"']]);
    expect(leesCsv('5000\t50 Brugge Station\n1\tGeen dienst')).toEqual([['5000', '50 Brugge Station'], ['1', 'Geen dienst']]);
    // De sep-regel blijft als lege regel staan: zo klopt het regelnummer in een melding.
    expect(leesCsv('sep=|\n5000|50 Brugge; Station')).toEqual([[], ['5000', '50 Brugge; Station']]);
    expect(filmnummersUitRijen(leesCsv('sep=;\n1;Geen dienst\nABC;x')).overgeslagen).toEqual([{ regel: 3, inhoud: 'ABC · x', reden: 'Het nummer bestaat niet uit 1 tot 6 cijfers' }]);
    expect(leesCsv('1;"twee\nregels"\n2;x')).toEqual([['1', 'twee\nregels'], ['2', 'x']]);
  });

  it('een CSV van het VHB-bestand geeft dezelfde lijst als de Excel', () => {
    const csv = VHB_RIJEN.map((r) => r.join(';')).join('\r\n');
    expect(filmnummersUitRijen(leesCsv(csv)).items).toEqual(filmnummersUitRijen(VHB_RIJEN).items);
  });
});

describe('rijenUitBestand', () => {
  it('leest een CSV in UTF-8 en in Windows-1252 (Excel op Windows)', async () => {
    const utf8 = new TextEncoder().encode('5000;50 Café Brugge\n');
    expect(await rijenUitBestand(new Blob([utf8]))).toEqual([['5000', '50 Café Brugge']]);
    // "é" als één byte 0xE9: geen geldige UTF-8.
    const win = new Uint8Array([...new TextEncoder().encode('5000;50 Caf'), 0xe9, ...new TextEncoder().encode(' Brugge\n')]);
    expect(decodeerTekst(win)).toBe('5000;50 Café Brugge\n');
    expect(await rijenUitBestand(new Blob([win]))).toEqual([['5000', '50 Café Brugge']]);
  });

  it('leest "Unicode-tekst (.txt)" uit Excel: UTF-16 met een BOM en tabs', async () => {
    const utf16 = (tekst: string, groot: boolean) => {
      const bytes = new Uint8Array(2 + tekst.length * 2);
      bytes.set(groot ? [0xfe, 0xff] : [0xff, 0xfe]);
      for (let i = 0; i < tekst.length; i++) {
        const c = tekst.charCodeAt(i);
        bytes.set(groot ? [c >> 8, c & 0xff] : [c & 0xff, c >> 8], 2 + i * 2);
      }
      return bytes;
    };
    const tekst = '5000\t50 Café Brugge\r\n1\tGeen dienst\r\n';
    for (const groot of [false, true]) {
      expect(await rijenUitBestand(new Blob([utf16(tekst, groot)]))).toEqual([['5000', '50 Café Brugge'], ['1', 'Geen dienst']]);
    }
  });

  it('leest het eerste blad van een Excel-werkmap, wat de bestandsnaam ook is', async () => {
    const blad = XLSX.utils.aoa_to_sheet(VHB_RIJEN);
    const werkmap = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(werkmap, blad, 'Blad1');
    const bytes = XLSX.write(werkmap, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const rijen = await rijenUitBestand(new Blob([bytes]));
    expect(rijen).toHaveLength(VHB_RIJEN.length);
    expect(filmnummersUitRijen(rijen).items).toEqual(filmnummersUitRijen(VHB_RIJEN).items);
  });
});

describe('vergelijkFilmnummers', () => {
  it('zegt per nummer wat nieuw is, wijzigt of verdwijnt', () => {
    const huidig = [f('1', '', 'Geen dienst'), f('5000', '50', 'Brugge Station'), f('5001', '50', 'Maldegem')];
    const volgende = [f('1', '', 'Geen dienst'), f('5000', '50', 'Brugge Station Perron 3'), f('5002', '50', 'Eeklo')];
    expect(vergelijkFilmnummers(huidig, volgende)).toEqual({
      nieuw: [f('5002', '50', 'Eeklo')],
      gewijzigd: [{ voor: f('5000', '50', 'Brugge Station'), na: f('5000', '50', 'Brugge Station Perron 3') }],
      weg: [f('5001', '50', 'Maldegem')],
    });
    expect(vergelijkFilmnummers(huidig, huidig)).toEqual({ nieuw: [], gewijzigd: [], weg: [] });
  });
});
