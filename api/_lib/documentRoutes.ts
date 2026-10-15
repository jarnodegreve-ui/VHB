/**
 * Ritbladen en persoonlijke documenten (Supabase Storage, ondertekende URL's).
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import crypto from "node:crypto";
import { sendPushToUsers } from "../push.js";
import type { AuthenticatedRequest } from "../types.js";
import { db, supabaseAdmin } from "../db.js";
import { authenticate, requireRole } from "../middleware.js";
import { metPdfTitel } from "./pdfTitel.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getUsersData, logActivity, listUserDocuments, ondertekenDocumenten, markUserDocumentOpened, getUserDocument, insertUserDocument, deleteUserDocument, DOCUMENTS_BUCKET, MigratieOntbreektError, getDienstregelingen, getRitbladRijen, saveRitbladRij, deleteRitbladRij, uploadRitbladBestand, verwijderRitbladBestand, ondertekenRitblad, type RitbladRij } from "../storage.js";
import { viewUrl } from "./collectie.js";
import { DAG_DMJ, brusselsDay } from "../helpers.js";
import { hoortBijVersie, oudsteVersie, versieGeldigTot, versieLabel, versieStatus, versieVoorDatum } from "../../shared/dienstregeling.js";
import { bundelsPerVersie, kiesRitblad } from "./ritbladKeuze.js";

// --- Ritbladen: één bundel per dienstregelingversie (13-10, keuzes Jarno) ---
//
// Tot 13-10 was er één bundel (rij 'current'). Nu hangt elke bundel aan een
// versie uit public.dienstregelingen (kolom dienstregeling_id; null = de rij
// van vóór de migratie, die als de oudste versie telt). Per dag geldt de
// bundel van de versie die op die dag geldt (api/_lib/ritbladKeuze.ts); een
// toekomstige bundel is vooraf te bekijken en de vorige blijft zolang haar
// versie bestaat. De opslag (tabel én bucket) zit in api/_lib/opslag/documenten.ts.

// Was 30 dagen: die URL werd ook nog in localStorage bewaard, dus een
// geblokkeerd toestel hield wekenlang toegang tot het bedrijfsritblad. De
// client haalt de URL bij elk bezoek vers op, dus een uur is genoeg.
const RITBLAADJE_URL_TTL_SEC = 60 * 60;

const vandaag = () => brusselsDay(new Date().toISOString());
const datumUitQuery = (req: express.Request): string | null => {
  const d = req.query.datum;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};
const versieUitQuery = (req: express.Request): string | null => (typeof req.query.versie === "string" && req.query.versie.trim() ? req.query.versie.trim() : null);

type Versies = Awaited<ReturnType<typeof getDienstregelingen>>;
const versiePublic = (versies: Versies, v: Versies[number], dag: string) => ({
  id: v.id, naam: v.naam, geldigVanaf: v.geldigVanaf, geldigTot: versieGeldigTot(versies, v), status: versieStatus(versies, v, dag),
});
/** Eén ondertekening per bestand per request: de lijst noemt dezelfde bundel soms twee keer. */
const maakOndertekenaar = () => {
  const cache = new Map<string, Promise<string>>();
  return async (rij: RitbladRij) => {
    let url = cache.get(rij.storagePath);
    if (!url) { url = ondertekenRitblad(rij.storagePath, RITBLAADJE_URL_TTL_SEC); cache.set(rij.storagePath, url); }
    return {
      filename: rij.filename, storagePath: rij.storagePath, uploadedAt: rij.uploadedAt, uploadedBy: rij.uploadedBy, sizeBytes: rij.sizeBytes,
      dienstregelingId: rij.dienstregelingId, url: await url,
    };
  };
};
const laadRitbladen = async () => {
  const [versies, rijen] = await Promise.all([getDienstregelingen(), getRitbladRijen()]);
  return { versies, rijen };
};
class VersieOnbekend extends Error {}
/** De versie waar een upload of verwijdering op slaat: ?versie=, anders die
 *  van vandaag; null zonder versies (migratie van 08-10 niet gedraaid). */
const doelVersie = (versies: Versies, req: express.Request, dag: string): Versies[number] | null => {
  if (versies.length === 0) return null;
  const id = versieUitQuery(req);
  if (!id) return versieVoorDatum(versies, dag);
  const v = versies.find((x) => x.id === id);
  if (!v) throw new VersieOnbekend(id);
  return v;
};
/** De bundel die bij `versie` hoort (of de rij 'current' zonder versies). */
const bundelVan = (versies: Versies, rijen: RitbladRij[], versie: Versies[number] | null): RitbladRij | null => {
  if (!versie) return rijen.find((r) => r.id === "current") ?? rijen[0] ?? null;
  const oudsteId = oudsteVersie(versies)?.id ?? null;
  return rijen.find((r) => hoortBijVersie(r, versie.id, oudsteId)) ?? null;
};

// --- Documenten per gebruiker (attesten, reglement, loonbrieven) ---
// Zelfde beveiligingspatroon als de ritbladen: privé bucket, ondertekende
// URL's uit de API. Chauffeurs zien alleen hun eigen documenten.
// Kort houden: een signed URL omzeilt authenticate, de toestel-whitelist én
// accountdeactivatie. Met 7 dagen hield een geblokkeerde/vertrokken chauffeur
// nog een week toegang tot zijn loonbrieven zodra de link ergens stond. De
// lijst wordt bij elk bezoek opnieuw ondertekend, dus 15 min volstaat ruim.
const DOCUMENT_URL_TTL_SEC = 15 * 60;

export function mountDocumentRoutes(app: express.Express) {
  // Het contract van vóór 13-10, nu per dag: de bundel van de versie die op
  // `datum` (standaard vandaag) geldt. Heeft die versie nog geen bundel, dan
  // de vorige (met `terugval: true`), zodat Mijn dag en de viewer nooit zonder
  // blad vallen; het scherm Ritbladen leest /api/ritbladen en toont de keuze.
  // null = geen enkele bundel.
  app.get("/api/ritblaadje", authenticate, async (req, res) => {
    try {
      const dag = vandaag();
      const datum = datumUitQuery(req) ?? dag;
      const { versies, rijen } = await laadRitbladen();
      const keuze = kiesRitblad(versies, rijen, datum);
      const gekozen = keuze.bundel
        ? { versie: keuze.versie, bundel: keuze.bundel, terugval: false }
        : keuze.vorige ? { versie: keuze.vorige.versie, bundel: keuze.vorige.bundel, terugval: true } : null;
      if (!gekozen) return res.json(null);
      const publiek = maakOndertekenaar();
      res.json({
        ...(await publiek(gekozen.bundel)),
        versie: gekozen.versie ? versiePublic(versies, gekozen.versie, dag) : null,
        // De versie van de dag zelf: bij een terugval zegt de viewer "nog geen ritbladen voor de dienstregeling vanaf dd/mm".
        voorVersie: keuze.versie ? versiePublic(versies, keuze.versie, dag) : null,
        terugval: gekozen.terugval,
      });
    } catch (err: any) {
      console.error("Ritblaadje fetch error:", err);
      res.status(500).json({ error: "Kon ritblad niet ophalen." });
    }
  });

  // Alle bundels met hun versie (13-10), voor het scherm Ritbladen: de keuze
  // voor één dag (`bundel`, of `vorige` als die versie er nog geen heeft) en
  // de hele lijst (huidig, toekomstig vooraf te bekijken, verlopen zolang de
  // versie bestaat). Elke rol: chauffeurs lezen hun ritbladen.
  app.get("/api/ritbladen", authenticate, async (req, res) => {
    try {
      const dag = vandaag();
      const datum = datumUitQuery(req) ?? dag;
      const { versies, rijen } = await laadRitbladen();
      const keuze = kiesRitblad(versies, rijen, datum);
      const publiek = maakOndertekenaar();
      const bundels = await Promise.all(bundelsPerVersie(versies, rijen).map(async ({ versie, bundel }) => ({
        versie: versie ? versiePublic(versies, versie, dag) : null,
        bundel: bundel ? await publiek(bundel) : null,
      })));
      res.json({
        datum,
        versie: keuze.versie ? versiePublic(versies, keuze.versie, dag) : null,
        bundel: keuze.bundel ? await publiek(keuze.bundel) : null,
        vorige: keuze.vorige ? { versie: versiePublic(versies, keuze.vorige.versie, dag), bundel: await publiek(keuze.vorige.bundel) } : null,
        bundels,
      });
    } catch (err: any) {
      console.error("Ritbladen fetch error:", err);
      res.status(500).json({ error: "Kon de ritbladen niet ophalen." });
    }
  });

  // Upload (admin): `?versie=<id>` = de bundel van die versie, anders die van
  // vandaag. Body: filename, dataUrl, `melden` (standaard aan). Een bestaande
  // bundel van die versie wordt vervangen.
  app.post("/api/ritblaadje", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const filename = String(req.body?.filename || "").trim();
      const dataUrl = String(req.body?.dataUrl || "");
      const melden = req.body?.melden !== false;
      if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
        return res.status(400).json({ error: "Geef een PDF-bestand met een .pdf extensie." });
      }
      const base64Match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
      if (!base64Match) {
        return res.status(400).json({ error: "Bestand is geen geldige PDF (base64 data URL verwacht)." });
      }
      const geupload = Buffer.from(base64Match[1], "base64");
      if (geupload.length === 0) {
        return res.status(400).json({ error: "Bestand is leeg." });
      }
      // De browser toont in de PDF-balk de Title-metadata van het document
      // (het planningspakket levert "ritbladje"): op "Ritblad" zetten,
      // best-effort (api/_lib/pdfTitel.ts). Verzoek Jarno 08-09.
      const buffer = await metPdfTitel(geupload, "Ritblad");

      const dag = vandaag();
      const { versies, rijen } = await laadRitbladen();
      const versie = doelVersie(versies, req, dag);
      const bestaand = bundelVan(versies, rijen, versie);

      // Onvoorspelbaar pad per upload — verhindert dat ex-medewerkers met
      // een oud URL het laatste ritblaadje kunnen blijven opvragen.
      const randomSlug = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const storagePath = `${versie ? versie.id : "current"}-${randomSlug}.pdf`;
      await uploadRitbladBestand(storagePath, buffer);

      const rij: RitbladRij = {
        id: bestaand?.id ?? (versie ? versie.id : "current"),
        filename,
        storagePath,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.appUser?.name ?? null,
        sizeBytes: buffer.length,
        dienstregelingId: versie?.id ?? bestaand?.dienstregelingId ?? null,
      };
      try {
        await saveRitbladRij(rij);
      } catch (err) {
        // De rij mislukte (bv. de migratie van 13-10 nog niet gedraaid): het nieuwe bestand niet laten slingeren.
        await verwijderRitbladBestand(storagePath);
        throw err;
      }
      // Oud bestand opruimen (best-effort), pas nu de rij ernaar wijst.
      if (bestaand && bestaand.storagePath !== storagePath) await verwijderRitbladBestand(bestaand.storagePath);

      const versieTekst = versie ? ` voor ${versieLabel(versie)} (vanaf ${DAG_DMJ(versie.geldigVanaf)})` : "";
      await logActivity(req, "planning", bestaand ? "Ritblaadje vervangen" : "Ritblaadje toegevoegd", `${filename} (${Math.round(buffer.length / 1024)} KB) geüpload${versieTekst}.`);

      // Seintje naar de actieve chauffeurs (09-10, keuze Jarno): zonder
      // melding ontdekte niemand nieuwe ritbladen. Een bundel voor een
      // toekomstige versie noemt haar datum (13-10); de schakelaar in het
      // scherm zet `melden: false`. Een verlopen versie meldt nooit.
      // Best-effort: de upload is al geslaagd.
      const status = versie ? versieStatus(versies, versie, dag) : "huidig";
      if (melden && status !== "verlopen") {
        try {
          const chauffeurIds = (await getUsersData()).filter((u) => u.role === "chauffeur" && u.isActive !== false).map((u) => String(u.id));
          const tekst = status === "toekomstig" && versie
            ? { title: `Nieuwe ritbladen vanaf ${DAG_DMJ(versie.geldigVanaf)}`, body: `Vanaf ${DAG_DMJ(versie.geldigVanaf)} gelden nieuwe ritbladen. Je kan ze nu al bekijken via Ritbladen.` }
            : { title: "Nieuwe ritbladen", body: "De ritbladbundel is vervangen. Open Ritbladen voor het blad van je dienst." };
          await sendPushToUsers(chauffeurIds, { ...tekst, soort: "planning", url: viewUrl("ritbladen") });
        } catch (pushErr) {
          console.error("Push over de nieuwe ritbladbundel versturen mislukt.", pushErr);
        }
      }

      const publiek = maakOndertekenaar();
      res.json({ ...(await publiek(rij)), versie: versie ? versiePublic(versies, versie, dag) : null });
    } catch (err: any) {
      if (err instanceof VersieOnbekend) return res.status(404).json({ error: "Deze versie van de dienstregeling bestaat niet (meer)." });
      if (err instanceof MigratieOntbreektError) return res.status(503).json({ error: err.message });
      console.error("Ritblaadje upload error:", err);
      res.status(500).json({ error: "Kon ritblad niet uploaden." });
    }
  });

  // Verwijderen (admin): `?versie=<id>`, anders de bundel van vandaag.
  app.delete("/api/ritblaadje", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const dag = vandaag();
      const { versies, rijen } = await laadRitbladen();
      const versie = doelVersie(versies, req, dag);
      const bestaand = bundelVan(versies, rijen, versie);
      if (!bestaand) return res.json({ success: true });

      await verwijderRitbladBestand(bestaand.storagePath);
      await deleteRitbladRij(bestaand.id);
      await logActivity(req, "planning", "Ritblaadje verwijderd", `${bestaand.filename} verwijderd${versie ? ` (${versieLabel(versie)})` : ""}.`);

      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof VersieOnbekend) return res.status(404).json({ error: "Deze versie van de dienstregeling bestaat niet (meer)." });
      console.error("Ritblaadje delete error:", err);
      res.status(500).json({ error: "Kon ritblad niet verwijderen." });
    }
  });

   // 15 minuten

  app.get("/api/documents", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      if (!db) return res.status(500).json({ error: "Supabase is niet geconfigureerd." });
      const role = req.appUser?.role;
      // Documentbeheer is admin-only (loonbrieven/attesten = gevoelige PII). Een
      // planner kon eerder via ?userId=<x> andermans documenten opvragen; alleen
      // een admin mag een andere gebruiker uitlezen. Iedereen (incl. planner)
      // krijgt zonder admin altijd de eigen lijst.
      const isStaff = role === "admin";
      const requestedUserId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
      const scopeUserId = isStaff ? requestedUserId : String(req.appUser?.id ?? "");
      // Fail-closed: een lege eigen id mag nooit "geen filter" betekenen —
      // listUserDocuments zonder id geeft ALLE documenten terug (admin-pad).
      if (!isStaff && !scopeUserId) return res.json([]);
      const docs = await listUserDocuments(scopeUserId);
      // Alle links in één aanvraag (15-10). Mislukt het ondertekenen, dan gaat
      // de lijst toch mee, zonder links (url: null), zoals vroeger per document.
      let urls = new Map<string, string>();
      try {
        urls = await ondertekenDocumenten(docs.map((d) => d.storagePath), DOCUMENT_URL_TTL_SEC);
      } catch (err) {
        console.error("Documentlinks ondertekenen is mislukt.", err);
      }
      res.json(docs.map((d) => ({ ...d, url: urls.get(d.storagePath) ?? null })));
    } catch (err) {
      console.error("Documenten laden mislukt:", err);
      res.status(500).json({ error: "Documenten laden is mislukt." });
    }
  });

  app.post("/api/documents", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!supabaseAdmin) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
      const userId = String(req.body?.userId || "").trim();
      const filename = String(req.body?.filename || "").trim();
      const category = String(req.body?.category || "").trim() || null;
      const dataUrl = String(req.body?.dataUrl || "");
      if (!userId) return res.status(400).json({ error: "userId is verplicht." });
      const users = await getUsersData();
      const targetUser = users.find((u) => String(u.id) === userId);
      if (!targetUser) return res.status(400).json({ error: "Onbekende gebruiker." });
      if (!filename || !/\.(pdf|png|jpe?g)$/i.test(filename)) {
        return res.status(400).json({ error: "Geef een PDF- of afbeeldingsbestand (.pdf/.png/.jpg)." });
      }
      const base64Match = dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,(.+)$/);
      if (!base64Match) return res.status(400).json({ error: "Bestand is geen geldige data-URL (PDF/PNG/JPG)." });
      const buffer = Buffer.from(base64Match[2], "base64");
      if (buffer.length === 0) return res.status(400).json({ error: "Bestand is leeg." });

      // Onvoorspelbaar pad per upload (zelfde reden als het ritblad): een oud
      // gelekt URL blijft niet werken voor nieuwe bestanden.
      const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
      const storagePath = `${userId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, buffer, { contentType: base64Match[1], upsert: false });
      if (uploadError) throw uploadError;

      const doc = await insertUserDocument({
        userId,
        filename,
        storagePath,
        category,
        sizeBytes: buffer.length,
        uploadedBy: req.appUser?.name ?? null,
      });
      await logActivity(req, "users", "Document toegevoegd", `${filename} voor ${targetUser.name}${category ? ` (${category})` : ""}.`, { type: "user", id: userId });
      await sendPushToUsers([userId], {
        title: "Nieuw document",
        soort: "document",
        body: `Er staat een nieuw document voor je klaar: ${filename}.`,
        url: viewUrl("documenten"),
      });
      res.json({ success: true, document: doc });
    } catch (err) {
      console.error("Document uploaden mislukt:", err);
      res.status(500).json({ error: "Document uploaden is mislukt." });
    }
  });

  // Eén document naar álle actieve chauffeurs (bv. nieuw reglement). Elke
  // chauffeur krijgt een eigen kopie (eigen storage-pad + rij) zodat de
  // wees-opruiming bij verwijderen per gebruiker klopt. Push naar allemaal.
  app.post("/api/documents/broadcast", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!supabaseAdmin) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
      const filename = String(req.body?.filename || "").trim();
      const category = String(req.body?.category || "").trim() || null;
      const dataUrl = String(req.body?.dataUrl || "");
      if (!filename || !/\.(pdf|png|jpe?g)$/i.test(filename)) {
        return res.status(400).json({ error: "Geef een PDF- of afbeeldingsbestand (.pdf/.png/.jpg)." });
      }
      const base64Match = dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,(.+)$/);
      if (!base64Match) return res.status(400).json({ error: "Bestand is geen geldige data-URL (PDF/PNG/JPG)." });
      const buffer = Buffer.from(base64Match[2], "base64");
      if (buffer.length === 0) return res.status(400).json({ error: "Bestand is leeg." });

      const chauffeurs = (await getUsersData()).filter((u) => u.role === "chauffeur" && u.isActive !== false);
      if (chauffeurs.length === 0) return res.status(400).json({ error: "Geen actieve chauffeurs gevonden." });

      const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
      let done = 0;
      for (const u of chauffeurs) {
        const storagePath = `${u.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from(DOCUMENTS_BUCKET)
          .upload(storagePath, buffer, { contentType: base64Match[1], upsert: false });
        if (uploadError) { console.error(`[broadcast] upload voor ${u.id} mislukt:`, uploadError.message); continue; }
        await insertUserDocument({ userId: String(u.id), filename, storagePath, category, sizeBytes: buffer.length, uploadedBy: req.appUser?.name ?? null });
        done++;
      }

      await logActivity(req, "users", "Document rondgestuurd", `${filename}${category ? ` (${category})` : ""} naar ${done} chauffeur(s).`);
      await sendPushToUsers(chauffeurs.map((u) => String(u.id)), {
        title: "Nieuw document",
        soort: "document",
        body: `Er staat een nieuw document voor je klaar: ${filename}.`,
        url: viewUrl("documenten"),
      });
      res.json({ success: true, count: done });
    } catch (err) {
      console.error("Document rondsturen mislukt:", err);
      res.status(500).json({ error: "Document rondsturen is mislukt." });
    }
  });

  // Leesbevestiging: de chauffeur meldt dat hij dit document opende. Alleen op
  // eigen documenten (de user_id-match zit in de update zelf) en alleen de
  // eerste keer telt; best-effort, mag het openen nooit blokkeren.
  app.post("/api/documents/:id/opened", authenticate, async (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "Document-id ontbreekt." });
    await markUserDocumentOpened(id, String(req.appUser?.id ?? ""));
    res.status(204).end();
  });

  app.delete("/api/documents/:id", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!supabaseAdmin) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
      const doc = await getUserDocument(String(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document niet gevonden." });
      const { error: removeError } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([doc.storagePath]);
      if (removeError) console.warn("Document-bestand kon niet worden verwijderd:", removeError);
      await deleteUserDocument(doc.id);
      await logActivity(req, "users", "Document verwijderd", `${doc.filename}.`, { type: "user", id: doc.userId });
      res.json({ success: true });
    } catch (err) {
      console.error("Document verwijderen mislukt:", err);
      res.status(500).json({ error: "Document verwijderen is mislukt." });
    }
  });
}
