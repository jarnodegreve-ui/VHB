/**
 * Bijlagen terughangen na "Ongedaan maken" (29-09, controle-ronde nr. 12).
 *
 * Het herstel post het verwijderde record opnieuw (`X-Herstel: 1`), met de
 * bijlagenlijst die de client nog kende. De veiligheidsregel blijft: de
 * server bouwt elk pad zelf uit id en slot en gebruikt nooit een pad of URL
 * van de client. Van de client komt alleen de bestandsnaam als etiket, en
 * alleen voor een slot waarvan de server zelf vaststelt dat het bestand nog
 * in Storage hangt. De grootte komt uit Storage.
 *
 * Best-effort: het record is op dit punt al hersteld. Lukt de controle niet,
 * dan komt het record zonder bijlagen terug en zegt de toast dat eerlijk.
 */
import { MAX_OMLEIDING_BIJLAGEN } from "../../shared/schemas/diversion.js";
import { MAX_UPDATE_BIJLAGEN } from "../../shared/schemas/update.js";
import { bijlagenUitKolom } from "../helpers.js";
import {
  bestaandeDiversionBijlagen,
  bestaandeUpdateBijlagen,
  verplaatsDiversionLegacyBijlage,
  zetDiversionBijlagen,
  zetUpdateBijlagen,
} from "../storage.js";

/** Zelfde strakke vorm als de bijlage-routes: het id wordt de sleutel. */
const STORAGE_ID = /^[a-zA-Z0-9_-]+$/;

type Bijlage = { slot: number; filename: string; sizeBytes?: number };

/** Wat de client zich herinnert, opgeschoond: alleen slot en een naam op
 *  .pdf, nooit een URL of pad. */
const gevraagdeBijlagen = (vanClient: unknown, maxSlot: number): Bijlage[] =>
  bijlagenUitKolom(vanClient, maxSlot)
    .map((b) => ({ slot: b.slot, filename: b.filename.trim() }))
    .filter((b) => b.filename.toLowerCase().endsWith(".pdf") && !/[\\/]/.test(b.filename));

const doorsnede = (gevraagd: Bijlage[], aanwezig: Array<{ slot: number; sizeBytes?: number }>): Bijlage[] => {
  const perSlot = new Map(aanwezig.map((a) => [a.slot, a]));
  return gevraagd.flatMap((g) => {
    const gevonden = perSlot.get(g.slot);
    if (!gevonden) return [];
    return [{ slot: g.slot, filename: g.filename, ...(gevonden.sizeBytes !== undefined ? { sizeBytes: gevonden.sizeBytes } : {}) }];
  });
};

/** Hangt de PDF's van een herstelde omleiding terug; geeft het aantal. */
export const herstelOmleidingBijlagen = async (id: string, vanClient: unknown): Promise<number> => {
  try {
    if (!STORAGE_ID.test(id)) return 0;
    const gevraagd = gevraagdeBijlagen(vanClient, MAX_OMLEIDING_BIJLAGEN);
    if (gevraagd.length === 0) return 0;
    const aanwezig = await bestaandeDiversionBijlagen(id);
    const slots = [...aanwezig.slots];
    // Een PDF van vóór 25-09 hangt op `<id>.pdf` en telde als slot 1: die
    // verhuist naar `<id>-1.pdf`, want de lijst kent geen oude sleutel.
    if (aanwezig.oudeSleutel && !slots.some((s) => s.slot === 1) && gevraagd.some((g) => g.slot === 1)) {
      try {
        await verplaatsDiversionLegacyBijlage(id);
        slots.push({ slot: 1 });
      } catch (err: any) {
        console.warn("Oude omleidings-PDF verhuizen bij herstel is mislukt.", err?.message || err);
      }
    }
    const lijst = doorsnede(gevraagd, slots);
    if (lijst.length === 0) return 0;
    await zetDiversionBijlagen(id, lijst);
    return lijst.length;
  } catch (err: any) {
    console.warn("Bijlagen van de omleiding terughangen is mislukt.", err?.message || err);
    return 0;
  }
};

/** Hangt de PDF's van een herstelde update terug; geeft het aantal. */
export const herstelUpdateBijlagen = async (id: string, vanClient: unknown): Promise<number> => {
  try {
    if (!STORAGE_ID.test(id)) return 0;
    const gevraagd = gevraagdeBijlagen(vanClient, MAX_UPDATE_BIJLAGEN);
    if (gevraagd.length === 0) return 0;
    const lijst = doorsnede(gevraagd, await bestaandeUpdateBijlagen(id));
    if (lijst.length === 0) return 0;
    await zetUpdateBijlagen(id, lijst);
    return lijst.length;
  } catch (err: any) {
    console.warn("Bijlagen van de update terughangen is mislukt.", err?.message || err);
    return 0;
  }
};
