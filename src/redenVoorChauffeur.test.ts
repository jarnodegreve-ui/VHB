import { describe, expect, it } from 'vitest';
import { redenVoorChauffeur } from '../api/helpers';
import { kaleReden } from './lib/ruilBadge';

describe('redenVoorChauffeur', () => {
  it('vervangt de naam van de uitvoerder door "de planner" en laat de reden staan', () => {
    expect(redenVoorChauffeur('Handmatige wissel door Jarno De Greve, Ziekte')).toBe('Handmatige wissel door de planner, Ziekte');
    expect(redenVoorChauffeur('Handmatige wissel door Jarno De Greve, Ziekte, vervanging voor 2 dagen'))
      .toBe('Handmatige wissel door de planner, Ziekte, vervanging voor 2 dagen');
  });

  it('zonder komma blijft alleen het voorvoegsel met "de planner" over', () => {
    expect(redenVoorChauffeur('Handmatige wissel door Jarno De Greve')).toBe('Handmatige wissel door de planner');
  });

  it('laat een gewone ruilreden en lege waarden ongemoeid', () => {
    expect(redenVoorChauffeur('Ik heb een afspraak, door omstandigheden')).toBe('Ik heb een afspraak, door omstandigheden');
    expect(redenVoorChauffeur('')).toBe('');
    expect(redenVoorChauffeur(undefined)).toBeUndefined();
    expect(redenVoorChauffeur(null)).toBeUndefined();
  });

  it('is idempotent en de client haalt er nog steeds de kale reden uit', () => {
    const een = redenVoorChauffeur('Handmatige wissel door Jarno De Greve, Ziekte')!;
    expect(redenVoorChauffeur(een)).toBe(een);
    expect(kaleReden(een)).toBe('Ziekte');
  });
});
