/**
 * Zuivere regels rond de bijlagen van omleidingen en updates: welke logregel
 * een verwijdering bewijst, en bij welke records een bestandsnaam kan horen.
 * Gedeeld door de schrijfkern (recordWrites.ts), het herstel na "Ongedaan
 * maken" (bijlagenHerstel.ts) en de uitgestelde opruiming (bijlagenOpruim.ts),
 * zodat schrijver en lezers niet uit elkaar kunnen groeien. Bewust een module
 * zonder imports: recordWrites.ts mag er de opslaglaag niet extra door laden.
 */

/** De logactie waarmee een verwijderde omleiding of update wordt vastgelegd. */
export const VERWIJDERD_ACTIE = { diversion: "Omleiding verwijderd", update: "Update verwijderd" } as const;

/**
 * Hoe lang na een verwijdering "Ongedaan maken" de bijlagen nog mag
 * terughangen. De toast met de knop staat 6 seconden in beeld
 * (ONGEDAAN_DUUR_MS in src/components/ToastStack.tsx); vijf minuten is daar
 * ruim vijftig keer zoveel en vangt een trage verbinding, een telefoon die
 * even sliep en een herhaald verzoek op. Langer hoeft niet en mag niet: het
 * id in het verzoek komt van de client, en hoe langer het venster, hoe langer
 * een oud id bruikbaar blijft om bestanden aan een nieuw record te hangen.
 */
export const HERSTEL_VENSTER_MS = 5 * 60_000;
/** Speling voor klokken van twee serverinstanties die niet gelijk lopen. */
export const KLOK_SPELING_MS = 60_000;

/** Eén regel uit het activiteitenlog, zoals de bijlagen hem nodig hebben. */
export type BijlageLogregel = { entityId: string; action: string; createdAt: string };

/**
 * De record-id's waar deze bestandsnaam bij kan horen; leeg = geen bijlage in
 * onze vorm, dus afblijven. Een naam kan dubbelzinnig zijn: `o-1.pdf` is
 * slot 1 van omleiding `o`, maar ook de oude sleutel (van vóór 25-09) van een
 * omleiding met id `o-1`. Wie een bestand verhuist, terughangt of weggooit
 * houdt rekening met ELKE mogelijke eigenaar.
 */
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

/**
 * Is de LAATSTE logregel van dit id een verwijdering? Geeft het moment, of
 * null. Een verwijdering van vroeger telt niet als er daarna nog iets gelogd
 * is (hersteld, gewijzigd, bijlage toegevoegd): dan bestaat het record weer.
 * Twijfel is null: een onleesbaar tijdstip, of een verwijdering die op
 * dezelfde milliseconde staat als een andere regel.
 */
export const laatsteVerwijdering = (regels: ReadonlyArray<BijlageLogregel>, id: string, actie: string): { op: number } | null => {
  const eigen = regels.filter((r) => r.entityId === id);
  if (eigen.length === 0) return null;
  const tijden = eigen.map((r) => Date.parse(r.createdAt));
  if (tijden.some((t) => !Number.isFinite(t))) return null;
  const laatste = Math.max(...tijden);
  const opLaatste = eigen.filter((_, i) => tijden[i] === laatste);
  return opLaatste.every((r) => r.action === actie) ? { op: laatste } : null;
};

/** Heeft het log regels over dit id? */
export const heeftLogregels = (regels: ReadonlyArray<BijlageLogregel>, id: string): boolean => regels.some((r) => r.entityId === id);

/**
 * Het uploadmoment van één bijlage (ISO), zoals alleen de server het zet: bij
 * een upload de servertijd, bij een herstel of een verhuis het tijdstip dat
 * Storage bij het bestand bijhoudt (`updated_at`, anders `created_at`). Het
 * maakt een vervanging met dezelfde naam en grootte herkenbaar voor de cache
 * van de client (bijlageVersie in src/lib/bijlageCache.ts). Wat geen leesbaar
 * tijdstip is valt weg: een element zonder uploadmoment blijft overal geldig,
 * de client valt dan terug op naam en grootte.
 */
export const uploadMoment = (waarde: unknown): string | undefined =>
  typeof waarde === "string" && waarde.trim() !== "" && Number.isFinite(Date.parse(waarde)) ? waarde : undefined;
