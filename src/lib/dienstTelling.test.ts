import { describe, expect, it } from 'vitest';
import { telDiensten } from './dienstTelling';

describe('telDiensten', () => {
  it('telt een gesplitste dienst (meerdere rijen op dezelfde dag) één keer', () => {
    const rijen = [
      { driverId: '1', date: '2026-09-15', line: '2109', startTime: '06:53' },
      { driverId: '1', date: '2026-09-15', line: '2109', startTime: '13:10' },
      { driverId: '1', date: '2026-09-16', line: '2110' },
      { driverId: '1', date: '2026-09-17', line: 'R12' },
      { driverId: '1', date: '2026-09-17', line: 'r12' },
    ];
    expect(telDiensten(rijen)).toBe(3);
    expect(telDiensten([])).toBe(0);
  });

  it('twee diensten op één dag tellen wél apart', () => {
    expect(telDiensten([
      { driverId: '1', date: '2026-09-15', line: '2109' },
      { driverId: '1', date: '2026-09-15', line: '2111' },
    ])).toBe(2);
  });
});
