import { isMissingTableError } from "../../deviceGate.js";
import { getAppSetting, getLeaveData, getUsersData } from "../../storage.js";
import type { RapportLader } from "../../../shared/rapporten/types.js";
import { VERLOF_LIMIETEN_KEY, limietVoorDag, parseVerlofLimieten } from "../../../shared/schemas/verlofLimieten.js";
import { VERLOF_FEESTDAGEN_KEY, parseVerlofFeestdagen } from "../../../shared/schemas/verlofFeestdagen.js";
import { bouwVerlofsaldo } from "./verlofsaldo.js";
import { bouwVerlofPerType, bouwVerlofaanvragen, bouwVerlofbezetting } from "./verlof.js";
import { bouwZiekteDetails, bouwZiekteKalenderdagen, bouwZiektePerMaand } from "./ziekte.js";

/**
 * De laders van de domeinen ziekte en verlof: per rapport alleen waar de bron
 * vandaan komt; het rekenwerk is een pure functie in ziekte.ts, verlof.ts of
 * verlofsaldo.ts. In een eigen bestand per werkterrein, zodat
 * api/_lib/rapportRoutes.ts de tabellen alleen samenvoegt.
 */

/** Extra vrije dagen zoals GET /api/verlof/feestdagen ze geeft: bij een fout leeg, zodat scherm en rapport hetzelfde tellen. */
const extraFeestdagen = async (): Promise<ReadonlySet<string>> => {
  try {
    return new Set(parseVerlofFeestdagen(await getAppSetting(VERLOF_FEESTDAGEN_KEY)).extra.map((d) => d.datum));
  } catch (err) {
    if (!isMissingTableError(err)) console.error("Extra vrije dagen laden is mislukt.", err);
    return new Set();
  }
};

/** Verloflimieten zoals GET /api/leave/bezetting: zonder instellingen (of bij een fout) de standaard. */
const verlofLimieten = async () => {
  try {
    return parseVerlofLimieten(await getAppSetting(VERLOF_LIMIETEN_KEY));
  } catch (err) {
    if (!isMissingTableError(err)) console.error("Verloflimieten laden is mislukt.", err);
    return parseVerlofLimieten(null);
  }
};

/** De kalenderdag van vandaag in België: de server draait op UTC, en "t/m vandaag" is de dag van de planner. */
const vandaagInBelgie = (): string => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });

const ziekteBron = async () => {
  const [users, leave] = await Promise.all([getUsersData(), getLeaveData()]);
  return { users, leave, vandaag: vandaagInBelgie() };
};

export const ZIEKTE_LADERS: Record<string, RapportLader> = {
  "ziekte-kalenderdagen": async (filters) => bouwZiekteKalenderdagen(await ziekteBron(), filters),
  "ziekte-details": async (filters) => bouwZiekteDetails(await ziekteBron(), filters),
  "ziekte-per-maand": async (filters) => bouwZiektePerMaand(await ziekteBron(), filters),
};

export const VERLOF_LADERS: Record<string, RapportLader> = {
  verlofsaldo: async (filters) => {
    const [users, leave, extra] = await Promise.all([getUsersData(), getLeaveData(), extraFeestdagen()]);
    return bouwVerlofsaldo({ users, leave, extraFeestdagen: extra }, filters);
  },
  verlofaanvragen: async (filters) => {
    const [users, leave, extra] = await Promise.all([getUsersData(), getLeaveData(), extraFeestdagen()]);
    return bouwVerlofaanvragen({ users, leave, extraFeestdagen: extra }, filters);
  },
  verlofbezetting: async (filters) => {
    const [users, leave, limieten] = await Promise.all([getUsersData(), getLeaveData(), verlofLimieten()]);
    return bouwVerlofbezetting({ users, leave, limietVoor: (dag) => limietVoorDag(limieten, dag) }, filters);
  },
  "verlof-per-type": async (filters) => {
    const [leave, extra] = await Promise.all([getLeaveData(), extraFeestdagen()]);
    return bouwVerlofPerType({ leave, extraFeestdagen: extra }, filters);
  },
};
