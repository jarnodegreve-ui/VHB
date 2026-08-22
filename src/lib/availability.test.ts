import { describe, it, expect } from 'vitest';
import { conflictIds, isoDate, addDays, openstaandeDienstenVanAfwezigen, type AvailabilityDay } from './availability';

describe('availability — helpers', () => {
  it('conflictIds: drivers die rijden én verlof hebben', () => {
    const day: AvailabilityDay = {
      date: '2026-07-06',
      working: ['a', 'b', 'c'],
      leave: ['b', 'd'],
      free: ['e'],
      lines: {},
    };
    expect(conflictIds(day)).toEqual(['b']);
  });

  it('conflictIds: geen overlap → leeg', () => {
    const day: AvailabilityDay = { date: '2026-07-06', working: ['a'], leave: ['b'], free: [], lines: {} };
    expect(conflictIds(day)).toEqual([]);
  });

  it('openstaandeDienstenVanAfwezigen: gesplitste dienst (meerdere rijen, zelfde dag+code) telt één keer', () => {
    // Melding Jarno 22-08: het dashboard zei "31 diensten nog niet
    // herverdeeld" waar er 17 openstonden — elk segment van een gesplitste
    // dienst werd apart geteld.
    const shifts = [
      { id: 's1', driverId: '9', date: '2026-09-01', line: '2112', startTime: '12:30', endTime: '18:40' },
      { id: 's2', driverId: '9', date: '2026-09-01', line: '2112', startTime: '06:45', endTime: '09:20' },
      { id: 's3', driverId: '9', date: '2026-09-02', line: '2311', startTime: '07:00', endTime: '17:00' },
    ] as any[];
    const leave = [
      { id: 'l1', userId: '9', startDate: '2026-08-17', endDate: '2026-09-25', type: 'ziekte', status: 'approved', createdAt: '' },
    ] as any[];
    const uit = openstaandeDienstenVanAfwezigen(shifts, leave, '2026-08-22');
    expect(uit).toHaveLength(2);
    // Het vroegste segment blijft, zodat de getoonde tijd de dienststart is.
    expect(uit[0]).toMatchObject({ date: '2026-09-01', line: '2112', startTime: '06:45' });
    expect(uit[1]).toMatchObject({ date: '2026-09-02', line: '2311' });
  });

  it('isoDate formatteert lokaal yyyy-mm-dd', () => {
    expect(isoDate(new Date(2026, 6, 6))).toBe('2026-07-06'); // maand is 0-indexed → juli
    expect(isoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('addDays telt dagen op (incl. maandgrens)', () => {
    expect(isoDate(addDays(new Date(2026, 6, 6), 6))).toBe('2026-07-12');
    expect(isoDate(addDays(new Date(2026, 6, 30), 3))).toBe('2026-08-02');
  });
});
