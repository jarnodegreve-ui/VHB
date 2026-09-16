import { describe, expect, it } from 'vitest';
import { eigenDienstOp, groepeerPerDienst } from './ruilWizard';
import type { Shift } from '../types';

const rij = (id: string, date: string, line: string, startTime: string, endTime: string, driverId = 'A'): Shift =>
  ({ id, date, line, startTime, endTime, driverId, busNumber: '', loopnr: '' });

describe('groepeerPerDienst', () => {
  it('voegt de delen van een gesplitste dienst samen tot één kaart', () => {
    const uit = groepeerPerDienst([
      rij('2026-09-18-A-2104-2', '2026-09-18', '2104', '14:50', '19:45'),
      rij('2026-09-18-A-2104-1', '2026-09-18', '2104', '05:54', '08:42'),
      rij('2026-09-19-A-2601-1', '2026-09-19', '2601', '06:00', '14:00'),
    ]);
    expect(uit).toHaveLength(2);
    expect(uit[0]).toMatchObject({ id: '2026-09-18-A-2104-1', startTime: '05:54', endTime: '19:45', delen: 2 });
    expect(uit[1]).toMatchObject({ id: '2026-09-19-A-2601-1', delen: 1 });
  });

  it('houdt twee verschillende diensten op dezelfde dag apart', () => {
    const uit = groepeerPerDienst([
      rij('a', '2026-09-18', '2104', '05:54', '08:42'),
      rij('b', '2026-09-18', '2205', '14:50', '19:45'),
    ]);
    expect(uit.map((d) => d.line)).toEqual(['2104', '2205']);
  });
});

describe('eigenDienstOp', () => {
  const eigen = [
    rij('a1', '2026-09-18', '2104', '05:54', '08:42'),
    rij('a2', '2026-09-18', '2104', '14:50', '19:45'),
    rij('b', '2026-09-19', '2601', '06:00', '14:00'),
    rij('x', '2026-09-18', '9999', '06:00', '14:00', 'ANDER'),
  ];
  it('telt het tweede deel van de aangeboden dienst niet als conflict', () => {
    expect(eigenDienstOp(eigen, 'A', '2026-09-18', eigen[0])).toBeUndefined();
  });
  it('meldt wel een andere eigen dienst op die dag', () => {
    expect(eigenDienstOp(eigen, 'A', '2026-09-19', eigen[0])).toBe('2601');
  });
  it('is vrij zonder eigen dienst', () => {
    expect(eigenDienstOp(eigen, 'A', '2026-09-20', eigen[0])).toBeUndefined();
  });
});
