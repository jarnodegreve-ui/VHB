import { describe, expect, it } from 'vitest';
import { UITGESTELD_PER_VIEW, uitgesteldVoor, type Uitgesteld } from './poort';
import { ROUTES } from '../routes';

describe('poort: uitgestelde collecties per rol', () => {
  it('staf stelt de zware beheercollecties uit, niet users of swaps (cockpit en werkvoorraad rekenen erop)', () => {
    expect(uitgesteldVoor('planner')).toEqual(['services', 'planningCodes', 'planningMatrix']);
    expect(uitgesteldVoor('admin')).toEqual(['services', 'planningCodes', 'planningMatrix', 'activityLog']);
    for (const rol of ['planner', 'admin'] as const) {
      expect(uitgesteldVoor(rol)).not.toContain('users');
      expect(uitgesteldVoor(rol)).not.toContain('swaps');
    }
  });

  it('chauffeur en technieker stellen users, swaps en de documentenbadge uit', () => {
    expect(uitgesteldVoor('chauffeur')).toEqual(['users', 'swaps', 'documenten']);
    expect(uitgesteldVoor('technieker')).toEqual(['users', 'swaps', 'documenten']);
  });

  it('het activiteitenlog is admin-only', () => {
    expect(uitgesteldVoor('planner')).not.toContain('activityLog');
  });

  it('de view-kaart verwijst alleen naar bestaande schermen en bekende sleutels', () => {
    const views = new Set(ROUTES.map((r) => r.view));
    const sleutels = new Set<Uitgesteld>(['services', 'planningCodes', 'planningMatrix', 'activityLog', 'users', 'swaps', 'documenten']);
    for (const [view, lijst] of Object.entries(UITGESTELD_PER_VIEW)) {
      expect(views.has(view as never), view).toBe(true);
      for (const k of lijst ?? []) expect(sleutels.has(k), `${view}: ${k}`).toBe(true);
    }
  });

  it('elk scherm van een rol dat een uitgestelde collectie nodig heeft, kan ze ook krijgen', () => {
    // rooster/dienstruil vragen users+swaps: voor de chauffeur uitgesteld, voor staf in de poort.
    expect(UITGESTELD_PER_VIEW.rooster).toEqual(['users', 'swaps']);
    expect(UITGESTELD_PER_VIEW['planning-matrix']).toEqual(['services', 'planningCodes', 'planningMatrix']);
  });
});
