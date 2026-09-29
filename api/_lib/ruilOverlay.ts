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
 *
 * Volgorde = beslisvolgorde (decidedAt), zodat kettingen (A→B, daarna B→C)
 * kloppen: de laatste ruil op een cel bepaalt het merk. 'completed' telt
 * mee, een voltooide ruil is gereden zoals gewisseld.
 *
 * Wie niet op het bord staat (uit dienst, een andere rol) telt mee als de
 * aanroeper zijn matrixcellen meegeeft (`buitenBord`), en dan gelden BEIDE
 * benen van de ruil, zoals toen hij nog op het bord stond (Jarno 29-09,
 * optie A). Anders valt de hele ruil weg, zoals altijd. Tot 29-09 viel de
 * ruil altijd weg zodra één van beiden niet op het bord stond: werd de gever
 * uit dienst gezet, dan stond de ontvanger weer als vrij op het bord terwijl
 * hij de dienst nog reed. Beide benen of geen: de eerste versie van 29-09
 * paste alleen het been VAN de vertrokken collega toe, en telde zo bij een
 * 1-op-1 over twee dagen een dienst te veel bij wie op het bord bleef (hij
 * hield wat hij weggaf en kreeg wat hij terugkreeg); dat bord voedt het
 * voorstel van de Dagafsluiting, het Maandoverzicht en de rapporten. Het open
 * punt van die versie is daarmee ook opgelost: vertrok de ONTVANGER, dan
 * toont de gever niet langer de dienst maar "vrij (weggeruild)", zoals de
 * planning-rijen, waar de dienst op naam van de ontvanger staat. De aanroeper
 * haalt de cellen van wie buiten het bord staat na de overlay weer weg
 * (api/_lib/celWaarheid.ts); hun cellen dienen alleen de overlay.
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
};

/** De cel van de gever na een wissel als de ontvanger geen dienst had: een
 *  expliciete “vrij”. De code van de ontvanger (ta, bv, tk, opl) is
 *  persoonlijk en verhuist niet mee (Jarno 14-09: een TA moet gewisseld
 *  kunnen worden en de gever wordt dan vrij, niet TA). */
export const VRIJ_CEL: OverlayCel = { code: "vrij", kind: "absence", label: "Geen dienst", segments: [] };

export function legRuilenOverMaandbeeld(
  cells: OverlayCellen,
  swaps: OverlayRuil[],
  opts: { dates: Iterable<string>; chauffeurIds: Set<string>; naamVanId: (id: string) => string; vrijCel?: OverlayCel; buitenBord?: ReadonlySet<string> },
): OverlayUitkomst {
  const dateSet = new Set(opts.dates);
  const uit: OverlayUitkomst = { gewisseld: 0, gemarkeerd: 0, overgeslagen: 0 };
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

  for (const sw of doorgevoerd) {
    const van = String(sw.requesterId ?? "");
    const naar = String(sw.targetDriverId ?? "");
    // Beide benen of geen (Jarno 29-09, optie A): wie op het bord staat of via
    // `buitenBord` meegelezen is, geeft én krijgt. Met iemand anders valt de
    // hele ruil weg; één been alleen gaf een dienst te veel of te weinig.
    const doetMee = (id: string) => opts.chauffeurIds.has(id) || !!opts.buitenBord?.has(id);
    if (!doetMee(van) || !doetMee(naar)) continue;
    const dienstDag = String(sw.shiftDate ?? "");
    const dienstCode = String(sw.shiftLine ?? "").trim();
    const merk = { swapId: String(sw.id), swapManual: isHandmatigeWissel(sw), swapDone: sw.status === "completed", swapFrom: opts.naamVanId(van) };
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
