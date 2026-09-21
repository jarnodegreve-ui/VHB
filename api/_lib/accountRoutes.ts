/**
 * Account: /api/me, sessie, voorkeuren, push-abonnementen, meldingen en de
 * agenda-feed.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import crypto from "node:crypto";
import { buildCalendar, type IcsEvent } from "../../shared/ics.js";
import { getVapidPublicKey, savePushSubscription, deletePushSubscriptionForUser, getUsersMetPush } from "../push.js";
import type { AppUser, AuthenticatedRequest } from "../types.js";
import { isStafRol, mfaStafVerplicht, authenticate, requireRole, isDeviceGateEnabled, DEVICE_TOKEN_HEADER } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { isSafeExternalHttpsUrl } from "../ocpi.js";
import { getDeviceCached } from "./deviceCache.js";
import { invalidateUsersCache } from "../userCache.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { meldingenGelezenBodySchema, meldingenVerwijderBodySchema } from "../../shared/schemas/meldingen.js";
import { meVoorkeurenBodySchema, pasVoorkeurenPatchToe } from "../../shared/schemas/dashboardVoorkeuren.js";
import { valideerRecord } from "./valideer.js";
import { afwezigOp } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getLatestAuthEventAt, getLeaveData, getPlanningData, getUsersData, logActivity, updateUserSessionMeta, bumpActiveSessions, getPlanningNotes, getMeldingen, telOngelezenMeldingen, markeerMeldingenGelezen, verwijderMeldingen, updateUserDashboardVoorkeuren, getRecentLogins } from "../storage.js";
import { isPlainRecord } from "./collectie.js";

// === Agenda-abonnement (.ics-feed) =========================================
// Chauffeurs abonneren hun diensten in Google/Apple Agenda via een
// persoonlijke, token-beveiligde URL die de agenda-app periodiek ophaalt
// (auto-update). De token is een HMAC over het user-id met een server-
// secret — stateless, geen DB-kolom nodig. De feed bevat enkel de eigen
// diensten (geen gevoelige data), maar behandel de URL als privé.
// Bewust GEEN anon-key in de fallback-keten: die zit publiek in de
// frontend-bundle en zou token-forging mogelijk maken zodra de service-
// role-key ontbreekt. Ook GEEN hardcoded fallback-secret meer (stond in de
// publieke repo → tokens waren forgebaar zodra beide env-vars ontbraken):
// zonder secret is de feed gewoon uitgeschakeld (fail-closed).
// GEEN terugval meer op SUPABASE_SERVICE_ROLE_KEY. Die terugval maakte de
// service-role-key tot ondertekensleutel van elke agenda-feed: één gelekte
// feed-URL intrekken zou betekenen dat je de sleutel van je hele database
// roteert. Nu fail-closed op een eigen secret — staat CALENDAR_FEED_SECRET
// niet in de env, dan is de feed simpelweg uit (en meldt /api/health dat).
const CAL_SECRET = process.env.CALENDAR_FEED_SECRET || null;

const calendarToken = (userId: string) => {
  if (!CAL_SECRET) return null;
  return crypto.createHmac("sha256", CAL_SECRET).update(`calendar:${userId}`).digest("hex");
};

const verifyCalendarToken = (userId: string, token: string) => {
  const expected = calendarToken(userId);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function mountAccountRoutes(app: express.Express) {
  // Eigen profiel + wat de app vóór de eerste inhoud moet weten (punt 19,
  // 15-09): het toestel-oordeel en, voor staf, de beveiligingsstatus. Zo kan
  // de client de toestelregistratie parallel starten i.p.v. ervóór, en hoeft
  // staf /api/me/beveiliging niet meer apart te wachten. De route blijft
  // gewoon achter de toestel-gate (middleware): een wachtend of geblokkeerd
  // toestel krijgt hier nog steeds 403 device_pending/device_revoked, precies
  // zoals voorheen; `toestel` beschrijft het toestel dat de gate al doorliet
  // (of 'onbekend': staf zonder rij, of schakelaar uit).
  //
  // Vorm: { ...profiel, toestel: { status, gateActief }, beveiliging?: { mfaVerplicht, aal } }.
  app.get("/api/me", authenticate, async (req: AuthenticatedRequest, res) => {
    const user = req.appUser!;
    const staf = isStafRol(user.role);
    const rawToken = String(req.headers[DEVICE_TOKEN_HEADER] ?? "").trim();
    const deviceToken = rawToken.length > 0 && rawToken.length <= 100 ? rawToken : "";
    let toestel: { status: "approved" | "pending" | "revoked" | "onbekend"; gateActief: boolean } = { status: "onbekend", gateActief: false };
    try {
      // Het toestel dat de gate al opzocht (req.device) hergebruiken; alleen
      // wanneer de gate niet keek (staf zonder token, ontbrekende tabel) zelf
      // opzoeken, via dezelfde korte cache.
      const [device, gateActief] = await Promise.all([
        req.device !== undefined
          ? Promise.resolve(req.device)
          : deviceToken ? getDeviceCached(String(user.id), deviceToken) : Promise.resolve(null),
        isDeviceGateEnabled(),
      ]);
      toestel = { status: device?.status ?? "onbekend", gateActief };
    } catch (err) {
      // Informatief veld: een ontbrekende tabel of DB-hik mag het profiel niet
      // blokkeren (de gate zelf heeft al beslist).
      if (!isMissingTableError(err)) console.error("Toestel-oordeel bij /api/me mislukt:", err);
    }
    res.json({
      ...user,
      toestel,
      ...(staf ? { beveiliging: { mfaVerplicht: mfaStafVerplicht(), aal: req.aal ?? "aal1" } } : {}),
    });
  });

  // Instellingen › Beveiliging + de pre-app-beslissing "moet deze staf-gebruiker
  // nu een code invoeren of zich inschrijven?". MFA-exempt (zie middleware):
  // dit is juist de route die vóór de code gelezen wordt.
  app.get("/api/me/beveiliging", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.appUser!;
      const staf = isStafRol(user.role);
      const aanmeldingen = await getRecentLogins(String(user.id));
      res.json({ staf, mfaVerplicht: staf && mfaStafVerplicht(), aal: req.aal ?? "aal1", aanmeldingen });
    } catch (err) {
      console.error("Beveiligingsoverzicht mislukt:", err);
      res.status(500).json({ error: "Beveiligingsoverzicht kon niet geladen worden." });
    }
  });

  app.post("/api/auth/session", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const action = req.body?.action;
      const currentUser = req.appUser;

      if (!currentUser || (action !== "start" && action !== "end" && action !== "resume")) {
        return res.status(400).json({ error: "Ongeldige sessieactie." });
      }

      // Dit pad is device-gate-exempt (login/logout moet kunnen vóór goed-
      // keuring), maar dat mag géén PII-luik zijn: op een niet-goedgekeurd
      // toestel geen volledig profiel (telefoon/mail/verlofBudget) teruggeven
      // en niets in het aanwezigheidslog schrijven — anders "ziet" de admin
      // een chauffeur actief terwijl het een buitenstaander met gestolen
      // inloggegevens is. Ontbrekende device-tabel = fail-open (zelfde regel
      // als de middleware-gate).
      let deviceApproved = true;
      if (!isStafRol(currentUser.role)) {
        const rawToken = String(req.headers["x-device-token"] ?? "").trim();
        const deviceToken = rawToken.length > 0 && rawToken.length <= 100 ? rawToken : "";
        try {
          // Exempt-pad: de gate zocht hier niets op, dus req.device is er
          // normaal niet. De lookup gaat wel via dezelfde korte cache als de
          // gate (zelfde venster, gewist bij elke toestelwijziging).
          const device = req.device !== undefined
            ? req.device
            : deviceToken ? await getDeviceCached(String(currentUser.id), deviceToken) : null;
          deviceApproved = device?.status === "approved";
        } catch (err) {
          deviceApproved = isMissingTableError(err);
        }
      }
      if (!deviceApproved) {
        // Minimaal antwoord dat de login-flow niet breekt (id+role+naam), maar
        // zonder contactgegevens of saldi; geen teller-/log-boekhouding.
        return res.json({ id: currentUser.id, name: currentUser.name, role: currentUser.role });
      }

      // 'resume' = app geopend met een nog geldige sessie (PWA-herstel, geen
      // nieuwe login). Zonder dit event was zo'n gebruiker onzichtbaar in
      // "Actieve gebruikers per dag" — de grafiek telde alleen wie opnieuw
      // moest inloggen. Max. één 'Actief'-event per gebruiker per dag; raakt
      // de sessieteller niet aan. lastLogin wél: dat is "Laatst actief" in
      // Gebruikers, en zonder deze update bleef die dagen achter op wat
      // Activiteit toonde (15-09). Hooguit één schrijf per 5 minuten.
      if (action === "resume") {
        const nu = new Date().toISOString();
        // Tot 18-09 werd hier een 'Actief'-regel in het auditlogboek gezet,
        // gededupliceerd op de Brusselse kalenderdag. Dat was de enige bron voor
        // "wie was vandaag actief", en meteen ook de reden dat die vraag nooit
        // goed te beantwoorden was: hoogstens één regel per persoon per dag, dus
        // alleen het éérste moment, en niets meer zodra de PWA warm bleef staan.
        // Aanwezigheid komt nu uit public.user_presence, bijgehouden in de
        // auth-middleware bij élk geauthenticeerd verzoek (gethrottled). Dit pad
        // houdt alleen nog lastLogin bij ("Laatst actief" in Gebruikers); dat
        // scheelt hier ook een DB-lezing per hervatting.
        const vorige = currentUser.lastLogin ? new Date(currentUser.lastLogin).getTime() : NaN;
        if (!(Date.now() - vorige < 5 * 60 * 1000)) {
          await updateUserSessionMeta(String(currentUser.id), { lastLogin: nu });
          return res.json({ ...currentUser, lastLogin: nu });
        }
        return res.json(currentUser);
      }

      // Teller atomair bijwerken (RPC) i.p.v. read-modify-write op de gecachte
      // waarde — anders telt het mis bij ~gelijktijdig in/uitloggen.
      // ISO opslaan (was een nl-BE-string in UTC-servertijd → stond 1-2u fout
      // en sorteerde niet); de client formatteert naar Belgische tijd.
      const lastLogin = action === "start" ? new Date().toISOString() : currentUser.lastLogin;
      if (action === "start") {
        // Drie onafhankelijke DB-trips tegelijk i.p.v. na elkaar (ronde 3): de
        // teller (RPC op activesessions), lastLogin (eigen kolom) en de lezing
        // van het laatste auth-event raken elkaar niet. De logregel hieronder
        // volgt pas daarna, want die hangt van de lezing af.
        const [, , latestAuthEventAt] = await Promise.all([
          bumpActiveSessions(String(currentUser.id), 1),
          updateUserSessionMeta(String(currentUser.id), { lastLogin }),
          getLatestAuthEventAt(String(currentUser.id)),
        ]);
        // Login-event vastleggen: lastLogin wordt overschreven, maar de
        // activiteitenlog bewaart elke aanmelding apart → historiek "wie wanneer"
        // + basis voor het per-dag-actieve-gebruikers-overzicht. Dedup binnen
        // 10 minuten: 'start' is anders onbeperkt herhaalbaar en daarmee was
        // het aanwezigheidslog te vervuilen (controle-ronde #31); een échte
        // her-login binnen 10 min verliest hooguit één historiekregel.
        const tenMinAgo = Date.now() - 10 * 60 * 1000;
        if (!latestAuthEventAt || new Date(latestAuthEventAt).getTime() < tenMinAgo) {
          await logActivity(req, "auth", "Aangemeld", `${currentUser.name} meldde zich aan.`, { type: "user", id: String(currentUser.id) });
        }
      } else {
        await bumpActiveSessions(String(currentUser.id), -1);
      }
      // Optimistische teller in de respons (exact-genoeg voor weergave; de
      // DB-waarde is gezaghebbend en nu wél race-vrij).
      const nextUser: AppUser = {
        ...currentUser,
        lastLogin,
        activeSessions: action === "start"
          ? (currentUser.activeSessions || 0) + 1
          : Math.max(0, (currentUser.activeSessions || 1) - 1),
      };
      res.json(nextUser);
    } catch (error: any) {
      console.error("Kon sessie niet bijwerken.", error);
      res.status(500).json({ error: "Kon sessie niet bijwerken." });
    }
  });

  // Persoonlijke abonnee-links voor de ingelogde gebruiker.
  app.get("/api/calendar-url", authenticate, async (req: AuthenticatedRequest, res) => {
    const u = req.appUser;
    if (!u) return res.status(401).json({ error: "Niet aangemeld." });
    const userId = String(u.id);
    const token = calendarToken(userId);
    if (!token) return res.status(503).json({ error: "Agenda-feed is niet geconfigureerd op de server." });
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    const feedPath = `/api/calendar/${encodeURIComponent(userId)}/${token}.ics`;
    const url = `${proto}://${host}${feedPath}`;
    const webcal = `webcal://${host}${feedPath}`;
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    res.json({ url, webcal, googleUrl });
  });

  // De feed zelf — GEEN bearer-auth (agenda-apps sturen geen headers); de
  // token in de URL authenticeert. Geeft text/calendar terug.
  app.get("/api/calendar/:userId/:token", async (req, res) => {
    try {
      const userId = String(req.params.userId || "");
      const token = String(req.params.token || "").replace(/\.ics$/i, "");
      if (!userId || !verifyCalendarToken(userId, token)) {
        return res.status(404).send("Not found");
      }
      const [shifts, users, leave] = await Promise.all([
        getPlanningData({ driverId: userId }),
        getUsersData(),
        getLeaveData(),
      ]);
      const user = users.find((u: any) => String(u.id) === userId);
      // Gedeactiveerde/verwijderde medewerkers verliezen hun feed (de token
      // is stateless en kan niet ingetrokken worden — dit is de check).
      if (!user || user.isActive === false) {
        return res.status(404).send("Not found");
      }
      // Dienstnotities meesturen in de agenda-beschrijving (best-effort:
      // zonder tabel gewoon geen notities).
      let noteByDate = new Map<string, string>();
      try {
        const dates = (shifts as any[]).map((s) => String(s.date)).sort();
        if (dates.length > 0) {
          const notes = await getPlanningNotes({ fromIso: dates[0], toIso: dates[dates.length - 1], driverId: userId });
          noteByDate = new Map(notes.map((n) => [n.date, n.note]));
        }
      } catch { /* notities zijn nice-to-have in de feed */ }
      // Rijen zonder tijden overslaan: de 00:00-fallback werd door de
      // eind≤start-regel van buildVevent een 24-uursblok in de agenda.
      // Diensten binnen een goedgekeurde afwezigheid overslaan: wie ziek
      // gemeld is, hoort geen agenda-melding voor die dienst te krijgen —
      // de hele-dag-gebeurtenis hieronder dekt die dag al.
      const events: IcsEvent[] = (shifts as any[])
        .filter((s) => s.startTime && s.endTime && !afwezigOp(leave as any[], userId, String(s.date)))
        .map((s) => ({
        uid: `vhb-shift-${s.id}@vhb-portaal`,
        date: String(s.date),
        startTime: String(s.startTime),
        endTime: String(s.endTime),
        summary: `Dienst ${String(s.line || s.serviceNumber || "").trim()}`.trim(),
        description: [s.busNumber && `Bus ${s.busNumber}`, s.loopnr && `Loop ${s.loopnr}`, noteByDate.get(String(s.date)) && `Notitie: ${noteByDate.get(String(s.date))}`]
          .filter(Boolean)
          .join(" · ") || undefined,
      }));
      // Goedgekeurd verlof/ziekte als hele-dag-gebeurtenissen — zo is de agenda
      // compleet (dienst + afwezigheid) i.p.v. alleen de diensten.
      const leaveLabel: Record<string, string> = { betaald_verlof: "Verlof", klein_verlet: "Klein verlet", ziekte: "Ziek" };
      for (const l of leave as any[]) {
        if (String(l.userId) !== userId || l.status !== "approved") continue;
        events.push({
          uid: `vhb-leave-${l.id}@vhb-portaal`,
          date: String(l.startDate),
          endDate: String(l.endDate || l.startDate),
          startTime: "00:00",
          endTime: "00:00",
          allDay: true,
          summary: leaveLabel[l.type] ?? "Afwezig",
          // Bewust ZONDER l.comment: dat is vrije tekst met de reden (ziekte,
          // overlijden, familiale situatie). De feed-URL is stateless en niet
          // in te trekken, en wie 'm in Google Agenda zet, laat Google die
          // tekst periodiek ophalen en bewaren. Het type-label volstaat.
        });
      }
      const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const calName = user?.name ? `VHB Diensten, ${user.name}` : "VHB Diensten";
      const ics = buildCalendar(events, { calName, dtstamp });
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="vhb-diensten.ics"');
      res.setHeader("Cache-Control", "no-cache, max-age=0");
      res.send(ics);
    } catch (err) {
      console.error("Error building calendar feed:", err);
      res.status(500).send("error");
    }
  });

  // --- Push-notificaties ---
  app.get("/api/push/public-key", authenticate, (_req, res) => {
    // null = push staat uit (geen VAPID-keys geconfigureerd) — de client
    // verbergt de meldingen-knop dan.
    res.json({ publicKey: getVapidPublicKey() });
  });

  app.post("/api/push/subscribe", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const sub = req.body;
      const endpoint = String(sub?.endpoint ?? "");
      const p256dh = String(sub?.keys?.p256dh ?? "");
      const auth = String(sub?.keys?.auth ?? "");
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ error: "Ongeldig push-abonnement." });
      }
      // Het endpoint wordt later server-side aangeroepen door webpush.sendNotification
      // (en de digest-cron). Zonder deze check kon een geauthenticeerde gebruiker
      // een intern/loopback/metadata-adres opslaan en de server dat laten fetchen
      // (blinde SSRF). Alleen https naar een publieke host toestaan — een echt
      // push-endpoint (FCM/Mozilla/WNS/Apple) voldoet daar altijd aan.
      if (!isSafeExternalHttpsUrl(endpoint)) {
        return res.status(400).json({ error: "Ongeldig push-endpoint." });
      }
      await savePushSubscription({ userId: String(req.appUser!.id), endpoint, p256dh, auth });
      res.json({ success: true });
    } catch (err: any) {
      console.error("Abonneren mislukt", err);
      res.status(500).json({ error: "Abonneren mislukt" });
    }
  });

  // Wie kán meldingen ontvangen? Voedt de badge in Gebruikersbeheer; tijdens de
  // uitrol is dat het verschil tussen "hij reageert niet" en "hij krijgt niets".
  // Alleen gebruikers-ids, en alleen voor planner/admin.
  app.get("/api/push/subscribers", authenticate, requireRole("planner", "admin"), async (_req: AuthenticatedRequest, res) => {
    try {
      res.json({ userIds: await getUsersMetPush() });
    } catch (err) {
      console.error("Push-abonnees lezen mislukt", err);
      res.status(500).json({ error: "Kon niet ophalen wie meldingen aan heeft staan." });
    }
  });

  app.post("/api/push/unsubscribe", authenticate, async (req: AuthenticatedRequest, res) => {
    const endpoint = String(req.body?.endpoint ?? "");
    if (!endpoint) return res.status(400).json({ error: "endpoint is verplicht" });
    // Alleen je eigen abonnement mag je afmelden (geen IDOR op andermans endpoint).
    await deletePushSubscriptionForUser(endpoint, String(req.appUser!.id));
    res.json({ success: true });
  });

  // --- Meldingencentrum (2026-09-06_meldingen.sql) ---
  // Elke push die de API verstuurt (sendPushToUsers) staat óók als rij in
  // public.meldingen — ook voor wie geen push-abonnement heeft. De app toont
  // de eigen rijen onder /meldingen (bel in de topbar) en luistert via
  // Realtime op de eigen user_id. Zonder migratie: lege lijst, geen crash.
  app.get("/api/meldingen", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.appUser!.id);
      const [meldingen, ongelezen] = await Promise.all([getMeldingen(userId, 100), telOngelezenMeldingen(userId)]);
      res.json({ meldingen, ongelezen });
    } catch (err) {
      if (isMissingTableError(err)) return res.json({ meldingen: [], ongelezen: 0, migratie: "2026-09-06_meldingen.sql" });
      console.error("Meldingen laden is mislukt.", err);
      res.status(500).json({ error: "Meldingen laden is mislukt." });
    }
  });

  // Gelezen markeren: { ids: [...] } voor een selectie, zonder ids = alles.
  // Altijd op de eigen rijen gescoped (user_id in de query), dus andermans
  // ids doen niets.
  app.post("/api/meldingen/gelezen", authenticate, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, meldingenGelezenBodySchema, isPlainRecord(req.body) ? req.body : {});
    if (!body) return;
    try {
      const gelezen = await markeerMeldingenGelezen(String(req.appUser!.id), body.ids);
      res.json({ success: true, gelezen });
    } catch (err) {
      if (isMissingTableError(err)) return res.status(503).json({ error: "De meldingen-tabel bestaat nog niet: draai supabase/2026-09-06_meldingen.sql in de SQL Editor." });
      console.error("Meldingen gelezen markeren is mislukt.", err);
      res.status(500).json({ error: "Meldingen bijwerken is mislukt." });
    }
  });

  // Verwijderen: { ids: [...] }. Altijd op de eigen rijen gescoped (user_id in
  // de query), dus andermans ids doen niets. Bewust geen "alles wissen": een
  // melding weg is weg, dus gaat het per stuk (met ongedaan maken in de app).
  app.delete("/api/meldingen", authenticate, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, meldingenVerwijderBodySchema, isPlainRecord(req.body) ? req.body : {});
    if (!body) return;
    try {
      const verwijderd = await verwijderMeldingen(String(req.appUser!.id), body.ids);
      res.json({ success: true, verwijderd });
    } catch (err) {
      if (isMissingTableError(err)) return res.status(503).json({ error: "De meldingen-tabel bestaat nog niet: draai supabase/2026-09-06_meldingen.sql in de SQL Editor." });
      console.error("Meldingen verwijderen is mislukt.", err);
      res.status(500).json({ error: "Meldingen verwijderen is mislukt." });
    }
  });

  // --- Eigen voorkeuren (dashboardindeling, startscherm, meldingssoorten) ---
  // Alleen het eigen profiel; de jsonb-kolom users.dashboardvoorkeuren komt
  // via toPublicUser terug in /api/me (niet in /api/users — persoonlijke
  // UI-staat). Ongeldige body → 400 (zod, shared/schemas/dashboardVoorkeuren).
  // De body is een deelwijziging: het dashboard stuurt de tegel-sleutels,
  // Instellingen het startscherm of de meldingssoorten; hier voegen we samen
  // met wat er al staat (punt 15, 15-09), zodat het ene scherm de voorkeur van
  // het andere niet overschrijft. `null` wist een optionele voorkeur.
  app.patch("/api/me/voorkeuren", authenticate, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, meVoorkeurenBodySchema, req.body);
    if (!body) return;
    try {
      // req.appUser komt uit de gebruikerscache, die bij elke save hieronder
      // geleegd wordt; opeenvolgende PATCHes zien dus elkaars resultaat.
      const nieuw = pasVoorkeurenPatchToe(req.appUser!.dashboardVoorkeuren, body.dashboard);
      await updateUserDashboardVoorkeuren(String(req.appUser!.id), nieuw);
      // Het profiel zit in de auth-cache (userCache.ts): anders gaf /api/me
      // tot 30 s de oude indeling terug.
      invalidateUsersCache();
      res.json({ success: true, dashboardVoorkeuren: nieuw });
    } catch (err: any) {
      const msg = String(err?.message ?? "").toLowerCase();
      if (isMissingTableError(err) || err?.code === "PGRST204" || /dashboardvoorkeuren/.test(msg)) {
        return res.status(503).json({ error: "De kolom users.dashboardvoorkeuren bestaat nog niet: draai supabase/2026-09-06_meldingen.sql in de SQL Editor." });
      }
      console.error("Voorkeuren opslaan is mislukt.", err);
      res.status(500).json({ error: "Voorkeuren opslaan is mislukt." });
    }
  });
}
