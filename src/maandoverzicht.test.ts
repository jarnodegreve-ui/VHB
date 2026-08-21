import { describe, expect, it } from 'vitest';
import { bouwMaandoverzichtAoa, dienstMinuten, formatMinutenAlsUren } from '../api/helpers';

/** Maandoverzicht-tabblad in de xlsx-export: per-chauffeur maandtelling. */
describe('dienstMinuten', () => {
  it('somt segmentduren, met nacht- en busvak-notatie', () => {
    expect(dienstMinuten({ startTime: '06:00', endTime: '14:00' })).toBe(480);
    // Gesplitste dienst: beide segmenten tellen.
    expect(dienstMinuten({ startTime: '06:00', endTime: '09:00', startTime2: '15:00', endTime2: '18:30' })).toBe(390);
    // Busvak-uren ≥ 24: 22:00–26:16 = 4u16.
    expect(dienstMinuten({ startTime: '22:00', endTime: '26:16' })).toBe(256);
    // Impliciete nachtdienst (einde ≤ start): 22:00–06:00 = 8u.
    expect(dienstMinuten({ startTime: '22:00', endTime: '06:00' })).toBe(480);
    // Zonder bruikbare tijden: null.
    expect(dienstMinuten({ startTime: '', endTime: '' })).toBeNull();
  });

  it('formatMinutenAlsUren schrijft uu:mm', () => {
    expect(formatMinutenAlsUren(0)).toBe('0:00');
    expect(formatMinutenAlsUren(485)).toBe('8:05');
  });
});

describe('bouwMaandoverzichtAoa', () => {
  const services = [{ serviceNumber: '2101', startTime: '06:00', endTime: '14:00' }];
  const planningCodes = [
    { code: 'eek5', countsAsShift: true, isPaidAbsence: false, isDayOff: false },
    { code: 'bv', countsAsShift: false, isPaidAbsence: true, isDayOff: false },
    { code: 'vrij', countsAsShift: false, isPaidAbsence: false, isDayOff: true },
    { code: 'ta', countsAsShift: false, isPaidAbsence: false, isDayOff: false },
  ];

  it('telt per chauffeur diensten, uren en afwezigheden op de actuele cel-waarheid', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
    const cells = {
      c1: {
        '2026-09-01': { code: '2101', kind: 'service' },
        '2026-09-02': { code: 'EEK5', kind: 'service' },
        '2026-09-03': { code: 'ziek', kind: 'absence' },
        '2026-09-04': { code: 'bv', kind: 'leave' },
        '2026-09-05': { code: 'ta', kind: 'absence' },
      },
    } as Record<string, Record<string, { code: string; kind: string }>>;
    const aoa = bouwMaandoverzichtAoa('2026-09', dates, [{ id: 'c1', name: 'Jan Peeters' }], cells, services, planningCodes);
    // Rij 0-2: titel/uitleg/leeg; rij 3: koppen; rij 4: Jan.
    expect(aoa[3][0]).toBe('chauffeur');
    expect(aoa[4]).toEqual(['Jan Peeters', 1, '8:00', 1, 1, 1, 0, 'ta×1', 5]);
    // Laatste rij: totalen.
    expect(aoa[aoa.length - 1][0]).toBe('totaal');
    expect(aoa[aoa.length - 1][8]).toBe(5);
  });

  it('laat een chauffeur zonder cellen gewoon op nul staan', () => {
    const aoa = bouwMaandoverzichtAoa('2026-09', ['2026-09-01'], [{ id: 'cx', name: 'Leeg' }], {}, services, planningCodes);
    expect(aoa[4]).toEqual(['Leeg', 0, '0:00', 0, 0, 0, 0, '', 0]);
  });
});
