// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  bouwDefecten, bouwUitgevoerdeWerken, bouwVervaldataVoertuigen, bouwWagenparkLeeftijd, bouwWagenparkOverzicht,
  bouwWagenparkSamenvatting, bouwWagenparkTechnisch, type RapportDefect, type RapportVoertuig, type RapportWerk,
} from '../api/_lib/rapporten/voertuigen';
import { berekenTotalen, formatWaarde } from '../shared/rapporten/opmaak';
import { rapportVan } from '../shared/rapporten/register';
import type { RapportFilters } from '../shared/rapporten/types';

/**
 * De rapporten van het domein Voertuigen op vaste cijfers, met een vaste
 * peildatum (21/09/2026) en zone-loze ISO-dagen. De leeftijden zijn met de
 * hand nageteld; dezelfde verwachtingen gelden onder TZ=UTC en
 * TZ=Europe/Brussels.
 */
const VANDAAG = '2026-09-21';
const filters = (keuzes: Record<string, string> = {}, rest: Partial<RapportFilters> = {}): RapportFilters => ({ keuzes, ...rest });

const voertuig = (id: string, busnr: string, kortNr: number | null, rest: Partial<RapportVoertuig>): RapportVoertuig =>
  ({ id, busnr, kortNr, type: 'lijnbus', categorie: 'bus', aandrijving: 'diesel', status: 'actief', ...rest });

const VOERTUIGEN: RapportVoertuig[] = [
  voertuig('v1', '013 023', 23, { nummerplaat: '1-VPZ-070', chassisnr: 'WMAA23ZZ8KF009372', merk: 'MAN', inDienst: '2019-01-23', zitplaatsen: 50 }), // 7,7 jaar
  voertuig('v2', '613 026', 26, { nummerplaat: '2-CWF-068', merk: "MAN LION'S CITY 12E", aandrijving: 'elektrisch', inDienst: '2016-09-21', zitplaatsen: 40 }), // 10,0
  voertuig('v3', '613 028', 28, { merk: "MAN LION'S CITY 12E", aandrijving: 'elektrisch', inDienst: '2026-07-09', zitplaatsen: 40, opmerking: 'Nieuwe batterij' }), // 0,2
  voertuig('v4', 'Reserve 98', 98, { merk: 'VDL', status: 'reserve', inDienst: null, zitplaatsen: null }), // zonder datum: geen leeftijd
  voertuig('v5', 'Jumpy', 5, { merk: 'Citroën', type: 'privevoertuig', categorie: 'privewagen', aandrijving: 'ander', inDienst: '2024-02-29' }), // 2,6 (schrikkeldag)
  voertuig('v6', 'Oud 01', null, { merk: 'MAN', status: 'uit_dienst', inDienst: '2005-01-01', zitplaatsen: 45 }),
];

describe('Wagenpark, overzicht', () => {
  const def = rapportVan('wagenpark-overzicht')!;

  it('standaard alles wat in dienst is (actief en reserve), met leeftijd op de peildatum', () => {
    const { rijen, bereik, peildatum } = bouwWagenparkOverzicht(VOERTUIGEN, filters(), VANDAAG);
    expect(rijen.map((r) => [r.busnr, r.leeftijd, r.status])).toEqual([
      ['013 023', 7.7, 'Actief'],
      ['613 026', 10, 'Actief'],
      ['613 028', 0.2, 'Actief'],
      ['Reserve 98', null, 'Reserve'],
      ['Jumpy', 2.6, 'Actief'],
    ]);
    expect(rijen[0]).toEqual({
      id: 'v1', busnr: '013 023', nummerplaat: '1-VPZ-070', merk: 'MAN', type: 'Lijnbus', aandrijving: 'Diesel', categorie: 'Bus',
      zitplaatsen: 50, inDienst: '2019-01-23', leeftijd: 7.7, status: 'Actief',
    });
    expect(peildatum).toBe(VANDAAG);
    expect(bereik).toEqual({ van: '2005-01-01', tot: VANDAAG });
  });

  it('totaalrij: som van de zitplaatsen en de gemiddelde leeftijd van wie een datum heeft', () => {
    const { rijen } = bouwWagenparkOverzicht(VOERTUIGEN, filters(), VANDAAG);
    const totalen = berekenTotalen(def, rijen);
    expect(totalen.zitplaatsen).toBe(130);
    expect(totalen.leeftijd).toBeCloseTo((7.7 + 10 + 0.2 + 2.6) / 4, 10);
    expect(formatWaarde(def.kolommen.find((k) => k.id === 'leeftijd')!, totalen.leeftijd)).toBe('5,1');
    expect(formatWaarde(def.kolommen.find((k) => k.id === 'leeftijd')!, 10)).toBe('10,0');
  });

  it('filters: uit dienst pas op vraag, categorie en aandrijving', () => {
    const bus = (f: RapportFilters) => bouwWagenparkOverzicht(VOERTUIGEN, f, VANDAAG).rijen.map((r) => r.busnr);
    expect(bus(filters({ status: 'uit_dienst' }))).toEqual(['Oud 01']);
    expect(bus(filters({ status: 'alle' }))).toHaveLength(6);
    expect(bus(filters({ status: 'reserve' }))).toEqual(['Reserve 98']);
    expect(bus(filters({ status: 'actief', categorie: 'bus', aandrijving: 'elektrisch' }))).toEqual(['613 026', '613 028']);
    expect(bus(filters({ categorie: 'privewagen' }))).toEqual(['Jumpy']);
    expect(bus(filters({ aandrijving: 'hybride' }))).toEqual([]);
  });

  it('een leeg wagenpark is een lege bron, geen lijst zonder treffers', () => {
    expect(bouwWagenparkOverzicht([], filters(), VANDAAG)).toEqual({ rijen: [], bereik: null, peildatum: VANDAAG });
    // Wel voertuigen, maar het filter levert niets op: de bron is niet leeg.
    expect(bouwWagenparkOverzicht(VOERTUIGEN, filters({ aandrijving: 'hybride' }), VANDAAG).bereik).not.toBeNull();
  });
});

describe('Wagenpark, gemiddelde leeftijd', () => {
  const def = rapportVan('wagenpark-leeftijd')!;

  it('per categorie: aantal, gemiddelde, oudste en jongste; uit dienst telt niet mee', () => {
    const { rijen, peildatum } = bouwWagenparkLeeftijd(VOERTUIGEN, filters({ groep: 'categorie' }), VANDAAG);
    expect(peildatum).toBe(VANDAAG);
    expect(rijen).toHaveLength(2);
    const [bus, prive] = rijen;
    expect(bus).toMatchObject({ groep: 'Bus', aantal: 4, metLeeftijd: 3, oudste: 10, jongste: 0.2 });
    expect(bus.gemiddeld).toBeCloseTo((7.7 + 10 + 0.2) / 3, 10);
    expect(prive).toMatchObject({ groep: 'Privéwagen', aantal: 1, metLeeftijd: 1, gemiddeld: 2.6, oudste: 2.6, jongste: 2.6 });
  });

  it('totaalrij = de hele vloot: gewogen gemiddelde, niet het gemiddelde van de groepen', () => {
    const { rijen } = bouwWagenparkLeeftijd(VOERTUIGEN, filters({ groep: 'categorie' }), VANDAAG);
    const totalen = berekenTotalen(def, rijen);
    expect(totalen.aantal).toBe(5);
    // (7,7 + 10 + 0,2 + 2,6) / 4 = 5,125; het gemiddelde van de groepsgemiddelden zou 4,28 zijn.
    expect(totalen.gemiddeld).toBeCloseTo(5.125, 10);
    expect(totalen.oudste).toBe(10);
    expect(totalen.jongste).toBe(0.2);
    // Zelfde cijfer als de totaalrij van het overzicht per voertuig.
    const overzicht = rapportVan('wagenpark-overzicht')!;
    expect(totalen.gemiddeld).toBeCloseTo(berekenTotalen(overzicht, bouwWagenparkOverzicht(VOERTUIGEN, filters(), VANDAAG).rijen).leeftijd, 10);
  });

  it('groeperen per merk, type of aandrijving; een groep zonder één datum heeft geen gemiddelde', () => {
    const perMerk = bouwWagenparkLeeftijd(VOERTUIGEN, filters({ groep: 'merk' }), VANDAAG).rijen;
    expect(perMerk.map((r) => [r.groep, r.aantal, r.gemiddeld])).toEqual([
      ['MAN', 1, 7.7],
      ["MAN LION'S CITY 12E", 2, 5.1],
      ['VDL', 1, null],
      ['Citroën', 1, 2.6],
    ]);
    expect(bouwWagenparkLeeftijd(VOERTUIGEN, filters({ groep: 'aandrijving' }), VANDAAG).rijen.map((r) => r.groep)).toEqual(['Diesel', 'Elektrisch', 'Ander']);
    expect(bouwWagenparkLeeftijd(VOERTUIGEN, filters({ groep: 'type', categorie: 'bus' }), VANDAAG).rijen.map((r) => [r.groep, r.aantal])).toEqual([['Lijnbus', 4]]);
  });
});

describe('Wagenpark, technische gegevens en samenvatting', () => {
  it('technische gegevens: chassisnummer en opmerking, zelfde filters als het overzicht', () => {
    const { rijen, peildatum } = bouwWagenparkTechnisch(VOERTUIGEN, filters({ aandrijving: 'elektrisch' }), VANDAAG);
    expect(peildatum).toBeUndefined();
    expect(rijen).toEqual([
      { id: 'v2', busnr: '613 026', nummerplaat: '2-CWF-068', chassisnr: null, merk: "MAN LION'S CITY 12E", type: 'Lijnbus', aandrijving: 'Elektrisch', zitplaatsen: 40, inDienst: '2016-09-21', opmerking: null },
      { id: 'v3', busnr: '613 028', nummerplaat: null, chassisnr: null, merk: "MAN LION'S CITY 12E", type: 'Lijnbus', aandrijving: 'Elektrisch', zitplaatsen: 40, inDienst: '2026-07-09', opmerking: 'Nieuwe batterij' },
    ]);
  });

  it('samenvatting per merk, type en aandrijving, met totaalrij', () => {
    const def = rapportVan('wagenpark-samenvatting')!;
    const { rijen } = bouwWagenparkSamenvatting(VOERTUIGEN, filters(), VANDAAG);
    expect(rijen.map((r) => [r.merk, r.type, r.aandrijving, r.aantal, r.zitplaatsen, r.gemiddeld])).toEqual([
      ['MAN', 'Lijnbus', 'Diesel', 1, 50, 7.7],
      ["MAN LION'S CITY 12E", 'Lijnbus', 'Elektrisch', 2, 80, 5.1],
      ['VDL', 'Lijnbus', 'Diesel', 1, 0, null],
      ['Citroën', 'Privévoertuig', 'Ander', 1, 0, 2.6],
    ]);
    const totalen = berekenTotalen(def, rijen);
    expect(totalen).toMatchObject({ aantal: 5, zitplaatsen: 130 });
    expect(totalen.gemiddeld).toBeCloseTo(5.125, 10);
  });
});

describe('Vervaldata voertuigen', () => {
  const vervaldata = [
    { vehicleId: 'v1', soort: 'keuring', validUntil: '2026-09-20', opmerking: 'Afspraak SBAT gemaakt' }, // gisteren: vervallen
    { vehicleId: 'v1', soort: 'tachograaf', validUntil: '2026-09-21' }, // vandaag: binnenkort
    { vehicleId: 'v2', soort: 'keuring', validUntil: '2026-10-21' }, // 30 dagen
    { vehicleId: 'v2', soort: 'brandblussers', validUntil: '2026-12-20' }, // 90 dagen: nog binnenkort
    { vehicleId: 'v3', soort: 'keuring', validUntil: '2026-12-21' }, // 91 dagen: in orde
    { vehicleId: 'weg', soort: 'keuring', validUntil: '2027-03-01' },
  ];
  const bouw = (f: RapportFilters) => bouwVervaldataVoertuigen({ voertuigen: VOERTUIGEN, vervaldata }, f, VANDAAG);

  it('resterende dagen en status op de grenzen: vervallen, binnenkort, in orde', () => {
    expect(bouw(filters()).rijen.map((r) => [r.busnr, r.soort, r.resterend, r.status])).toEqual([
      ['013 023 (23)', 'Keuring SBAT', -1, 'Vervallen'],
      ['013 023 (23)', 'Tachograaf en snelheidsbegrenzer', 0, 'Binnenkort'],
      ['613 026 (26)', 'Keuring SBAT', 30, 'Binnenkort'],
      ['613 026 (26)', 'Brandblussers', 90, 'Binnenkort'],
      ['613 028 (28)', 'Keuring SBAT', 91, 'In orde'],
      ['Onbekend (weg)', 'Keuring SBAT', 161, 'In orde'],
    ]);
  });

  it('termijn, soort en voertuig', () => {
    expect(bouw(filters({ termijn: '30' })).rijen.map((r) => r.resterend)).toEqual([-1, 0, 30]);
    expect(bouw(filters({ termijn: '60' })).rijen).toHaveLength(3);
    expect(bouw(filters({ termijn: '90' })).rijen).toHaveLength(4);
    expect(bouw(filters({ soort: 'brandblussers' })).rijen.map((r) => r.id)).toEqual(['v2:brandblussers']);
    expect(bouw(filters({}, { voertuig: 'v1' })).rijen).toHaveLength(2);
  });

  it('de tabel is leeg (zoals vandaag op productie): eerlijk "nog niets geregistreerd", geen "geen resultaten"', () => {
    expect(bouwVervaldataVoertuigen({ voertuigen: VOERTUIGEN, vervaldata: [] }, filters(), VANDAAG)).toEqual({ rijen: [], bereik: null, peildatum: VANDAAG });
    // Wel gegevens, maar het filter levert niets op: het bereik blijft gevuld.
    expect(bouw(filters({}, { voertuig: 'v5' }))).toMatchObject({ rijen: [], bereik: { van: '2026-09-20', tot: '2027-03-01' } });
  });
});

describe('Defecten (gele boek)', () => {
  const users = [{ id: '10', name: 'Bert Buschauffeur' }, { id: '55', name: 'Jelle Technieker' }];
  const defect = (id: string, gemeldOp: string, rest: Partial<RapportDefect>): RapportDefect =>
    ({ id, vehicleId: 'v1', busnr: '013 023', kortNr: 23, gemeldOp, gemeldDoor: '10', werktype: 'T', omschrijving: 'Deur sluit niet', status: 'open', ...rest });
  const DEFECTEN: RapportDefect[] = [
    defect('d1', '2026-09-01T06:15:00+00:00', {}),
    defect('d2', '2026-09-10T08:00:00+00:00', { status: 'uitgevoerd', uitgevoerdOp: '2026-09-14', uitgevoerdDoor: '55', manuren: 1.5, werktype: 'C' }),
    // 31/08 om 22:30 UTC = 1 september 00:30 in België: hoort bij september.
    defect('d3', '2026-08-31T22:30:00+00:00', { status: 'geannuleerd', gemeldDoor: '999', vehicleId: 'v2', busnr: '613 026', kortNr: 26 }),
    defect('d4', '2026-04-24T06:00:00+00:00', { status: 'uitgevoerd', uitgevoerdOp: '2026-04-24', uitgevoerdDoor: '55', manuren: 0.25 }),
  ];
  const september = { van: '2026-09-01', tot: '2026-09-30' };
  const bouw = (f: RapportFilters) => bouwDefecten({ defecten: DEFECTEN, users }, f, VANDAAG);

  it('periode op de Belgische dag van de melding; doorlooptijd open = tot vandaag', () => {
    const { rijen, bereik, peildatum } = bouw(filters({}, september));
    expect(rijen.map((r) => [r.id, r.gemeldOp, r.status, r.doorlooptijd])).toEqual([
      ['d1', '2026-09-01', 'Open', 20],
      ['d2', '2026-09-10', 'Uitgevoerd', 4],
      ['d3', '2026-09-01', 'Geannuleerd', null],
    ]);
    expect(rijen[1]).toEqual({
      id: 'd2', gemeldOp: '2026-09-10', bus: '013 023 (23)', werktype: 'Carrosserie', omschrijving: 'Deur sluit niet', gemeldDoor: 'Bert Buschauffeur',
      status: 'Uitgevoerd', uitgevoerdOp: '2026-09-14', uitgevoerdDoor: 'Jelle Technieker', manuren: 1.5, doorlooptijd: 4,
    });
    expect(bereik).toEqual({ van: '2026-04-24', tot: '2026-09-10' });
    expect(peildatum).toBe(VANDAAG);
  });

  it('een verwijderde melder blijft "Onbekend (<id>)"', () => {
    expect(bouw(filters({}, september)).rijen[2].gemeldDoor).toBe('Onbekend (999)');
  });

  it('voertuig, werktype en status; totaal manuren en gemiddelde doorlooptijd', () => {
    expect(bouw(filters({ status: 'open' }, september)).rijen.map((r) => r.id)).toEqual(['d1']);
    expect(bouw(filters({ werktype: 'C' }, september)).rijen.map((r) => r.id)).toEqual(['d2']);
    expect(bouw(filters({}, { ...september, voertuig: 'v2' })).rijen.map((r) => r.id)).toEqual(['d3']);
    const totalen = berekenTotalen(rapportVan('defecten')!, bouw(filters({}, september)).rijen);
    expect(totalen).toEqual({ manuren: 1.5, doorlooptijd: 12 });
    // Dezelfde dag gemeld en uitgevoerd: doorlooptijd 0, en dat blijft "0".
    expect(bouw(filters({}, { van: '2026-04-01', tot: '2026-04-30' })).rijen[0].doorlooptijd).toBe(0);
  });

  it('een leeg gele boek is een lege bron', () => {
    expect(bouwDefecten({ defecten: [], users }, filters({}, september), VANDAAG).bereik).toBeNull();
  });
});

describe('Uitgevoerde werken', () => {
  const users = [{ id: '55', name: 'Jelle Technieker' }];
  const werk = (id: string, datum: string, rest: Partial<RapportWerk>): RapportWerk =>
    ({ id, datum, mecanicienId: '55', vehicleId: 'v1', busnr: '013 023', kortNr: 23, werkcode: 'H', omschrijving: 'Remblokken vervangen', werkuren: 1.5, ...rest });
  const WERKEN: RapportWerk[] = [
    werk('w1', '2026-09-02', { beginTijd: '08:00', eindeTijd: '09:30' }),
    werk('w2', '2026-09-03', { werkcode: 'A', vehicleId: null, busnr: null, kortNr: null, omschrijving: 'Bestellingen', werkuren: 0.25, mecanicienId: '77' }),
    werk('w3', '2026-08-15', { werkcode: 'O', werkuren: 2.75 }),
  ];
  const september = { van: '2026-09-01', tot: '2026-09-30' };

  it('uren zoals ze opgeslagen staan, garagewerk zonder bus, totaalrij', () => {
    const { rijen, bereik, peildatum } = bouwUitgevoerdeWerken({ werken: WERKEN, users }, filters({}, september));
    expect(rijen).toEqual([
      { id: 'w1', datum: '2026-09-02', bus: '013 023 (23)', werkcode: 'Herstelling', omschrijving: 'Remblokken vervangen', mecanicien: 'Jelle Technieker', begin: '08:00', einde: '09:30', werkuren: 1.5 },
      { id: 'w2', datum: '2026-09-03', bus: 'Garage, algemeen', werkcode: 'Administratie', omschrijving: 'Bestellingen', mecanicien: 'Onbekend (77)', begin: null, einde: null, werkuren: 0.25 },
    ]);
    expect(berekenTotalen(rapportVan('uitgevoerde-werken')!, rijen)).toEqual({ werkuren: 1.75 });
    expect(bereik).toEqual({ van: '2026-08-15', tot: '2026-09-03' });
    expect(peildatum).toBeUndefined();
  });

  it('voertuig, mecanicien en werkcode', () => {
    const ids = (f: RapportFilters) => bouwUitgevoerdeWerken({ werken: WERKEN, users }, f).rijen.map((r) => r.id);
    expect(ids(filters({}, { ...september, chauffeur: '77' }))).toEqual(['w2']);
    expect(ids(filters({}, { ...september, voertuig: 'v1' }))).toEqual(['w1']);
    expect(ids(filters({ werkcode: 'O' }, { van: '2026-08-01', tot: '2026-08-31' }))).toEqual(['w3']);
  });

  it('de tabel is leeg (zoals vandaag op productie): een lege bron', () => {
    expect(bouwUitgevoerdeWerken({ werken: [], users }, filters({}, september))).toEqual({ rijen: [], bereik: null });
  });
});
