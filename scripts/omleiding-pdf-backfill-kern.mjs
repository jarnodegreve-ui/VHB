/**
 * Zuivere kern van scripts/omleiding-pdf-backfill.mjs: beslissen wat er per
 * omleiding moet gebeuren, en het plan uitvoeren met de verhuisfuncties die
 * het script aanreikt (api/storage.ts). Geen netwerk, geen env: getest in
 * src/lib/omleidingPdfBackfill.test.ts.
 */

/** Bestandsnaam van een PDF van vóór 25-09: die is nooit bewaard. Moet
 *  gelijk zijn aan LEGACY_OMLEIDING_PDF_NAAM in api/helpers.ts (test bewaakt
 *  het), zodat de chauffeur vóór en na de verhuis dezelfde naam ziet. */
export const OUDE_PDF_NAAM = 'omleiding.pdf';

/** Zelfde strakke vorm als de bijlage-routes: het id wordt de sleutel. */
const STORAGE_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * @typedef {'klaar' | 'geen-pdf' | 'verhuizen' | 'lijst-herstellen' | 'conflict' | 'marker-zonder-bestand' | 'ongeldig-id'} Actie
 * @typedef {{ id: string, titel: string, actie: Actie, sizeBytes?: number }} PlanRegel
 */

export const ACTIE_UITLEG = {
  klaar: 'heeft al een bijlagenlijst',
  'geen-pdf': 'heeft geen PDF',
  verhuizen: '<id>.pdf naar <id>-1.pdf, lijst schrijven, marker op null',
  'lijst-herstellen': '<id>-1.pdf hangt er al, alleen de lijst schrijven en de marker op null',
  conflict: '<id>.pdf en <id>-1.pdf hangen er allebei, met de hand nakijken',
  'marker-zonder-bestand': 'marker gezet maar geen bestand in Storage, er valt niets te verhuizen',
  'ongeldig-id': 'id met tekens die geen storage-sleutel mogen zijn, overgeslagen',
};

/** De acties die het script met --schrijf uitvoert. */
export const SCHRIJF_ACTIES = ['verhuizen', 'lijst-herstellen'];
/** De acties die stap 2 (de overgangslaag schrappen) tegenhouden. */
export const BLOKKEERT_STAP_2 = ['verhuizen', 'lijst-herstellen', 'conflict', 'ongeldig-id'];

/**
 * Per omleiding de actie. `omleidingen` zoals getDiversionsData ze geeft
 * (pdfUrl = marker, bijlagen = lijst); `bestanden` = wat er in de bucket
 * `diversions` hangt (naam, grootte).
 *
 * @param {Array<{ id: unknown, title?: unknown, pdfUrl?: unknown, bijlagen?: unknown }>} omleidingen
 * @param {Array<{ naam: string, sizeBytes?: number }>} bestanden
 * @returns {PlanRegel[]}
 */
export function planBackfill(omleidingen, bestanden) {
  const perNaam = new Map(bestanden.map((b) => [b.naam, b]));
  return omleidingen.map((o) => {
    const id = String(o.id ?? '');
    const titel = String(o.title ?? '');
    if (Array.isArray(o.bijlagen) && o.bijlagen.length > 0) return { id, titel, actie: 'klaar' };
    if (!o.pdfUrl) return { id, titel, actie: 'geen-pdf' };
    if (!STORAGE_ID.test(id)) return { id, titel, actie: 'ongeldig-id' };
    const oud = perNaam.get(`${id}.pdf`);
    const nieuw = perNaam.get(`${id}-1.pdf`);
    if (oud && nieuw) return { id, titel, actie: 'conflict' };
    if (oud) return { id, titel, actie: 'verhuizen', ...(oud.sizeBytes !== undefined ? { sizeBytes: oud.sizeBytes } : {}) };
    if (nieuw) return { id, titel, actie: 'lijst-herstellen', ...(nieuw.sizeBytes !== undefined ? { sizeBytes: nieuw.sizeBytes } : {}) };
    return { id, titel, actie: 'marker-zonder-bestand' };
  });
}

/** Aantal per actie, elke actie aanwezig (ook met 0).
 *  @param {PlanRegel[]} plan */
export function telPlan(plan) {
  /** @type {Record<Actie, number>} */
  const uit = { klaar: 0, 'geen-pdf': 0, verhuizen: 0, 'lijst-herstellen': 0, conflict: 0, 'marker-zonder-bestand': 0, 'ongeldig-id': 0 };
  for (const regel of plan) uit[regel.actie] += 1;
  return uit;
}

/** Is de overgangslaag voor deze stand nog nodig?
 *  @param {PlanRegel[]} plan */
export const stap2Veilig = (plan) => plan.every((regel) => !BLOKKEERT_STAP_2.includes(regel.actie));

/**
 * Het plan uitvoeren. `verplaats` en `zetLijst` zijn de bestaande functies
 * uit api/storage.ts (verplaatsDiversionLegacyBijlage, zetDiversionBijlagen);
 * zetLijst zet de marker "pdfUrl" zelf op null. Een fout bij één omleiding
 * stopt de rest niet: een volgende run pakt ze op (verhuisd zonder lijst
 * wordt dan "lijst-herstellen").
 *
 * @param {PlanRegel[]} plan
 * @param {{ verplaats: (id: string) => Promise<void>, zetLijst: (id: string, lijst: Array<{ slot: number, filename: string, sizeBytes?: number }>) => Promise<void>, meld?: (tekst: string) => void }} doe
 */
export async function voerBackfillUit(plan, doe) {
  const uit = { verhuisd: 0, hersteld: 0, mislukt: /** @type {Array<{ id: string, fout: string }>} */ ([]) };
  for (const regel of plan) {
    if (!SCHRIJF_ACTIES.includes(regel.actie)) continue;
    try {
      if (regel.actie === 'verhuizen') await doe.verplaats(regel.id);
      await doe.zetLijst(regel.id, [{ slot: 1, filename: OUDE_PDF_NAAM, ...(regel.sizeBytes !== undefined ? { sizeBytes: regel.sizeBytes } : {}) }]);
      if (regel.actie === 'verhuizen') uit.verhuisd += 1;
      else uit.hersteld += 1;
      doe.meld?.(`  ✓ ${regel.id}  ${regel.actie}`);
    } catch (err) {
      const fout = err instanceof Error ? err.message : String(/** @type {{ message?: unknown }} */ (err)?.message ?? err);
      uit.mislukt.push({ id: regel.id, fout });
      doe.meld?.(`  ✗ ${regel.id}  ${regel.actie} mislukt: ${fout}`);
    }
  }
  return uit;
}
