import { MELDING_SOORTEN, type MeldingSoort } from './meldingSoorten.js';

/**
 * Zod-vrije kant van de dashboardvoorkeuren (schema: shared/schemas/
 * dashboardVoorkeuren.ts). De startschermen (dashboard, Mijn dag, rooster)
 * lezen de voorkeuren bij hun eerste render; met het schema erbij sleepten ze
 * zod-vendor (85 kB) statisch mee. Hier staan de constanten, de types en een
 * lichte parser met dezélfde regels als het schema; de pariteit is getest in
 * shared/schemas/dashboardVoorkeuren.test.ts en de types worden daar tegen
 * `z.output` van het schema gelegd. Het schemabestand exporteert de
 * constanten door, dus `api/` merkt hier niets van.
 *
 * Regel bij een schemawijziging: eerst het schema, dan deze parser, dan de
 * pariteitstest (die faalt zolang ze uiteenlopen).
 */

/** Schermen die als startscherm te kiezen zijn (views uit src/app/routes.tsx). */
export const STARTSCHERMEN = ['dashboard', 'mijn-dag', 'rooster'] as const;
export type Startscherm = (typeof STARTSCHERMEN)[number];

/** Soorten die een gebruiker kan uitzetten; 'systeem' komt altijd. */
export const UITZETBARE_MELDING_SOORTEN: readonly MeldingSoort[] = MELDING_SOORTEN.filter((s) => s !== 'systeem');

export type DashboardVoorkeuren = {
  /** Tegels die de gebruiker verbergt (essentiële tegels negeren dit). */
  verborgen: string[];
  /** Gewenste volgorde; ids die ontbreken volgen erna in de standaardvolgorde. */
  volgorde: string[];
  /** Startscherm van de app; ontbreekt = de laatst geopende pagina. */
  startscherm?: Startscherm;
  /** Soorten waarvoor geen push gestuurd wordt (de melding zelf blijft). */
  meldingssoortenUit?: MeldingSoort[];
  documentenGezienOp?: string;
  verlofGezienOp?: string;
};

/** Deelwijziging vanuit één scherm: alleen de meegegeven sleutels tellen;
 *  `null` wist een optionele voorkeur (terug naar het standaardgedrag). */
export type DashboardVoorkeurenPatch = {
  verborgen?: string[];
  volgorde?: string[];
  startscherm?: Startscherm | null;
  meldingssoortenUit?: MeldingSoort[] | null;
  documentenGezienOp?: string | null;
  verlofGezienOp?: string | null;
};

export const LEGE_DASHBOARD_VOORKEUREN: DashboardVoorkeuren = { verborgen: [], volgorde: [] };

const TEGEL_ID = /^[a-z0-9-]+$/;
// Zelfde vorm als z.iso.datetime(): UTC met Z, seconden verplicht, fractie vrij.
const ISO_TIJDSTIP = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

const tegelIds = (waarde: unknown): string[] | null => {
  if (waarde === undefined) return [];
  if (!Array.isArray(waarde) || waarde.length > 50) return null;
  const uit: string[] = [];
  for (const ruw of waarde) {
    if (typeof ruw !== 'string') return null;
    const id = ruw.trim();
    if (id.length < 1 || id.length > 40 || !TEGEL_ID.test(id)) return null;
    uit.push(id);
  }
  return uit;
};

const isTijdstip = (waarde: unknown): waarde is string => {
  if (typeof waarde !== 'string') return false;
  const m = ISO_TIJDSTIP.exec(waarde);
  if (!m) return false;
  // Bestaande kalenderdag (geen 30 februari), net als het schema.
  const [jaar, maand, dag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(jaar, maand - 1, dag));
  d.setUTCFullYear(jaar); // jaren < 100 niet naar 19xx laten schuiven
  return d.getUTCMonth() === maand - 1 && d.getUTCDate() === dag;
};

/**
 * Onbekende invoer (profiel uit /api/me, PATCH-antwoord, localStorage) →
 * geldige voorkeuren of null. Zelfde uitkomst als `parseDashboardVoorkeuren`
 * (het zod-schema): onbekende sleutels vallen weg, tegel-ids worden getrimd,
 * één ongeldige waarde maakt het geheel ongeldig.
 */
export const parseDashboardVoorkeurenLos = (waarde: unknown): DashboardVoorkeuren | null => {
  if (!waarde || typeof waarde !== 'object' || Array.isArray(waarde)) return null;
  const bron = waarde as Record<string, unknown>;
  const verborgen = tegelIds(bron.verborgen);
  const volgorde = tegelIds(bron.volgorde);
  if (!verborgen || !volgorde) return null;
  const uit: DashboardVoorkeuren = { verborgen, volgorde };
  if (bron.startscherm !== undefined) {
    if (!(STARTSCHERMEN as readonly unknown[]).includes(bron.startscherm)) return null;
    uit.startscherm = bron.startscherm as Startscherm;
  }
  if (bron.meldingssoortenUit !== undefined) {
    const lijst = bron.meldingssoortenUit;
    if (!Array.isArray(lijst) || lijst.length > 20) return null;
    if (!lijst.every((s) => (UITZETBARE_MELDING_SOORTEN as readonly unknown[]).includes(s))) return null;
    uit.meldingssoortenUit = [...lijst] as MeldingSoort[];
  }
  for (const sleutel of ['documentenGezienOp', 'verlofGezienOp'] as const) {
    if (bron[sleutel] === undefined) continue;
    if (!isTijdstip(bron[sleutel])) return null;
    uit[sleutel] = bron[sleutel] as string;
  }
  return uit;
};
