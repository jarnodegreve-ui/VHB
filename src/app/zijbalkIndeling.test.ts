import { describe, expect, it } from 'vitest';
import { padVan, routeVanPad, sectieLabel, sidebarRoutes } from './routes';
import { routeUitPad } from './router';

/**
 * Indeling van de zijbalk (Jarno 30-09): Vervaldata onder Planning, Mails
 * onder Communicatie, Rapporten onder Systeem in plaats van een eigen sectie,
 * Personeel heet Afwezigheid en Laadpalen heet Laadplein. Wie wat mag zien
 * blijft gelijk.
 */
const views = (...args: Parameters<typeof sidebarRoutes>) => sidebarRoutes(...args).map((r) => r.view);

describe('Zijbalk: indeling per sectie', () => {
  it('Vervaldata staat onder Planning, Afwezigheid houdt Verlofkalender en Ziekte', () => {
    expect(views('planner', 'planning').at(-1)).toBe('vervaldata');
    expect(views('planner', 'afwezigheid')).toEqual(['verlof-kalender', 'ziekte']);
    expect(sectieLabel('vervaldata')).toBe('Beheer · Planning');
    expect(sectieLabel('ziekte')).toBe('Beheer · Afwezigheid');
  });

  it('Mails staat onder Communicatie en blijft alleen voor de admin', () => {
    expect(views('admin', 'communicatie')).toEqual(['beheer-updates', 'beheer-omleidingen', 'beheer-mails']);
    expect(views('planner', 'communicatie')).toEqual(['beheer-updates', 'beheer-omleidingen']);
    expect(sectieLabel('beheer-mails')).toBe('Beheer · Communicatie');
  });

  it('Rapporten staat bovenaan Systeem; de planner ziet daar alleen Rapporten', () => {
    expect(views('admin', 'systeem')).toEqual(['rapporten', 'gebruikers', 'toestellen', 'activiteit', 'ocpi-monitoring', 'designsysteem', 'beheer-debug']);
    expect(views('planner', 'systeem')).toEqual(['rapporten']);
    expect(views('chauffeur', 'systeem')).toEqual([]);
    expect(views('technieker', 'systeem')).toEqual([]);
    expect(sectieLabel('rapporten')).toBe('Systeem');
  });
});

describe('Laadplein: naam en pad', () => {
  it('heet Laadplein op /beheer/laadplein', () => {
    expect(routeVanPad('beheer/laadplein')?.label).toBe('Laadplein');
    expect(padVan('ocpi-monitoring', ['maand', '2026-08'])).toBe('/beheer/laadplein/maand/2026-08');
  });

  it('het oude pad /beheer/laadpalen (ook met tabblad) wijst naar hetzelfde scherm', () => {
    expect(routeUitPad('/beheer/laadpalen')).toEqual({ view: 'ocpi-monitoring', params: [] });
    expect(routeUitPad('/beheer/laadpalen/maand/2026-08')).toEqual({ view: 'ocpi-monitoring', params: ['maand', '2026-08'] });
  });
});
