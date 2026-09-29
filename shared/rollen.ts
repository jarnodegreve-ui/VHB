/**
 * Hoe een rol heet (29-09): één bron voor het label van elke rol en voor de
 * volgorde en inhoud van het rolfilter. Vroeger heette dezelfde rol op drie
 * manieren: "Planner" en "Beheerder" in Instellingen, "Planning" en "Beheer"
 * in het profielmenu en Contacten, en de rauwe waarde met een hoofdletter
 * ("Admin") in Gebruikers.
 *
 * Drie dingen die op elkaar lijken en het niet zijn:
 * - de ROL van een persoon: hier, en nergens anders;
 * - een afdeling of schermgroep ("Beheer", "Planning" in de navigatie): dat
 *   is een plaats in de app, geen rol, en staat in routes.tsx;
 * - een groep ontvangers in het meervoud ("Alle techniekers"): de
 *   mailgroepen in shared/schemas/mail.ts.
 *
 * Een label is tekst voor een mens. Vergelijken, filteren, zoeken en
 * CSS-klassen gebruiken de rolwaarde (`role`), nooit het label.
 * src/rollabels.test.ts faalt op een tweede labeltabel en op `capitalize` op
 * een rolwaarde.
 *
 * Zonder zod en met alleen toegang.ts als import: het profielmenu zit in de
 * startbundel.
 */
import { isTechnieker, type Toegang } from './toegang.js';

export const ROLLEN = ['chauffeur', 'technieker', 'planner', 'admin'] as const;
export type Rol = (typeof ROLLEN)[number];

/** `Record<Rol, …>`: een nieuwe rol zonder label is een typefout, geen stille
 *  terugval op de rauwe rolnaam. */
export const ROL_LABEL: Record<Rol, string> = {
  chauffeur: 'Chauffeur',
  technieker: 'Technieker',
  planner: 'Planner',
  admin: 'Beheerder',
};

/** Label van een rolwaarde die van buiten komt (logregel, antwoord van de
 *  server). Een onbekende waarde blijft staan zoals ze is, zodat ze niet
 *  stil verdwijnt. */
export const rolLabel = (rol: string | null | undefined): string =>
  (ROL_LABEL as Record<string, string>)[rol ?? ''] ?? rol ?? '';

/** De rol van een persoon in een lijst. Een chauffeur met "Ook technieker"
 *  toont beide; hij blijft een chauffeur, dus die staat voorop. */
export const rolRegel = (wie: Toegang): string =>
  wie.role === 'chauffeur' && isTechnieker(wie) ? `${ROL_LABEL.chauffeur} + ${ROL_LABEL.technieker}` : rolLabel(wie.role);

export type RolFilter = 'all' | Rol;

/** Het rolfilter: Alles, dan de rollen in de volgorde van `ROLLEN`. */
export const ROL_FILTER: ReadonlyArray<{ waarde: RolFilter; label: string }> = [
  { waarde: 'all', label: 'Alles' },
  ...ROLLEN.map((rol) => ({ waarde: rol, label: ROL_LABEL[rol] })),
];

/** Past deze persoon bij het gekozen filter? Op de rol, met één toevoeging:
 *  een chauffeur met "Ook technieker" staat onder Chauffeur én onder
 *  Technieker, zoals hij ook in de mailgroep en de keuzelijsten van de
 *  techniekers staat (`isTechnieker`). */
export const pastBijRolFilter = (wie: Toegang, filter: RolFilter): boolean =>
  filter === 'all' || wie.role === filter || (filter === 'technieker' && isTechnieker(wie));
