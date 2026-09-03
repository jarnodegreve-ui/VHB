import { describe, expect, it } from 'vitest';
import {
  binnenBereik, dagPlusMaand, dagenInMaand, formatDatumKiezer, isIsoDag, klemOpBereik,
  maandBuitenBereik, maandGrid, maandLabel, vandaagIso, weekdagMa,
} from './kalender';

describe('kalender-helpers (datumkiezer)', () => {
  it('maandGrid begint op maandag en telt 42 dagen', () => {
    // 1 september 2026 is een dinsdag → het raster begint op ma 31 augustus.
    const grid = maandGrid('2026-09');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-08-31');
    expect(grid[1]).toBe('2026-09-01');
    expect(grid[41]).toBe('2026-10-11');
    expect(weekdagMa(grid[0])).toBe(0);
  });

  it('maandGrid zonder staart als de 1e op maandag valt', () => {
    // 1 juni 2026 = maandag.
    expect(maandGrid('2026-06')[0]).toBe('2026-06-01');
  });

  it('maandGrid loopt over de jaargrens heen', () => {
    // 1 januari 2026 = donderdag → begint op ma 29 december 2025.
    const jan = maandGrid('2026-01');
    expect(jan[0]).toBe('2025-12-29');
    const dec = maandGrid('2026-12');
    expect(dec[0]).toBe('2026-11-30');
    expect(dec[41]).toBe('2027-01-10');
  });

  it('dagPlusMaand klemt op de maandlengte en springt over jaargrenzen', () => {
    expect(dagPlusMaand('2026-01-31', 1)).toBe('2026-02-28');
    expect(dagPlusMaand('2024-01-31', 1)).toBe('2024-02-29');
    expect(dagPlusMaand('2026-12-15', 1)).toBe('2027-01-15');
    expect(dagPlusMaand('2026-01-15', -1)).toBe('2025-12-15');
    expect(dagenInMaand('2026-02')).toBe(28);
  });

  it('min/max: binnenBereik, klemOpBereik en maandBuitenBereik', () => {
    expect(binnenBereik('2026-09-08')).toBe(true);
    expect(binnenBereik('2026-09-08', '2026-09-01', '2026-09-30')).toBe(true);
    expect(binnenBereik('2026-08-31', '2026-09-01')).toBe(false);
    expect(binnenBereik('2026-10-01', undefined, '2026-09-30')).toBe(false);
    expect(klemOpBereik('2026-08-31', '2026-09-01', '2026-09-30')).toBe('2026-09-01');
    expect(klemOpBereik('2026-10-05', '2026-09-01', '2026-09-30')).toBe('2026-09-30');
    expect(klemOpBereik('2026-09-08', '2026-09-01', '2026-09-30')).toBe('2026-09-08');
    expect(maandBuitenBereik('2026-08', '2026-09-01')).toBe(true);
    expect(maandBuitenBereik('2026-09', '2026-09-30')).toBe(false);
    expect(maandBuitenBereik('2026-10', undefined, '2026-09-30')).toBe(true);
  });

  it('vandaagIso volgt de lokale kalender, niet UTC', () => {
    expect(vandaagIso(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(vandaagIso(new Date(2026, 11, 31, 23, 45))).toBe('2026-12-31');
  });

  it('formatDatumKiezer en maandLabel', () => {
    expect(formatDatumKiezer('2026-09-08')).toBe('di 8 sep 2026');
    expect(formatDatumKiezer('2026-03-01')).toBe('zo 1 mrt 2026');
    expect(formatDatumKiezer('kapot')).toBe('kapot');
    expect(maandLabel('2026-09')).toBe('September 2026');
  });

  it('isIsoDag weigert onbestaande dagen', () => {
    expect(isIsoDag('2026-02-28')).toBe(true);
    expect(isIsoDag('2026-02-30')).toBe(false);
    expect(isIsoDag('2026-9-8')).toBe(false);
    expect(isIsoDag('')).toBe(false);
  });
});
