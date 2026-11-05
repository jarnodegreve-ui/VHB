import { describe, it, expect } from 'vitest';
import { formatRemaining, formatStartsIn, minutesUntilShiftEnd, minutesUntilShiftStart } from './lib/shiftTime';

/** Lokale tijd (geen UTC) — de helpers rekenen met getHours(). */
const om = (iso: string, uur: number, minuut: number) =>
  new Date(`${iso}T${String(uur).padStart(2, '0')}:${String(minuut).padStart(2, '0')}:00`);

describe('minutesUntilShiftEnd', () => {
  it('telt af binnen een gewone dienst', () => {
    const dienst = { date: '2026-08-02', startTime: '12:08', endTime: '18:54' };
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 17, 22))).toBe(92);
  });

  it('geeft null als de dienst nog niet begonnen is', () => {
    const dienst = { date: '2026-08-02', startTime: '12:08', endTime: '18:54' };
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 9, 0))).toBeNull();
  });

  it('geeft null zodra de dienst voorbij is', () => {
    const dienst = { date: '2026-08-02', startTime: '12:08', endTime: '18:54' };
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 18, 54))).toBeNull();
    expect(minutesUntilShiftEnd(dienst, om('2026-08-02', 20, 0))).toBeNull();
  });

  it('rekent met de busvak-notatie voorbij middernacht', () => {
    // 24:20 = 00:20 de nacht erna.
    const nacht = { date: '2026-08-02', startTime: '14:41', endTime: '24:20' };
    expect(minutesUntilShiftEnd(nacht, om('2026-08-02', 23, 50))).toBe(30);
    // Ná middernacht loopt hij nog: 'nu' valt dan op de dag ná de dienstdag.
    expect(minutesUntilShiftEnd(nacht, om('2026-08-03', 0, 5))).toBe(15);
    expect(minutesUntilShiftEnd(nacht, om('2026-08-03', 0, 20))).toBeNull();
  });

  it('rekent met een impliciete nachtdienst (eind ≤ start)', () => {
    const nacht = { date: '2026-08-02', startTime: '22:00', endTime: '06:00' };
    expect(minutesUntilShiftEnd(nacht, om('2026-08-03', 5, 30))).toBe(30);
  });

  it('geeft null bij onzin-tijden', () => {
    expect(minutesUntilShiftEnd({ date: '2026-08-02', startTime: 'x', endTime: '18:54' }, om('2026-08-02', 13, 0))).toBeNull();
    expect(minutesUntilShiftEnd({ date: '2026-08-02', startTime: '08:75', endTime: '18:54' }, om('2026-08-02', 13, 0))).toBeNull();
  });
});

describe('aftelling over een uurwissel (controle-ronde 04-11, punt 35)', () => {
  // vitest.config.ts pint TZ op Europe/Brussels; de nacht van 27 op 28 maart
  // 2027 duurt 23 uur (02:00 wordt 03:00), die van 30 op 31 oktober 2027 25 uur.
  it('naar de zomertijd: een nachtdienst 22:00-06:00 heeft om 00:30 nog 4u30, geen 5u30', () => {
    const nacht = { date: '2027-03-27', startTime: '22:00', endTime: '06:00' };
    expect(minutesUntilShiftEnd(nacht, om('2027-03-28', 0, 30))).toBe(270);
    // Busvak-notatie: 27:00 = 03:00 de nacht erna, vanaf 23:00 nog 3 uur (de klok slaat 02:00 over).
    expect(minutesUntilShiftEnd({ date: '2027-03-27', startTime: '20:00', endTime: '27:00' }, om('2027-03-27', 23, 0))).toBe(180);
  });

  it('naar de zomertijd: de vroege dienst van zondag is om 23:00 nog 6 uur weg, geen 7', () => {
    expect(minutesUntilShiftStart({ date: '2027-03-28', startTime: '06:00' }, om('2027-03-27', 23, 0))).toBe(360);
  });

  it('in het dubbele uur van de wintertijdwissel telt de echte klok (02:30 CET, de tweede keer)', () => {
    // 2027-10-31T01:30Z = 02:30 wintertijd, de tweede doorgang; tot 06:00 CET (05:00Z) is 3u30.
    const nu = new Date('2027-10-31T01:30:00Z');
    expect(minutesUntilShiftEnd({ date: '2027-10-30', startTime: '22:00', endTime: '06:00' }, nu)).toBe(210);
    expect(minutesUntilShiftStart({ date: '2027-10-31', startTime: '06:00' }, nu)).toBe(210);
  });

  it('naar de wintertijd: dezelfde nachtdienst heeft om 00:30 nog 6u30', () => {
    const nacht = { date: '2027-10-30', startTime: '22:00', endTime: '06:00' };
    expect(minutesUntilShiftEnd(nacht, om('2027-10-31', 0, 30))).toBe(390);
    expect(minutesUntilShiftStart({ date: '2027-10-31', startTime: '06:00' }, om('2027-10-30', 23, 0))).toBe(480);
  });

  it('seconden tellen niet mee: de aftelling blijft in hele minuten', () => {
    const dienst = { date: '2026-08-02', startTime: '12:08', endTime: '18:54' };
    expect(minutesUntilShiftEnd(dienst, new Date('2026-08-02T17:22:45'))).toBe(92);
    expect(minutesUntilShiftStart({ date: '2026-08-02', startTime: '12:08' }, new Date('2026-08-02T11:00:59'))).toBe(68);
  });
});

describe('formatRemaining', () => {
  it('schrijft uren en minuten compact', () => {
    expect(formatRemaining(92)).toBe('nog 1u 32min');
    // Nul-geprefixt zodra er uren zijn: anders springt de linkerrand van de
    // aftel-kolom heen en weer tussen "2u 8min" en "2u 42min".
    expect(formatRemaining(128)).toBe('nog 2u 08min');
    expect(formatRemaining(61)).toBe('nog 1u 01min');
    expect(formatRemaining(47)).toBe('nog 47min');
    expect(formatRemaining(120)).toBe('nog 2u');
    expect(formatRemaining(1)).toBe('nog 1min');
  });
});

describe('minutesUntilShiftStart', () => {
  const dienst = { date: '2026-08-04', startTime: '13:11', endTime: '20:55' };

  it('telt af naar een dienst die vandaag nog moet beginnen', () => {
    expect(minutesUntilShiftStart(dienst, om('2026-08-04', 11, 51))).toBe(80);
  });

  it('geeft niets zodra de dienst begonnen is', () => {
    expect(minutesUntilShiftStart(dienst, om('2026-08-04', 13, 11))).toBeNull();
    expect(minutesUntilShiftStart(dienst, om('2026-08-04', 15, 0))).toBeNull();
    // Ook een dienst van gisteren telt niet meer vooruit.
    expect(minutesUntilShiftStart(dienst, om('2026-08-05', 6, 0))).toBeNull();
  });

  it('telt over middernacht heen naar een dienst van morgen', () => {
    // Om 22:00 vanavond is de vroege dienst van morgen nog 7u 25min weg.
    expect(minutesUntilShiftStart({ date: '2026-08-05', startTime: '05:25' }, om('2026-08-04', 22, 0))).toBe(445);
  });

  it('geeft niets bij onleesbare tijden', () => {
    expect(minutesUntilShiftStart({ date: '2026-08-04', startTime: 'x' }, om('2026-08-04', 9, 0))).toBeNull();
    expect(minutesUntilShiftStart({ date: '2026-08-04', startTime: '08:75' }, om('2026-08-04', 6, 0))).toBeNull();
  });
});

describe('formatStartsIn', () => {
  it('gebruikt dezelfde opmaak als de aftelling, met "over"', () => {
    expect(formatStartsIn(80)).toBe('over 1u 20min');
    expect(formatStartsIn(128)).toBe('over 2u 08min');
    expect(formatStartsIn(47)).toBe('over 47min');
    expect(formatStartsIn(120)).toBe('over 2u');
  });
});
