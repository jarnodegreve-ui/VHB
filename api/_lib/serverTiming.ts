import type express from "express";

/**
 * Meetbaarheid (ronde 3, 19-09): elk /api-antwoord draagt
 * `Server-Timing: app;dur=<ms>` (tijd in de functie, van binnenkomst tot de
 * headers vertrekken; zichtbaar in de netwerk-tab van de browser naast de
 * totale duur, zodat "traag" te splitsen is in netwerk en server), en elk
 * request boven de drempel geeft één logregel `[traag] METHODE pad 1234ms`.
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

export const serverTiming = (opts?: { traagMs?: number; now?: () => number; log?: (regel: string) => void }) => {
  const traagMs = opts?.traagMs ?? TRAAG_MS;
  const now = opts?.now ?? (() => performance.now());
  const log = opts?.log ?? ((regel: string) => console.warn(regel));
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const start = now();
    // De header moet mee met de statusregel: op het laatste moment zetten,
    // net voor de headers vertrekken.
    const origineel = res.writeHead;
    res.writeHead = function (this: express.Response, ...args: unknown[]) {
      if (!res.headersSent) {
        try { res.setHeader("Server-Timing", `app;dur=${Math.max(0, Math.round(now() - start))}`); } catch { /* headers al weg */ }
      }
      return (origineel as (...a: unknown[]) => express.Response).apply(this, args);
    } as typeof res.writeHead;
    res.on("finish", () => {
      const ms = Math.round(now() - start);
      if (ms > traagMs) log(`[traag] ${req.method} ${veiligPad(req)} ${ms}ms`);
    });
    next();
  };
};
