/**
 * Pure iCalendar (.ics) helpers — API-lokaal (geen cross-import uit ../src,
 * dat brak de serverless-functie op Vercel). Houd in sync met
 * src/lib/ics.ts (die door de unit-tests gedekt wordt).
 *
 * Tijden als "floating local time" (geen Z/TZID): agenda-apps tonen die in
 * de lokale tijdzone — DST-proof voor één tijdzone, zonder VTIMEZONE.
 */

export type IcsEvent = {
  uid: string;
  date: string;
  startTime: string;
  endTime: string;
  summary: string;
  description?: string;
  /** Hele-dag-gebeurtenis (bv. verlof/ziekte): dan tellen start/endTime niet
   *  en loopt de gebeurtenis van `date` t/m `endDate` (inclusief). */
  allDay?: boolean;
  endDate?: string;
};

export function escapeIcsText(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    out.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return out.join("\r\n");
}

export function addOneDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function toFloatingDateTime(date: string, time: string): string {
  const compactDate = date.replace(/-/g, "");
  const [h = "00", min = "00"] = String(time).split(":");
  return `${compactDate}T${h.padStart(2, "0")}${min.padStart(2, "0")}00`;
}

// "9:00" < "17:00" faalt lexicografisch — vergelijk op minuten.
function toMinutes(hhmm: string): number {
  const [h, m] = String(hhmm).split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/** Busvak-notatie ("26:16" = 02:16 de volgende nacht) → dag-offset + gewone
 *  wandkloktijd. Zonder deze normalisatie zou een 26:xx-eindtijd als
 *  'T261600' in de feed belanden — ongeldig iCalendar, agenda-apps laten
 *  het event dan vallen of tonen het fout. */
function normalizeDayTime(date: string, time: string): { date: string; time: string } {
  const total = toMinutes(time);
  if (total < 24 * 60) return { date, time };
  const rest = total % (24 * 60);
  let day = date;
  for (let i = Math.floor(total / (24 * 60)); i > 0; i--) day = addOneDay(day);
  return {
    date: day,
    time: `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}`,
  };
}

export function buildVevent(ev: IcsEvent, dtstamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${ev.uid}`, `DTSTAMP:${dtstamp}`];
  if (ev.allDay) {
    // Hele-dag: DATE-waarden zonder tijd. DTEND is exclusief, dus de dag ná
    // de laatste dag (verlof t/m endDate → DTEND = endDate + 1).
    const start = ev.date.replace(/-/g, "");
    const endExclusive = addOneDay(ev.endDate || ev.date).replace(/-/g, "");
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${endExclusive}`);
  } else {
    const start = normalizeDayTime(ev.date, ev.startTime);
    const end = normalizeDayTime(ev.date, ev.endTime);
    // Impliciete nachtdienst (eind <= start in gewone uren) → einddatum is
    // de volgende dag; busvak-uren zijn hierboven al doorgeschoven.
    const endDate = end.date === start.date && toMinutes(end.time) <= toMinutes(start.time)
      ? addOneDay(end.date)
      : end.date;
    lines.push(`DTSTART:${toFloatingDateTime(start.date, start.time)}`, `DTEND:${toFloatingDateTime(endDate, end.time)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(events: IcsEvent[], opts: { calName: string; dtstamp: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VHB Portaal//Diensten//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(opts.calName)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...events.flatMap((ev) => buildVevent(ev, opts.dtstamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
