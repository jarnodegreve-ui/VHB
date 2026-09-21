import { getDefecten, getVehicleExpiries, getVehicles, getWerkprestaties } from "../techniekStorage.js";
import type { RapportLader } from "../../../shared/rapporten/types.js";
import { vandaagInBelgie } from "./peildatumServer.js";
import { getRapportMedewerkers } from "./personeelBron.js";
import {
  bouwDefecten, bouwUitgevoerdeWerken, bouwVervaldataVoertuigen, bouwWagenparkLeeftijd, bouwWagenparkOverzicht,
  bouwWagenparkSamenvatting, bouwWagenparkTechnisch,
} from "./voertuigen.js";

/**
 * Het gele boek en de werkprestaties worden volledig gelezen (tot de limiet
 * van de opslaglaag) en pas in de pure functie op periode gefilterd: het
 * `bereik` moet zeggen van wanneer tot wanneer er gegevens zijn, ook buiten
 * de gevraagde periode.
 */
export const VOERTUIG_LADERS: Record<string, RapportLader> = {
  "wagenpark-overzicht": async (filters) => bouwWagenparkOverzicht(await getVehicles(), filters, vandaagInBelgie()),
  "wagenpark-leeftijd": async (filters) => bouwWagenparkLeeftijd(await getVehicles(), filters, vandaagInBelgie()),
  "wagenpark-technisch": async (filters) => bouwWagenparkTechnisch(await getVehicles(), filters, vandaagInBelgie()),
  "wagenpark-samenvatting": async (filters) => bouwWagenparkSamenvatting(await getVehicles(), filters, vandaagInBelgie()),
  "vervaldata-voertuigen": async (filters) => {
    const [voertuigen, vervaldata] = await Promise.all([getVehicles(), getVehicleExpiries()]);
    return bouwVervaldataVoertuigen({ voertuigen, vervaldata }, filters, vandaagInBelgie());
  },
  defecten: async (filters) => {
    const [defecten, users] = await Promise.all([getDefecten({ status: "alles", limit: 2000 }), getRapportMedewerkers()]);
    return bouwDefecten({ defecten, users }, filters, vandaagInBelgie());
  },
  "uitgevoerde-werken": async (filters) => {
    const [werken, users] = await Promise.all([getWerkprestaties({ limit: 5000 }), getRapportMedewerkers()]);
    return bouwUitgevoerdeWerken({ werken, users }, filters);
  },
};
