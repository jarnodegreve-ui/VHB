import { berekenDekkingsGaten } from "../../coverageRoutes.js";
import { SWAP_UITVOERING_ACTIES } from "../../helpers.js";
import {
  getLeaveData, getPlanningCodesData, getPlanningData, getPlanningMatrixGrenzen, getPlanningMatrixRows, getServicesData,
  getSwapVerloopRegels, getSwapsData,
} from "../../storage.js";
import type { RapportLader } from "../../../shared/rapporten/types.js";
import { getVehicles } from "../techniekStorage.js";
import { vandaagInBelgie } from "./peildatumServer.js";
import { getRapportMedewerkers } from "./personeelBron.js";
import { bouwDienstenPerDag, bouwOpenstaandeDiensten, bouwOverzichtPerChauffeur, type DienstenBron, type OverzichtBron, type PlanningDeel } from "./planning.js";
import { bouwRuilaanvragen, bouwRuilenPerChauffeur, bouwUitgevoerdeWissels, type RuilBron, type RuilRij } from "./ruilen.js";

/**
 * De laders van de domeinen ruilen en planning: per rapport alleen waar de bron
 * vandaan komt; het rekenwerk is een pure functie in ruilen.ts of planning.ts.
 */

/**
 * Eén bron voor de drie ruilrapporten: alle ruilen, de medewerkers en de
 * logregels van elke ruil in één query (`getSwapVerloopRegels` zonder id's).
 * Ruilen en hun logregels worden volledig gelezen en pas in de pure functie op
 * periode gefilterd: het `bereik` moet zeggen van wanneer tot wanneer er
 * gegevens zijn, en de nachtcron ruimt ruil-logregels nooit op
 * (`pruneOldRecords` slaat `entity_type = 'swap'` over), dus de volledige
 * rapportgrens van 366 dagen is op te vragen. Het gaat om enkele regels per ruil.
 */
const ruilBron = async (): Promise<RuilBron> => {
  const [swaps, users, logPerRuil] = await Promise.all([getSwapsData(), getRapportMedewerkers(), getSwapVerloopRegels()]);
  return { swaps: swaps as RuilRij[], users, logPerRuil, uitvoeringActies: SWAP_UITVOERING_ACTIES };
};

export const RUIL_LADERS: Record<string, RapportLader> = {
  "uitgevoerde-wissels": async (filters) => bouwUitgevoerdeWissels(await ruilBron(), filters),
  "ruilen-per-chauffeur": async (filters) => bouwRuilenPerChauffeur(await ruilBron(), filters),
  ruilaanvragen: async (filters) => bouwRuilaanvragen(await ruilBron(), filters, vandaagInBelgie()),
};

/** De planning wordt volledig gelezen (pagina's parallel) en in de pure functie op periode gefilterd, voor het `bereik`. */
const dienstenBron = async (): Promise<DienstenBron> => {
  const [planning, users, voertuigen] = await Promise.all([getPlanningData(), getRapportMedewerkers(), getVehicles()]);
  return { planning: planning as PlanningDeel[], users, voertuigen };
};

export const PLANNING_LADERS: Record<string, RapportLader> = {
  "overzicht-per-chauffeur": async (filters) => {
    // Zelfde bronnen als GET /api/month-planning, met de matrix en de afwezigheden begrensd op de periode.
    const [rows, users, services, codes, leave, swaps, grenzen] = await Promise.all([
      getPlanningMatrixRows({ van: filters.van, tot: filters.tot }),
      // Expliciete kolomlijst (nooit auth-velden); het bord heeft alleen naam, rol, sectie, startdatum en actief nodig.
      getRapportMedewerkers(),
      getServicesData(),
      getPlanningCodesData(),
      getLeaveData({ endOnOrAfter: filters.van }),
      getSwapsData(),
      getPlanningMatrixGrenzen(),
    ]);
    return bouwOverzichtPerChauffeur({ rows, users, services, codes, leave, swaps, grenzen } as OverzichtBron, filters);
  },
  "diensten-per-dag": async (filters) => bouwDienstenPerDag(await dienstenBron(), filters),
  // Eén lader, twee definities: dezelfde rijen, maar alleen de delen waaraan een bus gekoppeld is.
  "inzet-per-voertuig": async (filters) => bouwDienstenPerDag(await dienstenBron(), filters, { alleenMetBus: true }),
  "openstaande-diensten": async (filters) => {
    const vandaag = vandaagInBelgie();
    // Voorbije dagen zijn geen gat meer: de dekking rekenen we pas vanaf vandaag (en niet als de hele periode voorbij is).
    const van = (filters.van ?? "") < vandaag ? vandaag : filters.van ?? vandaag;
    const tot = filters.tot ?? vandaag;
    const [gaten, grenzen] = await Promise.all([van <= tot ? berekenDekkingsGaten(van, tot) : Promise.resolve([]), getPlanningMatrixGrenzen()]);
    return bouwOpenstaandeDiensten({ gaten, grenzen }, filters, vandaag);
  },
};
