import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import {
  getAppSetting, getLeaveData, getPlanningCodesData, getPlanningMatrixRows, getServicesData, getSwapsData, getUsersData, logActivity, setAppSetting,
} from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { DAG_DMJ, nameIdIndex, sortedNameToken, toLookupToken } from "../helpers.js";
import { loonCodeSleutel } from "../../shared/loon.js";
import {
  LOON_INSTELLINGEN_KEY, dagPrestatieBodySchema, dagPrestatieNieuwSchema, heropenBodySchema, loonCodeBodySchema, loonInstellingenSchema,
  loonMedewerkerBodySchema, loonMedewerkersImportSchema, parseLoonInstellingen, type DagPrestatie,
} from "../../shared/schemas/loon.js";
import { EASYPAY_CSV_STANDAARD, bouwEasypayRijen, easypayCsv, easypaySamenvatting, type EasypayIssue } from "../../shared/loon/easypay.js";
import { valideerRecord } from "./valideer.js";
import { berekenCelWaarheid } from "./celWaarheid.js";
import {
  LOON_MIGRATIE, deleteDagPrestatie, deleteLoonCode, getDagAfsluiting, getDagAfsluitingen, getDagPrestatie, getDagPrestaties, getDagPrestatiesPeriode,
  getLoonCodes, getLoonMedewerkers, heropenDag, insertDagPrestaties, isUniqueError, openDag, patchDagPrestatie, sluitDag, upsertLoonCode,
  upsertLoonMedewerker, zetPlanningCode,
} from "./loonStorage.js";

/**
 * Loon (fase B Access-migratie, 13-09): dagafsluiting en Easypay-export.
 * Alles staf-only (planner/admin); de export en de instellingen admin-only
 * waar dat nodig is. Zonder migratie: 503 met de bestandsnaam.
 */

const migratieOntbreekt = (res: express.Response) =>
  res.status(503).json({ error: `De loon-tabellen bestaan nog niet: draai ${LOON_MIGRATIE} in de SQL Editor.` });

const fout = (res: express.Response, err: unknown, tekst: string) => {
  if (isMissingTableError(err)) return migratieOntbreekt(res);
  console.error(tekst, err);
  return res.status(500).json({ error: tekst });
};

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MAAND = /^\d{4}-\d{2}$/;
const maandVan = (datum: string) => datum.slice(0, 7);
const laatsteDagVan = (maand: string) => {
  const [j, m] = maand.split("-").map(Number);
  return `${maand}-${String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** De cel-waarheid van één dag: per actieve chauffeur de planningscode (null = niet in de planning). */
const planningVanDag = async (datum: string) => {
  const maand = maandVan(datum);
  const [rows, users, services, codes, leave, swaps] = await Promise.all([
    getPlanningMatrixRows(), getUsersData(), getServicesData(), getPlanningCodesData(), getLeaveData({ endOnOrAfter: `${maand}-01` }), getSwapsData(),
  ]);
  const uit = berekenCelWaarheid(maand, { rows: rows as any[], users: users as any[], services: services as any[], codes: codes as any[], leave: leave as any[], swaps: swaps as any[] });
  const inPlanning = uit.dates.includes(datum);
  return {
    inPlanning,
    chauffeurs: uit.chauffeurs,
    codeVan: (userId: string): string | null => (inPlanning ? (uit.cells[userId]?.[datum]?.code ?? null) : null),
    users,
  };
};

const metNamen = (users: Array<{ id: string | number; name: string }>) => {
  const naam = new Map(users.map((u) => [String(u.id), u.name]));
  return (p: DagPrestatie): DagPrestatie => ({ ...p, naam: naam.get(p.userId) ?? p.userId });
};

export function mountLoonRoutes(app: express.Express) {
  const staf = [authenticate, requireRole("planner", "admin")] as const;

  // --- Looncodes ---
  app.get("/api/loon/codes", ...staf, async (_req: AuthenticatedRequest, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getLoonCodes());
    } catch (err) { fout(res, err, "Kon de looncodes niet lezen."); }
  });

  app.put("/api/loon/codes/:code", ...staf, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, loonCodeBodySchema, req.body ?? {});
    if (!body) return;
    const code = loonCodeSleutel(String(req.params.code));
    if (!code) return res.status(400).json({ error: "Ongeldige invoer", details: "Code ontbreekt.", veldfouten: { code: "Vul een code in" } });
    try {
      const c = await upsertLoonCode(code, body, String(req.appUser?.id ?? "") || null);
      await logActivity(req, "system", "Looncode bewaard", `${c.codeWeergave}: ${c.easypayActiviteit} ${c.easypayTypePrest}, ${c.dienstType}${c.inExport ? "" : ", niet in export"}.`);
      res.json(c);
    } catch (err) { fout(res, err, "Kon de looncode niet bewaren."); }
  });

  app.delete("/api/loon/codes/:code", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const ok = await deleteLoonCode(String(req.params.code));
      if (!ok) return res.status(404).json({ error: "Looncode niet gevonden." });
      await logActivity(req, "system", "Looncode verwijderd", String(req.params.code));
      res.json({ success: true });
    } catch (err) { fout(res, err, "Kon de looncode niet verwijderen."); }
  });


  // --- Medewerkers (matricules) ---
  app.get("/api/loon/medewerkers", ...staf, async (_req: AuthenticatedRequest, res) => {
    try {
      const [users, medewerkers] = await Promise.all([getUsersData(), getLoonMedewerkers()]);
      const per = new Map(medewerkers.map((m) => [m.userId, m]));
      const lijst = users
        .filter((u: any) => u.isActive !== false && u.role === "chauffeur")
        .map((u: any) => ({ userId: String(u.id), naam: u.name, employeeId: u.employeeId ?? null, easypayNr: per.get(String(u.id))?.easypayNr ?? null, inExport: per.get(String(u.id))?.inExport ?? true }))
        .sort((a: any, b: any) => a.naam.localeCompare(b.naam, "nl"));
      res.setHeader("Cache-Control", "no-store");
      res.json(lijst);
    } catch (err) { fout(res, err, "Kon de medewerkers niet lezen."); }
  });

  app.put("/api/loon/medewerkers/:userId", ...staf, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, loonMedewerkerBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const users = await getUsersData();
      const user = users.find((u: any) => String(u.id) === String(req.params.userId));
      if (!user) return res.status(404).json({ error: "Gebruiker niet gevonden." });
      const m = await upsertLoonMedewerker(String(user.id), { easypayNr: body.easypayNr ?? null, inExport: body.inExport }, String(req.appUser?.id ?? "") || null);
      await logActivity(req, "system", "Easypay-matricule bewaard", `${user.name}: ${m.easypayNr ?? "geen"}${m.inExport ? "" : ", niet in export"}.`, { type: "user", id: String(user.id) });
      res.json(m);
    } catch (err) { fout(res, err, "Kon de medewerker niet bewaren."); }
  });

  /** Plak "Naam;matricule" per regel (Access/Excel); namen matchen zoals de planning-import (beide volgordes). */
  app.post("/api/loon/medewerkers/import", ...staf, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, loonMedewerkersImportSchema, req.body ?? {});
    if (!body) return;
    try {
      const users = await getUsersData();
      const actief = users.filter((u: any) => u.isActive !== false);
      const idx = nameIdIndex(actief as any[]);
      const gekoppeld: Array<{ naam: string; nr: number }> = [];
      const onbekend: string[] = [];
      for (const regel of body.tekst.split(/\r?\n/)) {
        const delen = regel.split(/[;\t,]/).map((s) => s.trim());
        if (delen.length < 2) continue;
        const [naam, nrTekst] = delen;
        const nr = Number(nrTekst);
        if (!naam || !Number.isInteger(nr) || nr <= 0) continue;
        const id = idx.get(toLookupToken(naam)) ?? idx.get(sortedNameToken(naam));
        if (!id) { onbekend.push(naam); continue; }
        await upsertLoonMedewerker(id, { easypayNr: nr, inExport: true }, String(req.appUser?.id ?? "") || null);
        gekoppeld.push({ naam, nr });
      }
      await logActivity(req, "system", "Easypay-matricules geïmporteerd", `${gekoppeld.length} gekoppeld, ${onbekend.length} onbekend.`);
      res.json({ gekoppeld: gekoppeld.length, onbekend });
    } catch (err) { fout(res, err, "Kon de matricules niet importeren."); }
  });

  // --- Instellingen ---
  app.get("/api/loon/instellingen", ...staf, async (_req: AuthenticatedRequest, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(parseLoonInstellingen(await getAppSetting(LOON_INSTELLINGEN_KEY)));
    } catch (err) { fout(res, err, "Kon de instellingen niet lezen."); }
  });

  app.put("/api/loon/instellingen", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, loonInstellingenSchema, req.body ?? {});
    if (!body) return;
    try {
      await setAppSetting(LOON_INSTELLINGEN_KEY, body);
      await logActivity(req, "system", "Looninstellingen bewaard", `Easypay-lidnummer ${body.easypayLidnr}.`);
      res.json(body);
    } catch (err) { fout(res, err, "Kon de instellingen niet bewaren."); }
  });

  // --- Dagafsluiting ---
  app.get("/api/dagafsluiting", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const maand = String(req.query.maand ?? "");
      if (!ISO_MAAND.test(maand)) return res.status(400).json({ error: "Geef een geldige maand (YYYY-MM)." });
      const van = `${maand}-01`; const tot = laatsteDagVan(maand);
      const [dagen, prestaties, rows] = await Promise.all([getDagAfsluitingen(van, tot), getDagPrestatiesPeriode(van, tot), getPlanningMatrixRows()]);
      const planningDagen = new Set(rows.map((r: any) => String(r.source_date)).filter((d) => d.startsWith(`${maand}-`)));
      const perDag = new Map<string, { rijen: number; overmin: number; premies: number; zonderCode: number }>();
      for (const p of prestaties) {
        const t = perDag.get(p.datum) ?? { rijen: 0, overmin: 0, premies: 0, zonderCode: 0 };
        t.rijen += 1; t.overmin += p.overmin + p.overminNacht + p.overminExtra; if (p.onvPremie) t.premies += 1; if (!loonCodeSleutel(p.geredenCode)) t.zonderCode += 1;
        perDag.set(p.datum, t);
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({
        maand,
        dagen: dagen.map((d) => ({ ...d, ...(perDag.get(d.datum) ?? { rijen: 0, overmin: 0, premies: 0, zonderCode: 0 }) })),
        planningDagen: [...planningDagen].sort(),
      });
    } catch (err) { fout(res, err, "Kon de dagafsluitingen niet lezen."); }
  });

  app.get("/api/dagafsluiting/:datum", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    if (!ISO_DAG.test(datum)) return res.status(400).json({ error: "Geef een geldige datum (YYYY-MM-DD)." });
    try {
      const [dag, planning, codes] = await Promise.all([getDagAfsluiting(datum), planningVanDag(datum), getLoonCodes()]);
      const bekend = new Set(codes.map((c) => c.code));
      res.setHeader("Cache-Control", "no-store");
      if (!dag) {
        // Nog niet geopend: alleen een voorstel, géén bijwerking (prefetch of
        // nieuwsgierige klik maakt geen rijen).
        return res.status(404).json({
          error: "Deze dag is nog niet geopend.",
          inPlanning: planning.inPlanning,
          voorstel: planning.chauffeurs.map((c) => ({ userId: c.id, naam: c.name, planningCode: planning.codeVan(c.id) })),
        });
      }
      const rijen = (await getDagPrestaties(datum)).map(metNamen(planning.users as any[]));
      // Live vergelijking met de planning van nú: op een open dag kan de
      // planner die overnemen, op een afgesloten dag is het informatie.
      const perUser = new Map<string, DagPrestatie[]>();
      for (const r of rijen) { const l = perUser.get(r.userId) ?? []; l.push(r); perUser.set(r.userId, l); }
      const planningAfwijkingen: Array<{ userId: string; naam: string; planningCode: string | null; huidigeCode: string | null; rijId: string | null; bewerkt: boolean }> = [];
      for (const c of planning.chauffeurs) {
        const nu = planning.codeVan(c.id);
        const eerste = perUser.get(c.id)?.[0];
        if (!eerste) { if (nu) planningAfwijkingen.push({ userId: c.id, naam: c.name, planningCode: nu, huidigeCode: null, rijId: null, bewerkt: false }); continue; }
        if (loonCodeSleutel(eerste.planningCode) !== loonCodeSleutel(nu)) {
          planningAfwijkingen.push({ userId: c.id, naam: c.name, planningCode: nu, huidigeCode: eerste.geredenCode ?? null, rijId: eerste.id, bewerkt: Boolean(eerste.bewerktOp) });
        }
      }
      const ontbrekendeCodes = [...new Set(rijen.map((r) => loonCodeSleutel(r.geredenCode)).filter((s) => s && !bekend.has(s)))];
      res.json({ dag, rijen, planningAfwijkingen, ontbrekendeCodes, inPlanning: planning.inPlanning });
    } catch (err) { fout(res, err, "Kon de dagafsluiting niet lezen."); }
  });

  app.post("/api/dagafsluiting/:datum/openen", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    if (!ISO_DAG.test(datum)) return res.status(400).json({ error: "Geef een geldige datum (YYYY-MM-DD)." });
    try {
      if (await getDagAfsluiting(datum)) return res.status(409).json({ error: "Deze dag is al geopend." });
      const planning = await planningVanDag(datum);
      const dag = await openDag(datum, String(req.appUser?.id ?? "") || null);
      const rijen = await insertDagPrestaties(planning.chauffeurs.map((c) => ({ datum, userId: c.id, volgnr: 1, planningCode: planning.codeVan(c.id), geredenCode: planning.codeVan(c.id) })));
      await logActivity(req, "system", "Dag geopend", `${DAG_DMJ(datum)}: ${rijen.length} chauffeurs uit de planning.`);
      res.status(201).json({ dag, rijen: rijen.map(metNamen(planning.users as any[])), planningAfwijkingen: [], ontbrekendeCodes: [], inPlanning: planning.inPlanning });
    } catch (err) {
      if (isUniqueError(err)) return res.status(409).json({ error: "Deze dag is al geopend." });
      fout(res, err, "Kon de dag niet openen.");
    }
  });

  const openDagOfFout = async (datum: string, res: express.Response) => {
    const dag = await getDagAfsluiting(datum);
    if (!dag) { res.status(404).json({ error: "Deze dag is nog niet geopend." }); return null; }
    if (dag.status === "afgesloten") { res.status(409).json({ error: "Deze dag is afgesloten. Heropen hem eerst." }); return null; }
    return dag;
  };

  app.put("/api/dagafsluiting/:datum/rijen/:id", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    const body = valideerRecord(res, dagPrestatieBodySchema, req.body ?? {});
    if (!body) return;
    try {
      if (!(await openDagOfFout(datum, res))) return;
      const bestaand = await getDagPrestatie(String(req.params.id));
      if (!bestaand || bestaand.datum !== datum) return res.status(404).json({ error: "Rij niet gevonden." });
      const p = await patchDagPrestatie(bestaand.id, body, String(req.appUser?.id ?? "") || null);
      if (!p) return res.status(404).json({ error: "Rij niet gevonden." });
      const users = await getUsersData();
      res.json(metNamen(users as any[])(p));
    } catch (err) { fout(res, err, "Kon de rij niet bewaren."); }
  });

  app.post("/api/dagafsluiting/:datum/rijen", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    const body = valideerRecord(res, dagPrestatieNieuwSchema, req.body ?? {});
    if (!body) return;
    try {
      if (!(await openDagOfFout(datum, res))) return;
      const users = await getUsersData();
      const user = users.find((u: any) => String(u.id) === body.userId);
      if (!user) return res.status(404).json({ error: "Gebruiker niet gevonden." });
      const bestaande = (await getDagPrestaties(datum)).filter((r) => r.userId === body.userId);
      const volgnr = bestaande.length ? Math.max(...bestaande.map((r) => r.volgnr)) + 1 : 1;
      const [p] = await insertDagPrestaties([{ datum, userId: body.userId, volgnr, planningCode: null, geredenCode: body.geredenCode ?? null }]);
      res.status(201).json(metNamen(users as any[])(p));
    } catch (err) { fout(res, err, "Kon de rij niet toevoegen."); }
  });

  app.delete("/api/dagafsluiting/:datum/rijen/:id", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    try {
      if (!(await openDagOfFout(datum, res))) return;
      const bestaand = await getDagPrestatie(String(req.params.id));
      if (!bestaand || bestaand.datum !== datum) return res.status(404).json({ error: "Rij niet gevonden." });
      if (bestaand.volgnr === 1) return res.status(409).json({ error: "De eerste rij van een chauffeur blijft staan; zet de code op leeg als hij niet werkte." });
      await deleteDagPrestatie(bestaand.id);
      res.json({ success: true });
    } catch (err) { fout(res, err, "Kon de rij niet verwijderen."); }
  });

  /** Planning van nu overnemen op de rijen die nog niet bewerkt zijn (of op één rij, met `rijId`). */
  app.post("/api/dagafsluiting/:datum/planning-overnemen", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    try {
      if (!(await openDagOfFout(datum, res))) return;
      const alleenRij = typeof req.body?.rijId === "string" ? String(req.body.rijId) : null;
      const [planning, rijen] = await Promise.all([planningVanDag(datum), getDagPrestaties(datum)]);
      let aangepast = 0;
      const nieuw: string[] = [];
      for (const c of planning.chauffeurs) {
        const nu = planning.codeVan(c.id);
        const eerste = rijen.find((r) => r.userId === c.id && r.volgnr === 1);
        if (!eerste) {
          if (nu && !alleenRij) { nieuw.push(c.id); }
          continue;
        }
        if (alleenRij && eerste.id !== alleenRij) continue;
        if (loonCodeSleutel(eerste.planningCode) === loonCodeSleutel(nu)) continue;
        // Bewerkte rijen nooit stil overschrijven, tenzij de planner die ene rij aanwijst.
        if (eerste.bewerktOp && !alleenRij) continue;
        await zetPlanningCode(eerste.id, nu);
        aangepast += 1;
      }
      if (nieuw.length) {
        await insertDagPrestaties(nieuw.map((id) => ({ datum, userId: id, volgnr: 1, planningCode: planning.codeVan(id), geredenCode: planning.codeVan(id) })));
      }
      await logActivity(req, "system", "Planning overgenomen in dagafsluiting", `${DAG_DMJ(datum)}: ${aangepast} rijen aangepast, ${nieuw.length} toegevoegd.`);
      res.json({ aangepast, toegevoegd: nieuw.length });
    } catch (err) { fout(res, err, "Kon de planning niet overnemen."); }
  });

  app.post("/api/dagafsluiting/:datum/afsluiten", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    try {
      if (!(await openDagOfFout(datum, res))) return;
      const dag = await sluitDag(datum, String(req.appUser?.id ?? "") || null);
      await logActivity(req, "system", "Dag afgesloten", datum);
      res.json(dag);
    } catch (err) { fout(res, err, "Kon de dag niet afsluiten."); }
  });

  app.post("/api/dagafsluiting/:datum/heropenen", ...staf, async (req: AuthenticatedRequest, res) => {
    const datum = String(req.params.datum);
    const body = valideerRecord(res, heropenBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const bestaand = await getDagAfsluiting(datum);
      if (!bestaand) return res.status(404).json({ error: "Deze dag is nog niet geopend." });
      if (bestaand.status !== "afgesloten") return res.status(409).json({ error: "Deze dag is niet afgesloten." });
      const dag = await heropenDag(datum, String(req.appUser?.id ?? "") || null, body.reden);
      await logActivity(req, "system", "Dag heropend", `${DAG_DMJ(datum)}: ${body.reden}`);
      res.json(dag);
    } catch (err) { fout(res, err, "Kon de dag niet heropenen."); }
  });

  // --- Easypay-export ---
  const bouwExport = async (maand: string) => {
    const van = `${maand}-01`; const tot = laatsteDagVan(maand);
    const [dagen, prestaties, codes, medewerkers, instellingen, users, matrixRows] = await Promise.all([
      getDagAfsluitingen(van, tot), getDagPrestatiesPeriode(van, tot), getLoonCodes(), getLoonMedewerkers(), getAppSetting(LOON_INSTELLINGEN_KEY), getUsersData(), getPlanningMatrixRows(),
    ]);
    const lidnr = parseLoonInstellingen(instellingen).easypayLidnr;
    const medewerkerMap = new Map(medewerkers.map((m) => [m.userId, m]));
    const exportMedewerkers = users
      .filter((u: any) => u.role === "chauffeur")
      .map((u: any) => ({ userId: String(u.id), easypayNr: medewerkerMap.get(String(u.id))?.easypayNr ?? null, inExport: medewerkerMap.get(String(u.id))?.inExport ?? true }));
    const { rijen, issues } = bouwEasypayRijen({
      maand, codes, medewerkers: exportMedewerkers, lidnr,
      prestaties: prestaties.map((p) => ({ userId: p.userId, datum: p.datum, geredenCode: p.geredenCode ?? null, overmin: p.overmin, overminNacht: p.overminNacht, overminExtra: p.overminExtra, onvPremie: p.onvPremie })),
    });
    const naam = new Map(users.map((u: any) => [String(u.id), u.name as string]));
    const openDagen = dagen.filter((d) => d.status !== "afgesloten").map((d) => d.datum);
    // Dagen met planning-inhoud die nooit geopend zijn hebben geen prestaties
    // en zouden de export stil onvolledig maken: die blokkeren net als open
    // dagen. Zelfde bron als het maandraster (planning_matrix_rows), beperkt
    // tot vandaag zodat een lopende maand niet op de toekomst blokkeert.
    const vandaag = new Date().toISOString().slice(0, 10);
    const geopend = new Set(dagen.map((d) => d.datum));
    const nietGeopendeDagen = [...new Set(matrixRows.map((r: any) => String(r.source_date)))]
      .filter((d) => d.startsWith(`${maand}-`) && d <= vandaag && !geopend.has(d))
      .sort();
    const controle = {
      maand,
      dagenGeopend: dagen.length,
      dagenAfgesloten: dagen.length - openDagen.length,
      openDagen,
      nietGeopendeDagen,
      lidnr,
      issues: issues.map((i: EasypayIssue) => ({ ...i, naam: naam.get(i.userId) ?? i.userId })),
      samenvatting: easypaySamenvatting(rijen),
    };
    const blokkerend = openDagen.length > 0 || nietGeopendeDagen.length > 0 || issues.length > 0 || dagen.length === 0 || !lidnr;
    return { rijen, controle, blokkerend };
  };

  app.get("/api/loon/export/controle", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const maand = String(req.query.maand ?? "");
      if (!ISO_MAAND.test(maand)) return res.status(400).json({ error: "Geef een geldige maand (YYYY-MM)." });
      const { controle, blokkerend } = await bouwExport(maand);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...controle, blokkerend });
    } catch (err) { fout(res, err, "Kon de controle niet uitvoeren."); }
  });

  app.get("/api/loon/export", ...staf, async (req: AuthenticatedRequest, res) => {
    try {
      const maand = String(req.query.maand ?? "");
      if (!ISO_MAAND.test(maand)) return res.status(400).json({ error: "Geef een geldige maand (YYYY-MM)." });
      const forceer = String(req.query.forceer ?? "") === "1" && req.appUser!.role === "admin";
      const { rijen, controle, blokkerend } = await bouwExport(maand);
      if (blokkerend && !forceer) return res.status(409).json({ error: "De export is nog niet klaar: open en sluit alle dagen met planning af en los de meldingen op.", ...controle });
      const format = String(req.query.format ?? "csv");
      await logActivity(req, "system", "Easypay-export gemaakt", `${maand}: ${rijen.length} rijen, ${controle.samenvatting.personen} personen${forceer ? " (geforceerd)" : ""}.`);
      if (format === "json") return res.json({ maand, rijen, controle });
      const sep = typeof req.query.sep === "string" && req.query.sep.length === 1 ? req.query.sep : EASYPAY_CSV_STANDAARD.scheidingsteken;
      const csv = easypayCsv(rijen, { ...EASYPAY_CSV_STANDAARD, scheidingsteken: sep });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="easypay-${maand}.csv"`);
      res.send("﻿" + csv);
    } catch (err) { fout(res, err, "Kon de export niet maken."); }
  });

}
