import { describe, expect, it } from 'vitest';
import { valideer } from '../schemas/basis';
import type { RapportDefinitie } from './types';
import { RAPPORTEN, DOMEINEN, rapportVan } from './register';
import { VASTE_PARAMS, bestandsPeriode, filterParams, filtersInWoorden, filtersNaarQuery, heeftEigenFilters, leesFilters, periodeVanFilters, standaardFilters } from './filters';
import { filterSchemaVoor } from './filterSchema';

const VANDAAG = '2026-09-20';
const verlofsaldo = rapportVan('verlofsaldo')!;

/** Een rapport met álle filtersoorten, om de bouwstenen te testen die Verlofsaldo niet gebruikt. */
const ALLES: RapportDefinitie = {
  id: 'test-alles',
  domein: 'ziekte',
  titel: 'Test',
  omschrijving: 'Test',
  filters: [
    { soort: 'periode' },
    { soort: 'chauffeur' },
    { soort: 'voertuig' },
    { soort: 'keuze', id: 'status', label: 'Status', opties: [{ waarde: 'alle', label: 'Alle' }, { waarde: 'open', label: 'Openstaand' }] },
  ],
  kolommen: [{ id: 'naam', titel: 'Naam', type: 'tekst' }],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'liggend',
  bronNaam: 'testgegevens',
};

const query = (s: string) => new URLSearchParams(s);

describe('register', () => {
  it('elk rapport heeft een uniek id, een bestaand domein en een geldige sortering', () => {
    const ids = RAPPORTEN.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RAPPORTEN) {
      expect(DOMEINEN.some((d) => d.id === r.domein)).toBe(true);
      expect(r.kolommen.some((k) => k.id === r.sortering.kolom)).toBe(true);
      expect(new Set(r.kolommen.map((k) => k.id)).size).toBe(r.kolommen.length);
      // Een keuzelijst mag de vaste parameternamen niet kapen.
      for (const f of r.filters) if (f.soort === 'keuze') expect((VASTE_PARAMS as readonly string[]).includes(f.id)).toBe(false);
    }
  });

  it('het domein uren bestaat al, zonder rapporten, als "volgt later"', () => {
    const uren = DOMEINEN.find((d) => d.id === 'uren');
    expect(uren?.volgtLater).toBe(true);
    expect(RAPPORTEN.filter((r) => r.domein === 'uren')).toEqual([]);
  });

  it('Verlofsaldo: jaar + medewerker, zeven kolommen waarvan vijf optelbaar', () => {
    expect(verlofsaldo.filters.map((f) => f.soort)).toEqual(['jaar', 'chauffeur']);
    expect(verlofsaldo.kolommen.map((k) => k.id)).toEqual(['naam', 'sectie', 'budget', 'opgenomen', 'aangevraagd', 'vrij', 'kleinVerlet']);
    expect(verlofsaldo.kolommen.filter((k) => k.totaal).length).toBe(5);
  });
});

describe('leesFilters (vergevingsgezinde lezer voor de URL)', () => {
  it('zonder parameters: de standaard (dit jaar, iedereen; deze maand, eerste optie)', () => {
    expect(leesFilters(verlofsaldo, query(''), VANDAAG)).toEqual({ jaar: 2026, keuzes: {} });
    expect(leesFilters(ALLES, query(''), VANDAAG)).toEqual({ van: '2026-09-01', tot: '2026-09-30', keuzes: { status: 'alle' } });
    expect(standaardFilters(ALLES, VANDAAG)).toEqual(leesFilters(ALLES, query(''), VANDAAG));
  });

  it('leest wat klopt en negeert rommel', () => {
    expect(leesFilters(verlofsaldo, query('jaar=2025&chauffeur=43'), VANDAAG)).toEqual({ jaar: 2025, chauffeur: '43', keuzes: {} });
    expect(leesFilters(verlofsaldo, query('jaar=abc&chauffeur=%20'), VANDAAG)).toEqual({ jaar: 2026, keuzes: {} });
    expect(leesFilters(verlofsaldo, query('jaar=1850'), VANDAAG).jaar).toBe(2026);
    expect(leesFilters(ALLES, query('status=bestaat-niet'), VANDAAG).keuzes.status).toBe('alle');
  });

  it('een halve of onmogelijke periode valt terug op deze maand', () => {
    expect(leesFilters(ALLES, query('van=2026-01-01'), VANDAAG)).toMatchObject({ van: '2026-09-01', tot: '2026-09-30' });
    expect(leesFilters(ALLES, query('van=2026-02-30&tot=2026-03-01'), VANDAAG)).toMatchObject({ van: '2026-09-01', tot: '2026-09-30' });
    expect(leesFilters(ALLES, query('van=2026-01-01&tot=2026-03-31'), VANDAAG)).toMatchObject({ van: '2026-01-01', tot: '2026-03-31' });
  });

  it('parameters van een andere filtersoort doen niets', () => {
    expect(leesFilters(verlofsaldo, query('van=2026-01-01&tot=2026-01-31&voertuig=v1'), VANDAAG)).toEqual({ jaar: 2026, keuzes: {} });
  });
});

describe('filtersNaarQuery en de afgeleiden', () => {
  it('schrijft altijd voluit, ook de standaard, en alleen de eigen parameters', () => {
    expect(filtersNaarQuery(verlofsaldo, { jaar: 2026, keuzes: {} }).toString()).toBe('jaar=2026');
    expect(filtersNaarQuery(verlofsaldo, { jaar: 2025, chauffeur: '43', voertuig: 'v1', keuzes: {} }).toString()).toBe('jaar=2025&chauffeur=43');
    expect(filtersNaarQuery(ALLES, leesFilters(ALLES, query('voertuig=v1&status=open'), VANDAAG)).toString()).toBe('van=2026-09-01&tot=2026-09-30&voertuig=v1&status=open');
    expect(filterParams(ALLES)).toEqual(['van', 'tot', 'chauffeur', 'voertuig', 'status']);
  });

  it('heen en terug is stabiel', () => {
    const f = leesFilters(ALLES, query('van=2026-01-01&tot=2026-03-31&chauffeur=43&status=open'), VANDAAG);
    expect(leesFilters(ALLES, filtersNaarQuery(ALLES, f), '2030-01-01')).toEqual(f);
  });

  it('heeftEigenFilters: alleen wat van de standaard afwijkt', () => {
    expect(heeftEigenFilters(verlofsaldo, { jaar: 2026, keuzes: {} }, VANDAAG)).toBe(false);
    expect(heeftEigenFilters(verlofsaldo, { jaar: 2025, keuzes: {} }, VANDAAG)).toBe(true);
    expect(heeftEigenFilters(verlofsaldo, { jaar: 2026, chauffeur: '43', keuzes: {} }, VANDAAG)).toBe(true);
  });

  it('periodeVanFilters: de periode, of het hele jaar', () => {
    expect(periodeVanFilters(verlofsaldo, { jaar: 2025, keuzes: {} })).toEqual({ van: '2025-01-01', tot: '2025-12-31' });
    expect(periodeVanFilters(ALLES, { van: '2026-09-01', tot: '2026-09-30', keuzes: {} })).toEqual({ van: '2026-09-01', tot: '2026-09-30' });
  });

  it('bestandsPeriode: machineleesbaar (ISO) voor de bestandsnaam', () => {
    expect(bestandsPeriode(verlofsaldo, { jaar: 2026, keuzes: {} })).toBe('2026');
    expect(bestandsPeriode(ALLES, { van: '2026-09-01', tot: '2026-09-30', keuzes: {} })).toBe('2026-09-01_2026-09-30');
  });
});

describe('filtersInWoorden (kop van het printblad)', () => {
  it('datums in dd/mm/jjjj, namen in plaats van ids', () => {
    expect(filtersInWoorden(verlofsaldo, { jaar: 2026, keuzes: {} })).toEqual(['Jaar 2026', 'Medewerker: alle']);
    expect(filtersInWoorden(ALLES, { van: '2026-09-01', tot: '2026-09-30', chauffeur: '43', voertuig: 'v1', keuzes: { status: 'open' } }, {
      chauffeur: (id) => (id === '43' ? 'Alex Du Priez' : undefined),
      voertuig: () => '5226 (26)',
    })).toEqual(['Periode 01/09/2026 t/m 30/09/2026', 'Chauffeur: Alex Du Priez', 'Voertuig: 5226 (26)', 'Status: Openstaand']);
  });

  it('een verwijderde gebruiker blijft zichtbaar als "Onbekend (<id>)"', () => {
    expect(filtersInWoorden(verlofsaldo, { jaar: 2026, chauffeur: '999', keuzes: {} }, { chauffeur: () => undefined }))
      .toEqual(['Jaar 2026', 'Medewerker: Onbekend (999)']);
  });
});

describe('filterSchemaVoor (strenge validatie op de server)', () => {
  const schema = filterSchemaVoor(verlofsaldo);
  const alles = filterSchemaVoor(ALLES);

  it('geldige invoer wordt dezelfde filters als bij de lezer', () => {
    const ruw = { jaar: '2025', chauffeur: '43', onbekend: 'x' };
    const uit = valideer(schema, ruw);
    expect(uit).toEqual({ ok: true, data: { jaar: 2025, chauffeur: '43', keuzes: {} } });
    expect(uit.ok && uit.data).toEqual(leesFilters(verlofsaldo, query('jaar=2025&chauffeur=43&onbekend=x'), VANDAAG));
  });

  it('een leeg medewerkerveld is "alle"', () => {
    expect(valideer(schema, { jaar: '2026', chauffeur: '' })).toEqual({ ok: true, data: { jaar: 2026, keuzes: {} } });
  });

  it('jaar ontbreekt, is geen jaar of ligt buiten het bereik: fout bij het veld', () => {
    for (const ruw of [{}, { jaar: 'abc' }, { jaar: '1850' }, { jaar: '20260' }, { jaar: ['2025', '2026'] }]) {
      expect(valideer(schema, ruw)).toEqual({ ok: false, fouten: { jaar: 'Kies een jaar' } });
    }
  });

  it('periode: beide datums verplicht, echte datums, einde niet voor begin', () => {
    expect(valideer(alles, {})).toMatchObject({ ok: false, fouten: { van: 'Kies een begindatum', tot: 'Kies een einddatum' } });
    expect(valideer(alles, { van: '2026-02-30', tot: '2026-03-01' })).toMatchObject({ ok: false, fouten: { van: 'Kies een begindatum' } });
    expect(valideer(alles, { van: '2026-09-02', tot: '2026-09-01' })).toEqual({ ok: false, fouten: { tot: 'De einddatum ligt voor de begindatum' } });
  });

  it('periode: hooguit 366 dagen', () => {
    expect(valideer(alles, { van: '2028-01-01', tot: '2028-12-31' }).ok).toBe(true);
    expect(valideer(alles, { van: '2026-01-01', tot: '2027-01-02' })).toEqual({ ok: false, fouten: { tot: 'Kies een periode van hoogstens 366 dagen' } });
  });

  it('keuzelijst: standaard zonder waarde, fout bij een onbekende waarde', () => {
    const basis = { van: '2026-09-01', tot: '2026-09-30' };
    expect(valideer(alles, basis)).toEqual({ ok: true, data: { ...basis, keuzes: { status: 'alle' } } });
    expect(valideer(alles, { ...basis, status: 'open' })).toMatchObject({ ok: true, data: { keuzes: { status: 'open' } } });
    expect(valideer(alles, { ...basis, status: 'x' })).toEqual({ ok: false, fouten: { status: 'Ongeldige keuze' } });
  });

  it('een id van meer dan 64 tekens komt er niet door', () => {
    expect(valideer(schema, { jaar: '2026', chauffeur: 'x'.repeat(65) })).toEqual({ ok: false, fouten: { chauffeur: 'Ongeldige waarde' } });
  });
});
