import { describe, expect, it } from 'vitest';
import { dienstenUitRijen, excelTijd, neemVariantenOver } from './dienstImport';

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
});

describe('neemVariantenOver', () => {
  const wo = { dagtypes: ['23'], startTime: '06:30', endTime: '08:30', startTime2: '12:00', endTime2: '14:00' };
  const huidig = [
    { id: 'a', serviceNumber: 'EEK6', startTime: '06:30', endTime: '08:30', startTime2: '15:00', endTime2: '17:00', varianten: [wo] },
    { id: 'b', serviceNumber: 'EEK1', startTime: '06:30', endTime: '08:30', varianten: [wo] },
    { id: 'c', serviceNumber: '2101', startTime: '04:36', endTime: '07:52' },
  ];

  it('geeft diensten uit het bestand de afwijkingen van de dienst van nu met hetzelfde nummer, en noemt wat verdwijnt', () => {
    const uit = neemVariantenOver([
      { id: '1', serviceNumber: ' eek6 ', startTime: '06:30', endTime: '08:30', startTime2: '15:10', endTime2: '17:10' },
      { id: '2', serviceNumber: '2101', startTime: '04:40', endTime: '07:55' },
    ], huidig as any);
    expect(uit.overgenomen).toBe(1);
    expect(uit.nietInBestand).toEqual(['EEK1']);
    expect(uit.diensten[0].varianten).toEqual([wo]);
    expect(uit.diensten[0].startTime2).toBe('15:10');
    expect(uit.diensten[1].varianten).toBeUndefined();
    // Een kopie, niet dezelfde lijst: het formulier mag de oude niet aanpassen.
    expect(uit.diensten[0].varianten).not.toBe(huidig[0].varianten);
  });

  it('zonder afwijkingen in de huidige lijst verandert er niets', () => {
    const bestand = [{ id: '1', serviceNumber: '2101', startTime: '04:36', endTime: '07:52' }];
    expect(neemVariantenOver(bestand, [huidig[2]] as any)).toEqual({ diensten: bestand, overgenomen: 0, nietInBestand: [] });
  });
});
