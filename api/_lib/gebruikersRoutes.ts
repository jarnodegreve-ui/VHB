/**
 * Gebruikers: collectie- en per-record-routes, vervaldata, wachtwoord- en
 * MFA-reset, en uitnodigen voor het portaal.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import type { AppUser, AppUserIntern, AuthenticatedRequest, IncomingUser } from "../types.js";
import { supabaseAdmin } from "../db.js";
import { isStafRol, authenticate, requireRole } from "../middleware.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { uitnodigenSchema, userBodySchema, userLijstSchema, wachtwoordResetSchema } from "../../shared/schemas/user.js";
import { valideerLijst, valideerRecord } from "./valideer.js";
import { userRecordRevisionOf, withRecordRevision, requestedRecordRevision, verwerkUsersOpslag, trekToegangIn, type ToegangIngetrokken } from "./recordWrites.js";
import { DAG_DMJ, brusselsDay, normalizeEmail, toRoleScopedUser, sanitizeIncomingUser, countAdmins, EXPIRY_SOORT_LABEL } from "../helpers.js";
import { bouwUitnodigingMail, portalUrl } from "../email.js";
import { reeksAntwoord, verstuurMailReeks } from "./mailReeks.js";
import { uitnodigenRateLimit, uitnodigingOpenenRateLimit } from "../rateLimit.js";
import { OPEN_REDEN_TEKST, UITNODIGING_SOORT, kiesOntvangers, maakUitnodiging, openUitnodiging, rondUitnodigingAf, uitnodigingenPerGebruiker, zetUitnodigingTerug } from "./uitnodiging.js";
import { UITNODIGING_GELDIG_DAGEN, UITNODIGING_HASH, beschrijfOvergeslagen, leesUitnodigingCode } from "../../shared/uitnodiging.js";
import { getUsersCached } from "../userCache.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { isIsoDag } from "../../shared/rapporten/periode.js";
import { getUsersData, EmailInGebruikError, MigratieOntbreektError, logActivity, getUserExpiries, saveUserExpiry, deleteUserExpiry } from "../storage.js";
import { COLLECTION_REVISION_HEADER, detectMassDelete, isPlainRecord, massDeleteResponse, newRecordId, recordConflictResponse, recordRevisionMissingResponse, revisionCheck, revisionOf, revisionProbleemResponse } from "./collectie.js";

/** Revisie van de gebruikerslijst ZONDER de sessie-velden. lastLogin en
 *  activeSessions muteren bij elke login/logout — server-side, buiten
 *  gebruikersbeheer om — en zaten mee in de hash: vrijwel elke admin-save
 *  overdag kreeg zo een valse 409 "gewijzigd door iemand anders"
 *  (controle-ronde 27-08). De velden zelf zijn ook geen beheer-invoer meer:
 *  saveUsersData houdt de DB-waarde aan. */
const usersRevisionOf = (users: AppUser[]): string =>
  revisionOf(users.map((user) => ({ ...user, lastLogin: undefined, activeSessions: undefined })));

// Veldvalidatie (naam, e-mail, wachtwoordminimum, …) zit in het gedeelde
// contract: userBodySchema via valideerRecord → 400 met veldfouten.
/** Zelfde vangrail als saveUsersData, maar als nette 400 i.p.v. een 500. */
const laatsteAdminVerdwijnt = (users: IncomingUser[]) => countAdmins(users.map(sanitizeIncomingUser)) === 0;

const emailInGebruik = (users: AppUser[], email: string | undefined, eigenId: string) =>
  !!email && users.some((u) => String(u.id) !== eigenId && normalizeEmail(u.email) === email);

const userResponseRecord = async (id: string) => {
  const user = (await getUsersData()).find((u) => String(u.id) === id);
  return user ? withRecordRevision(user, userRecordRevisionOf(user)) : null;
};

export function mountGebruikersRoutes(app: express.Express) {
  // --- Uitnodigen voor het portaal (30-09) ---
  // Waarom een eigen link van zeven dagen, en wanneer een link werkt: zie
  // api/_lib/uitnodiging.ts. Scherm: Gebruikers (rijmenu en bulkbalk);
  // landing: src/app/UitnodigingScherm.tsx.

  // De lopende uitnodiging per gebruiker ("Uitgenodigd …" onder "Nooit").
  app.get("/api/users/uitnodigingen", authenticate, requireRole("admin"), async (_req, res) => {
    try {
      if (!supabaseAdmin) return res.json({ uitnodigingen: [] });
      res.json({ uitnodigingen: await uitnodigingenPerGebruiker((await getUsersData()) as AppUserIntern[]) });
    } catch (err) {
      console.error("Uitnodigingen laden is mislukt.", err);
      res.status(500).json({ error: "Uitnodigingen laden is mislukt." });
    }
  });

  // Uitnodigen: `droog` = voorbeeld en ontvangers (er wordt niets aangemaakt),
  // anders per persoon een nieuwe link en een eigen mail, via de gedeelde
  // reeks (verzendlog, tijdsbudget, `alleen` = de rest na een deels mislukte
  // verzending). Wie niet kan (al ingelogd, gepauzeerd, geen adres) staat in
  // `nietUitgenodigd`; niet in `overgeslagen`, want dat veld van de reeks
  // betekent "mailsoort staat uit" en het scherm leest het zo (mailUitkomst.ts).
  app.post("/api/users/uitnodigen", authenticate, requireRole("admin"), uitnodigenRateLimit, async (req: AuthenticatedRequest, res) => {
    const gestartOp = Date.now();
    const body = valideerRecord(res, uitnodigenSchema, req.body ?? {});
    if (!body) return;
    try {
      if (!supabaseAdmin) return res.status(503).json({ error: "Uitnodigen kan niet: de service-role van Supabase ontbreekt." });
      const { ontvangers, overgeslagen: nietUitgenodigd } = kiesOntvangers((await getUsersData()) as AppUserIntern[], body.ids);
      const alleen = body.alleen ? new Set(body.alleen) : null;
      const lijst = alleen ? ontvangers.filter((o) => alleen.has(o.adres)) : ontvangers;
      if (lijst.length === 0) {
        const waarom = alleen
          ? "Geen van de resterende adressen kan nog uitgenodigd worden; ververs de lijst."
          : nietUitgenodigd.length > 0
            ? `Niemand om uit te nodigen: ${beschrijfOvergeslagen(nietUitgenodigd)}.`
            : "Deze gebruikers bestaan niet meer; ververs de lijst.";
        return res.status(400).json({ error: waarom, nietUitgenodigd });
      }
      if (body.droog) {
        // De echte bouwer met de eerste ontvanger; de link is een attrap.
        const eerste = lijst[0]!;
        const { html } = bouwUitnodigingMail({
          naam: eerste.naam,
          email: eerste.adres,
          link: `${portalUrl().replace(/\/+$/, "")}/${UITNODIGING_HASH}voorbeeld`,
          geldigTot: new Date(gestartOp + UITNODIGING_GELDIG_DAGEN * 86_400_000).toISOString(),
        });
        return res.json({ droog: true, aantal: lijst.length, ontvangers: lijst.map(({ adres, naam }) => ({ adres, naam })), html, nietUitgenodigd });
      }

      const perAdres = new Map(lijst.map((o) => [o.adres, o]));
      const gemaakt = new Map<string, { op: string; tot: string; vorige: unknown }>();
      const uitkomst = await verstuurMailReeks({
        soort: UITNODIGING_SOORT,
        door: req.appUser!.name,
        context: `uitnodiging:${req.appUser!.id}`,
        ontvangers: lijst,
        gestartOp,
        perOntvanger: async ({ adres }) => {
          const o = perAdres.get(adres)!;
          const u = await maakUitnodiging(o);
          gemaakt.set(o.userId, { op: u.op, tot: u.tot, vorige: u.vorige });
          return bouwUitnodigingMail({ naam: o.naam, email: o.adres, link: u.link, geldigTot: u.tot });
        },
      });

      // Zeker niet vertrokken: de vorige uitnodiging terug (of geen), anders
      // staat er "Uitgenodigd" bij iemand die niets kreeg en werkt een
      // eerdere, nog geldige link niet meer. Onzeker blijft staan.
      const resterend = new Set(uitkomst.resterend);
      await Promise.all(lijst
        .filter((o) => resterend.has(o.adres) && gemaakt.has(o.userId))
        .map((o) => zetUitnodigingTerug(o.authId, gemaakt.get(o.userId)!.vorige).catch((err) => console.error("Vorige uitnodiging terugzetten na een mislukte mail is mislukt.", err))));

      // Eén logregel per uitgenodigde, tegelijk: na een reeks van tot 52 s
      // moet het antwoord nog binnen de 60 s van de functie vertrekken.
      const onzeker = new Set(uitkomst.onzekerAdressen);
      const uitgenodigd = lijst.filter((o) => gemaakt.has(o.userId) && !resterend.has(o.adres) && !onzeker.has(o.adres));
      await Promise.all(uitgenodigd.map((o) => logActivity(
        req,
        "users",
        "Uitnodiging verstuurd",
        `${o.naam}: uitnodiging voor het portaal, link geldig tot ${DAG_DMJ(brusselsDay(gemaakt.get(o.userId)!.tot))}${uitkomst.mocked ? " (alleen gelogd, geen SMTP)" : ""}.`,
        { type: "user", id: o.userId },
      ).catch((err) => console.error("Logboekregel van de uitnodiging is mislukt.", err))));
      res.json({
        ...reeksAntwoord(uitkomst),
        uitgenodigd: uitgenodigd.map((o) => ({ userId: o.userId, op: gemaakt.get(o.userId)!.op, tot: gemaakt.get(o.userId)!.tot })),
        nietUitgenodigd,
      });
    } catch (err) {
      console.error("Uitnodigen is mislukt.", err);
      res.status(500).json({ error: "Uitnodigen is mislukt." });
    }
  });

  // Een uitnodiging openen vanuit de mail, en afronden zodra het wachtwoord
  // gekozen is. Publiek: de genodigde heeft nog geen wachtwoord; de code is
  // het bewijs. Eerst de vorm van de code (niets lezen voor rommel), dan de
  // gecachte gebruikers, zoals de auth-middleware.
  const ongeldigeCode = (res: express.Response) => res.status(410).json({ reden: "ongeldig", error: OPEN_REDEN_TEKST.ongeldig });
  app.post("/api/uitnodiging/openen", uitnodigingOpenenRateLimit, async (req, res) => {
    try {
      if (!supabaseAdmin) return res.status(503).json({ error: "Uitnodigingen werken nu niet. Probeer het later opnieuw." });
      if (!leesUitnodigingCode(req.body?.code)) return ongeldigeCode(res);
      const uitkomst = await openUitnodiging(req.body.code, (await getUsersCached()) as AppUserIntern[]);
      if (!uitkomst.ok) return res.status(410).json({ reden: uitkomst.reden, error: OPEN_REDEN_TEKST[uitkomst.reden] });
      res.json({ naam: uitkomst.naam, email: uitkomst.email, tokenHash: uitkomst.tokenHash });
    } catch (err) {
      console.error("Uitnodiging openen is mislukt.", err);
      res.status(500).json({ error: "De uitnodiging kon niet geopend worden. Probeer het zo meteen opnieuw." });
    }
  });

  // Het wachtwoord is gekozen: de link is vanaf nu geen herstellink meer,
  // ook als lastLogin leeg blijft (toestel wacht op goedkeuring).
  app.post("/api/uitnodiging/afronden", uitnodigingOpenenRateLimit, async (req, res) => {
    try {
      if (!supabaseAdmin) return res.status(503).json({ error: "Uitnodigingen werken nu niet. Probeer het later opnieuw." });
      if (!leesUitnodigingCode(req.body?.code)) return ongeldigeCode(res);
      const uitkomst = await rondUitnodigingAf(req.body.code, (await getUsersCached()) as AppUserIntern[]);
      if (!uitkomst.ok) return res.status(410).json({ reden: uitkomst.reden, error: OPEN_REDEN_TEKST[uitkomst.reden] });
      res.json({ success: true });
    } catch (err) {
      console.error("Uitnodiging afronden is mislukt.", err);
      res.status(500).json({ error: "Afronden is mislukt." });
    }
  });

  // Admin: twee-stapsverificatie van een collega resetten (telefoon kwijt).
  // Verwijdert alle TOTP-factoren in Supabase Auth; bij de volgende aanmelding
  // schrijft de collega zich opnieuw in.
  app.post("/api/admin/users/:id/mfa-reset", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!supabaseAdmin) return res.status(503).json({ error: "Service-role niet geconfigureerd." });
      const id = String(req.params.id ?? "");
      const target = ((await getUsersData()) as AppUserIntern[]).find((u) => String(u.id) === id);
      if (!target) return res.status(404).json({ error: "Gebruiker niet gevonden." });
      if (!target.authId) return res.status(409).json({ error: "Deze gebruiker heeft nog geen gekoppelde aanmelding." });
      const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: target.authId });
      if (error) throw error;
      let verwijderd = 0;
      for (const factor of data?.factors ?? []) {
        const { error: delErr } = await supabaseAdmin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.authId });
        if (delErr) throw delErr;
        verwijderd += 1;
      }
      await logActivity(req, "users", "Twee-stapsverificatie gereset", `${target.name}: ${verwijderd} ${verwijderd === 1 ? "factor" : "factoren"} verwijderd door ${req.appUser!.name}.`, { type: "user", id });
      res.json({ success: true, verwijderd });
    } catch (err) {
      console.error("MFA-reset mislukt:", err);
      res.status(500).json({ error: "Twee-stapsverificatie resetten is mislukt." });
    }
  });

  app.post("/api/admin/users/reset-password", authenticate, requireRole("admin"), async (req, res) => {
    try {
      // Eerst de invoer (zelfde schema als het formulier): een te kort
      // wachtwoord is een 400 met de fout bij het veld, ook zonder service-role.
      const invoer = valideerRecord(res, wachtwoordResetSchema, {
        userId: req.body?.userId == null ? "" : String(req.body.userId),
        password: req.body?.password,
      });
      if (!invoer) return;
      const { userId, password } = invoer;

      if (!supabaseAdmin) {
        return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
      }

      const users = await getUsersData();
      const targetUser = users.find((user) => String(user.id) === userId);
      if (!targetUser?.email) {
        return res.status(404).json({ error: "Gebruiker met e-mailadres niet gevonden." });
      }

      const { data: authPage, error: authListError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (authListError) throw authListError;

      // Expliciete cast: Vercel's function-builder typeert authPage.users soms
      // als never[] (striktere TS/supabase-types dan lokaal/CI) → bouwfout. De
      // cast maakt de vorm versie-onafhankelijk.
      const authUsers = (authPage?.users ?? []) as Array<{ id: string; email?: string | null }>;
      const authUser = authUsers.find((user) => normalizeEmail(user.email) === normalizeEmail(targetUser.email));
      if (!authUser) {
        return res.status(404).json({ error: "Geen gekoppeld auth-account gevonden." });
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password });
      if (error) throw error;

      await logActivity(req, "auth", "Wachtwoord gereset", `Wachtwoord opnieuw ingesteld voor ${targetUser.name}.`, { type: "user", id: targetUser.id });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Wachtwoord reset mislukt.", error);
      res.status(500).json({ error: "Wachtwoord reset mislukt." });
    }
  });

  // De verloftype-labels (LEAVE_TYPE_LABEL) wonen sinds de consolidatie in
  // helpers.ts, naast de drift-test tegen de bewuste client-kopie in
  // src/lib/format.ts.

  // --- Vervaldata: Code 95 / medische schifting per chauffeur ---
  // Beheer door planner/admin; een chauffeur ziet alleen zijn eigen datums.
  // De dagelijkse digest-cron waarschuwt op 90/30/7/0 dagen (zie error-digest).
  app.get("/api/user-expiries", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const alle = await getUserExpiries();
      // Alleen bewaakte soorten: rijbewijs is er uit (07-08) en eventuele oude
      // rijen in user_expiries mogen niet alsnog in de lijsten opduiken. De
      // rijen zelf blijven in de DB staan — geen dataverlies.
      const bewaakt = alle.filter((e) => Boolean(EXPIRY_SOORT_LABEL[e.soort]));
      const eigen = isStafRol(req.appUser!.role) ? bewaakt : bewaakt.filter((e) => e.userId === String(req.appUser!.id));
      res.json(eigen.map((e) => ({ userId: e.userId, soort: e.soort, validUntil: e.validUntil })));
    } catch (err) {
      console.error("Error reading user expiries:", err);
      res.status(500).json({ error: "Kon vervaldata niet lezen." });
    }
  });

  app.put("/api/user-expiries", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.body?.userId ?? "").trim();
      const soort = String(req.body?.soort ?? "").trim();
      // Lege datum = verwijderen (datum onbekend/niet van toepassing).
      const rauw = req.body?.validUntil;
      const validUntil = rauw === null || rauw === undefined || String(rauw).trim() === "" ? null : String(rauw).trim();
      if (!EXPIRY_SOORT_LABEL[soort]) {
        return res.status(400).json({ error: "Onbekende soort vervaldatum." });
      }
      // Echte kalenderdag, niet alleen het patroon (2026-02-30 kwam erdoor).
      if (validUntil !== null && !isIsoDag(validUntil)) {
        return res.status(400).json({ error: "Ongeldige datum." });
      }
      const users = await getUsersData();
      const user = users.find((u: any) => String(u.id) === userId);
      if (!user) {
        return res.status(404).json({ error: "Gebruiker niet gevonden." });
      }
      const label = EXPIRY_SOORT_LABEL[soort];
      if (validUntil === null) {
        await deleteUserExpiry(userId, soort);
      } else {
        await saveUserExpiry({ userId, soort, validUntil, updatedBy: String(req.appUser?.id ?? "") || null });
      }
      await logActivity(
        req,
        "users",
        validUntil ? "Vervaldatum bijgewerkt" : "Vervaldatum verwijderd",
        `${user.name}: ${label}${validUntil ? ` geldig tot ${DAG_DMJ(validUntil)}` : ", datum verwijderd"}.`,
        { type: "user", id: userId },
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Error saving user expiry:", err);
      res.status(500).json({ error: "Kon vervaldatum niet opslaan." });
    }
  });

  app.get("/api/users", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const users = await getUsersData();
      // Revisie over de volledige serverstaat (niet de role-scoped weergave):
      // opaque token, hoeft enkel consistent te zijn met de POST-vergelijking.
      res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(users));
      // `_rev` per record (hash over de volledige serverstaat, zonder sessie-
      // velden): de client stuurt hem terug bij PUT/DELETE /api/users/:id.
      res.json(users.map((user) => withRecordRevision(toRoleScopedUser(user, req.appUser!.role, req.appUser!.id), userRecordRevisionOf(user))));
    } catch (err) {
      console.error("Error reading users data:", err);
      res.status(500).json({ error: "Gegevens laden is mislukt." });
    }
  });

  app.post("/api/users", authenticate, requireRole("admin"), async (req, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        // Gedeeld contract (shared/schemas/user.ts) — o.a. het wachtwoord-
        // minimum, dat ooit alleen in de UI stond (controle-ronde 27-08,
        // bevinding 32). 400 met veldfouten per rij; de data zelf gaat
        // ongewijzigd door (sanitizeIncomingUser normaliseert al).
        if (!valideerLijst(res, userLijstSchema, newData, (u: any) => u?.name)) return;
        const previousUsers = await getUsersData();
        // Revisie-check: twee admin-sessies die tegelijk bewerken overschreven
        // elkaar anders stil — en saveUsersData doet onomkeerbare Auth-deletes.
        { const rp = revisionCheck(req, previousUsers, usersRevisionOf); if (rp) return revisionProbleemResponse(res, "De gebruikerslijst", rp); }
        const usersRemoved = detectMassDelete(previousUsers, newData);
        if (usersRemoved !== null) return massDeleteResponse(res, usersRemoved, previousUsers.length, "gebruikers");
        // Bijwerkingen (Auth + welkomstmail, onthaal-docs, documenten opruimen,
        // audit, cache) zitten in de gedeelde schrijfkern — zelfde pad als de
        // per-record-routes hieronder.
        const { createdAccounts } = await verwerkUsersOpslag(req as AuthenticatedRequest, previousUsers, newData);

        res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
        res.json({ success: true, count: newData.length, welcomed: (createdAccounts ?? []).length });
      } else {
        res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      }
    } catch (err: any) {
      if (err instanceof EmailInGebruikError) return res.status(409).json({ error: err.message, conflict: "email" });
      // "Ook technieker" aangezet vóór de migratie: 503 met het .sql-bestand.
      if (err instanceof MigratieOntbreektError) return res.status(503).json({ error: err.message });
      const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error("Error saving users data:", errorMessage);
      console.error("Opslaan is mislukt.", errorMessage);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  app.post("/api/users/one", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const body = req.body;
      if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één gebruiker verwacht." });
      if (!valideerRecord(res, userBodySchema, body)) return;
      const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : newRecordId();
      const previousUsers = await getUsersData();
      if (previousUsers.some((u) => String(u.id) === id)) {
        return res.status(409).json({ error: "Er bestaat al een gebruiker met dit id.", conflict: "exists" });
      }
      const email = normalizeEmail(typeof body.email === "string" ? body.email : undefined);
      if (emailInGebruik(previousUsers, email, id)) return res.status(409).json({ error: `E-mailadres ${email} is al in gebruik.`, conflict: "email" });
      const record = { ...body, id } as IncomingUser;
      await verwerkUsersOpslag(req, previousUsers, [...previousUsers, record], { samenvatting: false });
      res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
      res.status(201).json({ success: true, user: await userResponseRecord(id) });
    } catch (err: any) {
      // Het adres hoort in Supabase Auth al bij een ánder account (de
      // users-tabel-check hierboven ziet dat niet) — 409, geen stille herkoppeling.
      if (err instanceof EmailInGebruikError) return res.status(409).json({ error: err.message, conflict: "email" });
      if (err instanceof MigratieOntbreektError) return res.status(503).json({ error: err.message });
      console.error("Gebruiker toevoegen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  app.put("/api/users/:id", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const body = req.body;
      if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één gebruiker verwacht." });
      if (!valideerRecord(res, userBodySchema, body)) return;
      const rev = requestedRecordRevision(req);
      if (!rev) return recordRevisionMissingResponse(res);
      const previousUsers = await getUsersData();
      const current = previousUsers.find((u) => String(u.id) === id);
      if (!current) return res.status(404).json({ error: "Gebruiker niet gevonden, mogelijk intussen verwijderd." });
      if (rev !== userRecordRevisionOf(current)) return recordConflictResponse(res, "Deze gebruiker", withRecordRevision(current, userRecordRevisionOf(current)));
      const email = normalizeEmail(typeof body.email === "string" ? body.email : undefined);
      if (emailInGebruik(previousUsers, email, id)) return res.status(409).json({ error: `E-mailadres ${email} is al in gebruik.`, conflict: "email" });
      const record = { ...body, id } as IncomingUser;
      const newData = previousUsers.map((u) => (String(u.id) === id ? record : u));
      if (laatsteAdminVerdwijnt(newData)) return res.status(400).json({ error: "Er moet minstens 1 actieve admin overblijven." });
      await verwerkUsersOpslag(req, previousUsers, newData, { samenvatting: false });
      res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
      res.json({ success: true, user: await userResponseRecord(id) });
    } catch (err: any) {
      if (err instanceof EmailInGebruikError) return res.status(409).json({ error: err.message, conflict: "email" });
      if (err instanceof MigratieOntbreektError) return res.status(503).json({ error: err.message });
      console.error("Gebruiker opslaan is mislukt.", err?.message || err);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  app.delete("/api/users/:id", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      // Jezelf verwijderen blijft geblokkeerd (de UI beschermt dit ook).
      if (id === String(req.appUser!.id)) return res.status(403).json({ error: "Je kunt je eigen account niet verwijderen." });
      const rev = requestedRecordRevision(req);
      if (!rev) return recordRevisionMissingResponse(res);
      const previousUsers = await getUsersData();
      const current = previousUsers.find((u) => String(u.id) === id);
      if (!current) return res.status(404).json({ error: "Gebruiker niet gevonden, mogelijk al verwijderd." });
      if (rev !== userRecordRevisionOf(current)) return recordConflictResponse(res, "Deze gebruiker", withRecordRevision(current, userRecordRevisionOf(current)));
      const newData = previousUsers.filter((u) => String(u.id) !== id);
      if (laatsteAdminVerdwijnt(newData)) return res.status(400).json({ error: "Er moet minstens 1 actieve admin overblijven." });
      await verwerkUsersOpslag(req, previousUsers, newData, { samenvatting: false });
      res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Gebruiker verwijderen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Verwijderen is mislukt." });
    }
  });

  // Uit dienst in één handeling (verbeterronde 07-09, nr. 1): deactiveren via
  // dezelfde schrijfkern als de per-record-routes (revisie/activity/Auth-ban),
  // dan alle toestellen intrekken en de push-abonnementen wissen. Elke stap is
  // best-effort en wordt gerapporteerd; nogmaals aanroepen op een al inactieve
  // gebruiker geeft 200 met nullen. De agenda-feed vervalt vanzelf bij
  // isActive=false; lopende Supabase-sessies stoppen door de ban uiterlijk bij
  // tokenverloop (er is geen per-gebruiker signOut zonder diens token).
  app.post("/api/users/:id/uitdienst", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      if (id === String(req.appUser!.id)) return res.status(400).json({ error: "Je kunt jezelf niet uit dienst zetten." });
      const reden = typeof req.body?.reden === "string" ? req.body.reden.trim().slice(0, 200) : "";
      const previousUsers = await getUsersData();
      const current = previousUsers.find((u) => String(u.id) === id);
      if (!current) return res.status(404).json({ error: "Gebruiker niet gevonden, mogelijk intussen verwijderd." });
      const wasActief = current.isActive !== false;
      const stappen: Array<{ stap: string; ok: boolean; detail: string }> = [];

      // (1) Deactiveren, alleen als de gebruiker nog actief is. De schrijfkern
      // trekt bij de overgang actief → inactief zelf toestellen en push in
      // (trekToegangIn, zelfde pad als PUT /api/users/:id); een al inactieve
      // gebruiker krijgt die intrekking hier alsnog (herhaalbaar, geeft nullen).
      let intrek: ToegangIngetrokken;
      if (wasActief) {
        const newData = previousUsers.map((u) => (String(u.id) === id ? { ...u, isActive: false } : u));
        if (laatsteAdminVerdwijnt(newData)) return res.status(400).json({ error: "Er moet minstens 1 actieve admin overblijven." });
        try {
          const resultaat = await verwerkUsersOpslag(req, previousUsers, newData, { samenvatting: false });
          intrek = resultaat.ingetrokken[id] ?? (await trekToegangIn(id));
          stappen.push({ stap: "deactiveren", ok: true, detail: "Account gedeactiveerd en Auth-account geblokkeerd." });
        } catch (err: any) {
          // Zonder deactivering heeft de rest geen zin: de gebruiker kan nog
          // inloggen en toestellen opnieuw registreren.
          console.error("Uit dienst: deactiveren is mislukt.", err?.message || err);
          return res.status(500).json({ error: "Deactiveren is mislukt.", stappen: [{ stap: "deactiveren", ok: false, detail: String(err?.message || err) }] });
        }
      } else {
        stappen.push({ stap: "deactiveren", ok: true, detail: "Account was al gedeactiveerd." });
        intrek = await trekToegangIn(id);
      }

      // (2) Toestellen intrekken.
      const toestellen = intrek.toestellen;
      if (intrek.fouten.includes("toestellen")) stappen.push({ stap: "toestellen", ok: false, detail: "Toestellen intrekken is mislukt." });
      else stappen.push({ stap: "toestellen", ok: true, detail: `${toestellen} toestel${toestellen === 1 ? "" : "len"} ingetrokken.` });

      // (3) Push-abonnementen wissen.
      const push = intrek.push;
      if (intrek.fouten.includes("push")) stappen.push({ stap: "push", ok: false, detail: "Push-abonnementen wissen is mislukt." });
      else stappen.push({ stap: "push", ok: true, detail: `${push} push-abonnement${push === 1 ? "" : "en"} gewist.` });

      // (4) Sessies: de ban uit stap 1 blokkeert nieuwe logins en token-
      // refreshes; lopende access-tokens verlopen vanzelf (max. 1 uur).
      stappen.push({ stap: "sessies", ok: true, detail: "Auth-account geblokkeerd, lopende sessies stoppen bij tokenverloop." });

      // (5) Eén samenvattende auditregel.
      await logActivity(
        req,
        "users",
        "Uit dienst",
        `${current.name}: account ${wasActief ? "gedeactiveerd" : "was al gedeactiveerd"}, ${toestellen} toestel${toestellen === 1 ? "" : "len"} ingetrokken, ${push} push-abonnement${push === 1 ? "" : "en"} gewist.${reden ? ` Reden: ${reden}.` : ""}`,
        { type: "user", id },
      );

      res.setHeader(COLLECTION_REVISION_HEADER, usersRevisionOf(await getUsersData()));
      res.json({
        user: await userResponseRecord(id),
        samenvatting: { toestellen, push, sessies: "gebannen" },
        stappen,
      });
    } catch (err: any) {
      console.error("Uit dienst zetten is mislukt.", err?.message || err);
      res.status(500).json({ error: "Uit dienst zetten is mislukt." });
    }
  });
}
