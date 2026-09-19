/**
 * Zod-vrije kant van het meldingencentrum: de soorten en hun labels. De
 * startschermen (dashboard, Mijn dag, rooster) en de voorkeuren-catalogus
 * hebben alleen deze constanten nodig; het schema (shared/schemas/meldingen.ts)
 * sleept zod mee en hoort niet in hun chunks (scripts/check-bundle-size.mjs
 * bewaakt dat). Het schemabestand exporteert deze namen gewoon door, dus
 * `api/` en bestaande imports veranderen niet.
 */
export const MELDING_SOORTEN = ['planning', 'verlof', 'ruil', 'update', 'omleiding', 'document', 'techniek', 'systeem'] as const;
export type MeldingSoort = (typeof MELDING_SOORTEN)[number];

/** Label per soort — chips in de app en de melding-rij. */
export const MELDING_SOORT_LABEL: Record<MeldingSoort, string> = {
  planning: 'Planning',
  verlof: 'Verlof',
  ruil: 'Dienstruil',
  update: 'Updates',
  omleiding: 'Omleidingen',
  document: 'Documenten',
  techniek: 'Techniek',
  systeem: 'Systeem',
};
