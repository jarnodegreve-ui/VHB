import type { Page, Request } from '@playwright/test';
import { ADMIN, CHAUFFEUR, USERS, seedPagina } from '../scripts/audit-fixtures.mjs';

/**
 * Dunne TS-laag over de gedeelde fixtures (scripts/audit-fixtures.mjs), voor
 * specs die een compleet ingelogd scherm nodig hebben (desktop, a11y). De
 * oudere flow-specs houden hun eigen, kleinere fixtures — die testen één
 * schrijfpad en willen precies weten wat er in de POST zit.
 */
export { ADMIN, CHAUFFEUR, USERS };

export type Fixture = Record<string, unknown>;
export type Extra = (pad: string, request: Request) => unknown;

/** Sessie + api-mocks; `extra` overschrijft één of meer collecties. */
export async function seed(page: Page, opties: { user: Fixture; view?: string; thema?: 'light' | 'dark'; extra?: Extra }) {
  await seedPagina(page, opties);
}
