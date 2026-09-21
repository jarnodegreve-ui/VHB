/**
 * Cron en back-up: nachtelijke back-up, weekrapport, herstelproef,
 * Telegram-briefing, rooster-meldingen, foutdigest, en handmatig back-up/herstel.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import { sendEmail, sendExpiryReminderEmail, escapeHtml } from "../email.js";
import { sendPushToUsers } from "../push.js";
import type { AuthenticatedRequest } from "../types.js";
import { supabaseAdmin } from "../db.js";
import { authenticate, requireRole, isCronAuthorized } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { encryptOpensslCompatible } from "../backupCrypto.js";
import { symbolicateTopFrame } from "../symbolicate.js";
import { getOcpiRegistration } from "../ocpi.js";
import { getVehicleExpiries, getVehicles } from "./techniekStorage.js";
import { VOERTUIG_VERVAL_LABEL, voertuigNaam } from "../../shared/schemas/techniek.js";
import { verstuurRoosterMeldingen } from "./planningHeropbouw.js";
import { stuurTelegram, telegramGeconfigureerd, formatGaten, formatVandaag, formatZiek, DAG_KORT } from "../telegram.js";
import { berekenDekkingsGaten, berekenCoverageAdvies } from "../coverageRoutes.js";
import { invalidateUsersCache } from "../userCache.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { addDagenIso, brusselsDay, DAG_DMJ, isDigestRuis, SWAP_UITVOERING_ACTIES, EXPIRY_SOORT_LABEL, isActieveStaf } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getActivityLog, getAanwezigheid, getCoverageExpectations, getSwapExecutions, getDiversionsData, getLeaveData, getPlanningCodesData, getPlanningData, getPlanningMatrixRows, getServicesData, getSwapsData, getUpdatesData, getUsersData, logActivity, getClientErrorsSince, getClientErrorStatuses, storeBackup, checkBackupIntegrity, pruneOldRecords, listUserDocuments, getRitblaadjeMeta, restoreFromBackup, logCronHeartbeat, getUserExpiries, getLatestBackup } from "../storage.js";
import { viewUrl } from "./collectie.js";

// --- Back-up: alle collecties als één JSON ---
const buildBackupPayload = async () => {
  const [users, planning, services, diversions, updates, leave, swaps, planningCodes, planningMatrixRows, coverageExpectations, activityLog] = await Promise.all([
    getUsersData(),
    getPlanningData(),
    getServicesData(),
    getDiversionsData(),
    getUpdatesData(),
    getLeaveData(),
    getSwapsData(),
    getPlanningCodesData(),
    getPlanningMatrixRows(),
    getCoverageExpectations(),
    // Volledig auditspoor (binnen retentie) — met de default-cap van 100
    // bevatte de "volledige" back-up stil maar 100 logregels.
    getActivityLog({ sinceIso: null, max: 50000, metRuilBekeken: true }),
  ]);
  // Auth-accounts (id+e-mail): een restore van een verwijderde gebruiker
  // maakt anders een account met random wachtwoord aan zonder dat je weet
  // welk e-mailadres erbij hoorde. Best-effort — Auth-uitval mag de backup
  // niet blokkeren.
  let authUsers: Array<{ id: string; email: string | null }> = [];
  try {
    if (supabaseAdmin) {
      const { data: authPage } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      authUsers = ((authPage?.users ?? []) as Array<{ id: string; email?: string }>).map((u) => ({ id: u.id, email: u.email ?? null }));
    }
  } catch (err) {
    console.error("[backup] auth-export mislukt (backup gaat door):", err);
  }

  // OCPI-registratie (Token C + endpoints): zonder deze rij moet de hele
  // ChargEye-handshake opnieuw na een restore.
  let ocpiRegistration: unknown = null;
  try {
    ocpiRegistration = await getOcpiRegistration();
  } catch (err) {
    console.error("[backup] ocpi_registration-export mislukt (backup gaat door):", err);
  }

  // Documenten- + ritblad-metadata: de bestanden zelf staan in Storage-buckets
  // (niet in deze JSON), maar zonder deze rijen weet je na projectverlies niet
  // meer wélk document bij wie hoorde. Referentie-export (net als authUsers).
  let userDocuments: unknown[] = [];
  let ritblaadje: unknown = null;
  try {
    userDocuments = await listUserDocuments();
    ritblaadje = await getRitblaadjeMeta();
  } catch (err) {
    console.error("[backup] documenten/ritblad-export mislukt (backup gaat door):", err);
  }

  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    collections: {
      users,
      planning,
      services,
      diversions,
      updates,
      leave,
      swaps,
      planningCodes,
      planningMatrixRows,
      coverageExpectations,
      activityLog,
    },
    // Referentie-exports (niet door /api/restore teruggeschreven; handmatig
    // te gebruiken bij disaster-recovery). userDocuments/ritblaadje = metadata;
    // de bijhorende bestanden wonen in de Storage-buckets.
    authUsers,
    ocpiRegistration,
    userDocuments,
    ritblaadje,
  };
};

// Ontvangers van systeemmails (foutendigest, back-ups): ALERT_EMAIL wint;
// anders alle actieve admins mét e-mailadres die zich niet hebben afgemeld
// (users.wantssystemmail, beheerbaar in Gebruikersbeheer).
const systemMailRecipients = async (): Promise<string[]> => {
  const explicit = (process.env.ALERT_EMAIL || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (explicit.length > 0) return explicit;
  return (await getUsersData())
    .filter((u) => u.role === "admin" && u.isActive !== false && u.email && u.wantsSystemMail !== false)
    .map((u) => u.email as string);
};

export function mountCronRoutes(app: express.Express) {
  app.get("/api/backup", authenticate, requireRole("admin"), async (_req, res) => {
    try {
      res.json(await buildBackupPayload());
    } catch (err: any) {
      console.error("Back-up genereren is mislukt", err);
      res.status(500).json({ error: "Back-up genereren is mislukt" });
    }
  });

  // Nachtelijke back-up, aangeroepen door de Vercel-cron (zie vercel.json).
  // Vercel stuurt automatisch `Authorization: Bearer ${CRON_SECRET}` mee als
  // die env-var in het project staat — zonder geldig secret: 401.
  app.get("/api/cron/backup", async (req, res) => {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Niet toegestaan." });
    }
    try {
      const payload = await buildBackupPayload();
      const filename = `vhb-backup-${payload.exportedAt.slice(0, 10)}.json`;
      const json = JSON.stringify(payload);
      const stored = await storeBackup(filename, json);
      console.log(`[cron-backup] ${filename} opgeslagen, ${stored.removedOld} oude back-up(s) opgeruimd.`);

      // Integriteitscheck: vangt een stille lege/kapotte back-up (geen admin,
      // ontbrekende collectie, niet-serialiseerbaar) vóór het pas bij een échte
      // restore opvalt. Bij problemen mailen naar ALERT_EMAIL/admins.
      const integrity = checkBackupIntegrity(payload);
      if (!integrity.ok) {
        console.error(`[cron-backup] INTEGRITEIT: ${integrity.issues.join("; ")}`);
        try {
          const alertTo = await systemMailRecipients();
          if (alertTo.length > 0) {
            await sendEmail({
              to: alertTo,
              context: "backup-integrity",
              subject: `⚠️ VHB back-up-integriteit, controleer ${filename}`,
              text: `De back-up ${filename} is opgeslagen maar faalde de integriteitscheck:\n\n- ${integrity.issues.join("\n- ")}\n\nControleer of de portaal-data compleet is.`,
              html: `<p>De back-up <strong>${escapeHtml(filename)}</strong> is opgeslagen maar faalde de integriteitscheck:</p><ul>${integrity.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul><p>Controleer of de portaal-data compleet is.</p>`,
            });
          }
        } catch (mailErr) {
          console.error("[cron-backup] integriteit-alert mailen mislukt:", mailErr);
        }
      }

      // Wekelijkse off-site kopie (zondag): de bucket-back-ups wonen in
      // hetzélfde Supabase-project — bij projectverlies zijn ze mee weg. Een
      // mail-bijlage naar ALERT_EMAIL/admins is de goedkoopste externe kopie.
      // VERSLEUTELD (30/07): de bijlage bevatte de volledige personeelsdata
      // leesbaar in mailboxen én in het Resend-dashboard — één gehackte
      // mailbox was een compleet datalek. Zonder BACKUP_PASSPHRASE wordt er
      // NIET gemaild (fail-closed) — de nachtelijke bucket-kopie blijft er.
      let mailedOffsite = false;
      if (new Date().getUTCDay() === 0) {
        const passphrase = process.env.BACKUP_PASSPHRASE;
        if (!passphrase) {
          console.error("[cron-backup] BACKUP_PASSPHRASE ontbreekt, wekelijkse off-site mail overgeslagen (bewust: nooit onversleuteld mailen).");
        } else {
          const recipients = await systemMailRecipients();
          if (recipients.length > 0) {
            const encrypted = encryptOpensslCompatible(json, passphrase);
            const uitleg = "Ontsleutelen (vraagt om de wachtwoordzin uit je wachtwoordmanager):\n\n  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in " + filename + ".enc -out " + filename + "\n\nZie ook docs/RESTORE.md in de repo.";
            const result = await sendEmail({
              to: recipients,
              context: "weekly-backup",
              subject: `VHB Portaal, wekelijkse back-up ${payload.exportedAt.slice(0, 10)} (versleuteld)`,
              text: `In bijlage de wekelijkse off-site kopie van de portaal-back-up, AES-256-versleuteld. Bewaar deze mail buiten Supabase/Vercel.\n\n${uitleg}`,
              html: `<p>In bijlage de wekelijkse off-site kopie van de portaal-back-up, <strong>AES-256-versleuteld</strong>. Bewaar deze mail buiten Supabase/Vercel.</p><p>Ontsleutelen (vraagt om de wachtwoordzin uit je wachtwoordmanager):</p><pre>openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ${escapeHtml(filename)}.enc -out ${escapeHtml(filename)}</pre><p>Zie ook <code>docs/RESTORE.md</code> in de repo.</p>`,
              attachments: [{ filename: `${filename}.enc`, content: encrypted }],
            });
            mailedOffsite = result.ok && !result.mocked;
          }
        }
      }

      // Retentie ná de back-up: de zojuist gemaakte back-up bevat de volledige
      // historiek nog, daarna mag oud grut weg (fouten 30 d, auditlog 1 jaar —
      // instelbaar via env). Best-effort: mag de back-up-respons niet breken.
      const errorDays = Number(process.env.RETENTION_ERROR_DAYS) > 0 ? Number(process.env.RETENTION_ERROR_DAYS) : 30;
      const logDays = Number(process.env.RETENTION_LOG_DAYS) > 0 ? Number(process.env.RETENTION_LOG_DAYS) : 365;
      const noteDays = Number(process.env.RETENTION_NOTE_DAYS) > 0 ? Number(process.env.RETENTION_NOTE_DAYS) : 90;
      // Meldingen (meldingencentrum): na 90 dagen geschiedenis.
      const meldingDays = Number(process.env.RETENTION_MELDING_DAYS) > 0 ? Number(process.env.RETENTION_MELDING_DAYS) : 90;
      // Aanwezigheid: het overzicht kijkt hoogstens 90 dagen terug, dus verder
      // bewaren levert niets op en is wél doorlopende registratie van gedrag.
      const aanwezigheidDays = Number(process.env.RETENTION_AANWEZIGHEID_DAYS) > 0 ? Number(process.env.RETENTION_AANWEZIGHEID_DAYS) : 90;
      const pruned = await pruneOldRecords({ errorDays, logDays, noteDays, meldingDays, aanwezigheidDays });
      const prunedTotal = pruned.clientErrors + pruned.activityLog + pruned.planningNotes + pruned.pushSubscriptions + pruned.meldingen + pruned.aanwezigheid;
      if (prunedTotal > 0) {
        console.log(`[cron-backup] retentie: ${pruned.clientErrors} client-fouten (>${errorDays}d), ${pruned.activityLog} log-regels (>${logDays}d), ${pruned.planningNotes} dienstnotities (>${noteDays}d), ${pruned.meldingen} meldingen (>${meldingDays}d), ${pruned.aanwezigheid} aanwezigheidssessies (>${aanwezigheidDays}d) en ${pruned.pushSubscriptions} verweesde push-abonnementen opgeruimd.`);
      }

      await logCronHeartbeat("backup", `${filename} opgeslagen (${stored.removedOld} oude opgeruimd${mailedOffsite ? ", off-site kopie gemaild" : ""}${prunedTotal ? `, retentie: ${pruned.clientErrors} fouten + ${pruned.activityLog} log-regels + ${pruned.planningNotes} notities + ${pruned.meldingen} meldingen + ${pruned.pushSubscriptions} push-abonnementen weg` : ""}${integrity.ok ? "" : `, ⚠️ integriteit: ${integrity.issues.join(", ")}`}).`);
      res.json({ success: true, filename, removedOld: stored.removedOld, mailedOffsite, pruned, integrity });
    } catch (err: any) {
      console.error("[cron-backup] mislukt:", err?.message || err);
      console.error("Back-up mislukt", err);
      res.status(500).json({ error: "Back-up mislukt" });
    }
  });

  // Foutmelding-digest: periodiek (Vercel-cron) de client-fouten van het
  // afgelopen interval samenvatten en mailen, zodat een storing/foutenpiek niet
  // onopgemerkt blijft tot een chauffeur klaagt. DB-gebaseerd (geen per-instance
  // telprobleem). Stuurt naar ALERT_EMAIL als die env-var bestaat, anders naar
  // alle admin-accounts. Stuurt niets als er geen fouten zijn.
  // Wekelijkse cijfermail (maandagochtend): actieve gebruikers, afgehandelde
  // aanvragen en de foutentrend van de afgelopen week — voor Jarno's
  // maandagoverzicht zonder het portaal te openen. Zelfde ontvangers en
  // opt-out als de andere systeemmails.
  app.get("/api/cron/week-rapport", async (req, res) => {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Niet toegestaan." });
    }
    try {
      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const nuIso = new Date().toISOString();
      const [sessies, leave, swaps, errors, ruilUitvoeringen] = await Promise.all([
        // Actieve gebruikers uit de aanwezigheid, niet meer uit de auth-regels:
        // die telden alleen wie zich opnieuw aanmeldde plus één regel per dag
        // per persoon, en telden dus structureel te laag. Ontbreekt de migratie,
        // dan is de telling 0 in plaats van dat de mail uitblijft.
        getAanwezigheid(sinceIso).catch((err) => {
          if (!isMissingTableError(err)) throw err;
          return [];
        }),
        getLeaveData(),
        getSwapsData(),
        getClientErrorsSince(sinceIso),
        // Uitgevoerde wissels uit het activiteitenlog, niet uit `decidedAt`:
        // dat veld wordt door een latere terugdraai overschreven (en tot 20-09
        // ook door afhandelen, 'completed'), waardoor een wissel van vorige
        // week deze week meegeteld werd (en omgekeerd). Zelfde bron als het
        // wekelijkse ruiloverzicht.
        getSwapExecutions(sinceIso, nuIso, SWAP_UITVOERING_ACTIES),
      ]);
      const uniekeGebruikers = new Set(sessies.map((s) => s.userId)).size;
      const inWindow = (iso?: string) => Boolean(iso && iso >= sinceIso);
      const verlofBeslist = leave.filter((l) => inWindow(l.decidedAt)).length;
      const verlofNieuw = leave.filter((l) => inWindow(l.createdAt)).length;
      const ruilUitgevoerd = ruilUitvoeringen.length;
      const ruilNieuw = swaps.filter((sw) => inWindow(sw.createdAt)).length;
      const openVerlof = leave.filter((l) => l.status === "pending").length;
      const openRuil = swaps.filter((sw) => sw.status === "pending" || sw.status === "accepted").length;
      const echteFouten = errors.filter((e) => !isDigestRuis(e.message)).length;

      const recipients = await systemMailRecipients();
      if (recipients.length === 0) {
        return res.json({ success: true, sent: false, reason: "geen ontvangers" });
      }
      const regels = [
        `Actieve gebruikers: ${uniekeGebruikers}`,
        `Verlof: ${verlofNieuw} nieuw · ${verlofBeslist} beslist · ${openVerlof} open`,
        `Dienstruil: ${ruilNieuw} nieuw · ${ruilUitgevoerd} uitgevoerd · ${openRuil} open`,
        `Client-fouten: ${echteFouten} (sessie-meldingen niet meegeteld)`,
      ];
      await sendEmail({
        to: recipients,
        context: "week-rapport",
        subject: `VHB Portaal, weekoverzicht`,
        text: `Cijfers van de afgelopen 7 dagen:\n\n- ${regels.join("\n- ")}\n\nBekijk de details in het portaal.`,
        html: `<p>Cijfers van de afgelopen <strong>7 dagen</strong>:</p><ul>${regels.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul><p>Bekijk de details in het portaal.</p>`,
      });
      await logCronHeartbeat("week-rapport", `Weekoverzicht gemaild aan ${recipients.length} ontvanger(s).`);
      res.json({ success: true, sent: true });
    } catch (err: any) {
      console.error("[week-rapport] mislukt:", err?.message || err);
      res.status(500).json({ error: "Weekrapport mislukt" });
    }
  });

  // Maandelijkse restore-proef: de back-up wordt elke nacht gemaakt en op
  // integriteit gecheckt bij het MAKEN — maar of het bestand ook terug te
  // lezen en te herstellen valt, werd nooit geoefend. Deze cron leest de
  // laatste back-up terug, parseert hem en draait dezelfde integriteitscheck;
  // faalt er iets, dan gaat er direct een alarm-mail uit.
  app.get("/api/cron/restore-proef", async (req, res) => {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Niet toegestaan." });
    }
    try {
      const issues: string[] = [];
      let filename = "";
      try {
        const backup = await getLatestBackup();
        if (!backup) {
          issues.push("geen enkel back-upbestand gevonden in de bucket");
        } else {
          filename = backup.filename;
          let payload: any;
          try {
            payload = JSON.parse(backup.body);
          } catch {
            issues.push(`${backup.filename} is geen geldige JSON`);
          }
          if (payload) {
            const integrity = checkBackupIntegrity(payload);
            if (!integrity.ok) issues.push(...integrity.issues);
            // Sanity: live niet-lege kerncollecties moeten ook in de back-up zitten.
            const liveUsers = (await getUsersData()).length;
            const backupUsers = Array.isArray(payload?.collections?.users) ? payload.collections.users.length : 0;
            if (liveUsers > 0 && backupUsers === 0) issues.push("back-up bevat 0 gebruikers terwijl er live wél zijn");
          }
        }
      } catch (err: any) {
        issues.push(`teruglezen mislukt: ${err?.message || err}`);
      }

      if (issues.length > 0) {
        const recipients = await systemMailRecipients();
        if (recipients.length > 0) {
          await sendEmail({
            to: recipients,
            context: "restore-proef",
            subject: `⚠️ VHB restore-proef gefaald${filename ? `, ${filename}` : ""}`,
            text: `De maandelijkse restore-proef vond problemen:\n\n- ${issues.join("\n- ")}\n\nControleer de back-ups zo snel mogelijk, dit is je herstelpad.`,
            html: `<p>De maandelijkse restore-proef vond problemen:</p><ul>${issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul><p>Controleer de back-ups zo snel mogelijk, dit is je herstelpad.</p>`,
          });
        }
        await logCronHeartbeat("restore-proef", `GEFAALD: ${issues.join("; ")}`);
        return res.json({ success: false, issues });
      }
      await logCronHeartbeat("restore-proef", `${filename} teruggelezen en integriteitscheck geslaagd.`);
      res.json({ success: true, filename });
    } catch (err: any) {
      console.error("[restore-proef] mislukt:", err?.message || err);
      res.status(500).json({ error: "Restore-proef mislukt" });
    }
  });

  // Ochtendbriefing naar Telegram (verbeterronde-bot 22-08, nr. 4): elke dag
  // een kort overzicht — óók als alles in orde is, want "geen bericht" en
  // "geen probleem" zijn anders niet te onderscheiden. Bevat vandaag + morgen,
  // wie ziek is, de planning-horizon en dringende vervaldata (nr. 5).
  app.get("/api/cron/telegram-briefing", async (req, res) => {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Niet toegestaan." });
    }
    try {
      if (!telegramGeconfigureerd()) {
        return res.json({ success: true, skipped: "telegram niet geconfigureerd" });
      }
      const vandaag = brusselsDay(new Date().toISOString());
      const morgen = addDagenIso(vandaag, 1);
      const [dagenVandaag, dagenMorgen, matrixRows, expiries, usersVoorVerval] = await Promise.all([
        berekenDekkingsGaten(vandaag, vandaag),
        berekenDekkingsGaten(morgen, morgen),
        getPlanningMatrixRows(),
        getUserExpiries(),
        getUsersData(),
      ]);

      const delen: string[] = [];
      const dagLang = new Date(`${vandaag}T12:00:00Z`).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Brussels" });
      delen.push(`🌅 <b>Ochtendbriefing, ${dagLang}</b>`);
      delen.push(await formatVandaag(dagenVandaag));
      const morgenGat = dagenMorgen.find((d) => d.date === morgen);
      delen.push(!morgenGat
        ? "⚠️ Geen geïmporteerde planning voor morgen."
        : morgenGat.missing.length > 0
          ? `Morgen open: ${morgenGat.missing.map((c) => escapeHtml(c)).join(", ")}.`
          : "Morgen: alles ingevuld.");
      delen.push(await formatZiek());

      // Planning-horizon: hoe ver reikt de geïmporteerde matrix nog?
      const laatste = (matrixRows as any[])
        .map((r) => String(r.source_date ?? ""))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort()
        .pop();
      if (laatste) {
        const dagenOver = Math.round((Date.parse(`${laatste}T00:00:00Z`) - Date.parse(`${vandaag}T00:00:00Z`)) / 86400000);
        if (dagenOver < 0) {
          delen.push(`⚠️ De geïmporteerde planning is verlopen (liep t/m ${DAG_KORT(laatste)}), importeer de nieuwe Excel.`);
        } else if (dagenOver <= 7) {
          delen.push(`⚠️ Nog maar ${dagenOver} dag${dagenOver === 1 ? "" : "en"} planning in het portaal (t/m ${DAG_KORT(laatste)}), tijd voor een import.`);
        }
      }

      // Dringende vervaldata (≤ 7 dagen of verlopen) — de mail meldt breder,
      // dit is alleen de staart die echt aandacht vraagt.
      const naamVan = (id: string) => (usersVoorVerval as any[]).find((u) => String(u.id) === id)?.name ?? "Onbekend";
      const dringend = expiries
        .filter((e) => Boolean(EXPIRY_SOORT_LABEL[e.soort]) && e.validUntil)
        .map((e) => ({ ...e, dagen: Math.round((Date.parse(`${e.validUntil}T00:00:00Z`) - Date.parse(`${vandaag}T00:00:00Z`)) / 86400000) }))
        .filter((e) => e.dagen <= 7)
        .sort((a, b) => a.dagen - b.dagen);
      if (dringend.length > 0) {
        delen.push(`📄 Documenten: ${dringend.map((e) => `${escapeHtml(naamVan(e.userId))}, ${EXPIRY_SOORT_LABEL[e.soort]} ${e.dagen < 0 ? `VERLOPEN (${DAG_DMJ(e.validUntil)})` : e.dagen === 0 ? "verloopt VANDAAG" : `nog ${e.dagen} dag${e.dagen === 1 ? "" : "en"}`}`).join("; ")}.`);
      }

      // Kandidaten-knoppen voor de gaten van vandaag + morgen (max 8).
      const { knoppen } = formatGaten([...dagenVandaag, ...dagenMorgen.filter((d) => d.date === morgen)]);
      const verzonden = await stuurTelegram(delen.join("\n\n"), { knoppen });
      await logCronHeartbeat("telegram-briefing", verzonden ? "Briefing verstuurd." : "Versturen mislukt of niet geconfigureerd.");
      res.json({ success: true, verzonden });
    } catch (err: any) {
      console.error("[telegram-briefing] mislukt:", err?.message ?? err);
      res.status(500).json({ error: "Briefing versturen is mislukt." });
    }
  });

  // Rooster-meldingen na automatisch bijgewerkte planning: één melding per
  // chauffeur zodra het dienstoverzicht ROOSTER_MELDING_RUST_MINUTEN stil is
  // (zie de meldingswachtrij in api/_lib/planningHeropbouw.ts). Elke 5 minuten;
  // zonder wachtrij is dit één kleine lezing van app_settings.
  app.get("/api/cron/rooster-meldingen", async (req, res) => {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Niet toegestaan." });
    }
    try {
      const uit = await verstuurRoosterMeldingen();
      // Hartslag hooguit één keer per uur: valt deze cron stil, dan blijven de
      // uitgestelde meldingen liggen, en dat hoort de health-check te zien.
      await logCronHeartbeat("rooster-meldingen", uit.status === "verstuurd" ? `Melding naar ${uit.ontvangers} chauffeur(s).` : `Niets te versturen (${uit.status}).`, 60);
      res.json({ success: true, ...uit });
    } catch (err) {
      console.error("Rooster-meldingen versturen is mislukt.", err);
      res.status(500).json({ error: "Rooster-meldingen versturen is mislukt." });
    }
  });

  app.get("/api/cron/error-digest", async (req, res) => {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Niet toegestaan." });
    }
    try {
      // Default 1440 min (24u): de cron draait dagelijks — een Hobby-plan staat
      // geen vaker-dan-daagse cron toe. Op Pro kun je de cron frequenter zetten
      // en deze env navenant verlagen (bv. 60 voor uurlijks).
      // Weekoverzicht i.p.v. dagoverzicht (Jarno 05-09: dagelijkse mail was
      // storend): de cron blijft dagelijks draaien (vervaldata-pushes en het
      // dekkingsoverzicht horen elke dag), maar de mail gaat alleen op de
      // ERROR_DIGEST_WEEKDAG (0 = zondag … 6; standaard 1 = maandag) en kijkt
      // dan zeven dagen terug. ERROR_DIGEST_WEEKDAG=elke = weer dagelijks.
      const weekdag = (process.env.ERROR_DIGEST_WEEKDAG ?? "1").trim().toLowerCase();
      const mailVandaag = weekdag === "elke" || String(new Date().getDay()) === weekdag;
      const intervalMin = Number(process.env.ERROR_DIGEST_INTERVAL_MIN) > 0
        ? Number(process.env.ERROR_DIGEST_INTERVAL_MIN)
        : weekdag === "elke" ? 1440 : 10080;
      const minCount = Number(process.env.ERROR_DIGEST_MIN_COUNT) > 0
        ? Number(process.env.ERROR_DIGEST_MIN_COUNT)
        : 0;
      const sinceMs = Date.now() - intervalMin * 60 * 1000;
      const sinceIso = new Date(sinceMs).toISOString();

      const allErrors = await getClientErrorsSince(sinceIso);
      // Levenscyclus ("sessie verlopen") en deploy-ruis (chunk-laadfouten die
      // lazyWithRetry al opvangt) horen niet in de mail — zie isDigestRuis.
      // Ook groepen die de admin in Systeemstatus op 'genegeerd' zette blijven
      // buiten de mail. De rijen blijven wél in de DB en in Systeem Status zichtbaar.
      const statussen = await getClientErrorStatuses();
      const genegeerd = (e: { fingerprint?: string }) => Boolean(e.fingerprint && statussen?.get(e.fingerprint)?.status === "genegeerd");
      const errors = allErrors.filter((e) => !isDigestRuis(e.message) && !genegeerd(e));
      const filtered = allErrors.length - errors.length;

      // Vervaldata-bewaker (07-08): één keer per dag — dus in deze cron —
      // nakijken welke documenten (Code 95 / medische schifting) bijna
      // verlopen. Pushes op de vaste mijlpalen 90/30/7/0 dagen: de cron draait
      // 1×/dag, dus dat is vanzelf exact één push per mijlpaal, zonder aparte
      // verstuurd-administratie. De mailsectie hieronder toont alles binnen 60
      // dagen (herhaling in een dagoverzicht is juist de bedoeling).
      // Best-effort — mag het dagoverzicht nooit breken.
      let vervalTekst = "";
      let vervalHtml = "";
      try {
        const [expiries, alleUsers] = await Promise.all([getUserExpiries(), getUsersData()]);
        const actief = new Map(alleUsers.filter((u: any) => u.isActive !== false).map((u: any) => [String(u.id), u]));
        const vandaag = brusselsDay(new Date().toISOString());
        const dagenTot = (d: string) => Math.round((Date.parse(d) - Date.parse(vandaag)) / 86400000);
        const rijen = expiries
          // Alleen bewaakte soorten (rijbewijs is er uit): een achtergebleven
          // rij mag geen push of mailregel meer veroorzaken.
          .filter((e) => actief.has(e.userId) && Boolean(EXPIRY_SOORT_LABEL[e.soort]))
          .map((e) => ({
            ...e,
            naam: String((actief.get(e.userId) as any)?.name ?? "Onbekend"),
            label: EXPIRY_SOORT_LABEL[e.soort],
            dagen: dagenTot(e.validUntil),
          }))
          .filter((e) => Number.isFinite(e.dagen))
          .sort((a, b) => a.dagen - b.dagen);
        for (const e of rijen) {
          if (e.dagen === 90 || e.dagen === 30 || e.dagen === 7 || e.dagen === 0) {
            await sendPushToUsers([e.userId], {
              title: e.dagen === 0 ? `${e.label} verloopt vandaag` : `${e.label} verloopt over ${e.dagen} dagen`,
              soort: "systeem",
              body: `Je ${e.label.toLowerCase()} is geldig tot ${DAG_DMJ(e.validUntil)}. Regel tijdig de vernieuwing en geef het door aan de planning.`,
              url: "/",
            });
            // Óók per e-mail naar de chauffeur zelf (idee 46): push bereikt maar
            // een handvol chauffeurs, mail wél. Best-effort, mag de cron niet
            // laten vallen. Eén mijlpaal per dag ⇒ vanzelf één mail per mijlpaal.
            const mailAdres = String((actief.get(e.userId) as any)?.email ?? "").trim();
            if (mailAdres) {
              try {
                await sendExpiryReminderEmail({
                  to: mailAdres,
                  name: e.naam,
                  soortLabel: e.label,
                  validUntil: e.validUntil,
                  dagen: e.dagen,
                });
              } catch (mailErr: any) {
                console.error("[error-digest] vervaldata-mail mislukt:", mailErr?.message ?? mailErr);
              }
            }
          }
        }
        const teMelden = rijen.filter((e) => e.dagen <= 60);
        if (teMelden.length > 0) {
          const regel = (e: (typeof teMelden)[number]) =>
            e.dagen < 0
              ? `${e.naam}, ${e.label} is VERLOPEN sinds ${DAG_DMJ(e.validUntil)} (${Math.abs(e.dagen)} dagen)`
              : e.dagen === 0
                ? `${e.naam}, ${e.label} verloopt VANDAAG (${DAG_DMJ(e.validUntil)})`
                : `${e.naam}, ${e.label} verloopt over ${e.dagen} ${e.dagen === 1 ? "dag" : "dagen"} (${DAG_DMJ(e.validUntil)})`;
          vervalTekst = `\n\nDocumenten (binnen 60 dagen):\n${teMelden.map((e) => `• ${regel(e)}`).join("\n")}`;
          vervalHtml = `<p><strong>Documenten (binnen 60 dagen)</strong></p><ul>${teMelden.map((e) => `<li>${escapeHtml(regel(e))}</li>`).join("")}</ul>`;
        }
      } catch (err: any) {
        console.error("[error-digest] vervaldata-sectie mislukt:", err?.message ?? err);
      }

      // Vervaldata per voertuig (techniek, 13-09): keuring SBAT, brandblussers,
      // tachograaf. Zelfde mijlpalen-mechaniek als hierboven, maar de push gaat
      // naar de techniekers en admins (het voertuig heeft geen mailbox) en de
      // mailsectie toont alles binnen 60 dagen. Best-effort.
      let voertuigVervalTekst = "";
      let voertuigVervalHtml = "";
      try {
        const [voertuigExpiries, voertuigen, alleUsers] = await Promise.all([getVehicleExpiries(), getVehicles(), getUsersData()]);
        const perVoertuig = new Map(voertuigen.filter((v) => v.status !== "uit_dienst").map((v) => [v.id, v]));
        const vandaag = brusselsDay(new Date().toISOString());
        const dagenTot = (d: string) => Math.round((Date.parse(d) - Date.parse(vandaag)) / 86400000);
        const rijen = voertuigExpiries
          .filter((e) => perVoertuig.has(e.vehicleId) && Boolean(VOERTUIG_VERVAL_LABEL[e.soort]))
          .map((e) => ({ ...e, naam: voertuigNaam(perVoertuig.get(e.vehicleId)!), label: VOERTUIG_VERVAL_LABEL[e.soort], dagen: dagenTot(e.validUntil) }))
          .filter((e) => Number.isFinite(e.dagen))
          .sort((a, b) => a.dagen - b.dagen);
        const ontvangers = alleUsers
          .filter((u: any) => u.isActive !== false && (u.role === "technieker" || u.role === "admin"))
          .map((u: any) => String(u.id));
        for (const e of rijen) {
          if (e.dagen === 60 || e.dagen === 30 || e.dagen === 7 || e.dagen === 0) {
            await sendPushToUsers(ontvangers, {
              title: e.dagen === 0 ? `${e.naam}: ${e.label} verloopt vandaag` : `${e.naam}: ${e.label} verloopt over ${e.dagen} dagen`,
              soort: "techniek",
              body: `Geldig tot ${DAG_DMJ(e.validUntil)}. Plan de keuring of vervanging in.`,
              url: "/?view=voertuigen",
            });
          }
        }
        const teMelden = rijen.filter((e) => e.dagen <= 60);
        if (teMelden.length > 0) {
          const regel = (e: (typeof teMelden)[number]) =>
            e.dagen < 0
              ? `${e.naam}, ${e.label} is VERLOPEN sinds ${DAG_DMJ(e.validUntil)} (${Math.abs(e.dagen)} dagen)`
              : e.dagen === 0
                ? `${e.naam}, ${e.label} verloopt VANDAAG (${DAG_DMJ(e.validUntil)})`
                : `${e.naam}, ${e.label} verloopt over ${e.dagen} ${e.dagen === 1 ? "dag" : "dagen"} (${DAG_DMJ(e.validUntil)})`;
          voertuigVervalTekst = `\n\nVoertuigen (binnen 60 dagen):\n${teMelden.map((e) => `• ${regel(e)}`).join("\n")}`;
          voertuigVervalHtml = `<p><strong>Voertuigen (binnen 60 dagen)</strong></p><ul>${teMelden.map((e) => `<li>${escapeHtml(regel(e))}</li>`).join("")}</ul>`;
        }
      } catch (err: any) {
        // Vóór de migratie bestaat de tabel niet: stil overslaan.
        if (!isMissingTableError(err)) console.error("[error-digest] voertuig-vervaldata-sectie mislukt:", err?.message ?? err);
      }

      // Proactieve advisor (idee 3, 18-08): elke ochtend de openstaande diensten
      // van de komende 7 dagen mét het collega-advies per gat — de planner hoeft
      // het portaal niet meer te openen om te wéten dat er iets openstaat. Best-
      // effort, mag het dagoverzicht nooit breken. Per gat draait de volledige
      // adviesberekening; cap op 8 zodat de cron niet ontspoort bij een lege maand.
      let dekkingTekst = "";
      let dekkingHtml = "";
      try {
        const vandaagBrussel = brusselsDay(new Date().toISOString());
        const dagen = await berekenDekkingsGaten(vandaagBrussel, addDagenIso(vandaagBrussel, 6));
        const gaten = dagen.flatMap((d) => d.missing.map((code) => ({ date: d.date, code })));
        if (gaten.length > 0) {
          const MAX_ADVIEZEN = 8;
          const regels: string[] = [];
          for (const gat of gaten.slice(0, MAX_ADVIEZEN)) {
            try {
              const advies = await berekenCoverageAdvies(gat.date, gat.code);
              regels.push(`${DAG_KORT(gat.date)}, dienst ${gat.code}: ${advies.samenvatting}`);
            } catch {
              regels.push(`${DAG_KORT(gat.date)}, dienst ${gat.code}: advies kon niet berekend worden.`);
            }
          }
          if (gaten.length > MAX_ADVIEZEN) {
            regels.push(`…en nog ${gaten.length - MAX_ADVIEZEN} openstaande diensten, zie Openstaande diensten in het portaal.`);
          }
          dekkingTekst = `\n\nOpenstaande diensten (komende 7 dagen):\n${regels.map((r) => `• ${r}`).join("\n")}`;
          dekkingHtml = `<p><strong>Openstaande diensten (komende 7 dagen)</strong></p><ul>${regels.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`;
          // Push naar planners/admins — 1×/dag en alleen als er echt iets
          // openstaat (geen ruis bij een gedekte week, zelfde principe als
          // isDigestRuis). Mail blijft het volledige overzicht.
          const alleVoorPush = await getUsersData();
          const planners = (alleVoorPush as any[])
            .filter(isActieveStaf)
            .map((u) => String(u.id));
          if (planners.length > 0) {
            await sendPushToUsers(planners, {
              title: `${gaten.length} openstaande dienst${gaten.length === 1 ? "" : "en"} komende 7 dagen`,
              soort: "planning",
              body: regels[0].slice(0, 140),
              url: viewUrl("dekking"),
            });
          }
          // Zelfde signaal ook naar de gekoppelde Telegram-chat, mét
          // kandidaten-knoppen per gat — push bereikt bijna niemand, Telegram
          // wél (keuze Jarno 21-08). Best-effort, net als de rest.
          if (telegramGeconfigureerd()) {
            const { tekst: tgTekst, knoppen } = formatGaten(dagen);
            await stuurTelegram(tgTekst, { knoppen });
          }
        }
      } catch (err: any) {
        console.error("[error-digest] openstaande-diensten-sectie mislukt:", err?.message ?? err);
      }

      // Bewust GEEN drempel meer (verzoek Jarno, 02-08): elke dag een overzicht,
      // ook bij nul meldingen. Een mail die alleen bij problemen komt, laat je
      // je afvragen of hij niet gewoon niet verstuurd is. ERROR_DIGEST_MIN_COUNT
      // blijft bestaan voor wie hem toch wil gebruiken; standaard 0 = altijd.
      if (minCount > 0 && errors.length < minCount) {
        await logCronHeartbeat("error-digest", `Onder de drempel (${errors.length} meldingen${filtered ? ` + ${filtered} genegeerd als ruis` : ""} in ${intervalMin} min).`);
        return res.json({ success: true, count: errors.length, ignored: filtered, alerted: false });
      }

      if (!mailVandaag) {
        await logCronHeartbeat("error-digest", `Geen mail vandaag (weekoverzicht op weekdag ${weekdag}); ${errors.length} meldingen in de wachtrij`);
        return res.json({ success: true, count: errors.length, ignored: filtered, alerted: false, reason: "weekoverzicht" });
      }

      // Bepaal de ontvangers.
      const recipients = await systemMailRecipients();
      if (recipients.length === 0) {
        return res.json({ success: true, count: errors.length, alerted: false, reason: "geen ontvangers" });
      }

      // Groepeer op bron + bericht. getClientErrorsSince sorteert nieuwste
      // eerst, dus de stack bij het aanmaken van de groep is de recentste.
      const groups = new Map<string, { source: string; message: string; count: number; lastUrl?: string; lastStack?: string }>();
      for (const e of errors) {
        const key = `${e.source || "?"}::${e.message}`;
        const g = groups.get(key) ?? { source: e.source || "onbekend", message: e.message, count: 0, lastUrl: e.url, lastStack: e.stack };
        g.count += 1;
        groups.set(key, g);
      }
      const sorted = [...groups.values()].sort((a, b) => b.count - a.count);

      // Geminifieerde stacks terugvertalen naar src/-posities (best-effort,
      // alleen de top — de sourcemap-consumer wordt per bundel gecachet).
      const originOf = new Map<(typeof sorted)[number], string>();
      for (const g of sorted.slice(0, 8)) {
        try {
          const origin = await symbolicateTopFrame(g.lastStack);
          if (origin) originOf.set(g, origin);
        } catch { /* digest nooit laten falen op symbolicatie */ }
      }

      const topLines = sorted.slice(0, 15)
        .map((g) => `• [${g.count}×] ${g.source}: ${g.message}${originOf.has(g) ? ` → ${originOf.get(g)}` : ""}${g.lastUrl ? ` (${g.lastUrl})` : ""}`)
        .join("\n");
      const moreLine = sorted.length > 15 ? `\n…en nog ${sorted.length - 15} andere foutsoorten.` : "";

      const windowLabel = intervalMin % 1440 === 0 && intervalMin > 1440
        ? `${intervalMin / 1440} dagen`
        : intervalMin % 60 === 0 ? `${intervalMin / 60} uur` : `${intervalMin} min`;
      const overzichtNaam = weekdag === "elke" ? "dagoverzicht" : "weekoverzicht";

      // Hoeveel toestellen/gebruikers raakte het? Dát is het signaal, niet het
      // aantal meldingen: 16 meldingen van één toestel is iemand die zit te
      // klikken tijdens een deploy, 16 verdeeld over tien mensen is een storing.
      // Lege userId = niet ingelogd; die tellen als één groep 'onbekend'.
      const gebruikers = new Set(errors.map((e) => String(e.userId || "").replace(/^onbevestigd:/, "") || "onbekend"));
      const impact = errors.length === 0
        ? "geen meldingen"
        : `${errors.length} melding${errors.length === 1 ? "" : "en"} · ${gebruikers.size} ${gebruikers.size === 1 ? "toestel" : "toestellen"}`;

      // Neutrale toon, bewust zonder waarschuwingsteken (verzoek Jarno, 02-08):
      // dit is een dagoverzicht dat élke ochtend komt, geen alarm. Een
      // ⚠️ bij 16 meldingen van je eigen toestel las als een storing terwijl er
      // niets aan de hand was. Wat er wél toe doet — hoeveel mensen geraakt
      // zijn — staat nu in de onderwerpregel.
      const subject = `VHB Portaal · ${overzichtNaam}, ${impact}`;
      const inleiding = errors.length === 0
        ? `In de afgelopen ${windowLabel} zijn er geen meldingen binnengekomen.`
        : `In de afgelopen ${windowLabel}: ${errors.length} melding${errors.length === 1 ? "" : "en"} van ${gebruikers.size} ${gebruikers.size === 1 ? "toestel" : "toestellen"} (${sorted.length} unieke soorten).`;
      const staart = filtered > 0
        ? `\n\n${filtered} melding${filtered === 1 ? "" : "en"} niet meegeteld (verlopen sessies en laadfouten vlak na een uitrol, die vangt de app zelf op).`
        : "";
      const text = `${inleiding}${errors.length === 0 ? "" : `\n\n${topLines}${moreLine}`}${staart}${vervalTekst}${voertuigVervalTekst}${dekkingTekst}\n\nBekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.`;
      // g.source/message/lastUrl zijn door de client aangeleverd — escapen,
      // anders is de digest-mail een HTML-injectiekanaal richting de admins.
      // De symbolicatie-uitkomst komt uit de sourcemap (indirect ook input) —
      // dus óók escapen.
      const html = `<p>${escapeHtml(inleiding)}</p>${errors.length === 0 ? "" : `<ul>${sorted.slice(0, 15).map((g) => `<li><strong>${g.count}×</strong> [${escapeHtml(g.source)}] ${escapeHtml(g.message)}${originOf.has(g) ? ` → <code>${escapeHtml(originOf.get(g)!)}</code>` : ""}${g.lastUrl ? ` <em>(${escapeHtml(g.lastUrl)})</em>` : ""}</li>`).join("")}</ul>${sorted.length > 15 ? `<p>…en nog ${sorted.length - 15} andere soorten.</p>` : ""}`}${filtered > 0 ? `<p style="color:#6E767F">${filtered} melding${filtered === 1 ? "" : "en"} niet meegeteld (verlopen sessies en laadfouten vlak na een uitrol, die vangt de app zelf op).</p>` : ""}${vervalHtml}${voertuigVervalHtml}${dekkingHtml}<p>Bekijk de details in het portaal onder Systeem Status (Debug) of in de Vercel-logs.</p>`;

      const result = await sendEmail({ to: recipients, subject, text, html, context: "error-digest" });
      console.log(`[error-digest] ${errors.length} fouten, mail naar ${recipients.length} ontvanger(s), mocked=${result.mocked}`);
      await logCronHeartbeat("error-digest", `${overzichtNaam[0].toUpperCase()}${overzichtNaam.slice(1)} verstuurd: ${impact}${filtered ? `, ${filtered} als ruis genegeerd` : ""} → ${recipients.length} ontvanger(s).`);
      res.json({ success: true, count: errors.length, alerted: true, recipients: recipients.length, mocked: result.mocked });
    } catch (err: any) {
      console.error("[error-digest] mislukt:", err?.message || err);
      console.error("Digest mislukt", err);
      res.status(500).json({ error: "Digest mislukt" });
    }
  });

  // Herstellen vanuit een back-up (admin). Overschrijft de operationele
  // collecties met de inhoud van een eerder gedownload/automatisch back-up-
  // bestand. Bewust een aparte, expliciete route (niet via de array-POSTs) —
  // de bulk-wipe-vangrails gelden hier dus niet: dit ís een bewuste volledige
  // vervanging, beveiligd met admin-rol + bevestiging in de UI.
  app.post("/api/restore", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const body = req.body ?? {};
      const collections = body?.collections;
      if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
        return res.status(400).json({ error: "Ongeldig back-up-bestand: 'collections' ontbreekt." });
      }
      // Minimale sanity-check: een geldige back-up heeft minstens gebruikers,
      // en die set moet een admin bevatten (anders sluit je jezelf buiten).
      if (Array.isArray(collections.users)) {
        const hasAdmin = collections.users.some((u: any) => u?.role === "admin");
        if (!hasAdmin) {
          return res.status(400).json({ error: "Herstel geweigerd: de back-up bevat geen admin-account." });
        }
      }
      const summary = await restoreFromBackup(collections);
      // Restore kan de gebruikers (incl. rollen) hebben vervangen → auth-cache wissen.
      invalidateUsersCache();
      const total = Object.values(summary).reduce((a, b) => a + b, 0);
      await logActivity(
        req,
        "system",
        "Back-up hersteld",
        `Volledige restore uitgevoerd (${body.exportedAt ? `back-up van ${String(body.exportedAt).slice(0, 10)}` : "onbekende datum"}). ${total} records over ${Object.keys(summary).length} collecties teruggezet.`,
      );
      res.json({ success: true, summary });
    } catch (err: any) {
      console.error("Restore mislukt:", err?.message || err);
      // Restore is niet transactioneel: log + meld wat al wel toegepast is, zodat
      // de admin de staat begrijpt en niet half-en-half blijft gokken.
      const appliedSoFar = err?.appliedSoFar && typeof err.appliedSoFar === "object" ? err.appliedSoFar : null;
      if (appliedSoFar) {
        invalidateUsersCache();
        try {
          await logActivity(req, "system", "Back-up gedeeltelijk hersteld",
            `Restore halverwege gefaald. Wél teruggezet: ${Object.entries(appliedSoFar).map(([k, v]) => `${k} (${v})`).join(", ") || "niets"}. Fout: ${err?.message || "onbekend"}.`);
        } catch { /* logging mag de foutrespons niet blokkeren */ }
      }
      console.error("Herstellen is mislukt", err);
      res.status(500).json({ error: "Herstellen is mislukt", appliedSoFar });
    }
  });
}
