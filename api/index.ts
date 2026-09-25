/**
 * De API-functie. Dit bestand bouwt alleen de app op: middleware in de juiste
 * volgorde, de domeinen mounten, de 404 en de foutafhandeling. De routes zelf
 * wonen per domein in api/_lib/<domein>Routes.ts (21-09, verbeterronde 4, G1;
 * voordien stond alles hier, 6.344 regels).
 *
 * Nieuwe route? In de module van haar domein. Nieuw domein? Een nieuw
 * `mountXRoutes(app)` hieronder. Gedeelde vangrails (collectie-revisie,
 * massa-verwijder-rem, record-conflicten) staan in api/_lib/collectie.ts.
 */
import express from "express";
import cors from "cors";
import { createRequire } from "node:module";
import { rateLimitMiddleware } from "./rateLimit.js";
import { mountOcpiRoutes } from "./ocpi.js";
import { mountDeviceRoutes } from "./deviceRoutes.js";
import { mountOnderhoudRoutes } from "./_lib/onderhoudRoutes.js";
import { mountMailRoutes } from "./_lib/mailRoutes.js";
import { serverTiming } from "./_lib/serverTiming.js";
import { mountTechniekRoutes } from "./_lib/techniekRoutes.js";
import { mountLoonRoutes } from "./_lib/loonRoutes.js";
import { mountDienstRoutes } from "./_lib/dienstRoutes.js";
import { mountRapportRoutes } from "./_lib/rapportRoutes.js";
import { mountTelegramRoutes } from "./telegram.js";
import { mountCoverageRoutes, berekenDekkingsGaten, berekenCoverageAdvies } from "./coverageRoutes.js";
import { mountSysteemRoutes } from "./_lib/systeemRoutes.js";
import { mountAccountRoutes } from "./_lib/accountRoutes.js";
import { mountGebruikersRoutes } from "./_lib/gebruikersRoutes.js";
import { mountPlanningRoutes, wijsDienstToeIntern } from "./_lib/planningRoutes.js";
import { mountCronRoutes } from "./_lib/cronRoutes.js";
import { mountCommunicatieRoutes } from "./_lib/communicatieRoutes.js";
import { mountRuilRoutes, beslisRuilIntern } from "./_lib/ruilRoutes.js";
import { mountVerlofRoutes, beslisVerlofIntern, registreerZiekmeldingIntern } from "./_lib/verlofRoutes.js";
import { mountDocumentRoutes } from "./_lib/documentRoutes.js";

// dotenv alleen buiten Vercel (ronde 3): daar komen de env-vars van het
// platform en was dit bij elke koude start een overbodige module + een
// vergeefse zoektocht naar een .env-bestand. Lokaal (`tsx api/index.ts`)
// blijft het gedrag identiek: synchroon, op dezelfde plek in de opstart.
// Via createRequire i.p.v. een statische import, zodat de module op Vercel
// niet eens ingelezen wordt (en zonder top-level await). Opgelost vanaf de
// werkmap (lokaal altijd de repo-root) en bewust zonder `import.meta`: dit
// bestand is dé functie, en niets hier mag afhangen van hoe de Vercel-bouw
// de module-vorm kiest.
if (!process.env.VERCEL) {
  try {
    (createRequire(`${process.cwd()}/package.json`)("dotenv") as typeof import("dotenv")).config();
  } catch (err) {
    console.warn("[config] dotenv niet geladen, alleen de bestaande omgevingsvariabelen gelden:", (err as Error)?.message ?? err);
  }
}

// Env-dump alleen buiten productie: op serverless herhaalt dit zich bij elke
// koude start en verdunt het de echte fouten in de logs.
if (process.env.NODE_ENV !== "production") {
  console.log("Server starting in environment:", process.env.NODE_ENV);
  console.log("Supabase URL present:", !!process.env.SUPABASE_URL);
  console.log("Supabase Key present:", !!process.env.SUPABASE_ANON_KEY);
  console.log("Supabase Service Role present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
}
// Zonder eigen secret is de agenda-feed uit (fail-closed, zie CAL_SECRET).
// Luid loggen: dit viel vroeger niet op omdat hij stil terugviel op de
// service-role-key en dus altijd "werkte".
if (!process.env.CALENDAR_FEED_SECRET) {
  console.warn("[config] CALENDAR_FEED_SECRET ontbreekt, de agenda-feed is uitgeschakeld. Zet hem in de env om abonneren weer mogelijk te maken.");
}

const app = express();
const PORT = 3000;

// Meetbaarheid: Server-Timing op elk /api-antwoord + één logregel voor trage
// requests. Als allereerste middleware, zodat ook CORS, body-parsing, de
// rate-limiter en authenticate in de gemeten tijd zitten. Zie _lib/serverTiming.ts.
app.use("/api", serverTiming());

// CORS beperkt tot de eigen origins (prod, Vercel-previews van dit project,
// lokale dev) i.p.v. wildcard. De app draait same-origin, dus browsers hebben
// dit zelden nodig — maar wildcard liet elke website met een gestolen token
// cross-origin lezen. exposedHeaders: laat clients de custom response-headers
// lezen (revisie-check + 429-Retry-After).
// vhbportaal.com ontbrak: de app draait daar same-origin, dus browsers vragen
// er geen CORS voor — maar zodra iets wél een preflight doet (een tweede
// domein, een tool), stond het echte productiedomein er niet in.
// localhost staat er alleen buiten productie: op de live-deploy heeft niemand
// een legitieme reden om vanaf een lokale pagina te posten, en het scheelt een
// origin die een aanvaller op zijn eigen machine kan nabootsen.
const ALLOWED_ORIGINS: Array<string | RegExp> = [
  "https://vhbportaal.com",
  "https://www.vhbportaal.com",
  "https://vhb-five.vercel.app",
  /^https:\/\/vhb-[a-z0-9-]+-jarnodegreve-uis-projects\.vercel\.app$/,
  ...(process.env.VERCEL_ENV === "production" ? [] : [/^http:\/\/localhost:\d+$/]),
];
app.use(cors({ origin: ALLOWED_ORIGINS, exposedHeaders: ["X-Collection-Revision", "X-Planning-Tot", "Retry-After"] }));
// 5 MB is eerlijk: Vercel kapt request-bodies sowieso op ~4,5 MB af — de
// oude 25mb-limiet wekte de indruk dat grotere uploads (PDF's, Excels) konden.
// /api/client-errors (open, zonder auth) krijgt een eigen, veel kleinere
// limiet op de route zelf (controle 05-09, nr. 31): een route-parser doet
// niets meer zodra de globale al geparset heeft, dus die slaat dat pad over.
const jsonBody = express.json({ limit: '5mb' });
app.use((req, res, next) => (req.path === "/api/client-errors" ? next() : jsonBody(req, res, next)));

// Health check — publiek maar kaal: geen tabelstatussen/foutmeldingen/env
// naar buiten (info-disclosure). Gedetailleerde checks alleen voor admins.
// Bewust VÓÓR de rate-limiter: het antwoord is statisch (geen DB, geen
// store), en de online-ping van de client (HEAD, 4 s timeout) mag niet op
// een trage of haperende Upstash wachten, anders toont de app "offline"
// terwijl alleen de limiter-store traag is.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Rem op tollende/vastgelopen clients — per ingelogde gebruiker (token),
// niet per IP, zodat het hele bedrijfsnetwerk achter één NAT niet samen één
// limiet deelt. Zie rateLimit.ts voor de serverless-nuance.
app.use("/api", rateLimitMiddleware);

// Request-logging alleen buiten productie — Vercel logt method/pad/status
// zelf al per aanroep, dus in productie was dit louter dubbel geluid.
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// OCPI 2.2.1 (eMSP, read-only monitoring van ChargEye) — eigen token-auth,
// los van de Supabase-auth. Zie api/ocpi.ts.
mountOcpiRoutes(app);

// Toestel-whitelist (registratie + admin-beheer). Zie api/deviceRoutes.ts.
mountDeviceRoutes(app);

// Onderhoudsmodus (banner + schrijfblok). Zie api/_lib/onderhoudRoutes.ts;
// het blok zelf zit in authenticate (middleware.ts).
mountOnderhoudRoutes(app);
mountMailRoutes(app);

// Techniek: voertuigen, gele boek, werkprestaties, vervaldata per voertuig.
// Zie api/_lib/techniekRoutes.ts (fase A Access-migratie, 13-09).
mountTechniekRoutes(app);

// Telegram-bot voor de planner (webhook, commando's, goedkeurknoppen). Zie
// api/telegram.ts. De bereken-functies komen uit coverageRoutes/advisor; de
// *Intern-schrijfkernen uit de domeinmodules (ruil, verlof, planning). Ze
// worden hier doorgegeven i.p.v. in telegram.ts geïmporteerd: die modules
// importeren zelf de meld-helpers van telegram.ts, dus omgekeerd importeren
// zou een cyclus geven.
mountTelegramRoutes(app, {
  berekenDekkingsGaten,
  berekenCoverageAdvies,
  beslisVerlof: beslisVerlofIntern,
  beslisRuil: beslisRuilIntern,
  registreerZiekmelding: registreerZiekmeldingIntern,
  wijsDienstToe: wijsDienstToeIntern,
});

// Dekking & advies (expectations, gaten, advisor). Zie api/coverageRoutes.ts.
mountCoverageRoutes(app);

// Loon: dagafsluiting en Easypay-export (fase B Access-migratie, 13-09). Zie api/_lib/loonRoutes.ts.
mountLoonRoutes(app);

// Dienstopbouw op rit-niveau (fase C Access-migratie, 13-09). Zie api/_lib/dienstRoutes.ts.
mountDienstRoutes(app);

// Rapporten: GET /api/rapporten/:id (register in shared/rapporten). Zie api/_lib/rapportRoutes.ts.
mountRapportRoutes(app);

// Domeinroutes (21-09, G1): elk domein woont in api/_lib/<domein>Routes.ts.
// De volgorde hieronder is die waarin de domeinen vroeger in dit bestand
// voor het eerst voorkwamen; geen twee domeinen delen een pad.
mountSysteemRoutes(app);
mountAccountRoutes(app);
mountGebruikersRoutes(app);
mountPlanningRoutes(app);
mountCronRoutes(app);
mountCommunicatieRoutes(app);
mountRuilRoutes(app);
mountVerlofRoutes(app);
mountDocumentRoutes(app);

app.all("/api/*", (req, res) => {
  if (process.env.NODE_ENV !== "production") console.log(`API Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found on server` });
});

// Global error handler — details/stack alleen in de server-logs, nooit
// naar de client (info-disclosure).
app.use((err: any, _req: any, res: any, _next: any) => {
  // Te grote body (express.json-limiet): een nette 413 i.p.v. een 500 —
  // het is een clientfout, geen serverstoring.
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ error: "Verzoek is te groot." });
  }
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ error: "Er ging iets mis op de server." });
});

// Vite-middleware voor lokale ontwikkeling. Er is bewust géén productie-tak
// (express.static + SPA-fallback): op Vercel serveert de platform-rewrite
// (vercel.json) dist/ en index.html zelf en bereikt alleen /api/* deze functie.
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const startVite = async () => {
    const { createServer: createViteServer } = await import("vite");
    console.log("Starting with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      optimizeDeps: {
        include: ['react', 'react-dom']
      }
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  };
  startVite();
}

export default app;
