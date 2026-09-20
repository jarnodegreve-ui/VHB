import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import { isMissingTableError } from "../deviceGate.js";
import { getAppSetting, getLeaveData, getUsersData } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";
import { rapportVan } from "../../shared/rapporten/register.js";
import { filterSchemaVoor } from "../../shared/rapporten/filterSchema.js";
import { berekenTotalen } from "../../shared/rapporten/opmaak.js";
import type { RapportAntwoord, RapportFilters, RapportResultaat } from "../../shared/rapporten/types.js";
import { VERLOF_FEESTDAGEN_KEY, parseVerlofFeestdagen } from "../../shared/schemas/verlofFeestdagen.js";
import { valideerRecord } from "./valideer.js";
import { bouwVerlofsaldo } from "./rapporten/verlofsaldo.js";

/**
 * Rapporten (20-09): één namespace, GET /api/rapporten/:id. De definitie van
 * een rapport staat in shared/rapporten/register.ts; hier staat per rapport
 * alleen waar de bron vandaan komt. Het rekenwerk zelf is een pure functie in
 * api/_lib/rapporten/<id>.ts (bron + filters → rijen + bereik), de route vult
 * totalen en tijdstip aan.
 *
 * Staf-only. Filters komen uit de querystring en gaan door het zod-schema dat
 * uit de definitie volgt (400 met veldfouten; een periode is hooguit 366
 * dagen). Geen PDF op de server: afdrukken gebeurt in de browser, zodat deze
 * functie geen zware bibliotheek hoeft te laden (koude start).
 */

type Lader = (filters: RapportFilters) => Promise<RapportResultaat>;

/** Extra vrije dagen zoals GET /api/verlof/feestdagen ze geeft: bij een fout leeg, zodat scherm en rapport hetzelfde tellen. */
const extraFeestdagen = async (): Promise<ReadonlySet<string>> => {
  try {
    return new Set(parseVerlofFeestdagen(await getAppSetting(VERLOF_FEESTDAGEN_KEY)).extra.map((d) => d.datum));
  } catch (err) {
    if (!isMissingTableError(err)) console.error("Extra vrije dagen laden is mislukt.", err);
    return new Set();
  }
};

/**
 * Nieuw rapport = één regel hier (naast de definitie en de pure laadfunctie).
 * Geëxporteerd voor de pariteitstest: elk rapport in het register heeft een
 * lader en omgekeerd (src/rapportRoutes.test.ts).
 */
export const RAPPORT_LADERS: Record<string, Lader> = {
  verlofsaldo: async (filters) => {
    const [users, leave, extra] = await Promise.all([getUsersData(), getLeaveData(), extraFeestdagen()]);
    return bouwVerlofsaldo({ users, leave, extraFeestdagen: extra }, filters);
  },
};

export function mountRapportRoutes(app: express.Express) {
  app.get("/api/rapporten/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    const def = rapportVan(req.params.id);
    const lader = def ? RAPPORT_LADERS[def.id] : undefined;
    if (!def || !lader) return res.status(404).json({ error: "Dit rapport bestaat niet." });

    const filters = valideerRecord(res, filterSchemaVoor(def), req.query ?? {});
    if (!filters) return;

    try {
      const { rijen, bereik } = await lader(filters);
      const antwoord: RapportAntwoord = { rijen, totalen: berekenTotalen(def, rijen), bereik, gegenereerdOp: new Date().toISOString() };
      res.setHeader("Cache-Control", "no-store");
      res.json(antwoord);
    } catch (err) {
      console.error(`Rapport ${def.id} laden is mislukt.`, err);
      res.status(500).json({ error: "Het rapport kon niet geladen worden." });
    }
  });
}
