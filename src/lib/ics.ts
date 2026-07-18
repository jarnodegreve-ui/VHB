/**
 * Pure iCalendar (.ics) helpers — géén browser/DOM- of Node-afhankelijkheden,
 * zodat zowel de server (abonnee-feed) als unit-tests ze kunnen gebruiken.
 *
 * Tijden worden als "floating local time" geschreven (geen Z, geen TZID):
 * agenda-apps tonen die in de lokale tijdzone van de kijker. Voor een
 * Belgisch bedrijf met één tijdzone is dat correct én DST-proof, zonder
 * VTIMEZONE-blokken.
 */

export type IcsEvent = {
  /** stabiele UID zodat een ververste feed updatet i.p.v. dupliceert */
  uid: string;
  /** startdatum 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM' */
  startTime: string;
  /** 'HH:MM' */
  endTime: string;
  summary: string;
  description?: string;
  /** Hele-dag-gebeurtenis (bv. verlof/ziekte): start/endTime tellen niet,
   *  de gebeurtenis loopt van `date` t/m `endDate` (inclusief). */
  allDay?: boolean;
  endDate?: string;
};

/** RFC5545-escaping voor TEXT-waarden (SUMMARY/DESCRIPTION). */
export function escapeIcsText(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC5545 line-folding: max 75 octets/regel, vervolgregels met spatie. */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    out.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return out.join('\r\n');
}

/** 'YYYY-MM-DD' → volgende dag (UTC-veilig, puur op de datum). */
export function addOneDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 'YYYY-MM-DD' + 'HH:MM' → floating datetime 'YYYYMMDDTHHMMSS'. */
export function toFloatingDateTime(date: string, time: string): string {
  const compactDate = date.replace(/-/g, '');
  const [h = '00', min = '00'] = String(time).split(':');
  return `${compactDate}T${h.padStart(2, '0')}${min.padStart(2, '0')}00`;
}

// "9:00" < "17:00" faalt lexicografisch — vergelijk op minuten.
function toMinutes(hhmm: string): number {
  const [h, m] = String(hhmm).split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

export function buildVevent(ev: IcsEvent, dtstamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${dtstamp}`];
  if (ev.allDay) {
    // Hele-dag: DATE-waarden zonder tijd. DTEND is exclusief (dag ná de laatste).
    const start = ev.date.replace(/-/g, '');
    const endExclusive = addOneDay(ev.endDate || ev.date).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${endExclusive}`);
  } else {
    // Nachtdienst: eind <= start → einddatum is de volgende dag.
    const endDate = toMinutes(ev.endTime) <= toMinutes(ev.startTime) ? addOneDay(ev.date) : ev.date;
    lines.push(`DTSTART:${toFloatingDateTime(ev.date, ev.startTime)}`, `DTEND:${toFloatingDateTime(endDate, ev.endTime)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  lines.push('END:VEVENT');
  return lines;
}

export function buildCalendar(events: IcsEvent[], opts: { calName: string; dtstamp: string }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VHB Portaal//Diensten//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(opts.calName)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    ...events.flatMap((ev) => buildVevent(ev, opts.dtstamp)),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
