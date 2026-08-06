import { describe, expect, it } from 'vitest';
import type { User, ActivityCategory as ClientActivityCategory } from './types';
import type { AppUser, ActivityCategory as ApiActivityCategory } from '../api/types';

/**
 * Drift-bewaking tussen de bewust gedupliceerde interfaces in src/types.ts en
 * api/types.ts (de repo-conventie verbiedt cross-imports tussen api/ en src/
 * in productie-code — een test mag wél beide zien). Bewezen drift-geval:
 * ActivityCategory miste 'system' client-side → lege badge bij restore-events.
 *
 * Dit zijn compile-time checks: loopt src/User of api/AppUser uit de pas
 * (veld erbij/weg/ander type), dan faalt `npx tsc` en dus de CI.
 */

// Twee richtingen toewijsbaar met Required<> = exact dezelfde velden + types.
const userToAppUser = (u: Required<User>): Required<AppUser> => u;
const appUserToUser = (u: Required<AppUser>): Required<User> => u;

// Categorieën moeten dezelfde unie zijn (beide richtingen).
const clientToApiCategory = (c: ClientActivityCategory): ApiActivityCategory => c;
const apiToClientCategory = (c: ApiActivityCategory): ClientActivityCategory => c;

describe('gedeelde types blijven synchroon (src/types ↔ api/types)', () => {
  it('User ↔ AppUser zijn structureel identiek', () => {
    expect(typeof userToAppUser).toBe('function');
    expect(typeof appUserToUser).toBe('function');
  });
  it('ActivityCategory-unies zijn identiek', () => {
    expect(typeof clientToApiCategory).toBe('function');
    expect(typeof apiToClientCategory).toBe('function');
  });
  it('verloftype-labels zijn identiek (api/helpers ↔ src/lib/format)', async () => {
    // Bewuste duplicatie (geen cross-imports api↔src in productie-code):
    // deze runtime-check bewaakt dat de twee kopieën gelijk blijven — een
    // label dat maar aan één kant wijzigt gaf eerder rauwe enum-waarden in
    // mails of UI.
    const { LEAVE_TYPE_LABEL } = await import('../api/helpers');
    const { LEAVE_TYPE_LABELS } = await import('./lib/format');
    expect(LEAVE_TYPE_LABELS).toEqual(LEAVE_TYPE_LABEL);
  });
  it('vervaldata-labels zijn identiek (api/helpers ↔ src/lib/format)', async () => {
    const { EXPIRY_SOORT_LABEL } = await import('../api/helpers');
    const { EXPIRY_SOORT_LABELS } = await import('./lib/format');
    expect(EXPIRY_SOORT_LABELS).toEqual(EXPIRY_SOORT_LABEL);
  });
});
