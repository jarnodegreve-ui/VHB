import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { getAppSetting, logActivity, setAppSetting } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { mededelingSchema } from "../../shared/schemas/mededeling.js";
import { MEDEDELING_SETTING_KEY, parseMededeling, type Mededeling } from "../../shared/mededeling.js";
import { DAG_DMJ } from "../helpers.js";
import { valideerRecord } from "./valideer.js";

/**
 * Mededeling voor de chauffeurs (08-10, vraag Jarno): een geheugensteuntje
 * dat de beheerder aanzet ("Opgelet, vanaf 11/12 nieuwe dienstregeling!")
 * en dat als rustige strook op Ritbladen, Mijn dag en het dashboard staat.
 * Lezen voor iedereen die ingelogd is, schrijven alleen voor admins. Eén
 * app_settings-sleutel; of ze te zien is beslist de client met
 * mededelingZichtbaar (aan, tekst, einddag niet voorbij).
 */
export const getMededeling = async (): Promise<Mededeling> => parseMededeling(await getAppSetting(MEDEDELING_SETTING_KEY));

export function mountMededelingRoutes(app: express.Express) {
  app.get("/api/mededeling", authenticate, async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getMededeling());
    } catch (err) {
      if (isMissingTableError(err)) return res.json(parseMededeling(null));
      console.error("Mededeling lezen is mislukt.", err);
      res.status(500).json({ error: "Kon de mededeling niet lezen." });
    }
  });

  app.put("/api/mededeling", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, mededelingSchema, req.body ?? {});
    if (!body) return;
    const nieuw: Mededeling = { tekst: body.tekst, tonen: body.tonen, tot: body.tot ?? null };
    try {
      const vorige = await getMededeling();
      await setAppSetting(MEDEDELING_SETTING_KEY, nieuw);
      // Logregel bij een omslag of een andere tekst terwijl ze aanstaat; een
      // tekstcorrectie van een uitgezette mededeling is geen gebeurtenis.
      if (vorige.tonen !== nieuw.tonen || (nieuw.tonen && (vorige.tekst !== nieuw.tekst || vorige.tot !== nieuw.tot))) {
        await logActivity(
          req,
          "system",
          nieuw.tonen ? "Mededeling voor de chauffeurs aangezet" : "Mededeling voor de chauffeurs uitgezet",
          nieuw.tonen ? `“${nieuw.tekst}”${nieuw.tot ? `, tot en met ${DAG_DMJ(nieuw.tot)}` : ""}.` : "De strook op Ritbladen, Mijn dag en het dashboard is weg.",
        );
      }
      res.json(nieuw);
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De instellingen-tabel bestaat nog niet: draai supabase/2026-07-30_app_settings.sql in de SQL Editor." });
      }
      console.error("Mededeling opslaan is mislukt.", err);
      res.status(500).json({ error: "Mededeling opslaan is mislukt." });
    }
  });
}
