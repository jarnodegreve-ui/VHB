/**
 * Dienstruil: aanvragen, accepteren, beslissen, doorvoeren en terugdraaien,
 * plus de handmatige wissel door de admin.
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
import { isStafRol, authenticate, requireRole } from "../middleware.js";
import { uitvoeringPeriodeFout, uitvoeringenOpDagen, utcVensterVoor } from "./ruilUitvoeringen.js";
import { DAG_KORT, meldRuilTerValidatieTelegram } from "../telegram.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { RUIL_BEKEKEN_ACTIE, verloopUitLog, type RuilVerloopStap } from "../../shared/ruilVerloop.js";
import { RUST_TE_BEOORDELEN, beoordeelRuilRust, type RuilRustRegel, type RuilVoorRust, type RustPlanningRij } from "../../shared/ruilRust.js";
import { addDagenIso, DAG_DMJ, toLookupToken, matrixCodesForDate, isTakeoverCode, HANDMATIGE_WISSEL_PREFIX, SWAP_UITVOERING_ACTIES, normalizeSwapType, TAKEOVER_CODES, isActieveStaf, redenVoorChauffeur } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { applySwapToPlanning, revertSwapFromPlanning, swapToestandInPlanning, getSwapExecutions, getSwapHistories, getSwapVerloopRegels, type SwapVerloopLogRegel, getSwapsByIds, getPlanningData, getPlanningMatrixRows, getSwapsData, getUsersData, logActivity, getShiftById, getShiftsOnDate, markSwapTargetSeen, saveSwapsData } from "../storage.js";
import { recordUrl } from "./meldingen.js";
import { type BeslisActor, COLLECTION_REVISION_HEADER, ISO_DAY_RE, RECORD_ID_RE, actorReq, detectMassDelete, massDeleteResponse, revisionCheck, revisionOf, revisionProbleemResponse, viewUrl } from "./collectie.js";
import { TERMINAL_SWAP_STATES, describeSwapCarry, dubbeleInplanningFout, ruilAfwezigheidsFout, staleApprovalError } from "./ruilRegels.js";

/**
 * Hangt aan elke ruil het verloop per persoon (`verloop`, zie
 * shared/ruilVerloop.ts): wie vroeg aan, accepteerde, weigerde, keurde goed,
 * en wanneer. Afgeleid uit het activiteitenlog, in één query voor alle ruilen
 * samen. Alleen-lezen en nooit blokkerend: mislukt de logquery, dan komen de
 * ruilen gewoon zonder verloop terug en toont de client wat de ruil zelf zegt.
 *
 * Privacy: de aanroeper geeft alleen ruilen door die de kijker mag zien, en
 * het verloop wordt uitsluitend aan díe ruilen gehangen. De naam van de
 * planner gaat alleen naar staf mee.
 */
const metRuilVerloop = async <T extends { id: string }>(
  swaps: T[],
  staf: boolean,
  regels?: Promise<Record<string, SwapVerloopLogRegel[]>>,
): Promise<Array<T & { verloop?: RuilVerloopStap[] }>> => {
  if (swaps.length === 0) return swaps;
  // Een chauffeur leest "door de planner" waar de opslag de naam van de
  // uitvoerder draagt (zie redenVoorChauffeur). Hier, op de ene plek waar
  // elke ruil naar buiten gaat, zodat ook het pad zonder verloop gedekt is.
  const uit = staf
    ? swaps
    : swaps.map((s) => ("reason" in s ? { ...s, reason: redenVoorChauffeur((s as { reason?: unknown }).reason) } : s));
  try {
    const perSwap = await (regels ?? getSwapVerloopRegels(uit.map((s) => String(s.id))));
    return uit.map((s) => ({ ...s, verloop: verloopUitLog(perSwap[String(s.id)] ?? [], { metStafNaam: staf }) }));
  } catch (err) {
    console.error("Verloop van de dienstruilen laden is mislukt.", err);
    return uit;
  }
};

/**
 * Hangt aan elke ruil die nog beslist moet worden de rust van wie er een
 * dienst door krijgt (`rust`, zie shared/ruilRust.ts): minstens 8 uur t.o.v.
 * de dienst van de dag ervoor en erna, gerekend met de planning zoals ze NA
 * de ruil zou zijn. Een waarschuwing, geen blokkade: de planner beslist.
 *
 * De server rekent, niet de client: een chauffeur ziet de planning van zijn
 * collega niet. Privacy: staf krijgt beide regels, een chauffeur alleen de
 * regel over zichzelf (de uren van de collega gaan hem niet aan).
 *
 * Alleen-lezen en nooit blokkerend, zoals het verloop: mislukt het lezen van
 * de planning, dan komen de ruilen gewoon zonder `rust` terug.
 */
const metRuilRust = async <T extends { id: string }>(swaps: T[], staf: boolean, kijkerId: string): Promise<Array<T & { rust?: RuilRustRegel[] }>> => {
  const open = (swaps as Array<T & RuilVoorRust>).filter((s) => RUST_TE_BEOORDELEN.has(String(s.status ?? "")) && s.targetDriverId && s.shiftDate);
  if (open.length === 0) return swaps;
  try {
    // De maanden rond de betrokken dagen (dag ervoor en erna kunnen over een
    // maandgrens vallen); per maand één query, voor alle open ruilen samen.
    const maanden = new Set<string>();
    for (const s of open) {
      for (const dag of [s.shiftDate, s.returnDate]) {
        if (!dag || !/^\d{4}-\d{2}-\d{2}$/.test(String(dag))) continue;
        for (const n of [-1, 0, 1]) maanden.add(addDagenIso(String(dag), n).slice(0, 7));
      }
    }
    const betrokken = new Set(open.flatMap((s) => [String(s.requesterId), String(s.targetDriverId)]));
    const planning = (await Promise.all([...maanden].map((monthIso) => getPlanningData({ monthIso }))))
      .flat()
      .filter((r: any) => betrokken.has(String(r.driverId)))
      .map((r: any): RustPlanningRij => ({ date: String(r.date), driverId: String(r.driverId), line: r.line, startTime: String(r.startTime ?? ""), endTime: String(r.endTime ?? "") }));
    return swaps.map((s) => {
      const ruil = s as T & RuilVoorRust;
      if (!open.includes(ruil)) return s;
      const alle = beoordeelRuilRust(ruil, planning);
      const zichtbaar = staf ? alle : alle.filter((r) => String(r.wie === "aanvrager" ? ruil.requesterId : ruil.targetDriverId) === kijkerId);
      return zichtbaar.length > 0 ? { ...s, rust: zichtbaar } : s;
    });
  } catch (err) {
    console.error("Rusttijden bij de dienstruilen berekenen is mislukt.", err);
    return swaps;
  }
};

/** Verwijdert de snake_case-databasealiassen uit een client-swaprecord, zodat
 *  alleen de camelCase-API-velden overblijven (zie toPublicSwap in helpers). */
const SWAP_DB_ALIASSEN = ["shiftid", "requesterid", "targetdriverid", "createdat", "decidedat", "return_date", "return_code", "swap_type", "shift_date", "shift_line", "target_seen_at"] as const;

const stripSwapAliassen = (record: any): any => {
  if (!record || typeof record !== "object") return record;
  const schoon: Record<string, unknown> = { ...record };
  for (const alias of SWAP_DB_ALIASSEN) delete schoon[alias];
  // `verloop` is door GET /api/swaps afgeleid uit het activiteitenlog en komt
  // met de array-save gewoon terug van de client: het is nooit invoer.
  delete schoon.verloop;
  // Idem voor `rust`: door de server nagerekend, nooit invoer.
  delete schoon.rust;
  return schoon;
};

// Delta-endpoint voor beslissingen: één record, met optimistic-concurrency
// via ifStatus. Twee planners die tegelijk beoordelen kunnen elkaars
// beslissing zo niet meer stilletjes overschrijven (de whole-array-POST kon
// dat wel): de tweede krijgt een 409 en een verse lijst.
/** De ruil-beslissing zelf (rolregels, state-machine, planning-doorvoer,
 *  opslag, log en pushes) — gedeeld door PATCH /api/swaps/:id en de
 *  Telegram-goedkeurknoppen. Gedrag identiek aan de oude route-body. */
export async function beslisRuilIntern(opts: { id: string; status: string; ifStatus: string | null; actor: BeslisActor }): Promise<
  { fout: { status: number; error: string; currentStatus?: string } } | { swap: any; melding: string }
> {
    const { id, status, ifStatus, actor } = opts;
    const all = await getSwapsData();
    const current = all.find((s) => String(s.id) === id);
    if (!current) {
      return { fout: { status: 404, error: "Deze dienstruil bestaat niet (meer), mogelijk net ingetrokken." } };
    }
    if (ifStatus && String(current.status) !== ifStatus) {
      return { fout: { status: 409, error: `Deze ruil is intussen al '${current.status}', de lijst is ververst.`, currentStatus: String(current.status) } };
    }

    const role = actor.role;
    const selfId = String(actor.id);
    if (!isStafRol(role)) {
      // Alleen de aangezochte collega mag een openstaande ruil accepteren
      // of weigeren — zelfde regels als de array-route. Daarnaast mag de
      // AANVRAGER zijn eigen ruil intrekken zolang die nog open staat
      // (pending of accepted-maar-nog-niet-goedgekeurd): verlof kon dat al,
      // dienstruil dwong een belletje naar de planner af.
      const isTarget = String(current.targetDriverId ?? "") === selfId && String(current.requesterId) !== selfId;
      const targetTransition = isTarget && current.status === "pending" && (status === "accepted" || status === "rejected");
      const isRequester = String(current.requesterId) === selfId;
      const withdrawTransition = isRequester && status === "cancelled" && (current.status === "pending" || current.status === "accepted");
      if (!targetTransition && !withdrawTransition) {
        return { fout: { status: 403, error: "Niet toegestaan: je mag een aan jou gerichte, openstaande ruil accepteren of weigeren, of je eigen openstaande aanvraag intrekken." } };
      }
    } else {
      // 'accepted' ís de instemming van de aangezochte collega — alleen die
      // collega mag hem schrijven, geen enkele stafrol. Zonder deze regel
      // blokkeerde alleen de sprong pending → approved en kon een planner in
      // twee stappen (pending → accepted → approved) instemming vervalsen,
      // inclusief de push "<collega> accepteerde de ruil" naar de aanvrager.
      // Een admin die zonder bevestiging wil goedkeuren gebruikt de bestaande
      // directe pending → approved-weg hieronder.
      if (status === "accepted" && current.status !== "accepted") {
        return { fout: { status: 403, error: "Niet toegestaan: alleen de aangezochte collega kan een ruil accepteren." } };
      }
      const allowed = ["accepted", "approved", "rejected", "cancelled", "completed"];
      if (!allowed.includes(status)) {
        return { fout: { status: 400, error: "Ongeldige status." } };
      }
      // Force-approve vanuit pending blijft admin-only (zelfde beleid als POST).
      if (role !== "admin" && current.status === "pending" && status === "approved") {
        return { fout: { status: 403, error: "Niet toegestaan: een ruil zonder bevestiging van de collega kan alleen een admin rechtstreeks goedkeuren." } };
      }
    }

    // State-machine: uit een afgehandelde status (geweigerd/geannuleerd/
    // voltooid) is geen overgang meer toegestaan (rejected → approved was zo
    // mogelijk).
    if (status !== current.status && TERMINAL_SWAP_STATES.has(String(current.status))) {
      return { fout: { status: 409, error: "Deze dienstruil is al afgehandeld en kan niet meer van status veranderen." } };
    }

    // Halve doorvoer (planning al gewisseld, status nooit opgeslagen — DB-hik
    // tussen de twee writes): de checks hieronder zagen de dienst dan bij de
    // collega en gaven 409 op élke nieuwe poging, terwijl afwijzen niets
    // terugdraaide (controle-ronde 27-08, bevinding 8). Eén blik op de
    // planning maakt goedkeuren idempotent en afwijzen herstellend. Alleen
    // bij goedkeuren/afwijzen (stafbeslissingen); een chauffeur die zijn
    // eigen aanvraag intrekt raakt de planning niet.
    const alDoorgevoerd = (status === "approved" || status === "rejected") && current.status !== "approved"
      ? (await swapToestandInPlanning(current)) === "doorgevoerd"
      : false;

    // Exclusiviteit: de aanvrager moet de dienst nog hebben (zie ook
    // staleApprovalError bij POST /api/swaps).
    if (status === "approved" && current.status !== "approved" && !alDoorgevoerd) {
      const stale = await staleApprovalError(current, all);
      if (stale) return { fout: { status: 409, error: stale } };
      // Zelfde afwezigheids-hercheck als de array-route: wie ziek gemeld is
      // sinds het indienen, mag de dienst niet alsnog toegeschoven krijgen.
      const afwFout = await ruilAfwezigheidsFout(current);
      if (afwFout) return { fout: { status: 409, error: afwFout } };
      const dubbelFout = await dubbeleInplanningFout(current);
      if (dubbelFout) return { fout: { status: 409, error: dubbelFout } };
    }

    // Planning-doorvoer VÓÓR de statuswijziging. movePlanningRows filtert op
    // de huidige eigenaar en is daardoor idempotent: een tweede poging
    // verplaatst niets extra. Andersom (eerst opslaan) liet een mislukte
    // tweede leg een hálve wissel achter terwijl de ruil al op 'approved'
    // stond — en dan blokkeerde de ifStatus-guard elke nieuwe poging, zodat
    // alleen handmatig sleutelen in de database het nog rechttrok.
    //
    // Terugdraaien geldt voor élke overgang die betekent "gaat toch niet
    // door": annuleren én afwijzen. Alleen 'completed' laat de wissel staan,
    // want dat betekent juist dat hij is uitgevoerd. Stond hier eerst enkel
    // 'cancelled', waardoor approved → rejected de dienst bij de collega liet
    // staan terwijl de replay hem bij de volgende import weer terugzette.
    let carry: string | undefined;
    if (status === "approved" && current.status !== "approved") {
      if (alDoorgevoerd) {
        carry = "wissel stond al in de planning (herstel na een eerdere halve doorvoer)";
      } else {
        const r = await applySwapToPlanning(current);
        // Zelfde concurrency-vangnet als de array-route: 0 verplaatste rijen
        // mét dienst-info = planning wijzigde tussen check en doorvoer → 409
        // i.p.v. half goedkeuren met een logwaarschuwing.
        if (r && r.offeredMoved === 0) {
          return { fout: { status: 409, error: "De planning is intussen gewijzigd, de dienst staat niet meer op naam van de aanvrager. Vernieuw de pagina en beoordeel opnieuw." } };
        }
        carry = describeSwapCarry(current, r, "doorgevoerd");
      }
    } else if ((current.status === "approved" || alDoorgevoerd) && (status === "cancelled" || status === "rejected")) {
      const r = await revertSwapFromPlanning(current);
      carry = describeSwapCarry(current, r, "teruggedraaid");
    }

    // 'accepted' is een tussenstap (collega akkoord), nog géén beslismoment —
    // decidedAt hoort pas bij een definitieve beslissing (zelfde semantiek
    // als de array-route/UI).
    //
    // 'completed' (knop Afhandelen) is evenmin een beslissing: de wissel is al
    // goedgekeurd en doorgevoerd, hij wordt alleen administratief weggezet.
    // Het beslismoment van de goedkeuring blijft dus staan. De heropbouw-
    // replay, de maandplanning-overlay, de dekking en de ruil-badge spelen
    // goedgekeurde én afgehandelde ruilen af in volgorde van decidedAt; een
    // overschreven moment zette de eerste schakel van een doorgeefketting
    // (A → B, daarna B → C) achteraan, waardoor de dienst na een heropbouw
    // terugviel op B. Het afhandelmoment zelf staat in het activiteitenlog
    // ("Dienstruil voltooid").
    const behoudtBeslismoment = status === "accepted" || status === "completed";
    const updated = behoudtBeslismoment
      ? { ...current, status }
      : { ...current, status, decidedAt: new Date().toISOString() };
    await saveSwapsData([updated], []);

    const usersForLog = await getUsersData();
    const userName = (uid: string) => usersForLog.find((u) => String(u.id) === String(uid))?.name || `Onbekende gebruiker (${uid})`;
    const actionLabels: Record<string, string> = {
      accepted: "Dienstruil geaccepteerd",
      approved: "Dienstruil goedgekeurd",
      rejected: "Dienstruil afgewezen",
      cancelled: "Dienstruil geannuleerd",
      completed: "Dienstruil voltooid",
    };
    const action = actionLabels[status] ?? "Dienstruil bijgewerkt";
    await logActivity(actorReq(actor), "swaps", action, `${userName(String(current.requesterId))}, dienstruil (${current.status} → ${status}).${carry ? ` ${carry}` : ""}`, { type: "swap", id });

    // 'completed' = de planning zet een doorgevoerde wissel administratief weg
    // (knop Afhandelen, Jarno 17-09). Voor de chauffeurs verandert er niets,
    // dus geen melding: dat zou een tweede "ruil goedgekeurd"-bericht zijn.
    const betrokkenen = status === "completed" ? [] : [String(current.requesterId), String(current.targetDriverId ?? "")]
      .filter((uid) => uid && uid !== selfId);
    await sendPushToUsers(betrokkenen, {
      title: action,
      soort: "ruil",
      body: status === "accepted"
        ? `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil, wacht op goedkeuring van de planner.`
        : `Dienstruil van ${userName(String(current.requesterId))}: ${current.status} → ${status}.`,
      url: recordUrl("ruil-verzoeken", current.id),
    });
    // Geaccepteerd = validatie nodig → beslissers een seintje (zie array-route)
    // en dezelfde melding mét goedkeurknoppen naar de Telegram-chat.
    if (status === "accepted") {
      const beslissers = usersForLog
        .filter((u) => isActieveStaf(u) && String(u.id) !== selfId)
        .map((u) => String(u.id));
      await sendPushToUsers(beslissers, {
        title: "Dienstruil wacht op validatie",
        soort: "ruil",
        body: `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil van ${userName(String(current.requesterId))}, rij- en rusttijden checken.`,
        url: recordUrl("ruil-verzoeken", current.id),
      });
      await meldRuilTerValidatieTelegram({
        id: String(current.id),
        omschrijving: `${userName(String(current.targetDriverId ?? ""))} accepteerde de ruil van ${userName(String(current.requesterId))}${current.shiftLine ? `, dienst ${current.shiftLine} op ${current.shiftDate ? DAG_KORT(String(current.shiftDate)) : "?"}` : ""}${current.returnCode && String(current.returnCode).toLowerCase() !== "vrij" ? `, tegenprestatie ${current.returnCode} op ${current.returnDate ? DAG_KORT(String(current.returnDate)) : "?"}` : ""}.`,
      });
    }

    return { swap: updated, melding: `${action}, ${userName(String(current.requesterId))}${current.shiftLine ? ` · dienst ${current.shiftLine} op ${current.shiftDate ? DAG_KORT(String(current.shiftDate)) : "?"}` : ""}.` };
}

export function mountRuilRoutes(app: express.Express) {
  app.get("/api/swaps", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      // Privacy: een chauffeur ziet enkel ruilen waar hij zélf bij betrokken is
      // (aanvrager of aangezochte collega) — niet de ruilhistoriek van iedereen.
      // Planner/admin zien alles (nodig voor validatie + beheer).
      // Niet-staf: het filter zit al in de query (scheelt de hele tabel lezen);
      // het JS-filter hieronder blijft als vangnet staan, zodat de privacygrens
      // nooit van de filtersyntaxis van de query afhangt.
      const staf = isStafRol(req.appUser!.role);
      // Staf leest elke ruil, dus ook elk verloop: die query start tegelijk met
      // de ruilen. Een chauffeur vraagt alleen het verloop van zijn eigen ruilen
      // op, en dat kan pas als hun id's bekend zijn.
      const alleRegels = staf ? getSwapVerloopRegels() : undefined;
      alleRegels?.catch(() => undefined); // de fout wordt in metRuilVerloop afgehandeld
      const data = await getSwapsData(staf ? undefined : { betrokkenUserId: String(req.appUser!.id) });
      if (!staf) {
        const selfId = String(req.appUser!.id);
        const scoped = data.filter(
          (s) => String(s.requesterId) === selfId || String(s.targetDriverId ?? "") === selfId,
        );
        return res.json(await metRuilRust(await metRuilVerloop(scoped, false), false, selfId));
      }
      // Revisie enkel voor planner/admin (volledige weergave) — de POST-check
      // geldt ook alleen voor hen (chauffeur-payloads worden delta-gereconstrueerd).
      // Over de ruilen ZONDER verloop: de POST-check vergelijkt met
      // revisionOf(getSwapsData()), en het verloop is afgeleid, geen invoer.
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(data));
      res.json(await metRuilRust(await metRuilVerloop(data, true, alleRegels), true, String(req.appUser!.id)));
    } catch (err) {
      res.status(500).json({ error: "Dienstruilen laden is mislukt." });
    }
  });

  /**
   * Wekelijks ruiloverzicht voor het klassement (Jarno 18-09): alle wissels die
   * in dat venster écht zijn UITGEVOERD in het portaal, niet de wissels die die
   * week in de planning vielen. "Uitgevoerd" = het moment waarop de wissel in de
   * planning werd doorgevoerd: de goedkeuring door de planning, plus de wissels
   * die de planning zelf handmatig doorvoerde. Die momenten staan alleen in het
   * activiteitenlog, want `decidedAt` op de swap wordt door een latere
   * terugdraai overschreven (en tot 20-09 ook door afhandelen, 'completed').
   *
   * Een wissel die later teruggedraaid werd, staat er bewust wél in (met zijn
   * huidige status): hij ís die week doorgevoerd geweest, en het klassement is
   * een bewijsstuk van wat er gebeurd is.
   */
  app.get("/api/swaps/uitgevoerd", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const van = String(req.query.van ?? "");
      const tot = String(req.query.tot ?? "");
      // Zelfde grens als de rapporten (366 dagen; was 31, genoeg voor het
      // weekblad): ruil-logregels ruimt de nachtcron nooit op, dus een jaar
      // terugkijken kan. Periode, venster en dagfilter komen uit één kern
      // (api/_lib/ruilUitvoeringen.ts), gedeeld met het rapport Uitgevoerde wissels.
      const periodeFout = uitvoeringPeriodeFout(van, tot);
      if (periodeFout) return res.status(400).json({ error: periodeFout });

      // Ruim in UTC ophalen en daarna filteren op de Brusselse kalenderdag: dat
      // klopt ook in de weken van de zomer-/wintertijdwissel, zonder offsetwerk.
      const venster = utcVensterVoor(van, tot);
      const logRegels = await getSwapExecutions(venster.vanIso, venster.totIso, SWAP_UITVOERING_ACTIES);
      const uitvoeringen = uitvoeringenOpDagen(logRegels, van, tot);

      const swapIds = [...new Set(uitvoeringen.map((regel) => String(regel.entityId ?? "")).filter(Boolean))];
      const [betrokkenSwaps, users, verloopPerSwap] = await Promise.all([
        getSwapsByIds(swapIds),
        getUsersData(),
        getSwapHistories(swapIds),
      ]);
      const swapById = new Map(betrokkenSwaps.map((s: any) => [String(s.id), s]));
      const naamById = new Map(users.map((u: any) => [String(u.id), String(u.name)]));
      const naamVan = (id: unknown) => {
        const sleutel = String(id ?? "");
        if (!sleutel) return "";
        return naamById.get(sleutel) ?? "Onbekend";
      };

      // Eén regel per uitvoering, chronologisch: een wissel die deze week eerst
      // doorgevoerd en daarna opnieuw doorgevoerd werd, hoort er twee keer in.
      const wissels = uitvoeringen
        .map((regel) => {
          // getSwapsData levert al publieke records (toPublicSwap), dus geen
          // tweede vertaalslag hier.
          const swap = swapById.get(String(regel.entityId ?? ""));
          if (!swap) return null; // verwijderde ruil: het logspoor blijft, het record niet
          return {
            swap,
            aanvragerNaam: naamVan(swap.requesterId),
            overnemerNaam: naamVan(swap.targetDriverId),
            uitgevoerdOp: regel.createdAt,
            uitgevoerdDoor: regel.actorName,
            uitgevoerdDoorRol: regel.actorRole,
            handmatig: regel.action !== "Dienstruil goedgekeurd",
            verloop: verloopPerSwap[String(regel.entityId ?? "")] ?? [],
          };
        })
        .filter(Boolean);

      res.json({ van, tot, wissels });
    } catch (err) {
      console.error("Uitgevoerde dienstwissels laden is mislukt.", err);
      res.status(500).json({ error: "Uitgevoerde dienstwissels laden is mislukt." });
    }
  });

  app.post("/api/swaps", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const newData = req.body;
      if (!Array.isArray(newData)) {
        return res.status(400).json({ error: "Ongeldig formaat: lijst verwacht." });
      }

      const previousSwaps = await getSwapsData();
      // Planner/admin schrijven de hele payload ("ontbreekt = verwijderen"):
      // zonder revisie-check verwijderde een stale save stilletjes een verse
      // aanvraag die intussen binnenkwam. Chauffeur-payloads worden hieronder
      // delta-gereconstrueerd en hebben de check niet nodig.
      if (isStafRol(req.appUser!.role)) {
        { const rp = revisionCheck(req, previousSwaps); if (rp) return revisionProbleemResponse(res, "De dienstruilen", rp); }
        const swapsRemoved = detectMassDelete(previousSwaps, newData);
        if (swapsRemoved !== null) return massDeleteResponse(res, swapsRemoved, previousSwaps.length, "dienstruilen");
      }
      const previousById = new Map(previousSwaps.map((s) => [String(s.id), s]));
      const newById = new Map(newData.map((s: any) => [String(s.id), s]));
      const swapIdsToDelete: string[] = [];
      // Eén lopende ruil per dienst — voorkomt dat twee gelijktijdige verzoeken
      // voor dezelfde shift allebei blijven lopen of goedgekeurd raken.
      //
      // BEWUST zonder 'approved': sinds de planning-doorvoer (#289) verhuist een
      // goedgekeurde ruil de dienst écht naar de collega, maar de rij-id blijft
      // de oorspronkelijke chauffeur bevatten. Stond 'approved' er nog in, dan
      // blokkeerde die afgehandelde ruil voor eeuwig élk nieuw verzoek voor
      // dezelfde shiftId — de nieuwe eigenaar kon de dienst dus nooit doorgeven
      // of terugruilen (409). Dat een dienst niet twee keer tegelijk weggegeven
      // wordt, bewaakt de eigendomscheck hieronder al: alleen de húidige
      // eigenaar kan hem aanbieden.
      const OPEN_SWAP_STATES = new Set(["pending", "accepted"]);
      // Exclusiviteit geldt per VOLLEDIGE dienst (datum + dienstnummer), niet per
      // planning-rij: een gesplitste dienst staat als meerdere rijen in de
      // planning, dus een check op shiftId sloot alleen dát deel af en op het
      // tweede deel kon een tweede verzoek starten — terwijl de doorvoer altijd
      // de hele dienst verplaatst. Jarno 18-09: meerdere wissels ná elkaar op
      // dezelfde dienst mogen, twee tegelijk op delen van één dienst niet.
      const dienstSleutelVan = (date: unknown, line: unknown) => {
        const dag = String(date ?? "").trim();
        const nummer = toLookupToken(String(line ?? ""));
        return dag && nummer ? `${dag}__${nummer}` : "";
      };
      const openDienstSleutels = new Set<string>();
      const openShiftIds = new Set<string>();
      for (const s of previousSwaps) {
        if (!OPEN_SWAP_STATES.has(String(s.status))) continue;
        const sleutel = dienstSleutelVan(s.shiftDate, s.shiftLine);
        if (sleutel) openDienstSleutels.add(sleutel);
        // Vangnet voor records van vóór de shift_info-migratie: die dragen geen
        // datum/dienstnummer, daar blijft de rij-id het enige aanknopingspunt.
        openShiftIds.add(String(s.shiftId));
      }
      /** Loopt er al een verzoek voor deze dienst? `shift` komt van de server
       *  (getShiftById), nooit uit de payload: anders ontwijkt een verzonnen
       *  shiftDate de controle. */
      const looptAlEenVerzoek = (shiftId: unknown, shift: { date: string; line: string } | null) => {
        const sleutel = dienstSleutelVan(shift?.date, shift?.line);
        return (!!sleutel && openDienstSleutels.has(sleutel)) || openShiftIds.has(String(shiftId ?? ""));
      };
      const LOOPT_AL_FOUT = "Voor deze dienst loopt al een ruilverzoek, ook als dat over een ander deel van dezelfde dienst gaat. Trek dat eerst in of wacht de beslissing af.";
      // Wat er werkelijk weggeschreven wordt. Planner/admin schrijven de hele
      // payload (vertrouwde rol); voor een chauffeur bouwen we de set op uit
      // enkel de records die hij/zij legitiem toevoegt of beantwoordt — zo
      // overschrijft een echo van ongewijzigde records nooit een gelijktijdige
      // wijziging van een ander (geen vals 403, geen clobber).
      let recordsToWrite: any[] = newData;

      // Exclusiviteit per dienst geldt ook voor planner/admin-aanvragen —
      // de check zat eerst alleen in de chauffeur-tak.
      if (isStafRol(req.appUser!.role)) {
        for (const next of newData) {
          if (previousById.has(String(next.id))) continue;
          // Alleen echte nieuwe aanvragen ('pending'); andere creatie-statussen
          // worden verderop al met een strengere 403 geweigerd.
          if (String(next.status) !== "pending") continue;
          if (looptAlEenVerzoek(next.shiftId, await getShiftById(String(next.shiftId ?? "")))) {
            return res.status(409).json({ error: LOOPT_AL_FOUT });
          }
        }
      }

      if (!isStafRol(req.appUser!.role)) {
        const selfId = String(req.appUser!.id);
        const writes: any[] = [];

        // Verwijderingen: alleen eigen pending-aanvragen mogen weg.
        for (const [id, prev] of previousById) {
          if (!newById.has(id)) {
            // GET /api/swaps is voor chauffeurs gescoped op ruilen waar ze
            // zélf bij betrokken zijn — andermans ruilen ontbreken dus altijd
            // in hun payload en zijn géén intrekking.
            const involved = String(prev.requesterId) === selfId || String(prev.targetDriverId ?? "") === selfId;
            if (!involved) continue;
            if (String(prev.requesterId) !== selfId || prev.status !== "pending") {
              return res.status(403).json({ error: "Niet toegestaan: je kan alleen je eigen openstaande wisselverzoeken intrekken." });
            }
            swapIdsToDelete.push(String(id));
          }
        }

        // Toevoegingen + wijzigingen. Users éénmalig vooraf: dit stond eerst
        // per nieuw record ín de loop (volledige gepagineerde users-fetch per
        // ruilverzoek).
        const allUsersForSwapChecks = await getUsersData();
        for (const next of newData) {
          const prev = previousById.get(String(next.id));
          if (!prev) {
            if (String(next.requesterId) !== selfId) {
              return res.status(403).json({ error: "Niet toegestaan: je kan alleen voor jezelf een wisselverzoek indienen." });
            }
            if (next.status !== "pending") {
              return res.status(403).json({ error: "Niet toegestaan: nieuwe wisselverzoeken starten als 'pending'." });
            }
            if (!next.targetDriverId || String(next.targetDriverId).trim() === "") {
              return res.status(400).json({ error: "Selecteer een collega aan wie je de dienstruil aanvraagt." });
            }
            if (String(next.targetDriverId) === selfId) {
              return res.status(400).json({ error: "Je kan geen dienstruil aan jezelf aanvragen." });
            }
            if (!RECORD_ID_RE.test(String(next.id ?? ""))) {
              return res.status(400).json({ error: "Ongeldig aanvraag-id." });
            }
            // Bij een overname (ruil zonder tegenprestatie) is er bewust géén
            // terugruil; de eigenlijke voorwaarde — de collega staat die dag op
            // vrij/bv/tk/ta — wordt rol-onafhankelijk verderop gecontroleerd.
            if (normalizeSwapType(next.swapType) === "ruil"
              && (!next.returnCode || String(next.returnCode).trim() === "" || !next.returnDate || String(next.returnDate).trim() === "")) {
              return res.status(400).json({ error: "Kies wat je in ruil neemt (een dienst of een vrije dag van de collega)." });
            }

            if (next.decidedAt) {
              return res.status(403).json({ error: "Niet toegestaan: nieuwe aanvraag mag geen beslismoment hebben." });
            }
            // Eigendom: de aangeboden dienst moet van de aanvrager zelf zijn
            // (anders kan je andermans dienst te ruil zetten) en de collega
            // moet een bestaande, actieve gebruiker zijn.
            const offeredShift = await getShiftById(String(next.shiftId ?? ""));
            if (!offeredShift || String(offeredShift.driverId) !== selfId) {
              return res.status(403).json({ error: "Niet toegestaan: je kan alleen je eigen dienst te ruil aanbieden." });
            }
            // Exclusiviteit per dienst, dus ook over de delen van een
            // gesplitste dienst heen (offeredShift komt van de server).
            if (looptAlEenVerzoek(next.shiftId, offeredShift)) {
              return res.status(409).json({ error: LOOPT_AL_FOUT });
            }
            const targetUser = allUsersForSwapChecks.find((u: any) => String(u.id) === String(next.targetDriverId));
            if (!targetUser || targetUser.isActive === false) {
              return res.status(400).json({ error: "De gekozen collega bestaat niet (meer) of is inactief." });
            }
            writes.push(next);
          } else {
            // De aangeduide collega mag een aan hem/haar gerichte, openstaande
            // ruil accepteren (pending → accepted) of weigeren (pending → rejected).
            // Definitieve goedkeuring blijft bij planner/admin (rij-/rusttijden).
            const selfIsTarget = String(prev.targetDriverId ?? "") === selfId;
            const selfIsRequester = String(prev.requesterId) === selfId;
            const isColleagueResponse =
              selfIsTarget && !selfIsRequester &&
              prev.status === "pending" &&
              (next.status === "accepted" || next.status === "rejected");

            if (isColleagueResponse) {
              // Enkel status (+ decidedAt bij weigeren) mag wijzigen; de rest niet.
              const immutable = ["shiftId", "requesterId", "targetDriverId", "createdAt", "reason", "returnDate", "returnCode"] as const;
              for (const f of immutable) {
                if (String((next as any)[f] ?? "") !== String((prev as any)[f] ?? "")) {
                  return res.status(403).json({ error: "Niet toegestaan: je mag een aanvraag alleen accepteren of weigeren." });
                }
              }
              // Het ruiltype is eveneens onveranderlijk, maar tolerant voor een
              // oudere client uit de PWA-cache die het veld nog niet kent:
              // ontbreekt het, dan is dat géén wijziging — en we schrijven altijd
              // het opgeslagen type terug, zodat een overname niet stil naar een
              // 1-op-1 ruil degradeert.
              if (next.swapType !== undefined && normalizeSwapType(next.swapType) !== normalizeSwapType(prev.swapType)) {
                return res.status(403).json({ error: "Niet toegestaan: je mag een aanvraag alleen accepteren of weigeren." });
              }
              // decidedAt is server-gezaghebbend: 'accepted' is een tussenstap
              // (geen beslismoment, behoud wat er stond), 'rejected' krijgt het
              // servertijdstip. Nooit de client-waarde vertrouwen — reapplyApproved
              // Swaps sorteert kettingen op decidedAt.
              writes.push({
                ...next,
                swapType: normalizeSwapType(prev.swapType),
                decidedAt: next.status === "rejected" ? new Date().toISOString() : prev.decidedAt,
              });
            }
            // Anders: ongewijzigde echo of een gelijktijdig door een ander
            // gewijzigd record → bewust NIET wegschrijven (geen 403, geen
            // overschrijving van de verse serverstaat).
          }
        }
        recordsToWrite = writes;
      }

      // Beleid: een ruil rechtstreeks goedkeuren vanuit 'pending' (dus zonder
      // bevestiging van de collega) mag enkel een admin. Planners keuren pas
      // goed nadat de collega accepteerde ('accepted' → 'approved'). Zo wordt de
      // UI-keuze ook server-side afgedwongen, niet enkel via verborgen knoppen.
      if (req.appUser?.role !== "admin") {
        for (const next of newData) {
          const prev = previousById.get(String(next.id));
          if (prev && prev.status === "pending" && next.status === "approved") {
            return res.status(403).json({ error: "Niet toegestaan: een ruil zonder bevestiging van de collega kan alleen een admin rechtstreeks goedkeuren." });
          }
          // Bypass-gat: zonder deze check kon een planner het pending-record
          // onder een NIEUW id met status 'approved' insturen en zo dezelfde
          // regel omzeilen. Nieuwe records starten dus altijd als 'pending'.
          if (!prev && next.status !== "pending") {
            return res.status(403).json({ error: "Niet toegestaan: nieuwe wisselverzoeken starten als 'pending'." });
          }
        }
      }

      // 'accepted' ís de instemming van de aangezochte collega — geen enkele
      // stafrol mag hem schrijven, ook een admin niet. De regel hierboven
      // blokkeerde alleen de sprong pending → approved; via pending → accepted
      // → approved was instemming alsnog te vervalsen (zelfde gat als in
      // PATCH /api/swaps/:id). Een admin keurt zonder bevestiging goed via de
      // directe pending → approved-weg.
      if (isStafRol(req.appUser!.role)) {
        for (const next of newData) {
          const prev = previousById.get(String(next.id));
          if (String(next.status) === "accepted" && String(prev?.status ?? "") !== "accepted") {
            return res.status(403).json({ error: "Niet toegestaan: alleen de aangezochte collega kan een ruil accepteren." });
          }
        }
      }

      if (isStafRol(req.appUser!.role)) {
        for (const [id, prev] of previousById) {
          if (newById.has(String(id))) continue;
          // Doorgevoerde ruilen (approved/completed) zitten in de heropbouw-
          // replay: verwijderen draait níéts terug in de planning, maar laat de
          // wissel bij de eerstvolgende Excel-import wél stil verdwijnen — het
          // rooster springt dan onaangekondigd terug. Alleen een admin mag dat
          // (bewust); een planner draait een ruil terug via status 'cancelled',
          // dan wordt de planning netjes mee teruggedraaid.
          if (req.appUser?.role !== "admin" && (prev.status === "approved" || prev.status === "completed")) {
            return res.status(403).json({ error: "Een doorgevoerde ruil kan niet verwijderd worden. Annuleer hem in plaats daarvan, dan wordt de planning mee teruggedraaid." });
          }
          swapIdsToDelete.push(String(id));
        }
      }

      // Exclusiviteit bij goedkeuren: de aanvrager moet de dienst op dat moment
      // nog écht hebben (zie staleApprovalError). Over recordsToWrite (niet
      // newData): een stale echo die niet weggeschreven wordt mag geen vals 409
      // op een ongerelateerde nieuwe aanvraag veroorzaken.
      // Halve doorvoer herkennen (zie beslisRuilIntern): staat de wissel al in
      // de planning, dan slaan de checks én de doorvoer over en wordt alleen
      // de status alsnog opgeslagen.
      const alDoorgevoerdIds = new Set<string>();
      for (const next of recordsToWrite) {
        const prev = previousById.get(String(next.id));
        const becomesApproved = next.status === "approved" && (!prev || prev.status !== "approved");
        if (!becomesApproved) continue;
        if (prev && (await swapToestandInPlanning(prev)) === "doorgevoerd") {
          alDoorgevoerdIds.add(String(next.id));
          continue;
        }
        const stale = await staleApprovalError(next, previousSwaps);
        if (stale) return res.status(409).json({ error: stale });
        // Tussen indienen en goedkeuren kan iemand ziek gemeld zijn — bij het
        // goedkeuren opnieuw toetsen, op de ópgeslagen voorwaarden.
        const afwFout = await ruilAfwezigheidsFout(prev ?? next);
        if (afwFout) return res.status(409).json({ error: afwFout });
        // …en de collega kan intussen een dienst gekregen hebben.
        const dubbelFout = await dubbeleInplanningFout(prev ?? next);
        if (dubbelFout) return res.status(409).json({ error: dubbelFout });
      }

      // State-machine: een afgehandelde ruil (geweigerd/geannuleerd/voltooid) kan
      // niet meer van status veranderen — ook niet door een planner via een
      // directe API-call (rejected → approved was zo mogelijk).
      for (const next of recordsToWrite) {
        const prev = previousById.get(String(next.id));
        if (prev && String(next.status) !== String(prev.status) && TERMINAL_SWAP_STATES.has(String(prev.status))) {
          return res.status(409).json({ error: "Deze dienstruil is al afgehandeld en kan niet meer van status veranderen." });
        }
      }

      // Datum-shape afdwingen op nieuwe records — rol-onafhankelijk (de check
      // zat eerst alleen in de chauffeur-tak; de motivatie geldt voor élke rol:
      // een kapot formaat maakt de terugruil stil onzichtbaar in rooster/feed).
      for (const next of recordsToWrite) {
        if (previousById.has(String(next.id))) continue;
        if (next.returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(next.returnDate))) {
          return res.status(400).json({ error: "Ongeldige terugruil-datum: verwacht JJJJ-MM-DD." });
        }
      }

      // De tegenprestatie moet écht bestaan en van de aangezochte collega zijn.
      // Tot nu toe werd alleen het datumformaat gecontroleerd, terwijl de
      // planning-doorvoer die twee velden rechtstreeks vertaalt naar
      // `update planning set driverId`. Twee gaten die dat openliet:
      //
      //  1) een aanvrager kon een returnDate/returnCode meesturen die naar een
      //     ándere (aantrekkelijkere) dienst van de collega wijst dan de wizard
      //     toonde — twee mensen moeten akkoord gaan, maar de collega ziet in de
      //     UI wat er staat, niet wat er zou gebeuren;
      //  2) staat de collega die dag op twéé verschillende diensten, dan plakt
      //     /api/availability die samen tot "4101/4205". Als returnCode matcht
      //     dat geen enkele rij: de aangeboden dienst verhuisde wél, de
      //     tegenprestatie niet, en de 1-op-1 ruil werd stil een eenzijdige
      //     overname met alleen een waarschuwing in de log.
      //
      // 'vrij' blijft geldig zonder planning-rij: dan geeft de collega een vrije
      // dag en valt er niets te verplaatsen (zie swapHasReturnShift in storage).
      for (const next of recordsToWrite) {
        if (previousById.has(String(next.id))) continue;
        if (normalizeSwapType(next.swapType) === "overname") continue;
        const code = String(next.returnCode ?? "").trim();
        const date = String(next.returnDate ?? "").trim();
        if (!code || !date || code.toLowerCase() === "vrij") continue;
        const targetId = String(next.targetDriverId ?? "");
        const dagShifts = await getPlanningData({ driverId: targetId, monthIso: date.slice(0, 7) });
        const match = dagShifts.some((s: any) => String(s.date) === date && String(s.line).trim() === code);
        if (!match) {
          // Users pas hier ophalen: in het normale geval kost dit niets.
          const naam = (await getUsersData()).find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
          return res.status(400).json({
            error: code.includes("/")
              ? `${naam} rijdt op ${DAG_DMJ(date)} meerdere diensten (${code}). Kies één dienst als tegenprestatie.`
              : `Dienst ${code} staat op ${DAG_DMJ(date)} niet op naam van ${naam}, de planning is intussen gewijzigd. Vernieuw en kies opnieuw.`,
          });
        }
      }

      // Ruil zonder tegenprestatie ('overname'): alleen toegestaan als de
      // collega die dag géén dienst rijdt én in de planning op vrij/bv/tk/ta
      // staat. Rol-onafhankelijk: een dienst doorschuiven naar iemand die rijdt
      // (of ziek is) is voor elke rol onzin, niet enkel voor een chauffeur.
      // Het type zelf is immutable (zie de accepteer-tak hierboven), dus deze
      // check hoeft alleen op nieuwe records.
      {
        const newTakeovers = recordsToWrite.filter(
          (n: any) => !previousById.has(String(n.id)) && normalizeSwapType(n.swapType) === "overname",
        );
        if (newTakeovers.length > 0) {
          const [matrixRows, usersForTakeover] = await Promise.all([getPlanningMatrixRows(), getUsersData()]);
          for (const next of newTakeovers) {
            const targetId = String(next.targetDriverId ?? "").trim();
            if (!targetId) {
              return res.status(400).json({ error: "Selecteer een collega aan wie je de dienst wil doorgeven." });
            }
            const offeredShift = await getShiftById(String(next.shiftId ?? ""));
            if (!offeredShift) {
              return res.status(400).json({ error: "De aangeboden dienst bestaat niet (meer)." });
            }
            const date = String(offeredShift.date);
            // Alleen actieve chauffeurs in de naam-index: een gepauzeerd oud
            // account met dezelfde naam liet de sleutel wegvallen, waardoor de
            // overname met "staat niets in de planning" werd geweigerd terwijl
            // /api/availability de collega wél aanbood (controle-ronde 27-08,
            // bevinding 23; zelfde regel als /api/planning-presence).
            const actieveChauffeurs = usersForTakeover.filter((u: any) => u?.role === "chauffeur" && u?.isActive !== false);
            const code = matrixCodesForDate(matrixRows, actieveChauffeurs, date).get(targetId);
            if (!isTakeoverCode(code)) {
              const naam = usersForTakeover.find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
              return res.status(409).json({
                error: code
                  ? `${naam} staat op ${DAG_DMJ(date)} ingepland als '${code}'. Ruilen zonder tegenprestatie kan alleen als de collega die dag ${TAKEOVER_CODES.join("/")} staat.`
                  : `Voor ${naam} staat er op ${DAG_DMJ(date)} niets in de planning. Ruilen zonder tegenprestatie kan alleen als de collega die dag ${TAKEOVER_CODES.join("/")} staat.`,
              });
            }
            // Dubbelcheck op de planning zelf: de matrix is de bron van de
            // codes, maar een handmatig toegevoegde dienst staat er niet in.
            const monthShifts = await getPlanningData({ monthIso: date.slice(0, 7) });
            if (monthShifts.some((s: any) => String(s.driverId) === targetId && String(s.date) === date)) {
              const naam = usersForTakeover.find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
              return res.status(409).json({ error: `${naam} heeft op ${DAG_DMJ(date)} toch een dienst in de planning staan, ruilen zonder tegenprestatie kan dan niet.` });
            }
          }
        }
      }

      // Afwezigheids-check voor élke nieuwe ruil (1-op-1 én overname): de
      // verlofmodule is sinds de ziek-melden-knop een eigen bron naast de
      // matrix — wie dáár ziek of met verlof gemeld staat, staat in de Excel
      // vaak nog gewoon op 'vrij'. In beide richtingen (collega op de dienstdag,
      // aanvrager op de terugruil-dag) — zie ruilAfwezigheidsFout.
      {
        const nieuweRuilen = recordsToWrite.filter((n: any) => !previousById.has(String(n.id)));
        for (const next of nieuweRuilen) {
          // Ontbrekende shift/target vangen de bestaande checks hierboven al af.
          const offeredShift = await getShiftById(String(next.shiftId ?? ""));
          const fout = await ruilAfwezigheidsFout({ ...next, shiftDate: offeredShift?.date });
          if (fout) return res.status(409).json({ error: fout });
        }
      }

      // Het ruiltype ligt vast bij het indienen. Bestaande records erven dus
      // altijd het opgeslagen type: een client die het veld niet meestuurt
      // (oudere bundel uit de PWA-cache) mag een overname niet stil naar een
      // 1-op-1 ruil omzetten. shift_date/shift_line komen NOOIT van de client:
      // nieuw = server-side uit de planning-rij, bestaand = opgeslagen waarde —
      // dit is de sleutel voor de automatische planning-doorvoer hieronder.
      const finalRecords: any[] = [];
      for (const rauw of recordsToWrite) {
        // Alleen de bekende camelCase-velden gaan door. saveSwapsData haalt de
        // records door toPublicSwap, en die valt voor élk veld terug op de
        // snake_case-databasekolom (target_seen_at, decidedat, ...). Een client
        // die zo'n alias meestuurde omzeilde daarmee de server-overrides
        // hieronder: targetSeenAt werd wel op prev gezet, maar target_seen_at
        // bleef in de spread staan en werd alsnog de Gezien-bevestiging
        // (security-audit 07-09, bevinding 4).
        const n = stripSwapAliassen(rauw);
        const prev = previousById.get(String(n.id));
        let shiftDate = prev?.shiftDate;
        let shiftLine = prev?.shiftLine;
        if (!prev) {
          const offeredShift = await getShiftById(String(n.shiftId ?? ""));
          shiftDate = offeredShift?.date || undefined;
          shiftLine = offeredShift?.line || undefined;
        }
        // Zodra de collega heeft ingestemd (status niet meer 'pending') liggen
        // de vóórwaarden van de ruil vast — alleen status en beslismoment mogen
        // daarna nog wijzigen.
        //
        // Zonder deze bevriezing kon een planner een geaccepteerde ruil eerst
        // inhoudelijk herschrijven (andere collega, andere tegenprestatie) en
        // hem dan goedkeuren. Geen enkele guard hield dat tegen — er wordt geen
        // 'accepted' geschreven en er is geen pending → approved-sprong —
        // terwijl de doorvoer wél de gewijzigde voorwaarden uitvoert en de log
        // "Dienstruil goedgekeurd" noteert alsof de collega daarmee instemde.
        const bevroren = prev && String(prev.status) !== "pending"
          ? {
              shiftId: prev.shiftId,
              requesterId: prev.requesterId,
              targetDriverId: prev.targetDriverId,
              returnDate: prev.returnDate,
              returnCode: prev.returnCode,
              // Ook reason en createdAt liggen vast: de reden draagt bij een
              // handmatige admin-wissel de attributie ("Handmatige wissel door
              // …") — herschrijfbaar laten zou een planner de zichtbare
              // uitvoerder laten wegpoetsen. Het chauffeur-pad bevroor deze
              // velden al (immutable-lijst in de accepteer-tak).
              reason: prev.reason,
              createdAt: prev.createdAt,
            }
          : {};
        // decidedAt server-gezaghebbend (spiegel van de PATCH-route): een reeds
        // besliste ruil behoudt zijn oorspronkelijke tijdstip (niet herschrijfbaar
        // via een latere array-save), een verse beslissing krijgt het servertijd-
        // stip, en 'accepted'/ongewijzigd 'pending' hebben geen beslismoment.
        const wasBeslist = prev && String(prev.status) !== "pending" && String(prev.status) !== "accepted";
        const wordtBeslist = String(n.status) !== "pending" && String(n.status) !== "accepted";
        const decidedAtDef = wasBeslist
          ? prev!.decidedAt
          : (wordtBeslist ? new Date().toISOString() : (prev?.decidedAt ?? undefined));
        finalRecords.push({
          ...n,
          ...bevroren,
          swapType: normalizeSwapType(prev ? prev.swapType : n.swapType),
          shiftDate,
          shiftLine,
          decidedAt: decidedAtDef,
          // Gezien-bevestiging is nooit client-schrijfbaar via deze route: de
          // opgeslagen waarde wint altijd (nieuw record = nog niet bevestigd).
          targetSeenAt: prev?.targetSeenAt,
        });
      }

      // Planning-doorvoer VÓÓR de save — zelfde reden als bij PATCH /api/swaps/:id:
      // movePlanningRows filtert op de huidige eigenaar en is dus idempotent, dus
      // een herhaalde poging is ongevaarlijk. Faalt de doorvoer halverwege, dan
      // is de status nog niet gewijzigd en kan de planner het gewoon opnieuw
      // proberen — voorheen bleef er een halve wissel achter bij een ruil die al
      // op 'approved' stond. Blijft best-effort: 0 verplaatste rijen (dienst
      // handmatig verlegd) blokkeert de beslissing niet, maar komt in de log.
      //
      // Terugdraaien bij annuleren én afwijzen; 'completed' laat de wissel staan.
      const carryLogById = new Map<string, string>();
      for (const next of finalRecords) {
        const prev = previousById.get(String(next.id));
        if (!prev || prev.status === next.status) continue;
        if (next.status === "approved") {
          if (alDoorgevoerdIds.has(String(next.id))) {
            carryLogById.set(String(next.id), "wissel stond al in de planning (herstel na een eerdere halve doorvoer)");
            continue;
          }
          const r = await applySwapToPlanning(next);
          // Concurrency-vangnet: 0 verplaatste rijen mét dienst-info betekent
          // dat de planning tussen de hercheck en de doorvoer nog wijzigde
          // (bv. een gelijktijdige admin-wissel). Dan NIET half goedkeuren met
          // enkel een logwaarschuwing — weigeren, zodat de planner met verse
          // data opnieuw beoordeelt. r === null (legacy zonder dienst-info)
          // houdt het oude waarschuw-gedrag.
          if (r && r.offeredMoved === 0) {
            return res.status(409).json({ error: "De planning is intussen gewijzigd, de dienst staat niet meer op naam van de aanvrager. Vernieuw de pagina en beoordeel opnieuw." });
          }
          carryLogById.set(String(next.id), describeSwapCarry(next, r, "doorgevoerd"));
        } else if (next.status === "cancelled" || next.status === "rejected") {
          // Terugdraaien vanuit 'approved', en bij afwijzen ook een halve
          // doorvoer (planning gewisseld zonder opgeslagen status).
          const terug = prev.status === "approved"
            || (next.status === "rejected" && (await swapToestandInPlanning(prev)) === "doorgevoerd");
          if (terug) {
            const r = await revertSwapFromPlanning(next);
            carryLogById.set(String(next.id), describeSwapCarry(next, r, "teruggedraaid"));
          }
        }
      }

      await saveSwapsData(finalRecords, swapIdsToDelete, { alleenPending: !isStafRol(req.appUser!.role) });

      // Activity log: detecteer state-overgangen en nieuwe aanvragen. Over
      // recordsToWrite zodat een niet-weggeschreven echo geen spookmelding geeft.
      const usersForLog = await getUsersData();
      const userName = (id: string) => usersForLog.find((u) => String(u.id) === String(id))?.name || `Onbekende gebruiker (${id})`;

      // Verwijderde ruilen laten anders geen enkel spoor na: een intrekking door
      // de aanvrager is legitiem, maar een staflid dat een geaccepteerde aanvraag
      // stil weggooit hoort zichtbaar te zijn (verlof logt dit al wél).
      for (const id of swapIdsToDelete) {
        const weg = previousById.get(String(id));
        if (!weg) continue;
        await logActivity(
          req,
          "swaps",
          "Dienstruil verwijderd",
          `${userName(String(weg.requesterId))}, dienstruil verwijderd (status ${weg.status}).`,
          { type: "swap", id: String(id) },
        );
      }
      for (const next of finalRecords) {
        const prev = previousById.get(String(next.id));
        if (!prev) {
          const isTakeover = normalizeSwapType(next.swapType) === "overname";
          await logActivity(
            req,
            "swaps",
            "Dienstruil aangevraagd",
            isTakeover
              ? `${userName(next.requesterId)} bood een dienst aan ter overname (zonder tegenprestatie).`
              : `${userName(next.requesterId)} bood een dienst aan voor ruil.`,
            { type: "swap", id: next.id },
          );
          // De aangezochte collega krijgt direct een seintje.
          if (next.targetDriverId) {
            await sendPushToUsers([String(next.targetDriverId)], {
              title: isTakeover ? "Vraag om een dienst over te nemen" : "Nieuwe dienstruil-aanvraag",
              soort: "ruil",
              body: isTakeover
                ? `${userName(next.requesterId)} vraagt of je een dienst wil overnemen, zonder tegenprestatie.`
                : `${userName(next.requesterId)} wil een dienst met je ruilen.`,
              url: recordUrl("ruil-verzoeken", next.id),
            });
          }
          continue;
        }
        if (prev.status !== next.status && next.status !== "pending") {
          let action: string | null = null;
          if (next.status === "accepted") action = "Dienstruil geaccepteerd";
          else if (next.status === "approved") action = "Dienstruil goedgekeurd";
          else if (next.status === "rejected") action = "Dienstruil afgewezen";
          else if (next.status === "cancelled") action = "Dienstruil geannuleerd";
          else if (next.status === "completed") action = "Dienstruil voltooid";
          if (action) {
            const carry = carryLogById.get(String(next.id));
            await logActivity(req, "swaps", action, `${userName(next.requesterId)}, dienstruil (${prev.status} → ${next.status}).${carry ? ` ${carry}` : ""}`, { type: "swap", id: next.id });
            // Push naar de betrokkenen, behalve degene die de actie deed. Een
            // afhandeling ('completed') is boekhouding van de planning en gaat
            // stil, zie de delta-route.
            const actorId = String(req.appUser?.id ?? "");
            const betrokkenen = next.status === "completed" ? [] : [String(prev.requesterId), String(prev.targetDriverId ?? "")]
              .filter((id) => id && id !== actorId);
            await sendPushToUsers(betrokkenen, {
              title: action,
              soort: "ruil",
              body: next.status === "accepted"
                ? `${userName(String(prev.targetDriverId ?? ""))} accepteerde de ruil, wacht op goedkeuring van de planner.`
                : `Dienstruil van ${userName(next.requesterId)}: ${prev.status} → ${next.status}.`,
              url: recordUrl("ruil-verzoeken", next.id),
            });
            // Geaccepteerd = er wacht een validatie op de planner — die kreeg
            // hier tot nu toe geen seintje van. Beslissers pushen (behalve de
            // actor zelf, als die toevallig planner/admin is).
            if (next.status === "accepted") {
              const beslissers = usersForLog
                .filter((u) => isActieveStaf(u) && String(u.id) !== actorId)
                .map((u) => String(u.id));
              await sendPushToUsers(beslissers, {
                title: "Dienstruil wacht op validatie",
                soort: "ruil",
                body: `${userName(String(prev.targetDriverId ?? ""))} accepteerde de ruil van ${userName(next.requesterId)}, rij- en rusttijden checken.`,
                url: recordUrl("ruil-verzoeken", next.id),
              });
              await meldRuilTerValidatieTelegram({
                id: String(next.id),
                omschrijving: `${userName(String(prev.targetDriverId ?? ""))} accepteerde de ruil van ${userName(next.requesterId)}${next.shiftLine ? `, dienst ${next.shiftLine} op ${next.shiftDate ? DAG_KORT(String(next.shiftDate)) : "?"}` : ""}.`,
              });
            }
          }
        }
      }

      // Verse revisie zodat een direct volgende save van dezelfde sessie geen
      // vals 409 krijgt ("gewijzigd door iemand anders" = je eigen save).
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getSwapsData()));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Dienstruil opslaan is mislukt.", err);
      res.status(500).json({ error: "Dienstruil opslaan is mislukt." });
    }
  });

  app.patch("/api/swaps/:id", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const status = String(req.body?.status ?? "");
      // Verplicht: zonder ifStatus is er géén concurrency-guard en geldt stil
      // last-write-wins — precies het gat dat deze route moest dichten.
      const ifStatus = req.body?.ifStatus ? String(req.body.ifStatus) : null;
      if (!ifStatus) {
        return res.status(400).json({ error: "ifStatus ontbreekt: stuur de status waarop je beslissing gebaseerd is mee." });
      }
      const uit = await beslisRuilIntern({
        id,
        status,
        ifStatus,
        actor: { id: String(req.appUser!.id), name: req.appUser!.name || "Planning", role: req.appUser!.role as "chauffeur" | "planner" | "admin" },
      });
      if ("fout" in uit) {
        return res.status(uit.fout.status).json({ error: uit.fout.error, ...(uit.fout.currentStatus ? { currentStatus: uit.fout.currentStatus } : {}) });
      }

      // Verse collectie-revisie meegeven zodat een volgende array-save van
      // dezelfde client geen vals 409 krijgt na deze delta-wijziging.
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getSwapsData()));
      // De client voegt dit record lokaal in zonder de lijst opnieuw te halen:
      // het verloop moet dus mee, anders toont het blok per persoon de nieuwe
      // status zonder moment en zonder wie besliste.
      const stafKijker = isStafRol(req.appUser!.role);
      const [metVerloop] = await metRuilRust(await metRuilVerloop([uit.swap], stafKijker), stafKijker, String(req.appUser!.id));
      res.json({ success: true, swap: metVerloop });
    } catch (err: any) {
      console.error("Beslissing opslaan is mislukt", err);
      res.status(500).json({ error: "Beslissing opslaan is mislukt" });
    }
  });

  // --- Handmatige dienstwissel door een admin ---------------------------------
  //
  // Voor uitzonderlijke situaties (ziekte, mondeling afgesproken ruil, andere
  // correctie): een admin zet een ingeplande dienst rechtstreeks op naam van een
  // andere chauffeur, zonder de aanvraag/acceptatie-flow. Bewust géén eigen
  // tabel: de wissel wordt opgeslagen als direct goedgekeurde 'overname' in
  // swaps — daardoor liften de heropbouw-replay (reapplyApprovedSwaps), de
  // maandplanning-overlay en de ruil-historiek gratis mee en kan een volgende
  // Excel-import de wissel niet stil terugdraaien.
  app.post("/api/admin/shift-swap", authenticate, requireRole("admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const date = String(req.body?.date ?? "").trim();
      const line = String(req.body?.line ?? "").trim();
      const fromDriverId = String(req.body?.fromDriverId ?? "").trim();
      const toDriverId = String(req.body?.toDriverId ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim();
      // Optioneel (Jarno 14-09): de dienst die de nieuwe chauffeur diezelfde dag
      // al rijdt en die in ruil naar de huidige chauffeur gaat. Zonder
      // returnLine blijft het een overname naar iemand die die dag vrij is.
      const returnLine = String(req.body?.returnLine ?? "").trim();

      if (!ISO_DAY_RE.test(date)) return res.status(400).json({ error: "Ongeldige datum (JJJJ-MM-DD verwacht)." });
      if (!line) return res.status(400).json({ error: "Geen dienstnummer meegegeven." });
      if (!fromDriverId || !toDriverId) return res.status(400).json({ error: "Kies de huidige én de nieuwe chauffeur." });
      if (fromDriverId === toDriverId) return res.status(400).json({ error: "De nieuwe chauffeur is dezelfde als de huidige, er valt niets te wisselen." });
      if (!reason) return res.status(400).json({ error: "Geef een reden op voor de wissel." });
      if (reason.length > 280) return res.status(400).json({ error: "De reden is te lang (maximaal 280 tekens)." });

      const users = await getUsersData();
      const fromUser = users.find((u) => String(u.id) === fromDriverId);
      const toUser = users.find((u) => String(u.id) === toDriverId);
      if (!fromUser) return res.status(400).json({ error: "De huidige chauffeur bestaat niet (meer)." });
      if (!toUser || toUser.isActive === false) return res.status(400).json({ error: "De gekozen chauffeur bestaat niet (meer) of is inactief." });

      // Eigendom: de dienst moet op dit moment écht op naam van de huidige
      // chauffeur staan (zelfde principe als staleApprovalError — tussen openen
      // van het scherm en bevestigen kan de planning gewijzigd zijn).
      const dayRows = await getShiftsOnDate(date);
      // Genormaliseerd vergelijken: de maandplanning-cel stuurt de rúwe
      // Excel-code mee ("R12"), planning.line bevat het canonieke
      // dienstnummer ("r12"). Exact vergelijken liet zulke diensten altijd
      // op 409 stranden.
      const lineToken = toLookupToken(line);
      const ownRows = dayRows.filter((r) => toLookupToken(r.line) === lineToken && String(r.driverId) === fromDriverId);
      if (ownRows.length === 0) {
        return res.status(409).json({ error: `Dienst ${line} op ${DAG_DMJ(date)} staat niet (meer) op naam van ${fromUser.name}, de planning is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.` });
      }
      // Vanaf hier de schrijfwijze uit de planning zelf: die gaat de swap in en
      // stuurt de doorvoer (movePlanningRows matcht exact op line).
      const dienstLine = String(ownRows[0].line);

      // Planningsconflict: de nieuwe chauffeur rijdt die dag al een dienst.
      // Zonder returnLine is dat een fout (dubbele inplanning); mét returnLine
      // is het juist de bedoeling: beide chauffeurs staan ingepland en wisselen
      // hun diensten 1-op-1 (Jarno 14-09).
      const returnToken = toLookupToken(returnLine);
      const toRows = dayRows.filter((r) => String(r.driverId) === toDriverId);
      let terugLine: string | null = null;
      if (returnLine) {
        if (returnToken === lineToken) return res.status(400).json({ error: "De terugdienst is dezelfde als de dienst die je overzet." });
        const terugRow = toRows.find((r) => toLookupToken(r.line) === returnToken);
        if (!terugRow) {
          return res.status(409).json({ error: `${toUser.name} rijdt op ${DAG_DMJ(date)} geen dienst ${returnLine} (meer), de planning is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.` });
        }
        terugLine = String(terugRow.line);
        // De gever moet die dag zelf kunnen rijden: op een afwezigheidscel
        // (ziek, verlof) zet je een dienst wég, je haalt er geen bij.
        const andereVanGever = dayRows.find((r) => String(r.driverId) === fromDriverId && toLookupToken(r.line) !== lineToken);
        if (andereVanGever) {
          return res.status(409).json({ error: `${fromUser.name} rijdt op ${date} ook dienst ${andereVanGever.line}, de terugdienst zou een dubbele inplanning geven. Zet die dienst eerst weg.` });
        }
      } else {
        const conflictRow = toRows[0];
        if (conflictRow) {
          return res.status(409).json({ error: `${toUser.name} rijdt op ${date} al dienst ${conflictRow.line}, deze wissel zou een dubbele inplanning geven. Zet die dienst eerst weg, kies iemand anders, of wissel de twee diensten 1-op-1.` });
        }
      }

      // Afwezigheid: wie ziek of met verlof gemeld is, krijgt geen dienst
      // toegeschoven (zelfde check als bij het goedkeuren van een ruil). Bij
      // een 1-op-1-wissel geldt dat voor béíde chauffeurs.
      const afwFout = await ruilAfwezigheidsFout(terugLine
        ? { requesterId: fromDriverId, targetDriverId: toDriverId, swapType: "ruil", shiftDate: date, returnDate: date, returnCode: terugLine }
        : { requesterId: fromDriverId, targetDriverId: toDriverId, swapType: "overname", shiftDate: date });
      if (afwFout) return res.status(409).json({ error: afwFout });

      // Een openstaande ruilaanvraag op dezelfde dienst zou door deze wissel
      // stale worden (en bij goedkeuring niets meer verplaatsen) — eerst
      // afhandelen. Beide kanten van een 1-op-1 ruil tellen: staat deze dienst
      // als TEGENPRESTATIE in een open ruil, dan verhuist bij goedkeuring wel de
      // aangeboden dienst maar niet de terugruil — de aanvrager levert dan in
      // zonder iets terug te krijgen, en de replay reproduceert die halve staat.
      const allSwaps = await getSwapsData();
      const zelfdeDienst = (d?: unknown, l?: unknown) =>
        String(d ?? "") === date && !!String(l ?? "").trim() && toLookupToken(String(l ?? "")) === lineToken;
      const zelfdeTerugDienst = (d?: unknown, l?: unknown) =>
        !!terugLine && String(d ?? "") === date && !!String(l ?? "").trim() && toLookupToken(String(l ?? "")) === returnToken;
      const openSwap = allSwaps.find((s) =>
        (s.status === "pending" || s.status === "accepted") &&
        (zelfdeDienst(s.shiftDate, s.shiftLine) ||
          zelfdeDienst(s.returnDate, s.returnCode) ||
          zelfdeTerugDienst(s.shiftDate, s.shiftLine) ||
          zelfdeTerugDienst(s.returnDate, s.returnCode) ||
          ownRows.some((r) => String(r.id) === String(s.shiftId)) ||
          toRows.some((r) => String(r.id) === String(s.shiftId))));
      if (openSwap) {
        return res.status(409).json({ error: "Voor deze dienst loopt nog een ruilaanvraag. Handel die eerst af (goedkeuren, afwijzen of laten intrekken) en probeer daarna opnieuw." });
      }

      const nu = new Date().toISOString();
      const swap = {
        id: crypto.randomUUID(),
        shiftId: String(ownRows[0].id),
        requesterId: fromDriverId,
        targetDriverId: toDriverId,
        status: "approved" as const,
        createdAt: nu,
        decidedAt: nu,
        // 1-op-1 op dezelfde dag = een gewone 'ruil' met de terugdienst op de
        // dienstdag; doorvoer, terugdraaien en replay kennen die vorm al.
        swapType: (terugLine ? "ruil" : "overname") as "ruil" | "overname",
        shiftDate: date,
        shiftLine: dienstLine,
        ...(terugLine ? { returnDate: date, returnCode: terugLine } : {}),
        reason: `${HANDMATIGE_WISSEL_PREFIX}${req.appUser?.name ?? "admin"}, ${reason}`,
      };

      // Doorvoer VÓÓR het opslaan (zelfde volgorde en motivatie als bij het
      // goedkeuren van een ruil): mislukt de verplaatsing, dan bestaat er ook
      // geen swap-record dat de replay later alsnog zou toepassen.
      const carryResult = await applySwapToPlanning(swap);
      if (!carryResult || carryResult.offeredMoved === 0) {
        return res.status(409).json({ error: "De dienst kon niet verplaatst worden, de planning is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw." });
      }
      if (terugLine && !carryResult.returnMoved) {
        // Halve wissel: de aangeboden dienst is al verhuisd, de terugdienst
        // niet. Terugdraaien en melden, anders staat de gever zonder dienst.
        await revertSwapFromPlanning({ ...swap, swapType: "overname", returnDate: undefined, returnCode: undefined });
        return res.status(409).json({ error: `Dienst ${terugLine} van ${toUser.name} kon niet verplaatst worden, de planning is intussen gewijzigd. Er is niets gewisseld. Vernieuw de pagina en probeer opnieuw.` });
      }
      await saveSwapsData([swap], []);

      const carry = describeSwapCarry(swap, carryResult, "doorgevoerd");
      await logActivity(
        req,
        "swaps",
        terugLine ? "Diensten handmatig gewisseld" : "Dienst handmatig overgezet",
        terugLine
          ? `${fromUser.name} ⇄ ${toUser.name} op ${DAG_DMJ(date)}: dienst ${dienstLine} naar ${toUser.name}, dienst ${terugLine} naar ${fromUser.name}. Reden: ${reason}. ${carry}`
          : `${fromUser.name} → ${toUser.name}, dienst ${dienstLine} op ${DAG_DMJ(date)}. Reden: ${reason}. ${carry}`,
        { type: "swap", id: swap.id },
      );

      await sendPushToUsers([fromDriverId, toDriverId], {
        title: "Planning aangepast",
        soort: "planning",
        body: terugLine
          ? `Op ${DAG_DMJ(date)} zijn de diensten gewisseld: ${toUser.name} rijdt dienst ${dienstLine}, ${fromUser.name} rijdt dienst ${terugLine}. Reden: ${reason}.`
          : `Dienst ${dienstLine} op ${DAG_DMJ(date)} is overgezet van ${fromUser.name} naar ${toUser.name}. Reden: ${reason}.`,
        url: viewUrl("rooster"),
      });

      // Verse collectie-revisie zodat een volgende array-save van dezelfde
      // client geen vals 409 krijgt (zelfde patroon als PATCH /api/swaps/:id).
      res.setHeader(COLLECTION_REVISION_HEADER, revisionOf(await getSwapsData()));
      res.json({ success: true, swap, carry });
    } catch (err) {
      console.error("Handmatige dienstwissel is mislukt.", err);
      res.status(500).json({ error: "Handmatige dienstwissel is mislukt." });
    }
  });

  // --- Gezien-bevestiging op een doorgevoerde wissel --------------------------
  //
  // Push bereikt vrijwel niemand; hiermee weet de planner of de nieuwe rijder
  // de wijziging echt gezien heeft. Alleen de ontvanger zelf mag bevestigen,
  // en alleen op een doorgevoerde wissel (approved/completed).
  app.post("/api/swaps/:id/gezien", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id ?? "");
      const swap = (await getSwapsData()).find((s) => String(s.id) === id);
      if (!swap) return res.status(404).json({ error: "Deze dienstruil bestaat niet (meer)." });
      if (String(swap.targetDriverId ?? "") !== String(req.appUser?.id)) {
        return res.status(403).json({ error: "Alleen de chauffeur die de dienst overneemt kan bevestigen." });
      }
      if (swap.status !== "approved" && swap.status !== "completed") {
        return res.status(409).json({ error: "Deze wissel is (nog) niet doorgevoerd, er valt niets te bevestigen." });
      }
      if (!swap.targetSeenAt) {
        const nu = new Date().toISOString();
        await markSwapTargetSeen(id, nu);
        await logActivity(
          req,
          "swaps",
          "Dienstwissel bevestigd",
          `${req.appUser?.name ?? "Chauffeur"} bevestigde de overgenomen dienst${swap.shiftLine ? ` ${swap.shiftLine}` : ""}${swap.shiftDate ? ` op ${swap.shiftDate}` : ""}.`,
          { type: "swap", id },
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Bevestigen van de dienstwissel is mislukt.", err);
      res.status(500).json({ error: "Bevestigen is mislukt." });
    }
  });

  // --- Aanvraag bekeken door de aangezochte collega ---------------------------
  //
  // Iets anders dan /gezien hierboven. Dáár bevestigt de nieuwe rijder een
  // DOORGEVOERDE wissel (knop, `target_seen_at`). Hier registreert de server dat
  // de aangezochte collega een nog ONBEANTWOORDE aanvraag in beeld kreeg, zodat
  // de aanvrager en de planning in het verloop "Bekeken, nog geen antwoord"
  // lezen i.p.v. te moeten gissen (Jarno 20-09). Geen kolom en geen migratie:
  // één logregel per ruil, de bron van het verloop (shared/ruilVerloop.ts).
  //
  // Alleen de collega van díe ruil, alleen zolang ze 'pending' is; al het andere
  // schrijft niets. De lezing is op de aanroeper gescoped, dus een derde of een
  // planner die niet in de ruil zit krijgt dezelfde 403 als bij een onbestaand
  // id. Idempotent: staat de regel er al, dan komt er geen tweede. Het schrijfblok
  // van de onderhoudsmodus en de rate-limit gelden zoals voor elke POST.
  app.post("/api/swaps/:id/bekeken", authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id ?? "");
      const selfId = String(req.appUser?.id ?? "");
      const swap = (await getSwapsData({ betrokkenUserId: selfId })).find((s) => String(s.id) === id);
      if (!swap || String(swap.targetDriverId ?? "") !== selfId) {
        return res.status(403).json({ error: "Alleen de collega aan wie de ruil gevraagd is, kan ze als bekeken melden." });
      }
      if (swap.status !== "pending") {
        return res.status(409).json({ error: "Deze dienstruil wacht niet meer op een antwoord.", currentStatus: swap.status });
      }
      const regels = (await getSwapVerloopRegels([id]))[id] ?? [];
      if (regels.some((r) => r.action === RUIL_BEKEKEN_ACTIE)) {
        return res.json({ success: true, nieuw: false });
      }
      await logActivity(
        req,
        "swaps",
        "Dienstruil bekeken",
        `${req.appUser?.name ?? "Chauffeur"} bekeek de aanvraag${swap.shiftLine ? ` voor dienst ${swap.shiftLine}` : ""}${swap.shiftDate ? ` op ${DAG_DMJ(String(swap.shiftDate))}` : ""}.`,
        { type: "swap", id },
      );
      res.json({ success: true, nieuw: true });
    } catch (err) {
      console.error("Bekeken-registratie van de dienstruil is mislukt.", err);
      res.status(500).json({ error: "Registreren is mislukt." });
    }
  });
}
