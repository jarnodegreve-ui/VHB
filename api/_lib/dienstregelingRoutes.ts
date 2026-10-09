import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import type { AuthenticatedRequest } from "../types.js";
import { DAG_DMJ, brusselsDay } from "../helpers.js";
import { dienstregelingBodySchema, dienstregelingPatchSchema } from "../../shared/schemas/dienstregeling.js";
import { dagVoor, versieGeldigTot, versieLabel, versieStatus, versieVoorDatum } from "../../shared/dienstregeling.js";
import { valideerRecord } from "./valideer.js";
import {
  DIENSTREGELING_MIGRATIE, MigratieOntbreektError, createDienstregeling, deleteDienstregeling, getDienstregelingen, getServicesPerVersie, getUsersData, logActivity, updateDienstregeling,
} from "../storage.js";
import { sendPushToUsers } from "../push.js";
import { viewUrl } from "./collectie.js";
import { heropbouwNaDienstoverzicht, planningUitkomstVoorAntwoord } from "./planningHeropbouw.js";

/**
 * Dienstregelingversies (fase 1 van het plan van 08-10, akkoord Jarno).
 *
 * De dienstregeling van De Lijn wijzigt om de paar maanden terwijl de
 * dienstnummers gelijk blijven. Het dienstoverzicht bestaat daarom in versies
 * met een geldig-vanaf-datum: de planner zet een nieuwe versie weken vooraf
 * klaar (een kopie van de huidige, dan bewerken of een Excel importeren), en
 * de planning-opbouw neemt per dag de versie die op die dag geldt. Oude
 * versies blijven bestaan, zodat het verleden zijn toenmalige tijden houdt.
 *
 * Lezen en aanmaken: planner en admin. Verwijderen: admin, en alleen een
 * toekomstige versie; de huidige en verlopen versies dragen de planning van
 * hun dagen. De diensten zelf gaan via /api/services?versie=<id>
 * (communicatieRoutes).
 */
const vandaag = () => brusselsDay(new Date().toISOString());

const fout = (res: express.Response, err: unknown, tekst: string) => {
  if (isMissingTableError(err)) return res.status(503).json({ error: `De tabel voor dienstregelingversies bestaat nog niet: draai ${DIENSTREGELING_MIGRATIE} in de SQL Editor.` });
  console.error(tekst, err);
  return res.status(500).json({ error: tekst });
};

const veldfout = (res: express.Response, veld: string, tekst: string) =>
  res.status(400).json({ error: "Ongeldige invoer", details: tekst, veldfouten: { [veld]: tekst } });

export function mountDienstregelingRoutes(app: express.Express) {
  const staf = [authenticate, requireRole("planner", "admin")] as const;

  app.get("/api/dienstregelingen", ...staf, async (_req: AuthenticatedRequest, res) => {
    try {
      const { versies } = await getServicesPerVersie();
      const dag = vandaag();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        vandaag: dag,
        versies: versies.map((v) => ({
          id: v.id, naam: v.naam, geldigVanaf: v.geldigVanaf, opmerking: v.opmerking, createdAt: v.createdAt, createdBy: v.createdBy,
          aantalDiensten: v.services.length,
          status: versieStatus(versies, v, dag),
          geldigTot: versieGeldigTot(versies, v),
        })),
      });
    } catch (err) { fout(res, err, "Kon de dienstregelingversies niet lezen."); }
  });

  app.post("/api/dienstregelingen", ...staf, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, dienstregelingBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const dag = vandaag();
      if (body.geldigVanaf < dag) return veldfout(res, "geldigVanaf", "De datum mag niet in het verleden liggen.");
      const versies = await getDienstregelingen();
      if (versies.some((v) => v.geldigVanaf === body.geldigVanaf)) {
        return res.status(409).json({ error: `Er bestaat al een versie vanaf ${DAG_DMJ(body.geldigVanaf)}.` });
      }
      // Kopie van de gekozen versie, anders van de versie die op de dag
      // ervoor geldt (dé verwachting: "dezelfde lijst, nu aanpassen").
      let kopieVan = null as (typeof versies)[number] | null;
      if (body.kopieVan) {
        kopieVan = versies.find((v) => v.id === body.kopieVan) ?? null;
        if (!kopieVan) return res.status(404).json({ error: "De versie om van te kopiëren bestaat niet (meer)." });
      } else {
        kopieVan = versieVoorDatum(versies, dagVoor(body.geldigVanaf));
      }
      const versie = await createDienstregeling({
        naam: body.naam ?? null,
        geldigVanaf: body.geldigVanaf,
        opmerking: body.opmerking ?? null,
        createdBy: String(req.appUser?.id ?? "") || null,
        kopieVanId: kopieVan?.id ?? null,
      });
      await logActivity(req, "services", "Dienstregelingversie aangemaakt", `${versieLabel(versie)}, geldig vanaf ${DAG_DMJ(versie.geldigVanaf)}${kopieVan ? `, kopie van ${versieLabel(kopieVan)}` : ", zonder diensten"}.`);
      // Seintje naar de actieve chauffeurs (09-10, keuze Jarno), tenzij het
      // formulier het uitzet. Best-effort: de versie bestaat al.
      if (body.melden !== false) {
        try {
          const chauffeurIds = (await getUsersData()).filter((u) => u.role === "chauffeur" && u.isActive !== false).map((u) => String(u.id));
          await sendPushToUsers(chauffeurIds, {
            title: "Nieuwe dienstregeling",
            soort: "planning",
            body: `Vanaf ${DAG_DMJ(versie.geldigVanaf)} geldt een nieuwe dienstregeling${versie.naam ? ` (${versie.naam})` : ""}. Bekijk het dienstoverzicht.`,
            url: viewUrl("dienstoverzicht"),
          });
        } catch (pushErr) {
          console.error("Push over de nieuwe dienstregelingversie versturen mislukt.", pushErr);
        }
      }
      res.status(201).json(versie);
    } catch (err) {
      if (String((err as { code?: unknown })?.code ?? "") === "23505") return res.status(409).json({ error: `Er bestaat al een versie vanaf ${DAG_DMJ(body.geldigVanaf)}.` });
      // Kopie van een versie met afwijkingen per dagtype zonder de kolom (10-10): de versie is al weer weg, zeg welke migratie.
      if (err instanceof MigratieOntbreektError) return res.status(503).json({ error: err.message });
      fout(res, err, "Kon de versie niet aanmaken.");
    }
  });

  app.patch("/api/dienstregelingen/:id", ...staf, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, dienstregelingPatchSchema, req.body ?? {});
    if (!body) return;
    try {
      const id = String(req.params.id);
      const versies = await getDienstregelingen();
      const huidig = versies.find((v) => v.id === id);
      if (!huidig) return res.status(404).json({ error: "Deze versie bestaat niet (meer)." });
      const dag = vandaag();
      const datumWijzigt = body.geldigVanaf !== undefined && body.geldigVanaf !== huidig.geldigVanaf;
      if (datumWijzigt) {
        if (versieStatus(versies, huidig, dag) !== "toekomstig") {
          return res.status(409).json({ error: "Alleen de datum van een toekomstige versie kan nog wijzigen: de huidige en verlopen versies dragen de planning van hun dagen." });
        }
        if (body.geldigVanaf! < dag) return veldfout(res, "geldigVanaf", "De datum mag niet in het verleden liggen.");
        if (versies.some((v) => v.id !== id && v.geldigVanaf === body.geldigVanaf)) {
          return res.status(409).json({ error: `Er bestaat al een versie vanaf ${DAG_DMJ(body.geldigVanaf!)}.` });
        }
      }
      const bijgewerkt = await updateDienstregeling(id, {
        naam: body.naam ?? null,
        opmerking: body.opmerking ?? null,
        ...(datumWijzigt ? { geldigVanaf: body.geldigVanaf } : {}),
      });
      if (!bijgewerkt) return res.status(404).json({ error: "Deze versie bestaat niet (meer)." });
      await logActivity(req, "services", "Dienstregelingversie bijgewerkt", `${versieLabel(bijgewerkt)}${datumWijzigt ? `, geldig vanaf ${DAG_DMJ(huidig.geldigVanaf)} → ${DAG_DMJ(bijgewerkt.geldigVanaf)}` : ""}.`);
      // Een andere datum verschuift welke dagen deze versie dragen: de
      // planning van die dagen volgt, langs dezelfde strenge automatische weg
      // als een save in het dienstoverzicht.
      const planning = datumWijzigt ? planningUitkomstVoorAntwoord(await heropbouwNaDienstoverzicht(req)) : { status: "niet-nodig" as const };
      res.json({ ...bijgewerkt, planning });
    } catch (err) {
      if (String((err as { code?: unknown })?.code ?? "") === "23505") return res.status(409).json({ error: "Er bestaat al een versie met die datum." });
      fout(res, err, "Kon de versie niet bijwerken.");
    }
  });

  app.delete("/api/dienstregelingen/:id", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const versies = await getDienstregelingen();
      const huidig = versies.find((v) => v.id === id);
      if (!huidig) return res.status(404).json({ error: "Deze versie bestaat niet (meer)." });
      if (versieStatus(versies, huidig, vandaag()) !== "toekomstig") {
        return res.status(409).json({ error: "Alleen een toekomstige versie kan verwijderd worden: de huidige en verlopen versies dragen de planning van hun dagen." });
      }
      await deleteDienstregeling(id);
      await logActivity(req, "services", "Dienstregelingversie verwijderd", `${versieLabel(huidig)}, gold vanaf ${DAG_DMJ(huidig.geldigVanaf)}; haar diensten zijn mee verwijderd.`);
      // De dagen van deze versie vallen terug op de vorige: planning mee.
      const planning = planningUitkomstVoorAntwoord(await heropbouwNaDienstoverzicht(req));
      res.json({ success: true, planning });
    } catch (err) { fout(res, err, "Kon de versie niet verwijderen."); }
  });
}
