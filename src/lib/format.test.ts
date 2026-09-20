import { describe, it, expect } from 'vitest';
import { formatDatumDMJ, formatGetal, formatMomentKort, formatPeriodeDMJ, formatRelatief, metEenheid } from './format';

describe('formatGetal (komma als decimaalteken, smalle spatie als duizendtal, max. 2 decimalen)', () => {
  it('kapt ChargEye-decimalen af op twee cijfers na de komma', () => {
    expect(formatGetal(123.45678)).toBe('123,46');
    expect(formatGetal(47.6)).toBe('47,6');
    expect(formatGetal(0.5)).toBe('0,5');
  });
  it('laat hele getallen heel en zet een smalle vaste spatie als duizendtal (geen punt: die leest als decimaal)', () => {
    expect(formatGetal(48)).toBe('48');
    expect(formatGetal(6559)).toBe('6\u202F559');
    expect(formatGetal(57529.6)).toBe('57\u202F529,6');
    expect(formatGetal(1234567)).toBe('1\u202F234\u202F567');
    expect(formatGetal(6559)).not.toContain('.');
  });
  it('respecteert een ander maximum en vangt onbruikbare waarden', () => {
    expect(formatGetal(1234.5, 0)).toBe('1\u202F235');
    expect(formatGetal(Number.NaN)).toBe('—');
    expect(formatGetal(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatRelatief', () => {
  const nu = Date.parse('2026-09-06T12:00:00Z');
  it('kiest de leesbare eenheid', () => {
    expect(formatRelatief('2026-09-06T11:59:40Z', nu)).toBe('zojuist');
    expect(formatRelatief('2026-09-06T11:55:00Z', nu)).toBe('5 min geleden');
    expect(formatRelatief('2026-09-06T09:00:00Z', nu)).toBe('3 u geleden');
    expect(formatRelatief('2026-09-05T11:00:00Z', nu)).toBe('gisteren');
    expect(formatRelatief('2026-09-02T12:00:00Z', nu)).toBe('4 d geleden');
    expect(formatRelatief('2026-08-01T12:00:00Z', nu)).toMatch(/augustus/);
    expect(formatRelatief(null, nu)).toBe('');
  });
});

describe('metEenheid (smalle vaste spatie tussen getal en eenheid)', () => {
  it('zet U+202F tussen getal en eenheid, voor ruwe én geformatteerde waarden', () => {
    expect(metEenheid(12, 'kW')).toBe('12\u202FkW');
    expect(metEenheid('6\u202F559', 'kWh')).toBe('6\u202F559\u202FkWh');
    expect(metEenheid(3, 'u')).toBe('3\u202Fu');
    expect(metEenheid(12, 'kW')).not.toContain(' ');
  });
  it('laat een streepje (onbekend) zonder eenheid', () => {
    expect(metEenheid(Number.NaN, 'kW')).toBe('—');
    expect(metEenheid('—', 'kWh')).toBe('—');
  });
});


describe('formatDatumDMJ / formatPeriodeDMJ (dag/maand/jaar, Jarno 17-09)', () => {
  it('draait een ISO-dag om naar 17/09/2026', () => {
    expect(formatDatumDMJ('2026-09-17')).toBe('17/09/2026');
    // Een timestamp mag ook: alleen de dag telt.
    expect(formatDatumDMJ('2026-01-02T08:30:00Z')).toBe('02/01/2026');
  });
  it('laat leegte leeg en een onherkenbare waarde ongemoeid', () => {
    expect(formatDatumDMJ('')).toBe('');
    expect(formatDatumDMJ(null)).toBe('');
    expect(formatDatumDMJ('geen datum')).toBe('geen datum');
  });
  it('schrijft een periode van één dag als één datum', () => {
    expect(formatPeriodeDMJ('2026-09-17', '2026-09-17')).toBe('17/09/2026');
    expect(formatPeriodeDMJ('2026-09-17', '2026-09-20')).toBe('17/09/2026 t/m 20/09/2026');
    expect(formatPeriodeDMJ('2026-09-17')).toBe('17/09/2026');
  });
});

describe('formatMomentKort (dd/mm uu:mm, 24-uurs, nooit een rauwe ISO)', () => {
  // Zone-loos "nu", zodat het jaartal niet van de tijdzone van de runner afhangt.
  const nu = new Date('2026-09-20T12:00:00');
  it('laat een zone-loos moment staan zoals het is (wandkloktijd), onder elke TZ', () => {
    expect(formatMomentKort('2026-09-19T14:02:00', nu)).toBe('19/09 14:02');
    expect(formatMomentKort('2026-01-05T00:07:30.123', nu)).toBe('05/01 00:07');
  });
  it('rekent een moment met zone om naar Belgische tijd, zomer en winter', () => {
    expect(formatMomentKort('2026-09-19T12:02:06.771Z', nu)).toBe('19/09 14:02');
    expect(formatMomentKort('2026-01-05T23:30:00Z', nu)).toBe('06/01 00:30');
    expect(formatMomentKort('2026-09-19T12:02:06.771+00:00', nu)).toBe('19/09 14:02');
  });
  it('zet het jaartal erbij zodra het niet dit jaar is', () => {
    expect(formatMomentKort('2025-12-31T09:15:00', nu)).toBe('31/12/2025 09:15');
  });
  it('alleen een datum geeft dd/mm; leeg of onleesbaar geeft niets, nooit de rauwe waarde', () => {
    expect(formatMomentKort('2026-09-19', nu)).toBe('19/09');
    expect(formatMomentKort(null, nu)).toBe('');
    expect(formatMomentKort('gisteren', nu)).toBe('');
  });
});
