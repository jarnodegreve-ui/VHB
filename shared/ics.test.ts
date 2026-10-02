import { describe, it, expect } from 'vitest';
import { escapeIcsText, foldIcsLine, addOneDay, toFloatingDateTime, buildVevent, buildCalendar, dienstMinuten, type IcsEvent } from './ics';

const DTSTAMP = '20260609T120000Z';

describe('ics, helpers', () => {
  it('escapeIcsText escapet , ; \\ en newline', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('foldIcsLine vouwt lange regels op 75 octets met spatie-continuation', () => {
    const short = 'SUMMARY:Dienst 4101';
    expect(foldIcsLine(short)).toBe(short);
    const long = 'X'.repeat(200);
    const folded = foldIcsLine(long);
    expect(folded).toContain('\r\n ');
    // gevouwen regel moet bij ontvouwen weer het origineel zijn
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });

  it('addOneDay over maandgrens', () => {
    expect(addOneDay('2026-07-08')).toBe('2026-07-09');
    expect(addOneDay('2026-06-30')).toBe('2026-07-01');
    expect(addOneDay('2026-12-31')).toBe('2027-01-01');
  });

  it('toFloatingDateTime formatteert zonder Z/TZID', () => {
    expect(toFloatingDateTime('2026-07-03', '05:11')).toBe('20260703T051100');
  });
});

// Beveiligingsscan 01-10: een opgeslagen tijd mag de feed niet laten hangen.
// De vorige uitwerking las de tijd met Number() en zette de dag per stap een
// dag verder: "Infinity:00" en "1e300:00" eindigden nooit, "99999999:00"
// duurde seconden. Hieronder staat ze als referentie, om te bewijzen dat de
// nieuwe voor elke geldige tijd letterlijk hetzelfde schrijft.
describe('ics, tijden: geldig blijft gelijk, ongeldig valt weg', () => {
  const oudeMinuten = (hhmm: string): number => {
    const [h, m] = String(hhmm).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const oudeDagTijd = (date: string, time: string): { date: string; time: string } => {
    const total = oudeMinuten(time);
    if (total < 24 * 60) return { date, time };
    const rest = total % (24 * 60);
    let day = date;
    for (let i = Math.floor(total / (24 * 60)); i > 0; i--) day = addOneDay(day);
    return { date: day, time: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}` };
  };
  /** DTSTART en DTEND zoals de vorige buildVevent ze schreef. */
  const oudeRegels = (date: string, startTime: string, endTime: string): string[] => {
    const startMin = oudeMinuten(startTime);
    const rawEndMin = oudeMinuten(endTime);
    const endMin = rawEndMin <= startMin ? rawEndMin + 24 * 60 : rawEndMin;
    const start = oudeDagTijd(date, startTime);
    const end = oudeDagTijd(date, `${Math.floor(endMin / 60)}:${String(endMin % 60).padStart(2, '0')}`);
    return [`DTSTART:${toFloatingDateTime(start.date, start.time)}`, `DTEND:${toFloatingDateTime(end.date, end.time)}`];
  };
  const nieuweRegels = (date: string, startTime: string, endTime: string): string[] =>
    buildVevent({ uid: 'u', date, startTime, endTime, summary: 's' }, DTSTAMP).filter((r) => r.startsWith('DTSTART') || r.startsWith('DTEND'));
  const hhmm = (minuten: number) => `${String(Math.floor(minuten / 60)).padStart(2, '0')}:${String(minuten % 60).padStart(2, '0')}`;

  it.each([
    ['08:00', '16:00', 'DTSTART:20260703T080000', 'DTEND:20260703T160000'],
    ['08:00', '23:59', 'DTSTART:20260703T080000', 'DTEND:20260703T235900'],
    ['23:59', '24:00', 'DTSTART:20260703T235900', 'DTEND:20260704T000000'],
    ['16:00', '25:00', 'DTSTART:20260703T160000', 'DTEND:20260704T010000'],
    ['24:00', '25:00', 'DTSTART:20260704T000000', 'DTEND:20260704T010000'],
    ['25:00', '47:59', 'DTSTART:20260704T010000', 'DTEND:20260704T235900'],
    ['47:59', '47:59', 'DTSTART:20260704T235900', 'DTEND:20260705T235900'],
    ['22:30', '06:15', 'DTSTART:20260703T223000', 'DTEND:20260704T061500'],
    ['9:05', '17:00', 'DTSTART:20260703T090500', 'DTEND:20260703T170000'],
    ['00:00', '00:00', 'DTSTART:20260703T000000', 'DTEND:20260704T000000'],
  ])('%s tot %s', (start, eind, dtstart, dtend) => {
    expect(nieuweRegels('2026-07-03', start, eind)).toEqual([dtstart, dtend]);
    expect(oudeRegels('2026-07-03', start, eind)).toEqual([dtstart, dtend]);
  });

  it('elke start van 00:00 tot 47:59 tegen een reeks eindtijden: letterlijk de vorige uitvoer', () => {
    const einden = [0, 1, 59, 60, 479, 480, 719, 720, 1380, 1439, 1440, 1441, 1500, 1576, 2000, 2878, 2879];
    for (let m = 7; m < 48 * 60; m += 97) einden.push(m);
    let vergeleken = 0;
    // Jaargrens en schrikkeldag: de dag erna en twee dagen erna vallen in een andere maand.
    for (const date of ['2026-12-31', '2028-02-28']) {
      for (let start = 0; start < 48 * 60; start++) {
        for (const eind of einden) {
          const [s, e] = [hhmm(start), hhmm(eind)];
          const nieuw = nieuweRegels(date, s, e);
          if (nieuw.join('|') !== oudeRegels(date, s, e).join('|')) expect(nieuw, `${date} ${s}-${e}`).toEqual(oudeRegels(date, s, e));
          vergeleken++;
        }
      }
    }
    expect(vergeleken).toBeGreaterThan(250_000);
  }, 30_000);

  it('elk einde van 00:00 tot 47:59 tegen een reeks starttijden, ook met één cijfer voor het uur', () => {
    const zonderNul = (minuten: number) => `${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, '0')}`;
    for (const start of [0, 311, 480, 941, 1350, 1439, 1440, 1470, 2000, 2879]) {
      for (let eind = 0; eind < 48 * 60; eind++) {
        for (const vorm of [hhmm, zonderNul]) {
          const [s, e] = [vorm(start), vorm(eind)];
          const nieuw = nieuweRegels('2026-07-03', s, e);
          if (nieuw.join('|') !== oudeRegels('2026-07-03', s, e).join('|')) expect(nieuw, `${s}-${e}`).toEqual(oudeRegels('2026-07-03', s, e));
        }
      }
    }
  }, 30_000);

  it('dienstMinuten: uur 0 tot 47, minuten 0 tot 59, alleen cijfers', () => {
    expect(dienstMinuten('00:00')).toBe(0);
    expect(dienstMinuten('8:00')).toBe(480);
    expect(dienstMinuten(' 08:00 ')).toBe(480);
    expect(dienstMinuten('26:16')).toBe(1576);
    expect(dienstMinuten('47:59')).toBe(2879);
    expect(dienstMinuten('08:00:00')).toBe(480);
    for (const fout of ['48:00', '99:00', '08:60', '08:75', '-1:00', '', 'abc', '8u00', 'Infinity:00', '1e300:00', '1e1:00', '0x10:00', '99999999:00', 'NaN:00', '08:Infinity', null, undefined, 800]) {
      expect(dienstMinuten(fout as string), String(fout)).toBeNull();
    }
  });

  const GIF = ['Infinity:00', '1e300:00', '99999999:00', '48:00', '-1:00', 'abc', '08:75'];

  it.each(GIF)('een start of einde "%s" hangt niet en schrijft geen gebeurtenis', (gif) => {
    const start = performance.now();
    expect(buildVevent({ uid: 'u', date: '2026-07-03', startTime: gif, endTime: '16:00', summary: 's' }, DTSTAMP)).toEqual([]);
    expect(buildVevent({ uid: 'u', date: '2026-07-03', startTime: '08:00', endTime: gif, summary: 's' }, DTSTAMP)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('buildCalendar slaat alleen de zieke rijen over; de rest van de agenda blijft staan', () => {
    const goed = (uid: string): IcsEvent => ({ uid, date: '2026-07-03', startTime: '05:11', endTime: '13:11', summary: `Dienst ${uid}` });
    const ziek = GIF.flatMap((gif, i): IcsEvent[] => [
      { uid: `start-${i}`, date: '2026-07-03', startTime: gif, endTime: '16:00', summary: 'Ziek' },
      { uid: `eind-${i}`, date: '2026-07-03', startTime: '08:00', endTime: gif, summary: 'Ziek' },
    ]);
    const start = performance.now();
    const ics = buildCalendar([goed('a'), ...ziek, goed('b'), { uid: 'verlof', date: '2026-07-06', endDate: '2026-07-08', startTime: '00:00', endTime: '00:00', allDay: true, summary: 'Verlof' }], { calName: 'VHB', dtstamp: DTSTAMP });
    expect(performance.now() - start).toBeLessThan(100);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('UID:a');
    expect(ics).toContain('UID:b');
    expect(ics).toContain('UID:verlof');
    expect(ics).not.toContain('Ziek');
    // Elke tijd die overblijft is een geldige wandkloktijd.
    for (const regel of ics.split('\r\n').filter((r) => /^DT(START|END):/.test(r))) expect(regel).toMatch(/^DT(START|END):\d{8}T([01]\d|2[0-3])[0-5]\d00$/);
  });
});

describe('ics, events', () => {
  const base: IcsEvent = {
    uid: 'vhb-shift-1@vhb-portaal',
    date: '2026-07-03',
    startTime: '05:11',
    endTime: '13:11',
    summary: 'Dienst 4103',
    description: 'Bus 212 · Loop 1',
  };

  it('buildVevent: dagdienst blijft dezelfde dag', () => {
    const v = buildVevent(base, DTSTAMP).join('\n');
    expect(v).toContain('DTSTART:20260703T051100');
    expect(v).toContain('DTEND:20260703T131100');
    expect(v).toContain('SUMMARY:Dienst 4103');
    expect(v).toContain('UID:vhb-shift-1@vhb-portaal');
  });

  it('buildVevent: nachtdienst (eind <= start) loopt door naar volgende dag', () => {
    const v = buildVevent({ ...base, startTime: '22:30', endTime: '02:15' }, DTSTAMP).join('\n');
    expect(v).toContain('DTSTART:20260703T223000');
    expect(v).toContain('DTEND:20260704T021500');
  });

  it("buildVevent: busvak-eindtijd ('26:16' = 02:16) → geldige tijd op de volgende dag", () => {
    // Regressie: dienst 2607 (15:41–26:16) leverde 'DTEND:...T261600' op —
    // ongeldig iCalendar, agenda-apps lieten het event vallen.
    const v = buildVevent({ ...base, startTime: '15:41', endTime: '26:16' }, DTSTAMP).join('\n');
    expect(v).toContain('DTSTART:20260703T154100');
    expect(v).toContain('DTEND:20260704T021600');
    expect(v).not.toContain('T2616');
  });

  it('buildVevent: gemengde notatie (start busvak, einde gewoon) → DTEND ná DTSTART', () => {
    // Regressie: "24:30 – 06:00" gaf eerder DTEND op de dienstdag zelf,
    // dus vóór DTSTART → agenda-apps lieten het event vallen.
    const v = buildVevent({ ...base, startTime: '24:30', endTime: '06:00' }, DTSTAMP).join('\n');
    expect(v).toContain('DTSTART:20260704T003000');
    expect(v).toContain('DTEND:20260704T060000');
  });

  it('buildVevent: dienst volledig ná middernacht (start ≥ 24:00) schuift beide door', () => {
    const v = buildVevent({ ...base, startTime: '24:30', endTime: '27:00' }, DTSTAMP).join('\n');
    expect(v).toContain('DTSTART:20260704T003000');
    expect(v).toContain('DTEND:20260704T030000');
  });

  it('buildVevent: hele-dag (verlof) → DATE-waarden, DTEND exclusief', () => {
    const v = buildVevent({ ...base, allDay: true, date: '2026-07-03', endDate: '2026-07-05', summary: 'Verlof' }, DTSTAMP).join('\n');
    expect(v).toContain('DTSTART;VALUE=DATE:20260703');
    expect(v).toContain('DTEND;VALUE=DATE:20260706'); // t/m 05 → exclusief 06
    expect(v).not.toContain('T051100');
    expect(v).toContain('SUMMARY:Verlof');
  });

  it('buildCalendar: geldige VCALENDAR-omhulling + CRLF', () => {
    const ics = buildCalendar([base], { calName: 'VHB Diensten', dtstamp: DTSTAMP });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:VHB Diensten');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics.split('\r\n').length).toBeGreaterThan(5);
  });
});
