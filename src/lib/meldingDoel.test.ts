import { describe, expect, it } from 'vitest';
import { ROUTES } from '../app/routes';
import { PAD_PER_VIEW, doelUitPushUrl, meldingUitPayload, soortUitPushUrl, viewUitPushUrl } from '../../api/_lib/meldingen';

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
});
