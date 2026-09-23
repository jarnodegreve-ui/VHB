/**
 * Planning: diensten, planningsmatrix en -codes, maandbord, beschikbaarheid,
 * dienstnotities, en het toewijzen van een open dienst.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import express from "express";
import { sendPushToUsers } from "../push.js";
import type { AuthenticatedRequest } from "../types.js";
import { isStafRol, authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { berekenCelWaarheid } from "./celWaarheid.js";
import { heropbouwPlanning, reapplyApprovedSwaps } from "./planningHeropbouw.js";
import { berekenVerwachtingsCheck } from "../coverageRoutes.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { addDagenIso, brusselsDay, DAG_DMJ, PERIODE_DMJ, toLookupToken, sortedNameToken, matrixCodesForDate, isTakeoverCode, bouwMaandoverzichtAoa, berekenMaandoverzicht, vindOngeregistreerdeZiekte, normalizeSwapType } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { bouwMatrixXlsx, parsePlanningMatrixXlsxMetWaarschuwingen } from "./matrixXlsx.js";
import { buildPlanningFromMatrix, getPlanningMatrixGrenzen, getLeaveData, getPlanningCodesData, getPlanningData, getPlanningHorizon, getPlanningMatrixHistory, getPlanningMatrixRows, getServicesData, getSwapsData, getUsersData, logActivity, replacePlanningAndMatrix, savePlanningCodesData, savePlanningData, clearPlanningData, getShiftsOnDate, getServiceSegments, saveMatrixRowAssignments, insertPlanningRows, savePlanningMatrixHistoryEntry, summarizePlanningCodeChanges, diffPlanningCodeChanges, summarizeTokens, getPlanningNotes, upsertPlanningNote, deletePlanningNote, storeImportSnapshot, getImportSnapshot, restorePlanningAndMatrixSnapshot } from "../storage.js";
import { type BeslisActor, COLLECTION_REVISION_HEADER, ISO_DAY_RE, actorReq, detectMassDelete, massDeleteResponse, revisionCheck, revisionOf, revisionProbleemResponse, viewUrl } from "./collectie.js";
import { ruilAfwezigheidsFout } from "./ruilRegels.js";

// Helper: decode de geüploade Excel-buffer en parse de praktijk-tab.
const parseMatrixInput = async (body: any) => {
  const xlsxBase64 = typeof body?.xlsxBase64 === "string" ? body.xlsxBase64 : "";
  if (!xlsxBase64) {
    throw new Error("Geen Excel-bestand meegegeven (verwacht xlsxBase64 in body).");
  }
  const cleaned = xlsxBase64.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(cleaned, "base64");
  if (buffer.length === 0) {
    throw new Error("Excel-bestand is leeg.");
  }
  // Harde limiet vóór het parsen: een .xlsx is een zip en kan bij het
  // uitpakken exploderen (zip-bomb → geheugen-DoS van de functie). Een echte
  // praktijk-tab is enkele honderden kB; 5 MB is ruim.
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Excel-bestand is te groot (max 5 MB). Exporteer enkel de praktijk-tab.");
  }
  return parsePlanningMatrixXlsxMetWaarschuwingen(buffer);
};

// Parse + optionele periode-selectie, gedeeld door import en preview. De
// planner maakt de Excel vaak maanden vooruit, maar alleen het vaststaande
// deel mag het portaal in: rijen buiten [van, tot] worden genegeerd alsof ze
// niet in het bestand stonden. Het te vervangen bereik volgt daardoor vanzelf
// de overgebleven rijen (de RPC leidt het af uit min/max source_date).
const parseMatrixInputMetPeriode = async (body: any) => {
  const { rows, waarschuwingen } = await parseMatrixInput(body);
  const bestandDates = rows.map((row) => row.source_date).filter(Boolean);
  const fileStartDate = bestandDates[0] || null;
  const fileEndDate = bestandDates[bestandDates.length - 1] || null;
  const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
  const periode = body?.periode;
  let van: string | null = null;
  let tot: string | null = null;
  if (periode && typeof periode === "object") {
    van = typeof periode.van === "string" && ISO_DATUM.test(periode.van) ? periode.van : null;
    tot = typeof periode.tot === "string" && ISO_DATUM.test(periode.tot) ? periode.tot : null;
    if ((periode.van && !van) || (periode.tot && !tot)) {
      throw new Error("Ongeldige periode: gebruik datums in het formaat YYYY-MM-DD.");
    }
    if (van && tot && van > tot) {
      throw new Error("Ongeldige periode: de begindatum ligt na de einddatum.");
    }
  }
  const selectie = rows.filter((row) =>
    (!van || row.source_date >= van) && (!tot || row.source_date <= tot));
  if (selectie.length === 0) {
    throw new Error(`Geen dagen binnen de gekozen periode, het bestand loopt van ${fileStartDate ? DAG_DMJ(fileStartDate) : "?"} t/m ${fileEndDate ? DAG_DMJ(fileEndDate) : "?"}.`);
  }
  return { rows: selectie, fileStartDate, fileEndDate, parserWaarschuwingen: waarschuwingen };
};

/** Tot wanneer de planning in het portaal loopt (ISO-dag) — zie GET /api/planning. */
const PLANNING_TOT_HEADER = "x-planning-tot";

// reapplyApprovedSwaps (de heropbouw-replay van goedgekeurde ruilen) staat in
// api/_lib/planningHeropbouw.ts, naast de heropbouw-kern die hem ook gebruikt.

/** Verlof-conflicten in een set planning-rijen: de chauffeur staat ingepland
 *  op een dag waarop hij goedgekeurd verlof heeft. */
type VerlofConflict = {
  driverId: string; driverName: string; date: string; serviceNumber: string;
  leaveStart: string; leaveEnd: string;
};

const verlofConflictKey = (c: VerlofConflict) => `${c.driverId}|${c.date}`;

const verlofConflictsIn = (
  shifts: Array<{ driverId: string; date: string; line: string }>,
  approvedLeave: Array<{ userId: string; startDate: string; endDate: string }>,
  naamVan: (id: string) => string,
): VerlofConflict[] => {
  const uit: VerlofConflict[] = [];
  // Dedupe per (chauffeur, dag, dienst): een gesplitste dienst is meerdere
  // planning-rijen en telde als 2-3 "conflicten" voor wat één dienst is —
  // zelfde segmenten-zijn-geen-diensten-les als #389 (gevonden door de
  // golden import-keten-test, 01-09).
  const gezien = new Set<string>();
  for (const shift of shifts) {
    const sleutel = `${shift.driverId}|${shift.date}|${toLookupToken(shift.line)}`;
    if (gezien.has(sleutel)) continue;
    const overlap = approvedLeave.find((l) =>
      String(l.userId) === String(shift.driverId) &&
      l.startDate <= shift.date &&
      l.endDate >= shift.date,
    );
    if (overlap) {
      gezien.add(sleutel);
      uit.push({
        driverId: shift.driverId,
        driverName: naamVan(shift.driverId),
        date: shift.date,
        serviceNumber: shift.line,
        leaveStart: overlap.startDate,
        leaveEnd: overlap.endDate,
      });
    }
  }
  return uit;
};

// --- Onbemande dienst toewijzen (vanuit Dekking) ----------------------------
//
// Een gat in de dekking = een verwachte dienst die op die dag op níémand
// staat. De dienstwissel kan daar niets mee (die verplaatst een bestaande
// rij); tot nu kon zo'n gat alleen via een nieuwe Excel-upload gevuld worden.
// Deze route schrijft de toewijzing in de planning-matrix (de bron waaruit
// elke heropbouw genereert — zo overleeft ze "opnieuw opbouwen") én zet de
// dienstblokken direct in de planning. Een nieuwe Excel-import vervangt de
// matrix en dus ook deze toewijzing: bewust, de Excel is dan de waarheid en
// het gat verschijnt gewoon weer in de dekking.
/** Onbemande dienst toewijzen (matrix + planning + log + push) — gedeeld
 *  door POST /api/planning/assign-service en de Telegram-toewijzen-knop.
 *  Gedrag identiek aan de oude route-body. */
export async function wijsDienstToeIntern(invoer: { date: unknown; serviceNumber: unknown; driverId: unknown }, actor: BeslisActor): Promise<
  { fout: { status: number; error: string } } | { rows: number; serviceNumber: string; driverName: string; date: string }
> {
    const date = String(invoer.date ?? "").trim();
    const serviceNumber = String(invoer.serviceNumber ?? "").trim();
    const driverId = String(invoer.driverId ?? "").trim();
    if (!ISO_DAY_RE.test(date)) return { fout: { status: 400, error: "Ongeldige datum (JJJJ-MM-DD verwacht)." } };
    if (!serviceNumber || !driverId) return { fout: { status: 400, error: "Kies de dienst én de chauffeur." } };

    const [users, services, matrixRows, dayRows] = await Promise.all([
      getUsersData(),
      getServicesData(),
      getPlanningMatrixRows(),
      getShiftsOnDate(date),
    ]);
    const driver = users.find((u) => String(u.id) === driverId);
    if (!driver || driver.isActive === false) return { fout: { status: 400, error: "De gekozen chauffeur bestaat niet (meer) of is inactief." } };

    const dienstToken = toLookupToken(serviceNumber);
    const service = (services as any[]).find((s) => toLookupToken(s.serviceNumber) === dienstToken);
    if (!service) return { fout: { status: 400, error: `Dienst ${serviceNumber} staat niet in het dienstoverzicht.` } };
    const segments = getServiceSegments(service);
    if (segments.length === 0) return { fout: { status: 400, error: `Dienst ${service.serviceNumber} heeft geen tijdsblokken in het dienstoverzicht, vul die eerst aan.` } };

    // De dienst moet écht onbemand zijn (tussen openen en klikken kan een
    // collega hem al ingevuld hebben) en de chauffeur mag die dag niets rijden.
    const alBemand = dayRows.find((r) => toLookupToken(r.line) === dienstToken);
    if (alBemand) {
      const naam = users.find((u) => String(u.id) === String(alBemand.driverId))?.name ?? "iemand";
      return { fout: { status: 409, error: `Dienst ${service.serviceNumber} is op ${date} intussen al ingevuld door ${naam}, vernieuw de pagina.` } };
    }
    const heeftAl = dayRows.find((r) => String(r.driverId) === driverId);
    if (heeftAl) return { fout: { status: 409, error: `${driver.name} rijdt op ${date} al dienst ${heeftAl.line}, dubbele inplanning kan niet.` } };
    const afwFout = await ruilAfwezigheidsFout({ requesterId: "", targetDriverId: driverId, swapType: "overname", shiftDate: date });
    if (afwFout) return { fout: { status: 409, error: afwFout } };

    // Matrix-rij van die dag: sleutel is de chauffeursnáám zoals de Excel die
    // schrijft — hergebruik een bestaande naamvariant van deze chauffeur als
    // die er is (accenten/volgorde), anders de naam uit gebruikersbeheer.
    const matrixRow = (matrixRows as any[]).find((r) => String(r.source_date) === date);
    if (!matrixRow) return { fout: { status: 409, error: `Er is geen geïmporteerde planning voor ${date}, importeer eerst de Excel.` } };
    const assignments: Record<string, string> = { ...(matrixRow.assignments ?? {}) };
    const eigenToken = toLookupToken(driver.name);
    const eigenSorted = sortedNameToken(driver.name);
    const bestaandeKey = Object.keys(assignments).find((k) => toLookupToken(k) === eigenToken || sortedNameToken(k) === eigenSorted);
    const huidigeCode = bestaandeKey ? String(assignments[bestaandeKey] ?? "").trim() : "";
    // Alleen een lege cel of een overneembare code (vrij/bv/tk/ta) mag
    // overschreven worden — zelfde regel als de overname bij dienstruil.
    if (huidigeCode && !isTakeoverCode(huidigeCode)) {
      return { fout: { status: 409, error: `${driver.name} staat op ${date} al op '${huidigeCode}' in de planning, die cel kan niet stil overschreven worden.` } };
    }
    assignments[bestaandeKey ?? driver.name] = String(service.serviceNumber);

    const nieuweRijen = segments.map((segment: any) => ({
      id: `${date}-${driver.id}-${service.serviceNumber}-${segment.segment}`,
      date,
      startTime: segment.startTime,
      endTime: segment.endTime,
      line: String(service.serviceNumber),
      busNumber: "",
      loopnr: segment.loopnr ?? "",
      driverId: String(driver.id),
    }));
    // Eerst de matrix (de bron), dan de planning-rijen. Faalt de tweede stap,
    // dan zet de eerstvolgende heropbouw de planning alsnog goed vanuit de
    // matrix — nooit andersom een rij zonder bron.
    await saveMatrixRowAssignments(String(matrixRow.id), assignments);
    await insertPlanningRows(nieuweRijen as any);

    await logActivity(
      actorReq(actor),
      "planning",
      "Dienst toegewezen",
      `Dienst ${service.serviceNumber} op ${DAG_DMJ(date)} toegewezen aan ${driver.name} (was onbemand). ${nieuweRijen.length} rij(en) toegevoegd; matrix bijgewerkt.`,
    );
    await sendPushToUsers([driverId], {
      title: "Dienst toegewezen",
      soort: "planning",
      body: `Je rijdt dienst ${service.serviceNumber} op ${DAG_DMJ(date)}. Bekijk je rooster.`,
      url: viewUrl("rooster"),
    });
    return { rows: nieuweRijen.length, serviceNumber: String(service.serviceNumber), driverName: driver.name, date };
}

export function mountPlanningRoutes(app: express.Express) {
  app.get("/api/planning", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      // Optionele filters: ?driverId=X of ?month=YYYY-MM laten de client
      // gericht ophalen i.p.v. de hele tabel — drastisch minder data over
      // het draad voor mobile en maandprint.
      const gevraagdeDriverId = typeof req.query.driverId === "string" && req.query.driverId.trim()
        ? req.query.driverId.trim()
        : undefined;
      // Een chauffeur mag alleen zijn eigen diensten via deze route lezen —
      // zonder deze scope kon hij met een kale fetch de volledige planning
      // (busnr, loopnr, segmenttijden) van álle collega's ophalen. Het open
      // maandbord (/api/month-planning) toont toewijzingen bewust wél breed,
      // maar deze detail-route hoort per-chauffeur begrensd (zoals /api/leave,
      // /api/swaps en /api/planning-notes dat al zijn).
      const driverId = isStafRol(req.appUser!.role) ? gevraagdeDriverId : String(req.appUser!.id);
      const monthIso = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : undefined;
      // Horizon meteen mee: een chauffeur krijgt alleen zijn eigen rijen en kan
      // daar niet uit afleiden tot wanneer de planning loopt ("nog niets in
      // december" of "nog niet geïmporteerd" zien er voor hem hetzelfde uit).
      // Als header op deze fetch, zodat het geen extra rondje kost. Mislukt de
      // horizonquery, dan gaat de planning gewoon door zonder de regel.
      const [data, horizon] = await Promise.all([
        getPlanningData({ driverId, monthIso }),
        getPlanningHorizon().catch(() => null),
      ]);
      // Revisie alleen over de volledige collectie (ongefilterd) — een revisie
      // over een subset zou bij het opslaan altijd een vals conflict geven.
      if (!driverId && !monthIso) {
        res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
      }
      if (horizon) res.setHeader(PLANNING_TOT_HEADER, horizon);
      res.json(data);
    } catch (err) {
      console.error("Error reading planning data:", err);
      res.status(500).json({ error: "Gegevens laden is mislukt." });
    }
  });

  app.post("/api/planning", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        if (newData.length === 0) {
          // Volledige wipe is een bewuste, zware actie ('Planning wissen'):
          // alleen admin, en expliciet — nooit als bijwerking van een lege save.
          if (req.appUser?.role !== "admin") {
            return res.status(403).json({ error: "Alleen een admin kan de volledige planning wissen." });
          }
          await clearPlanningData();
          await logActivity(req, "planning", "Planning gewist", "De volledige actieve planning is gewist.");
          return res.json({ success: true, count: 0 });
        }
        // Optimistic-concurrency + wipe-detectie: een stale volledige-array-save
        // (bv. planner B saved terwijl A net een maand importeerde) verwijderde
        // anders stilletjes alles wat B nog niet gezien had.
        const previousPlanning = await getPlanningData();
        { const rp = revisionCheck(req, previousPlanning); if (rp) return revisionProbleemResponse(res, "De planning", rp); }
        const shiftsRemoved = detectMassDelete(previousPlanning, newData);
        if (shiftsRemoved !== null) return massDeleteResponse(res, shiftsRemoved, previousPlanning.length, "diensten");
        await savePlanningData(newData);
        await logActivity(
          req,
          "planning",
          "Planning opgeslagen",
          `${newData.length} planningregels handmatig opgeslagen. Voorbeeld: ${summarizeTokens(newData.map((shift: any) => `dienst ${shift.line || shift.id}`))}.`,
        );
        res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getPlanningData()));
        res.json({ success: true, count: newData.length });
      } else {
        res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      }
    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error("Error saving planning data:", errorMessage);
      console.error("Opslaan is mislukt.", errorMessage);
      res.status(500).json({ error: "Opslaan is mislukt." });
    }
  });

  // Beschikbaarheid per dag — voor het bezettingsoverzicht + dienstruil-
  // matching. Geeft minimale data terug (per dag: wie rijdt / op verlof /
  // vrij) zodat ook chauffeurs (die normaal enkel hun eigen shifts zien)
  // kunnen zien wie er vrij is om mee te ruilen. Geen shift-details, enkel
  // driver-ids + namen. Toegankelijk voor alle ingelogde gebruikers.
  app.get("/api/availability", authenticate, async (req, res) => {
    try {
      const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : undefined;
      const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : undefined;
      if (!from || !to || from > to) {
        return res.status(400).json({ error: "Geef geldige from/to-datums (YYYY-MM-DD), met from <= to." });
      }
      // Expliciete fout i.p.v. stilletjes afkappen: een afgekapt antwoord
      // leek compleet en gaf foute bezettingsbeelden.
      const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
      if (spanDays > 120) {
        return res.status(400).json({ error: "Bereik te groot: maximaal 120 dagen per aanvraag." });
      }

      // Datums in [from, to] enumereren (guard van 120 dagen tegen runaway).
      const dates: string[] = [];
      {
        const cursor = new Date(`${from}T00:00:00Z`);
        const end = new Date(`${to}T00:00:00Z`);
        let guard = 0;
        while (cursor <= end && guard < 120) {
          dates.push(cursor.toISOString().slice(0, 10));
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          guard++;
        }
      }
      if (dates.length === 0) return res.json({ from, to, drivers: [], days: [] });

      const wantTakeover = req.query.takeover === "1" || req.query.takeover === "true";

      const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
      // De matrix wordt altijd geladen (één rij per dag, dus klein): zonder
      // matrixcodes stond wie in de Excel op ZIEK/OPL/... zonder
      // portaalregistratie als "vrij" in het bezettingsoverzicht (15-09).
      const [users, leave, matrixRows] = await Promise.all([
        getUsersData(),
        getLeaveData(),
        getPlanningMatrixRows(),
      ]);
      const shiftChunks = await Promise.all(months.map((m) => getPlanningData({ monthIso: m })));
      const shifts = shiftChunks.flat().filter((s: any) => s.date >= from && s.date <= to);

      const chauffeurs = users
        .filter((u: any) => u.isActive !== false && u.role === "chauffeur" && String(u.name).toLowerCase() !== "beheerder")
        .map((u: any) => ({ id: String(u.id), name: u.name as string }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const chauffeurIds = new Set(chauffeurs.map((c) => c.id));
      const approvedLeave = leave.filter((l: any) => l.status === "approved");

      const days = dates.map((date) => {
        const working = new Set<string>();
        // Per werkende chauffeur het dienst-/lijnnummer (voor het maandrooster).
        // Meerdere diensten op één dag → samengevoegd met '/'.
        const lines: Record<string, string> = {};
        for (const s of shifts) {
          if (s.date === date && chauffeurIds.has(String(s.driverId))) {
            const id = String(s.driverId);
            working.add(id);
            const line = String(s.line ?? "").trim() || "•";
            // Gesplitste dienst = meerdere planning-rijen met hetzelfde nummer:
            // dedupliceren, anders wordt het "4101/4101" (en zo als returnCode
            // op een dienstruil opgeslagen).
            const seen = lines[id] ? lines[id].split("/") : [];
            if (!seen.includes(line)) lines[id] = [...seen, line].join("/");
          }
        }
        const onLeave = new Set<string>();
        for (const l of approvedLeave) {
          if (String(l.startDate) <= date && date <= String(l.endDate) && chauffeurIds.has(String(l.userId))) {
            onLeave.add(String(l.userId));
          }
        }
        // Een matrixcode die geen overname-code is (ziek, opl, kv, gar, ...)
        // maakt iemand die dag niet vrij, ook zonder planning-rij of
        // portaalverlof; zelfde regel als de takeover-kaart en POST /api/swaps.
        const nietBeschikbaar = new Set<string>();
        for (const [driverId, code] of matrixCodesForDate(matrixRows, chauffeurs, date)) {
          if (chauffeurIds.has(driverId) && !isTakeoverCode(code)) nietBeschikbaar.add(driverId);
        }
        const free = chauffeurs.filter((c) => !working.has(c.id) && !onLeave.has(c.id) && !nietBeschikbaar.has(c.id)).map((c) => c.id);
        const day: Record<string, unknown> = { date, working: Array.from(working), leave: Array.from(onLeave), free, lines };
        if (wantTakeover) {
          // Wie mag die dag een dienst overnemen zónder tegenprestatie: staat
          // in de planning op vrij/bv/tk/ta én rijdt zelf geen dienst. Waarde =
          // de code, zodat de UI kan tonen wáárom ('bv' leest anders dan 'vrij').
          // Dezelfde regel als de server-validatie in POST /api/swaps.
          const takeover: Record<string, string> = {};
          for (const [driverId, code] of matrixCodesForDate(matrixRows, chauffeurs, date)) {
            if (!chauffeurIds.has(driverId) || working.has(driverId)) continue;
            if (isTakeoverCode(code)) takeover[driverId] = code.toLowerCase();
          }
          day.takeover = takeover;
        }
        return day;
      });

      res.json({ from, to, drivers: chauffeurs, days });
    } catch (err: any) {
      console.error("Error computing availability:", err);
      res.status(500).json({ error: "Kon beschikbaarheid niet berekenen." });
    }
  });

  // Read-only maandplanning voor iedereen — de geïmporteerde planning-matrix
  // (chauffeur × datum met codes) zoals die in het chauffeurslokaal hangt.
  // Server resolved per cel het type (dienst/verlof/afwezig/opleiding) via
  // services + planningcodes, en geeft een compacte, render-klare payload.
  app.get("/api/month-planning", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
      if (!month) return res.status(400).json({ error: "Geef een geldige maand (YYYY-MM)." });

      const [rows, users, services, codes, leave, swaps, grenzen] = await Promise.all([
        // Alleen de matrixrijen van deze maand: berekenCelWaarheid gooit de rest
        // toch weg (monthRows), maar ze reisden wel eerst mee uit Supabase.
        getPlanningMatrixRows({ month }),
        getUsersData(),
        getServicesData(),
        getPlanningCodesData(),
        // Alleen afwezigheid die deze maand nog raakt — de volledige historiek
        // groeit onbegrensd en is hier nooit nodig.
        getLeaveData({ endOnOrAfter: `${month}-01` }),
        getSwapsData(),
        // Grenzen van de geïmporteerde planning, zodat het bord niet verder
        // bladert dan er data is (Jarno 18-09).
        getPlanningMatrixGrenzen(),
      ]);

      // De cel-waarheid (matrix + goedgekeurde ruilen + afwezigheden) is sinds
      // fase B van de Access-migratie een pure functie in api/_lib/celWaarheid.ts,
      // gedeeld met de dagafsluiting. Gedrag ongewijzigd (karakterisatietest).
      //
      // BEWUSTE KEUZE (Jarno, 01-08-2026): afwezigheidscodes — ziekte incluis —
      // blijven voor iedereen zichtbaar, gelijk aan de fysieke planning in het
      // chauffeurslokaal. Er is kort een maskering voor chauffeurs actief geweest
      // (zie #290); die is er op verzoek weer uit gehaald omdat het digitale
      // scherm niet strenger hoeft te zijn dan het bord waar iedereen langsloopt.
      // Ziekte is wél een bijzondere categorie persoonsgegevens (AVG art. 9), dus
      // dit is een openstaande keuze en geen afgesloten dossier — Jarno bekijkt
      // het later opnieuw. Voer het tot die tijd NIET opnieuw op als bevinding.
      // De maskering terugzetten is klein werk: commit f2a9b33 (helpers:
      // HEALTH_CODES / isHealthCode, plus één ternary op de cel).
      const { monthRows, dates, chauffeurs, cells } = berekenCelWaarheid(month, {
        rows: rows as any[], users: users as any[], services: services as any[], codes: codes as any[], leave: leave as any[], swaps: swaps as any[],
      });

      // Excel-terugexport (planner/admin): de ACTUELE cel-waarheid — wissels,
      // toewijzingen en afwezigheids-overlay verwerkt — in het praktijk-tab-
      // formaat, direct her-importeerbaar. Zo start de volgende Excel-bewerking
      // op de werkelijke stand i.p.v. de verouderde upload.
      // Maandoverzicht als data voor het Overzicht-venster in de maandplanning
      // — exact dezelfde telling als het xlsx-tabblad (gedeelde berekening),
      // zodat scherm en export nooit kunnen verschillen. Staf-only: tellingen
      // per collega zijn planner-informatie.
      if (String(req.query.format ?? "") === "summary") {
        if (!isStafRol(req.appUser!.role)) {
          return res.status(403).json({ error: "Onvoldoende rechten." });
        }
        const overzicht = berekenMaandoverzicht(dates, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, services as any[], codes as any[]);
        return res.json({ month, dagen: dates.length, ...overzicht });
      }

      if (String(req.query.format ?? "") === "xlsx") {
        if (!isStafRol(req.appUser!.role)) {
          return res.status(403).json({ error: "Onvoldoende rechten." });
        }
        const dayTypeByDate = new Map<string, string>(monthRows.map((r: any) => [String(r.source_date), String(r.day_type ?? "")]));
        // Tweede tabblad "maandoverzicht": per-chauffeur maandtelling (diensten,
        // uren, ziekte, verlof, vrij) op dezelfde cel-waarheid — opstap naar de
        // loonadministratie zonder aparte export.
        const overzicht = bouwMaandoverzichtAoa(month, dates, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, services as any[], codes as any[]);
        const buffer = await bouwMatrixXlsx(dates, dayTypeByDate, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, overzicht);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="planning-${month}.xlsx"`);
        return res.send(buffer);
      }

      res.json({
        month,
        dates,
        drivers: chauffeurs.map((c) => ({ id: c.id, name: c.name, section: c.section || null })),
        cells,
        geimporteerd: grenzen,
      });
    } catch (err: any) {
      console.error("Error computing month planning:", err);
      res.status(500).json({ error: "Kon maandplanning niet berekenen." });
    }
  });

  app.get("/api/planning-notes", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) {
        return res.status(400).json({ error: "from/to (JJJJ-MM-DD) vereist." });
      }
      // Chauffeurs zien alleen hun eigen notities; planner/admin alles.
      const driverId = isStafRol(req.appUser!.role) ? undefined : String(req.appUser!.id);
      const notes = await getPlanningNotes({ fromIso: from, toIso: to, driverId });
      res.json(notes);
    } catch (err) {
      if (isMissingTableError(err)) return res.json([]); // migratie nog niet gedraaid
      console.error("Notities laden is mislukt.", err);
      res.status(500).json({ error: "Notities laden is mislukt." });
    }
  });

  app.put("/api/planning-notes", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const driverId = String(req.body?.driverId ?? "").trim();
      const date = String(req.body?.date ?? "").trim();
      const note = String(req.body?.note ?? "").trim().slice(0, 280);
      if (!driverId || !ISO_DAY_RE.test(date)) {
        return res.status(400).json({ error: "driverId en date (JJJJ-MM-DD) vereist." });
      }
      const users = await getUsersData();
      const driver = users.find((u) => String(u.id) === driverId);
      if (!driver) return res.status(400).json({ error: "Onbekende chauffeur." });

      if (!note) {
        await deletePlanningNote(driverId, date);
        await logActivity(req, "planning", "Dienstnotitie verwijderd", `${driver.name}, ${DAG_DMJ(date)}.`);
        return res.json({ success: true, removed: true });
      }
      await upsertPlanningNote(driverId, date, note, req.appUser?.name ?? null);
      await logActivity(req, "planning", "Dienstnotitie geplaatst", `${driver.name}, ${DAG_DMJ(date)}: ${note.slice(0, 80)}`);
      // De chauffeur meteen op de hoogte — push is best-effort.
      await sendPushToUsers([driverId], {
        title: "Notitie bij je dienst",
        soort: "planning",
        body: `${date.split("-").reverse().join("/")}: ${note.slice(0, 120)}`,
        url: viewUrl("rooster"),
      });
      res.json({ success: true });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.status(503).json({ error: "De notities-tabel bestaat nog niet: draai supabase/2026-07-30_planning_notes.sql in de SQL Editor." });
      }
      console.error("Notitie opslaan is mislukt.", err);
      res.status(500).json({ error: "Notitie opslaan is mislukt." });
    }
  });

  app.get("/api/planning-matrix", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const rows = await getPlanningMatrixRows();
      res.json(rows);
    } catch (err: any) {
      console.error("Planning-overzicht laden is mislukt.", err);
      res.status(500).json({ error: "Planning-overzicht laden is mislukt." });
    }
  });

  app.get("/api/planning-matrix/history", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const history = await getPlanningMatrixHistory();
      res.json(history);
    } catch (err: any) {
      console.error("Import-geschiedenis laden is mislukt.", err);
      res.status(500).json({ error: "Import-geschiedenis laden is mislukt." });
    }
  });

  app.post("/api/planning-matrix/import", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      let rows, fileStartDate, fileEndDate, parserWaarschuwingen;
      try {
        ({ rows, fileStartDate, fileEndDate, parserWaarschuwingen } = await parseMatrixInputMetPeriode(req.body));
      } catch (parseErr: any) {
        return res.status(400).json({ error: parseErr.message });
      }
      const importedDates = rows.map((row) => row.source_date).filter(Boolean);
      const startDate = importedDates[0] || null;
      const endDate = importedDates[importedDates.length - 1] || null;

      // Bouw eerst, schrijf pas weg na strict-mode validatie. Als er onbekende
      // codes of niet-gematchte chauffeurs zijn, weiger de import zodat de
      // planner eerst de oorzaak kan rechtzetten.
      const generatedPlanning = await buildPlanningFromMatrix(rows);

      const [leaveForCheck, usersForCheck] = await Promise.all([getLeaveData(), getUsersData()]);
      const userNameForConflict = (id: string) => usersForCheck.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
      const approvedLeaveForCheck = leaveForCheck.filter((l) => l.status === "approved");
      // Alleen GEPLAND verlof blokkeert een import: betaald verlof en klein
      // verlet hoorde de planner in de Excel verwerkt te hebben. Ziekte is
      // onvoorzien — de Excel wordt vooraf gemaakt, dus een zieke die er nog in
      // staat is normaal; daarvoor bestaat de herverdeel-flow. De import
      // blokkeerde hierop en noemde het nog "verlof" ook (melding Jarno 15-08).
      const blokkerendVerlof = approvedLeaveForCheck.filter((l) => l.type !== "ziekte");
      const ziekteLeaveForCheck = approvedLeaveForCheck.filter((l) => l.type === "ziekte");

      // Conflicten VÓÓR de replay = conflicten die in de Excel zelf zitten. Die
      // kan de planner daar oplossen.
      const matrixConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userNameForConflict);

      // Goedgekeurde ruilen opnieuw toepassen — de matrix kent ze niet.
      const reapplied = await reapplyApprovedSwaps(generatedPlanning.shifts, { van: startDate, tot: endDate });

      // Alles ná de replay; het verschil komt dus uit een doorgevoerde ruil.
      // Dat onderscheid is belangrijk: zo'n conflict staat NIET in de Excel — de
      // planner zocht zich suf naar een rij die daar niet bestaat, en de import
      // bleef geblokkeerd tot hij toevallig de ruil of het verlof vond.
      const alleConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userNameForConflict);
      const matrixKeys = new Set(matrixConflicts.map(verlofConflictKey));
      const replayConflicts = alleConflicts.filter((c) => !matrixKeys.has(verlofConflictKey(c)));
      const verlofConflictsForImport = alleConflicts;
      // Informatief, niet blokkerend: diensten die op een ziek gemelde chauffeur
      // staan. Na de import vangt de herverdeel-flow ze op (maandplanning,
      // dashboard, dekking).
      const ziekteDiensten = verlofConflictsIn(generatedPlanning.shifts, ziekteLeaveForCheck, userNameForConflict);

      if (
        generatedPlanning.summary.unknownCodes.length > 0 ||
        generatedPlanning.summary.unmatchedDrivers.length > 0 ||
        verlofConflictsForImport.length > 0
      ) {
        const delen: string[] = [];
        if (generatedPlanning.summary.unknownCodes.length > 0 || generatedPlanning.summary.unmatchedDrivers.length > 0) {
          delen.push("onbekende codes of niet-gematchte chauffeurs");
        }
        if (matrixConflicts.length > 0) delen.push(`${matrixConflicts.length} verlof-conflict(en) in de Excel`);
        if (replayConflicts.length > 0) {
          delen.push(
            `${replayConflicts.length} verlof-conflict(en) die uit een doorgevoerde dienstruil komen, die staan NIET in je Excel. `
            + "Los ze op door de betreffende ruil te annuleren of het verlof in te trekken",
          );
        }
        return res.status(400).json({
          error: `Import geblokkeerd: ${delen.join("; ")}.`,
          unknownCodes: generatedPlanning.summary.unknownCodes,
          unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
          verlofConflicts: verlofConflictsForImport,
          matrixVerlofConflicts: matrixConflicts,
          ruilVerlofConflicts: replayConflicts,
          ziekteDiensten,
          blocked: true,
        });
      }

      // Herstelpunt: de volledige stand van vóór deze import naar de
      // backups-bucket. Best-effort — een falend herstelpunt mag de import
      // niet tegenhouden, maar zonder pad verschijnt er ook geen
      // terugzet-knop bij deze import in de historiek.
      let snapshotPath: string | null = null;
      try {
        const [matrixVoor, planningVoor] = await Promise.all([getPlanningMatrixRows(), getPlanningData()]);
        snapshotPath = await storeImportSnapshot({
          createdAt: new Date().toISOString(),
          matrixRows: matrixVoor,
          planning: planningVoor as any[],
        });
      } catch (snapErr) {
        console.error("Herstelpunt maken mislukt (import gaat door):", snapErr);
      }

      // Atomair: matrix + planning in één transactie (geen skew als één van
      // beide zou falen). Valt server-side terug op het oude pad zolang de
      // RPC-migratie nog niet gedraaid is.
      await replacePlanningAndMatrix(rows, generatedPlanning.shifts);
      const bestandsnaam = typeof req.body?.filename === "string" ? req.body.filename.trim().slice(0, 200) : "";
      const historiekOk = await savePlanningMatrixHistoryEntry({
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        importedDays: rows.length,
        detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
        generatedShifts: generatedPlanning.summary.generatedShifts,
        matchedServices: generatedPlanning.summary.matchedServices,
        skippedAbsences: generatedPlanning.summary.skippedAbsences,
        unknownCodes: generatedPlanning.summary.unknownCodes,
        unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
        filename: bestandsnaam || null,
        importedBy: req.appUser?.name ?? null,
        periodStart: startDate,
        periodEnd: endDate,
        fileStart: fileStartDate,
        fileEnd: fileEndDate,
        snapshotPath,
      });
      // Historiek niet weggeschreven (bv. migratie 2026-08-20 niet gedraaid):
      // de import zelf is geslaagd, maar er is geen terugzet-knop voor deze
      // import. Dat hoort de planner te zien, niet alleen de Vercel-logs
      // (controle-ronde 27-08, bevinding 25).
      if (!historiekOk) {
        const melding = "Herstelpunt niet vastgelegd: de import-historiek kon niet worden opgeslagen. Terugzetten via 'Zet terug' is voor deze import niet mogelijk, meld dit aan de beheerder (schema-check in Systeemstatus).";
        parserWaarschuwingen = [...(parserWaarschuwingen ?? []), melding];
        await logActivity(req, "planning", "Herstelpunt niet vastgelegd", melding);
      }
      await logActivity(
        req,
        "planning",
        "Matrix import bevestigd",
        `${rows.length} dagen verwerkt (periode ${rows.length ? PERIODE_DMJ(String(rows[0].source_date), String(rows[rows.length - 1].source_date)) : "?"} vervangen; planning daarbuiten onaangetast${fileStartDate !== startDate || fileEndDate !== endDate ? `; selectie uit bestand ${PERIODE_DMJ(fileStartDate, fileEndDate)}` : ""}), ${generatedPlanning.summary.generatedShifts} diensten opgebouwd, ${reapplied.applied} goedgekeurde ruil(en) opnieuw doorgevoerd${reapplied.alVerwerkt > 0 ? `, ${reapplied.alVerwerkt} al in de Excel verwerkt` : ""}${reapplied.skipped > 0 ? ` (${reapplied.skipped} niet toepasbaar)` : ""}. Onbekende codes: ${summarizeTokens(generatedPlanning.summary.unknownCodes)}. Niet-gematchte chauffeurs: ${summarizeTokens(generatedPlanning.summary.unmatchedDrivers)}.`,
      );

      // Chauffeurs met diensten in deze import krijgen een seintje.
      const affectedDriverIds = [...new Set(generatedPlanning.shifts.map((s: any) => String(s.driverId)))];
      await sendPushToUsers(affectedDriverIds, {
        title: "Planning bijgewerkt",
        soort: "planning",
        body: `Nieuwe planning geïmporteerd (${rows[0]?.source_date ? DAG_DMJ(String(rows[0].source_date)) : "?"} t/m ${rows[rows.length - 1]?.source_date ? DAG_DMJ(String(rows[rows.length - 1].source_date)) : "?"}). Bekijk je rooster.`,
        url: viewUrl("rooster"),
      });

      res.json({
        success: true,
        importedDays: rows.length,
        detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
        generatedShifts: generatedPlanning.summary.generatedShifts,
        matchedServices: generatedPlanning.summary.matchedServices,
        skippedAbsences: generatedPlanning.summary.skippedAbsences,
        unknownCodes: generatedPlanning.summary.unknownCodes,
        unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
        servicesWithoutSegments: generatedPlanning.summary.servicesWithoutSegments,
        perDriver: generatedPlanning.summary.perDriver,
        ziekteDiensten,
        parserWaarschuwingen,
        startDate,
        endDate,
        fileStartDate,
        fileEndDate,
      });
    } catch (err: any) {
      console.error("Planning importeren is mislukt.", err);
      res.status(500).json({ error: "Planning importeren is mislukt." });
    }
  });

  // Terugzetten naar het herstelpunt van een import: de volledige stand van
  // matrix + planning van vóór díe import komt terug. Bewust admin-only en
  // integraal — dit is een noodrem, geen bewerkingsknop. De
  // planning_version-trigger verwittigt clients vanzelf.
  app.post("/api/planning-matrix/restore", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const historyId = String(req.body?.historyId ?? "").trim();
      if (!historyId) {
        return res.status(400).json({ error: "Geef de import mee waarvan je het herstelpunt wilt terugzetten (historyId)." });
      }
      const history = await getPlanningMatrixHistory();
      const entry = history.find((h) => String(h.id) === historyId);
      if (!entry) {
        return res.status(404).json({ error: "Deze import staat niet (meer) in de historiek." });
      }
      if (!entry.snapshotPath) {
        return res.status(400).json({ error: "Voor deze import bestaat geen herstelpunt, die worden pas sinds eind augustus aangemaakt." });
      }
      const snapshot = await getImportSnapshot(entry.snapshotPath);
      if (!snapshot) {
        return res.status(404).json({ error: "Het herstelpunt is niet meer beschikbaar (alleen de laatste vijf blijven bewaard)." });
      }
      if (snapshot.matrixRows.length === 0) {
        return res.status(400).json({ error: "Dit herstelpunt is leeg (stand van vóór de allereerste import), er valt niets terug te zetten." });
      }
      await restorePlanningAndMatrixSnapshot(snapshot);
      const importMoment = new Date(entry.createdAt).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Brussels" });
      await logActivity(
        req,
        "planning",
        "Planning teruggezet naar herstelpunt",
        `Stand van vóór de import van ${importMoment}${entry.filename ? ` (${entry.filename})` : ""} teruggezet: ${snapshot.matrixRows.length} matrixdagen, ${snapshot.planning.length} roosterregels.`,
      );
      res.json({ success: true, matrixDagen: snapshot.matrixRows.length, roosterregels: snapshot.planning.length });
    } catch (err: any) {
      console.error("Herstelpunt terugzetten mislukt:", err);
      res.status(500).json({ error: "Terugzetten is mislukt, de planning is mogelijk deels teruggezet. Controleer de maandplanning en probeer opnieuw." });
    }
  });

  app.post("/api/planning-matrix/preview", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      let rows, fileStartDate, fileEndDate, parserWaarschuwingen;
      try {
        ({ rows, fileStartDate, fileEndDate, parserWaarschuwingen } = await parseMatrixInputMetPeriode(req.body));
      } catch (parseErr: any) {
        return res.status(400).json({ error: parseErr.message });
      }
      const importedDates = rows.map((row) => row.source_date).filter(Boolean);
      const startDate = importedDates[0] || null;
      const endDate = importedDates[importedDates.length - 1] || null;
      const generatedPlanning = await buildPlanningFromMatrix(rows);

      // Een import vervangt alléén zijn eigen datumbereik. Leg de bestaande
      // matrix ernaast zodat de preview kan tonen wat vervangen wordt, wat
      // blijft staan en of er een gat tussen beide periodes valt.
      const bestaandeMatrix = await getPlanningMatrixRows();
      const bestaandeMatrixDates = bestaandeMatrix
        .map((r) => String(r.source_date))
        .filter(Boolean)
        .sort();
      const existingStart = bestaandeMatrixDates[0] || null;
      const existingEnd = bestaandeMatrixDates[bestaandeMatrixDates.length - 1] || null;
      const replacedExistingDays = startDate && endDate
        ? bestaandeMatrixDates.filter((d) => d >= startDate && d <= endDate).length
        : 0;
      const retainedDays = bestaandeMatrixDates.length - replacedExistingDays;

      const [leave, users] = await Promise.all([getLeaveData(), getUsersData()]);
      const userName = (id: string) => users.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
      const approvedLeave = leave.filter((l) => l.status === "approved");
      // Zelfde splitsing als de echte import: alleen gepland verlof blokkeert;
      // ziekte is informatief (zie /planning-matrix/import).
      const blokkerendVerlof = approvedLeave.filter((l) => l.type !== "ziekte");
      const ziekteLeave = approvedLeave.filter((l) => l.type === "ziekte");

      // Zelfde volgorde als de echte import (zie /planning-matrix/import), zodat
      // het voorbeeld ook echt toont wat de import oplevert — inclusief het
      // onderscheid tussen conflicten uit de Excel en conflicten die pas door een
      // doorgevoerde ruil ontstaan.
      const matrixConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userName);
      const reapplied = await reapplyApprovedSwaps(generatedPlanning.shifts, { van: startDate, tot: endDate });
      const verlofConflicts = verlofConflictsIn(generatedPlanning.shifts, blokkerendVerlof, userName);
      const matrixKeys = new Set(matrixConflicts.map(verlofConflictKey));
      const replayConflicts = verlofConflicts.filter((c) => !matrixKeys.has(verlofConflictKey(c)));
      const ziekteDiensten = verlofConflictsIn(generatedPlanning.shifts, ziekteLeave, userName);

      // perDriver komt uit buildPlanningFromMatrix en is dus van vóór de replay:
      // de chauffeur die een dienst wegruilde stond er nog mét, de ontvanger
      // zonder. Het aantal rijen hertellen op het eindbeeld, zodat de preview
      // niet half pre- en half post-ruil is (verlofConflicts hierboven was dat
      // wél al).
      const rijenPerDriver = new Map<string, number>();
      for (const s of generatedPlanning.shifts) {
        rijenPerDriver.set(String(s.driverId), (rijenPerDriver.get(String(s.driverId)) ?? 0) + 1);
      }
      const perDriverNaRuilen = generatedPlanning.summary.perDriver.map((d: any) => ({
        ...d,
        shiftsGenerated: rijenPerDriver.get(String(d.driverId)) ?? 0,
      }));

      // Chauffeurs vergeleken met de planning vlak vóór deze periode: wie
      // verdween uit de Excel, wie kwam erbij? Zo valt een per ongeluk
      // weggevallen kolom (case Luc Cherlet, 20-08) meteen op — de import zelf
      // blokkeert hier bewust niet op, want een vertrokken of nieuwe collega is
      // ook gewoon zo. Het venster is begrensd (onbegrensd terugkijken liet elke
      // ooit-vertrokken chauffeur eeuwig als "verdwenen" terugkeren); dekt het
      // bestand de hele bewaarde periode, dan vergelijken we met de oude versie
      // van de vervangen periode zelf (controle-ronde 20-08).
      const VERGELIJK_VENSTER_DAGEN = 60;
      const vergelijkGrens = startDate ? addDagenIso(startDate, -VERGELIJK_VENSTER_DAGEN) : null;
      let vergelijkRows = (bestaandeMatrix as any[]).filter((r) => {
        const d = String(r?.source_date ?? "");
        return Boolean(startDate && vergelijkGrens) && d >= vergelijkGrens! && d < startDate!;
      });
      if (vergelijkRows.length === 0 && startDate && endDate) {
        vergelijkRows = (bestaandeMatrix as any[]).filter((r) => {
          const d = String(r?.source_date ?? "");
          return d >= startDate && d <= endDate;
        });
      }
      const namenIn = (rs: any[]) => {
        const m = new Map<string, { naam: string; laatste: string }>();
        for (const r of rs) {
          const date = String(r?.source_date ?? "");
          const assignments = r?.assignments && typeof r.assignments === "object" && !Array.isArray(r.assignments) ? r.assignments : {};
          for (const naam of Object.keys(assignments)) {
            const key = sortedNameToken(String(naam));
            const cur = m.get(key);
            if (!cur || date > cur.laatste) m.set(key, { naam: String(naam), laatste: date });
          }
        }
        return m;
      };
      let chauffeursNieuw: string[] = [];
      let chauffeursVerdwenen: Array<{ naam: string; laatste: string }> = [];
      if (vergelijkRows.length > 0) {
        const oud = namenIn(vergelijkRows);
        const nieuw = namenIn(rows as any[]);
        chauffeursVerdwenen = [...oud.entries()].filter(([k]) => !nieuw.has(k)).map(([, v]) => v).sort((a, b) => a.naam.localeCompare(b.naam));
        chauffeursNieuw = [...nieuw.entries()].filter(([k]) => !oud.has(k)).map(([, v]) => v.naam).sort();
      }

      // "ziek" in de Excel zonder geregistreerde ziekteperiode: het Ziekte-blad,
      // de digest en de advisor kennen die afwezigheid dan niet. Alleen vandaag
      // en later — historiek is geen actiepunt meer.
      const ziekTeRegistreren = vindOngeregistreerdeZiekte(rows as any[], users as any[], leave as any[], brusselsDay(new Date().toISOString()));

      // Verwachtingen-vs-praktijk over dit bestand: een dienstregelingswissel
      // waarvan de dag-type-lijsten nog niet bijgewerkt zijn, valt zo al in de
      // preview op i.p.v. pas als fantoomgaten op de dekking (20-08).
      const verwachtingsCheck = await berekenVerwachtingsCheck(rows as any[]);

      res.json({
        success: true,
        importedDays: rows.length,
        detectedDrivers: rows[0] ? Object.keys(rows[0].assignments).length : 0,
        generatedShifts: generatedPlanning.summary.generatedShifts,
        matchedServices: generatedPlanning.summary.matchedServices,
        skippedAbsences: generatedPlanning.summary.skippedAbsences,
        startDate,
        endDate,
        fileStartDate,
        fileEndDate,
        importedDates,
        existingStart,
        existingEnd,
        replacedExistingDays,
        retainedDays,
        verlofConflicts,
        matrixVerlofConflicts: matrixConflicts,
        ruilVerlofConflicts: replayConflicts,
        ziekteDiensten,
        unknownCodes: generatedPlanning.summary.unknownCodes,
        unmatchedDrivers: generatedPlanning.summary.unmatchedDrivers,
        servicesWithoutSegments: generatedPlanning.summary.servicesWithoutSegments,
        perDriver: perDriverNaRuilen,
        // De import meldde de replay wél in de log, het voorbeeld verzweeg hem —
        // terwijl de cijfers hierboven er al door beïnvloed zijn.
        reappliedSwaps: reapplied,
        parserWaarschuwingen,
        chauffeursNieuw,
        chauffeursVerdwenen,
        ziekTeRegistreren,
        verwachtingsCheck,
      });
    } catch (err: any) {
      console.error("Import-voorbeeld maken is mislukt.", err);
      res.status(500).json({ error: "Import-voorbeeld maken is mislukt." });
    }
  });

  // De knop "Planning opnieuw opbouwen". De kern (opbouw, ruil-replay, vangrails,
  // log, push-diff) staat in api/_lib/planningHeropbouw.ts en wordt gedeeld met
  // het automatisch bijwerken na een save van het dienstoverzicht.
  app.post("/api/planning/sync-from-matrix", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const uit = await heropbouwPlanning(req, "handmatig");
      if (uit.status === "geblokkeerd") {
        return res.status(400).json({ error: uit.melding, unknownCodes: uit.unknownCodes, unmatchedDrivers: uit.unmatchedDrivers, blocked: true });
      }
      if (uit.status === "bezet") return res.status(409).json({ error: uit.melding });
      // "ongewijzigd" en "overgeslagen" bestaan alleen op de automatische weg.
      if (uit.status !== "bijgewerkt") return res.status(500).json({ error: "Planning opnieuw opbouwen is mislukt." });
      res.json({ success: true, ...uit.summary, notifiedDrivers: uit.gemeld });
    } catch (err: any) {
      console.error("Planning opnieuw opbouwen is mislukt.", err);
      res.status(500).json({ error: "Planning opnieuw opbouwen is mislukt." });
    }
  });

  // Geeft alle in-app beslissingen (verlof, dienstruil) sinds de vorige
  // matrix-import. Helpt de planner om Excel up-to-date te brengen voor de
  // volgende upload, zodat goedgekeurde wijzigingen niet stilzwijgend
  // overschreven worden.
  app.get("/api/planning-matrix/changes-since-import", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const history = await getPlanningMatrixHistory();
      const lastImport = history.length > 0 ? history[0] : null;
      const sinceIso = lastImport?.createdAt || new Date(0).toISOString();

      const [leave, swaps, users] = await Promise.all([getLeaveData(), getSwapsData(), getUsersData()]);
      const userName = (id?: string | null) => {
        if (!id) return null;
        return users.find((u) => String(u.id) === String(id))?.name || `Onbekend (${id})`;
      };

      const approvedLeave = leave
        .filter((l) => l.status === "approved" && l.decidedAt && l.decidedAt > sinceIso)
        .map((l) => ({
          id: l.id,
          userId: l.userId,
          userName: userName(l.userId),
          startDate: l.startDate,
          endDate: l.endDate,
          type: l.type,
          decidedAt: l.decidedAt,
        }));

      const approvedSwaps = swaps
        .filter((s) => s.status === "approved" && s.decidedAt && s.decidedAt > sinceIso)
        .map((s) => ({
          id: s.id,
          requesterId: s.requesterId,
          requesterName: userName(s.requesterId),
          targetDriverId: s.targetDriverId,
          targetName: userName(s.targetDriverId),
          shiftId: s.shiftId,
          decidedAt: s.decidedAt,
          // Bij een overname verhuist enkel de dienst van de aanvrager; er staat
          // geen tegenprestatie tegenover die de planner ook moet inboeken.
          swapType: normalizeSwapType(s.swapType),
        }));

      res.json({
        lastImport: lastImport
          ? { createdAt: lastImport.createdAt, importedDays: lastImport.importedDays }
          : null,
        approvedLeave,
        approvedSwaps,
      });
    } catch (err: any) {
      console.error("Changes-since-import error:", err);
      console.error("Kon wijzigingen niet ophalen.", err);
      res.status(500).json({ error: "Kon wijzigingen niet ophalen." });
    }
  });

  app.get("/api/planning-codes", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const codes = await getPlanningCodesData();
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(codes));
      res.json(codes);
    } catch (err: any) {
      console.error("Planningscodes laden is mislukt.", err);
      res.status(500).json({ error: "Planningscodes laden is mislukt." });
    }
  });

  app.post("/api/planning-codes", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const codes = req.body;
      if (!Array.isArray(codes)) {
        return res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      }

      const previousCodes = await getPlanningCodesData();
      { const rp = revisionCheck(req, previousCodes); if (rp) return revisionProbleemResponse(res, "De planningscodes", rp); }
      const codesRemoved = detectMassDelete(previousCodes, codes, (c) => String(c?.code));
      if (codesRemoved !== null) return massDeleteResponse(res, codesRemoved, previousCodes.length, "planningscodes");
      await savePlanningCodesData(codes);
      await logActivity(
        req,
        "planning_codes",
        "Planningscodes opgeslagen",
        `${codes.length} planningscodes opgeslagen. ${summarizePlanningCodeChanges(previousCodes, codes)}.`,
      );

      // Per-code audit entries — code zelf is de unieke key (geen apart id)
      const codeDiff = diffPlanningCodeChanges(previousCodes, codes);
      const fmtCode = (c: typeof codes[number]) => `${c.code}, ${c.description || '(geen omschrijving)'} [${c.category}].`;
      for (const c of codeDiff.added) {
        await logActivity(req, "planning_codes", "Code toegevoegd", fmtCode(c), { type: "planning_code", id: c.code });
      }
      for (const c of codeDiff.changed) {
        await logActivity(req, "planning_codes", "Code gewijzigd", fmtCode(c), { type: "planning_code", id: c.code });
      }
      for (const c of codeDiff.removed) {
        await logActivity(req, "planning_codes", "Code verwijderd", fmtCode(c), { type: "planning_code", id: c.code });
      }

      // Revisie over de gecanoniseerde serverstaat (save normaliseert/dedupt),
      // zodat de volgende save geen vals conflict ziet.
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getPlanningCodesData()));
      res.json({ success: true, count: codes.length });
    } catch (err: any) {
      console.error("Planningscodes opslaan is mislukt.", err);
      res.status(500).json({ error: "Planningscodes opslaan is mislukt." });
    }
  });

  app.post("/api/planning/assign-service", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const uit = await wijsDienstToeIntern(
        { date: req.body?.date, serviceNumber: req.body?.serviceNumber, driverId: req.body?.driverId },
        { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "planner" | "admin" },
      );
      if ("fout" in uit) return res.status(uit.fout.status).json({ error: uit.fout.error });
      res.json({ success: true, rows: uit.rows });
    } catch (err) {
      console.error("Dienst toewijzen is mislukt.", err);
      res.status(500).json({ error: "Dienst toewijzen is mislukt." });
    }
  });
}
