import { describe, it, expect } from 'vitest';
import { formatRemaining, minutesUntilShiftEnd } from './lib/shiftTime';

/** Lokale tijd (geen UTC) — de helpers rekenen met getHours(). */
const om = (iso: string, uur: number, minuut: number) =>
  new Date(`${iso}T${String(uur).padStart(2, '0')}:${String(minuut).padStart(2, '0')}:00`);

describe('minutesUntilShiftEnd', () => {
  it('telt af binnen een gewone dienst', () => {
    const dienst = { date: '2026-08-02', startTime: '12:08', endTime: '18:54' };
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 17, 22))).toBe(92);
  });

  it('geeft null als de dienst nog niet begonnen is', () => {
    const dienst = { date: '2026-08-02', startTime: '12:08', endTime: '18:54' };
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 9, 0))).toBeNull();
  });

  it('geeft null zodra de dienst voorbij is', () => {
    const dienst = { date: '2026-08-02', startTime: '12:08', endTime: '18:54' };
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 18, 54))).toBeNull();
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 20, 0))).toBeNull();
  });

  it('rekent met de busvak-notatie voorbij middernacht', () => {
    // 24:20 = 00:20 de nacht erna.
    const nacht = { date: '2026-08-02', startTime: '14:41', endTime: '24:20' };
    expect(minutesUntilShiftEnd(nacht, om('2026-08-02', 23, 50))).toBe(30);
    // Ná middernacht loopt hij nog: 'nu' valt dan op de dag ná de dienstdag.
    expect(minutesUntilShiftEnd(nacht, om('2026-08-03', 0, 5))).toBe(15);
    expect(minutesUntilShiftEnd(nacht, om('2026-08-03', 0, 20))).toBeNull();
  });

  it('rekent met een impliciete nachtdienst (eind ≤ start)', () => {
    const nacht = { date: '2026-08-02', startTime: '22:00', endTime: '06:00' };
    expect(minutesUntilShiftEnd(nacht, om('2026-08-03', 5, 30))).toBe(30);
  });

  it('geeft null bij onzin-tijden', () => {
    expect(minutesUntilShiftEnd({ date: '2026-08-02', startTime: 'x', endTime: '18:54' }, om('2026-08-02', 13, 0))).toBeNull();
    expect(minutesUntilShiftEnd({ date: '2026-08-02', startTime: '08:75', endTime: '18:54' }, om('2026-08-02', 13, 0))).toBeNull();
  });
});

describe('formatRemaining', () => {
  it('schrijft uren en minuten compact', () => {
    expect(formatRemaining(92)).toBe('nog 1u 32min');
    // Nul-geprefixt zodra er uren zijn: anders springt de linkerrand van de
    // aftel-kolom heen en weer tussen "2u 8min" en "2u 42min".
    expect(formatRemaining(128)).toBe('nog 2u 08min');
    expect(formatRemaining(61)).toBe('nog 1u 01min');
    expect(formatRemaining(47)).toBe('nog 47min');
    expect(formatRemaining(120)).toBe('nog 2u');
    expect(formatRemaining(1)).toBe('nog 1min');
  });
});
