import type { RapportFilters, RapportResultaat } from "../../../shared/rapporten/types.js";

/**
 * Eén lader per rapport-id: haalt de bron op en geeft ze aan de pure
 * laadfunctie. Elk domein houdt zijn laders in een eigen bestand
 * (`<domein>Laders.ts`); api/_lib/rapportRoutes.ts voegt ze samen in
 * `RAPPORT_LADERS`.
 */
export type Lader = (filters: RapportFilters) => Promise<RapportResultaat>;

/** De kalenderdag in België, waartegen een rapport met een peildatum rekent (de server draait op UTC). */
export const vandaagInBelgie = (nu: Date = new Date()): string => nu.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
