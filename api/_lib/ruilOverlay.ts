import { isHandmatigeWissel, normalizeSwapType, toLookupToken } from "../helpers.js";
import type { SwapRecord } from "../types.js";

/**
 * Goedgekeurde dienstruilen over het maandbeeld leggen.
 *
 * Het maandbeeld komt uit de Excel-matrix, en die kent de ruilen uit het
 * portaal niet vanzelf. Per ruil (en per been van een 1-op-1-ruil) zijn er
 * drie situaties:
 *
 * 1. De Excel toont nog de oude eigenaar: de cellen van gever en ontvanger
 *    wisselen, met het merk {swapId, swapFrom, swapManual} op de verplaatste
 *    cel (bevinding Jarno 06-08).
 * 2. De planner heeft de ruil intussen óók in de Excel verwerkt, voorlopig
 *    de gangbare werkwijze (Jarno 12-09): de ontvanger heeft de dienst al.
 *    Vroeger bleef dan alles staan, dus verdween "geruild met X" bij de
 *    eerstvolgende import en zag de chauffeur een gewone dienst. Nu krijgt
 *    de cel van de ontvanger alleen het merk, zonder wisselen: dubbel
 *    doorvoeren blijft onmogelijk, de aanduiding blijft.
 * 3. Niemand heeft de dienst (intussen handmatig verlegd, of buiten het
 *    bereik): niets doen.
 *
 * Volgorde = beslisvolgorde (decidedAt), zodat kettingen (A→B, daarna B→C)
 * kloppen: de laatste ruil op een cel bepaalt het merk. 'completed' telt
 * mee, een voltooide ruil is gereden zoals gewisseld.
 */
export type OverlayCel = {
  code: string;
  kind: string;
  label: string;
  segments: string[];
  hiddenService?: string;
  swapId?: string;
  swapManual?: boolean;
  swapFrom?: string;
};

/** cellen[chauffeurId][isoDatum] */
export type OverlayCellen = Record<string, Record<string, OverlayCel>>;

export type OverlayRuil = Pick<
  SwapRecord,
  "id" | "requesterId" | "targetDriverId" | "status" | "decidedAt" | "shiftDate" | "shiftLine" | "returnDate" | "returnCode" | "swapType" | "reason"
>;

export type OverlayUitkomst = {
  /** Cellen gewisseld: de Excel kende de ruil nog niet. */
  gewisseld: number;
  /** Alleen gemarkeerd: de Excel had de ruil al verwerkt. */
  gemarkeerd: number;
  /** Niets gevonden om te wisselen of te markeren. */
  overgeslagen: number;
};

/** De cel van de gever na een wissel als de ontvanger geen dienst had: een
 *  expliciete “vrij”. De code van de ontvanger (ta, bv, tk, opl) is
 *  persoonlijk en verhuist niet mee (Jarno 14-09: een TA moet gewisseld
 *  kunnen worden en de gever wordt dan vrij, niet TA). */
export const VRIJ_CEL: OverlayCel = { code: "vrij", kind: "absence", label: "Geen dienst", segments: [] };

export function legRuilenOverMaandbeeld(
  cells: OverlayCellen,
  swaps: OverlayRuil[],
  opts: { dates: Iterable<string>; chauffeurIds: Set<string>; naamVanId: (id: string) => string; vrijCel?: OverlayCel },
): OverlayUitkomst {
  const dateSet = new Set(opts.dates);
  const uit: OverlayUitkomst = { gewisseld: 0, gemarkeerd: 0, overgeslagen: 0 };
  const vrijCel = opts.vrijCel ?? VRIJ_CEL;
  const toontCode = (cel: OverlayCel | undefined, code: string): cel is OverlayCel =>
    !!cel && toLookupToken(cel.code) === toLookupToken(code);

  const wisselCel = (
    date: string, vanId: string, naarId: string, verwachtCode: string,
    merk: { swapId: string; swapManual: boolean; swapFrom: string },
  ) => {
    const vanCel = cells[vanId]?.[date];
    const naarCel = cells[naarId]?.[date];
    if (toontCode(vanCel, verwachtCode)) {
      if (!cells[naarId]) cells[naarId] = {};
      cells[naarId][date] = { ...vanCel, ...merk };
      // Had de ontvanger zelf een dienst (1-op-1 op dezelfde dag), dan krijgt
      // de gever die; een afwezigheidscode van de ontvanger neemt hij niet
      // over, dan wordt hij vrij. Geen cel = blijft leeg.
      if (naarCel) cells[vanId][date] = naarCel.kind === "service" ? naarCel : { ...vrijCel };
      else delete cells[vanId][date];
      uit.gewisseld += 1;
      return;
    }
    if (toontCode(naarCel, verwachtCode)) {
      cells[naarId][date] = { ...naarCel, ...merk };
      uit.gemarkeerd += 1;
      return;
    }
    uit.overgeslagen += 1;
  };

  const doorgevoerd = swaps
    .filter((sw) => sw?.status === "approved" || sw?.status === "completed")
    .sort((a, b) => String(a.decidedAt ?? "").localeCompare(String(b.decidedAt ?? "")));

  for (const sw of doorgevoerd) {
    const van = String(sw.requesterId ?? "");
    const naar = String(sw.targetDriverId ?? "");
    if (!opts.chauffeurIds.has(van) || !opts.chauffeurIds.has(naar)) continue;
    const dienstDag = String(sw.shiftDate ?? "");
    const dienstCode = String(sw.shiftLine ?? "").trim();
    const merk = { swapId: String(sw.id), swapManual: isHandmatigeWissel(sw), swapFrom: opts.naamVanId(van) };
    // Zonder dienst-info (aanvraag van vóór de shift_info-migratie) valt er
    // niets veilig te wisselen of te markeren.
    if (dienstDag && dienstCode && dateSet.has(dienstDag)) wisselCel(dienstDag, van, naar, dienstCode, merk);
    const terugDag = String(sw.returnDate ?? "");
    const terugCode = String(sw.returnCode ?? "").trim();
    if (normalizeSwapType(sw.swapType) !== "overname" && terugDag && terugCode && terugCode.toLowerCase() !== "vrij" && dateSet.has(terugDag)) {
      wisselCel(terugDag, naar, van, terugCode, { ...merk, swapFrom: opts.naamVanId(naar) });
    }
  }
  return uit;
}
