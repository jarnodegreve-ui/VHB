import { describe, expect, it } from 'vitest';
import {
  dashboardVoorkeurenPatchSchema,
  filterPushOntvangers,
  meVoorkeurenBodySchema,
  parseDashboardVoorkeuren,
  pasVoorkeurenPatchToe,
  pushSoortToegestaan,
  UITZETBARE_MELDING_SOORTEN,
  type DashboardVoorkeuren,
  type DashboardVoorkeurenPatch,
} from './dashboardVoorkeuren';
import {
  parseDashboardVoorkeurenLos,
  type DashboardVoorkeuren as DashboardVoorkeurenLos,
  type DashboardVoorkeurenPatch as DashboardVoorkeurenPatchLos,
} from '../dashboardVoorkeuren';

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

/**
 * Pariteit met de zod-vrije kant (shared/dashboardVoorkeuren.ts, ronde 3
 * 19-09): de startschermen parsen de voorkeuren zonder zod. Beide parsers
 * moeten op elke invoer hetzelfde teruggeven; loopt het schema uit de pas,
 * dan faalt dit vóór de client en de server van mening verschillen.
 */
describe('dashboardVoorkeuren: zod-vrije parser geeft hetzelfde als het schema', () => {
  const lang = 'a'.repeat(41);
  const gevallen: unknown[] = [
    null, undefined, 0, 'tekst', [], [{}], {},
    { verborgen: ['x'], volgorde: [] },
    { verborgen: ['x'] },
    { volgorde: ['a', 'b-2', '9'] },
    { verborgen: [' vandaag '], volgorde: ['open-taken '] }, // trim
    { verborgen: [''], volgorde: [] },
    { verborgen: ['   '], volgorde: [] },
    { verborgen: ['Hoofdletter'], volgorde: [] },
    { verborgen: ['met spatie'], volgorde: [] },
    { verborgen: [lang], volgorde: [] },
    { verborgen: ['a'.repeat(40)], volgorde: [] },
    { verborgen: [1], volgorde: [] },
    { verborgen: 'x', volgorde: [] },
    { verborgen: null, volgorde: [] },
    { verborgen: Array.from({ length: 50 }, (_, i) => `t-${i}`), volgorde: [] },
    { verborgen: Array.from({ length: 51 }, (_, i) => `t-${i}`), volgorde: [] },
    { verborgen: [], volgorde: [], onbekend: 'valt weg', nogIets: { diep: true } },
    { verborgen: [], volgorde: [], startscherm: 'rooster' },
    { verborgen: [], volgorde: [], startscherm: 'mijn-dag' },
    { verborgen: [], volgorde: [], startscherm: 'verlof' },
    { verborgen: [], volgorde: [], startscherm: null },
    { verborgen: [], volgorde: [], startscherm: '' },
    { verborgen: [], volgorde: [], meldingssoortenUit: [] },
    { verborgen: [], volgorde: [], meldingssoortenUit: ['update', 'omleiding', 'techniek'] },
    { verborgen: [], volgorde: [], meldingssoortenUit: ['systeem'] },
    { verborgen: [], volgorde: [], meldingssoortenUit: ['bestaat-niet'] },
    { verborgen: [], volgorde: [], meldingssoortenUit: 'update' },
    { verborgen: [], volgorde: [], meldingssoortenUit: null },
    { verborgen: [], volgorde: [], meldingssoortenUit: Array.from({ length: 21 }, () => 'update') },
    { verborgen: [], volgorde: [], meldingssoortenUit: Array.from({ length: 20 }, () => 'update') },
    { verborgen: [], volgorde: [], documentenGezienOp: '2026-09-15T08:30:00.000Z' },
    { verborgen: [], volgorde: [], documentenGezienOp: '2026-09-15T08:30:00Z', verlofGezienOp: '2026-09-15T08:30:00.123456Z' },
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-09-15T08:30Z' }, // zonder seconden
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-09-15T08:30:00+02:00' }, // offset
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-09-15T08:30:00' }, // lokaal
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-02-30T08:30:00Z' }, // geen kalenderdag
    { verborgen: [], volgorde: [], verlofGezienOp: '2024-02-29T08:30:00Z' }, // schrikkeldag
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-02-29T08:30:00Z' },
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-13-01T08:30:00Z' },
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-09-15T24:00:00Z' },
    { verborgen: [], volgorde: [], verlofGezienOp: '2026-09-15' },
    { verborgen: [], volgorde: [], verlofGezienOp: 1757925000000 },
    { verborgen: [], volgorde: [], verlofGezienOp: null },
    { verborgen: ['a'], volgorde: ['b'], startscherm: 'dashboard', meldingssoortenUit: ['ruil'], documentenGezienOp: '2026-09-01T00:00:00Z', verlofGezienOp: '2026-09-02T23:59:59.9Z' },
  ];

  it.each(gevallen.map((g, i) => [i, g] as const))('geval %i', (_i, invoer) => {
    expect(parseDashboardVoorkeurenLos(invoer)).toEqual(parseDashboardVoorkeuren(invoer));
  });

  it('de types vallen samen (schema-uitvoer en patch-invoer)', () => {
    // Compileert alleen als beide richtingen toewijsbaar zijn.
    const naarLos: DashboardVoorkeurenLos = {} as DashboardVoorkeuren;
    const naarSchema: DashboardVoorkeuren = {} as DashboardVoorkeurenLos;
    const patchNaarLos: DashboardVoorkeurenPatchLos = {} as DashboardVoorkeurenPatch;
    const patchNaarSchema: DashboardVoorkeurenPatch = {} as DashboardVoorkeurenPatchLos;
    expect([naarLos, naarSchema, patchNaarLos, patchNaarSchema]).toHaveLength(4);
  });
});
