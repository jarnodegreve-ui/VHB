import { getUserExpiries } from "../../storage.js";
import { PERSONEEL_VERVAL_RAPPORTEN, type PersoneelVervalRapport } from "../../../shared/rapporten/definities/personeel.js";
import type { RapportLader } from "../../../shared/rapporten/types.js";
import { vandaagInBelgie } from "./peildatumServer.js";
import { bouwActieveMedewerkers, bouwContactlijst, bouwPersoneelVerval } from "./personeel.js";
import { getRapportMedewerkers } from "./personeelBron.js";

/** Medische schiftingen en vakbekwaamheden: één lader, de soort ligt vast per rapport. */
const vervalLader = (rapport: PersoneelVervalRapport): RapportLader => async (filters) => {
  const [users, vervaldata] = await Promise.all([getRapportMedewerkers(), getUserExpiries()]);
  return bouwPersoneelVerval({ users, vervaldata }, PERSONEEL_VERVAL_RAPPORTEN[rapport], filters, vandaagInBelgie());
};

export const PERSONEEL_LADERS: Record<string, RapportLader> = {
  contactlijst: async (filters) => bouwContactlijst(await getRapportMedewerkers(), filters, vandaagInBelgie()),
  "actieve-medewerkers": async (filters) => bouwActieveMedewerkers(await getRapportMedewerkers(), filters, vandaagInBelgie()),
  "medische-schiftingen": vervalLader("medische-schiftingen"),
  vakbekwaamheden: vervalLader("vakbekwaamheden"),
};
