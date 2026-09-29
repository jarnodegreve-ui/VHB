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
 * Twee vangrails erbij (tegenlezing 29-09). Het id in het verzoek komt van
 * de client, dus de header alleen bewijst niets:
 *
 *  1. `herstelBewezen`: bijlagen gaan alleen terug als het activiteitenlog
 *     een verwijdering van precies dit id en dit type kent, als laatste regel
 *     en binnen HERSTEL_VENSTER_MS. Zonder dat bewijs is het een gewone
 *     opslag: niets terughangen, niets verhuizen.
 *  2. Een bestandsnaam kan bij twee records horen (`o-1-2.pdf` is slot 2 van
 *     omleiding `o-1`, maar ook de oude sleutel van een id `o-1-2`). Bestaat
 *     de andere mogelijke eigenaar, dan blijft het bestand waar het is.
 *
 * Best-effort: het record is op dit punt al hersteld. Lukt een controle niet,
 * dan komt het record zonder bijlagen terug en zegt de toast dat eerlijk.
 */
import { MAX_OMLEIDING_BIJLAGEN } from "../../shared/schemas/diversion.js";
import { MAX_UPDATE_BIJLAGEN } from "../../shared/schemas/update.js";
import { bijlagenUitKolom } from "../helpers.js";
import { HERSTEL_VENSTER_MS, KLOK_SPELING_MS, VERWIJDERD_ACTIE, laatsteVerwijdering, mogelijkeEigenaars } from "./bijlagenActies.js";
import {
  bestaandeDiversionBijlagen,
  bestaandeRecordIds,
  bestaandeUpdateBijlagen,
  diversionBijlagePad,
  diversionLegacyPad,
  logregelsVanEntiteiten,
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

/**
 * Kent het log een verwijdering van precies dit record, als laatste regel en
 * binnen het herstelvenster? Moet gevraagd worden VOOR het record opnieuw
 * wordt opgeslagen: die opslag schrijft zelf een logregel. Elke twijfel
 * (log niet te lezen, vreemd id) is nee.
 */
export const herstelBewezen = async (soort: "diversion" | "update", id: string, nu: number = Date.now()): Promise<boolean> => {
  try {
    if (!STORAGE_ID.test(id)) return false;
    const verwijderd = laatsteVerwijdering(await logregelsVanEntiteiten(soort, [id]), id, VERWIJDERD_ACTIE[soort]);
    if (!verwijderd) return false;
    const geleden = nu - verwijderd.op;
    return geleden >= -KLOK_SPELING_MS && geleden <= HERSTEL_VENSTER_MS;
  } catch (err: any) {
    console.warn("Herstel: het log is niet te lezen, de bijlagen blijven waar ze zijn.", err?.message || err);
    return false;
  }
};

/** Hangt de PDF's van een herstelde omleiding terug; geeft het aantal. Alleen
 *  aanroepen na `herstelBewezen`. */
export const herstelOmleidingBijlagen = async (id: string, vanClient: unknown): Promise<number> => {
  try {
    if (!STORAGE_ID.test(id)) return 0;
    const gevraagd = gevraagdeBijlagen(vanClient, MAX_OMLEIDING_BIJLAGEN);
    if (gevraagd.length === 0) return 0;
    const aanwezig = await bestaandeDiversionBijlagen(id);
    const kandidaten = aanwezig.slots.filter((s) => gevraagd.some((g) => g.slot === s.slot));
    // Een PDF van vóór 25-09 hangt op `<id>.pdf` en telde als slot 1: die
    // verhuist naar `<id>-1.pdf`, want de lijst kent geen oude sleutel.
    const wilVerhuizen = aanwezig.oudeSleutel && !aanwezig.slots.some((s) => s.slot === 1) && gevraagd.some((g) => g.slot === 1);

    // Elke naam die we willen aanraken kan ook van een ander record zijn.
    // Bestaat dat record, dan blijft het bestand van hem. De gerichte lezing
    // gooit bij een fout: dan vangt de catch onderaan en gebeurt er niets.
    const andereEigenaars = (naam: string) => mogelijkeEigenaars(naam, MAX_OMLEIDING_BIJLAGEN, true).filter((eigenaar) => eigenaar !== id);
    const namen = [...kandidaten.map((s) => diversionBijlagePad(id, s.slot)), ...(wilVerhuizen ? [diversionLegacyPad(id)] : [])];
    const bestaat = await bestaandeRecordIds("diversions", [...new Set(namen.flatMap(andereEigenaars))]);
    const vrij = (naam: string) => !andereEigenaars(naam).some((eigenaar) => bestaat.has(eigenaar));

    const slots = kandidaten.filter((s) => vrij(diversionBijlagePad(id, s.slot)));
    if (wilVerhuizen && vrij(diversionLegacyPad(id))) {
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

/** Hangt de PDF's van een herstelde update terug; geeft het aantal. Alleen
 *  aanroepen na `herstelBewezen`. Updates kennen geen oude sleutel, dus een
 *  naam `<id>-<slot>.pdf` heeft hier maar één mogelijke eigenaar. */
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
