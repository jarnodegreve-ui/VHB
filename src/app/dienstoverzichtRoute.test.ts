import { describe, expect, it } from 'vitest';
import { ALLE_VIEWS, bekendeView, magView, padVan, routeVanPad } from './routes';
import { routeUitPad, routeUitUrl } from './router';

/**
 * 3D (23-09): Dienstoverzicht en Beheer dienstoverzicht zijn één scherm op
 * /beheer/dienstoverzicht, alleen voor planner en admin. Oude paden en de
 * verdwenen view-sleutel blijven naar het nieuwe scherm wijzen.
 */
describe('Dienstoverzicht: route en rollen', () => {
  it('alleen planner en admin mogen het scherm; chauffeur en technieker niet', () => {
    expect(magView('planner', 'dienstoverzicht')).toBe(true);
    expect(magView('admin', 'dienstoverzicht')).toBe(true);
    expect(magView('chauffeur', 'dienstoverzicht')).toBe(false);
    expect(magView('technieker', 'dienstoverzicht')).toBe(false);
  });

  it('één scherm: de oude view-sleutel bestaat niet meer als route', () => {
    expect(ALLE_VIEWS).toContain('dienstoverzicht');
    expect((ALLE_VIEWS as readonly string[]).includes('beheer-dienstoverzicht')).toBe(false);
  });

  it('het canonieke pad is /beheer/dienstoverzicht, met het record als segment', () => {
    expect(padVan('dienstoverzicht')).toBe('/beheer/dienstoverzicht');
    expect(padVan('dienstoverzicht', ['3'])).toBe('/beheer/dienstoverzicht/3');
    expect(routeUitPad('/beheer/dienstoverzicht/3')).toEqual({ view: 'dienstoverzicht', params: ['3'] });
  });

  it('het oude pad /dienstoverzicht (ook met record) wijst naar hetzelfde scherm', () => {
    expect(routeVanPad('dienstoverzicht')?.view).toBe('dienstoverzicht');
    expect(routeUitPad('/dienstoverzicht')).toEqual({ view: 'dienstoverzicht', params: [] });
    expect(routeUitPad('/dienstoverzicht/3')).toEqual({ view: 'dienstoverzicht', params: ['3'] });
  });

  it('de verdwenen view-sleutel (?view= van een oud pushbericht) wijst naar de opvolger', () => {
    expect(bekendeView('beheer-dienstoverzicht')).toBe('dienstoverzicht');
    expect(bekendeView('dienstoverzicht')).toBe('dienstoverzicht');
    expect(bekendeView('bestaat-niet')).toBeNull();
    expect(bekendeView(null)).toBeNull();
    expect(routeUitUrl('/?view=beheer-dienstoverzicht')).toEqual({ view: 'dienstoverzicht', params: [] });
  });
});
