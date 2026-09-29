import { describe, it, expect } from 'vitest';
import { escapeIcsText, foldIcsLine, addOneDay, toFloatingDateTime, buildVevent, buildCalendar, type IcsEvent } from './ics';

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

  it('gelijke begin- en eindtijd (Jarno 29-09): de dienst blijft een afspraak, zonder DTEND, geen blok van 24 uur; geldige delen ongewijzigd', () => {
    const blok = (startTime: string, endTime: string) => {
      const regels = buildVevent({ ...base, startTime, endTime }, DTSTAMP);
      return { start: regels.find((r) => r.startsWith('DTSTART:')), einde: regels.find((r) => r.startsWith('DTEND:')) ?? null };
    };
    expect(blok('22:00', '06:00')).toEqual({ start: 'DTSTART:20260703T220000', einde: 'DTEND:20260704T060000' });
    expect(blok('16:00', '00:00')).toEqual({ start: 'DTSTART:20260703T160000', einde: 'DTEND:20260704T000000' });
    expect(blok('08:00', '32:00')).toEqual({ start: 'DTSTART:20260703T080000', einde: 'DTEND:20260704T080000' });
    // Ongeldig deel: nul minuten op het begintijdstip (RFC 5545, 3.6.1).
    expect(blok('08:00', '08:00')).toEqual({ start: 'DTSTART:20260703T080000', einde: null });
    expect(blok('00:00', '00:00')).toEqual({ start: 'DTSTART:20260703T000000', einde: null });
    expect(blok('24:30', '24:30')).toEqual({ start: 'DTSTART:20260704T003000', einde: null });
    // Een einde dat ook na +24 u niet na de start ligt: evenmin een DTEND
    // (vroeger DTEND gelijk aan of vóór DTSTART, ongeldig iCalendar).
    expect(blok('24:00', '00:00')).toEqual({ start: 'DTSTART:20260704T000000', einde: null });
    expect(blok('30:00', '06:00')).toEqual({ start: 'DTSTART:20260704T060000', einde: null });
    expect(blok('24:30', '00:00')).toEqual({ start: 'DTSTART:20260704T003000', einde: null });
    // Gemengde notatie mét venster blijft zoals ze was.
    expect(blok('24:30', '06:00')).toEqual({ start: 'DTSTART:20260704T003000', einde: 'DTEND:20260704T060000' });
    // Zichtbaar: de feed houdt één afspraak per dienst, met samenvatting.
    const ics = buildCalendar([{ ...base, startTime: '08:00', endTime: '08:00' }, base], { calName: 'VHB', dtstamp: DTSTAMP });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/SUMMARY:Dienst 4103/g)).toHaveLength(2);
    expect(ics.match(/^DTEND:/gm)).toHaveLength(1);
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
