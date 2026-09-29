/**
 * Code-diensten: werk dat op het bord als dienst staat maar alleen als
 * planningscode bestaat (schoolritten EEK1…, bureau, garage). Ze staan niet in
 * het dienstoverzicht, hebben dus geen uren, en de opbouw maakt er geen rijen
 * voor in `planning`. Het bord (matrix + goedgekeurde ruilen + afwezigheden,
 * api/_lib/celWaarheid.ts) is voor zulke diensten de enige waarheid.
 *
 * Aanleiding (Jarno 28-09): de handmatige wissel zocht eigendom alleen in
 * `planning` en strandde daardoor voor elke EEK-rit op "de planning is
 * intussen gewijzigd", terwijl er niets gewijzigd was.
 */
import { toLookupToken } from "../helpers.js";
import { getLeaveData, getPlanningCodesData, getPlanningMatrixRows, getServicesData, getSwapsData } from "../storage.js";
import { berekenCelWaarheid, type CelWaarheidUser } from "./celWaarheid.js";
import type { OverlayCel } from "./ruilOverlay.js";
import { dienstOpBord } from "../../shared/bordBezetting.js";

type DienstBron = { serviceNumber?: unknown };
type CodeBron = { code: string; category?: string };

/** Toets "is dit een code-dienst?": een planningscode van de categorie dienst
 *  die niet (ook) in het dienstoverzicht staat. Staat het nummer daar wél,
 *  dan wint het dienstoverzicht, net als in de opbouw en op het bord. */
export const maakCodeDienstToets = (services: DienstBron[], codes: CodeBron[]) => {
  const inOverzicht = new Set(services.map((s) => toLookupToken(String(s.serviceNumber ?? ""))));
  const alsCode = new Set(codes.filter((c) => String(c.category ?? "") === "service").map((c) => toLookupToken(c.code)));
  return (line: unknown): boolean => {
    const token = toLookupToken(String(line ?? ""));
    return !!token && !inOverzicht.has(token) && alsCode.has(token);
  };
};

/** De schrijfwijze waaronder deze cel de dienst draagt, of null als ze hem
 *  niet draagt. Een dienst die onder een afwezigheid ligt (ziek gemeld, dienst
 *  nog niet herverdeeld) telt mee: juist die moet overgezet kunnen worden. */
export const dienstOpCel = (cel: OverlayCel | undefined, line: unknown): string | null => {
  const token = toLookupToken(String(line ?? ""));
  if (!cel || !token) return null;
  if (cel.kind === "service" && toLookupToken(cel.code) === token) return cel.code;
  if (cel.hiddenService && toLookupToken(cel.hiddenService) === token) return cel.hiddenService;
  return null;
};

/** Alles waaruit het bord van een dag (of maand) berekend wordt. */
export type BordBron = { rows: any[]; users: CelWaarheidUser[]; services: any[]; codes: any[]; leave: any[]; swaps: any[] };

/** Pure kern van `bordOpDag`: het bord van één dag uit een al geladen bron.
 *  Zo betaalt een route die de matrix, de diensten of de ruilen al in handen
 *  heeft er geen tweede lezing voor. */
export const bordVanDag = (date: string, bron: BordBron) => {
  const { cells, chauffeurs } = berekenCelWaarheid(date.slice(0, 7), {
    rows: bron.rows, users: bron.users, services: bron.services, codes: bron.codes, leave: bron.leave, swaps: bron.swaps,
  });
  const opBord = new Set(chauffeurs.map((c) => c.id));
  return {
    celVan: (driverId: string): OverlayCel | undefined => cells[driverId]?.[date],
    /** Alleen chauffeurs staan op het bord; een wissel naar iemand anders zou
     *  het bord nooit kunnen tonen. */
    staatOpBord: (driverId: string): boolean => opBord.has(driverId),
    isCodeDienst: maakCodeDienstToets(bron.services as DienstBron[], bron.codes as CodeBron[]),
    swaps: bron.swaps,
    leave: bron.leave,
  };
};

export type BordVanDag = ReturnType<typeof bordVanDag>;

/**
 * Het bord van één dag: per chauffeur de cel zoals de maandplanning ze toont.
 *
 * `zonderAfwezigheid`: de cel met de ruilen erover maar zonder het verlof en
 * de ziekte uit het portaal. Voor de controles die vroeger de rauwe matrixcel
 * lazen en de afwezigheid apart toetsen (ruilAfwezigheidsFout): zo blijft hun
 * melding dezelfde, en het scheelt een lezing. `swaps`: al geladen ruilen.
 */
export const bordOpDag = async (date: string, users: CelWaarheidUser[], opts?: { zonderAfwezigheid?: boolean; swaps?: any[] }) => {
  const [rows, services, codes, leave, swaps] = await Promise.all([
    getPlanningMatrixRows({ van: date, tot: date }),
    getServicesData(),
    getPlanningCodesData(),
    opts?.zonderAfwezigheid ? [] : getLeaveData({ endOnOrAfter: date }),
    opts?.swaps ?? getSwapsData(),
  ]);
  return bordVanDag(date, { rows: rows as any[], users, services: services as any[], codes: codes as any[], leave: leave as any[], swaps: swaps as any[] });
};

/**
 * De code-dienst die een chauffeur die dag volgens het bord al draagt, of
 * null (controle 29-09). Een conflictcontrole die alleen de planning-rijen
 * leest, ziet een code-dienst niet: die heeft geen rijen. De ontvanger kreeg
 * er dan stil een tweede dienst bij, en het bord schoof zijn schoolrit door
 * naar de gever.
 *
 * Bewust alleen code-diensten. Voor een dienst uit het dienstoverzicht blijven
 * de planning-rijen de waarheid en doet de bestaande rijencontrole haar werk;
 * het bord kan daar achterlopen (een wissel naar iemand die niet op het bord
 * staat, een handmatig bijgewerkte planning) en zou dan ten onrechte weigeren.
 *
 * `behalve`: diensten die in dezelfde beweging verhuizen en dus geen conflict
 * zijn (de aangeboden dienst zelf, de terugdienst van een 1-op-1).
 */
export const bezetOpBord = (
  bord: Pick<BordVanDag, "celVan" | "isCodeDienst">,
  driverId: string,
  behalve: unknown[] = [],
): string | null => {
  const dienst = dienstOpBord(bord.celVan(driverId));
  if (!dienst || !bord.isCodeDienst(dienst)) return null;
  const token = toLookupToken(dienst);
  return behalve.some((b) => toLookupToken(String(b ?? "")) === token) ? null : dienst;
};

/**
 * De bordcellen van een reeks dagen, met de doorgevoerde ruilen erover en
 * zonder de afwezigheden uit het portaal: wat de beschikbaarheid en het
 * advies vroeger uit de rauwe matrix lazen. Eén berekening per maand.
 */
export const bordCellenVoor = (dates: string[], bron: Omit<BordBron, "leave">) => {
  const perMaand = new Map<string, Record<string, Record<string, OverlayCel>>>();
  for (const maand of new Set(dates.map((d) => d.slice(0, 7)))) {
    perMaand.set(maand, berekenCelWaarheid(maand, { ...bron, leave: [] }).cells);
  }
  /** Cel per chauffeur-id op die dag (alleen niet-lege cellen). */
  return (date: string): Map<string, OverlayCel> => {
    const uit = new Map<string, OverlayCel>();
    for (const [driverId, perDag] of Object.entries(perMaand.get(date.slice(0, 7)) ?? {})) {
      const cel = perDag[date];
      if (cel) uit.set(driverId, cel);
    }
    return uit;
  };
};

/** Welke benen van een ruil alleen op het bord leven. Leest pas bij als een
 *  been 0 rijen verplaatste: de gewone doorvoer betaalt er niets voor. */
export const bordBenenVan = async (
  swap: { shiftLine?: unknown; returnCode?: unknown },
  r: { offeredMoved: number; returnMoved: number | null } | null,
): Promise<{ aangeboden: boolean; terug: boolean } | undefined> => {
  if (!r || (r.offeredMoved > 0 && r.returnMoved !== 0)) return undefined;
  const [services, codes] = await Promise.all([getServicesData(), getPlanningCodesData()]);
  const isCodeDienst = maakCodeDienstToets(services as DienstBron[], codes as CodeBron[]);
  return {
    aangeboden: r.offeredMoved === 0 && isCodeDienst(swap.shiftLine),
    terug: r.returnMoved === 0 && isCodeDienst(swap.returnCode),
  };
};
