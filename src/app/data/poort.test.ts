import { describe, expect, it } from 'vitest';
import { UITGESTELD_PER_VIEW, uitgesteldVoor, type Uitgesteld } from './poort';
import { ROUTES } from '../routes';

describe('poort: uitgestelde collecties per rol', () => {
  it('staf stelt de zware beheercollecties uit, niet users of swaps (cockpit en werkvoorraad rekenen erop)', () => {
    expect(uitgesteldVoor('planner')).toEqual(['diversions', 'services', 'planningCodes', 'planningMatrix']);
    expect(uitgesteldVoor('admin')).toEqual(['diversions', 'services', 'planningCodes', 'planningMatrix', 'activityLog']);
    for (const rol of ['planner', 'admin'] as const) {
      expect(uitgesteldVoor(rol)).not.toContain('users');
      expect(uitgesteldVoor(rol)).not.toContain('swaps');
    }
  });

  it('chauffeur en technieker stellen omleidingen, updates, meldingen, users, swaps en de documentenbadge uit', () => {
    expect(uitgesteldVoor('chauffeur')).toEqual(['diversions', 'updates', 'meldingen', 'users', 'swaps', 'documenten']);
    expect(uitgesteldVoor('technieker')).toEqual(['diversions', 'updates', 'meldingen', 'users', 'swaps', 'documenten']);
  });

  it('de omleidingen zitten voor geen enkele rol in de poort (15-10); updates en meldingen alleen voor staf (cockpit en bel)', () => {
    for (const rol of ['chauffeur', 'technieker', 'planner', 'admin'] as const) expect(uitgesteldVoor(rol)).toContain('diversions');
    for (const rol of ['planner', 'admin'] as const) {
      expect(uitgesteldVoor(rol)).not.toContain('updates');
      expect(uitgesteldVoor(rol)).not.toContain('meldingen');
    }
    // Verlof blijft overal in de poort (Mijn week, verlofbadge).
    for (const rol of ['chauffeur', 'technieker', 'planner', 'admin'] as const) expect(uitgesteldVoor(rol)).not.toContain('leave' as never);
  });

  it('de startschermen vragen de omleidingen meteen naast de poort', () => {
    expect(UITGESTELD_PER_VIEW.dashboard).toEqual(['diversions']);
    expect(UITGESTELD_PER_VIEW['mijn-dag']).toEqual(['diversions']);
    expect(UITGESTELD_PER_VIEW.omleidingen).toEqual(['diversions']);
    expect(UITGESTELD_PER_VIEW.updates).toEqual(['updates']);
    expect(UITGESTELD_PER_VIEW.meldingen).toEqual(['meldingen']);
  });

  it('het activiteitenlog is admin-only', () => {
    expect(uitgesteldVoor('planner')).not.toContain('activityLog');
  });

  it('de view-kaart verwijst alleen naar bestaande schermen en bekende sleutels', () => {
    const views = new Set(ROUTES.map((r) => r.view));
    const sleutels = new Set<Uitgesteld>(['services', 'planningCodes', 'planningMatrix', 'activityLog', 'users', 'swaps', 'documenten', 'diversions', 'updates', 'meldingen']);
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
