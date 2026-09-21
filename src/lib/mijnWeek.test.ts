import { describe, expect, it } from 'vitest';
import { bouwMijnWeek, weekDagZin } from './mijnWeek';
import type { Shift } from '../types';

const dienst = (date: string, line: string, startTime: string, endTime: string, id = `${date}-${startTime}`): Shift =>
  ({ id, date, line, startTime, endTime, busNumber: '', driverId: '3' }) as Shift;

describe('bouwMijnWeek', () => {
  it('geeft zeven opeenvolgende dagen vanaf de startdag, ook over een maandgrens', () => {
    const week = bouwMijnWeek({ vanaf: '2026-09-28', shifts: [] });
    expect(week.map((d) => d.datum)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('een gesplitste dienst is één dag: eerste start, laatste einde, aantal delen', () => {
    const [dag] = bouwMijnWeek({
      vanaf: '2026-09-21',
      shifts: [dienst('2026-09-21', '2515', '15:10', '18:40'), dienst('2026-09-21', '2515', '06:05', '09:30')],
    });
    expect(dag).toMatchObject({ soort: 'dienst', dienstnummers: ['2515'], start: '06:05', einde: '18:40', delen: 2 });
  });

  it('binnen de horizon is een dag zonder dienst vrij, erbuiten nog niet gepland', () => {
    const week = bouwMijnWeek({ vanaf: '2026-09-21', shifts: [dienst('2026-09-23', '2101', '05:30', '13:45')] });
    expect(week.map((d) => d.soort)).toEqual(['vrij', 'vrij', 'dienst', 'onbekend', 'onbekend', 'onbekend', 'onbekend']);
  });

  it('planningTot verlengt de horizon voorbij de laatste eigen dienst', () => {
    const week = bouwMijnWeek({ vanaf: '2026-09-21', shifts: [dienst('2026-09-21', '2101', '05:30', '13:45')], planningTot: '2026-09-25' });
    expect(week.map((d) => d.soort)).toEqual(['dienst', 'vrij', 'vrij', 'vrij', 'vrij', 'onbekend', 'onbekend']);
  });

  it('zonder enige planning beweren we niet dat iemand vrij is', () => {
    expect(bouwMijnWeek({ vanaf: '2026-09-21', shifts: [] }).every((d) => d.soort === 'onbekend')).toBe(true);
  });

  it('goedgekeurd verlof en ziekte krijgen hun eigen woord, een aanvraag in behandeling niet', () => {
    const week = bouwMijnWeek({
      vanaf: '2026-09-21',
      shifts: [],
      planningTot: '2026-09-30',
      leaves: [
        { startDate: '2026-09-22', endDate: '2026-09-23', type: 'betaald_verlof', status: 'approved' },
        { startDate: '2026-09-24', endDate: '2026-09-24', type: 'ziekte', status: 'approved' },
        { startDate: '2026-09-25', endDate: '2026-09-25', type: 'betaald_verlof', status: 'pending' },
      ],
    });
    expect(week.map((d) => d.soort)).toEqual(['vrij', 'verlof', 'verlof', 'ziek', 'vrij', 'vrij', 'vrij']);
  });

  it('een dienst wint van verlof op dezelfde dag: wat er gereden wordt telt', () => {
    const [dag] = bouwMijnWeek({
      vanaf: '2026-09-21',
      shifts: [dienst('2026-09-21', '2101', '05:30', '13:45')],
      leaves: [{ startDate: '2026-09-21', endDate: '2026-09-21', type: 'betaald_verlof', status: 'approved' }],
    });
    expect(dag.soort).toBe('dienst');
  });
});

describe('weekDagZin', () => {
  it('leest een dienst voor met uren en delen', () => {
    const [dag] = bouwMijnWeek({ vanaf: '2026-09-21', shifts: [dienst('2026-09-21', '2515', '06:05', '09:30'), dienst('2026-09-21', '2515', '15:10', '18:40')] });
    expect(weekDagZin(dag)).toBe('dienst 2515, 06:05 tot 18:40, 2 delen');
  });
  it('zegt eerlijk dat een dag nog niet gepland is', () => {
    expect(weekDagZin(bouwMijnWeek({ vanaf: '2026-09-21', shifts: [] })[0])).toBe('nog niet gepland');
  });
});
