/**
 * Communicatie: omleidingen, dienstoverzicht (services), updates met hun
 * bijlagen en leesbevestigingen, en de dringende mail.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import { sendEmail, mailOpbouw } from "../email.js";
import { sendPushToUsers } from "../push.js";
import type { AuthenticatedRequest } from "../types.js";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingColumnError } from "../deviceGate.js";
import { urgentEmailRateLimit } from "../rateLimit.js";
import { dienstenVerschillenVoorPlanning, heropbouwNaDienstoverzicht, ROOSTER_MELDING_RUST_MINUTEN } from "./planningHeropbouw.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { MAX_OMLEIDING_BIJLAGEN, diversionBodySchema, diversionLijstSchema } from "../../shared/schemas/diversion.js";
import { MAX_UPDATE_BIJLAGEN, updateBodySchema, updateLijstSchema } from "../../shared/schemas/update.js";
import { recordUrl } from "./meldingen.js";
import { valideerLijst, valideerRecord } from "./valideer.js";
import { recordRevisionOf, withRecordRevision, requestedRecordRevision, verwerkDiversionsOpslag, verwerkUpdatesOpslag } from "./recordWrites.js";
import { bijlagenUitKolom, omleidingBijlagen } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getDiversionsData, getServicesData, getUpdatesData, getUpdateReadCounts, getUpdateReadIdsForUser, getUsersData, logActivity, markUpdatesRead, saveServicesData, uploadUpdateBijlage, verwijderUpdateBijlage, ondertekenUpdateBijlage, zetUpdateBijlagen, uploadDiversionBijlage, verwijderDiversionBijlage, verwijderDiversionLegacyBijlage, verplaatsDiversionLegacyBijlage, ondertekenDiversionBijlage, zetDiversionBijlagen, summarizeServiceChanges, diffServiceChanges } from "../storage.js";
import { COLLECTION_REVISION_HEADER, detectMassDelete, isPlainRecord, massDeleteResponse, newRecordId, recordConflictResponse, recordRevisionMissingResponse, revisionCheck, revisionOf, revisionProbleemResponse, viewUrl } from "./collectie.js";

// --- PDF-bijlagen bij een omleiding (2026-09-25_diversions_bijlagen.sql) ---
// Zelfde afspraak als bij de updates: het bestand staat in de privé bucket
// op een vaste sleutel (`<id>-<slot>.pdf`, slot 1 tot 5) en de URL wordt per
// request ondertekend (bucket privé sinds 2026-07-26_diversions_private.sql:
// een gedeelde link vervalt i.p.v. eeuwig te blijven werken voor
// ex-medewerkers). De kolom `bijlagen` zegt alleen wát er hangt, nooit waar,
// zodat een planner geen externe link als "de PDF van deze omleiding" kan
// laten doorgaan (controle 05-09, nr. 28). Een PDF van vóór 25-09 hangt op
// `<id>.pdf` en telt als slot 1 zolang de rij geen lijst heeft
// (omleidingBijlagen in api/helpers.ts).

/** Elke bijlage een verse, ondertekende URL geven; wat niet te ondertekenen
 *  is (bestand weg) valt uit de lijst in plaats van als dode link mee te
 *  gaan. De marker "pdfUrl" verlaat de server nooit. */
const metOndertekendeOmleidingBijlagen = async (diversions: any[]): Promise<any[]> =>
  Promise.all(
    diversions.map(async (d: any) => {
      const { pdfUrl: _marker, bijlagen: _kolom, ...rest } = d ?? {};
      if (!d?.id) return rest;
      const bijlagen = (
        await Promise.all(
          omleidingBijlagen(d).map(async ({ legacy, ...b }) => {
            const url = await ondertekenDiversionBijlage(String(d.id), b.slot, Boolean(legacy));
            return url ? { ...b, url } : null;
          }),
        )
      ).filter(Boolean);
      return bijlagen.length > 0 ? { ...rest, bijlagen } : rest;
    }),
  );

/**
 * Bij het schrijven van een omleiding komen de bijlagen nooit van de client:
 * het schema accepteert `bijlagen` alleen omdat het formulier het record
 * heen en terug stuurt. We houden wat er al bij het record hoort (de lijst
 * én de oude marker), zodat een gewone save de PDF's met rust laat; alleen
 * de upload- en verwijderroutes hieronder schrijven de lijst.
 */
const metBewaardeBijlagen = <T extends { id: string }>(record: T, huidig?: { pdfUrl?: string; bijlagen?: unknown } | null): T => {
  const { bijlagen: _client, pdfUrl: _clientMarker, ...rest } = record as T & { bijlagen?: unknown; pdfUrl?: unknown };
  return {
    ...rest,
    ...(huidig?.pdfUrl ? { pdfUrl: huidig.pdfUrl } : {}),
    ...(Array.isArray(huidig?.bijlagen) && huidig.bijlagen.length > 0 ? { bijlagen: huidig.bijlagen } : {}),
  } as T;
};

/** Ruim onder de 5 MB die express.json aankan, na base64-opslag (+33 %). */
const MAX_PDF_BIJLAGE_BYTES = 4 * 1024 * 1024;

/** Body van een PDF-upload lezen en controleren (updates en omleidingen):
 *  slot binnen bereik, bestandsnaam op .pdf, base64 data-URL, niet leeg en
 *  niet te groot. Geeft de fout met status terug, of de buffer. */
const leesPdfUpload = (
  body: any,
  maxSlot: number,
): { fout: { status: number; error: string } } | { slot: number; filename: string; buffer: Buffer } => {
  const slot = Number(body?.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > maxSlot) {
    return { fout: { status: 400, error: maxSlot === 2 ? "Kies plaats 1 of 2." : `Kies een plaats van 1 tot ${maxSlot}.` } };
  }
  const filename = String(body?.filename || "").trim();
  if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
    return { fout: { status: 400, error: "Geef een PDF-bestand met een .pdf extensie." } };
  }
  const base64Match = String(body?.dataUrl || "").match(/^data:application\/pdf;base64,(.+)$/);
  if (!base64Match) return { fout: { status: 400, error: "Bestand is geen geldige PDF (base64 data URL verwacht)." } };
  const buffer = Buffer.from(base64Match[1], "base64");
  if (buffer.length === 0) return { fout: { status: 400, error: "Bestand is leeg." } };
  if (buffer.length > MAX_PDF_BIJLAGE_BYTES) {
    return { fout: { status: 413, error: `Bestand is te groot (max ${Math.round(MAX_PDF_BIJLAGE_BYTES / (1024 * 1024))} MB).` } };
  }
  return { slot, filename, buffer };
};

/** Vóór de lijst van een omleiding geschreven wordt: hangt er nog een PDF
 *  van vóór 25-09 op `<id>.pdf` die blijft (niet het slot dat nu vervangen
 *  of verwijderd wordt), verhuis die dan naar `<id>-1.pdf`, want de lijst
 *  kent geen oude sleutel. Geeft de lijst terug zonder de legacy-vlag. */
const zonderLegacy = async (
  id: string,
  bestaande: ReturnType<typeof omleidingBijlagen>,
  slotDatWeggaat: number,
): Promise<Array<{ slot: number; filename: string; sizeBytes?: number }>> => {
  const blijvend = bestaande.filter((b) => b.slot !== slotDatWeggaat);
  if (blijvend.some((b) => b.legacy)) await verplaatsDiversionLegacyBijlage(id);
  return blijvend.map(({ legacy: _l, ...b }) => b);
};

// Strak formaat op een record-id dat rechtstreeks de storage-sleutel wordt:
// zonder deze check kon '../iets' naar een andere plek in de bucket schrijven.
const STORAGE_ID = /^[a-zA-Z0-9_-]+$/;

// --- Omleidingen per record ---
// Veldvalidatie (titel, datums, einddatum ≥ startdatum) zit in het gedeelde
// contract: diversionBodySchema via valideerRecord → 400 met veldfouten.
const diversionResponseRecord = async (id: string) => {
  const raw = (await getDiversionsData()).find((d: any) => String(d.id) === id);
  if (!raw) return null;
  const [signed] = await metOndertekendeOmleidingBijlagen([raw]);
  return withRecordRevision(signed, recordRevisionOf(raw));
};

/** Wat POST /api/services over de automatische heropbouw terugmeldt: genoeg
 *  voor een toast die zegt wat er gebeurde, zonder de volledige samenvatting. */
const planningUitkomstVoorAntwoord = (uit: Awaited<ReturnType<typeof heropbouwNaDienstoverzicht>>) => {
  if (uit.status === "bijgewerkt") {
    return {
      status: uit.status,
      generatedShifts: uit.summary.generatedShifts,
      gewijzigdeChauffeurs: uit.gewijzigdeChauffeurs,
      meldingUitgesteld: uit.meldingUitgesteld,
      meldingNaMinuten: ROOSTER_MELDING_RUST_MINUTEN,
    };
  }
  if (uit.status === "ongewijzigd") return { status: uit.status };
  if (uit.status === "geblokkeerd") {
    return { status: uit.status, reden: uit.reden, melding: uit.melding, unknownCodes: uit.unknownCodes, unmatchedDrivers: uit.unmatchedDrivers };
  }
  if (uit.status === "overgeslagen") return { status: uit.status, reden: uit.reden, melding: uit.melding };
  return { status: uit.status, melding: uit.melding };
};

// --- PDF-bijlagen bij een update (2026-09-21_updates_bijlagen.sql) ---
// Zelfde afspraak als bij de omleidingen: het bestand staat in een privé
// bucket op een vaste sleutel (`<id>-<slot>.pdf`) en de URL wordt per
// request ondertekend. De kolom `bijlagen` zegt alleen wát er hangt
// (bestandsnaam, grootte), nooit waar het staat, zodat een planner geen
// externe link als "de PDF van deze update" kan laten doorgaan.
/** Elke bijlage een verse, ondertekende URL geven; wat niet te ondertekenen
 *  is (bestand weg) valt uit de lijst in plaats van als dode link mee te gaan. */
const metOndertekendeBijlagen = async (updates: any[]): Promise<any[]> =>
  Promise.all(
    updates.map(async (u: any) => {
      if (!Array.isArray(u?.bijlagen) || u.bijlagen.length === 0) return u;
      const bijlagen = (
        await Promise.all(
          u.bijlagen.map(async (b: any) => {
            const url = await ondertekenUpdateBijlage(String(u.id), Number(b.slot));
            return url ? { ...b, url } : null;
          }),
        )
      ).filter(Boolean);
      return bijlagen.length > 0 ? { ...u, bijlagen } : { ...u, bijlagen: undefined };
    }),
  );

// --- Updates per record ---
// Veldvalidatie (titel, inhoud, datum) zit in het gedeelde contract:
// updateBodySchema via valideerRecord → 400 met veldfouten.
const updateResponseRecord = async (id: string) => {
  const u = (await getUpdatesData()).find((x: any) => String(x.id) === id);
  return u ? withRecordRevision(u, recordRevisionOf(u)) : null;
};

// PDF bij een update zetten: een base64 data-URL in de body, een strak id
// (de sleutel in de bucket) en upsert, zodat opnieuw uploaden het vorige
// bestand vervangt. Zelfde vorm als bij de omleidingen (leesPdfUpload).

export function mountCommunicatieRoutes(app: express.Express) {
  app.get("/api/diversions", authenticate, async (_req, res) => {
    try {
      const data = await getDiversionsData();
      // Revisie op de rauwe data: de ondertekende URL's wisselen per request en
      // zouden de optimistische-concurrency-hash anders elke keer veranderen.
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
      // `_rev` per record over de rauwe rij (vóór het ondertekenen, zelfde reden).
      const revs = data.map((d: any) => recordRevisionOf(d));
      res.json((await metOndertekendeOmleidingBijlagen(data)).map((d: any, i: number) => withRecordRevision(d, revs[i])));
    } catch (err) {
      console.error("Error reading diversions data:", err);
      res.status(500).json({ error: "Gegevens laden is mislukt." });
    }
  });

  app.post("/api/diversions", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        // Gedeeld contract (shared/schemas/diversion.ts): 400 met veldfouten per rij.
        if (!valideerLijst(res, diversionLijstSchema, newData, (d: any) => d?.title)) return;
        const previousDiversions = await getDiversionsData();
        { const rp = revisionCheck(req, previousDiversions); if (rp) return revisionProbleemResponse(res, "De omleidingen", rp); }
        const diversionsRemoved = detectMassDelete(previousDiversions, newData);
        if (diversionsRemoved !== null) return massDeleteResponse(res, diversionsRemoved, previousDiversions.length, "omleidingen");
        // Bijlagen komen uit Storage, nooit van de client (zie metBewaardeBijlagen).
        const huidigById = new Map(previousDiversions.map((d: any) => [String(d.id), d]));
        const genormaliseerd = newData.map((d: any) => metBewaardeBijlagen({ ...d, id: String(d.id) }, huidigById.get(String(d.id))));
        await verwerkDiversionsOpslag(req as AuthenticatedRequest, previousDiversions, genormaliseerd);

        res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
        res.json({ success: true, count: newData.length });
      } else {
        res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      }
    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error("Error saving diversions data:", errorMessage);
      console.error("Opslaan is mislukt.", errorMessage);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  app.post("/api/diversions/one", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const body = req.body;
      if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één omleiding verwacht." });
      if (!valideerRecord(res, diversionBodySchema, body)) return;
      const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : newRecordId();
      const previousDiversions = await getDiversionsData();
      if (previousDiversions.some((d: any) => String(d.id) === id)) {
        return res.status(409).json({ error: "Er bestaat al een omleiding met dit id.", conflict: "exists" });
      }
      const record = metBewaardeBijlagen({ ...body, id });
      await verwerkDiversionsOpslag(req, previousDiversions, [...previousDiversions, record], { samenvatting: false, herstel: String(req.get("x-herstel") ?? "") === "1" });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
      res.status(201).json({ success: true, diversion: await diversionResponseRecord(id) });
    } catch (err: any) {
      console.error("Omleiding toevoegen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  app.put("/api/diversions/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const body = req.body;
      if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één omleiding verwacht." });
      if (!valideerRecord(res, diversionBodySchema, body)) return;
      const rev = requestedRecordRevision(req);
      if (!rev) return recordRevisionMissingResponse(res);
      const previousDiversions = await getDiversionsData();
      const current = previousDiversions.find((d: any) => String(d.id) === id);
      if (!current) return res.status(404).json({ error: "Omleiding niet gevonden, mogelijk intussen verwijderd." });
      if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze omleiding", withRecordRevision(current, recordRevisionOf(current)));
      const record = metBewaardeBijlagen({ ...body, id }, current);
      const newData = previousDiversions.map((d: any) => (String(d.id) === id ? record : d));
      await verwerkDiversionsOpslag(req, previousDiversions, newData, { samenvatting: false });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
      res.json({ success: true, diversion: await diversionResponseRecord(id) });
    } catch (err: any) {
      console.error("Omleiding opslaan is mislukt.", err?.message || err);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  app.delete("/api/diversions/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const rev = requestedRecordRevision(req);
      if (!rev) return recordRevisionMissingResponse(res);
      const previousDiversions = await getDiversionsData();
      const current = previousDiversions.find((d: any) => String(d.id) === id);
      if (!current) return res.status(404).json({ error: "Omleiding niet gevonden, mogelijk al verwijderd." });
      if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze omleiding", withRecordRevision(current, recordRevisionOf(current)));
      await verwerkDiversionsOpslag(req, previousDiversions, previousDiversions.filter((d: any) => String(d.id) !== id), { samenvatting: false });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Omleiding verwijderen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Verwijderen is mislukt." });
    }
  });

  app.post("/api/diversions/:id/bijlage", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id || !STORAGE_ID.test(id)) return res.status(400).json({ error: "Ongeldig omleiding-id." });
      const upload = leesPdfUpload(req.body, MAX_OMLEIDING_BIJLAGEN);
      if ("fout" in upload) return res.status(upload.fout.status).json({ error: upload.fout.error });
      const { slot, filename, buffer } = upload;

      const huidig = (await getDiversionsData()).find((d: any) => String(d.id) === id);
      if (!huidig) return res.status(404).json({ error: "Omleiding niet gevonden, mogelijk intussen verwijderd." });

      const bestaande = omleidingBijlagen(huidig);
      // Eerst de oude sleutel afhandelen, dan pas uploaden en de lijst
      // schrijven: faalt de verhuis, dan is er nog niets veranderd.
      const blijvend = await zonderLegacy(id, bestaande, slot);
      await uploadDiversionBijlage(id, slot, buffer);
      // Een PDF van vóór 25-09 op slot 1 wordt hier vervangen: alleen de oude
      // sleutel mag weg (de lijst hieronder wijst naar `<id>-1.pdf`).
      if (bestaande.some((b) => b.slot === slot && b.legacy)) {
        await verwijderDiversionLegacyBijlage(id).catch(() => undefined);
      }
      const lijst = [...blijvend, { slot, filename, sizeBytes: buffer.length }].sort((a, b) => a.slot - b.slot);
      await zetDiversionBijlagen(id, lijst);
      await logActivity(req, "diversions", "Bijlage toegevoegd", `${filename} bij omleiding "${huidig.title}".`, { type: "diversion", id });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
      res.json({ success: true, diversion: await diversionResponseRecord(id) });
    } catch (err: any) {
      if (isMissingColumnError(err)) {
        return res.status(503).json({ error: "De kolom voor bijlagen bestaat nog niet: draai supabase/2026-09-25_diversions_bijlagen.sql in de SQL Editor." });
      }
      console.error("Bijlage bij omleiding opslaan is mislukt.", err?.message || err);
      res.status(500).json({ error: "Kon de PDF niet opslaan." });
    }
  });

  app.delete("/api/diversions/:id/bijlage/:slot", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id || !STORAGE_ID.test(id)) return res.status(400).json({ error: "Ongeldig omleiding-id." });
      const slot = Number(req.params.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > MAX_OMLEIDING_BIJLAGEN) {
        return res.status(400).json({ error: `Kies een plaats van 1 tot ${MAX_OMLEIDING_BIJLAGEN}.` });
      }
      const huidig = (await getDiversionsData()).find((d: any) => String(d.id) === id);
      if (!huidig) return res.status(404).json({ error: "Omleiding niet gevonden, mogelijk intussen verwijderd." });

      const bestaande = omleidingBijlagen(huidig);
      const weg = bestaande.find((b) => b.slot === slot);
      const lijst = await zonderLegacy(id, bestaande, slot);
      await verwijderDiversionBijlage(id, slot, { legacy: Boolean(weg?.legacy) });
      await zetDiversionBijlagen(id, lijst);
      await logActivity(req, "diversions", "Bijlage verwijderd", `${weg?.filename ?? `Bijlage ${slot}`} bij omleiding "${huidig.title}".`, { type: "diversion", id });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getDiversionsData()));
      res.json({ success: true, diversion: await diversionResponseRecord(id) });
    } catch (err: any) {
      if (isMissingColumnError(err)) {
        return res.status(503).json({ error: "De kolom voor bijlagen bestaat nog niet: draai supabase/2026-09-25_diversions_bijlagen.sql in de SQL Editor." });
      }
      console.error("Bijlage bij omleiding verwijderen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Kon de PDF niet verwijderen." });
    }
  });

  // Alleen planner en admin (23-09, Jarno): het leesrecht voor elke rol was
  // een overblijfsel van toen chauffeurs het Dienstoverzicht nog zagen (tot
  // 26-04); geen chauffeur- of techniekerscherm vraagt deze lijst op.
  app.get("/api/services", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const data = await getServicesData();
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
      res.json(data);
    } catch (err) {
      console.error("Error reading services data:", err);
      res.status(500).json({ error: "Gegevens laden is mislukt." });
    }
  });

  app.post("/api/services", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        const previousServices = await getServicesData();
        // De import-flow in dienstoverzicht-beheer vervangt legitiem de hele
        // collectie (verse ids per upload) en meldt dat expliciet via header.
        const isBulkReplace = req.headers["x-bulk-replace"] === "1";
        // De volledige-vervang-import is in de UI admin-only; dwing dat ook
        // server-side af (de header omzeilt anders de wipe-vangrail).
        if (isBulkReplace && req.appUser?.role !== "admin") {
          return res.status(403).json({ error: "Bulk-import van het dienstoverzicht is alleen voor admins." });
        }
        // Eén diff, vóór de opslag: voor de autorisatie hieronder én voor de
        // per-dienst logregels erna.
        const diff = diffServiceChanges(previousServices, newData);
        if (!isBulkReplace) {
          // Bulk-import vervangt bewust de hele collectie → revisie-/wipe-checks
          // alleen voor gewone bewerkingen.
          { const rp = revisionCheck(req, previousServices); if (rp) return revisionProbleemResponse(res, "Het dienstoverzicht", rp); }
          // Diensten verwijderen is in de UI admin-only (ManageServicesView:
          // geen "Verwijderen" in het rijmenu voor een planner). De server
          // hield dat tot 22-09 niet tegen: een planner kon met een
          // handgemaakte POST zonder die dienst toch verwijderen. Nu geldt
          // dezelfde grens hier (beslissing Jarno, ronde 5, Dienstoverzicht §6).
          if (diff.removed.length > 0 && req.appUser?.role !== "admin") {
            return res.status(403).json({ error: "Diensten verwijderen is alleen beschikbaar voor admins." });
          }
          const servicesRemoved = detectMassDelete(previousServices, newData);
          if (servicesRemoved !== null) return massDeleteResponse(res, servicesRemoved, previousServices.length, "diensten");
        }
        await saveServicesData(newData);
        // Eén lezing van wat er nu écht staat (genormaliseerd door de opslag):
        // voor de revisie-header én om te beslissen of de planning mee moet.
        const opgeslagen = await getServicesData();

        // Global summary entry (zoals voorheen)
        await logActivity(
          req,
          "services",
          "Diensten opgeslagen",
          `${newData.length} diensten opgeslagen. ${summarizeServiceChanges(previousServices, newData)}.`,
        );

        // Per-service entries voor per-entity wijzigingsgeschiedenis
        const formatService = (s: typeof newData[number]) =>
          `Dienst ${s.serviceNumber} (${s.startTime}–${s.endTime}${s.startTime2 ? `, ${s.startTime2}–${s.endTime2}` : ''}${s.startTime3 ? `, ${s.startTime3}–${s.endTime3}` : ''}).`;
        for (const s of diff.added) {
          await logActivity(req, "services", "Dienst toegevoegd", formatService(s), { type: "service", id: s.id });
        }
        for (const s of diff.changed) {
          await logActivity(req, "services", "Dienst gewijzigd", formatService(s), { type: "service", id: s.id });
        }
        for (const s of diff.removed) {
          await logActivity(req, "services", "Dienst verwijderd", formatService(s), { type: "service", id: s.id });
        }

        // Planning automatisch bijwerken (Jarno 20-09): de tijden, delen en
        // loopnummers uit het dienstoverzicht komen anders pas bij de chauffeurs
        // na een klik op "Planning opnieuw opbouwen". Alleen bij een inhoudelijk
        // verschil; de save hierboven is op dit punt al geslaagd en blijft dat,
        // wat de heropbouw ook doet (heropbouwNaDienstoverzicht gooit nooit).
        const planning = dienstenVerschillenVoorPlanning(previousServices as any[], opgeslagen as any[])
          ? planningUitkomstVoorAntwoord(await heropbouwNaDienstoverzicht(req))
          : { status: "niet-nodig" as const };

        res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(opgeslagen));
        res.json({ success: true, count: newData.length, planning });
      } else {
        res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      }
    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error("Error saving services data:", errorMessage);
      console.error("Opslaan is mislukt.", errorMessage);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  app.get("/api/updates", authenticate, async (_req, res) => {
    try {
      const data = await getUpdatesData();
      // Revisie over de opgeslagen vorm (zonder ondertekende URL's): die
      // veranderen elke 12 uur en zouden anders elke fetch een valse wijziging
      // opleveren.
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
      const metUrls = await metOndertekendeBijlagen(data);
      res.json(metUrls.map((u: any, i: number) => withRecordRevision(u, recordRevisionOf(data[i]))));
    } catch (err) {
      res.status(500).json({ error: "Updates laden is mislukt." });
    }
  });

  app.post("/api/updates", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const newData = req.body;
      // Zonder deze guard normaliseerde saveUpdatesData een niet-array naar []
      // en wiste vervolgens ALLE updates — met een vrolijke success-response.
      if (!Array.isArray(newData)) {
        return res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      }
      // Gedeeld contract (shared/schemas/update.ts): 400 met veldfouten per rij.
      if (!valideerLijst(res, updateLijstSchema, newData, (u: any) => u?.title)) return;
      const previousUpdates = await getUpdatesData();
      { const rp = revisionCheck(req, previousUpdates); if (rp) return revisionProbleemResponse(res, "De updates", rp); }
      const updatesRemoved = detectMassDelete(previousUpdates, newData);
      if (updatesRemoved !== null) return massDeleteResponse(res, updatesRemoved, previousUpdates.length, "updates");
      await verwerkUpdatesOpslag(req as AuthenticatedRequest, previousUpdates, newData, { pushUrl: viewUrl("updates") });

      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Updates opslaan is mislukt.", err);
      res.status(500).json({ error: "Updates opslaan is mislukt." });
    }
  });

  app.post("/api/updates/one", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const body = req.body;
      if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één update verwacht." });
      if (!valideerRecord(res, updateBodySchema, body)) return;
      const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : newRecordId();
      const previousUpdates = await getUpdatesData();
      if (previousUpdates.some((u: any) => String(u.id) === id)) {
        return res.status(409).json({ error: "Er bestaat al een update met dit id.", conflict: "exists" });
      }
      // Nieuwste bovenaan, zoals de UI de lijst opbouwt.
      // X-Herstel: 1 = "Ongedaan maken" na verwijderen → geen tweede push.
      const herstel = String(req.get("x-herstel") ?? "") === "1";
      await verwerkUpdatesOpslag(req, previousUpdates, [{ ...body, id }, ...previousUpdates], { samenvatting: false, herstel, pushUrl: viewUrl("updates") });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
      res.status(201).json({ success: true, update: await updateResponseRecord(id) });
    } catch (err: any) {
      console.error("Update toevoegen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Updates opslaan is mislukt." });
    }
  });

  app.put("/api/updates/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const body = req.body;
      if (!isPlainRecord(body)) return res.status(400).json({ error: "Ongeldig formaat: één update verwacht." });
      if (!valideerRecord(res, updateBodySchema, body)) return;
      const rev = requestedRecordRevision(req);
      if (!rev) return recordRevisionMissingResponse(res);
      const previousUpdates = await getUpdatesData();
      const current = previousUpdates.find((u: any) => String(u.id) === id);
      if (!current) return res.status(404).json({ error: "Update niet gevonden, mogelijk intussen verwijderd." });
      if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze update", withRecordRevision(current, recordRevisionOf(current)));
      const newData = previousUpdates.map((u: any) => (String(u.id) === id ? { ...body, id } : u));
      await verwerkUpdatesOpslag(req, previousUpdates, newData, { samenvatting: false, pushUrl: viewUrl("updates") });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
      res.json({ success: true, update: await updateResponseRecord(id) });
    } catch (err: any) {
      console.error("Update opslaan is mislukt.", err?.message || err);
      res.status(500).json({ error: "Updates opslaan is mislukt." });
    }
  });

  app.post("/api/updates/:id/bijlage", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id || "").trim();
      // Strak formaat: het id wordt rechtstreeks de storage-sleutel, dus zonder
      // deze check kon '../iets' naar een andere plek in de bucket schrijven.
      if (!id || !STORAGE_ID.test(id)) return res.status(400).json({ error: "Ongeldig update-id." });
      const upload = leesPdfUpload(req.body, MAX_UPDATE_BIJLAGEN);
      if ("fout" in upload) return res.status(upload.fout.status).json({ error: upload.fout.error });
      const { slot, filename, buffer } = upload;

      const updates = await getUpdatesData();
      const huidig = updates.find((u: any) => String(u.id) === id);
      if (!huidig) return res.status(404).json({ error: "Update niet gevonden, mogelijk intussen verwijderd." });

      await uploadUpdateBijlage(id, slot, buffer);

      const lijst = [
        ...bijlagenUitKolom((huidig as any).bijlagen).filter((b) => b.slot !== slot),
        { slot, filename, sizeBytes: buffer.length },
      ].sort((a, b) => a.slot - b.slot);
      await zetUpdateBijlagen(id, lijst);
      await logActivity(req, "updates", "Bijlage toegevoegd", `${filename} bij update "${huidig.title}".`, { type: "update", id });
      res.json({ success: true, update: await updateResponseRecord(id) });
    } catch (err: any) {
      if (isMissingColumnError(err)) {
        return res.status(503).json({ error: "De kolommen voor bijlagen bestaan nog niet: draai supabase/2026-09-21_updates_bijlagen.sql in de SQL Editor." });
      }
      console.error("Bijlage bij update opslaan is mislukt.", err?.message || err);
      res.status(500).json({ error: "Kon de PDF niet opslaan." });
    }
  });

  app.delete("/api/updates/:id/bijlage/:slot", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id || !STORAGE_ID.test(id)) return res.status(400).json({ error: "Ongeldig update-id." });
      const slot = Number(req.params.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > MAX_UPDATE_BIJLAGEN) {
        return res.status(400).json({ error: `Kies plaats 1 of ${MAX_UPDATE_BIJLAGEN}.` });
      }
      const updates = await getUpdatesData();
      const huidig = updates.find((u: any) => String(u.id) === id);
      if (!huidig) return res.status(404).json({ error: "Update niet gevonden, mogelijk intussen verwijderd." });

      await verwijderUpdateBijlage(id, slot);

      const lijst = bijlagenUitKolom((huidig as any).bijlagen).filter((b) => b.slot !== slot);
      await zetUpdateBijlagen(id, lijst);
      await logActivity(req, "updates", "Bijlage verwijderd", `Bijlage ${slot} bij update "${huidig.title}".`, { type: "update", id });
      res.json({ success: true, update: await updateResponseRecord(id) });
    } catch (err: any) {
      if (isMissingColumnError(err)) {
        return res.status(503).json({ error: "De kolommen voor bijlagen bestaan nog niet: draai supabase/2026-09-21_updates_bijlagen.sql in de SQL Editor." });
      }
      console.error("Bijlage bij update verwijderen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Kon de PDF niet verwijderen." });
    }
  });

  app.delete("/api/updates/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const rev = requestedRecordRevision(req);
      if (!rev) return recordRevisionMissingResponse(res);
      const previousUpdates = await getUpdatesData();
      const current = previousUpdates.find((u: any) => String(u.id) === id);
      if (!current) return res.status(404).json({ error: "Update niet gevonden, mogelijk al verwijderd." });
      if (rev !== recordRevisionOf(current)) return recordConflictResponse(res, "Deze update", withRecordRevision(current, recordRevisionOf(current)));
      await verwerkUpdatesOpslag(req, previousUpdates, previousUpdates.filter((u: any) => String(u.id) !== id), { samenvatting: false, pushUrl: viewUrl("updates") });
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getUpdatesData()));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Update verwijderen is mislukt.", err?.message || err);
      res.status(500).json({ error: "Updates opslaan is mislukt." });
    }
  });

  // Chauffeur bevestigt gelezen: de Updates-weergave meldt de zichtbare updates
  // bij het openen. Idempotent — al-gelezen combinaties zijn een no-op.
  app.post("/api/updates/read", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      // De teller telt alléén chauffeurs (zij zijn de doelgroep). Een planner/
      // admin die de Updates-weergave opent mag de cijfers niet flatteren, dus
      // registreren we hun reads niet.
      // Bewust `=== "chauffeur"`: de teller gaat over rijdend personeel, dus
      // ook een technieker telt hier niet mee.
      if (req.appUser!.role !== "chauffeur") return res.json({ success: true });
      const ids = Array.isArray(req.body?.updateIds) ? req.body.updateIds.map((id: unknown) => String(id)) : [];
      if (ids.length === 0) return res.json({ success: true });
      await markUpdatesRead(String(req.appUser!.id), ids);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Leesbevestiging opslaan is mislukt.", err);
      res.status(500).json({ error: "Leesbevestiging opslaan is mislukt." });
    }
  });

  // Eigen leesstaat: welke updates deze gebruiker al opende of bevestigde. De
  // client toont daarmee de knop "Gelezen en begrepen" niet opnieuw en markeert
  // niet dubbel. `telt` = false voor staf (hun reads slaan we hierboven niet op).
  app.get("/api/updates/read", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const telt = req.appUser!.role === "chauffeur";
      const ids = telt ? await getUpdateReadIdsForUser(String(req.appUser!.id)) : [];
      res.json({ ids, telt });
    } catch (err: any) {
      console.error("Leesstaat laden is mislukt.", err);
      res.status(500).json({ error: "Leesstaat laden is mislukt." });
    }
  });

  // Planner-teller: hoeveel (van de actieve) chauffeurs elke update gelezen heeft.
  app.get("/api/updates/read-counts", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const users = await getUsersData();
      // Alleen actieve chauffeurs tellen mee — zowel in de noemer als, via de
      // id-set, in de teller (defensief tegen oude reads van wie intussen geen
      // actieve chauffeur meer is, zodat je nooit "8/6 gelezen" ziet).
      const chauffeurIds = new Set(
        users.filter((u) => u.role === "chauffeur" && u.isActive !== false).map((u) => String(u.id)),
      );
      const counts = await getUpdateReadCounts(chauffeurIds);
      res.json({ counts, totalChauffeurs: chauffeurIds.size });
    } catch (err: any) {
      console.error("Leestellers laden is mislukt.", err);
      res.status(500).json({ error: "Leestellers laden is mislukt." });
    }
  });

  app.post("/api/send-urgent-update-email", authenticate, requireRole("planner", "admin"), urgentEmailRateLimit, async (req: AuthenticatedRequest, res) => {
    const { update } = req.body;

    if (!update || !update.title) {
      return res.status(400).json({ error: "Missing update" });
    }

    // Ontvangers ALTIJD server-side bepalen (nooit uit de request-body): anders
    // kon een planner/admin de bedrijfs-SMTP als relay naar willekeurige externe
    // adressen gebruiken. De mail gaat naar wie een e-mailadres heeft; de push
    // naar álle actieve gebruikers (ook e-mailloze chauffeurs — het is dringend).
    const allUsers = await getUsersData();
    const activeUsers = allUsers.filter((u) => u.isActive !== false);
    const emails = activeUsers.map((u) => u.email).filter(Boolean) as string[];

    // Push naar álle actieve gebruikers (ook wie geen e-mail heeft) — best-effort.
    await sendPushToUsers(
      activeUsers.map((u) => String(u.id)).filter(Boolean),
      // Naar het bericht zelf (/updates/<id>) zodra er een id is: de melding
      // en de push-tik landen dan op dat item (useRecordParam in UpdatesView).
      { title: `🚨 ${update.title}`, body: String(update.content || "").slice(0, 180), url: update.id ? recordUrl("updates", String(update.id)) : viewUrl("updates"), soort: "update" },
    );

    if (emails.length === 0) {
      return res.json({ success: true, message: "No recipients with email found" });
    }

    // Via de gedeelde sendEmail-helper (api/email.ts): één SMTP-configuratie
    // en één mock-pad i.p.v. een eigen transporter per route. Op de vaste
    // lay-out; de knop landt op het bericht zelf zodra er een id is.
    const doelPad = update.id ? recordUrl("updates", String(update.id)) : viewUrl("updates");
    const { html, text } = mailOpbouw({
      kicker: "Dringende update",
      titel: String(update.title),
      status: { label: "Dringend, lees dit vandaag", toon: "aandacht" },
      // Regeleinden uit het bericht blijven alinea's.
      alineas: String(update.content || "").split(/\n{2,}/).map((a) => a.trim()).filter(Boolean),
      knop: { tekst: "Open de update", url: `${process.env.APP_URL || "https://vhbportaal.com"}${doelPad}` },
      voet: "Bevestig in het portaal met de knop \"Gelezen en begrepen\".",
    });
    const result = await sendEmail({
      to: emails,
      context: "urgent-update",
      soort: "dringende-update",
      door: req.appUser?.name ?? null,
      subject: `Dringende update: ${update.title}`,
      text,
      html,
    });

    if (result.mocked) {
      return res.json({ success: true, message: "Email gelogd (geen SMTP geconfigureerd)", mocked: true });
    }
    if (!result.ok) {
      return res.status(500).json({ error: "Fout bij verzenden email" });
    }
    res.json({ success: true, message: "Emails succesvol verzonden" });
  });
}
