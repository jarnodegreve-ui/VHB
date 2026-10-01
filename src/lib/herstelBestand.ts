import { HERSTEL_LIJSTEN } from '../../shared/herstelPlan';

/**
 * Wat van een back-upbestand naar POST /api/restore gaat (01-10).
 *
 * Een Vercel-functie neemt hoogstens 4,5 MB request body aan (zie
 * bestandInpakken.ts). De nachtelijke back-up was op 01-10 al 2,4 MB en groeit
 * ±29 kB per dag, dus rond half december paste hij niet meer in één verzoek
 * en gaf het herstel 413 "te groot". Driekwart van het bestand is het
 * activiteitenlog, dat een herstel bewust nooit terugzet (restoreFromBackup in
 * api/storage.ts: geschiedenis, geen staat), en ook de referentie-exports
 * (authUsers, ocpiRegistration, userDocuments, ritblaadje) leest de route niet.
 * Daarom gaat alleen mee wat het herstel kent: de lijsten van HERSTEL_LIJSTEN
 * en de dekkingsverwachting. Een collectie die niet in het bestand zit blijft
 * ook hier weg, want ontbrekend betekent voor de server "ongemoeid laten".
 */
const HERSTEL_SLEUTELS: ReadonlySet<string> = new Set([...HERSTEL_LIJSTEN, 'coverageExpectations']);

export type HerstelBestand = { exportedAt?: unknown; version?: unknown; collections: Record<string, unknown> };

export function herstelVerzending(bestand: HerstelBestand): HerstelBestand {
  const collections: Record<string, unknown> = {};
  for (const [sleutel, waarde] of Object.entries(bestand.collections)) {
    if (HERSTEL_SLEUTELS.has(sleutel)) collections[sleutel] = waarde;
  }
  return {
    ...(bestand.exportedAt !== undefined ? { exportedAt: bestand.exportedAt } : {}),
    ...(bestand.version !== undefined ? { version: bestand.version } : {}),
    collections,
  };
}
