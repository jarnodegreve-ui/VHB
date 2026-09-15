import { describe, expect, it } from 'vitest';
import { berekenRoosterUren, formatUren, maandagVan, minutenPerDag } from './roosterUren';

// Peildag woensdag 16 september 2026 (ISO-week 38: ma 14 t/m zo 20).
const PEILDAG = '2026-09-16';

const rij = (date: string, startTime: string, endTime: string, driverId = '42') => ({ date, startTime, endTime, driverId });

describe('berekenRoosterUren', () => {
  it('telt week (ma t/m zo) en maand apart, gesplitste dienst = één dag', () => {
    const shifts = [
      rij('2026-09-14', '04:36', '07:52'), // ma, 196 min
      rij('2026-09-14', '13:39', '17:29'), // ma, deel 2, 230 min
      rij('2026-09-20', '06:00', '14:00'), // zo, 480 min (nog in de week)
      rij('2026-09-21', '06:00', '14:00'), // ma volgende week, alleen maand
      rij('2026-08-31', '06:00', '14:00'), // vorige maand, telt nergens
      rij('2026-10-01', '06:00', '14:00'), // volgende maand, telt nergens
    ];
    const u = berekenRoosterUren(shifts, PEILDAG);
    expect(u.weekMinuten).toBe(196 + 230 + 480);
    expect(u.maandMinuten).toBe(196 + 230 + 480 + 480);
    expect(u.maandDienstdagen).toBe(3);
  });

  it('nachtdienst in busvak-notatie en impliciet over middernacht telt volledig bij de startdag', () => {
    const u = berekenRoosterUren([rij('2026-09-16', '15:41', '26:16'), rij('2026-09-17', '22:00', '06:00')], PEILDAG);
    expect(u.weekMinuten).toBe((26 * 60 + 16 - (15 * 60 + 41)) + 8 * 60);
    expect(u.maandDienstdagen).toBe(2);
  });

  it('ongeldige tijden tellen nul, lege lijst geeft nullen', () => {
    expect(berekenRoosterUren([rij('2026-09-16', 'x', '08:00')], PEILDAG)).toEqual({ weekMinuten: 0, maandMinuten: 0, maandDienstdagen: 1 });
    expect(berekenRoosterUren([], PEILDAG)).toEqual({ weekMinuten: 0, maandMinuten: 0, maandDienstdagen: 0 });
  });

  it('week rond de maand- en jaargrens', () => {
    // Peildag do 1 januari 2027: week loopt ma 28-12-2026 t/m zo 03-01-2027.
    const u = berekenRoosterUren([rij('2026-12-28', '06:00', '14:00'), rij('2027-01-03', '06:00', '14:00')], '2027-01-01');
    expect(u.weekMinuten).toBe(960);
    expect(u.maandMinuten).toBe(480);
  });

  it('maandagVan, minutenPerDag en formatUren', () => {
    expect(maandagVan('2026-09-20')).toBe('2026-09-14');
    expect(maandagVan('2026-09-14')).toBe('2026-09-14');
    const per = minutenPerDag([rij('2026-09-14', '04:36', '07:52'), rij('2026-09-14', '13:39', '17:29')]);
    expect(per.get('2026-09-14')).toBe(426);
    expect(formatUren(2310)).toBe('38,5 u');
    expect(formatUren(480)).toBe('8 u');
  });
});
