import { describe, expect, it } from 'vitest';
import { dienstenUitRijen, excelTijd, zonderGelijkeTijden } from './dienstImport';

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

  it('een deel met gelijke begin- en eindtijd (Jarno 29-09): de tijden gaan niet mee, met een waarschuwing per deel, nooit stil', () => {
    // Een 0 in een ongebruikte kolom wordt "00:00": deel 3 van 2115 is dan 00:00 tot 00:00.
    const rijen = [
      { Dienst: '2115', Begin: '06:00', Einde: '14:00', Loop: '4505', begin_1: '08:00', einde_1: '08:00', loop_1: '4510', begin_2: 0, einde_2: 0, loop_2: '' },
      { Dienst: '2116', Begin: '22:00', Einde: '06:00', Loop: '4600', begin_1: '16:00', einde_1: '00:00', begin_2: '08:00', einde_2: '32:00' },
    ];
    const { diensten, waarschuwingen } = zonderGelijkeTijden(dienstenUitRijen(rijen, 1000));
    expect(diensten).toEqual([
      { id: '1000', serviceNumber: '2115', startTime: '06:00', endTime: '14:00', startTime2: '', endTime2: '', startTime3: '', endTime3: '', loopnr: '4505', loopnr2: '4510', loopnr3: '' },
      // Nachtdelen in gewone uren en een etmaal in busvak-uren zijn geldig en blijven.
      { id: '1001', serviceNumber: '2116', startTime: '22:00', endTime: '06:00', startTime2: '16:00', endTime2: '00:00', startTime3: '08:00', endTime3: '32:00', loopnr: '4600', loopnr2: '', loopnr3: '' },
    ]);
    expect(waarschuwingen).toEqual([
      'Deel 2 van dienst 2115 heeft dezelfde begin- en eindtijd (08:00). Een dienst van een etmaal schrijf je in busvak-uren, bv. 08:00 tot 32:00. De tijden van dat deel worden niet geïmporteerd.',
      'Deel 3 van dienst 2115 heeft dezelfde begin- en eindtijd (00:00). Een dienst van een etmaal schrijf je in busvak-uren, bv. 00:00 tot 24:00. De tijden van dat deel worden niet geïmporteerd.',
    ]);
    // Zonder zo'n deel: dezelfde lijst, geen waarschuwing.
    const schoon = dienstenUitRijen([rijen[1]], 1000);
    expect(zonderGelijkeTijden(schoon)).toEqual({ diensten: schoon, waarschuwingen: [] });
  });
});
