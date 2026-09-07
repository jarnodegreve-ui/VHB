import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { logActivity, setAppSetting } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { onderhoudBodySchema, type OnderhoudPubliek } from "../../shared/schemas/onderhoud.js";
import { valideerRecord } from "./valideer.js";
import { getOnderhoud, invalidateOnderhoudCache } from "./onderhoud.js";
import { ONDERHOUD_SETTING_KEY } from "./onderhoudRegels.js";

/**
 * Onderhoudsmodus (verbeterronde 07-09, nr. 4): lezen voor iedereen die
 * ingelogd is, een publieke variant voor het loginscherm, schrijven alleen
 * voor admins. Het schrijfblok zelf zit in authenticate (middleware.ts).
 */
export function mountOnderhoudRoutes(app: express.Express) {
  // Loginscherm (geen sessie): alleen actief + tekst, niets over het
  // schrijfblok of het tijdstip. Valt onder de anonieme rate-limit van
  // rateLimitMiddleware (per IP), zoals de andere open routes.
  app.get("/api/onderhoud/publiek", async (_req, res) => {
    const o = await getOnderhoud();
    const publiek: OnderhoudPubliek = { actief: o.actief, tekst: o.tekst };
    res.setHeader("Cache-Control", "no-store");
    res.json(publiek);
  });

  app.get("/api/onderhoud", authenticate, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getOnderhoud());
  });

  app.put("/api/onderhoud", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, onderhoudBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const vorige = await getOnderhoud();
      await setAppSetting(ONDERHOUD_SETTING_KEY, body);
      invalidateOnderhoudCache();
      // Activity-log alleen bij een échte omslag (aan/uit of schrijfblok);
      // een tekstcorrectie is geen gebeurtenis voor de historiek.
      if (vorige.actief !== body.actief || (body.actief && vorige.schrijfblok !== body.schrijfblok)) {
        await logActivity(
          req,
          "system",
          body.actief ? "Onderhoudsmodus aangezet" : "Onderhoudsmodus uitgezet",
          body.actief
            ? `${body.schrijfblok ? "Schrijfacties gepauzeerd voor iedereen behalve beheerders." : "Alleen een banner, alles blijft werken."}${body.tekst ? ` Tekst: ${body.tekst}` : ""}`
            : "Banner weg, alles werkt weer normaal.",
        );
      }
      res.json(body);
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De instellingen-tabel bestaat nog niet: draai supabase/2026-07-30_app_settings.sql in de SQL Editor." });
      }
      console.error("Onderhoudsinstelling opslaan is mislukt.", err);
      res.status(500).json({ error: "Instelling opslaan is mislukt." });
    }
  });
}
