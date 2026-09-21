import type express from "express";
import { authenticate, requireRole } from "../middleware.js";
import type { AuthenticatedRequest } from "../types.js";
import { rapportVan } from "../../shared/rapporten/register.js";
import { filterSchemaVoor } from "../../shared/rapporten/filterSchema.js";
import { totalenVoor } from "../../shared/rapporten/opmaak.js";
import type { RapportAntwoord, RapportLader } from "../../shared/rapporten/types.js";
import { valideerRecord } from "./valideer.js";
import { VERLOF_LADERS, ZIEKTE_LADERS } from "./rapporten/ladersZiekteVerlof.js";
import { VOERTUIG_LADERS } from "./rapporten/voertuigLaders.js";
import { PERSONEEL_LADERS } from "./rapporten/personeelLaders.js";

/**
 * Rapporten (20-09): één namespace, GET /api/rapporten/:id. De definitie van
 * een rapport staat in shared/rapporten/register.ts; waar de bron vandaan komt
 * staat per domein in api/_lib/rapporten/ (ladersZiekteVerlof.ts, voertuigLaders.ts,
 * personeelLaders.ts). Het rekenwerk zelf
 * is een pure functie in api/_lib/rapporten/ (bron + filters → rijen + bereik),
 * de route vult totalen en tijdstip aan.
 *
 * Staf-only. Filters komen uit de querystring en gaan door het zod-schema dat
 * uit de definitie volgt (400 met veldfouten; een periode is hooguit 366
 * dagen). Geen PDF op de server: afdrukken gebeurt in de browser, zodat deze
 * functie geen zware bibliotheek hoeft te laden (koude start).
 */

/**
 * Nieuw rapport = één regel in de laderstabel van zijn domein (naast de
 * definitie en de pure laadfunctie); hier worden die tabellen alleen
 * samengevoegd. Geëxporteerd voor de pariteitstest: elk rapport in het register
 * heeft een lader en omgekeerd (src/rapportRoutes.test.ts).
 */
export const RAPPORT_LADERS: Record<string, RapportLader> = {
  ...VERLOF_LADERS,
  ...ZIEKTE_LADERS,
  ...VOERTUIG_LADERS,
  ...PERSONEEL_LADERS,
};

export function mountRapportRoutes(app: express.Express) {
  app.get("/api/rapporten/:id", authenticate, requireRole("planner", "admin"), async (req: AuthenticatedRequest, res) => {
    const def = rapportVan(req.params.id);
    const lader = def ? RAPPORT_LADERS[def.id] : undefined;
    if (!def || !lader) return res.status(404).json({ error: "Dit rapport bestaat niet." });

    const filters = valideerRecord(res, filterSchemaVoor(def), req.query ?? {});
    if (!filters) return;

    try {
      const { rijen, bereik, kolommen, totalen, peildatum } = await lader(filters);
      const antwoord: RapportAntwoord = {
        rijen,
        ...(kolommen ? { kolommen } : {}),
        // De totaalrij volgens de (eventueel meegeleverde) kolommen: som, kleinste, grootste of
        // gemiddelde uit de definitie; wat niet uit de rijen te rekenen is (unieke chauffeurs
        // over de hele periode) geeft de lader zelf mee, en dat wint per kolom.
        totalen: totalenVoor(def, rijen, { kolommen, vanLader: totalen }),
        bereik,
        ...(peildatum ? { peildatum } : {}),
        gegenereerdOp: new Date().toISOString(),
      };
      res.setHeader("Cache-Control", "no-store");
      res.json(antwoord);
    } catch (err) {
      console.error(`Rapport ${def.id} laden is mislukt.`, err);
      res.status(500).json({ error: "Het rapport kon niet geladen worden." });
    }
  });
}
