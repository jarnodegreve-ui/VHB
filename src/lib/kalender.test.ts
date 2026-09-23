import { afterEach, describe, expect, it } from 'vitest';
import {
  bereikFout, isoNaarDmj, leesDmj,
  binnenBereik, dagPlusMaand, dagenInMaand, formatDatumKiezer, isIsoDag, klemOpBereik,
  maandBuitenBereik, maandGrid, maandLabel, vandaagIso, weekdagMa,
} from './kalender';
import { vandaagBrussel } from './brussel';
import { leesMj, maandBereikFout, maandNaarMj } from './maand';

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

describe('typbare datum: leesDmj / isoNaarDmj (datumtranche PR 1)', () => {
  const tz = process.env.TZ;
  afterEach(() => { process.env.TZ = tz; });

  it('de tests draaien in Europe/Brussels', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Brussels');
  });

  it.each([
    ['23/09/2026', '2026-09-23'],
    ['3/9/2026', '2026-09-03'],
    ['23-09-2026', '2026-09-23'],
    ['23.09.2026', '2026-09-23'],
    ['23092026', '2026-09-23'],
    ['  23/09/2026 ', '2026-09-23'],
    ['29/02/2028', '2028-02-29'],
    ['31/12/2026', '2026-12-31'],
    ['01/01/2027', '2027-01-01'],
  ])('%j → %s', (tekst, iso) => {
    expect(leesDmj(tekst)).toEqual({ staat: 'geldig', iso });
  });

  it.each([
    ['30/02/2026', 'Die dag bestaat niet.'],
    ['29/02/2027', 'Die dag bestaat niet.'],
    ['31/04/2026', 'Die dag bestaat niet.'],
    ['00/09/2026', 'Die dag bestaat niet.'],
    ['12/13/2026', 'Die maand bestaat niet.'],
    ['12/00/2026', 'Die maand bestaat niet.'],
    ['23/09/26', 'Gebruik dd/mm/jjjj, bijvoorbeeld 23/09/2026.'],
    ['2026-09-23', 'Gebruik dd/mm/jjjj, bijvoorbeeld 23/09/2026.'],
    ['23/09', 'Gebruik dd/mm/jjjj, bijvoorbeeld 23/09/2026.'],
    ['23 sep 2026', 'Gebruik dd/mm/jjjj, bijvoorbeeld 23/09/2026.'],
    ['230926', 'Gebruik dd/mm/jjjj, bijvoorbeeld 23/09/2026.'],
    ['23/09/0226', 'Controleer het jaar.'],
  ])('%j wordt geweigerd', (tekst, reden) => {
    expect(leesDmj(tekst)).toEqual({ staat: 'fout', reden });
  });

  it('leeg is leeg, geen fout', () => {
    expect(leesDmj('')).toEqual({ staat: 'leeg' });
    expect(leesDmj('   ')).toEqual({ staat: 'leeg' });
  });

  it('heen en terug zonder dagverschuiving, in elke tijdzone', () => {
    for (const zone of ['Europe/Brussels', 'Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = zone;
      for (const iso of ['2026-03-29', '2026-10-25', '2028-02-29', '2026-12-31', '2027-01-01']) {
        const dmj = isoNaarDmj(iso);
        expect(leesDmj(dmj)).toEqual({ staat: 'geldig', iso });
      }
    }
  });

  it('isoNaarDmj en bereikFout', () => {
    expect(isoNaarDmj('2026-09-23')).toBe('23/09/2026');
    expect(isoNaarDmj('')).toBe('');
    expect(isoNaarDmj('2026-02-30')).toBe('');
    expect(bereikFout('2026-09-04', '2026-09-05')).toBe('Vroegst 05/09/2026.');
    expect(bereikFout('2026-09-21', undefined, '2026-09-20')).toBe('Uiterlijk 20/09/2026.');
    expect(bereikFout('2026-09-10', '2026-09-05', '2026-09-20')).toBeNull();
  });

  it('vandaagBrussel volgt de Brusselse kalenderdag, niet UTC en niet het toestel', () => {
    // 23/09 00:30 in Brussel (zomertijd, UTC+2) = 22/09 22:30 UTC.
    const kortNaMiddernacht = new Date('2026-09-22T22:30:00Z');
    expect(vandaagBrussel(kortNaMiddernacht)).toBe('2026-09-23');
    expect(kortNaMiddernacht.toISOString().slice(0, 10)).toBe('2026-09-22');
    process.env.TZ = 'America/Los_Angeles';
    expect(vandaagBrussel(kortNaMiddernacht)).toBe('2026-09-23');
  });
});

describe('typbare maand: leesMj / maandNaarMj (datumtranche PR 4)', () => {
  it.each([
    ['09/2026', '2026-09'],
    ['9/2026', '2026-09'],
    ['9-2026', '2026-09'],
    ['09.2026', '2026-09'],
    ['092026', '2026-09'],
    [' 12/2027 ', '2027-12'],
  ])('%j → %s', (tekst, maand) => {
    expect(leesMj(tekst)).toEqual({ staat: 'geldig', maand });
  });

  it.each([
    ['13/2026', 'Die maand bestaat niet.'],
    ['00/2026', 'Die maand bestaat niet.'],
    ['09/26', 'Gebruik mm/jjjj, bijvoorbeeld 09/2026.'],
    ['2026-09', 'Gebruik mm/jjjj, bijvoorbeeld 09/2026.'],
    ['sep 2026', 'Gebruik mm/jjjj, bijvoorbeeld 09/2026.'],
    ['09/0226', 'Controleer het jaar.'],
  ])('%j wordt geweigerd', (tekst, reden) => {
    expect(leesMj(tekst)).toEqual({ staat: 'fout', reden });
  });

  it('leeg, heen en terug, bereik', () => {
    expect(leesMj('')).toEqual({ staat: 'leeg' });
    expect(maandNaarMj('2026-09')).toBe('09/2026');
    expect(maandNaarMj('2026-13')).toBe('');
    expect(leesMj(maandNaarMj('2027-01'))).toEqual({ staat: 'geldig', maand: '2027-01' });
    expect(maandBereikFout('2026-08', '2026-09')).toBe('Vroegst 09/2026.');
    expect(maandBereikFout('2026-10', undefined, '2026-09')).toBe('Uiterlijk 09/2026.');
    expect(maandBereikFout('2026-09', '2026-01', '2026-12')).toBeNull();
  });
});
