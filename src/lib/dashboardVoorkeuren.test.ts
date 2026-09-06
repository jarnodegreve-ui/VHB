import { describe, expect, it } from 'vitest';
import { LEGE_DASHBOARD_VOORKEUREN, parseDashboardVoorkeuren } from '../../shared/schemas/dashboardVoorkeuren';
import {
  CHAUFFEUR_TEGELS, PLANNER_TEGELS, isStandaard, isVerborgen, kleineTegelSpan, pasVoorkeurenToe,
  stripSpans, verplaats, volledigeVolgorde, zetZichtbaar,
} from './dashboardVoorkeuren';

const ids = (defs: { id: string }[]) => defs.map((d) => d.id);

describe('dashboardvoorkeuren — helpers', () => {
  it('catalogi: unieke ids, precies één essentiële tegel per rol', () => {
    for (const defs of [CHAUFFEUR_TEGELS, PLANNER_TEGELS]) {
      expect(new Set(ids([...defs])).size).toBe(defs.length);
      expect(defs.filter((d) => d.essentieel).length).toBe(1);
      expect(defs.every((d) => /^[a-z0-9-]+$/.test(d.id))).toBe(true);
    }
  });

  it('zonder voorkeuren = catalogusvolgorde, alles zichtbaar', () => {
    expect(ids(pasVoorkeurenToe(CHAUFFEUR_TEGELS, null))).toEqual(ids([...CHAUFFEUR_TEGELS]));
    expect(ids(pasVoorkeurenToe(CHAUFFEUR_TEGELS, LEGE_DASHBOARD_VOORKEUREN))).toEqual(ids([...CHAUFFEUR_TEGELS]));
  });

  it('volgorde eerst, rest erachter; onbekende en dubbele ids genegeerd; verborgen eruit', () => {
    const v = { volgorde: ['deze-maand', 'onbekend', 'vandaag', 'deze-maand'], verborgen: ['verlofsaldo', 'vandaag', 'weg'] };
    expect(ids(pasVoorkeurenToe(CHAUFFEUR_TEGELS, v))).toEqual([
      'deze-maand', 'vandaag', 'volgende-dienst', 'omleidingen', 'komende-diensten', 'omleidingen-paneel', 'snelle-acties',
    ]);
    // Essentieel blijft ondanks 'verborgen'.
    expect(isVerborgen(CHAUFFEUR_TEGELS, v, 'vandaag')).toBe(false);
    expect(isVerborgen(CHAUFFEUR_TEGELS, v, 'verlofsaldo')).toBe(true);
    expect(ids(volledigeVolgorde(CHAUFFEUR_TEGELS, v))).toHaveLength(CHAUFFEUR_TEGELS.length);
  });

  it('zetZichtbaar: verbergen/tonen, essentiële tegel onaantastbaar', () => {
    let v = zetZichtbaar(CHAUFFEUR_TEGELS, LEGE_DASHBOARD_VOORKEUREN, 'deze-maand', false);
    expect(v.verborgen).toEqual(['deze-maand']);
    v = zetZichtbaar(CHAUFFEUR_TEGELS, v, 'deze-maand', false);
    expect(v.verborgen).toEqual(['deze-maand']);
    v = zetZichtbaar(CHAUFFEUR_TEGELS, v, 'deze-maand', true);
    expect(v.verborgen).toEqual([]);
    expect(zetZichtbaar(CHAUFFEUR_TEGELS, v, 'vandaag', false)).toBe(v);
    expect(zetZichtbaar(CHAUFFEUR_TEGELS, v, 'bestaat-niet', false)).toBe(v);
  });

  it('verplaats: één plek, randen blijven staan, verborgen tegels tellen mee', () => {
    const v0 = { verborgen: ['volgende-dienst'], volgorde: [] };
    const v1 = verplaats(CHAUFFEUR_TEGELS, v0, 'verlofsaldo', 'omhoog');
    expect(v1.volgorde.slice(0, 3)).toEqual(['vandaag', 'verlofsaldo', 'volgende-dienst']);
    expect(verplaats(CHAUFFEUR_TEGELS, v0, 'vandaag', 'omhoog')).toBe(v0);
    expect(verplaats(CHAUFFEUR_TEGELS, v0, 'snelle-acties', 'omlaag')).toBe(v0);
    expect(verplaats(CHAUFFEUR_TEGELS, v0, 'nep', 'omlaag')).toBe(v0);
    expect(isStandaard(v0)).toBe(false);
    expect(isStandaard(LEGE_DASHBOARD_VOORKEUREN)).toBe(true);
  });

  it('stripSpans: gat-vrije rijen op md, één rij op xl', () => {
    expect(stripSpans(5)).toEqual({ md: ['md:col-span-2', 'md:col-span-2', 'md:col-span-2', 'md:col-span-3', 'md:col-span-3'], xl: 'xl:grid-cols-5' });
    expect(stripSpans(6).md.every((c) => c === 'md:col-span-2')).toBe(true);
    expect(stripSpans(4).md).toEqual(['md:col-span-3', 'md:col-span-3', 'md:col-span-3', 'md:col-span-3']);
    expect(stripSpans(1)).toEqual({ md: ['md:col-span-6'], xl: 'xl:grid-cols-1' });
    expect(stripSpans(0).md).toEqual([]);
    expect(kleineTegelSpan(3)).toBe('xl:col-span-2');
    expect(kleineTegelSpan(2)).toBe('xl:col-span-3');
    expect(kleineTegelSpan(1)).toBe('xl:col-span-6');
  });

  it('parseDashboardVoorkeuren: normaliseert of weigert', () => {
    expect(parseDashboardVoorkeuren({})).toEqual({ verborgen: [], volgorde: [] });
    expect(parseDashboardVoorkeuren({ verborgen: ['a'], volgorde: ['b-1'] })).toEqual({ verborgen: ['a'], volgorde: ['b-1'] });
    expect(parseDashboardVoorkeuren({ verborgen: ['Niet OK'] })).toBeNull();
    expect(parseDashboardVoorkeuren('x')).toBeNull();
    expect(parseDashboardVoorkeuren(null)).toBeNull();
  });
});
