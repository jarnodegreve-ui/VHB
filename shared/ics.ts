/**
 * Pure iCalendar (.ics) helpers, gedeeld door api/ (abonnee-feed) en src/
 * (één bron in shared/, geen browser/DOM- of Node-afhankelijkheden).
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

/** 'YYYY-MM-DD' + een aantal dagen (UTC-veilig, puur op de datum). */
function addDays(date: string, dagen: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + dagen);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 'YYYY-MM-DD' → volgende dag (UTC-veilig, puur op de datum). */
export function addOneDay(date: string): string {
  return addDays(date, 1);
}

/** 'YYYY-MM-DD' + 'HH:MM' → floating datetime 'YYYYMMDDTHHMMSS'. */
export function toFloatingDateTime(date: string, time: string): string {
  const compactDate = date.replace(/-/g, '');
  const [h = '00', min = '00'] = String(time).split(':');
  return `${compactDate}T${h.padStart(2, '0')}${min.padStart(2, '0')}00`;
}

const DAG_MINUTEN = 24 * 60;

/**
 * Een opgeslagen tijd als minuten sinds middernacht van de dienstdag, of null
 * als het geen tijd onder 48:00 is. Zelfde regel als de planning (uur 0–47
 * voor de busvak-notatie, minuten 0–59); een uur zonder minuten, minuten met
 * één cijfer en een secondendeel blijven gelden, want die schreef de feed
 * altijd al goed uit. "9:00" < "17:00" faalt lexicografisch, vandaar minuten.
 *
 * Alleen cijfers (beveiligingsscan 01-10): `Number()` las ook "Infinity:00"
 * en "1e300:00", en de dag werd toen per stap een dag verder gezet. Zo'n
 * waarde liet de agenda-feed eindeloos lopen, "99999999:00" seconden lang.
 */
export function dienstMinuten(tijd: string): number | null {
  const m = /^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?$/.exec(String(tijd ?? '').trim());
  if (!m) return null;
  const uur = Number(m[1]);
  const minuten = Number(m[2] ?? 0);
  return uur <= 47 && minuten <= 59 ? uur * 60 + minuten : null;
}

/** Minuten sinds middernacht van `date` → floating datetime. Busvak-notatie
 *  ("26:16" = 02:16 de volgende nacht) wordt een gewone wandkloktijd op een
 *  latere dag; 'T261600' is ongeldig iCalendar en agenda-apps laten zo'n
 *  event vallen of tonen het fout. De dag-offset is een deling, geen lus. */
function momentOp(date: string, minuten: number): string {
  const dagen = Math.floor(minuten / DAG_MINUTEN);
  const rest = minuten % DAG_MINUTEN;
  const tijd = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
  return toFloatingDateTime(dagen > 0 ? addDays(date, dagen) : date, tijd);
}

/** De regels van één gebeurtenis; leeg als de start of het einde geen tijd
 *  onder 48:00 is (zo'n rij slaat de feed over in plaats van erop te hangen
 *  of een ongeldige regel te schrijven). */
export function buildVevent(ev: IcsEvent, dtstamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${dtstamp}`];
  if (ev.allDay) {
    // Hele-dag: DATE-waarden zonder tijd. DTEND is exclusief (dag ná de laatste).
    const start = ev.date.replace(/-/g, '');
    const endExclusive = addOneDay(ev.endDate || ev.date).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${endExclusive}`);
  } else {
    // Alles eerst als minuten sinds middernacht van de dienstdag: zo klopt
    // ook gemengde notatie ("24:30 – 06:00" = start busvak, einde gewoon),
    // die anders een DTEND vóór DTSTART opleverde en het event in agenda-
    // apps liet vallen. Eind <= start betekent altijd "volgende dag".
    const startMin = dienstMinuten(ev.startTime);
    const rawEndMin = dienstMinuten(ev.endTime);
    if (startMin === null || rawEndMin === null) return [];
    const endMin = rawEndMin <= startMin ? rawEndMin + DAG_MINUTEN : rawEndMin;
    lines.push(`DTSTART:${momentOp(ev.date, startMin)}`, `DTEND:${momentOp(ev.date, endMin)}`);
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
