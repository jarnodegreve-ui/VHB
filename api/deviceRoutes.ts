import type express from "express";
import { authenticate, requireRole, DEVICE_TOKEN_HEADER, isDeviceGateEnabled, invalidateDeviceGateCache } from "./middleware.js";
import { DEVICE_GATE_SETTING_KEY, isMissingTableError } from "./deviceGate.js";
import { sendPushToUsers } from "./push.js";
import {
  logActivity,
  getUsersData,
  registerDevice,
  userHasDevices,
  listAllDevices,
  setDeviceStatus,
  deleteDevice,
  renameDevice,
  setAppSetting,
} from "./storage.js";
import type { AuthenticatedRequest } from "./types.js";

/**
 * Toestel-whitelist — registratie + admin-beheer.
 *
 * Zie middleware.ts (de gate die niet-goedgekeurde toestellen buitenhoudt) +
 * supabase/user_devices.sql. Registratie is voor iedereen bereikbaar (exempt in
 * de gate); alle beheer is admin-only. Losgetrokken uit api/index.ts als eerste
 * stap in het opknippen van die monoliet — deps komen direct uit de gedeelde
 * modules, net als mountOcpiRoutes.
 */

// Toestelnaam is chauffeur-invoer en belandt in een admin-pushmelding: strip
// controltekens (incl. regeleinden), collabeer witruimte, cap op 80 tekens.
const sanitizeDeviceName = (raw: unknown): string =>
  String(raw ?? "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Onbekend toestel";

export const mountDeviceRoutes = (app: express.Express) => {
  app.post("/api/devices/register", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const deviceToken = String(req.headers[DEVICE_TOKEN_HEADER] ?? "").trim();
      if (!deviceToken || deviceToken.length > 100) {
        return res.status(400).json({ error: "Geen geldig toestel-token meegestuurd." });
      }
      const appUser = req.appUser!;
      // Chauffeur-invoer: geen regeleinden/controltekens in een naam die straks in
      // een admin-pushmelding belandt (anti-injectie), gecapt op 80 tekens.
      const name = sanitizeDeviceName(req.body?.name);
      // Chauffeur: eerste toestel automatisch vertrouwd, daarna goedkeuring.
      // Planner/admin: altijd goedgekeurd (alleen zichtbaarheid — nooit lockout).
      // Staat de schakelaar "toestel-goedkeuring" uit, dan wordt élk toestel
      // bij aanmelden goedgekeurd — bewust toegevoegd aan de whitelist, zodat
      // alles er al in staat wanneer de schakelaar weer aan gaat.
      const gateEnabled = await isDeviceGateEnabled();
      const autoApprove = appUser.role !== "chauffeur" || !gateEnabled
        ? true
        : !(await userHasDevices(String(appUser.id)));
      let { device, created } = await registerDevice(String(appUser.id), deviceToken, name, autoApprove);
      // Bestond het toestel al als 'wachtend' terwijl de schakelaar uit
      // staat: alsnog goedkeuren (zelfde belofte: elke login komt erin).
      // Geblokkeerd blijft geblokkeerd — de schakelaar heropent geen
      // gestolen telefoon.
      if (!created && !gateEnabled && device.status === "pending") {
        await setDeviceStatus(String(appUser.id), device.deviceToken, "approved", "auto (schakelaar uit)");
        device = { ...device, status: "approved" };
      }
      // Race-vangst: twee toestellen die ~tegelijk als "eerste" registreren zien
      // allebei userHasDevices=false → allebei auto-approved. Zodra er ná de
      // insert méér dan één toestel op dit account staat terwijl wij zojuist
      // auto-approveden, deze naar de veilige kant (pending) terugzetten.
      if (created && autoApprove && appUser.role === "chauffeur" && gateEnabled) {
        const mine = (await listAllDevices()).filter((d) => d.userId === String(appUser.id));
        if (mine.length > 1) {
          await setDeviceStatus(String(appUser.id), device.deviceToken, "pending", "auto");
          device = { ...device, status: "pending" };
        }
      }
      if (created) {
        await logActivity(
          req,
          "system",
          device.status === "approved" ? "Toestel geregistreerd" : "Toestel wacht op goedkeuring",
          `${appUser.name}: ${device.name} (${device.status}).`,
        );
        if (device.status === "pending") {
          const adminIds = (await getUsersData())
            .filter((u) => u.role === "admin" && u.isActive !== false)
            .map((u) => String(u.id));
          await sendPushToUsers(adminIds, {
            title: "Nieuw toestel wacht op goedkeuring",
            body: `${appUser.name} — ${device.name}`,
            url: "/",
          });
        }
      }
      res.json({ status: device.status });
    } catch (err: any) {
      console.error("Toestel-registratie is mislukt.", err);
      res.status(500).json({ error: "Toestel-registratie is mislukt." });
    }
  });

  app.get("/api/devices", authenticate, requireRole("admin"), async (_req, res) => {
    try {
      res.json(await listAllDevices());
    } catch (err: any) {
      console.error("Toestellen laden is mislukt.", err);
      res.status(500).json({ error: "Toestellen laden is mislukt." });
    }
  });

  // Schakelaar "toestel-goedkeuring vereist". Aparte endpoints (niet in de
  // lijst-respons) zodat de bestaande Device[]-shape blijft.
  app.get("/api/devices/gate", authenticate, requireRole("admin"), async (_req, res) => {
    try {
      const enabled = await isDeviceGateEnabled();
      res.json({ enabled });
    } catch (err: any) {
      console.error("Gate-instelling laden is mislukt.", err);
      res.status(500).json({ error: "Instelling laden is mislukt." });
    }
  });

  app.post("/api/devices/gate", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      // Expliciete boolean vereist: een misvormde body ({}, null) coërceerde
      // naar false = schakelaar stil UIT — een beveiligingsinstelling hoort
      // dan 400 te geven, niet fail-open te gaan.
      if (typeof req.body?.enabled !== "boolean") {
        return res.status(400).json({ error: "enabled (boolean) ontbreekt." });
      }
      const enabled = req.body.enabled;
      await setAppSetting(DEVICE_GATE_SETTING_KEY, { enabled });
      invalidateDeviceGateCache();
      await logActivity(
        req,
        "system",
        enabled ? "Toestel-goedkeuring aangezet" : "Toestel-goedkeuring uitgezet",
        enabled
          ? "Nieuwe toestellen wachten weer op goedkeuring."
          : "Elk toestel wordt bij aanmelden automatisch goedgekeurd; geblokkeerde toestellen blijven geblokkeerd.",
      );
      res.json({ enabled });
    } catch (err: any) {
      // De app_settings-tabel bestaat pas na de migratie — een duidelijke
      // melding i.p.v. een generieke 500.
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De instellingen-tabel bestaat nog niet: draai supabase/2026-07-30_app_settings.sql in de SQL Editor." });
      }
      console.error("Gate-instelling opslaan is mislukt.", err);
      res.status(500).json({ error: "Instelling opslaan is mislukt." });
    }
  });

  app.post("/api/devices/approve", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.body?.userId ?? "");
      const deviceToken = String(req.body?.deviceToken ?? "");
      if (!userId || !deviceToken) return res.status(400).json({ error: "userId en deviceToken zijn verplicht." });
      await setDeviceStatus(userId, deviceToken, "approved", String(req.appUser!.id));
      const owner = (await getUsersData()).find((u) => String(u.id) === userId);
      await logActivity(req, "system", "Toestel goedgekeurd", `${owner?.name ?? userId}.`);
      await sendPushToUsers([userId], {
        title: "Toestel goedgekeurd",
        body: "Dit toestel heeft nu toegang tot het VHB Portaal.",
        url: "/",
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("Toestel goedkeuren is mislukt.", err);
      res.status(500).json({ error: "Toestel goedkeuren is mislukt." });
    }
  });

  app.post("/api/devices/revoke", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.body?.userId ?? "");
      const deviceToken = String(req.body?.deviceToken ?? "");
      if (!userId || !deviceToken) return res.status(400).json({ error: "userId en deviceToken zijn verplicht." });
      // Niet het toestel blokkeren waarop je zelf nu werkt (lockout-guard).
      const ownToken = String(req.headers[DEVICE_TOKEN_HEADER] ?? "").trim();
      if (userId === String(req.appUser!.id) && deviceToken === ownToken) {
        return res.status(400).json({ error: "Je kunt het toestel waarop je nu werkt niet blokkeren." });
      }
      await setDeviceStatus(userId, deviceToken, "revoked", String(req.appUser!.id));
      const owner = (await getUsersData()).find((u) => String(u.id) === userId);
      await logActivity(req, "system", "Toestel geblokkeerd", `${owner?.name ?? userId}.`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Toestel blokkeren is mislukt.", err);
      res.status(500).json({ error: "Toestel blokkeren is mislukt." });
    }
  });

  app.post("/api/devices/delete", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.body?.userId ?? "");
      const deviceToken = String(req.body?.deviceToken ?? "");
      if (!userId || !deviceToken) return res.status(400).json({ error: "userId en deviceToken zijn verplicht." });
      const ownToken = String(req.headers[DEVICE_TOKEN_HEADER] ?? "").trim();
      if (userId === String(req.appUser!.id) && deviceToken === ownToken) {
        return res.status(400).json({ error: "Je kunt het toestel waarop je nu werkt niet schrappen." });
      }
      // Het laatste toestel schrappen zou de auto-approve heropenen (een volgende
      // registratie is dan weer "eerste toestel"). Bij een verloren/gestolen
      // toestel hoort Blokkeren; wil je de gebruiker helemaal buiten, deactiveer
      // dan het account. Dus: laatste toestel niet schrappen.
      const userDeviceCount = (await listAllDevices()).filter((d) => d.userId === userId).length;
      if (userDeviceCount <= 1) {
        return res.status(400).json({
          error: "Je kunt het laatste toestel van een gebruiker niet schrappen — blokkeer het, of deactiveer het account.",
          code: "last_device",
        });
      }
      await deleteDevice(userId, deviceToken);
      const owner = (await getUsersData()).find((u) => String(u.id) === userId);
      await logActivity(req, "system", "Toestel geschrapt", `${owner?.name ?? userId}.`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Toestel schrappen is mislukt.", err);
      res.status(500).json({ error: "Toestel schrappen is mislukt." });
    }
  });

  app.post("/api/devices/rename", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.body?.userId ?? "");
      const deviceToken = String(req.body?.deviceToken ?? "");
      const name = sanitizeDeviceName(req.body?.name);
      if (!userId || !deviceToken || !req.body?.name) return res.status(400).json({ error: "userId, deviceToken en name zijn verplicht." });
      await renameDevice(userId, deviceToken, name);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Toestel hernoemen is mislukt.", err);
      res.status(500).json({ error: "Toestel hernoemen is mislukt." });
    }
  });
};
