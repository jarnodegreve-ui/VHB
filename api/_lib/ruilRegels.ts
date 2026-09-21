/**
 * Regels rond een dienstruil die meer dan één domein nodig heeft (ruil,
 * planning, systeem): wanneer een ruil afgesloten is, wat er bij het
 * doorvoeren gebeurde, en de controles op afwezigheid, dubbele inplanning en
 * verouderde goedkeuring. Stond tot 21-09 in api/index.ts.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { DAG_DMJ, toLookupToken, afwezigOp, normalizeSwapType } from "../helpers.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.
import { getLeaveData, getUsersData, getShiftById, getShiftsOnDate } from "../storage.js";
import { ISO_DAY_RE } from "./collectie.js";

// Afgehandelde ruil-statussen: hieruit is geen overgang meer toegestaan.
export const TERMINAL_SWAP_STATES = new Set(["rejected", "cancelled", "completed"]);

/** Leesbare activity-log-melding van een planning-doorvoer. `r` = resultaat
 *  van applySwapToPlanning/revertSwapFromPlanning; null = geen dienst-info op
 *  de swap (aanvraag van vóór de shift_info-migratie). */
export const describeSwapCarry = (
  swap: any,
  r: { offeredMoved: number; returnMoved: number | null } | null,
  richting: "doorgevoerd" | "teruggedraaid",
): string => {
  if (!r) {
    return "Planning NIET automatisch bijgewerkt (aanvraag zonder dienst-info), pas de planning handmatig aan.";
  }
  const delen: string[] = [];
  delen.push(
    r.offeredMoved > 0
      ? `dienst ${swap.shiftLine} op ${DAG_DMJ(swap.shiftDate)}: ${r.offeredMoved} rij(en) ${richting}`
      : `LET OP: dienst ${swap.shiftLine} op ${DAG_DMJ(swap.shiftDate)} niet gevonden in de planning, controleer handmatig`,
  );
  if (r.returnMoved !== null) {
    delen.push(
      r.returnMoved > 0
        ? `terugruil ${swap.returnCode} op ${DAG_DMJ(swap.returnDate)}: ${r.returnMoved} rij(en) ${richting}`
        : `LET OP: terugruil ${swap.returnCode} op ${DAG_DMJ(swap.returnDate)} niet gevonden, controleer handmatig`,
    );
  }
  return `Planning ${richting}: ${delen.join("; ")}.`;
};

/** Afwezigheids-check voor een dienstruil, in béíde richtingen: de collega
 *  moet er zijn op de dienstdag die hij overneemt, en bij een 1-op-1 ruil de
 *  aanvrager op de terugruil-dag. Wordt gebruikt bij het indienen én bij het
 *  goedkeuren — tussen die twee momenten kan iemand ziek gemeld zijn, en de
 *  check dekte voorheen alleen het indienen (en alleen de collega). Geeft een
 *  foutzin of null. */
const AFWEZIG_LABEL: Record<string, string> = { ziekte: "ziek gemeld", betaald_verlof: "met verlof", klein_verlet: "afwezig (klein verlet)" };

export const ruilAfwezigheidsFout = async (swap: {
  requesterId?: unknown; targetDriverId?: unknown; swapType?: unknown;
  shiftDate?: unknown; returnDate?: unknown; returnCode?: unknown;
}): Promise<string | null> => {
  const targetId = String(swap.targetDriverId ?? "").trim();
  const requesterId = String(swap.requesterId ?? "").trim();
  const dienstDag = String(swap.shiftDate ?? "").trim();
  const terugDag = String(swap.returnDate ?? "").trim();
  const terugCode = String(swap.returnCode ?? "").trim();
  const checks: Array<{ userId: string; date: string; wie: "collega" | "aanvrager" }> = [];
  if (targetId && dienstDag) checks.push({ userId: targetId, date: dienstDag, wie: "collega" });
  // Bij een overname of een 'vrij'-tegenprestatie rijdt de aanvrager niets terug.
  if (normalizeSwapType(swap.swapType) !== "overname" && requesterId && terugDag && terugCode && terugCode.toLowerCase() !== "vrij") {
    checks.push({ userId: requesterId, date: terugDag, wie: "aanvrager" });
  }
  if (checks.length === 0) return null;
  const vroegste = checks.map((c) => c.date).sort()[0];
  const [leave, users] = await Promise.all([getLeaveData({ endOnOrAfter: vroegste }), getUsersData()]);
  for (const c of checks) {
    const afwezig = afwezigOp(leave as any[], c.userId, c.date);
    if (afwezig) {
      const naam = users.find((u: any) => String(u.id) === c.userId)?.name ?? (c.wie === "collega" ? "De collega" : "De aanvrager");
      return `${naam} is ${AFWEZIG_LABEL[afwezig.type] ?? "afwezig gemeld"} op ${DAG_DMJ(c.date)}, deze ruil kan niet doorgaan.`;
    }
  }
  return null;
};

/** Dubbele inplanning bij het goedkeuren van een ruil: de collega mag op de
 *  dienstdag niet al een ándere dienst hebben. De overname-voorwaarde werd tot
 *  nu alleen bij het indienen getoetst (isTakeoverCode op de matrix); tussen
 *  accepteren en goedkeuren kan de collega intussen een dienst gekregen hebben
 *  — bijvoorbeeld via de handmatige admin-wissel, die zélf wél op conflicten
 *  controleert. Dan leverde de goedkeuring stil een dubbel ingeplande dag op.
 *
 *  Twee rijen tellen bewust NIET mee: de terugruil-dienst bij een 1-op-1 ruil
 *  op dezelfde dag (die verhuist in dezelfde beweging naar de aanvrager) en de
 *  aangeboden dienst zelf (al doorgevoerd → herhaling blijft idempotent). */
export const dubbeleInplanningFout = async (swap: {
  targetDriverId?: unknown; shiftDate?: unknown; shiftLine?: unknown;
  returnDate?: unknown; returnCode?: unknown; swapType?: unknown;
}): Promise<string | null> => {
  const targetId = String(swap.targetDriverId ?? "").trim();
  const dienstDag = String(swap.shiftDate ?? "").trim();
  // Legacy-ruil zonder dienst-info: niets te controleren (de doorvoer slaat
  // die sowieso over, met een waarschuwing in de log).
  if (!targetId || !ISO_DAY_RE.test(dienstDag)) return null;
  const terugCode = normalizeSwapType(swap.swapType) === "overname" ? "" : String(swap.returnCode ?? "").trim();
  const terugDag = String(swap.returnDate ?? "").trim();
  const aangeboden = toLookupToken(String(swap.shiftLine ?? ""));
  const rijen = await getShiftsOnDate(dienstDag);
  const bezet = rijen.filter((r) => {
    if (String(r.driverId) !== targetId) return false;
    const lijnToken = toLookupToken(r.line);
    if (aangeboden && lijnToken === aangeboden) return false;
    if (terugCode && terugDag === dienstDag && lijnToken === toLookupToken(terugCode)) return false;
    return true;
  });
  if (bezet.length === 0) return null;
  const naam = (await getUsersData()).find((u: any) => String(u.id) === targetId)?.name ?? "De collega";
  return `${naam} rijdt op ${DAG_DMJ(dienstDag)} al dienst ${bezet[0].line}, deze ruil zou een dubbele inplanning geven. Zet die dienst eerst weg.`;
};

/**
 * Exclusiviteit bij goedkeuren — vervangt de oude check "bestaat er al een
 * andere goedgekeurde ruil voor deze shiftId?".
 *
 * Die check keek naar de rij-id, en die blijft na een doorvoer de
 * oorspronkelijke chauffeur bevatten. Een tweede ruil op dezelfde shiftId is
 * dus géén dubbele goedkeuring maar een legitieme dóórgeef-ketting
 * (d1 → d2 → d3); de oude vorm blokkeerde die permanent.
 *
 * Wat we wél moeten tegenhouden is een STÁLE ruil: eentje waarvan de aanvrager
 * de dienst intussen niet meer heeft. Die zou bij goedkeuring 0 rijen
 * verplaatsen en alleen een waarschuwing in de log achterlaten — de planner
 * denkt dan dat de wissel doorgevoerd is.
 *
 * Staat de dienst helemaal niet meer in de planning (heropbouw, handmatig
 * verwijderd), dan valt eigendom niet te controleren. Daar vallen we terug op
 * de oude regel, maar enkel voor dezélfde aanvrager: twee goedgekeurde ruilen
 * waarin chauffeur X dezelfde dienst weggeeft kan nooit kloppen, terwijl een
 * ketting (X → Y → Z) juist verschillende aanvragers heeft.
 */
export const staleApprovalError = async (
  swap: { id?: unknown; shiftId?: unknown; requesterId?: unknown },
  allSwaps: Array<{ id?: unknown; shiftId?: unknown; requesterId?: unknown; status?: unknown }>,
): Promise<string | null> => {
  const shift = await getShiftById(String(swap?.shiftId ?? ""));
  if (shift) {
    return String(shift.driverId) === String(swap?.requesterId ?? "")
      ? null
      : "Deze dienst staat niet meer op naam van de aanvrager, de planning is intussen gewijzigd. Vernieuw de pagina en beoordeel opnieuw.";
  }
  const dubbelVanZelfdeAanvrager = allSwaps.some((s) =>
    String(s.id) !== String(swap?.id)
    && String(s.shiftId) === String(swap?.shiftId)
    && String(s.requesterId) === String(swap?.requesterId)
    && String(s.status) === "approved");
  return dubbelVanZelfdeAanvrager
    ? "Voor deze dienst is al een andere ruil van dezelfde chauffeur goedgekeurd."
    : null;
};
