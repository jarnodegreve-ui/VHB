import { describe, expect, it } from 'vitest';
import { beoordeelRuilRust, formatRust, type RustPlanningRij } from './ruilRust';

const rij = (driverId: string, date: string, line: string, startTime: string, endTime: string): RustPlanningRij => ({ driverId, date, line, startTime, endTime });
const A = 'a'; // aanvrager
const B = 'b'; // collega

describe('beoordeelRuilRust', () => {
  it('overname: de collega krijgt de dienst, zijn rust t.o.v. de dag ervoor en erna telt', () => {
    const planning = [
      rij(A, '2026-10-07', '2101', '05:30', '13:45'), // wordt overgenomen
      rij(B, '2026-10-06', '2230', '15:40', '23:50'), // laat, de dag ervoor
      rij(B, '2026-10-08', '2105', '06:00', '14:00'),
    ];
    const [regel] = beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'pending', shiftDate: '2026-10-07', shiftLine: '2101' }, planning);
    expect(regel).toMatchObject({ wie: 'collega', datum: '2026-10-07', dienst: '2101' });
    // 23:50 → 05:30 = 5u40
    expect(regel.rustVoor).toBe(5 * 60 + 40);
    // 13:45 → 06:00 = 16u15
    expect(regel.rustNa).toBe(16 * 60 + 15);
    expect(regel.teKort).toBe(true);
  });

  it('precies 8 uur rust is genoeg; een vrije dag ervoor of erna zegt niets', () => {
    const planning = [
      rij(A, '2026-10-07', '2101', '06:00', '14:00'),
      rij(B, '2026-10-06', '2230', '14:00', '22:00'), // 22:00 → 06:00 = 8u
    ];
    const [regel] = beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'accepted', shiftDate: '2026-10-07', shiftLine: '2101' }, planning);
    expect(regel.rustVoor).toBe(480);
    expect(regel.rustNa).toBeNull();
    expect(regel.teKort).toBe(false);
  });

  it('een gesplitste dienst telt van het eerste begin tot het laatste einde', () => {
    const planning = [
      rij(A, '2026-10-07', '2515', '06:10', '09:00'),
      rij(A, '2026-10-07', '2515', '15:30', '19:20'),
      rij(B, '2026-10-08', '2101', '02:30', '10:00'), // 19:20 → 02:30 = 7u10
    ];
    const [regel] = beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'pending', shiftDate: '2026-10-07', shiftLine: '2515' }, planning);
    expect(regel.rustNa).toBe(7 * 60 + 10);
    expect(regel.teKort).toBe(true);
  });

  it('busvak-notatie: een dienst tot 26:16 eindigt om 02:16 de nacht erna', () => {
    const planning = [
      rij(A, '2026-10-07', '2240', '17:00', '26:16'),
      rij(B, '2026-10-08', '2101', '09:00', '17:00'), // 02:16 → 09:00 = 6u44
    ];
    const [regel] = beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'pending', shiftDate: '2026-10-07', shiftLine: '2240' }, planning);
    expect(regel.rustNa).toBe(6 * 60 + 44);
  });

  it('ruil met tegenprestatie op een andere dag: ook de aanvrager krijgt een dienst', () => {
    const planning = [
      rij(A, '2026-10-07', '2101', '06:00', '14:00'), // gaat naar B
      rij(B, '2026-10-09', '2230', '15:00', '23:30'), // gaat naar A
      rij(A, '2026-10-10', '2105', '05:00', '13:00'), // A's dag na de terugdienst: 23:30 → 05:00 = 5u30
    ];
    const regels = beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'pending', shiftDate: '2026-10-07', shiftLine: '2101', returnDate: '2026-10-09', returnCode: '2230' }, planning);
    expect(regels.map((r) => r.wie)).toEqual(['collega', 'aanvrager']);
    const voorA = regels[1];
    expect(voorA).toMatchObject({ datum: '2026-10-09', dienst: '2230', rustNa: 5 * 60 + 30, teKort: true });
  });

  it('rekent met de planning NA de ruil: een weggegeven dienst telt niet meer mee als "dag ervoor"', () => {
    const planning = [
      rij(A, '2026-10-07', '2230', '15:00', '23:45'), // A geeft deze weg
      rij(B, '2026-10-08', '2101', '05:00', '13:00'), // en krijgt deze, de dag erna
    ];
    const regels = beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'pending', shiftDate: '2026-10-07', shiftLine: '2230', returnDate: '2026-10-08', returnCode: '2101' }, planning);
    const voorA = regels.find((r) => r.wie === 'aanvrager')!;
    // Zonder de ruil zou 23:45 → 05:00 maar 5u15 zijn; A rijdt de late dienst echter niet meer.
    expect(voorA.rustVoor).toBeNull();
    expect(voorA.teKort).toBe(false);
    // Voor B omgekeerd: hij rijdt zijn vroege van de 8e niet meer.
    const voorB = regels.find((r) => r.wie === 'collega')!;
    expect(voorB.rustNa).toBeNull();
  });

  it('1-op-1 op dezelfde dag: elk krijgt de dienst van de ander', () => {
    const planning = [
      rij(A, '2026-10-07', '2101', '05:00', '13:00'),
      rij(B, '2026-10-07', '2230', '15:00', '23:50'),
      rij(A, '2026-10-08', '2105', '06:00', '14:00'), // A rijdt nu laat op de 7e: 23:50 → 06:00 = 6u10
    ];
    const regels = beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'pending', shiftDate: '2026-10-07', shiftLine: '2101', returnDate: '2026-10-07', returnCode: '2230' }, planning);
    expect(regels.find((r) => r.wie === 'aanvrager')).toMatchObject({ dienst: '2230', rustNa: 6 * 60 + 10, teKort: true });
    expect(regels.find((r) => r.wie === 'collega')).toMatchObject({ dienst: '2101', teKort: false });
  });

  it('tegenprestatie "vrij" is geen dienst; een afgesloten of open ruil wordt niet nagerekend', () => {
    const planning = [rij(A, '2026-10-07', '2101', '06:00', '14:00')];
    const basis = { requesterId: A, targetDriverId: B, shiftDate: '2026-10-07', shiftLine: '2101' };
    expect(beoordeelRuilRust({ ...basis, status: 'pending', returnDate: '2026-10-09', returnCode: 'VRIJ' }, planning).map((r) => r.wie)).toEqual(['collega']);
    expect(beoordeelRuilRust({ ...basis, status: 'approved' }, planning)).toEqual([]);
    expect(beoordeelRuilRust({ ...basis, status: 'pending', targetDriverId: '' }, planning)).toEqual([]);
  });

  it('kapotte tijden geven geen regel in plaats van een verzonnen getal', () => {
    const planning = [rij(A, '2026-10-07', '2101', 'x', '14:00')];
    expect(beoordeelRuilRust({ requesterId: A, targetDriverId: B, status: 'pending', shiftDate: '2026-10-07', shiftLine: '2101' }, planning)).toEqual([]);
  });
});

describe('formatRust', () => {
  it('schrijft uren compact en nooit negatief', () => {
    expect(formatRust(480)).toBe('8u');
    expect(formatRust(430)).toBe('7u10');
    expect(formatRust(-20)).toBe('0u');
  });
});
