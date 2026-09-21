import { describe, expect, it } from 'vitest';
import { valideer } from '../schemas/basis';
import type { RapportDefinitie, RapportRij } from './types';
import { RAPPORTEN, rapportVan } from './register';
import { VASTE_PARAMS, filterParams, filtersInWoorden, filtersNaarQuery, heeftEigenFilters, leesFilters, standaardFilters } from './filters';
import { filterSchemaVoor } from './filterSchema';
import { NADRUK_TEKEN, csvRijen, formatWaarde, kolomIndeling, nadrukVan, sorteerRijen } from './opmaak';

/**
 * Wat het fundament bij stap 2 (ziekte en verlof) bijleerde: het vinkje-filter,
 * de standaardperiode per rapport, `sorteerOp`, en de kolomrollen van de
 * nieuwe rapporten op de telefoon. De kolommen die met het antwoord meekomen
 * (`metKolommen`) zijn getest bij het rapport dat ze gebruikt
 * (src/rapportVerlof.test.ts).
 */
const VANDAAG = '2026-09-21';
const query = (s: string) => new URLSearchParams(s);

const MET_VINKJE: RapportDefinitie = {
  id: 'test-vinkje',
  domein: 'verlof',
  titel: 'Test',
  omschrijving: 'Test',
  filters: [{ soort: 'periode', standaard: 'dit-jaar' }, { soort: 'vinkje', id: 'boven', label: 'Alleen boven de limiet' }],
  kolommen: [{ id: 'maand', titel: 'Maand', type: 'tekst', sorteerOp: 'sleutel' }],
  sortering: { kolom: 'maand', richting: 'asc' },
  print: 'staand',
  bronNaam: 'testgegevens',
};

describe('vinkje-filter', () => {
  it('staat standaard uit, leest alleen "1" als aan, en schrijft alleen als het aan staat', () => {
    expect(standaardFilters(MET_VINKJE, VANDAAG).vinkjes).toEqual({ boven: false });
    expect(leesFilters(MET_VINKJE, query('boven=1'), VANDAAG).vinkjes).toEqual({ boven: true });
    for (const rommel of ['boven=', 'boven=ja', 'boven=true', 'boven=0']) {
      expect(leesFilters(MET_VINKJE, query(rommel), VANDAAG).vinkjes).toEqual({ boven: false });
    }
    expect(filterParams(MET_VINKJE)).toEqual(['van', 'tot', 'boven']);
    const aan = { ...standaardFilters(MET_VINKJE, VANDAAG), vinkjes: { boven: true } };
    expect(filtersNaarQuery(MET_VINKJE, aan).get('boven')).toBe('1');
    expect(filtersNaarQuery(MET_VINKJE, standaardFilters(MET_VINKJE, VANDAAG)).has('boven')).toBe(false);
    // Heen en terug is stabiel, en een vinkje dat aan staat is een eigen filter ("Filters wissen").
    expect(leesFilters(MET_VINKJE, filtersNaarQuery(MET_VINKJE, aan), VANDAAG)).toEqual(aan);
    expect(heeftEigenFilters(MET_VINKJE, aan, VANDAAG)).toBe(true);
    expect(heeftEigenFilters(MET_VINKJE, standaardFilters(MET_VINKJE, VANDAAG), VANDAAG)).toBe(false);
  });

  it('op het printblad staat het alleen als het aan staat', () => {
    const uit = standaardFilters(MET_VINKJE, VANDAAG);
    expect(filtersInWoorden(MET_VINKJE, uit)).toEqual(['Periode 01/01/2026 t/m 31/12/2026']);
    expect(filtersInWoorden(MET_VINKJE, { ...uit, vinkjes: { boven: true } })).toEqual(['Periode 01/01/2026 t/m 31/12/2026', 'Alleen boven de limiet']);
  });

  it('server: aan, uit, en een tikfout in de link is een 400 bij het veld', () => {
    const schema = filterSchemaVoor(MET_VINKJE);
    const periode = { van: '2026-09-01', tot: '2026-09-30' };
    expect(valideer(schema, { ...periode, boven: '1' })).toMatchObject({ ok: true, data: { vinkjes: { boven: true } } });
    expect(valideer(schema, periode)).toMatchObject({ ok: true, data: { vinkjes: { boven: false } } });
    expect(valideer(schema, { ...periode, boven: '' })).toMatchObject({ ok: true, data: { vinkjes: { boven: false } } });
    for (const fout of ['ja', 'true', '0', ['1', '1']]) {
      expect(valideer(schema, { ...periode, boven: fout })).toEqual({ ok: false, fouten: { boven: 'Ongeldige keuze' } });
    }
  });

  it('een rapport zonder vinkje krijgt het veld niet (de filters blijven wat ze waren)', () => {
    const verlofsaldo = rapportVan('verlofsaldo')!;
    expect('vinkjes' in standaardFilters(verlofsaldo, VANDAAG)).toBe(false);
    const r = valideer(filterSchemaVoor(verlofsaldo), { jaar: '2026' });
    expect(r.ok && 'vinkjes' in r.data).toBe(false);
  });

  it('in het register: een vinkje kaapt geen vaste parameter en botst niet met een keuzelijst', () => {
    for (const r of RAPPORTEN) {
      const eigen = r.filters.flatMap((f) => (f.soort === 'vinkje' || f.soort === 'keuze' ? [f.id] : []));
      expect(new Set(eigen).size, r.id).toBe(eigen.length);
      for (const id of eigen) expect((VASTE_PARAMS as readonly string[]).includes(id), `${r.id}: ${id}`).toBe(false);
    }
  });
});

describe('standaardperiode per rapport', () => {
  it('zonder opgave deze maand, anders wat de definitie zegt', () => {
    expect(standaardFilters(MET_VINKJE, VANDAAG)).toMatchObject({ van: '2026-01-01', tot: '2026-12-31' });
    expect(standaardFilters(rapportVan('verlofaanvragen')!, VANDAAG)).toMatchObject({ van: '2026-09-01', tot: '2026-09-30' });
    // Ziekte lees je per jaar, zoals het Ziekte-scherm.
    for (const id of ['ziekte-kalenderdagen', 'ziekte-details', 'ziekte-per-maand']) {
      expect(standaardFilters(rapportVan(id)!, VANDAAG), id).toMatchObject({ van: '2026-01-01', tot: '2026-12-31' });
    }
    // De eigen standaard is geen "eigen filter": Filters wissen blijft uit.
    expect(heeftEigenFilters(MET_VINKJE, leesFilters(MET_VINKJE, query(''), VANDAAG), VANDAAG)).toBe(false);
  });
});

describe('sorteerOp', () => {
  it('sorteert op een ander veld van de rij dan wat er in beeld staat', () => {
    const rijen: RapportRij[] = [
      { id: 'a', maand: 'Augustus 2026', sleutel: '2026-08' },
      { id: 'b', maand: 'April 2026', sleutel: '2026-04' },
      { id: 'c', maand: 'December 2025', sleutel: '2025-12' },
      { id: 'd', maand: 'Onbekend', sleutel: null },
    ];
    expect(sorteerRijen(MET_VINKJE, rijen, 'maand', 'asc').map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(sorteerRijen(MET_VINKJE, rijen, 'maand', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('nadruk op een ja/nee-waarde', () => {
  const boven = rapportVan('verlofbezetting')!.kolommen.find((k) => k.id === 'bovenLimiet')!;

  it('Boven limiet: "ja" valt op als danger, "nee" blijft stil', () => {
    expect(boven).toMatchObject({ type: 'janee', nadruk: { ja: 'danger' } });
    expect(nadrukVan(boven, true)).toBe('danger');
    expect(nadrukVan(boven, false)).toBeNull();
  });

  it('alleen een echte boolean in een janee-kolom met nadruk valt op', () => {
    for (const waarde of [null, undefined, '', 'ja', 1]) expect(nadrukVan(boven, waarde)).toBeNull();
    expect(nadrukVan({ id: 'x', titel: 'X', type: 'janee' }, true)).toBeNull();
    // Een andere kolomsoort luistert er niet naar, ook niet met de eigenschap erop.
    expect(nadrukVan({ id: 'x', titel: 'X', type: 'tekst', nadruk: { ja: 'danger' } }, true)).toBeNull();
    // Ook "nee" kan de waarde zijn die aandacht vraagt (bv. "gekeurd: nee").
    const gekeurd = { id: 'g', titel: 'Gekeurd', type: 'janee', nadruk: { nee: 'warning' } } as const;
    expect([nadrukVan(gekeurd, false), nadrukVan(gekeurd, true)]).toEqual(['warning', null]);
  });

  it('de tekst zelf verandert niet: scherm en CSV blijven "ja"/"nee", het teken is alleen voor het blad', () => {
    expect([formatWaarde(boven, true), formatWaarde(boven, false), formatWaarde(boven, true, 'csv')]).toEqual(['ja', 'nee', 'ja']);
    const def = rapportVan('verlofbezetting')!;
    const csv = csvRijen(def, [{ id: 'd', datum: '2026-08-13', dag: 'do', afwezig: 3, limiet: 2, bovenLimiet: true, namen: 'A, B, C' }]);
    expect(csv[1]).toEqual(['2026-08-13', 'do', '3', '2', 'ja', 'A, B, C']);
    expect(csv.flat().join('')).not.toContain(NADRUK_TEKEN);
  });

  it('in het register: nadruk staat alleen op janee-kolommen, en nooit op een kolom die op de telefoon verdwijnt', () => {
    for (const r of RAPPORTEN) {
      for (const k of r.kolommen) {
        if (!k.nadruk) continue;
        expect(k.type, `${r.id}: ${k.id}`).toBe('janee');
        expect(k.smal, `${r.id}: ${k.id}`).not.toBe('verberg');
      }
    }
  });
});

describe('ziekte en verlof op de telefoon (375 px: eerste kolom + hoogstens drie smalle kolommen in beeld)', () => {
  const smal = (id: string) => {
    const { kolommen, onderEerste } = kolomIndeling(rapportVan(id)!, 'smal');
    return { kolommen: kolommen.map((k) => k.id), onder: onderEerste.map((k) => k.id) };
  };

  it('Ziekte in kalenderdagen: naam (personeelsnr. eronder), meldingen, dagen, langste; de datum erachter', () => {
    expect(smal('ziekte-kalenderdagen')).toEqual({ kolommen: ['naam', 'meldingen', 'kalenderdagen', 'langstePeriode', 'laatsteMelding'], onder: ['personeelsnr'] });
  });
  it('Details ziekte: naam, van en tot in beeld; dagen en opmerking erachter', () => {
    expect(smal('ziekte-details')).toEqual({ kolommen: ['naam', 'van', 'tot', 'kalenderdagen', 'opmerking'], onder: ['personeelsnr'] });
  });
  it('Ziekte per maand: alles past', () => {
    expect(smal('ziekte-per-maand')).toEqual({ kolommen: ['maand', 'meldingen', 'kalenderdagen', 'chauffeurs'], onder: [] });
  });
  it('Verlofaanvragen: naam (status eronder), van en tot in beeld', () => {
    expect(smal('verlofaanvragen')).toEqual({ kolommen: ['naam', 'van', 'tot', 'type', 'dagen', 'aangevraagdOp', 'beslistOp', 'opmerking'], onder: ['status'] });
  });
  it('Verlofbezetting: datum (weekdag eronder), afwezig, limiet en boven in beeld; de namen erachter', () => {
    expect(smal('verlofbezetting')).toEqual({ kolommen: ['datum', 'afwezig', 'limiet', 'bovenLimiet', 'namen'], onder: ['dag'] });
  });
});
