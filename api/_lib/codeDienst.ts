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
import { getLeaveData, getPlanningCodesData, getPlanningMatrixRows, getServicesData, getSwapsData, getUsersData, laadDagtypeKalender } from "../storage.js";
import type { DagtypeKalender } from "../../shared/dagtype.js";
import { berekenCelWaarheid, type CelWaarheidUser } from "./celWaarheid.js";
import type { OverlayCel } from "./ruilOverlay.js";

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
export type BordBron = { rows: any[]; users: CelWaarheidUser[]; services: any[]; codes: any[]; leave: any[]; swaps: any[]; kalender?: DagtypeKalender | null };

/** Welke lijst leeg terugkwam. Dan kent het portaal geen enkele code van die
 *  soort en is elke cel "onbekend": een lege lijst is geen bewijs dat een
 *  code onbekend is (controle 29-09, 1c). */
export type BronLeeg = "dienstoverzicht" | "planningscodes" | "beide";

const bronLeegVan = (services: unknown[], codes: unknown[]): BronLeeg | null => {
  if (services.length === 0 && codes.length === 0) return "beide";
  if (services.length === 0) return "dienstoverzicht";
  if (codes.length === 0) return "planningscodes";
  return null;
};

/** Pure kern van `bordOpDag`: het bord van één dag uit een al geladen bron.
 *  Zo betaalt een route die de matrix, de diensten of de ruilen al in handen
 *  heeft er geen tweede lezing voor. */
export const bordVanDag = (date: string, bron: BordBron) => {
  const { cells, chauffeurs } = berekenCelWaarheid(date.slice(0, 7), {
    rows: bron.rows, users: bron.users, services: bron.services, codes: bron.codes, leave: bron.leave, swaps: bron.swaps, kalender: bron.kalender,
  });
  const opBord = new Set(chauffeurs.map((c) => c.id));
  const bekend = new Set([
    ...bron.services.map((s) => toLookupToken(String(s?.serviceNumber ?? ""))),
    ...bron.codes.map((c) => toLookupToken(String(c?.code ?? ""))),
  ]);
  return {
    celVan: (driverId: string): OverlayCel | undefined => cells[driverId]?.[date],
    /** Alleen chauffeurs staan op het bord; een wissel naar iemand anders zou
     *  het bord nooit kunnen tonen. */
    staatOpBord: (driverId: string): boolean => opBord.has(driverId),
    isCodeDienst: maakCodeDienstToets(bron.services as DienstBron[], bron.codes as CodeBron[]),
    /** Kent het portaal deze code: staat ze in het dienstoverzicht of in de
     *  planningscodes (welke categorie ook)? */
    isBekend: (code: unknown): boolean => bekend.has(toLookupToken(String(code ?? ""))),
    /** Kwam het dienstoverzicht of kwamen de planningscodes leeg terug? Dan
     *  kan het portaal een code niet beoordelen (api/_lib/dubbeleInplanning.ts). */
    bronLeeg: bronLeegVan(bron.services, bron.codes),
    swaps: bron.swaps,
    leave: bron.leave,
  };
};

export type BordVanDag = ReturnType<typeof bordVanDag>;

/** Wat voor elke dag hetzelfde is: gebruikers, dienstoverzicht en
 *  planningscodes. Een route die het bord van meer dan één dag nodig heeft
 *  (een lijst ruilen goedkeuren, meerdere overnames indienen) leest dit één
 *  keer vóór haar lus en geeft het mee; per dag blijft alleen de matrixrij. */
export type BordVast = { users: CelWaarheidUser[]; services: any[]; codes: any[]; kalender: DagtypeKalender };

export const laadBordVast = async (): Promise<BordVast> => {
  const [users, services, codes, kalender] = await Promise.all([getUsersData(), getServicesData(), getPlanningCodesData(), laadDagtypeKalender()]);
  return { users: users as any[], services: services as any[], codes: codes as any[], kalender };
};

/**
 * Het bord van één dag: per chauffeur de cel zoals de maandplanning ze toont.
 *
 * `zonderAfwezigheid`: de cel met de ruilen erover maar zonder het verlof en
 * de ziekte uit het portaal. Voor de controles die vroeger de rauwe matrixcel
 * lazen en de afwezigheid apart toetsen (ruilAfwezigheidsFout): zo blijft hun
 * melding dezelfde, en het scheelt een lezing. `swaps`, `services`, `codes`:
 * al geladen, dan geen tweede lezing.
 */
export const bordOpDag = async (
  date: string,
  users: CelWaarheidUser[],
  opts?: { zonderAfwezigheid?: boolean; swaps?: any[]; services?: any[]; codes?: any[]; kalender?: DagtypeKalender | null },
) => {
  const [rows, services, codes, leave, swaps, kalender] = await Promise.all([
    getPlanningMatrixRows({ van: date, tot: date }),
    // De versie van het dienstoverzicht die op deze dag geldt (08-10).
    opts?.services ?? getServicesData({ datum: date }),
    opts?.codes ?? getPlanningCodesData(),
    opts?.zonderAfwezigheid ? [] : getLeaveData({ endOnOrAfter: date }),
    opts?.swaps ?? getSwapsData(),
    opts?.kalender ?? laadDagtypeKalender(),
  ]);
  return bordVanDag(date, { rows: rows as any[], users, services: services as any[], codes: codes as any[], leave: leave as any[], swaps: swaps as any[], kalender });
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
