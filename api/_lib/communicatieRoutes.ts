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
import { sendEmail, escapeHtml } from "../email.js";
import { sendPushToUsers } from "../push.js";
import type { AuthenticatedRequest } from "../types.js";
import { db, supabaseAdmin } from "../db.js";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingColumnError } from "../deviceGate.js";
import { urgentEmailRateLimit } from "../rateLimit.js";
import { dienstenVerschillenVoorPlanning, heropbouwNaDienstoverzicht, ROOSTER_MELDING_RUST_MINUTEN } from "./planningHeropbouw.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { diversionBodySchema, diversionLijstSchema } from "../../shared/schemas/diversion.js";
import { MAX_UPDATE_BIJLAGEN, updateBodySchema, updateLijstSchema } from "../../shared/schemas/update.js";
import { recordUrl } from "./meldingen.js";
import { valideerLijst, valideerRecord } from "./valideer.js";
import { recordRevisionOf, withRecordRevision, requestedRecordRevision, verwerkDiversionsOpslag, verwerkUpdatesOpslag } from "./recordWrites.js";
import { bijlagenUitKolom } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getDiversionsData, getServicesData, getUpdatesData, getUpdateReadCounts, getUpdateReadIdsForUser, getUsersData, logActivity, markUpdatesRead, saveServicesData, DIVERSIONS_BUCKET, uploadUpdateBijlage, verwijderUpdateBijlage, ondertekenUpdateBijlage, zetUpdateBijlagen, summarizeServiceChanges, diffServiceChanges } from "../storage.js";
import { COLLECTION_REVISION_HEADER, detectMassDelete, isPlainRecord, massDeleteResponse, newRecordId, recordConflictResponse, recordRevisionMissingResponse, revisionCheck, revisionOf, revisionProbleemResponse, viewUrl } from "./collectie.js";

// Bijlage-URL's zijn kortlevend ondertekend (bucket is privé, zie
// supabase/2026-07-26_diversions_private.sql): een gedeelde link vervalt,
// i.p.v. eeuwig te blijven werken voor ex-medewerkers. Pad is stabiel
// `${id}.pdf`. De opgeslagen pdfUrl is alleen een marker "er is een PDF";
// wat de chauffeur krijgt komt altijd uit de bucket. Mislukt het
// ondertekenen (bestand weg), dan valt de bijlage weg i.p.v. de rauwe
// opgeslagen waarde door te geven — die was vroeger een (nu waardeloze)
// publieke URL en kon, vóór nr. 28 van de controle 05-09, ook een door de
// client opgegeven externe link zijn.
const DIVERSION_URL_TTL_SEC = 60 * 60 * 12;

/** Ondertekende URL van `${id}.pdf`, of undefined als het bestand er niet is. */
const signedDiversionPdfUrl = async (id: string): Promise<string | undefined> => {
  if (!db) return undefined;
  try {
    const { data: signed } = await db.storage
      .from(DIVERSIONS_BUCKET)
      .createSignedUrl(`${id}.pdf`, DIVERSION_URL_TTL_SEC);
    return signed?.signedUrl || undefined;
  } catch {
    return undefined;
  }
};

const withSignedDiversionUrls = async (diversions: any[]): Promise<any[]> =>
  Promise.all(
    diversions.map(async (d) => {
      if (!d?.pdfUrl || !d?.id) return d;
      const { pdfUrl: _bewaard, ...rest } = d;
      const pdfUrl = await signedDiversionPdfUrl(String(d.id));
      return pdfUrl ? { ...rest, pdfUrl } : rest;
    }),
  );

/**
 * Server-side normalisatie van `pdfUrl` bij het schrijven: de clientwaarde
 * wordt genegeerd (het schema accepteert het veld alleen omdat het formulier
 * het record heen en terug stuurt) en afgeleid uit Storage — bestaat
 * `${id}.pdf` (geüpload via POST /api/diversions/pdf), dan een verse
 * ondertekende URL, anders geen pdfUrl. Zo kan een planner nooit een
 * externe link als "officiële PDF" bij een omleiding zetten.
 */
const metServerPdfUrl = async <T extends { id: string; pdfUrl?: string }>(record: T): Promise<T> => {
  const { pdfUrl: _client, ...rest } = record;
  const pdfUrl = await signedDiversionPdfUrl(String(record.id));
  return (pdfUrl ? { ...rest, pdfUrl } : rest) as T;
};

// --- Omleidingen per record ---
// Veldvalidatie (titel, datums, einddatum ≥ startdatum) zit in het gedeelde
// contract: diversionBodySchema via valideerRecord → 400 met veldfouten.
const diversionResponseRecord = async (id: string) => {
  const raw = (await getDiversionsData()).find((d: any) => String(d.id) === id);
  if (!raw) return null;
  const [signed] = await withSignedDiversionUrls([raw]);
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

// PDF bij een update zetten. Zelfde vorm als POST /api/diversions/pdf: een
// base64 data-URL in de body, een strak id (de sleutel in de bucket) en
// upsert, zodat opnieuw uploaden het vorige bestand vervangt.
const MAX_UPDATE_BIJLAGE_BYTES = 4 * 1024 * 1024;

export function mountCommunicatieRoutes(app: express.Express) {
  app.get("/api/diversions", authenticate, async (_req, res) => {
    try {
      const data = await getDiversionsData();
      // Revisie op de rauwe data: de ondertekende URL's wisselen per request en
      // zouden de optimistische-concurrency-hash anders elke keer veranderen.
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
      // `_rev` per record over de rauwe rij (vóór het ondertekenen, zelfde reden).
      const revs = data.map((d: any) => recordRevisionOf(d));
      res.json((await withSignedDiversionUrls(data)).map((d: any, i: number) => withRecordRevision(d, revs[i])));
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
        // pdfUrl komt uit Storage, nooit van de client (zie metServerPdfUrl).
        const genormaliseerd = await Promise.all(newData.map((d: any) => metServerPdfUrl({ ...d, id: String(d.id) })));
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
      const record = await metServerPdfUrl({ ...body, id });
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
      const record = await metServerPdfUrl({ ...body, id });
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

  app.post("/api/diversions/pdf", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
      }

      const id = String(req.body?.id || "").trim();
      const filename = String(req.body?.filename || "").trim();
      const dataUrl = String(req.body?.dataUrl || "");
      // Strak formaat op het id: het wordt rechtstreeks de storage-key
      // (`${id}.pdf`), dus zonder deze check kon een planner met `../iets` naar
      // een afwijkende sleutel schrijven of een bestaand object overschrijven
      // (path-traversal in de diversions-bucket).
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ error: "Ongeldig diversion-id." });
      }
      if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
        return res.status(400).json({ error: "Geef een PDF-bestand met een .pdf extensie." });
      }
      const base64Match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
      if (!base64Match) {
        return res.status(400).json({ error: "Bestand is geen geldige PDF (base64 data URL verwacht)." });
      }
      const buffer = Buffer.from(base64Match[1], "base64");
      if (buffer.length === 0) {
        return res.status(400).json({ error: "Bestand is leeg." });
      }

      // Stable path per diversion: re-uploaden = upsert overschrijft het oude bestand.
      const storagePath = `${id}.pdf`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(DIVERSIONS_BUCKET)
        .upload(storagePath, buffer, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadError) throw uploadError;

      // Ondertekende URL i.p.v. publieke: de bucket is privé. De opgeslagen
      // pdfUrl vervalt, maar GET /api/diversions ondertekent bij élk ophalen
      // opnieuw op basis van `${id}.pdf`, dus de bijlage blijft bereikbaar.
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(DIVERSIONS_BUCKET)
        .createSignedUrl(storagePath, DIVERSION_URL_TTL_SEC);
      if (signError || !signed?.signedUrl) throw signError ?? new Error("Kon geen ondertekende URL maken.");
      res.json({ publicUrl: signed.signedUrl, storagePath, filename, sizeBytes: buffer.length });
    } catch (err: any) {
      console.error("Diversion PDF upload error:", err);
      console.error("Kon PDF niet uploaden.", err);
      res.status(500).json({ error: "Kon PDF niet uploaden." });
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
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: "Ongeldig update-id." });
      const slot = Number(req.body?.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > MAX_UPDATE_BIJLAGEN) {
        return res.status(400).json({ error: `Kies plaats 1 of ${MAX_UPDATE_BIJLAGEN}.` });
      }
      const filename = String(req.body?.filename || "").trim();
      if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
        return res.status(400).json({ error: "Geef een PDF-bestand met een .pdf extensie." });
      }
      const base64Match = String(req.body?.dataUrl || "").match(/^data:application\/pdf;base64,(.+)$/);
      if (!base64Match) return res.status(400).json({ error: "Bestand is geen geldige PDF (base64 data URL verwacht)." });
      const buffer = Buffer.from(base64Match[1], "base64");
      if (buffer.length === 0) return res.status(400).json({ error: "Bestand is leeg." });
      if (buffer.length > MAX_UPDATE_BIJLAGE_BYTES) {
        return res.status(413).json({ error: `Bestand is te groot (max ${Math.round(MAX_UPDATE_BIJLAGE_BYTES / (1024 * 1024))} MB).` });
      }

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
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: "Ongeldig update-id." });
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

  app.post("/api/send-urgent-update-email", authenticate, requireRole("planner", "admin"), urgentEmailRateLimit, async (req, res) => {
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
    // en één mock-pad i.p.v. een eigen transporter per route.
    const result = await sendEmail({
      to: emails,
      context: "urgent-update",
      subject: `DRINGENDE UPDATE: ${update.title}`,
      text: `${update.content}\n\nBekijk de volledige update in het VHB Portaal.`,
      html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #f59e0b; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">DRINGENDE UPDATE</h1>
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #1e293b; margin-top: 0;">${escapeHtml(update.title)}</h2>
          <p style="color: #475569; line-height: 1.6;">${escapeHtml(update.content)}</p>
          <div style="margin-top: 30px; text-align: center;">
            <a href="${process.env.APP_URL || '#'}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Open VHB Portaal</a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 15px; text-align: center; font-size: 12px; color: #94a3b8;">
          Dit is een automatisch bericht van het VHB Portaal.
        </div>
      </div>
    `,
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
