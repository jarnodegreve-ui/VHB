import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { getMailLog, logActivity, setAppSetting } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { MAIL_INSTELLINGEN_KEY, MAIL_SOORTEN, MAIL_SOORT_PER_SLEUTEL, isMailAan, mailInstellingenSchema, parseMailInstellingen, verzendlijstenSchema, VERZENDLIJSTEN_KEY } from "../../shared/schemas/mail.js";
import { valideerRecord } from "./valideer.js";
import { getMailInstellingen, getVerzendlijsten, meldMailWijziging } from "./mailInstellingen.js";
import { voorbeeldMail } from "./mailVoorbeelden.js";

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
}
