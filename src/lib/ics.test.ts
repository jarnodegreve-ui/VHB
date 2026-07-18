import { describe, it, expect } from 'vitest';
import { escapeIcsText, foldIcsLine, addOneDay, toFloatingDateTime, buildVevent, buildCalendar, type IcsEvent } from './ics';

const DTSTAMP = '20260609T120000Z';

describe('ics — helpers', () => {
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

describe('ics — events', () => {
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
