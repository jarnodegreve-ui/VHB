/**
 * Zuivere kern van scripts/omleiding-pdf-backfill.mjs: beslissen wat er per
 * omleiding moet gebeuren, en het plan uitvoeren met de verhuisfuncties die
 * het script aanreikt (api/storage.ts). Geen netwerk, geen env: getest in
 * src/lib/omleidingPdfBackfill.test.ts.
 */
import { mogelijkeEigenaars } from '../api/_lib/bijlagenActies.ts';

/** Hoogstens vijf PDF's per omleiding (MAX_OMLEIDING_BIJLAGEN in
 *  shared/schemas/diversion.ts; de test bewaakt dat ze gelijk blijven). */
export const MAX_SLOT = 5;

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
  conflict: 'niet eenduidig: <id>.pdf en <id>-1.pdf hangen er allebei, of het bestand kan volgens zijn naam ook van een andere bestaande omleiding zijn. Met de hand nakijken',
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
  const bestaandeIds = new Set(omleidingen.map((o) => String(o.id ?? '')));
  // Een naam kan bij twee omleidingen horen: `x-1.pdf` is de oude sleutel van
  // een id `x-1`, maar ook slot 1 van een id `x`. Bestaat die andere
  // omleiding, dan is niet uit te maken van wie het bestand is.
  const ookVanEenAnder = (naam, id) => mogelijkeEigenaars(naam, MAX_SLOT, true).some((eigenaar) => eigenaar !== id && bestaandeIds.has(eigenaar));
  return omleidingen.map((o) => {
    const id = String(o.id ?? '');
    const titel = String(o.title ?? '');
    if (Array.isArray(o.bijlagen) && o.bijlagen.length > 0) return { id, titel, actie: 'klaar' };
    if (!o.pdfUrl) return { id, titel, actie: 'geen-pdf' };
    if (!STORAGE_ID.test(id)) return { id, titel, actie: 'ongeldig-id' };
    const oud = perNaam.get(`${id}.pdf`);
    const nieuw = perNaam.get(`${id}-1.pdf`);
    if (oud && nieuw) return { id, titel, actie: 'conflict' };
    if (oud && ookVanEenAnder(`${id}.pdf`, id)) return { id, titel, actie: 'conflict' };
    if (nieuw && ookVanEenAnder(`${id}-1.pdf`, id)) return { id, titel, actie: 'conflict' };
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

/** Leunt in dit plan nog iets op de oude sleutel? Zegt alleen iets over wat
 *  het script GEZIEN heeft; het eindoordeel is `oordeelStap2`.
 *  @param {PlanRegel[]} plan */
export const stap2Veilig = (plan) => plan.every((regel) => !BLOKKEERT_STAP_2.includes(regel.actie));

/** Paginagrootte van de lijsten (PAGE_SIZE in api/storage.ts). */
export const PAGINA = 1000;

/**
 * Heeft het script ALLE omleidingen en ALLE bestanden gezien? Een lijst die
 * zonder fout te kort is, is van buitenaf niet te zien aan de lijst zelf:
 *  - omleidingen: het aantal gelezen rijen moet gelijk zijn aan een aparte,
 *    exacte telling van de tabel. Zonder telling is een volle pagina
 *    (precies 1000, 2000, …) verdacht, en zonder telling is er hoe dan ook
 *    geen zekerheid;
 *  - bestanden: de lijst moet op een lege pagina geëindigd zijn.
 *
 * @param {{ omleidingenGelezen: number, omleidingenGeteld: number | null, bestandenTotLegePagina: boolean }} stand
 * @returns {{ zeker: boolean, redenen: string[] }}
 */
export function leesZekerheid({ omleidingenGelezen, omleidingenGeteld, bestandenTotLegePagina }) {
  const redenen = [];
  if (typeof omleidingenGeteld !== 'number' || !Number.isFinite(omleidingenGeteld)) {
    redenen.push(omleidingenGelezen > 0 && omleidingenGelezen % PAGINA === 0
      ? `precies ${omleidingenGelezen} omleidingen gelezen (een volle pagina) en de database gaf geen telling: de lijst kan afgekapt zijn`
      : 'de database gaf geen telling van de omleidingen, dus niet na te gaan of de lijst volledig is');
  } else if (omleidingenGeteld !== omleidingenGelezen) {
    redenen.push(`${omleidingenGelezen} omleidingen gelezen, maar de database telt er ${omleidingenGeteld}: de lijst is niet volledig`);
  }
  if (!bestandenTotLegePagina) redenen.push('de lijst van de bestanden in Storage eindigde niet op een lege pagina: ze kan afgekapt zijn');
  return { zeker: redenen.length === 0, redenen };
}

/**
 * Het eindoordeel onderaan de uitvoer. "Stap 2 is veilig" verschijnt alleen
 * als het plan niets meer op de oude sleutel laat leunen EN het script zeker
 * is dat het alles gezien heeft.
 *
 * @param {PlanRegel[]} plan
 * @param {{ zeker: boolean, redenen: string[] }} zekerheid
 * @returns {{ veilig: boolean, tekst: string }}
 */
export function oordeelStap2(plan, zekerheid) {
  if (!zekerheid.zeker) {
    return {
      veilig: false,
      tekst: `Stap 2 is NOG NIET veilig: het script is niet zeker dat het alles gezien heeft (${zekerheid.redenen.join('; ')}).`,
    };
  }
  if (!stap2Veilig(plan)) {
    return { veilig: false, tekst: 'Stap 2 is NIET veilig: er leunen nog omleidingen op de oude sleutel, zie de regels hierboven.' };
  }
  return { veilig: true, tekst: 'Stap 2 is veilig: geen enkele omleiding leunt nog op de oude sleutel.' };
}

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
