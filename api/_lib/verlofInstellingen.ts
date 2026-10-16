import { getAppSetting, getDagtypeKalender } from "../storage.js";
import { isMissingTableError } from "../deviceGate.js";
import { VERLOF_LIMIETEN_KEY, parseVerlofLimieten, type VerlofLimieten } from "../../shared/schemas/verlofLimieten.js";

/**
 * De verloflimieten zoals elke lezer ze ziet: de instellingen (standaard +
 * periodes) plus, sinds 11-10, per dag het maximum uit de dagtypekalender
 * (wint van de periodes in `limietVoorDag`). Eén plek sinds 16-10: het
 * rapport Verlofbezetting las alleen de instellingen en toonde op een dag met
 * een kalendermaximum een andere limiet dan het verlofscherm, en na het
 * opslaan van de limieten verloor het verlofscherm de kalendermaxima tot een
 * herlaad. Wie limieten nodig heeft, gaat hierdoor.
 */

/** Zet het maximum per dag uit de dagtypekalender bij de limieten. Leest de
 *  kalender niet, dan blijven de limieten zoals ze zijn (de verlofkalender
 *  moet blijven werken). */
export async function metKalenderMaxima(limieten: VerlofLimieten): Promise<VerlofLimieten> {
  try {
    const perDag: Record<string, number> = {};
    for (const d of await getDagtypeKalender()) if (d.maxVerlof !== null) perDag[d.datum] = d.maxVerlof;
    if (Object.keys(perDag).length > 0) return { ...limieten, perDag };
  } catch (err) {
    console.error("Dagtypekalender voor de verloflimieten niet gelezen.", err);
  }
  return limieten;
}

/** De limieten uit de instellingen met de kalendermaxima erbij. Zonder
 *  instellingen-tabel of bij een DB-hik de standaard: de kalender moet blijven
 *  werken, de admin ziet de fout pas bij het opslaan. */
export async function laadVerlofLimieten(): Promise<VerlofLimieten> {
  let limieten = parseVerlofLimieten(null);
  try {
    limieten = parseVerlofLimieten(await getAppSetting(VERLOF_LIMIETEN_KEY));
  } catch (err: any) {
    if (!isMissingTableError(err)) console.error("Verloflimieten laden is mislukt.", err);
  }
  return metKalenderMaxima(limieten);
}
