import { describe, expect, it } from 'vitest';
import { ROUTES } from '../app/routes';
import { PAD_PER_VIEW, doelUitPushUrl, meldingUitPayload, recordUrl, soortUitPushUrl, viewUitPushUrl } from '../../api/_lib/meldingen';
import { routeUitUrl } from '../app/router';

/**
 * Drift-bewaking: de server kent geen src/app/routes.tsx (geen cross-import
 * api↔src) en spiegelt de view→pad-tabel in api/_lib/meldingen.ts. Loopt die
 * uit de pas met ROUTES, dan wijst het `doel` van een melding nergens heen.
 */
describe('meldingen, doel uit push-URL', () => {
  it('PAD_PER_VIEW is exact de routetabel (beide richtingen)', () => {
    const uitRoutes = Object.fromEntries(ROUTES.map((r) => [r.view, r.pad]));
    expect(PAD_PER_VIEW).toEqual(uitRoutes);
  });

  it('leidt view, doel en soort af uit de deeplink-URL', () => {
    expect(viewUitPushUrl('/?view=rooster')).toBe('rooster');
    expect(viewUitPushUrl('/dienstruil')).toBe('ruil-verzoeken');
    expect(viewUitPushUrl('/')).toBeNull();
    expect(viewUitPushUrl(undefined)).toBeNull();
    expect(doelUitPushUrl('/?view=ruil-verzoeken')).toBe('dienstruil');
    expect(doelUitPushUrl('/?view=ziekte')).toBe('beheer/ziekte');
    expect(doelUitPushUrl('/?view=onbekend')).toBeNull();
    expect(soortUitPushUrl('/?view=verlof')).toBe('verlof');
    expect(soortUitPushUrl('/?view=documenten')).toBe('document');
    expect(soortUitPushUrl('/')).toBe('systeem');
  });

  it('meldingUitPayload: expliciete soort/doel winnen, anders afgeleid; 🚨 valt weg', () => {
    expect(meldingUitPayload({ title: '🚨 Storing', body: 'Alle bussen', url: '/?view=updates' })).toEqual({
      titel: 'Storing', tekst: 'Alle bussen', soort: 'update', doel: 'updates',
    });
    expect(meldingUitPayload({ title: 'X', body: '', url: '/', soort: 'ruil', doel: 'mijn-dag' })).toEqual({
      titel: 'X', tekst: null, soort: 'ruil', doel: 'mijn-dag',
    });
    expect(meldingUitPayload({ title: '   ', body: 'y', url: '/' }).titel).toBe('Melding');
    expect(meldingUitPayload({ title: 'a'.repeat(200), body: 'b'.repeat(700) })).toMatchObject({
      titel: 'a'.repeat(160), tekst: 'b'.repeat(600), soort: 'systeem', doel: null,
    });
  });

  it('een record-URL wijst naar het item zelf (golf 3, punt 13)', () => {
    expect(recordUrl('updates', 'u2')).toBe('/updates/u2');
    expect(recordUrl('omleidingen', 'd 1/x')).toBe('/omleidingen/d%201%2Fx');
    expect(recordUrl('beheer-updates', 'u2')).toBe('/beheer/updates/u2');
    expect(recordUrl('updates')).toBe('/updates');
    expect(recordUrl('updates', '')).toBe('/updates');
    expect(recordUrl('onbekend', 'x')).toBe('/x');
    expect(recordUrl('onbekend')).toBe('/');

    // Langste prefix wint, het record reist mee in het doel.
    expect(viewUitPushUrl('/updates/u2')).toBe('updates');
    expect(viewUitPushUrl('/beheer/omleidingen/d1')).toBe('beheer-omleidingen');
    expect(doelUitPushUrl('/updates/u2')).toBe('updates/u2');
    expect(doelUitPushUrl('/omleidingen/d%201')).toBe('omleidingen/d%201');
    expect(doelUitPushUrl('/beheer/omleidingen/d1')).toBe('beheer/omleidingen/d1');
    expect(soortUitPushUrl('/omleidingen/d1')).toBe('omleiding');
    expect(doelUitPushUrl('/nergens/x')).toBeNull();
    expect(meldingUitPayload({ title: 'Nieuwe update', body: 'x', url: recordUrl('updates', 'u2'), soort: 'update' })).toMatchObject({
      soort: 'update', doel: 'updates/u2',
    });
  });

  it('het doel van een melding leest de app als route + record (useRecordParam)', () => {
    // MeldingenView: routeUitUrl('/' + doel) → view + params; App.tsx doet
    // hetzelfde met de push-URL uit de service worker.
    for (const [view, id] of [['updates', 'u2'], ['omleidingen', 'd 1'], ['beheer-updates', 'u2'], ['beheer-omleidingen', 'd1']] as const) {
      const doel = doelUitPushUrl(recordUrl(view, id));
      expect(doel).not.toBeNull();
      expect(routeUitUrl('/' + doel)).toEqual({ view, params: [id] });
      expect(routeUitUrl(recordUrl(view, id))).toEqual({ view, params: [id] });
    }
    expect(routeUitUrl('/?view=updates')).toEqual({ view: 'updates', params: [] });
  });
});
