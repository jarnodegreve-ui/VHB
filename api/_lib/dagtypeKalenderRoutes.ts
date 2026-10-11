import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import type { AuthenticatedRequest } from "../types.js";
import { addDagenIso, brusselsDay, DAG_DMJ } from "../helpers.js";
import { DAGTYPE_KALENDER_MIGRATIE, getDagtypeKalender, getPlanningMatrixRows, laadDagtypeKalender, logActivity, schrijfDagtypeKalender } from "../storage.js";
import { dagtypeLabel, dagtypePeriode, dagtypeVanDag, isDagtypeCode } from "../../shared/dagtype.js";
import { samenvatting } from "../../shared/dagtypeKalender.js";
import { isIsoDag } from "../../shared/rapporten/periode.js";
import { dagtypeKalenderBodySchema, dagtypeKalenderDagWijzigingSchema } from "../../shared/schemas/dagtypeKalender.js";
import { ISO_DAY_RE } from "./collectie.js";
import { valideerRecord } from "./valideer.js";

/**
 * Dagtypekalender (11-10): het De Lijn-dagtype en het verlofmaximum per dag,
 * uit het CSV van Jarno. Lezen mag de staf (het scherm), schrijven is
 * admin-werk: het hele bestand (PUT) of één dag met de hand (PATCH, deel 2).
 * De kalender wint nooit van de code in de planningsmatrix (keuze Jarno):
 * een verschil komt als opmerking terug in `afwijkingen`.
 * GET /api/dagtypes (elke rol) geeft het afgeleide dagtype per dag, zoals het
 * bord het rekent; Mijn dag toont ermee waarom de tijden anders zijn.
 */

/** Hoogstens een kwartaal per lezing: Mijn dag vraagt drie dagen, het bord een maand. */
const DAGTYPES_MAX_DAGEN = 92;

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

  app.patch("/api/dagtypekalender/:datum", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum ?? "");
    if (!isIsoDag(datum)) return res.status(400).json({ error: "Ongeldige datum." });
    const body = valideerRecord(res, dagtypeKalenderDagWijzigingSchema, req.body ?? {});
    if (!body) return;
    try {
      const vorige = (await getDagtypeKalender({ van: datum, tot: datum }))[0] ?? null;
      await schrijfDagtypeKalender([{ datum, typedag: body.typedag, maxVerlof: body.maxVerlof }], "hand");
      const dag = (await getDagtypeKalender({ van: datum, tot: datum }))[0] ?? null;
      const max = (v: number | null) => (v === null ? "zoals de instellingen" : String(v));
      const delen: string[] = [];
      if (!vorige || vorige.typedag !== body.typedag) delen.push(`dagtype ${vorige ? `${vorige.typedag} → ` : ""}${body.typedag}`);
      if (!vorige || vorige.maxVerlof !== body.maxVerlof) delen.push(`max. verlof ${vorige ? `${max(vorige.maxVerlof)} → ` : ""}${max(body.maxVerlof)}`);
      await logActivity(
        req,
        "planning",
        "Dagtype aangepast",
        `${DAG_DMJ(datum)}${vorige ? "" : " toegevoegd"}: ${delen.length > 0 ? delen.join(", ") : "ongewijzigd opnieuw bewaard"}.`,
      );
      res.json(dag);
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: `De tabel dagtype_kalender bestaat nog niet: draai ${DAGTYPE_KALENDER_MIGRATIE} in de SQL Editor.` });
      }
      console.error("Dagtype aanpassen is mislukt.", err);
      res.status(500).json({ error: "De dag opslaan is mislukt." });
    }
  });

  app.get("/api/dagtypes", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const vandaag = brusselsDay(new Date().toISOString());
      const van = isIsoDag(req.query.van) ? req.query.van : vandaag;
      const tot = isIsoDag(req.query.tot) ? req.query.tot : addDagenIso(van, 7);
      if (tot < van || addDagenIso(van, DAGTYPES_MAX_DAGEN) < tot) {
        return res.status(400).json({ error: `Geef een periode van hoogstens ${DAGTYPES_MAX_DAGEN} dagen (van, tot).` });
      }
      // Dezelfde afleiding als het bord en de opbouw (dagtypeVanDag): de code
      // in de planningsmatrix wint, dan de kalender, dan de dekking, dan de weekdag.
      const [rows, kalender] = await Promise.all([getPlanningMatrixRows({ van, tot }), laadDagtypeKalender()]);
      const matrixPerDag = new Map((rows as Array<{ source_date?: unknown; day_type?: unknown }>).map((r) => [String(r.source_date ?? "").slice(0, 10), r.day_type]));
      const dagtypes: Record<string, { code: string; label: string; periode: string; bron: string } | null> = {};
      for (let d = van; d <= tot; d = addDagenIso(d, 1)) {
        const { code, bron } = dagtypeVanDag(d, matrixPerDag.get(d), kalender);
        dagtypes[d] = code ? { code, label: dagtypeLabel(code), periode: dagtypePeriode(code), bron } : null;
      }
      res.json({ van, tot, dagtypes });
    } catch (err) {
      console.error("Dagtypes laden is mislukt.", err);
      res.status(500).json({ error: "De dagtypes konden niet laden." });
    }
  });
}
