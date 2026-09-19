import { z } from './zod.js';
import type { MeldingSoort } from '../meldingSoorten.js';
// Constanten en de lege waarde wonen zod-vrij in shared/dashboardVoorkeuren.ts
// (de startschermen lezen ze zonder zod); hier doorgeëxporteerd zodat
// bestaande imports, ook die van `api/`, gelijk blijven.
import { LEGE_DASHBOARD_VOORKEUREN, STARTSCHERMEN, UITZETBARE_MELDING_SOORTEN, type Startscherm } from '../dashboardVoorkeuren.js';
export { LEGE_DASHBOARD_VOORKEUREN, STARTSCHERMEN, UITZETBARE_MELDING_SOORTEN, type Startscherm };

/**
 * Dashboardvoorkeuren — "Dashboard aanpassen" (next-level 2, 06-09-2026):
 * welke tegels een gebruiker verbergt en in welke volgorde hij ze wil.
 * Opgeslagen als jsonb in users.dashboardvoorkeuren, gelezen via /api/me,
 * geschreven via PATCH /api/me/voorkeuren. Eén schema valideert de body
 * server-side én normaliseert wat uit de database of localStorage komt.
 *
 * Tegel-ids zijn korte kebab-case-woorden (bv. 'vandaag', 'open-taken');
 * de catalogus per rol staat client-side (src/lib/dashboardVoorkeuren.ts).
 * Onbekende ids zijn geen fout — de client negeert ze — zodat een tegel die
 * verdwijnt of hernoemt geen opgeslagen voorkeur ongeldig maakt.
 *
 * Punt 15 (15-09): dezelfde jsonb draagt ook twee persoonlijke voorkeuren
 * die niets met tegels te maken hebben (geen migratie nodig):
 * - `startscherm`: waar de app opent (leeg = het huidige gedrag, de laatst
 *   geopende pagina).
 * - `meldingssoortenUit`: soorten waarvoor de gebruiker géén push wil. Een
 *   uit-lijst, geen aan-lijst: een soort die later bijkomt staat zo vanzelf
 *   aan, en "nooit opgeslagen" = alles aan. 'systeem' (vervaldata van je
 *   eigen attesten) is niet uit te zetten.
 * De PATCH stuurt alleen de sleutels die het scherm bezit (tegels vanuit het
 * dashboard, de rest vanuit Instellingen); de server voegt samen met wat er
 * al staat, zodat het ene scherm de voorkeur van het andere niet overschrijft.
 */
const tegelId = z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, 'Ongeldig tegel-id');

const meldingSoortUit = z.enum(UITZETBARE_MELDING_SOORTEN as [MeldingSoort, ...MeldingSoort[]]);

/** ISO-tijdstip voor de gezien-velden; soepel op de vorm (UTC met Z). */
const gezienOp = z.iso.datetime({ error: 'Ongeldig tijdstip' });

export const dashboardVoorkeurenSchema = z.object({
  /** Tegels die de gebruiker verbergt (essentiële tegels negeren dit). */
  verborgen: z.array(tegelId).max(50).default([]),
  /** Gewenste volgorde; ids die ontbreken volgen erna in de standaardvolgorde. */
  volgorde: z.array(tegelId).max(50).default([]),
  /** Startscherm van de app; ontbreekt = de laatst geopende pagina. */
  startscherm: z.enum(STARTSCHERMEN).optional(),
  /** Soorten waarvoor geen push gestuurd wordt (de melding zelf blijft). */
  meldingssoortenUit: z.array(meldingSoortUit).max(20).optional(),
  /** "Gezien tot"-tijdstippen voor de nieuw-badges (15-09). Server-side in
   *  deze jsonb i.p.v. localStorage: op een nieuw toestel of na het wissen
   *  van sitegegevens telde anders álles ooit als nieuw. */
  documentenGezienOp: gezienOp.optional(),
  verlofGezienOp: gezienOp.optional(),
});

export type DashboardVoorkeuren = z.output<typeof dashboardVoorkeurenSchema>;

/** Deelwijziging vanuit één scherm: alleen de meegegeven sleutels tellen;
 *  `null` wist een optionele voorkeur (terug naar het standaardgedrag). */
export const dashboardVoorkeurenPatchSchema = z.object({
  verborgen: z.array(tegelId).max(50).optional(),
  volgorde: z.array(tegelId).max(50).optional(),
  startscherm: z.enum(STARTSCHERMEN).nullable().optional(),
  meldingssoortenUit: z.array(meldingSoortUit).max(20).nullable().optional(),
  documentenGezienOp: gezienOp.nullable().optional(),
  verlofGezienOp: gezienOp.nullable().optional(),
});
export type DashboardVoorkeurenPatch = z.input<typeof dashboardVoorkeurenPatchSchema>;

/** Body van PATCH /api/me/voorkeuren. */
export const meVoorkeurenBodySchema = z.object({ dashboard: dashboardVoorkeurenPatchSchema });

/** Onbekende invoer (db-jsonb, localStorage) → geldige voorkeuren of null. */
export const parseDashboardVoorkeuren = (waarde: unknown): DashboardVoorkeuren | null => {
  const r = dashboardVoorkeurenSchema.safeParse(waarde);
  return r.success ? r.data : null;
};

/** Bestaande voorkeuren + een deelwijziging → de nieuwe volledige voorkeuren.
 *  Sleutels die de patch niet noemt blijven staan; `null` verwijdert ze. */
export const pasVoorkeurenPatchToe = (
  huidig: DashboardVoorkeuren | null | undefined,
  patch: z.output<typeof dashboardVoorkeurenPatchSchema>,
): DashboardVoorkeuren => {
  const basis: Record<string, unknown> = { ...(huidig ?? LEGE_DASHBOARD_VOORKEUREN) };
  for (const [sleutel, waarde] of Object.entries(patch)) {
    if (waarde === undefined) continue;
    if (waarde === null) delete basis[sleutel];
    else basis[sleutel] = waarde;
  }
  return parseDashboardVoorkeuren(basis) ?? LEGE_DASHBOARD_VOORKEUREN;
};

/**
 * Mag deze soort als push naar deze gebruiker? Zonder (geldige) voorkeur of
 * zonder uit-lijst: ja. 'systeem' altijd. De melding in public.meldingen
 * staat hier los van: die wordt altijd bewaard, alleen het pushkanaal filtert.
 */
export const pushSoortToegestaan = (voorkeuren: unknown, soort: MeldingSoort): boolean => {
  if (soort === 'systeem') return true;
  const v = parseDashboardVoorkeuren(voorkeuren);
  if (!v?.meldingssoortenUit) return true;
  return !v.meldingssoortenUit.includes(soort);
};

/** Ontvangers die voor `soort` een push mogen krijgen; wie niet in de
 *  voorkeurenkaart staat (rij niet gevonden) krijgt hem gewoon. */
export const filterPushOntvangers = (
  ontvangers: readonly string[],
  voorkeurenPerGebruiker: ReadonlyMap<string, unknown>,
  soort: MeldingSoort,
): string[] => ontvangers.filter((id) => pushSoortToegestaan(voorkeurenPerGebruiker.get(id), soort));
