/**
 * Tot wanneer loopt de planning? (keuze Jarno 22-11: "een dag telt pas als
 * planning als er minstens één cel ingevuld is, lege rijen op het einde
 * tellen niet"; ook dagen met alleen afwezigheidscodes tellen niet.)
 *
 * De grens is de laatste dag van de matrix waarop minstens één dienst staat.
 * Wat een dienst is, wordt hier niet opnieuw uitgevonden:
 *
 *  - een dienst uit het dienstoverzicht heeft rijen in `planning`: de opbouw
 *    (bouwPlanningUitMatrix) maakte die al met de bestaande indeling, per dag
 *    met de dienstregelingversie van die dag. De laatste dag in `planning` is
 *    dus de laatste dag met zo'n dienst, zonder dat het dienstoverzicht bij
 *    elke opstart opnieuw gelezen wordt;
 *  - een code-dienst (schoolrit, bureau, garage: planningscode van de
 *    categorie dienst, api/_lib/codeDienst.ts) heeft geen rijen in `planning`.
 *    Alleen daarvoor wordt de staart van de matrix gelezen: de dagen ná de
 *    laatste planningdag.
 *
 * Puur op een lezer, zodat de opslaglaag (api/_lib/opslag/planning.ts) en het
 * integratieharnas dezelfde beslissing draaien.
 */
import { isIsoDag } from "../../shared/rapporten/periode.js";
import { toLookupToken } from "./helpers.js";

/** Rijen per lezing van de staart, en hoeveel lezingen hoogstens. */
export const STAART_STUK = 35;
export const STAART_MAX_STUKKEN = 4;

export type StaartRij = { source_date?: unknown; assignments?: unknown };

export type PlanningGrens = {
  /** Laatste dag met een rij in de matrix (de grens van vóór 22-11); null = geen matrix. */
  matrix: string | null;
  /** Laatste dag met een rij in `planning`; null = geen (of niet leesbaar terwijl de matrix er staat). */
  planning: string | null;
  /** Laatste dag van de matrix met minstens één dienst; null = geen matrix, of geen enkele dag met een dienst. */
  laatste: string | null;
};

export type GrensLezer = {
  /** `source_date` van de laatste matrixrij, of null. Gooit bij een databasefout. */
  matrixLaatste: () => Promise<unknown>;
  /** `date` van de laatste planningrij, of null. Gooit bij een databasefout. */
  planningLaatste: () => Promise<unknown>;
  /** Matrixrijen ná `na` (null = geen ondergrens), de laatste dag eerst, `aantal` rijen vanaf plaats `vanaf`. */
  staart: (na: string | null, vanaf: number, aantal: number) => Promise<StaartRij[]>;
  /** De tokens van de planningscodes met categorie dienst (`dienstCodeTokens`). */
  dienstCodes: () => Promise<ReadonlySet<string>>;
  waarschuw?: (tekst: string) => void;
};

/** De planningscodes van de categorie dienst, als opzoektokens. Zelfde toets
 *  als `maakCodeDienstToets` (api/_lib/codeDienst.ts); de drifttest in
 *  src/planningGrens.test.ts houdt ze gelijk. */
export const dienstCodeTokens = (codes: ReadonlyArray<{ code?: unknown; category?: unknown }>): Set<string> =>
  new Set(codes.filter((c) => String(c?.category ?? "") === "service").map((c) => toLookupToken(String(c?.code ?? ""))).filter(Boolean));

/** Staat er in deze matrixrij minstens één code-dienst? */
export const draagtCodeDienst = (assignments: unknown, tokens: ReadonlySet<string>): boolean => {
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) return false;
  for (const code of Object.values(assignments as Record<string, unknown>)) {
    const token = toLookupToken(String(code ?? ""));
    if (token && tokens.has(token)) return true;
  }
  return false;
};

const alsDag = (v: unknown): string | null => {
  const dag = String(v ?? "").slice(0, 10);
  return isIsoDag(dag) ? dag : null;
};

const reden = (err: unknown) => String((err as { message?: unknown })?.message ?? err);

/**
 * Gooit alleen als de matrix zelf niet te lezen is, of als er geen matrix is
 * en de planning niet te lezen is (de aanroeper beslist dan, zoals vroeger).
 * Elke andere twijfel (planning of staart niet leesbaar, een datum die geen
 * dag is, een staart langer dan het maximum) geeft de grens van vroeger: de
 * laatste matrixrij, met een waarschuwing in het log.
 */
export async function bepaalPlanningGrens(lezer: GrensLezer): Promise<PlanningGrens> {
  const waarschuw = lezer.waarschuw ?? ((tekst: string) => console.warn(tekst));
  const [m, p] = await Promise.allSettled([lezer.matrixLaatste(), lezer.planningLaatste()]);
  if (m.status === "rejected") throw m.reason;
  const matrix = alsDag(m.value);
  if (!matrix) {
    if (p.status === "rejected") throw p.reason;
    return { matrix: null, planning: alsDag(p.value), laatste: null };
  }
  let planning: string | null = null;
  const oud = (waarom: string): PlanningGrens => {
    waarschuw(`[planning-grens] ${waarom}; de grens is de laatste matrixrij (${matrix}).`);
    return { matrix, planning, laatste: matrix };
  };
  if (p.status === "rejected") return oud(`laatste planningdag niet gelezen (${reden(p.reason)})`);
  planning = alsDag(p.value);
  // Een waarde die geen dag is: niet op filteren (source_date is een datumkolom).
  if (!planning && String(p.value ?? "").trim()) return oud("de laatste planningdag is geen geldige datum");
  // Gewone toestand: op de laatste matrixdag (of erna) staat een dienst met rijen.
  if (planning && planning >= matrix) return { matrix, planning, laatste: matrix };

  try {
    const tokens = lezer.dienstCodes();
    // Geen onafgehandelde afwijzing als de eerste staartlezing eerder faalt.
    tokens.catch(() => {});
    for (let stuk = 0; stuk < STAART_MAX_STUKKEN; stuk += 1) {
      const [rijen, codes] = await Promise.all([lezer.staart(planning, stuk * STAART_STUK, STAART_STUK), tokens]);
      let gevonden: string | null = null;
      for (const rij of rijen) {
        const dag = alsDag(rij?.source_date);
        if (dag && (!gevonden || dag > gevonden) && draagtCodeDienst(rij?.assignments, codes)) gevonden = dag;
      }
      // De staart komt met de laatste dag eerst: wat hierna komt ligt vroeger.
      if (gevonden) return { matrix, planning, laatste: gevonden };
      // Alles gelezen en geen code-dienst: de laatste planningdag is de grens
      // (null = nergens een dienst, de aanroeper toont dan geen grens).
      if (rijen.length < STAART_STUK) return { matrix, planning, laatste: planning };
    }
  } catch (err) {
    return oud(`staart van de matrix niet gelezen (${reden(err)})`);
  }
  return oud(`meer dan ${STAART_STUK * STAART_MAX_STUKKEN} matrixdagen na de laatste planningdag (${planning ?? "geen"}) zonder dienst`);
}

/** De horizon voor `x-planning-tot`: de grens van de matrix, en zonder matrix
 *  de laatste dag waarvoor een dienst is opgebouwd. */
export const horizonUitGrens = (grens: PlanningGrens): string | null => (grens.matrix ? grens.laatste : grens.planning);
