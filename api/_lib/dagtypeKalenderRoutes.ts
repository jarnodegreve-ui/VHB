import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import type { AuthenticatedRequest } from "../types.js";
import { DAG_DMJ } from "../helpers.js";
import { DAGTYPE_KALENDER_MIGRATIE, getDagtypeKalender, getPlanningMatrixRows, logActivity, schrijfDagtypeKalender } from "../storage.js";
import { isDagtypeCode } from "../../shared/dagtype.js";
import { samenvatting } from "../../shared/dagtypeKalender.js";
import { dagtypeKalenderBodySchema } from "../../shared/schemas/dagtypeKalender.js";
import { ISO_DAY_RE } from "./collectie.js";
import { valideerRecord } from "./valideer.js";

/**
 * Dagtypekalender (11-10): het De Lijn-dagtype en het verlofmaximum per dag,
 * uit het CSV van Jarno. Lezen mag de staf (het scherm), schrijven is
 * admin-werk. De kalender wint nooit van de code in de planningsmatrix
 * (keuze Jarno): een verschil komt als opmerking terug in `afwijkingen`.
 */

/** Dagen waar de planningsmatrix een ándere bekende code draagt dan de kalender. */
const afwijkingenMetMatrix = (
  dagen: ReadonlyArray<{ datum: string; typedag: string }>,
  matrix: ReadonlyArray<{ source_date?: unknown; day_type?: unknown }>,
): Array<{ datum: string; matrix: string; kalender: string }> => {
  const perDag = new Map(dagen.map((d) => [d.datum, d.typedag]));
  const uit: Array<{ datum: string; matrix: string; kalender: string }> = [];
  for (const r of matrix) {
    const datum = String(r.source_date ?? "").slice(0, 10);
    const code = String(r.day_type ?? "").trim();
    const kalender = perDag.get(datum);
    if (kalender && isDagtypeCode(code) && code !== kalender) uit.push({ datum, matrix: code, kalender });
  }
  return uit.sort((a, b) => a.datum.localeCompare(b.datum));
};

export function mountDagtypeKalenderRoutes(app: express.Express) {
  app.get("/api/dagtypekalender", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const van = typeof req.query.van === "string" && ISO_DAY_RE.test(req.query.van) ? req.query.van : undefined;
      const tot = typeof req.query.tot === "string" && ISO_DAY_RE.test(req.query.tot) ? req.query.tot : undefined;
      // De hele kalender is klein (één rij per dag): één lezing, het venster
      // en de samenvatting komen daaruit.
      const [alle, matrix] = await Promise.all([getDagtypeKalender(), getPlanningMatrixRows(van && tot ? { van, tot } : undefined)]);
      const dagen = alle.filter((d) => (!van || d.datum >= van) && (!tot || d.datum <= tot));
      res.json({
        dagen,
        afwijkingen: afwijkingenMetMatrix(alle, matrix as any[]),
        samenvatting: samenvatting(alle),
      });
    } catch (err) {
      console.error("Dagtypekalender laden is mislukt.", err);
      res.status(500).json({ error: "De dagtypekalender kon niet laden." });
    }
  });

  app.put("/api/dagtypekalender", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, dagtypeKalenderBodySchema, req.body);
    if (!body) return;
    // Eén rij per datum (de eerste telt, zoals kalenderUitRijen): een upsert
    // met twee keer dezelfde datum in één batch weigert de databank.
    const perDatum = new Map<string, (typeof body.dagen)[number]>();
    for (const d of body.dagen) if (!perDatum.has(d.datum)) perDatum.set(d.datum, d);
    const dagen = [...perDatum.values()].sort((a, b) => a.datum.localeCompare(b.datum));
    try {
      const vorige = new Map((await getDagtypeKalender()).map((d) => [d.datum, d]));
      let nieuw = 0;
      let gewijzigd = 0;
      for (const d of dagen) {
        const v = vorige.get(d.datum);
        if (!v) nieuw += 1;
        else if (v.typedag !== d.typedag || v.maxVerlof !== d.maxVerlof) gewijzigd += 1;
      }
      const aantal = await schrijfDagtypeKalender(dagen, "csv");
      const na = samenvatting(await getDagtypeKalender());
      const eerste = dagen[0].datum;
      const laatste = dagen[dagen.length - 1].datum;
      await logActivity(
        req,
        "planning",
        "Dagtypekalender bijgewerkt",
        `${aantal} dagen ingelezen (${DAG_DMJ(eerste)} t/m ${DAG_DMJ(laatste)}): ${nieuw} nieuw, ${gewijzigd} gewijzigd. De kalender telt nu ${na.aantal} dagen.`,
      );
      res.json({ aantal, nieuw, gewijzigd, samenvatting: na });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: `De tabel dagtype_kalender bestaat nog niet: draai ${DAGTYPE_KALENDER_MIGRATIE} in de SQL Editor.` });
      }
      console.error("Dagtypekalender opslaan is mislukt.", err);
      res.status(500).json({ error: "De dagtypekalender opslaan is mislukt." });
    }
  });
}
