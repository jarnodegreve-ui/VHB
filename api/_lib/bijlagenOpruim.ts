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
 *  2. het bestand zelf is ouder dan de marge;
 *  3. geen enkel record waar de naam bij kan horen staat in de brede lijst.
 *     Een naam als `o-1.pdf` kan slot 1 van omleiding `o` zijn én de oude
 *     sleutel van omleiding `o-1`: bestaat een van beide, dan blijft het;
 *  4. een GERICHTE lezing op de id's van de kandidaten bevestigt dat geen
 *     enkele mogelijke eigenaar bestaat. De brede lijst is gepagineerd en
 *     kan zonder fout te kort zijn (de server gaf 500 van de 700 rijen);
 *     de gerichte lezing vraagt hoogstens 100 rijen op hun sleutel;
 *  5. het log bewijst de verwijdering: van minstens één mogelijke eigenaar
 *     is de LAATSTE logregel een verwijdering, ouder dan de marge, en van
 *     geen enkele mogelijke eigenaar zegt de laatste regel iets anders. Een
 *     verwijdering van vroeger telt niet meer zodra er een herstel of een
 *     andere regel op volgde: dan bestaat het record weer.
 *
 * Twijfel = laten staan: een achtergebleven PDF kost niets, een te vroeg
 * weggegooide is niet terug te halen. Mislukt een lezing of komt er een
 * antwoord dat niet past bij de vraag, dan blijft de hele bucket die nacht
 * onaangeroerd.
 *
 * Tijdsbudget: de opruiming draait in de functie van de nachtelijke back-up
 * (hoogstens 60 s). Ze krijgt ongeveer 15 s; een aanroep die blijft hangen
 * wordt losgelaten en wat niet meer aan de beurt komt blijft staan tot de
 * volgende nacht.
 */
import { MAX_OMLEIDING_BIJLAGEN } from "../../shared/schemas/diversion.js";
import { MAX_UPDATE_BIJLAGEN } from "../../shared/schemas/update.js";
import { VERWIJDERD_ACTIE, heeftLogregels, laatsteVerwijdering, mogelijkeEigenaars, type BijlageLogregel } from "./bijlagenActies.js";
import {
  DIVERSIONS_BUCKET,
  GERICHTE_LEZING_MAX,
  UPDATE_BIJLAGEN_BUCKET,
  bestaandeRecordIds,
  getDiversionsData,
  getUpdatesData,
  lijstBijlageBestanden,
  logregelsVanEntiteiten,
  verwijderBijlageBestanden,
  type BijlageBestand,
} from "../storage.js";

export { mogelijkeEigenaars };

/** Zo lang blijft een bijlage minstens staan nadat haar record verdween. */
export const WEES_MARGE_MS = 24 * 60 * 60 * 1000;
/** Rem per nacht en per bucket: een fout in de telling mag nooit in één
 *  beurt een hele bucket leegmaken. De rest volgt de nacht erna. */
export const WEES_MAX_PER_BEURT = 100;

/** Zoveel tijd krijgt de opruiming per nacht, alle buckets samen. */
export const WEES_BUDGET_MS = 15_000;
/** De functie van de back-up mag 60 s duren (vercel.json); de opruiming
 *  stopt ruim daarvoor, zodat het antwoord van de cron nog weg kan. */
const FUNCTIE_GRENS_MS = 50_000;

/**
 * Het budget van deze nacht: hoogstens WEES_BUDGET_MS (of de waarde uit
 * BIJLAGEN_OPRUIM_BUDGET_MS), en nooit meer dan wat de functie nog over
 * heeft na de back-up en de retentie. Nul = deze nacht niet opruimen.
 */
export const opruimBudget = (verstrekenMs: number, ingesteld: number = Number(process.env.BIJLAGEN_OPRUIM_BUDGET_MS)): number => {
  const plafond = Number.isFinite(ingesteld) && ingesteld > 0 ? ingesteld : WEES_BUDGET_MS;
  const rest = FUNCTIE_GRENS_MS - Math.max(0, verstrekenMs);
  return Math.max(0, Math.min(plafond, rest));
};

class TijdOp extends Error {}

/** Met minder dan dit over begint er geen nieuwe aanroep meer: een wekker
 *  loopt soms een fractie te vroeg af, en in zo weinig tijd komt toch geen
 *  antwoord. */
const MINSTENS_OVER_MS = 25;

/** Voert `werk` uit, maar wacht hoogstens tot `eindtijd` (performance.now).
 *  Is de tijd (bijna) op, dan begint het werk niet eens. */
const binnenDeTijd = async <T>(werk: () => Promise<T>, eindtijd: number): Promise<T> => {
  const rest = eindtijd - performance.now();
  if (rest < MINSTENS_OVER_MS) throw new TijdOp();
  let wekker: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      werk(),
      new Promise<never>((_, weiger) => { wekker = setTimeout(() => weiger(new TijdOp()), rest); }),
    ]);
  } finally {
    if (wekker !== undefined) clearTimeout(wekker);
  }
};

type Vorm = { maxSlot: number; metOudeSleutel: boolean };

/**
 * Stap 1, puur: welke bestanden komen in aanmerking? Naam in onze vorm, oud
 * genoeg, en geen mogelijke eigenaar in de brede lijst. Dit is nog geen
 * beslissing om te wissen, alleen de lijst waarvoor het de moeite is om
 * gericht na te kijken.
 */
export const kandidaatBijlagen = (invoer: Vorm & {
  bestanden: BijlageBestand[];
  /** De id's uit de brede lijst (kan te kort zijn, nooit te lang). */
  bekendeIds: ReadonlySet<string>;
  nu: number;
  margeMs?: number;
}): string[] => {
  const marge = invoer.margeMs ?? WEES_MARGE_MS;
  return invoer.bestanden
    .filter((bestand) => {
      const eigenaars = mogelijkeEigenaars(bestand.naam, invoer.maxSlot, invoer.metOudeSleutel);
      if (eigenaars.length === 0) return false;
      if (eigenaars.some((id) => invoer.bekendeIds.has(id))) return false;
      const gewijzigd = bestand.gewijzigdOp ? Date.parse(bestand.gewijzigdOp) : Number.NaN;
      return Number.isFinite(gewijzigd) && invoer.nu - gewijzigd >= marge;
    })
    .map((bestand) => bestand.naam);
};

/** De kandidaten van deze beurt: hoogstens WEES_MAX_PER_BEURT bestanden en
 *  hoogstens GERICHTE_LEZING_MAX id's om gericht na te kijken. */
export const begrensBeurt = (namen: string[], vorm: Vorm): { namen: string[]; ids: string[] } => {
  const gekozen: string[] = [];
  const ids = new Set<string>();
  for (const naam of namen) {
    if (gekozen.length >= WEES_MAX_PER_BEURT) break;
    const nieuw = mogelijkeEigenaars(naam, vorm.maxSlot, vorm.metOudeSleutel).filter((id) => !ids.has(id));
    if (ids.size + nieuw.length > GERICHTE_LEZING_MAX) break;
    for (const id of nieuw) ids.add(id);
    gekozen.push(naam);
  }
  return { namen: gekozen, ids: [...ids] };
};

/**
 * Stap 2, puur: welke kandidaten mogen echt weg? `bestaandeIds` komt uit de
 * gerichte lezing, `regels` zijn de logregels van de mogelijke eigenaars.
 */
export const kiesWeesBijlagen = (invoer: Vorm & {
  kandidaten: string[];
  bestaandeIds: ReadonlySet<string>;
  regels: ReadonlyArray<BijlageLogregel>;
  /** De logactie die een verwijdering van dit type vastlegt. */
  actie: string;
  nu: number;
  margeMs?: number;
}): string[] => {
  const marge = invoer.margeMs ?? WEES_MARGE_MS;
  return invoer.kandidaten.filter((naam) => {
    const eigenaars = mogelijkeEigenaars(naam, invoer.maxSlot, invoer.metOudeSleutel);
    if (eigenaars.length === 0) return false;
    if (eigenaars.some((id) => invoer.bestaandeIds.has(id))) return false;
    let bewijs = false;
    for (const id of eigenaars) {
      if (!heeftLogregels(invoer.regels, id)) continue;
      const verwijderd = laatsteVerwijdering(invoer.regels, id, invoer.actie);
      // De laatste regel van deze eigenaar is geen (oude) verwijdering: het
      // record bestaat misschien weer, of is pas weg. Afblijven.
      if (!verwijderd || invoer.nu - verwijderd.op < marge) return false;
      bewijs = true;
    }
    return bewijs;
  });
};

export type WeesOpruiming = {
  omleidingen: number;
  updates: number;
  /** Buckets die deze nacht zijn overgeslagen, met de reden. */
  overgeslagen: string[];
};

const SOORTEN = [
  { sleutel: "omleidingen", bucket: DIVERSIONS_BUCKET, tabel: "diversions", entiteit: "diversion", maxSlot: MAX_OMLEIDING_BIJLAGEN, metOudeSleutel: true, records: getDiversionsData },
  { sleutel: "updates", bucket: UPDATE_BIJLAGEN_BUCKET, tabel: "updates", entiteit: "update", maxSlot: MAX_UPDATE_BIJLAGEN, metOudeSleutel: false, records: getUpdatesData },
] as const;

/**
 * De opruimbeurt van de nachtcron. Best-effort per bucket: mislukt een
 * lezing (records, bestanden, gerichte lezing, log), dan blijft die bucket
 * deze nacht onaangeroerd. Gooit nooit en duurt nooit langer dan `budgetMs`.
 */
export const ruimWeesBijlagenOp = async (nu: number = Date.now(), opties: { budgetMs?: number } = {}): Promise<WeesOpruiming> => {
  const uit: WeesOpruiming = { omleidingen: 0, updates: 0, overgeslagen: [] };
  const eindtijd = performance.now() + (opties.budgetMs ?? WEES_BUDGET_MS);
  for (const soort of SOORTEN) {
    let aanHetWissen = false;
    try {
      const [records, bestanden] = await binnenDeTijd(() => Promise.all([soort.records(), lijstBijlageBestanden(soort.bucket)]), eindtijd);
      const kandidaten = kandidaatBijlagen({
        bestanden,
        bekendeIds: new Set((records as Array<{ id: unknown }>).map((r) => String(r.id))),
        nu,
        maxSlot: soort.maxSlot,
        metOudeSleutel: soort.metOudeSleutel,
      });
      if (kandidaten.length === 0) continue;
      // Geen enkel record gelezen maar wel bestanden: dat is niet te
      // onderscheiden van een leesprobleem, dus niets weggooien.
      if (records.length === 0) {
        uit.overgeslagen.push(`${soort.sleutel}: geen records gelezen`);
        continue;
      }
      const beurt = begrensBeurt(kandidaten, soort);
      if (beurt.namen.length === 0) continue;
      // Vlak voor het wissen: bestaat een van de mogelijke eigenaars toch, en
      // wat zegt hun laatste logregel? Beide gooien bij een fout of een
      // antwoord dat niet past: dan vangt de catch en blijft de bucket staan.
      const [bestaandeIds, regels] = await binnenDeTijd(() => Promise.all([
        bestaandeRecordIds(soort.tabel, beurt.ids),
        logregelsVanEntiteiten(soort.entiteit, beurt.ids),
      ]), eindtijd);
      const weg = kiesWeesBijlagen({
        kandidaten: beurt.namen,
        bestaandeIds,
        regels,
        actie: VERWIJDERD_ACTIE[soort.entiteit],
        nu,
        maxSlot: soort.maxSlot,
        metOudeSleutel: soort.metOudeSleutel,
      });
      if (weg.length === 0) continue;
      aanHetWissen = true;
      await binnenDeTijd(() => verwijderBijlageBestanden(soort.bucket, weg), eindtijd);
      uit[soort.sleutel] = weg.length;
    } catch (err: any) {
      if (err instanceof TijdOp) {
        // Tijdens het wissen zelf losgelaten: de aanroep loopt misschien nog
        // af, dus het aantal is niet bekend. Alles wat ze raakt was gekeurd.
        uit.overgeslagen.push(aanHetWissen ? `${soort.sleutel}: wissen liep uit, uitkomst onbekend` : `${soort.sleutel}: geen tijd meer`);
        continue;
      }
      console.warn(`[bijlagen-opruim] ${soort.sleutel} overgeslagen:`, err?.message || err);
      uit.overgeslagen.push(`${soort.sleutel}: mislukt`);
    }
  }
  return uit;
};
