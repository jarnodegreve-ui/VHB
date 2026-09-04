import { describe, expect, it } from 'vitest';
import { dienstMinuten, dienstStatistiek, formatDienstDuur } from './dienstStatistiek';

const d = (o: Partial<Parameters<typeof dienstMinuten>[0]> & { serviceNumber: string }) => ({ id: o.serviceNumber, startTime: '', endTime: '', ...o });

describe('dienstStatistiek', () => {
  it('telt de delen op, ook in busvak-notatie na middernacht', () => {
    expect(dienstMinuten(d({ serviceNumber: '2607', startTime: '15:41', endTime: '26:16' }))).toBe(10 * 60 + 35);
    expect(dienstMinuten(d({ serviceNumber: '2101', startTime: '04:36', endTime: '07:52', startTime2: '13:39', endTime2: '17:29' }))).toBe(196 + 230);
  });

  it('negeert onleesbare delen en geeft null zonder enig geldig deel', () => {
    expect(dienstMinuten(d({ serviceNumber: 'x', startTime: '', endTime: '' }))).toBeNull();
    expect(dienstMinuten(d({ serviceNumber: 'x', startTime: '08:00', endTime: '09:00', startTime2: '9:99', endTime2: '10:00' }))).toBe(60);
  });

  it('geeft diensten, unieke loops en langste/kortste', () => {
    const s = dienstStatistiek([
      d({ serviceNumber: '2101', startTime: '04:36', endTime: '07:52', loopnr: '4500', startTime2: '13:39', endTime2: '17:29', loopnr2: '4611' }),
      d({ serviceNumber: '2607', startTime: '15:41', endTime: '26:16', loopnr: '4500' }),
      d({ serviceNumber: 'leeg' }),
    ]);
    expect(s.diensten).toBe(3);
    expect(s.loops).toBe(2);
    expect(s.langste).toEqual({ serviceNumber: '2607', minuten: 635 });
    expect(s.kortste).toEqual({ serviceNumber: '2101', minuten: 426 });
  });

  it('geeft null-uitersten bij een lege lijst', () => {
    expect(dienstStatistiek([])).toEqual({ diensten: 0, loops: 0, langste: null, kortste: null });
  });

  it('formatteert de duur compact', () => {
    expect(formatDienstDuur(45)).toBe('45min');
    expect(formatDienstDuur(120)).toBe('2u');
    expect(formatDienstDuur(635)).toBe('10u 35min');
  });
});
