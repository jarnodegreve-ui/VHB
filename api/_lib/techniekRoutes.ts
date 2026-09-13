import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { getUsersData, logActivity } from "../storage.js";
import { sendPushToUsers } from "../push.js";
import { isStafRol, type AuthenticatedRequest, type Role } from "../types.js";
import {
  defectMeldingBodySchema, defectPatchSchema, vehicleBodySchema, vehicleExpiryBodySchema, werkprestatieBodySchema,
  VOERTUIG_VERVAL_LABEL, WERKTYPE_LABEL, voertuigNaam, type Defect, type Werkprestatie,
} from "../../shared/schemas/techniek.js";
import { valideerRecord } from "./valideer.js";
import {
  TECHNIEK_MIGRATIE, countOpenDefecten, createDefect, createVehicle, createWerkprestatie, deleteVehicle, deleteVehicleExpiry,
  deleteWerkprestatie, getDefect, getDefecten, getVehicle, getVehicleExpiries, getVehicles, getWerkprestatie, getWerkprestaties,
  isForeignKeyError, isUniqueError, patchDefect, saveVehicleExpiry, updateVehicle, updateWerkprestatie,
} from "./techniekStorage.js";

/**
 * Techniek (fase A Access-migratie, 13-09-2026): voertuigen, gele boek,
 * werkprestaties en vervaldata per voertuig.
 *
 * Rollen:
 * - iedereen die ingelogd is: voertuigen (kort) lezen, een defect melden,
 *   eigen meldingen zien en een eigen open melding annuleren;
 * - technieker + staf: het gele boek, meldingen afhandelen, werkprestaties
 *   (technieker alleen de eigen rijen), vervaldata zetten;
 * - staf: voertuigen aanmaken/bewerken/verwijderen, alle werkprestaties.
 */
const TECHNIEK: Role[] = ["technieker", "planner", "admin"];
const isTechniekRol = (role: Role | string) => role === "technieker" || isStafRol(role);

const migratieOntbreekt = (res: express.Response) =>
  res.status(503).json({ error: `De techniek-tabellen bestaan nog niet: draai ${TECHNIEK_MIGRATIE} in de SQL Editor.` });

const fout = (res: express.Response, err: unknown, tekst: string) => {
  if (isMissingTableError(err)) return migratieOntbreekt(res);
  console.error(tekst, err);
  return res.status(500).json({ error: tekst });
};

const naamVan = (users: Array<{ id: string; name: string }>, id: string | null | undefined): string | undefined =>
  id ? users.find((u) => String(u.id) === String(id))?.name : undefined;

const metNamen = (users: Array<{ id: string; name: string }>) => (d: Defect): Defect => ({
  ...d,
  gemeldDoorNaam: naamVan(users, d.gemeldDoor),
  uitgevoerdDoorNaam: naamVan(users, d.uitgevoerdDoor),
});

const prestatieMetNaam = (users: Array<{ id: string; name: string }>) => (w: Werkprestatie): Werkprestatie => ({
  ...w,
  mecanicienNaam: naamVan(users, w.mecanicienId),
});

export function mountTechniekRoutes(app: express.Express) {
  // --- Voertuigen ---
  app.get("/api/vehicles", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const alle = await getVehicles();
      const actief = String(req.query.actief ?? "") === "1";
      const lijst = actief ? alle.filter((v) => v.status !== "uit_dienst") : alle;
      res.setHeader("Cache-Control", "no-store");
      if (isTechniekRol(req.appUser!.role)) return res.json(lijst);
      // Chauffeur: alleen wat hij nodig heeft om een bus te kiezen (geen nummerplaat, Jarno 13-09).
      res.json(lijst.filter((v) => v.status !== "uit_dienst").map((v) => ({
        id: v.id, busnr: v.busnr, kortNr: v.kortNr, type: v.type, categorie: v.categorie, status: v.status,
      })));
    } catch (err) {
      fout(res, err, "Kon de voertuigen niet lezen.");
    }
  });

  app.post("/api/vehicles", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, vehicleBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const v = await createVehicle(body);
      await logActivity(req, "system", "Voertuig toegevoegd", `${voertuigNaam(v)} (${v.busnr}${v.nummerplaat ? `, ${v.nummerplaat}` : ""}).`);
      res.status(201).json(v);
    } catch (err) {
      if (isUniqueError(err)) return res.status(409).json({ error: "Dat busnummer of kort nummer bestaat al.", veldfouten: { busnr: "Bestaat al" } });
      fout(res, err, "Kon het voertuig niet bewaren.");
    }
  });

  app.put("/api/vehicles/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, vehicleBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const v = await updateVehicle(String(req.params.id), body);
      if (!v) return res.status(404).json({ error: "Voertuig niet gevonden." });
      await logActivity(req, "system", "Voertuig bijgewerkt", `${voertuigNaam(v)}: status ${v.status}.`);
      res.json(v);
    } catch (err) {
      if (isUniqueError(err)) return res.status(409).json({ error: "Dat busnummer of kort nummer bestaat al.", veldfouten: { busnr: "Bestaat al" } });
      fout(res, err, "Kon het voertuig niet bewaren.");
    }
  });

  app.delete("/api/vehicles/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const v = await getVehicle(String(req.params.id));
      if (!v) return res.status(404).json({ error: "Voertuig niet gevonden." });
      await deleteVehicle(v.id);
      await logActivity(req, "system", "Voertuig verwijderd", `${voertuigNaam(v)} (${v.busnr}).`);
      res.json({ success: true });
    } catch (err) {
      if (isForeignKeyError(err)) {
        return res.status(409).json({ error: "Dit voertuig heeft meldingen of werkprestaties. Zet het op “Uit dienst” in plaats van het te verwijderen." });
      }
      fout(res, err, "Kon het voertuig niet verwijderen.");
    }
  });

  // --- Vervaldata per voertuig ---
  app.get("/api/vehicle-expiries", authenticate, requireRole(...TECHNIEK), async (_req: AuthenticatedRequest, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getVehicleExpiries());
    } catch (err) {
      fout(res, err, "Kon de vervaldata niet lezen.");
    }
  });

  app.put("/api/vehicles/:id/vervaldata", authenticate, requireRole(...TECHNIEK), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, vehicleExpiryBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const v = await getVehicle(String(req.params.id));
      if (!v) return res.status(404).json({ error: "Voertuig niet gevonden." });
      const label = VOERTUIG_VERVAL_LABEL[body.soort];
      if (!body.validUntil) {
        await deleteVehicleExpiry(v.id, body.soort);
      } else {
        await saveVehicleExpiry({ vehicleId: v.id, soort: body.soort, validUntil: body.validUntil, opmerking: body.opmerking ?? null, updatedBy: String(req.appUser?.id ?? "") || null });
      }
      await logActivity(req, "system", body.validUntil ? "Vervaldatum voertuig bijgewerkt" : "Vervaldatum voertuig verwijderd", `${voertuigNaam(v)}: ${label}${body.validUntil ? ` geldig tot ${body.validUntil}` : ", datum verwijderd"}.`);
      res.json({ success: true });
    } catch (err) {
      fout(res, err, "Kon de vervaldatum niet opslaan.");
    }
  });

  // --- Gele boek ---
  app.get("/api/defecten", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const rol = req.appUser!.role;
      const mijn = String(req.query.mijn ?? "") === "1";
      const statusQ = String(req.query.status ?? "");
      const status = (["open", "alles", "uitgevoerd", "geannuleerd"] as const).find((s) => s === statusQ);
      const limit = Number(req.query.limit) || undefined;
      const sinds = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.sinds ?? "")) ? String(req.query.sinds) : undefined;
      const vehicleId = String(req.query.vehicleId ?? "").trim() || undefined;
      // Chauffeur: altijd hard gescoped op de eigen meldingen (net als /api/planning).
      const gemeldDoor = mijn || !isTechniekRol(rol) ? String(req.appUser!.id) : undefined;
      const [rijen, users] = await Promise.all([getDefecten({ status: status ?? (gemeldDoor ? "alles" : "open"), vehicleId, sinds, gemeldDoor, limit }), getUsersData()]);
      res.setHeader("Cache-Control", "no-store");
      res.json(rijen.map(metNamen(users)));
    } catch (err) {
      fout(res, err, "Kon het gele boek niet lezen.");
    }
  });

  app.get("/api/defecten/aantal-open", authenticate, requireRole(...TECHNIEK), async (_req: AuthenticatedRequest, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ open: await countOpenDefecten() });
    } catch (err) {
      fout(res, err, "Kon het aantal open meldingen niet lezen.");
    }
  });

  app.post("/api/defecten", authenticate, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, defectMeldingBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const v = await getVehicle(body.vehicleId);
      if (!v || v.status === "uit_dienst") return res.status(400).json({ error: "Ongeldige invoer", details: "Kies een bestaande bus.", veldfouten: { vehicleId: "Kies een bestaande bus" } });
      const melderId = String(req.appUser!.id);
      const d = await createDefect({ ...body, gemeldDoor: melderId });
      const users = await getUsersData();
      const naam = voertuigNaam(v);
      await logActivity(req, "system", "Defect gemeld", `${naam}: ${WERKTYPE_LABEL[body.werktype]}, ${body.omschrijving.slice(0, 120)}`);
      // Melding naar de techniekers; bij "voor De Lijn" ook naar de planners
      // (die nemen contact op met De Lijn). Best-effort.
      const ontvangers = users
        .filter((u) => u.isActive !== false && String(u.id) !== melderId)
        .filter((u) => u.role === "technieker" || (body.werktype === "L" && isStafRol(u.role)))
        .map((u) => String(u.id));
      try {
        await sendPushToUsers(ontvangers, {
          title: `${naam}: nieuwe melding in het gele boek`,
          body: `${WERKTYPE_LABEL[body.werktype]}, gemeld door ${req.appUser!.name}: ${body.omschrijving.slice(0, 140)}`,
          url: "/?view=defecten",
          soort: "techniek",
        });
      } catch (pushErr: any) {
        console.error("[techniek] push nieuwe melding mislukt:", pushErr?.message ?? pushErr);
      }
      res.status(201).json(metNamen(users)(d));
    } catch (err) {
      fout(res, err, "Kon de melding niet bewaren.");
    }
  });

  app.patch("/api/defecten/:id", authenticate, async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, defectPatchSchema, req.body ?? {});
    if (!body) return;
    try {
      const bestaand = await getDefect(String(req.params.id));
      if (!bestaand) return res.status(404).json({ error: "Melding niet gevonden." });
      const rol = req.appUser!.role;
      const eigenId = String(req.appUser!.id);
      if (!isTechniekRol(rol)) {
        // Chauffeur: alleen de eigen open melding annuleren, niets anders.
        const alleenAnnuleren = body.status === "geannuleerd" && Object.keys(body).every((k) => k === "status");
        if (bestaand.gemeldDoor !== eigenId || bestaand.status !== "open" || !alleenAnnuleren) {
          return res.status(403).json({ error: "Je kunt alleen je eigen open melding annuleren." });
        }
      }
      const patch: Parameters<typeof patchDefect>[1] = { ...body };
      if (body.status === "uitgevoerd") {
        patch.uitgevoerdDoor = eigenId;
        if (patch.uitgevoerdOp === undefined || patch.uitgevoerdOp === null) patch.uitgevoerdOp = new Date().toISOString().slice(0, 10);
      }
      if (body.status === "open") {
        patch.uitgevoerdDoor = null;
        patch.uitgevoerdOp = null;
      }
      const d = await patchDefect(bestaand.id, patch);
      if (!d) return res.status(404).json({ error: "Melding niet gevonden." });
      const users = await getUsersData();
      const naam = voertuigNaam(d);
      if (body.status && body.status !== bestaand.status) {
        await logActivity(req, "system", `Melding ${body.status}`, `${naam}: ${bestaand.omschrijving.slice(0, 100)}${body.uitgevoerdWerk ? ` → ${body.uitgevoerdWerk.slice(0, 100)}` : ""}`);
        if (body.status === "uitgevoerd" && d.gemeldDoor !== eigenId) {
          try {
            await sendPushToUsers([d.gemeldDoor], {
              title: `${naam}: je melding is afgehandeld`,
              body: body.uitgevoerdWerk ? body.uitgevoerdWerk.slice(0, 140) : `${WERKTYPE_LABEL[d.werktype]}: ${bestaand.omschrijving.slice(0, 120)}`,
              url: "/?view=mijn-dag",
              soort: "techniek",
            });
          } catch (pushErr: any) {
            console.error("[techniek] push afgehandeld mislukt:", pushErr?.message ?? pushErr);
          }
        }
      }
      res.json(metNamen(users)(d));
    } catch (err) {
      fout(res, err, "Kon de melding niet bijwerken.");
    }
  });

  // --- Werkprestaties ---
  app.get("/api/werkprestaties", authenticate, requireRole(...TECHNIEK), async (req: AuthenticatedRequest, res) => {
    try {
      const rol = req.appUser!.role;
      const dag = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : undefined);
      const filter = {
        van: dag(req.query.van),
        tot: dag(req.query.tot),
        vehicleId: String(req.query.vehicleId ?? "").trim() || undefined,
        // Technieker ziet alleen eigen prestaties; staf mag op mecanicien filteren.
        mecanicienId: isStafRol(rol) ? (String(req.query.mecanicienId ?? "").trim() || undefined) : String(req.appUser!.id),
        limit: Number(req.query.limit) || undefined,
      };
      const [rijen, users] = await Promise.all([getWerkprestaties(filter), getUsersData()]);
      res.setHeader("Cache-Control", "no-store");
      res.json(rijen.map(prestatieMetNaam(users)));
    } catch (err) {
      fout(res, err, "Kon de werkprestaties niet lezen.");
    }
  });

  /** Rapport: uren per bus / per mecanicien / per kwartaal voor een jaar (de drie Access-kruistabellen). */
  app.get("/api/werkprestaties/rapport", authenticate, requireRole(...TECHNIEK), async (req: AuthenticatedRequest, res) => {
    try {
      const jaar = Number(req.query.jaar) || new Date().getFullYear();
      const rol = req.appUser!.role;
      const rijen = await getWerkprestaties({ van: `${jaar}-01-01`, tot: `${jaar}-12-31`, limit: 5000, mecanicienId: isStafRol(rol) ? undefined : String(req.appUser!.id) });
      const users = await getUsersData();
      const perBus = new Map<string, { label: string; uren: number; aantal: number; perKwartaal: number[] }>();
      const perMecanicien = new Map<string, { label: string; uren: number; aantal: number; perKwartaal: number[] }>();
      const perCode = new Map<string, { uren: number; aantal: number }>();
      for (const w of rijen) {
        const kw = Math.floor((Number(w.datum.slice(5, 7)) - 1) / 3);
        const busLabel = w.vehicleId ? voertuigNaam({ busnr: w.busnr ?? "", kortNr: w.kortNr }) : "Garage / algemeen";
        const b = perBus.get(busLabel) ?? { label: busLabel, uren: 0, aantal: 0, perKwartaal: [0, 0, 0, 0] };
        b.uren += w.werkuren; b.aantal += 1; b.perKwartaal[kw] += w.werkuren; perBus.set(busLabel, b);
        const mLabel = naamVan(users, w.mecanicienId) ?? w.mecanicienId;
        const m = perMecanicien.get(mLabel) ?? { label: mLabel, uren: 0, aantal: 0, perKwartaal: [0, 0, 0, 0] };
        m.uren += w.werkuren; m.aantal += 1; m.perKwartaal[kw] += w.werkuren; perMecanicien.set(mLabel, m);
        const c = perCode.get(w.werkcode) ?? { uren: 0, aantal: 0 };
        c.uren += w.werkuren; c.aantal += 1; perCode.set(w.werkcode, c);
      }
      const rond = (n: number) => Math.round(n * 100) / 100;
      const lijst = (m: Map<string, { label: string; uren: number; aantal: number; perKwartaal: number[] }>) =>
        [...m.values()].map((r) => ({ ...r, uren: rond(r.uren), perKwartaal: r.perKwartaal.map(rond) })).sort((a, b) => b.uren - a.uren);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        jaar,
        totaalUren: rond(rijen.reduce((s, w) => s + w.werkuren, 0)),
        aantal: rijen.length,
        perBus: lijst(perBus),
        perMecanicien: lijst(perMecanicien),
        perWerkcode: [...perCode.entries()].map(([werkcode, r]) => ({ werkcode, uren: rond(r.uren), aantal: r.aantal })).sort((a, b) => b.uren - a.uren),
      });
    } catch (err) {
      fout(res, err, "Kon het rapport niet maken.");
    }
  });

  const eigenaarOfStaf = (req: AuthenticatedRequest, w: Werkprestatie) => isStafRol(req.appUser!.role) || w.mecanicienId === String(req.appUser!.id);

  app.post("/api/werkprestaties", authenticate, requireRole(...TECHNIEK), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, werkprestatieBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const mecanicienId = isStafRol(req.appUser!.role) && body.mecanicienId ? body.mecanicienId : String(req.appUser!.id);
      const w = await createWerkprestatie({ ...body, mecanicienId });
      const users = await getUsersData();
      await logActivity(req, "system", "Werkprestatie geregistreerd", `${w.datum}: ${w.vehicleId ? voertuigNaam({ busnr: w.busnr ?? "", kortNr: w.kortNr }) : "garage"}, ${w.werkcode}, ${w.werkuren} u.`);
      res.status(201).json(prestatieMetNaam(users)(w));
    } catch (err) {
      if (isForeignKeyError(err)) return res.status(400).json({ error: "Ongeldige invoer", details: "Kies een bestaande bus.", veldfouten: { vehicleId: "Kies een bestaande bus" } });
      fout(res, err, "Kon de werkprestatie niet bewaren.");
    }
  });

  app.put("/api/werkprestaties/:id", authenticate, requireRole(...TECHNIEK), async (req: AuthenticatedRequest, res) => {
    const body = valideerRecord(res, werkprestatieBodySchema, req.body ?? {});
    if (!body) return;
    try {
      const bestaand = await getWerkprestatie(String(req.params.id));
      if (!bestaand) return res.status(404).json({ error: "Werkprestatie niet gevonden." });
      if (!eigenaarOfStaf(req, bestaand)) return res.status(403).json({ error: "Je kunt alleen je eigen werkprestaties bewerken." });
      const mecanicienId = isStafRol(req.appUser!.role) && body.mecanicienId ? body.mecanicienId : bestaand.mecanicienId;
      const w = await updateWerkprestatie(bestaand.id, { ...body, mecanicienId });
      if (!w) return res.status(404).json({ error: "Werkprestatie niet gevonden." });
      const users = await getUsersData();
      res.json(prestatieMetNaam(users)(w));
    } catch (err) {
      if (isForeignKeyError(err)) return res.status(400).json({ error: "Ongeldige invoer", details: "Kies een bestaande bus.", veldfouten: { vehicleId: "Kies een bestaande bus" } });
      fout(res, err, "Kon de werkprestatie niet bewaren.");
    }
  });

  app.delete("/api/werkprestaties/:id", authenticate, requireRole(...TECHNIEK), async (req: AuthenticatedRequest, res) => {
    try {
      const bestaand = await getWerkprestatie(String(req.params.id));
      if (!bestaand) return res.status(404).json({ error: "Werkprestatie niet gevonden." });
      if (!eigenaarOfStaf(req, bestaand)) return res.status(403).json({ error: "Je kunt alleen je eigen werkprestaties verwijderen." });
      await deleteWerkprestatie(bestaand.id);
      await logActivity(req, "system", "Werkprestatie verwijderd", `${bestaand.datum}: ${bestaand.werkcode}, ${bestaand.werkuren} u.`);
      res.json({ success: true });
    } catch (err) {
      fout(res, err, "Kon de werkprestatie niet verwijderen.");
    }
  });
}
