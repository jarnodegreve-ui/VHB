/**
 * Uitgestelde opruiming van PDF-bijlagen (29-09, controle-ronde nr. 12).
 *
 * Een verwijderde omleiding of update nam haar PDF's vroeger meteen mee uit
 * Storage, waardoor "Ongedaan maken" het record terugbracht zonder bijlagen.
 * Nu blijven de bestanden staan en ruimt de nachtcron (`/api/cron/backup`)
 * ze op. Een bestand gaat pas weg als ALLES hieronder klopt:
 *
 *  1. de naam heeft de vorm `<id>-<slot>.pdf` (of, bij omleidingen, de oude
 *     sleutel `<id>.pdf`); al het andere in de bucket blijft onaangeroerd;
 *  2. geen enkel record waar de naam bij kan horen bestaat nog. Een naam als
 *     `o-1.pdf` kan slot 1 van omleiding `o` zijn én de oude sleutel van
 *     omleiding `o-1`: bestaat een van beide, dan blijft het bestand;
 *  3. het log bewijst dat zo'n record via het portaal verwijderd is: een
 *     bestand van onbekende herkomst blijft staan;
 *  4. op geen van die records is binnen de marge iets gelogd (verwijderd,
 *     hersteld, bijlage gewisseld), zodat een verwijdering van zonet nog
 *     ongedaan te maken is;
 *  5. het bestand zelf is ouder dan de marge.
 *
 * Twijfel = laten staan: een achtergebleven PDF kost niets, een te vroeg
 * weggegooide is niet terug te halen.
 */
import { MAX_OMLEIDING_BIJLAGEN } from "../../shared/schemas/diversion.js";
import { MAX_UPDATE_BIJLAGEN } from "../../shared/schemas/update.js";
import { VERWIJDERD_ACTIE } from "./bijlagenActies.js";
import {
  DIVERSIONS_BUCKET,
  UPDATE_BIJLAGEN_BUCKET,
  getDiversionsData,
  getUpdatesData,
  lijstBijlageBestanden,
  recentGelogdeEntiteiten,
  verwijderBijlageBestanden,
  verwijderdeEntiteiten,
  type BijlageBestand,
} from "../storage.js";

/** Zo lang blijft een bijlage minstens staan nadat haar record verdween. */
export const WEES_MARGE_MS = 24 * 60 * 60 * 1000;
/** Rem per nacht en per bucket: een fout in de telling mag nooit in één
 *  beurt een hele bucket leegmaken. De rest volgt de nacht erna. */
export const WEES_MAX_PER_BEURT = 100;

/** De record-id's waar deze bestandsnaam bij kan horen; leeg = geen bijlage
 *  in onze vorm, dus afblijven. */
export const mogelijkeEigenaars = (naam: string, maxSlot: number, metOudeSleutel: boolean): string[] => {
  const pdf = /^([^/]+)\.pdf$/.exec(naam);
  if (!pdf) return [];
  const stam = pdf[1];
  const ids: string[] = [];
  const metSlot = /^(.+)-(\d+)$/.exec(stam);
  if (metSlot) {
    const slot = Number(metSlot[2]);
    if (slot >= 1 && slot <= maxSlot) ids.push(metSlot[1]);
  }
  if (metOudeSleutel) ids.push(stam);
  return ids;
};

/** Puur: welke bestanden mogen weg? Zie de vijf voorwaarden in de kop. */
export const kiesWeesBijlagen = (invoer: {
  bestanden: BijlageBestand[];
  bestaandeIds: ReadonlySet<string>;
  /** Id's waarvan het log een verwijdering kent. */
  verwijderd: ReadonlySet<string>;
  recentGelogd: ReadonlySet<string>;
  nu: number;
  maxSlot: number;
  metOudeSleutel: boolean;
  margeMs?: number;
}): string[] => {
  const marge = invoer.margeMs ?? WEES_MARGE_MS;
  return invoer.bestanden
    .filter((bestand) => {
      const eigenaars = mogelijkeEigenaars(bestand.naam, invoer.maxSlot, invoer.metOudeSleutel);
      if (eigenaars.length === 0) return false;
      if (eigenaars.some((id) => invoer.bestaandeIds.has(id) || invoer.recentGelogd.has(id))) return false;
      if (!eigenaars.some((id) => invoer.verwijderd.has(id))) return false;
      const gewijzigd = bestand.gewijzigdOp ? Date.parse(bestand.gewijzigdOp) : Number.NaN;
      if (!Number.isFinite(gewijzigd)) return false;
      return invoer.nu - gewijzigd >= marge;
    })
    .map((bestand) => bestand.naam);
};

export type WeesOpruiming = {
  omleidingen: number;
  updates: number;
  /** Buckets die deze nacht zijn overgeslagen, met de reden. */
  overgeslagen: string[];
};

const SOORTEN = [
  { sleutel: "omleidingen", bucket: DIVERSIONS_BUCKET, entiteit: "diversion", maxSlot: MAX_OMLEIDING_BIJLAGEN, metOudeSleutel: true, records: getDiversionsData },
  { sleutel: "updates", bucket: UPDATE_BIJLAGEN_BUCKET, entiteit: "update", maxSlot: MAX_UPDATE_BIJLAGEN, metOudeSleutel: false, records: getUpdatesData },
] as const;

/**
 * De opruimbeurt van de nachtcron. Best-effort per bucket: mislukt het lezen
 * van de records, de bestanden of het log, dan blijft die bucket deze nacht
 * onaangeroerd. Gooit nooit.
 */
export const ruimWeesBijlagenOp = async (nu: number = Date.now()): Promise<WeesOpruiming> => {
  const uit: WeesOpruiming = { omleidingen: 0, updates: 0, overgeslagen: [] };
  for (const soort of SOORTEN) {
    try {
      const [records, bestanden, verwijderd, recentGelogd] = await Promise.all([
        soort.records(),
        lijstBijlageBestanden(soort.bucket),
        verwijderdeEntiteiten(soort.entiteit, VERWIJDERD_ACTIE[soort.entiteit]),
        recentGelogdeEntiteiten(soort.entiteit, new Date(nu - WEES_MARGE_MS).toISOString()),
      ]);
      const wees = kiesWeesBijlagen({
        bestanden,
        bestaandeIds: new Set((records as Array<{ id: unknown }>).map((r) => String(r.id))),
        verwijderd,
        recentGelogd,
        nu,
        maxSlot: soort.maxSlot,
        metOudeSleutel: soort.metOudeSleutel,
      });
      if (wees.length === 0) continue;
      // Geen enkel record gelezen maar wel bestanden: dat is niet te
      // onderscheiden van een leesprobleem, dus niets weggooien.
      if (records.length === 0) {
        uit.overgeslagen.push(`${soort.sleutel}: geen records gelezen`);
        continue;
      }
      const dezeBeurt = wees.slice(0, WEES_MAX_PER_BEURT);
      await verwijderBijlageBestanden(soort.bucket, dezeBeurt);
      uit[soort.sleutel] = dezeBeurt.length;
    } catch (err: any) {
      console.warn(`[bijlagen-opruim] ${soort.sleutel} overgeslagen:`, err?.message || err);
      uit.overgeslagen.push(`${soort.sleutel}: mislukt`);
    }
  }
  return uit;
};
