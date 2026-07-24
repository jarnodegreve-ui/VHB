import type { ShiftRecord, SwapRecord, AppUser } from "../types.js";

/**
 * Ruil-overlay: goedgekeurde dienstruilen als wéérgave-laag over de planning.
 *
 * De Excel-import blijft de bron van waarheid — een goedgekeurde ruil wordt
 * bewust nergens in de data doorgevoerd (de eerstvolgende import zou dat toch
 * overschrijven). Deze module berekent welke ruilen "actief" zijn (status
 * 'approved' én beslist ná de laatste matrix-import) en past ze puur bij het
 * tonen toe: in het rooster, de maandplanning en de agenda-feed. Zodra de
 * planner een nieuwe Excel importeert (waarin de ruil verwerkt hoort te zijn)
 * valt de overlay vanzelf weg — zelfde venster als het paneel "Wijzigingen
 * sinds laatste import" in Beheer Roosters.
 *
 * Pure functies, geen I/O — de endpoints leveren de data aan.
 */

export type SwapOverlayEntry = {
  swapId: string;
  /** De geruilde dienst (shift-id + datum) … */
  shiftId: string;
  date: string;
  /** … gaat van de aanvrager … */
  fromDriverId: string;
  fromName: string;
  /** … naar de collega. */
  toDriverId: string;
  toName: string;
  /** Terugruil: de dienst van de collega die de aanvrager overneemt (indien gevonden). */
  returnShiftId?: string;
  returnDate?: string;
  returnCode?: string;
};

export type OverlayMatrixCell = {
  code: string;
  kind: string;
  label: string;
  segments: string[];
  /** Aanwezig wanneer deze cel door een actieve ruil bij deze chauffeur staat. */
  swap?: { with: string };
};

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/**
 * Bepaalt de actieve overlay-entries. `lastImportAt` is het tijdstip van de
 * laatste matrix-import: alleen ruilen die dáárna zijn goedgekeurd tellen mee
 * (oudere horen al in de geïmporteerde planning verwerkt te zijn).
 */
export const resolveActiveSwapOverlays = (
  swaps: SwapRecord[],
  shifts: ShiftRecord[],
  users: Pick<AppUser, "id" | "name">[],
  lastImportAt: string,
): SwapOverlayEntry[] => {
  const shiftById = new Map(shifts.map((s) => [String(s.id), s]));
  const nameOf = (id: unknown): string =>
    users.find((u) => String(u.id) === String(id))?.name || "collega";

  const out: SwapOverlayEntry[] = [];
  for (const swap of swaps) {
    if (swap.status !== "approved") continue;
    if (!swap.decidedAt || swap.decidedAt <= lastImportAt) continue;
    if (!swap.targetDriverId) continue;
    // Dienst kan intussen vervangen zijn (bv. JSON-herstel) — dan geen overlay.
    const shift = shiftById.get(String(swap.shiftId));
    if (!shift) continue;

    // Terugruil-dienst van de collega opzoeken (alleen bij een echte dienst-
    // code; 'vrij' heeft geen shift). Match op chauffeur + datum + dienstnr.
    let returnShiftId: string | undefined;
    if (swap.returnDate && swap.returnCode && norm(swap.returnCode) !== "vrij") {
      const ret = shifts.find(
        (s) =>
          String(s.driverId) === String(swap.targetDriverId) &&
          String(s.date) === String(swap.returnDate) &&
          norm(s.line) === norm(swap.returnCode),
      );
      if (ret) returnShiftId = String(ret.id);
    }

    out.push({
      swapId: String(swap.id),
      shiftId: String(shift.id),
      date: String(shift.date),
      fromDriverId: String(shift.driverId),
      fromName: nameOf(shift.driverId),
      toDriverId: String(swap.targetDriverId),
      toName: nameOf(swap.targetDriverId),
      returnShiftId,
      returnDate: swap.returnDate,
      returnCode: swap.returnCode,
    });
  }
  return out;
};

/**
 * Past de overlay toe op een lijst diensten: de geruilde dienst verhuist naar
 * de collega, de terugruil-dienst (indien gevonden) naar de aanvrager. Levert
 * kopieën met `swappedWith` (naam van de andere partij) — de invoer blijft
 * onaangeroerd zodat de rauwe collectie nooit per ongeluk overlaid opgeslagen
 * kan worden.
 */
export const applyOverlayToShifts = <T extends { id: unknown; driverId: unknown }>(
  shifts: T[],
  overlays: SwapOverlayEntry[],
): Array<T & { swappedWith?: string }> => {
  if (overlays.length === 0) return shifts;
  const bySwapShift = new Map(overlays.map((o) => [o.shiftId, o]));
  const byReturnShift = new Map(
    overlays.filter((o) => o.returnShiftId).map((o) => [o.returnShiftId as string, o]),
  );
  return shifts.map((s) => {
    const o = bySwapShift.get(String(s.id));
    if (o) return { ...s, driverId: o.toDriverId, swappedWith: o.fromName };
    const r = byReturnShift.get(String(s.id));
    if (r) return { ...s, driverId: r.fromDriverId, swappedWith: r.toName };
    return s;
  });
};

/**
 * Past de overlay toe op de maandplanning-cellen (cells[driverId][datum]):
 * wisselt per actieve ruil de celinhoud van beide chauffeurs om op de
 * ruildag én de terugruildag, en markeert de verplaatste cellen met
 * `swap.with`. Muteert het meegegeven cells-object (dat per request vers
 * wordt opgebouwd).
 */
export const applyOverlayToMatrixCells = (
  cells: Record<string, Record<string, OverlayMatrixCell>>,
  overlays: SwapOverlayEntry[],
): void => {
  for (const o of overlays) {
    const dates = o.returnDate && o.returnDate !== o.date ? [o.date, o.returnDate] : [o.date];
    for (const date of dates) {
      const fromCell = cells[o.fromDriverId]?.[date];
      const toCell = cells[o.toDriverId]?.[date];
      if (!fromCell && !toCell) continue;
      if (fromCell) {
        (cells[o.toDriverId] ??= {})[date] = { ...fromCell, swap: { with: o.fromName } };
      } else if (cells[o.toDriverId]) {
        delete cells[o.toDriverId][date];
      }
      if (toCell) {
        (cells[o.fromDriverId] ??= {})[date] = { ...toCell, swap: { with: o.toName } };
      } else if (cells[o.fromDriverId]) {
        delete cells[o.fromDriverId][date];
      }
    }
  }
};
