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

export function buildVevent(ev: IcsEvent, dtstamp: string): string[] {
  const endDate = ev.endTime <= ev.startTime ? addOneDay(ev.date) : ev.date;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toFloatingDateTime(ev.date, ev.startTime)}`,
    `DTEND:${toFloatingDateTime(endDate, ev.endTime)}`,
    `SUMMARY:${escapeIcsText(ev.summary)}`,
  ];
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
