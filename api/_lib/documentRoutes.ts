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
import { getUsersData, logActivity, listUserDocuments, markUserDocumentOpened, getUserDocument, insertUserDocument, deleteUserDocument, DOCUMENTS_BUCKET } from "../storage.js";
import { viewUrl } from "./collectie.js";

// --- Ritblaadjes ---

const RITBLAADJE_BUCKET = "ritblaadjes";

// Was 30 dagen: die URL werd ook nog in localStorage bewaard, dus een
// geblokkeerd toestel hield wekenlang toegang tot het bedrijfsritblad. De
// client haalt de URL bij elk bezoek vers op, dus een uur is genoeg.
const RITBLAADJE_URL_TTL_SEC = 60 * 60;

const ritblaadjeRowToPublic = (row: any, publicUrl: string) => ({
  filename: row.filename as string,
  storagePath: row.storage_path as string,
  uploadedAt: row.uploaded_at as string,
  uploadedBy: row.uploaded_by as string | null,
  sizeBytes: row.size_bytes as number | null,
  url: publicUrl,
});

// --- Documenten per gebruiker (attesten, reglement, loonbrieven) ---
// Zelfde beveiligingspatroon als de ritbladen: privé bucket, ondertekende
// URL's uit de API. Chauffeurs zien alleen hun eigen documenten.
// Kort houden: een signed URL omzeilt authenticate, de toestel-whitelist én
// accountdeactivatie. Met 7 dagen hield een geblokkeerde/vertrokken chauffeur
// nog een week toegang tot zijn loonbrieven zodra de link ergens stond. De
// lijst wordt bij elk bezoek opnieuw ondertekend, dus 15 min volstaat ruim.
const DOCUMENT_URL_TTL_SEC = 15 * 60;

export function mountDocumentRoutes(app: express.Express) {
  app.get("/api/ritblaadje", authenticate, async (_req, res) => {
    try {
      if (!db) return res.status(500).json({ error: "Supabase is niet geconfigureerd." });

      const { data, error } = await db.from("ritblaadje").select("*").eq("id", "current").maybeSingle();
      if (error) throw error;
      if (!data) return res.json(null);

      // Ondertekende URL i.p.v. publieke: de bucket wordt privé gezet zodat het
      // ritblad (interne dienstinfo) niet zonder sessie op te vragen is.
      const { data: signedData, error: signedError } = await db.storage
        .from(RITBLAADJE_BUCKET)
        .createSignedUrl(data.storage_path, RITBLAADJE_URL_TTL_SEC);
      if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("Kon geen ondertekende URL maken.");
      return res.json(ritblaadjeRowToPublic(data, signedData.signedUrl));
    } catch (err: any) {
      console.error("Ritblaadje fetch error:", err);
      console.error("Kon ritblaadje niet ophalen.", err);
      res.status(500).json({ error: "Kon ritblad niet ophalen." });
    }
  });

  app.post("/api/ritblaadje", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
      }

      const filename = String(req.body?.filename || "").trim();
      const dataUrl = String(req.body?.dataUrl || "");
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

      // Vorige record ophalen zodat we het oude bestand kunnen verwijderen.
      const { data: existing } = await supabaseAdmin
        .from("ritblaadje")
        .select("storage_path")
        .eq("id", "current")
        .maybeSingle();

      // Onvoorspelbaar pad per upload — verhindert dat ex-medewerkers met
      // een oud URL het laatste ritblaadje kunnen blijven opvragen.
      const randomSlug = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const storagePath = `current-${randomSlug}.pdf`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(RITBLAADJE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      // Oud bestand opruimen (best-effort).
      if (existing?.storage_path && existing.storage_path !== storagePath) {
        const { error: removeError } = await supabaseAdmin.storage
          .from(RITBLAADJE_BUCKET)
          .remove([existing.storage_path]);
        if (removeError) console.warn("Oude ritblaadje-bestand kon niet worden verwijderd:", removeError);
      }

      const row = {
        id: "current",
        filename,
        storage_path: storagePath,
        uploaded_at: new Date().toISOString(),
        uploaded_by: req.appUser?.name ?? null,
        size_bytes: buffer.length,
      };
      const { error: upsertError } = await supabaseAdmin.from("ritblaadje").upsert(row);
      if (upsertError) throw upsertError;

      await logActivity(req, "planning", "Ritblaadje vervangen", `${filename} (${Math.round(buffer.length / 1024)} KB) geüpload.`);

      const { data: signedData, error: signedError } = await supabaseAdmin.storage
        .from(RITBLAADJE_BUCKET)
        .createSignedUrl(storagePath, RITBLAADJE_URL_TTL_SEC);
      if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("Kon geen ondertekende URL maken.");
      res.json(ritblaadjeRowToPublic(row, signedData.signedUrl));
    } catch (err: any) {
      console.error("Ritblaadje upload error:", err);
      console.error("Kon ritblaadje niet uploaden.", err);
      res.status(500).json({ error: "Kon ritblad niet uploaden." });
    }
  });

  app.delete("/api/ritblaadje", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt." });
      }

      const { data: existing, error: selectError } = await supabaseAdmin.from("ritblaadje").select("*").eq("id", "current").maybeSingle();
      if (selectError) throw selectError;
      if (!existing) return res.json({ success: true });

      const { error: removeError } = await supabaseAdmin.storage
        .from(RITBLAADJE_BUCKET)
        .remove([existing.storage_path]);
      if (removeError) console.warn("Storage remove error:", removeError);

      const { error: deleteError } = await supabaseAdmin.from("ritblaadje").delete().eq("id", "current");
      if (deleteError) throw deleteError;

      await logActivity(req, "planning", "Ritblaadje verwijderd", `${existing.filename} verwijderd.`);

      res.json({ success: true });
    } catch (err: any) {
      console.error("Ritblaadje delete error:", err);
      console.error("Kon ritblaadje niet verwijderen.", err);
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
      const withUrls = await Promise.all(
        docs.map(async (d) => {
          try {
            const { data: signed } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUrl(d.storagePath, DOCUMENT_URL_TTL_SEC);
            return { ...d, url: signed?.signedUrl ?? null };
          } catch {
            return { ...d, url: null };
          }
        }),
      );
      res.json(withUrls);
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
