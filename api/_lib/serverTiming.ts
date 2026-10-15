import type express from "express";

/**
 * Meetbaarheid (ronde 3, 19-09): elk /api-antwoord draagt
 * `Server-Timing: app;dur=<ms>` (tijd in de functie, van binnenkomst tot de
 * headers vertrekken; zichtbaar in de netwerk-tab van de browser naast de
 * totale duur, zodat "traag" te splitsen is in netwerk en server), en elk
 * request boven de drempel geeft één logregel `[traag] METHODE pad 1234ms`,
 * sinds 15-10 uitgesplitst in de stappen die `markeer` noteerde (limiet,
 * auth, profiel, toestel, route) en met de leeftijd van de instantie plus het
 * volgnummer van het request erop (koud of warm).
 *
 * Privacy: nooit de querystring, en van het pad alleen het ROUTEPATROON
 * (`/api/users/:id`), niet de ingevulde waarde: in paden zitten gebruikers-
 * id's en soms een geheim (agenda-feed). Zonder gematchte route (404) worden
 * segmenten die op een id of token lijken gemaskeerd.
 */
const TRAAG_MS = 1500;

const lijktOpId = (segment: string): boolean =>
  /^\d+$/.test(segment) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) ||
  segment.length >= 16 ||
  /\d{3,}/.test(segment);

export const veiligPad = (req: express.Request): string => {
  const patroon = (req as { route?: { path?: unknown } }).route?.path;
  if (typeof patroon === "string") return `${req.baseUrl ?? ""}${patroon}`;
  const pad = String(req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
  return pad
    .split("/")
    .map((s) => (s && lijktOpId(s) ? ":id" : s))
    .join("/")
    .slice(0, 120);
};

/** Wat één request onderweg noteert (zie `markeer`). */
type Timing = { start: number; now: () => number; marks: Array<{ naam: string; t: number }> };
const TIMING_SLEUTEL = "vhbTiming";

// Koud of warm: de leeftijd van deze instantie en het volgnummer van het
// request erop staan in elke [traag]-regel. "instantie 0s, request 1" is een
// koude start; "instantie 840s, request 212" is een warme instantie die traag
// was om een andere reden (database, Storage, de route zelf).
const INSTANTIE_START = Date.now();
let requestNr = 0;

/** Een tussentijd noteren vanuit een middleware of route (bv. "auth" zodra
 *  het token geverifieerd is): Server-Timing en de [traag]-regel splitsen
 *  de totale tijd dan op in die stappen, plus "route" voor wat na de laatste
 *  markering nog volgde. Zonder de serverTiming-middleware een no-op. */
export const markeer = (res: express.Response, naam: string): void => {
  const t = (res.locals as Record<string, unknown>)[TIMING_SLEUTEL] as Timing | undefined;
  if (!t) return;
  t.marks.push({ naam, t: t.now() - t.start });
};

const stappen = (t: Timing, totaal: number): Array<[string, number]> => {
  if (t.marks.length === 0) return [];
  const uit: Array<[string, number]> = [];
  let vorige = 0;
  for (const m of t.marks) {
    uit.push([m.naam, Math.max(0, Math.round(m.t - vorige))]);
    vorige = m.t;
  }
  uit.push(["route", Math.max(0, Math.round(totaal - vorige))]);
  return uit;
};

export const serverTiming = (opts?: { traagMs?: number; now?: () => number; log?: (regel: string) => void }) => {
  const traagMs = opts?.traagMs ?? TRAAG_MS;
  const now = opts?.now ?? (() => performance.now());
  const log = opts?.log ?? ((regel: string) => console.warn(regel));
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const start = now();
    const timing: Timing = { start, now, marks: [] };
    (res.locals as Record<string, unknown>)[TIMING_SLEUTEL] = timing;
    requestNr += 1;
    const nr = requestNr;
    const instantieS = Math.round((Date.now() - INSTANTIE_START) / 1000);
    // De header moet mee met de statusregel: op het laatste moment zetten,
    // net voor de headers vertrekken.
    const origineel = res.writeHead;
    res.writeHead = function (this: express.Response, ...args: unknown[]) {
      if (!res.headersSent) {
        const totaal = Math.max(0, Math.round(now() - start));
        const delen = stappen(timing, totaal).map(([naam, ms]) => `, ${naam};dur=${ms}`).join("");
        try { res.setHeader("Server-Timing", `app;dur=${totaal}${delen}`); } catch { /* headers al weg */ }
      }
      return (origineel as (...a: unknown[]) => express.Response).apply(this, args);
    } as typeof res.writeHead;
    res.on("finish", () => {
      const ms = Math.round(now() - start);
      if (ms > traagMs) {
        const delen = stappen(timing, ms);
        const uitsplitsing = delen.length > 0 ? ` | ${delen.map(([naam, d]) => `${naam} ${d}`).join(" · ")}` : "";
        log(`[traag] ${req.method} ${veiligPad(req)} ${ms}ms${uitsplitsing} | instantie ${instantieS}s, request ${nr}`);
      }
    });
    next();
  };
};
