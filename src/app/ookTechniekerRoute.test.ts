import { describe, expect, it } from 'vitest';
import { magView, sidebarRoutes } from './routes';

/**
 * "Ook technieker" (28-09): een chauffeur die ook in de garage werkt krijgt
 * de sectie Techniek erbij en houdt al zijn chauffeursschermen. Het loonscherm
 * Dagadministratie (Beheer › Planning) blijft staf-only: dat is iets anders
 * dan zijn werkprestaties.
 */
const chauffeur = { role: 'chauffeur' as const };
const beide = { role: 'chauffeur' as const, ookTechnieker: true };

describe('Ook technieker: routetabel', () => {
  it('opent de techniekschermen, zoals een technieker', () => {
    for (const view of ['defecten', 'werkprestaties', 'voertuig-werken', 'voertuigen'] as const) {
      expect(magView(beide, view), view).toBe(true);
      expect(magView(chauffeur, view), view).toBe(false);
      expect(magView('technieker', view), view).toBe(true);
    }
  });

  it('houdt zijn chauffeursschermen', () => {
    for (const view of ['mijn-dag', 'rooster', 'ritblaadjes', 'ruil-verzoeken', 'bezetting', 'omleidingen'] as const) {
      expect(magView(beide, view), view).toBe(true);
    }
  });

  it('krijgt geen staf-schermen: het loonscherm Dagadministratie en Gebruikers blijven dicht', () => {
    for (const view of ['dagafsluiting', 'looncontrole', 'vandaag', 'gebruikers', 'rapporten'] as const) {
      expect(magView(beide, view), view).toBe(false);
    }
  });

  it('de zijbalk toont Techniek naast zijn gewone menu', () => {
    expect(sidebarRoutes(beide, 'techniek').map((r) => r.view)).toEqual(['defecten', 'werkprestaties', 'voertuig-werken', 'voertuigen']);
    expect(sidebarRoutes(chauffeur, 'techniek')).toEqual([]);
    expect(sidebarRoutes(beide, 'algemeen').map((r) => r.view)).toEqual(sidebarRoutes(chauffeur, 'algemeen').map((r) => r.view));
    expect(sidebarRoutes(beide, 'planning')).toEqual([]);
  });

  it('de schakelaar doet niets bij een andere rol', () => {
    expect(magView({ role: 'planner', ookTechnieker: true }, 'gebruikers')).toBe(false);
    expect(sidebarRoutes({ role: 'technieker', ookTechnieker: true }, 'algemeen').map((r) => r.view))
      .toEqual(sidebarRoutes('technieker', 'algemeen').map((r) => r.view));
  });
});
