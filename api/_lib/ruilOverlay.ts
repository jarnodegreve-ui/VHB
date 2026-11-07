import { isHandmatigeWissel, normalizeSwapType, toLookupToken } from "./helpers.js";
import type { SwapRecord } from "./types.js";

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
 *
 * In alle gevallen krijgt óók de kant die de dienst afstaat een merk
 * ({swapAway, swapTo}), zodat zijn "vrij" in het maandbeeld te onderscheiden
 * is van een gewone vrije dag (Jarno 17-09).
 * 2. De planner heeft de ruil intussen óók in de Excel verwerkt, voorlopig
 *    de gangbare werkwijze (Jarno 12-09): de ontvanger heeft de dienst al.
 *    Vroeger bleef dan alles staan, dus verdween "geruild met X" bij de
 *    eerstvolgende import en zag de chauffeur een gewone dienst. Nu krijgt
 *    de cel van de ontvanger alleen het merk, zonder wisselen: dubbel
 *    doorvoeren blijft onmogelijk, de aanduiding blijft.
 * 3. Niemand heeft de dienst (intussen handmatig verlegd, of buiten het
 *    bereik): niets doen.
 * 4. De ontvanger staat niet op het bord (uit dienst gegaan na de ruil, of
 *    verwijderd; nr. 48, 05-11): de gever wordt vrij met het weg-merk en
 *    `swapToBuitenBord`, zodat de planner ziet dat niemand op het bord de
 *    dienst rijdt (de rijen staan op de ontvanger). Tot 05-11 werd zo'n ruil
 *    helemaal overgeslagen en bleef de dienst op de gever staan, terwijl de
 *    dekking hem als ingevuld telde. Het spiegelbeeld (gever buiten het bord,
 *    ontvanger erop) is bewust nog niet gebouwd: zo'n ruil wordt nog
 *    overgeslagen, ook het terugbeen van een 1-op-1 met een ontvanger
 *    buiten het bord.
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
  /** Deze chauffeur stond de dienst af en is daardoor vrij: de tegenkant van
   *  de wissel. De weergave zet zo'n cel in het rood (Jarno 17-09). */
  swapAway?: boolean;
  /** Naam van de chauffeur die de dienst overnam (alleen bij `swapAway`). */
  swapTo?: string;
  /** De ontvanger staat niet op het bord (uit dienst of verwijderd, nr. 48,
   *  05-11): de dienst is weggegeven, maar niemand op het bord rijdt hem. De
   *  gever is wél vrij, want de planningrijen staan op de ontvanger. */
  swapToBuitenBord?: boolean;
  /** De ruil is afgehandeld ('completed'): de wissel blijft staan, maar
   *  terugdraaien kan niet meer (de state-machine laat geen overgang meer
   *  toe uit een afgehandelde status). */
  swapDone?: boolean;
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
  /** Gever gemarkeerd als weggeruild naar iemand buiten het bord (uit dienst
   *  of verwijderd): de dienst heeft op het bord geen rijder meer. */
  buitenBord: number;
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
  const uit: OverlayUitkomst = { gewisseld: 0, gemarkeerd: 0, overgeslagen: 0, buitenBord: 0 };
  const vrijCel = opts.vrijCel ?? VRIJ_CEL;
  const toontCode = (cel: OverlayCel | undefined, code: string): cel is OverlayCel =>
    !!cel && toLookupToken(cel.code) === toLookupToken(code);

  const wisselCel = (
    date: string, vanId: string, naarId: string, verwachtCode: string,
    merk: { swapId: string; swapManual: boolean; swapFrom: string; swapDone?: boolean },
  ) => {
    const vanCel = cells[vanId]?.[date];
    const naarCel = cells[naarId]?.[date];
    // Merk voor de kant die de dienst afstaat: zonder dit bleef de gever een
    // gewone lege/vrije cel en was aan het maandbeeld niet te zien dat hij
    // die dag een dienst wegruilde (Jarno 17-09).
    const wegMerk = { swapId: merk.swapId, swapManual: merk.swapManual, swapDone: merk.swapDone, swapAway: true, swapTo: opts.naamVanId(naarId) };
    if (toontCode(vanCel, verwachtCode)) {
      if (!cells[naarId]) cells[naarId] = {};
      cells[naarId][date] = { ...vanCel, ...merk };
      // Had de ontvanger zelf een dienst (1-op-1 op dezelfde dag), dan krijgt
      // de gever die; een afwezigheidscode van de ontvanger neemt hij niet
      // over, dan wordt hij vrij. Ook zonder cel bij de ontvanger blijft de
      // gever nu als "vrij (weggeruild)" staan i.p.v. leeg.
      cells[vanId][date] = naarCel && naarCel.kind === "service" ? naarCel : { ...vrijCel, ...wegMerk };
      uit.gewisseld += 1;
      return;
    }
    if (toontCode(naarCel, verwachtCode)) {
      cells[naarId][date] = { ...naarCel, ...merk };
      // De Excel had de ruil al verwerkt: de gever staat er al vrij/afwezig.
      // Alleen merken, nooit een dienst van die dag overschrijven. (Opnieuw
      // uit `cells` lezen: het type-predicaat hierboven versmalt `vanCel` in
      // deze tak tot `undefined`.)
      const geverCel = cells[vanId]?.[date];
      if (geverCel && geverCel.kind !== "service") cells[vanId][date] = { ...geverCel, ...wegMerk };
      uit.gemarkeerd += 1;
      return;
    }
    uit.overgeslagen += 1;
  };

  const doorgevoerd = swaps
    .filter((sw) => sw?.status === "approved" || sw?.status === "completed")
    .sort((a, b) => String(a.decidedAt ?? "").localeCompare(String(b.decidedAt ?? "")));

  // Situatie 4: de gever staat op het bord, de ontvanger niet. Alleen als de
  // gever de dienst nog toont wordt hij vrij met het weg-merk; toont hij hem
  // niet (meer), dan is er niets te markeren.
  const markeerWegNaarBuitenBord = (date: string, vanId: string, naarId: string, verwachtCode: string, merk: { swapId: string; swapManual: boolean; swapDone?: boolean }) => {
    const vanCel = cells[vanId]?.[date];
    if (!toontCode(vanCel, verwachtCode)) { uit.overgeslagen += 1; return; }
    cells[vanId][date] = { ...vrijCel, ...merk, swapAway: true, swapTo: opts.naamVanId(naarId), swapToBuitenBord: true };
    uit.buitenBord += 1;
  };

  for (const sw of doorgevoerd) {
    const van = String(sw.requesterId ?? "");
    const naar = String(sw.targetDriverId ?? "");
    if (!opts.chauffeurIds.has(van)) continue;
    const dienstDag = String(sw.shiftDate ?? "");
    const dienstCode = String(sw.shiftLine ?? "").trim();
    const merk = { swapId: String(sw.id), swapManual: isHandmatigeWissel(sw), swapDone: sw.status === "completed", swapFrom: opts.naamVanId(van) };
    if (!opts.chauffeurIds.has(naar)) {
      // Het terugbeen van een 1-op-1 zou de gever een dienst geven die uit de
      // cel van iemand buiten het bord moet komen: spiegelbeeld, nog niet
      // gebouwd (zie het kopblok).
      if (dienstDag && dienstCode && dateSet.has(dienstDag)) markeerWegNaarBuitenBord(dienstDag, van, naar, dienstCode, merk);
      continue;
    }
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
