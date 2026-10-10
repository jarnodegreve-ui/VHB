import { describe, expect, it } from 'vitest';
import { dienstoverzichtCsv } from './dienstoverzichtExport';

describe('dienstoverzichtCsv', () => {
  it('zet de afwijkingen per dagtype leesbaar in de laatste kolom, leeg zonder afwijkingen', () => {
    const csv = dienstoverzichtCsv([
      { id: 'a', serviceNumber: 'EEK6', startTime: '06:30', endTime: '08:30', startTime2: '15:00', endTime2: '17:00', varianten: [{ dagtypes: ['23'], startTime: '06:30', endTime: '08:30', startTime2: '12:00', endTime2: '14:00' }] },
      { id: 'b', serviceNumber: '2101', startTime: '04:36', endTime: '07:52', loopnr: '4500' },
    ]);
    const regels = csv.split(/\r?\n/).filter(Boolean);
    expect(regels[0]).toContain('Afwijkingen per dagtype');
    expect(regels[1]).toContain('Woensdag schooldag: 06:30–08:30, 12:00–14:00');
    expect(regels[2]).toMatch(/2101.*4500/);
    expect(regels[2].endsWith(';') || regels[2].endsWith(',') || regels[2].endsWith('""')).toBe(true);
  });
});
