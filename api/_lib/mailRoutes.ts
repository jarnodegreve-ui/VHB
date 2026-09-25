import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { getMailLog, getUsersData, logActivity, logMail, setAppSetting } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { EIGEN_MAIL_SOORT, MAIL_INSTELLINGEN_KEY, MAIL_SOORTEN, MAIL_SOORT_PER_SLEUTEL, eigenMailSchema, isMailAan, mailInstellingenSchema, parseMailInstellingen, verzendlijstenSchema, VERZENDLIJSTEN_KEY, type OntvangerGroep } from "../../shared/schemas/mail.js";
import { mailOpbouw, sendEmail } from "../email.js";
import { eigenMailRateLimit } from "../rateLimit.js";
import { valideerRecord } from "./valideer.js";
import { getMailInstellingen, getVerzendlijsten, meldMailWijziging } from "./mailInstellingen.js";
import { voorbeeldMail } from "./mailVoorbeelden.js";

/** Rol per ontvangersgroep; "planning" = planners én admins. */
const GROEP_ROLLEN: Record<OntvangerGroep, readonly string[]> = { chauffeurs: ["chauffeur"], techniekers: ["technieker"], planning: ["planner", "admin"] };

/** Bouwt de eigen mail van een admin: onderwerp als titel, de tekst in
 *  alinea's (witregel = nieuwe alinea, regeleinde blijft), en wie hem stuurde
 *  in de voet. Geen knop: het is een bericht, geen actie. */
export const bouwEigenMail = (o: { onderwerp: string; tekst: string; afzenderNaam: string; antwoordAan?: string }) =>
  mailOpbouw({
    kicker: "Bericht van VHB",
    titel: o.onderwerp,
    alineas: o.tekst.split(/\n{2,}/).map((a) => a.trim()).filter(Boolean),
    voet: o.antwoordAan ? `Verstuurd door ${o.afzenderNaam} via het VHB Portaal. Antwoorden komen bij ${o.afzenderNaam} terecht.` : `Verstuurd door ${o.afzenderNaam} via het VHB Portaal.`,
    nietBeantwoorden: !o.antwoordAan,
  });

/**
 * Beheer › Mails (mailtranche PR 3): alles wat een admin over de mails wil
 * weten en instellen op één adres. Lezen en schrijven alleen voor admins;
 * chauffeurs, techniekers en planners kunnen niets uitzetten (de
 * ontvangerskeuze per mail blijft server-side, zie sendEmail).
 */
const TABEL_ONTBREEKT = { error: "De instellingen-tabel bestaat nog niet: draai supabase/2026-07-30_app_settings.sql in de SQL Editor." };

export function mountMailRoutes(app: express.Express) {
  app.get("/api/mails", authenticate, requireRole("admin"), async (_req, res) => {
    try {
      const [instellingen, verzendlijsten, log] = await Promise.all([getMailInstellingen(), getVerzendlijsten(), getMailLog(300)]);
      // "Laatst verstuurd" per soort: het log staat nieuwste eerst.
      const laatst = new Map<string, { op: string; aantal: number; gelukt: boolean }>();
      for (const r of log) {
        if (!laatst.has(r.soort) && r.gelukt) laatst.set(r.soort, { op: r.verzondenOp, aantal: r.aantal, gelukt: r.gelukt });
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({
        soorten: MAIL_SOORTEN.map((m) => ({ ...m, aan: isMailAan(instellingen, m.soort), laatst: laatst.get(m.soort) ?? null })),
        instellingen,
        verzendlijsten,
        log: log.slice(0, 100),
      });
    } catch (err) {
      console.error("Mails laden is mislukt.", err);
      res.status(500).json({ error: "Gegevens laden is mislukt." });
    }
  });

  app.get("/api/mails/voorbeeld/:soort", authenticate, requireRole("admin"), (req, res) => {
    const soort = String(req.params.soort || "");
    const v = MAIL_SOORT_PER_SLEUTEL.has(soort) ? voorbeeldMail(soort) : null;
    if (!v) return res.status(404).json({ error: "Onbekende mailsoort." });
    res.setHeader("Cache-Control", "no-store");
    res.json(v);
  });

  app.put("/api/mails/instellingen", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, mailInstellingenSchema, req.body ?? {});
    if (!body) return;
    // Alleen uitzetbare, bekende soorten blijven over (parse doet dat).
    const volgende = parseMailInstellingen(body);
    try {
      const vorige = await getMailInstellingen();
      await setAppSetting(MAIL_INSTELLINGEN_KEY, volgende);
      meldMailWijziging();
      const naam = (s: string) => MAIL_SOORT_PER_SLEUTEL.get(s)?.naam ?? s;
      const uitgezet = volgende.uit.filter((s) => !vorige.uit.includes(s)).map(naam);
      const aangezet = vorige.uit.filter((s) => !volgende.uit.includes(s)).map(naam);
      if (uitgezet.length || aangezet.length) {
        await logActivity(req, "system", "Mailinstellingen gewijzigd", [uitgezet.length ? `Uit: ${uitgezet.join(", ")}.` : "", aangezet.length ? `Aan: ${aangezet.join(", ")}.` : ""].filter(Boolean).join(" "));
      }
      res.json(volgende);
    } catch (err) {
      if (isMissingTableError(err)) return res.status(503).json(TABEL_ONTBREEKT);
      console.error("Mailinstellingen opslaan is mislukt.", err);
      res.status(500).json({ error: "Instelling opslaan is mislukt." });
    }
  });

  app.put("/api/mails/verzendlijsten", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, verzendlijstenSchema, req.body);
    if (!body) return;
    try {
      const vorige = await getVerzendlijsten();
      await setAppSetting(VERZENDLIJSTEN_KEY, body);
      meldMailWijziging();
      const namenVorige = new Set(vorige.map((l) => l.id));
      const namenNu = new Set(body.map((l) => l.id));
      const nieuw = body.filter((l) => !namenVorige.has(l.id)).map((l) => l.naam);
      const weg = vorige.filter((l) => !namenNu.has(l.id)).map((l) => l.naam);
      const gewijzigd = body.filter((l) => namenVorige.has(l.id) && JSON.stringify(vorige.find((v) => v.id === l.id)) !== JSON.stringify(l)).map((l) => l.naam);
      const delen = [nieuw.length ? `Nieuw: ${nieuw.join(", ")}.` : "", gewijzigd.length ? `Gewijzigd: ${gewijzigd.join(", ")}.` : "", weg.length ? `Verwijderd: ${weg.join(", ")}.` : ""].filter(Boolean);
      if (delen.length) await logActivity(req, "system", "Verzendlijsten gewijzigd", delen.join(" "));
      res.json(body);
    } catch (err) {
      if (isMissingTableError(err)) return res.status(503).json(TABEL_ONTBREEKT);
      console.error("Verzendlijsten opslaan is mislukt.", err);
      res.status(500).json({ error: "Verzendlijsten opslaan is mislukt." });
    }
  });

  // Zelf een mail sturen (PR 5, alleen admin). De ontvangers worden altijd
  // server-side uit de keuze afgeleid (groepen, verzendlijsten, bestaande
  // gebruikers, vrije adressen), ontdubbeld op adres. `droog` = alleen tonen
  // wie hem krijgt en hoe hij eruitziet; de echte verzending gaat één mail
  // per persoon (niemand ziet elkaars adres) en laat één logregel achter.
  app.post("/api/mails/eigen", authenticate, requireRole("admin"), eigenMailRateLimit, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, eigenMailSchema, req.body ?? {});
    if (!body) return;
    try {
      const [users, lijsten] = await Promise.all([getUsersData(), getVerzendlijsten()]);
      const actief = users.filter((u) => u.isActive !== false && u.email);
      const ontvangers = new Map<string, { adres: string; naam: string }>();
      const voeg = (adres: string | undefined, naam: string) => {
        const a = String(adres ?? "").trim().toLowerCase();
        if (a && !ontvangers.has(a)) ontvangers.set(a, { adres: a, naam });
      };
      for (const groep of body.ontvangers.groepen) {
        for (const u of actief) if (GROEP_ROLLEN[groep].includes(u.role)) voeg(u.email, u.name);
      }
      const onbekendeLijsten = body.ontvangers.lijsten.filter((id) => !lijsten.some((l) => l.id === id));
      if (onbekendeLijsten.length > 0) return res.status(400).json({ error: "Een gekozen verzendlijst bestaat niet meer; ververs het scherm." });
      for (const id of body.ontvangers.lijsten) {
        const lijst = lijsten.find((l) => l.id === id)!;
        for (const adres of lijst.adressen) voeg(adres, lijst.naam);
      }
      for (const id of body.ontvangers.gebruikers) {
        const u = actief.find((x) => String(x.id) === id);
        if (u) voeg(u.email, u.name);
      }
      for (const adres of body.ontvangers.adressen) voeg(adres, adres);
      const lijst = [...ontvangers.values()];
      if (lijst.length === 0) return res.status(400).json({ error: "Kies minstens één ontvanger met een e-mailadres." });

      const afzenderNaam = req.appUser?.name || "VHB";
      const antwoordAan = String(req.appUser?.email ?? "").trim() || undefined;
      const { html, text } = bouwEigenMail({ onderwerp: body.onderwerp, tekst: body.tekst, afzenderNaam, antwoordAan });
      if (body.droog) {
        return res.json({ droog: true, aantal: lijst.length, ontvangers: lijst, onderwerp: body.onderwerp, html });
      }

      let gelukt = 0;
      let mocked = false;
      const fouten: string[] = [];
      for (const o of lijst) {
        const r = await sendEmail({ to: [o.adres], subject: body.onderwerp, text, html, context: `eigen-mail:${req.appUser?.id ?? ""}`, soort: EIGEN_MAIL_SOORT, door: afzenderNaam, replyTo: antwoordAan, zonderLog: true });
        if (r.ok) gelukt += 1; else fouten.push(o.adres);
        if (r.mocked) mocked = true;
      }
      await logMail({ soort: EIGEN_MAIL_SOORT, aantal: lijst.length, gelukt: fouten.length === 0 && !mocked, fout: mocked ? "SMTP niet geconfigureerd, mail alleen gelogd" : fouten.length ? `${fouten.length} van ${lijst.length} mislukt` : null, door: afzenderNaam });
      await logActivity(req, "system", "Eigen mail verstuurd", `"${body.onderwerp}" naar ${lijst.length} ontvanger${lijst.length === 1 ? "" : "s"}${fouten.length ? `, ${fouten.length} mislukt` : ""}${mocked ? " (alleen gelogd, geen SMTP)" : ""}.`);
      res.json({ droog: false, aantal: lijst.length, gelukt, mislukt: fouten.length, mocked });
    } catch (err) {
      console.error("Eigen mail versturen is mislukt.", err);
      res.status(500).json({ error: "Versturen is mislukt." });
    }
  });
}
