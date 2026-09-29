import { describe, expect, it } from 'vitest';
import { dienstenUitRijen, excelTijd, leesDienstenImport } from './dienstImport';

describe('dienstImport', () => {
  it('excelTijd: Excel-fractie en tekst naar UU:MM, leeg blijft leeg', () => {
    expect(excelTijd(0.5)).toBe('12:00');
    expect(excelTijd(1.0625)).toBe('25:30');
    expect(excelTijd('6:05')).toBe('06:05');
    expect(excelTijd('')).toBe('');
    expect(excelTijd(undefined)).toBe('');
  });

  it('herkent de kolommen per deel, ook de xlsx-achtervoegsels, en laat rijen zonder dienstnummer weg', () => {
    const rijen = [
      { Dienst: '2515', Begin: '07:08', Einde: '08:34', Loop: '4505', begin_1: '15:13', einde_1: '21:55', loop_1: '4510', begin_2: 1.0069444444, einde_2: 1.0486111111, loop_2: '4515' },
      { Dienst: ' 2101 ', 'Start 1': '4:36', 'Eind 1': '7:52', 'Loop 1': 4500 },
      { Dienst: '', Begin: '09:00', Einde: '10:00' },
    ];
    const diensten = dienstenUitRijen(rijen, 1000);
    expect(diensten).toEqual([
      { id: '1000', serviceNumber: '2515', startTime: '07:08', endTime: '08:34', startTime2: '15:13', endTime2: '21:55', startTime3: '24:10', endTime3: '25:10', loopnr: '4505', loopnr2: '4510', loopnr3: '4515' },
      { id: '1001', serviceNumber: '2101', startTime: '04:36', endTime: '07:52', startTime2: '', endTime2: '', startTime3: '', endTime3: '', loopnr: '4500', loopnr2: '', loopnr3: '' },
    ]);
  });

  it('een deel zonder venster (Jarno 29-09): zonder tijden én zonder loopnummer, met dienst en deel, nooit stil', () => {
    const rijen = [
      { Dienst: '2115', Begin: '06:00', Einde: '14:00', Loop: '4505', begin_1: '08:00', einde_1: '08:00', loop_1: '4510', begin_2: '24:30', einde_2: '00:00', loop_2: '4515' },
      { Dienst: '2116', Begin: '22:00', Einde: '06:00', Loop: '4600', begin_1: '16:00', einde_1: '00:00', begin_2: '08:00', einde_2: '32:00' },
    ];
    const uit = leesDienstenImport(rijen, 1000);
    expect(uit.diensten).toEqual([
      // Het loopnummer gaat mee weg: anders telde het mee in de kerncijfer "loops".
      { id: '1000', serviceNumber: '2115', startTime: '06:00', endTime: '14:00', startTime2: '', endTime2: '', startTime3: '', endTime3: '', loopnr: '4505', loopnr2: '', loopnr3: '' },
      // Nachtdelen in gewone uren en een etmaal in busvak-uren zijn geldig en blijven.
      { id: '1001', serviceNumber: '2116', startTime: '22:00', endTime: '06:00', startTime2: '16:00', endTime2: '00:00', startTime3: '08:00', endTime3: '32:00', loopnr: '4600', loopnr2: '', loopnr3: '' },
    ]);
    expect(uit.ongeldig.map((d) => [d.dienst, d.deel, d.soort, d.tijden])).toEqual([
      ['2115', 2, 'gelijk', '08:00'],
      ['2115', 3, 'geenVenster', '24:30 tot 00:00'],
    ]);
    expect(uit.legeDelen).toBe(0);
    expect(uit.zonderGeldigDeel).toEqual([]);
    // Zonder zo'n deel: dezelfde diensten als dienstenUitRijen, niets te melden.
    expect(leesDienstenImport([rijen[1]], 1000)).toEqual({ diensten: dienstenUitRijen([rijen[1]], 1000), legeDelen: 0, ongeldig: [], zonderGeldigDeel: [] });
  });

  it('0 als begin én einde (een lege kolom in Excel) is een leeg deel: geen tijden, geen loopnummer, alleen geteld', () => {
    const rijen = [
      { Dienst: '2115', Begin: '06:00', Einde: '14:00', Loop: '4505', begin_1: 0, einde_1: 0, loop_1: '4510', begin_2: 0, einde_2: 0, loop_2: '' },
      { Dienst: '2116', Begin: '22:00', Einde: '06:00', Loop: '4600', begin_1: 0, einde_1: 0, begin_2: '', einde_2: '' },
      // Tekst "00:00" is geen lege kolom: dat blijft een deel met gelijke tijden.
      { Dienst: '2117', Begin: '05:00', Einde: '09:00', begin_1: '00:00', einde_1: '00:00' },
    ];
    const uit = leesDienstenImport(rijen, 1000);
    expect(uit.diensten.map((d) => [d.serviceNumber, d.startTime2, d.endTime2, d.loopnr2, d.startTime3, d.endTime3])).toEqual([
      ['2115', '', '', '', '', ''],
      ['2116', '', '', '', '', ''],
      ['2117', '', '', '', '', ''],
    ]);
    expect(uit.legeDelen).toBe(3);
    expect(uit.ongeldig.map((d) => [d.dienst, d.deel, d.tijden])).toEqual([['2117', 2, '00:00']]);
    expect(uit.zonderGeldigDeel).toEqual([]);
  });

  it('een dienst die zo geen enkel geldig deel meer heeft, wordt apart genoemd (ze krijgt geen planning-rijen)', () => {
    const rijen = [
      { Dienst: '2118', Begin: '08:00', Einde: '08:00', Loop: '4700' },
      { Dienst: '2119', Begin: 0, Einde: 0, Loop: '4701' },
      { Dienst: '2120', Begin: '30:00', Einde: '06:00', begin_1: '07:00', einde_1: '09:00' },
      // Geen tijden in het bestand zelf: dat was al zo, de import maakte niets leeg.
      { Dienst: '2121', Begin: '', Einde: '' },
    ];
    const uit = leesDienstenImport(rijen, 1000);
    expect(uit.zonderGeldigDeel).toEqual(['2118', '2119']);
    expect(uit.diensten.map((d) => [d.serviceNumber, d.startTime, d.endTime, d.loopnr])).toEqual([
      ['2118', '', '', ''],
      ['2119', '', '', ''],
      ['2120', '', '', ''],
      ['2121', '', '', ''],
    ]);
    expect(uit.diensten[2]).toMatchObject({ startTime2: '07:00', endTime2: '09:00' });
  });
});
