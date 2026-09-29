/**
 * DE regel tegen dubbele inplanning (Jarno 29-09), op één plek:
 *
 *   Na de bewerking heeft geen enkele chauffeur op één dag meer dan één
 *   dienst, behalve waar de bewerking zelf de tweede dienst in dezelfde
 *   beweging wegneemt (1-op-1).
 *
 * Een dienst is: een gewone dienst volgens de planning-rijen, of een
 * code-dienst (schoolrit, bureau, garage) volgens het bord, want die heeft
 * geen rijen (api/_lib/codeDienst.ts). De regel geldt voor ELKE chauffeur die
 * door de bewerking een dienst krijgt, op ELKE dag waarop hij die krijgt: de
 * ontvanger op de dienstdag, en bij een 1-op-1 ook de aanvrager op de terugdag.
 *
 * Elk schrijfpad beschrijft wat het doet als een lijst ontvangsten en vraagt
 * hier de conflicten: de handmatige wissel, een ruil goedkeuren (PATCH, de
 * lijst en de Telegram-knop, via dubbeleInplanningFout), een overname
 * aanvragen en een dienst toewijzen (ook de Telegram-knop). De zin die de
 * planner leest maakt het pad zelf, de regel is overal dezelfde.
 *
 */
import { DAG_DMJ, toLookupToken } from "../helpers.js";
import { getShiftsOnDate, getSwapsData } from "../storage.js";
import { dienstOpBord } from "../../shared/bordBezetting.js";
import { bordOpDag, laadBordVast, type BordVanDag, type BordVast } from "./codeDienst.js";

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;

/** Eén chauffeur die door de bewerking op één dag een dienst krijgt. */
export type Ontvangst = {
  driverId: string;
  date: string;
  /** De dienst die hij krijgt. Heeft hij die al, dan is dat geen conflict:
   *  een herhaalde doorvoer blijft idempotent. */
  krijgt: unknown;
  /** Wat hij in dezelfde beweging op die dag afgeeft (1-op-1). */
  geeftAf?: unknown[];
};

/** Wat er op één dag staat: de rijen in de planning en het bord. */
export type DagStand = {
  rijen: Array<{ driverId?: unknown; line?: unknown }>;
  bord: Pick<BordVanDag, "celVan" | "isCodeDienst" | "isBekend">;
};

export type DubbeleInplanning = {
  driverId: string;
  date: string;
  /** De dienst (of de onbekende code) die de chauffeur die dag al draagt. */
  dienst: string;
  /** Waar hij staat: in de planning-rijen, als code-dienst op het bord, of
   *  als code die het portaal niet kent. */
  bron: "rijen" | "bord" | "onbekend";
};

/**
 * De conflicten van een bewerking, puur. Eerst wat in de planning-rijen staat
 * (in de volgorde van de ontvangsten), daarna wat alleen het bord toont: zo
 * kan een pad zijn afwezigheidscontrole tussen de twee houden, zoals het dat
 * altijd deed.
 */
export const dubbeleInplanningen = (
  standOp: (date: string) => DagStand | undefined,
  ontvangsten: Ontvangst[],
): DubbeleInplanning[] => {
  const uitRijen: DubbeleInplanning[] = [];
  const uitBord: DubbeleInplanning[] = [];
  for (const o of ontvangsten) {
    const stand = ISO_DAG.test(o.date) && o.driverId && toLookupToken(String(o.krijgt ?? "")) ? standOp(o.date) : undefined;
    if (!stand) continue;
    const telNiet = new Set([o.krijgt, ...(o.geeftAf ?? [])].map((d) => toLookupToken(String(d ?? ""))).filter(Boolean));
    const rij = stand.rijen.find((r) => String(r.driverId) === o.driverId && !telNiet.has(toLookupToken(String(r.line ?? ""))));
    if (rij) uitRijen.push({ driverId: o.driverId, date: o.date, dienst: String(rij.line), bron: "rijen" });
    const cel = stand.bord.celVan(o.driverId);
    const dienst = dienstOpBord(cel);
    if (dienst && stand.bord.isCodeDienst(dienst) && !telNiet.has(toLookupToken(dienst))) {
      uitBord.push({ driverId: o.driverId, date: o.date, dienst, bron: "bord" });
    }
  }
  return [...uitRijen, ...uitBord];
};

/**
 * De stand van de gevraagde dagen: per dag de planning-rijen en het bord
 * (matrixcel met de ruilen erover, zonder de afwezigheden: die toetst elk pad
 * apart, vóór de melding over een dubbele dienst). Alles in één beweging;
 * `vooraf` is wat de aanroeper al las (de ruilen, en in een lus `vast`).
 */
export const laadDagStanden = async (dagen: unknown[], vooraf?: { swaps?: any[]; vast?: BordVast }) => {
  const vastLezing = vooraf?.vast ? Promise.resolve(vooraf.vast) : laadBordVast();
  const bron = Promise.all([vastLezing, vooraf?.swaps ?? getSwapsData()]);
  const uniek = [...new Set(dagen.map((d) => String(d ?? "").trim()).filter((d) => ISO_DAG.test(d)))];
  const [vast, standen] = await Promise.all([
    vastLezing,
    Promise.all(uniek.map(async (dag): Promise<[string, DagStand]> => {
      const [rijen, bord] = await Promise.all([
        getShiftsOnDate(dag),
        bron.then(([v, swaps]) => bordOpDag(dag, v.users, { zonderAfwezigheid: true, swaps: swaps as any[], services: v.services, codes: v.codes })),
      ]);
      return [dag, { rijen, bord }];
    })),
  ]);
  const perDag = new Map(standen);
  return { vast, standOp: (dag: string) => perDag.get(dag) };
};

/** De melding bij een code die het portaal niet kent. */
export const onbekendeCodeFout = (naam: string, date: string, code: string) =>
  `${naam} staat op ${DAG_DMJ(date)} op '${code}', en die code staat niet in het dienstoverzicht of de planningscodes. Voeg ze eerst toe in Planningscodes, dan weet het portaal of ${naam} die dag een dienst rijdt.`;
