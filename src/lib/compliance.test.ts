import { describe, expect, it } from 'vitest';
import { analyzeCompliance, analyzeDriverCompliance } from './compliance';
import type { Shift } from '../types';

const shift = (date: string, startTime: string, endTime: string, driverId = '1', id?: string): Shift => ({
  id: id ?? `${driverId}-${date}-${startTime}`,
  date,
  startTime,
  endTime,
  line: '10',
  busNumber: '12',
  loopnr: '1',
  driverId,
});

describe('dagelijkse rust', () => {
  it('vindt geen probleem bij 11u+ rust', () => {
    const findings = analyzeDriverCompliance('1', [
      shift('2026-06-15', '06:00', '14:00'),
      shift('2026-06-16', '06:00', '14:00'),
    ]);
    expect(findings.filter((f) => f.rule === 'dagelijkse-rust')).toHaveLength(0);
  });

  it('markeert rust onder 9u als overtreding', () => {
    const findings = analyzeDriverCompliance('1', [
      shift('2026-06-15', '14:00', '23:30'),
      shift('2026-06-16', '06:00', '14:00'), // 6,5u rust
    ]);
    const rust = findings.filter((f) => f.rule === 'dagelijkse-rust');
    expect(rust).toHaveLength(1);
    expect(rust[0].severity).toBe('violation');
  });

  it('telt verkorte rust (9-11u) als waarschuwing, en de 4e in één week als overtreding', () => {
    // Elke dag 13:30 → start 23:30, volgende start 09:00 = 9,5u rust (verkort).
    const findings = analyzeDriverCompliance('1', [
      shift('2026-06-15', '09:00', '23:30'),
      shift('2026-06-16', '09:00', '23:30'),
      shift('2026-06-17', '09:00', '23:30'),
      shift('2026-06-18', '09:00', '23:30'),
      shift('2026-06-19', '09:00', '14:00'),
    ]);
    const rust = findings.filter((f) => f.rule === 'dagelijkse-rust');
    expect(rust.filter((f) => f.severity === 'warning')).toHaveLength(3);
    expect(rust.filter((f) => f.severity === 'violation')).toHaveLength(1);
  });

  it('rekent nachtdiensten (einde ≤ start) door tot de volgende dag', () => {
    const findings = analyzeDriverCompliance('1', [
      shift('2026-06-15', '20:00', '04:00'), // eindigt 16/06 04:00
      shift('2026-06-16', '10:00', '18:00'), // 6u rust
    ]);
    const rust = findings.filter((f) => f.rule === 'dagelijkse-rust');
    expect(rust).toHaveLength(1);
    expect(rust[0].severity).toBe('violation');
  });
});

describe('amplitude en dagelijkse werktijd', () => {
  it('markeert een amplitude boven 14u', () => {
    const findings = analyzeDriverCompliance('1', [
      shift('2026-06-15', '06:00', '09:00', '1', 'ocht'),
      shift('2026-06-15', '16:00', '20:30', '1', 'avond'), // 6:00–20:30 = 14,5u
    ]);
    expect(findings.filter((f) => f.rule === 'amplitude')).toHaveLength(1);
  });

  it('waarschuwt boven 10u werktijd en markeert boven 12u als overtreding', () => {
    const warn = analyzeDriverCompliance('1', [shift('2026-06-15', '06:00', '17:00')]); // 11u
    expect(warn.find((f) => f.rule === 'dagelijkse-werktijd')?.severity).toBe('warning');

    const viol = analyzeDriverCompliance('1', [shift('2026-06-15', '06:00', '18:30')]); // 12,5u
    expect(viol.find((f) => f.rule === 'dagelijkse-werktijd')?.severity).toBe('violation');
  });
});

describe('werkdagen op rij', () => {
  it('markeert de 7e aaneengesloten werkdag', () => {
    const shifts = ['15', '16', '17', '18', '19', '20', '21'].map((d) =>
      shift(`2026-06-${d}`, '08:00', '16:00'),
    );
    const findings = analyzeDriverCompliance('1', shifts);
    expect(findings.filter((f) => f.rule === 'werkdagen-op-rij')).toHaveLength(1);
  });

  it('reset de teller na een vrije dag', () => {
    const dagen = ['15', '16', '17', '19', '20', '21', '22']; // 18/06 vrij
    const shifts = dagen.map((d) => shift(`2026-06-${d}`, '08:00', '16:00'));
    const findings = analyzeDriverCompliance('1', shifts);
    expect(findings.filter((f) => f.rule === 'werkdagen-op-rij')).toHaveLength(0);
  });
});

describe('wekelijkse rust', () => {
  it('ziet een vrij weekend als voldoende wekelijkse rust', () => {
    // ma-vr werken, za+zo vrij → rustblok vr 16:00 → ma 08:00 = 64u
    const shifts = ['15', '16', '17', '18', '19'].map((d) => shift(`2026-06-${d}`, '08:00', '16:00'));
    const findings = analyzeDriverCompliance('1', shifts);
    expect(findings.filter((f) => f.rule === 'wekelijkse-rust')).toHaveLength(0);
  });

  it('markeert een volledig omsloten week zonder rustblok van 24u als overtreding', () => {
    // Drie weken elke dag 06:00–20:00 — de míddenweek (22–28/06) is volledig
    // door data omsloten en heeft nergens 24u rust. De randweken krijgen het
    // voordeel van de twijfel (rust kan buiten het importvenster vallen).
    const dagen: string[] = [];
    for (let d = 15; d <= 30; d++) dagen.push(`2026-06-${String(d).padStart(2, '0')}`);
    for (let d = 1; d <= 5; d++) dagen.push(`2026-07-0${d}`);
    const shifts = dagen.map((iso) => shift(iso, '06:00', '20:00'));
    const findings = analyzeDriverCompliance('1', shifts);
    const midden = findings.filter((f) => f.rule === 'wekelijkse-rust' && f.severity === 'violation' && f.date === '2026-06-22');
    expect(midden).toHaveLength(1);
  });

  it('geeft randweken van het importvenster het voordeel van de twijfel', () => {
    const shifts = ['15', '16', '17', '18', '19', '20', '21'].map((d) =>
      shift(`2026-06-${d}`, '06:00', '20:00'),
    );
    const findings = analyzeDriverCompliance('1', shifts);
    expect(findings.filter((f) => f.rule === 'wekelijkse-rust')).toHaveLength(0);
  });
});

describe('analyzeCompliance (rapport)', () => {
  it('groepeert per chauffeur en telt severities', () => {
    const report = analyzeCompliance([
      shift('2026-06-15', '14:00', '23:30', 'a'),
      shift('2026-06-16', '06:00', '14:00', 'a'), // rust-overtreding
      shift('2026-06-15', '08:00', '16:00', 'b'), // schoon
    ]);
    expect(report.perDriver.has('a')).toBe(true);
    expect(report.perDriver.has('b')).toBe(false);
    expect(report.violations).toBeGreaterThanOrEqual(1);
  });

  it('negeert diensten zonder geldige tijden', () => {
    const report = analyzeCompliance([
      { ...shift('2026-06-15', '', ''), startTime: '', endTime: '' },
    ]);
    expect(report.perDriver.size).toBe(0);
  });
});
