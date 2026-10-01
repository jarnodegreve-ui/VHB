import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { getAppSetting, logActivity, setAppSetting } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { FILMNUMMERS_KEY, LEGE_FILMNUMMERLIJST, filmnummerTelling, normaliseerFilmnummers, parseFilmnummerLijst, type FilmnummerLijst } from "../../shared/filmnummers.js";
import { filmnummersSchema } from "../../shared/schemas/filmnummers.js";
import { valideerLijst } from "./valideer.js";

/**
 * Filmnummers (01-10): het nummer dat een chauffeur intoetst voor de juiste
 * bestemming op de bus. Eén lijst in app_settings (sleutel `filmnummers`),
 * geen migratie. Lezen mag elke rol; vervangen is admin-werk, net als het
 * ritblad: de import in het scherm stuurt de hele lijst in één keer.
 */
export function mountFilmnummerRoutes(app: express.Express) {
  app.get("/api/filmnummers", authenticate, async (_req, res) => {
    try {
      res.json(parseFilmnummerLijst(await getAppSetting(FILMNUMMERS_KEY)));
    } catch (err) {
      // Zonder instellingen-tabel bestaat er geen lijst. Elke andere fout is
      // een laadfout en geen lege lijst: het scherm houdt dan zijn kopie op het
      // toestel in plaats van die met "nog geen filmnummers" te overschrijven.
      if (isMissingTableError(err)) return res.json(LEGE_FILMNUMMERLIJST);
      console.error("Filmnummers laden is mislukt.", err);
      res.status(500).json({ error: "De filmnummers konden niet laden." });
    }
  });

  app.put("/api/filmnummers", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const invoer = (req.body as { items?: unknown } | null | undefined)?.items;
    if (!Array.isArray(invoer)) {
      return res.status(400).json({ error: "Ongeldige invoer", details: "Stuur de filmnummers als lijst." });
    }
    const rijen = valideerLijst(res, filmnummersSchema, invoer, (r) => String((r as { tekst?: unknown } | null)?.tekst ?? "").trim() || undefined);
    if (!rijen) return;
    try {
      const vorige = parseFilmnummerLijst(await getAppSetting(FILMNUMMERS_KEY));
      const lijst: FilmnummerLijst = { items: normaliseerFilmnummers(rijen), bijgewerktOp: new Date().toISOString() };
      await setAppSetting(FILMNUMMERS_KEY, lijst);
      await logActivity(
        req,
        "planning",
        "Filmnummers bijgewerkt",
        `${filmnummerTelling(lijst.items)}${vorige.items.length > 0 ? `, de vorige lijst telde er ${vorige.items.length}` : ""}.`,
      );
      res.json(lijst);
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De instellingen-tabel bestaat nog niet: draai supabase/2026-07-30_app_settings.sql in de SQL Editor." });
      }
      console.error("Filmnummers opslaan is mislukt.", err);
      res.status(500).json({ error: "Filmnummers opslaan is mislukt." });
    }
  });
}
