import { describe, expect, it } from 'vitest';
import { bouwKalenderUitzonderingen, FEESTDAGEN, SCHOOLVAKANTIES } from './schoolkalender';

/** Kalender-voorzet: feestdagen + schoolvakanties → dekking-uitzonderingen. */
describe('bouwKalenderUitzonderingen', () => {
  const types = { maDiWo: 'vakantieperiode ma/di/wo', donderdag: 'vakantieperiode donderdag', vrijdag: 'vakantieperiode vrijdag' };

  it('zet een vakantieweek om naar drie weekdag-segmenten (za/zo volgen de basis)', () => {
    const { uitzonderingen } = bouwKalenderUitzonderingen({ vakantieTypes: types, bestaande: [], vanafDatum: '2026-10-01' });
    // Herfstvakantie 2026 (ma 2 t/m zo 8 nov) = precies één week.
    const herfst = uitzonderingen.filter((o) => o.from.startsWith('2026-11'));
    expect(herfst).toEqual([
      { from: '2026-11-02', to: '2026-11-04', dayType: 'vakantieperiode ma/di/wo' },
      { from: '2026-11-05', to: '2026-11-05', dayType: 'vakantieperiode donderdag' },
      { from: '2026-11-06', to: '2026-11-06', dayType: 'vakantieperiode vrijdag' },
    ]);
    // Paasvakantie = twee weken → zes segmenten.
    expect(uitzonderingen.filter((o) => o.from >= '2027-03-29' && o.from <= '2027-04-11')).toHaveLength(6);
  });

  it('feestdagen: op zondag overgeslagen, op zaterdag wél voorgezet (zondagsdienst), en vóór de vakantiesegmenten', () => {
    const { uitzonderingen } = bouwKalenderUitzonderingen({ feestdagType: 'zondag', vakantieTypes: types, bestaande: [], vanafDatum: '2026-10-01' });
    const feest = uitzonderingen.filter((o) => o.dayType === 'zondag');
    // Allerheiligen 2026 (zo) en O.L.V.-Hemelvaart 2027 (zo) vallen weg.
    expect(feest.some((o) => o.from === '2026-11-01' || o.from === '2027-08-15')).toBe(false);
    // Dag van de Arbeid 2027 valt op zaterdag en blijft (zondagsdienst).
    expect(feest.some((o) => o.from === '2027-05-01')).toBe(true);
    // Volgorde: bij overlap wint de eerste match (resolveDayType) — kerstdag
    // moet dus vóór het kerstvakantie-segment staan.
    const kerstdag = uitzonderingen.findIndex((o) => o.from === '2026-12-25' && o.dayType === 'zondag');
    const kerstweek = uitzonderingen.findIndex((o) => o.from === '2026-12-21');
    expect(kerstdag).toBeGreaterThanOrEqual(0);
    expect(kerstdag).toBeLessThan(kerstweek);
  });

  it('slaat over wat al door een bestaande uitzondering gedekt is, en telt dat', () => {
    const bestaande = [{ from: '2026-11-01', to: '2026-11-30', dayType: 'x' }];
    const { uitzonderingen, overgeslagen } = bouwKalenderUitzonderingen({ feestdagType: 'zondag', vakantieTypes: types, bestaande, vanafDatum: '2026-10-01' });
    expect(uitzonderingen.some((o) => o.from.startsWith('2026-11'))).toBe(false);
    // Wapenstilstand 11-11 + drie herfstsegmenten.
    expect(overgeslagen).toBe(4);
  });

  it('laat het verleden weg en knipt een al begonnen reeks af op vandaag', () => {
    const { uitzonderingen } = bouwKalenderUitzonderingen({ vakantieTypes: types, bestaande: [], vanafDatum: '2026-11-04' });
    const herfst = uitzonderingen.filter((o) => o.from.startsWith('2026-11'));
    // ma-wo-segment is al bezig → begint vandaag; do/vr onaangeroerd.
    expect(herfst[0]).toEqual({ from: '2026-11-04', to: '2026-11-04', dayType: 'vakantieperiode ma/di/wo' });
    expect(herfst).toHaveLength(3);
  });

  it('zonder mapping wordt de categorie overgeslagen', () => {
    const { uitzonderingen } = bouwKalenderUitzonderingen({ bestaande: [], vanafDatum: '2026-10-01' });
    expect(uitzonderingen).toEqual([]);
  });

  it('dataset-sanity: vakanties starten op maandag en eindigen op zondag', () => {
    for (const v of SCHOOLVAKANTIES) {
      expect(new Date(`${v.van}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${v.tot}T00:00:00Z`).getUTCDay()).toBe(0);
    }
    for (const f of FEESTDAGEN) {
      expect(f.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
