import { describe, it, expect } from 'vitest';
import { hasShiftEnded, isShiftActiveAt, isValidBusvakTime, normalizeTimeString } from './shiftTime';

// Lokale datum-helper: 2026-07-22 om HH:MM (woensdag).
const at = (h: number, m = 0) => new Date(2026, 6, 22, h, m);

describe('isShiftActiveAt: rijdt deze chauffeur nú, op basis van de segmenttijden', () => {
  const dag = { date: '2026-07-22', startTime: '08:00', endTime: '16:30' };

  it('dagdienst: actief binnen de tijden, niet ervoor of erna', () => {
    expect(isShiftActiveAt(dag, at(7, 59))).toBe(false);
    expect(isShiftActiveAt(dag, at(8, 0))).toBe(true); // start inclusief
    expect(isShiftActiveAt(dag, at(12, 0))).toBe(true);
    expect(isShiftActiveAt(dag, at(16, 30))).toBe(false); // einde exclusief
  });

  it('telt alleen segmenten van de juiste datum mee', () => {
    expect(isShiftActiveAt({ ...dag, date: '2026-07-21' }, at(12, 0))).toBe(false);
  });

  it('gesplitste dienst: tussen twee segmenten (pauze) niet actief', () => {
    const deel1 = { date: '2026-07-22', startTime: '06:30', endTime: '09:30' };
    const deel2 = { date: '2026-07-22', startTime: '15:30', endTime: '18:30' };
    expect(isShiftActiveAt(deel1, at(12, 0))).toBe(false);
    expect(isShiftActiveAt(deel2, at(12, 0))).toBe(false);
    expect(isShiftActiveAt(deel2, at(16, 0))).toBe(true);
  });

  it('nachtdienst over middernacht: vanavond ná start én morgenvroeg vóór einde', () => {
    const nacht = { date: '2026-07-21', startTime: '22:00', endTime: '06:00' };
    // Gisteren gestart, nu (vroege ochtend 22/07) nog bezig:
    expect(isShiftActiveAt(nacht, at(3, 0))).toBe(true);
    expect(isShiftActiveAt(nacht, at(6, 0))).toBe(false); // einde exclusief
    // Vanavond gestart op eigen datum:
    const vanavond = { date: '2026-07-22', startTime: '22:00', endTime: '06:00' };
    expect(isShiftActiveAt(vanavond, at(23, 0))).toBe(true);
    expect(isShiftActiveAt(vanavond, at(21, 0))).toBe(false);
  });

  it('ongeldige of lege tijden tellen nooit mee', () => {
    expect(isShiftActiveAt({ date: '2026-07-22', startTime: '--', endTime: '16:00' }, at(12))).toBe(false);
    expect(isShiftActiveAt({ date: '2026-07-22', startTime: '', endTime: '' }, at(12))).toBe(false);
    expect(isShiftActiveAt({ date: '2026-07-22', startTime: '08:00', endTime: '08:00' }, at(12))).toBe(false);
    expect(isShiftActiveAt({ date: '2026-07-22', startTime: '48:00', endTime: '50:00' }, at(12))).toBe(false);
  });

  it("busvak-notatie (eindtijd ≥ 24:00, bv. '26:16' = 02:16): actief 's avonds én na middernacht", () => {
    // Regressie: dienst 2607 (15:41–26:16) was om 21:53 onzichtbaar op de
    // "Chauffeurs actief"-tegel — uren > 23 werden als ongeldig afgekeurd.
    const laat = { date: '2026-07-22', startTime: '15:41', endTime: '26:16' };
    expect(isShiftActiveAt(laat, at(15, 40))).toBe(false);
    expect(isShiftActiveAt(laat, at(21, 53))).toBe(true);
    expect(isShiftActiveAt(laat, at(23, 59))).toBe(true);
    // Na middernacht (23/07) loopt de dienst van gisteren nog tot 02:16:
    const morgen = (h: number, m = 0) => new Date(2026, 6, 23, h, m);
    expect(isShiftActiveAt(laat, morgen(1, 30))).toBe(true);
    expect(isShiftActiveAt(laat, morgen(2, 16))).toBe(false); // einde exclusief
    // Maar op de eigen ochtend (vóór de start) niet:
    expect(isShiftActiveAt(laat, at(9, 0))).toBe(false);
  });

  it('busvak-notatie: dienst die volledig ná middernacht valt (start ≥ 24:00)', () => {
    const nanacht = { date: '2026-07-22', startTime: '24:30', endTime: '27:00' };
    expect(isShiftActiveAt(nanacht, at(23, 0))).toBe(false); // eigen avond: nog niet begonnen
    const morgen = (h: number, m = 0) => new Date(2026, 6, 23, h, m);
    expect(isShiftActiveAt(nanacht, morgen(0, 29))).toBe(false);
    expect(isShiftActiveAt(nanacht, morgen(0, 30))).toBe(true);
    expect(isShiftActiveAt(nanacht, morgen(2, 59))).toBe(true);
    expect(isShiftActiveAt(nanacht, morgen(3, 0))).toBe(false);
  });
});

describe('hasShiftEnded, randgevallen uit de controleronde 30/07', () => {
  it('nachtdienst pas voorbij ná de eindtijd de volgende dag', () => {
    const shift = { date: '2026-07-29', startTime: '22:00', endTime: '06:00' };
    expect(hasShiftEnded(shift, new Date('2026-07-30T05:00:00'))).toBe(false);
    expect(hasShiftEnded(shift, new Date('2026-07-30T06:01:00'))).toBe(true);
  });

  it('start === eind: meteen voorbij op de dienstdag zelf (consistent met isShiftActiveAt)', () => {
    const shift = { date: '2026-07-29', startTime: '08:00', endTime: '08:00' };
    expect(hasShiftEnded(shift, new Date('2026-07-29T08:01:00'))).toBe(true);
    expect(hasShiftEnded(shift, new Date('2026-07-29T07:59:00'))).toBe(false);
  });

  it('busvak-eindtijd (26:16) telt als volgende dag 02:16', () => {
    const shift = { date: '2026-07-29', startTime: '15:41', endTime: '26:16' };
    expect(hasShiftEnded(shift, new Date('2026-07-30T02:00:00'))).toBe(false);
    expect(hasShiftEnded(shift, new Date('2026-07-30T02:17:00'))).toBe(true);
  });
});

describe('isValidBusvakTime / normalizeTimeString', () => {
  it('valideert busvak-grenzen', () => {
    expect(isValidBusvakTime('26:16')).toBe(true);
    expect(isValidBusvakTime('47:59')).toBe(true);
    expect(isValidBusvakTime('48:00')).toBe(false);
    expect(isValidBusvakTime('08:75')).toBe(false);
    expect(isValidBusvakTime('6:00')).toBe(true);
  });
  it('normaliseert niet-gepadde uren', () => {
    expect(normalizeTimeString('6:00')).toBe('06:00');
    expect(normalizeTimeString('14:00')).toBe('14:00');
    expect(normalizeTimeString('26:16')).toBe('26:16');
  });
});
