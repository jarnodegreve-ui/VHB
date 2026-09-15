import { describe, expect, it } from 'vitest';
import {
  dashboardVoorkeurenPatchSchema,
  filterPushOntvangers,
  meVoorkeurenBodySchema,
  parseDashboardVoorkeuren,
  pasVoorkeurenPatchToe,
  pushSoortToegestaan,
  UITZETBARE_MELDING_SOORTEN,
} from './dashboardVoorkeuren';

describe('dashboardVoorkeuren: schema-uitbreiding (startscherm, meldingssoortenUit)', () => {
  it('oude jsonb zonder de nieuwe velden blijft geldig', () => {
    expect(parseDashboardVoorkeuren({ verborgen: ['x'], volgorde: [] })).toEqual({ verborgen: ['x'], volgorde: [] });
  });

  it('nieuwe velden worden gevalideerd; ongeldige waarden maken de hele voorkeur ongeldig', () => {
    expect(parseDashboardVoorkeuren({ verborgen: [], volgorde: [], startscherm: 'rooster', meldingssoortenUit: ['update'] }))
      .toEqual({ verborgen: [], volgorde: [], startscherm: 'rooster', meldingssoortenUit: ['update'] });
    expect(parseDashboardVoorkeuren({ verborgen: [], volgorde: [], startscherm: 'verlof' })).toBeNull();
    expect(parseDashboardVoorkeuren({ verborgen: [], volgorde: [], meldingssoortenUit: ['systeem'] })).toBeNull();
  });

  it('patch: alleen genoemde sleutels wijzigen, null wist', () => {
    const huidig = { verborgen: ['a'], volgorde: ['b'], startscherm: 'mijn-dag' as const, meldingssoortenUit: ['ruil' as const] };
    const p1 = dashboardVoorkeurenPatchSchema.parse({ verborgen: [], volgorde: ['b', 'a'] });
    expect(pasVoorkeurenPatchToe(huidig, p1)).toEqual({ verborgen: [], volgorde: ['b', 'a'], startscherm: 'mijn-dag', meldingssoortenUit: ['ruil'] });
    const p2 = dashboardVoorkeurenPatchSchema.parse({ startscherm: null });
    expect(pasVoorkeurenPatchToe(huidig, p2)).toEqual({ verborgen: ['a'], volgorde: ['b'], meldingssoortenUit: ['ruil'] });
    const p3 = dashboardVoorkeurenPatchSchema.parse({ meldingssoortenUit: ['update', 'omleiding'] });
    expect(pasVoorkeurenPatchToe(null, p3)).toEqual({ verborgen: [], volgorde: [], meldingssoortenUit: ['update', 'omleiding'] });
  });

  it('body-schema: het dashboard stuurt tegels, Instellingen alleen zijn eigen sleutel', () => {
    expect(meVoorkeurenBodySchema.safeParse({ dashboard: { verborgen: [], volgorde: [] } }).success).toBe(true);
    expect(meVoorkeurenBodySchema.safeParse({ dashboard: { startscherm: 'dashboard' } }).success).toBe(true);
    expect(meVoorkeurenBodySchema.safeParse({ dashboard: { startscherm: 'beheer-debug' } }).success).toBe(false);
    expect(meVoorkeurenBodySchema.safeParse({ dashboard: { meldingssoortenUit: ['systeem'] } }).success).toBe(false);
  });
});

describe('push-filter per soort', () => {
  it('zonder voorkeur of zonder uit-lijst: alles toegestaan', () => {
    expect(pushSoortToegestaan(undefined, 'planning')).toBe(true);
    expect(pushSoortToegestaan(null, 'verlof')).toBe(true);
    expect(pushSoortToegestaan({ verborgen: [], volgorde: [] }, 'ruil')).toBe(true);
    expect(pushSoortToegestaan('rommel', 'update')).toBe(true);
  });

  it('een uitgezette soort blokkeert alleen die soort; systeem is nooit uit te zetten', () => {
    const v = { verborgen: [], volgorde: [], meldingssoortenUit: ['update', 'omleiding'] };
    expect(pushSoortToegestaan(v, 'update')).toBe(false);
    expect(pushSoortToegestaan(v, 'omleiding')).toBe(false);
    expect(pushSoortToegestaan(v, 'planning')).toBe(true);
    expect(pushSoortToegestaan(v, 'systeem')).toBe(true);
    // Zelfs een (via een oude client) opgeslagen 'systeem' in de lijst maakt
    // de voorkeur ongeldig en dus: alles aan.
    expect(pushSoortToegestaan({ verborgen: [], volgorde: [], meldingssoortenUit: ['systeem'] }, 'planning')).toBe(true);
    expect(UITZETBARE_MELDING_SOORTEN).not.toContain('systeem');
  });

  it('filterPushOntvangers houdt wie geen rij heeft en wie de soort aan heeft', () => {
    const kaart = new Map<string, unknown>([
      ['1', { verborgen: [], volgorde: [], meldingssoortenUit: ['verlof'] }],
      ['2', { verborgen: [], volgorde: [] }],
      ['3', null],
    ]);
    expect(filterPushOntvangers(['1', '2', '3', '4'], kaart, 'verlof')).toEqual(['2', '3', '4']);
    expect(filterPushOntvangers(['1', '2', '3', '4'], kaart, 'planning')).toEqual(['1', '2', '3', '4']);
    expect(filterPushOntvangers([], kaart, 'verlof')).toEqual([]);
  });
});
