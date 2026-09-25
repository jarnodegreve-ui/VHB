/**
 * Systeem: health-details en schema-check, testmail, activiteitenlog en
 * aanmeldingen, client-foutrapporten en het CSP-rapport.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import { TABLE_PROBES } from "../schemaProbes.js";
import { sendEmail, isSmtpConfigured, mailAfzender, mailOpbouw } from "../email.js";
import type { AuthenticatedRequest } from "../types.js";
import { db, supabase } from "../db.js";
import { authenticate, requireRole, isCronAuthorized, resolveOptionalUser } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { symbolicateTopFrame } from "../symbolicate.js";
import { clientErrorRateLimit } from "../rateLimit.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { FOUT_STATUSSEN, fingerprintVan, groepeerFouten, referentieVan, type FoutStatusWaarde } from "./foutgroepen.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getActivityLog, getAanwezigheid, getLoginActivity, getEntityHistory, getUsersData, logActivity, logClientError, getClientErrors, getClientErrorStatuses, setClientErrorStatus, isMissingDbFunction, getCronHeartbeats } from "../storage.js";

const runSchemaCheck = async (res: express.Response) => {
  if (!db) return res.status(503).json({ ok: false, error: "Database niet geconfigureerd." });
  const missing: string[] = [];

  // Kolomlijsten gedeeld met de contracttest (src/schemaContract.test.ts):
  // zie api/schemaProbes.ts.
  for (const probe of TABLE_PROBES) {
    const { error } = await db.from(probe.table).select(probe.columns).limit(0);
    if (error) missing.push(`${probe.table}: ${error.message}`);
  }

  // RPC's: een probe met null-args. Bestaat de functie, dan weigert ze de
  // null-input met een eigen exception (≠ ontbreekt); PGRST202 = ontbreekt.
  const RPC_PROBES: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "replace_planning", args: { rows: null } },
    { name: "replace_planning_matrix_rows", args: { rows: null } },
    { name: "replace_planning_and_matrix_periode", args: { matrix_rows: null, shifts: null } },
    { name: "bump_active_sessions", args: { uid: "__schema_probe__", delta: 0 } },
  ];
  for (const probe of RPC_PROBES) {
    const { error } = await db.rpc(probe.name, probe.args);
    if (error && isMissingDbFunction(error)) missing.push(`rpc ${probe.name}: ontbreekt (migratie niet gedraaid?)`);
  }

  // Cron-heartbeats: stale = ouder dan 2× het verwachte interval.
  const now = Date.now();
  const beats = await getCronHeartbeats(["backup", "error-digest", "ocpi-sync", "rooster-meldingen"]);
  const CRON_MAX_AGE_H: Record<string, number> = { backup: 48, "error-digest": 48, "ocpi-sync": 2, "rooster-meldingen": 2 };
  const crons = Object.fromEntries(
    Object.entries(beats).map(([name, last]) => {
      const ageH = last ? (now - Date.parse(last)) / 36e5 : null;
      return [name, { last, stale: ageH === null ? true : ageH > (CRON_MAX_AGE_H[name] ?? 48) }];
    }),
  );

  res.json({ ok: missing.length === 0, missing, crons, time: new Date().toISOString() });
};

export function mountSysteemRoutes(app: express.Express) {
  app.get("/api/health/details", authenticate, requireRole("admin"), async (_req, res) => {
    let supabaseStatus = "not configured";
    const tables: Record<string, string> = {};

    if (supabase) {
      supabaseStatus = "configured";
      const checkTable = async (name: string) => {
        try {
          const { error } = await db!.from(name).select('*').limit(0);
          return error ? `Error: ${error.message}` : "OK";
        } catch (e: any) {
          return `Exception: ${e.message}`;
        }
      };
      tables.users = await checkTable('users');
      tables.planning = await checkTable('planning');
      tables.diversions = await checkTable('diversions');
      tables.services = await checkTable('services');
    }

    res.json({
      status: "ok",
      supabase: supabaseStatus,
      tables,
      // Zonder SMTP-gegevens logt sendEmail de mail alleen naar de console en
      // meldt 'ok' — dan lijkt alles te werken terwijl er niets vertrekt.
      // Daarom hier expliciet zichtbaar, mét de gebruikte afzender.
      smtp: isSmtpConfigured()
        ? { status: "configured", from: process.env.SMTP_FROM || process.env.SMTP_USER || "onbekend", host: process.env.SMTP_HOST || "onbekend" }
        : { status: "not configured", from: null, host: null },
      env: process.env.NODE_ENV,
      time: new Date().toISOString(),
    });
  });

  // Kale POST-echo voor de knop "Schrijftest" in Systeemstatus: bevestigt dat
  // POST-routing door Vercel heen werkt zonder ook maar iets te schrijven.
  // Voorheen wees die knop naar /api/test, een route die nooit heeft bestaan,
  // waardoor de test structureel 404 gaf en een serverprobleem suggereerde.
  app.post("/api/health/echo", authenticate, requireRole("admin"), (req: AuthenticatedRequest, res) => {
    res.json({ status: "ok", ontvangen: typeof req.body === "object" && req.body !== null, time: new Date().toISOString() });
  });

  // Testmail naar de ingelogde admin zelf: de enige manier om te bevestigen dat
  // de SMTP-gegevens écht kloppen. Geeft de rauwe serverfout terug (alleen aan
  // admins) zodat een verkeerd wachtwoord/poort meteen te zien is.
  app.post("/api/admin/test-email", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const to = String(req.appUser?.email || "").trim();
    if (!to) {
      return res.status(400).json({ error: "Je account heeft geen e-mailadres; vul dat eerst in bij Gebruikersbeheer." });
    }
    if (!isSmtpConfigured()) {
      return res.status(400).json({
        error: "SMTP is niet geconfigureerd (SMTP_USER/SMTP_PASS ontbreken). Mails worden nu alleen gelogd, niet verstuurd.",
        smtpConfigured: false,
      });
    }
    const afzender = mailAfzender();
    const { html, text } = mailOpbouw({
      kicker: "Systeem",
      titel: "Testmail van het portaal",
      status: { label: "Mailinstellingen werken", toon: "goed" },
      alineas: ["Deze testmail bevestigt dat het portaal mails kan versturen. Komt ze in je spam-map terecht, controleer dan de domeinverificatie bij de mailprovider."],
      feiten: [
        { label: "Afzender", waarde: afzender.from },
        { label: "Antwoordadres", waarde: afzender.replyTo ?? "geen (niet beantwoorden)" },
        { label: "Verstuurd op", waarde: new Date().toLocaleString("nl-BE", { timeZone: "Europe/Brussels" }) },
      ],
    });
    const result = await sendEmail({
      to: [to],
      subject: "Testmail van het VHB Portaal",
      text,
      html,
      context: "test-email",
      soort: "testmail",
      door: req.appUser?.name ?? null,
    });
    if (!result.ok) {
      return res.status(502).json({ error: result.error || "Verzenden mislukt, controleer host, poort, gebruiker en wachtwoord.", smtpConfigured: true });
    }
    res.json({ success: true, to, message: `Testmail verstuurd naar ${to}. Zie ook je spam-map.` });
  });

  // Schema-drift-detectie: migraties draait Jarno handmatig in de SQL Editor —
  // deze route verifieert ná een deploy dat elke kolom/RPC waar de code op
  // rekent ook écht bestaat (de sessie brak hier al 2× bijna op). Per tabel een
  // select met expliciete kolomnamen (PostgREST valideert die), per RPC een
  // probe-call. Toegang: admin-token of CRON_SECRET (voor een post-deploy curl).
  app.get("/api/health/schema", async (req, res) => {
    if (!isCronAuthorized(req)) {
      // Geen cron-secret → normale admin-auth vereisen.
      return authenticate(req as AuthenticatedRequest, res, () => {
        const role = (req as AuthenticatedRequest).appUser?.role;
        if (role !== "admin") return res.status(403).json({ error: "Alleen voor admins." });
        runSchemaCheck(res).catch((err) => {
          console.error("Schema-check mislukt:", err);
          if (!res.headersSent) res.status(500).json({ ok: false, error: "Schema-check mislukt." });
        });
      });
    }
    runSchemaCheck(res).catch((err) => {
      console.error("Schema-check mislukt:", err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: "Schema-check mislukt." });
    });
  });

  app.get("/api/activity", authenticate, requireRole("admin"), async (req, res) => {
    try {
      // ?window=7d|30d|all — de UI-filters bepalen het venster server-side,
      // zodat "30 dagen"/"Alles" en de CSV-export écht dat venster dekken.
      const window = String(req.query.window || "7d");
      const days = window === "30d" ? 30 : window === "all" ? null : 7;
      const sinceIso = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
      const activity = await getActivityLog({ sinceIso, max: 5000 });
      res.json(activity);
    } catch (err: any) {
      console.error("Activiteit laden is mislukt.", err);
      res.status(500).json({ error: "Activiteit laden is mislukt." });
    }
  });

  // Aanmeldingen (login-events) voor het aanwezigheids-overzicht: wie wanneer
  // op het portaal kwam + per-dag actieve gebruikers. Standaard de laatste 30
  // dagen; ?days= override (1–365).
  app.get("/api/activity/logins", authenticate, requireRole("admin"), async (req, res) => {
    try {
      const reqDays = Number(req.query.days);
      const days = Number.isFinite(reqDays) && reqDays >= 1 && reqDays <= 365 ? Math.floor(reqDays) : 30;
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const logins = await getLoginActivity(sinceIso);
      res.json({ days, logins });
    } catch (err: any) {
      console.error("Aanmeldingen laden is mislukt.", err);
      res.status(500).json({ error: "Aanmeldingen laden is mislukt." });
    }
  });

  // Aanwezigheid: per persoon de periodes waarin hij het portaal in de
  // voorgrond had. Dit is de bron voor "wie was wanneer actief" — het
  // auditlogboek kon die vraag niet beantwoorden (hoogstens één auth-regel per
  // persoon per dag). Admin-only: dit is het meest persoonlijke wat het portaal
  // bijhoudt, zeker sinds elke sessie ook de plaats van aanmelden draagt (stad,
  // regio, land uit het IP-adres; het adres zelf wordt niet bewaard).
  // Standaard 14 dagen; ?days= override (1-90).
  app.get("/api/activity/presence", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const reqDays = Number(req.query.days);
      const days = Number.isFinite(reqDays) && reqDays >= 1 && reqDays <= 90 ? Math.floor(reqDays) : 14;
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const [sessies, users] = await Promise.all([getAanwezigheid(sinceIso), getUsersData()]);
      // Naam en rol komen uit users, niet uit de sessierij: een naamswijziging
      // hoort meteen overal te kloppen. De rol van tóén blijft wel bewaard in
      // de rij zelf en wint, zodat een promotie de geschiedenis niet herschrijft.
      const perId = new Map(users.map((u) => [String(u.id), u]));
      const uit = sessies
        .filter((s) => perId.has(s.userId))
        .map((s) => {
          const u = perId.get(s.userId)!;
          return { userId: s.userId, naam: u.name, rol: s.rol || u.role, van: s.van, tot: s.tot, land: s.land, regio: s.regio, stad: s.stad };
        });
      res.setHeader("Cache-Control", "no-store");
      // Plaats van aanmelden: bestaan de kolommen nog niet, dan draagt geen
      // enkele rij de sleutel. Het scherm toont dan welke migratie nog moet,
      // in plaats van stil overal "onbekend" te zetten. Zonder rijen valt er
      // niets af te leiden en ook niets te tonen.
      const locatieMist = sessies.length > 0 && sessies.every((s) => !s.locatieBekend);
      res.json({ days, sessies: uit, ...(locatieMist ? { locatieMigratie: "supabase/2026-09-20_user_presence_locatie.sql" } : {}) });
    } catch (err: any) {
      if (isMissingTableError(err)) {
        return res.json({ days: 0, sessies: [], migratie: "supabase/2026-09-18_user_presence.sql" });
      }
      console.error("Aanwezigheid laden is mislukt.", err);
      res.status(500).json({ error: "Aanwezigheid laden is mislukt." });
    }
  });

  // Per-entity geschiedenis — toegankelijk voor planner/admin om wijzigingen
  // te traceren per dienst, swap, verlof, etc.
  app.get(
    "/api/activity/:entityType/:entityId",
    authenticate,
    requireRole("planner", "admin"),
    async (req, res) => {
      try {
        const { entityType, entityId } = req.params;
        const allowed = ["user", "service", "diversion", "update", "swap", "leave", "planning_code", "shift"];
        if (!allowed.includes(entityType)) {
          return res.status(400).json({ error: "Onbekend entity-type." });
        }
        const history = await getEntityHistory(entityType as any, entityId);
        res.json(history);
      } catch (err: any) {
        console.error("Geschiedenis laden is mislukt.", err);
        res.status(500).json({ error: "Geschiedenis laden is mislukt." });
      }
  });

  // --- Toestel-whitelist --- → losgetrokken naar api/deviceRoutes.ts
  // (mountDeviceRoutes, hierboven gemount naast mountOcpiRoutes).

  // --- Client-foutmonitoring ---
  // Bewust zónder authenticate: fouten op het loginscherm of bij een verlopen
  // sessie moeten ook binnenkomen. De client dedupet en plafonneert zelf
  // (max 20/sessie); hier kappen we payloads af zodat misbruik niets oplevert.
  // Eigen bodylimiet: de globale 5 MB slaat dit pad over (zie boven). Een
  // foutmelding is hooguit een paar kB (velden worden hieronder afgekapt);
  // groter = misbruik → 413 via de error-handler, zonder dat de 5 MB eerst
  // in het geheugen van een open, ongeauthenticeerde route belandt.
  app.post("/api/client-errors", clientErrorRateLimit, express.json({ limit: "32kb" }), async (req, res) => {
    try {
      const b = req.body ?? {};
      const cut = (v: unknown, max: number) => String(v ?? "").slice(0, max);
      // userId komt van de client en is zonder sessie niet te vertrouwen: met
      // een geldig token overschrijven we hem met de échte gebruiker, anders
      // markeren we hem expliciet als onbevestigd (route blijft bewust open
      // voor fouten vanaf het loginscherm).
      const verifiedUser = await resolveOptionalUser(req);
      const claimedId = cut(b.userId, 80);
      // Context (release/scherm/rol/online/broodkruimels) sinds 06-09: alles
      // afgekapt en gefilterd, het is ongeauthenticeerde invoer. De rol komt
      // bij een geldige sessie van de server, niet van de client.
      const breadcrumbs = Array.isArray(b.breadcrumbs)
        ? b.breadcrumbs.slice(-10).map((k: any) => ({ t: cut(k?.t, 30), soort: cut(k?.soort, 20), tekst: cut(k?.tekst, 120) }))
        : undefined;
      const basis = {
        message: cut(b.message, 1000),
        stack: cut(b.stack, 4000),
        source: cut(b.source, 50),
        url: cut(b.url, 300),
        userAgent: cut(b.userAgent, 300),
        userId: verifiedUser ? verifiedUser.id : claimedId ? `onbevestigd:${claimedId}` : "",
        release: cut(b.release, 40) || undefined,
        view: cut(b.view, 60) || undefined,
        role: verifiedUser ? verifiedUser.role : cut(b.role, 20) || undefined,
        online: typeof b.online === "boolean" ? b.online : undefined,
        breadcrumbs,
      };
      if (!basis.message) {
        return res.status(400).json({ error: "message is verplicht" });
      }
      // Vingerafdruk per oorzaak: top-frame uit de sourcemap (best-effort,
      // gecachet per bundel) + genormaliseerde melding — api/_lib/foutgroepen.ts.
      let topFrame: string | undefined;
      try {
        topFrame = (await symbolicateTopFrame(basis.stack)) ?? undefined;
      } catch { /* symbolicatie mag een rapport nooit tegenhouden */ }
      const entry = { ...basis, topFrame, fingerprint: fingerprintVan({ message: basis.message, source: basis.source, topFrame }) };
      // Vangnet dat altijd werkt: zichtbaar in de Vercel-functielogs.
      console.error("[client-error]", JSON.stringify(entry));
      await logClientError(entry);
      // Korte referentie van de foutgroep terug naar de client: het foutscherm
      // toont hem ("Referentie A7F3C1"), Systeemstatus › Fouten toont dezelfde
      // code bij de groep, zodat een chauffeur hem kan doorgeven (07-09, nr. 6).
      res.json({ ok: true, referentie: referentieVan(entry.fingerprint) });
    } catch {
      // Foutrapportage mag nooit zelf een fout-loop veroorzaken.
      res.status(204).end();
    }
  });

  // CSP-schendingen. De policy stond op Report-Only zónder report-uri: niet
  // afgedwongen én de meldingen kwamen nergens aan, dus effectief geen CSP. Nu
  // hij wél afgedwongen wordt, is dit het vangnet — een geblokkeerde bron
  // verschijnt in de foutendigest i.p.v. stil te falen bij één chauffeur.
  //
  // Browsers posten dit als application/csp-report, dat express.json() niet
  // standaard parseert; vandaar de eigen type-matcher. Bewust open (zoals
  // /api/client-errors) met dezelfde rate-limiter: zo'n rapport komt juist
  // binnen wanneer er iets stuk is, mogelijk nog vóór het inloggen.
  app.post(
    "/api/csp-report",
    express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "64kb" }),
    clientErrorRateLimit,
    async (req, res) => {
      try {
        const r = ((req.body as any)?.["csp-report"] ?? req.body ?? {}) as Record<string, unknown>;
        const cut = (v: unknown, max: number) => String(v ?? "").slice(0, max);
        const geblokkeerd = cut(r["blocked-uri"] ?? r.blockedURL, 300);
        const directive = cut(r["violated-directive"] ?? r.effectiveDirective, 100);
        if (!geblokkeerd && !directive) return res.status(204).end();
        const entry = {
          message: `CSP blokkeerde ${geblokkeerd || "een bron"} (${directive || "onbekende directive"})`,
          stack: cut(r["source-file"] ?? r.sourceFile, 4000),
          source: "csp",
          url: cut(r["document-uri"] ?? r.documentURL, 300),
          userAgent: cut(req.headers["user-agent"], 300),
          userId: "",
        };
        console.error("[csp-report]", JSON.stringify(entry));
        await logClientError(entry);
        res.status(204).end();
      } catch {
        res.status(204).end();
      }
    },
  );

  app.get("/api/client-errors", authenticate, requireRole("admin"), async (req, res) => {
    try {
      if (String(req.query.groepeer ?? "") !== "1") {
        return res.json(await getClientErrors(100));
      }
      // Gegroepeerd per fingerprint (foutgroepen.ts). Statussen komen uit
      // client_error_status; ontbreekt die tabel (migratie niet gedraaid), dan
      // zijn alle groepen 'open' en meldt statusBeschikbaar=false dat de
      // acties nog niet werken. Een 'opgelost' groep die in een andere release
      // terugkwam, is nu weer 'open' — dat schrijven we meteen terug.
      const [rijen, statussen] = await Promise.all([getClientErrors(1000), getClientErrorStatuses()]);
      const { groepen, heropend } = groepeerFouten(rijen, statussen ?? new Map());
      if (statussen) {
        for (const fp of heropend) {
          const vorige = statussen.get(fp);
          try {
            await setClientErrorStatus({ fingerprint: fp, status: "open", release: vorige?.release ?? null, bijgewerktOp: new Date().toISOString(), door: "regressie" });
          } catch { /* best-effort */ }
        }
      }
      res.json({ groepen, statusBeschikbaar: statussen !== null });
    } catch {
      res.json(String(req.query.groepeer ?? "") === "1" ? { groepen: [], statusBeschikbaar: false } : []);
    }
  });

  // Status van een foutgroep zetten (open / opgelost / genegeerd). `release`
  // = de build waarin de admin de fout als opgelost markeert; komt die groep
  // later in een ándere build terug, dan heropent de groepeer-route hem.
  app.post("/api/client-errors/status", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const fingerprint = String(req.body?.fingerprint ?? "").trim();
      const status = String(req.body?.status ?? "") as FoutStatusWaarde;
      if (!/^[0-9a-f]{16}$/.test(fingerprint)) return res.status(400).json({ error: "fingerprint ontbreekt of is ongeldig." });
      if (!FOUT_STATUSSEN.includes(status)) return res.status(400).json({ error: "status moet open, opgelost of genegeerd zijn." });
      const release = String(req.body?.release ?? "").trim().slice(0, 40) || null;
      await setClientErrorStatus({ fingerprint, status, release, bijgewerktOp: new Date().toISOString(), door: String(req.appUser!.id) });
      await logActivity(req, "system", `Foutgroep ${status}`, `${fingerprint}${release ? ` (release ${release})` : ""}.`);
      res.json({ success: true, fingerprint, status });
    } catch (err: any) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De statustabel bestaat nog niet: draai supabase/2026-09-06_client_errors_groepen.sql in de SQL Editor." });
      }
      console.error("Foutstatus opslaan is mislukt.", err);
      res.status(500).json({ error: "Foutstatus opslaan is mislukt." });
    }
  });
}
