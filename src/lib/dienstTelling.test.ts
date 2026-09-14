import { describe, expect, it } from 'vitest';
import { telDienstdagen } from './dienstTelling';

describe('telDienstdagen', () => {
  it('telt dagen met dienst: gesplitste diensten en twee diensten op één dag tellen één keer', () => {
    const rijen = [
      { driverId: '1', date: '2026-09-15', line: '2109', startTime: '06:53' },
      { driverId: '1', date: '2026-09-15', line: '2109', startTime: '13:10' },
      { driverId: '1', date: '2026-09-16', line: '2110' },
      { driverId: '1', date: '2026-09-17', line: '2111' },
      { driverId: '1', date: '2026-09-17', line: '2112' },
    ];
    expect(telDienstdagen(rijen)).toBe(3);
    expect(telDienstdagen([])).toBe(0);
  });
});
