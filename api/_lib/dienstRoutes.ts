import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { logActivity } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { laadXlsx } from "./matrixXlsx.js";
import { dagtypeCodeBodySchema, segmentImportBodySchema } from "../../shared/schemas/dienst.js";
import { parseImportET } from "../../shared/dienst/importET.js";
import { controleerSegmenten } from "../../shared/dienst/controles.js";
import { looncomponentenCsv, looncomponentenVanSegmenten } from "../../shared/dienst/looncomponenten.js";
import { loonParametersVanSegmenten } from "../../shared/dienst/loonparameters.js";
import { ritbladVanSegmenten } from "../../shared/dienst/ritblad.js";
import type { Segment } from "../../shared/dienst.js";
import { loonCodeSleutel } from "../../shared/loon.js";
import { valideerRecord } from "./valideer.js";
import {
  DIENST_MIGRATIE, activeerImport, createImport, deleteImport, getActieveImport, getDagtypeCodes, getImport, getImports, getSegments, patchDagtypeCode,
} from "./dienstStorage.js";
import { getLoonCodes, upsertLoonCode } from "./loonStorage.js";

/**
 * Dienstopbouw op rit-niveau (fase C Access-migratie, 13-09): import van de
 * ET-export, controles, activeren, looncomponenten (Easypay per dienst),
 * loonparameters afleiden naar de looncodes, dagtype-koppeling en het
 * ritblad per dienst uit data. Staf-only, behalve lezen van segmenten en
 * ritblad (Mijn dag mag ze later tonen).
 */
const MAX_BESTAND_BYTES = 5 * 1024 * 1024;

const migratieOntbreekt = (res: express.Response) =>
  res.status(503).json({ error: `De dienstopbouw-tabellen bestaan nog niet: draai ${DIENST_MIGRATIE} in de SQL Editor.` });

const fout = (res: express.Response, err: unknown, tekst: string) => {
  if (isMissingTableError(err)) return migratieOntbreekt(res);
  console.error(tekst, err);
  return res.status(500).json({ error: tekst });
};

/** Segmenten per (dienst, dagtype). */
const perDienst = (segments: Segment[]): Map<string, Segment[]> => {
  const m = new Map<string, Segment[]>();
  for (const s of segments) {
    const k = `${s.serviceNumber}|${s.dagtypeCode}`;
    const l = m.get(k) ?? [];
    l.push(s);
    m.set(k, l);
  }
  return m;
};

export function mountDienstRoutes(app: express.Express) {
  const staf = [authenticate, requireRole("planner", "admin")] as const;

  app.get("/api/dienstopbouw/imports", ...staf, async (_req: AuthenticatedRequest, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getImports());
    } catch (err) { fout(res, err, "Kon de imports niet lezen."); }
  });

  app.post("/api/dienstopbouw/imports", ...staf, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, segmentImportBodySchema, req.body ?? {});
    if (!body) return;
    // Zip-bomb-bescherming zoals de planning-import: eerst de base64-lengte.
    if (body.bestandBase64.length > MAX_BESTAND_BYTES * 1.4) return res.status(413).json({ error: "Bestand te groot (maximaal 5 MB)." });
    let rows: Array<Record<string, unknown>>;
    try {
      const buffer = Buffer.from(body.bestandBase64, "base64");
      if (buffer.length > MAX_BESTAND_BYTES) return res.status(413).json({ error: "Bestand te groot (maximaal 5 MB)." });
      // xlsx lui geladen: alleen deze importroute heeft de bibliotheek nodig.
      const XLSX = await laadXlsx();
      const wb = XLSX.read(buffer, { type: "buffer", raw: false, cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return res.status(400).json({ error: "Ongeldige invoer", details: "Het bestand heeft geen werkblad." });
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
    } catch (err) {
      console.error("dienstopbouw import lezen mislukt", err);
      return res.status(400).json({ error: "Ongeldige invoer", details: "Het bestand kon niet gelezen worden (verwacht .xlsx of .csv met de kolommen van de ET-export)." });
    }
    try {
      const { segments, waarschuwingen, dagtypes } = parseImportET(rows);
      if (segments.length === 0) return res.status(400).json({ error: "Ongeldige invoer", details: "Geen ritdelen gevonden. Controleer de kolomkoppen (typedag, dienstnummer, type, duur, start, einde, …)." });
      const bevindingen = controleerSegmenten(segments);
      const imp = await createImport({
        importedBy: String(req.appUser?.id ?? "") || null,
        filename: body.filename ?? null,
        rijen: segments.length,
        diensten: new Set(segments.map((s) => s.serviceNumber)).size,
        dagtypes,
        waarschuwingen,
        bevindingen,
      }, segments);
      await logActivity(req, "services", "Dienstopbouw geïmporteerd", `${imp.filename ?? "bestand"}: ${imp.rijen} ritdelen, ${imp.diensten} diensten, ${bevindingen.filter((b) => b.ernst === "fout").length} fouten, ${waarschuwingen.length} overgeslagen rijen.`);
      res.status(201).json(imp);
    } catch (err) { fout(res, err, "Kon de import niet bewaren."); }
  });

  app.post("/api/dienstopbouw/imports/:id/activeren", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const imp = await getImport(String(req.params.id));
      if (!imp) return res.status(404).json({ error: "Import niet gevonden." });
      const fouten = imp.bevindingen.filter((b) => b.ernst === "fout");
      const forceer = String(req.query.forceer ?? "") === "1" && req.appUser!.role === "admin";
      if (fouten.length > 0 && !forceer) return res.status(409).json({ error: `Deze import heeft ${fouten.length} fouten (gaten, overlap of einde vóór start). Los ze op in het bronbestand of forceer als beheerder.` });
      const nieuw = await activeerImport(imp.id);
      await logActivity(req, "services", "Dienstopbouw geactiveerd", `${imp.filename ?? imp.id}: ${imp.rijen} ritdelen, ${imp.diensten} diensten${forceer ? " (geforceerd)" : ""}.`);
      res.json(nieuw);
    } catch (err) { fout(res, err, "Kon de import niet activeren."); }
  });

  app.delete("/api/dienstopbouw/imports/:id", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const ok = await deleteImport(String(req.params.id));
      if (!ok) return res.status(409).json({ error: "Alleen een niet-actieve import kan verwijderd worden." });
      await logActivity(req, "services", "Dienstopbouw-import verwijderd", String(req.params.id));
      res.json({ success: true });
    } catch (err) { fout(res, err, "Kon de import niet verwijderen."); }
  });

  const importVoor = async (idOfLeeg: string | undefined) => (idOfLeeg ? getImport(idOfLeeg) : getActieveImport());

  app.get("/api/dienstopbouw/segmenten", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const imp = await importVoor(String(req.query.importId ?? "").trim() || undefined);
      res.setHeader("Cache-Control", "no-store");
      if (!imp) return res.json({ import: null, segmenten: [] });
      const segmenten = await getSegments(imp.id, { serviceNumber: String(req.query.serviceNumber ?? "").trim() || undefined, dagtypeCode: String(req.query.dagtype ?? "").trim() || undefined });
      res.json({ import: imp, segmenten });
    } catch (err) { fout(res, err, "Kon de ritdelen niet lezen."); }
  });

  app.get("/api/dienstopbouw/ritblad", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const serviceNumber = String(req.query.serviceNumber ?? "").trim();
      if (!serviceNumber) return res.status(400).json({ error: "Geef een dienstnummer." });
      const imp = await importVoor(undefined);
      if (!imp) return res.json({ dagtypes: [] });
      const alle = await getSegments(imp.id, { serviceNumber });
      const per = perDienst(alle);
      const dagtypes = [...per.entries()].map(([k, segs]) => ({ dagtypeCode: k.split("|")[1], rijen: ritbladVanSegmenten(segs) }));
      res.setHeader("Cache-Control", "no-store");
      res.json({ serviceNumber, dagtypes });
    } catch (err) { fout(res, err, "Kon het ritblad niet maken."); }
  });

  app.get("/api/dienstopbouw/imports/:id/looncomponenten", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const imp = await getImport(String(req.params.id));
      if (!imp) return res.status(404).json({ error: "Import niet gevonden." });
      const rijen = looncomponentenVanSegmenten(await getSegments(imp.id));
      if (String(req.query.format ?? "json") === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="loondiensten-easypay-${imp.createdAt.slice(0, 10)}.csv"`);
        return res.send("﻿" + looncomponentenCsv(rijen));
      }
      res.json({ importId: imp.id, rijen });
    } catch (err) { fout(res, err, "Kon de looncomponenten niet maken."); }
  });

  app.get("/api/dienstopbouw/imports/:id/loonparameters", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const imp = await getImport(String(req.params.id));
      if (!imp) return res.status(404).json({ error: "Import niet gevonden." });
      const [segmenten, codes] = await Promise.all([getSegments(imp.id), getLoonCodes()]);
      const codeMap = new Map(codes.map((c) => [c.code, c]));
      const uit = [...perDienst(segmenten).entries()].map(([k, segs]) => {
        const [serviceNumber, dagtypeCode] = k.split("|");
        const p = loonParametersVanSegmenten(segs);
        const huidig = codeMap.get(loonCodeSleutel(serviceNumber)) ?? null;
        return { serviceNumber, dagtypeCode, parameters: p, huidig: huidig ? { lbRijtijd: huidig.lbRijtijd, lbStat100At: huidig.lbStat100At, lbStat100Nat: huidig.lbStat100Nat, lbStat50Nat: huidig.lbStat50Nat, lbOnd: huidig.lbOnd, lbAndWrk: huidig.lbAndWrk, lbNacht: huidig.lbNacht, tik1: huidig.tik1, tik2: huidig.tik2, tik3: huidig.tik3, tik4: huidig.tik4, tik5: huidig.tik5, tik6: huidig.tik6, bron: huidig.bron } : null };
      });
      res.json({ importId: imp.id, diensten: uit });
    } catch (err) { fout(res, err, "Kon de loonparameters niet berekenen."); }
  });

  /** Loonparameters + tiktijden uit de ritdelen naar loon_codes (bron 'segments'); handmatig bewerkte codes blijven staan. */
  app.post("/api/dienstopbouw/imports/:id/afleiden-looncodes", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const imp = await getImport(String(req.params.id));
      if (!imp) return res.status(404).json({ error: "Import niet gevonden." });
      const [segmenten, codes] = await Promise.all([getSegments(imp.id), getLoonCodes()]);
      const codeMap = new Map(codes.map((c) => [c.code, c]));
      let bijgewerkt = 0; let nieuw = 0; const overgeslagen: string[] = []; const teVeelDelen: string[] = [];
      for (const [k, segs] of perDienst(segmenten)) {
        const [serviceNumber] = k.split("|");
        const sleutel = loonCodeSleutel(serviceNumber);
        const huidig = codeMap.get(sleutel);
        if (huidig?.bron === "handmatig") { overgeslagen.push(serviceNumber); continue; }
        const p = loonParametersVanSegmenten(segs);
        if (p.teVeelDelen) teVeelDelen.push(serviceNumber);
        const t = p.tiktijden;
        await upsertLoonCode(sleutel, {
          codeWeergave: huidig?.codeWeergave ?? serviceNumber,
          omschrijving: huidig?.omschrijving ?? null,
          dienstType: "lijn",
          inExport: huidig?.inExport ?? true,
          easypayActiviteit: huidig?.easypayActiviteit ?? "LIJN",
          easypayTypePrest: huidig?.easypayTypePrest ?? 40140,
          tik1: t[0]?.begin ?? null, tik2: t[0]?.einde ?? null, tik3: t[1]?.begin ?? null, tik4: t[1]?.einde ?? null, tik5: t[2]?.begin ?? null, tik6: t[2]?.einde ?? null,
          lbRijtijd: p.lbRijtijd, lbStat100At: p.lbStat100At, lbStat100Nat: p.lbStat100Nat, lbStat50Nat: p.lbStat50Nat, lbOnd: p.lbOnd, lbAndWrk: p.lbAndWrk, lbNacht: p.lbNacht,
        }, String(req.appUser?.id ?? "") || null, "segments");
        if (huidig) bijgewerkt += 1; else nieuw += 1;
      }
      await logActivity(req, "services", "Looncodes afgeleid uit de dienstopbouw", `${bijgewerkt} bijgewerkt, ${nieuw} nieuw, ${overgeslagen.length} handmatig overgeslagen.`);
      res.json({ bijgewerkt, nieuw, overgeslagen, teVeelDelen });
    } catch (err) { fout(res, err, "Kon de looncodes niet afleiden."); }
  });

  app.get("/api/dienstopbouw/dagtypes", ...staf, async (_req: AuthenticatedRequest, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getDagtypeCodes());
    } catch (err) { fout(res, err, "Kon de dagtypes niet lezen."); }
  });

  app.put("/api/dienstopbouw/dagtypes/:code", ...staf, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, dagtypeCodeBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const d = await patchDagtypeCode(String(req.params.code), { portaalDagtype: body.portaalDagtype ?? null });
      if (!d) return res.status(404).json({ error: "Dagtype niet gevonden." });
      res.json(d);
    } catch (err) { fout(res, err, "Kon het dagtype niet bewaren."); }
  });

}
