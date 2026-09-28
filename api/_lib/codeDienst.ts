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

/** Het bord van één dag: per chauffeur de cel zoals de maandplanning ze toont. */
export const bordOpDag = async (date: string, users: CelWaarheidUser[]) => {
  const [rows, services, codes, leave, swaps] = await Promise.all([
    getPlanningMatrixRows({ van: date, tot: date }),
    getServicesData(),
    getPlanningCodesData(),
    getLeaveData({ endOnOrAfter: date }),
    getSwapsData(),
  ]);
  const { cells, chauffeurs } = berekenCelWaarheid(date.slice(0, 7), {
    rows: rows as any[], users, services: services as any[], codes: codes as any[], leave: leave as any[], swaps: swaps as any[],
  });
  const opBord = new Set(chauffeurs.map((c) => c.id));
  return {
    celVan: (driverId: string): OverlayCel | undefined => cells[driverId]?.[date],
    /** Alleen chauffeurs staan op het bord; een wissel naar iemand anders zou
     *  het bord nooit kunnen tonen. */
    staatOpBord: (driverId: string): boolean => opBord.has(driverId),
    isCodeDienst: maakCodeDienstToets(services as DienstBron[], codes as CodeBron[]),
    swaps,
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
