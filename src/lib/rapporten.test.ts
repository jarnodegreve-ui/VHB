import { describe, expect, it } from 'vitest';
import type { RapportDefinitie, RapportRij } from '../../shared/rapporten/types';
import { rapportVan } from '../../shared/rapporten/register';
import { berekenTotalen } from '../../shared/rapporten/opmaak';
import { csvBestandsnaam, printUrlVoor, rapportCsv } from './rapporten';
import { bereikUitleg } from './rapportBereik';

const verlofsaldo = rapportVan('verlofsaldo')!;

const UREN: RapportDefinitie = {
  id: 'uren-test',
  domein: 'uren',
  titel: 'Uren',
  omschrijving: 'Test',
  filters: [{ soort: 'periode' }],
  kolommen: [
    { id: 'naam', titel: 'Naam', type: 'tekst' },
    { id: 'saldo', titel: 'Saldo', type: 'duur', totaal: true },
    { id: 'opmerking', titel: 'Opmerking', type: 'tekst' },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'liggend',
  bronNaam: 'prestaties',
};

describe('rapportCsv', () => {
  const rijen: RapportRij[] = [
    { id: '10', naam: 'Bert Buschauffeur', sectie: 'Reguliere diensten', budget: 24, opgenomen: 12, aangevraagd: 2, vrij: 10, kleinVerlet: 1 },
    { id: '11', naam: 'Tom "de sleutel" Technieker', sectie: null, budget: 20, opgenomen: 4, aangevraagd: 0, vrij: 16, kleinVerlet: 0 },
  ];

  it('BOM, puntkomma, \\r\\n, kopregel en totaalrij', () => {
    const csv = rapportCsv(verlofsaldo, rijen, berekenTotalen(verlofsaldo, rijen));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Naam";"Sectie";"Budget";"Opgenomen";"Aangevraagd";"Vrij";"Klein verlet"',
      '"Bert Buschauffeur";"Reguliere diensten";"24";"12";"2";"10";"1"',
      '"Tom ""de sleutel"" Technieker";"";"20";"4";"0";"16";"0"',
      '"Totaal";"";"44";"16";"2";"26";"1"',
    ]);
  });

  it('dezelfde cijferkolommen als de CSV van het saldo-overzicht (Budget, Opgenomen, Aangevraagd, Vrij, Klein verlet)', () => {
    const kop = rapportCsv(verlofsaldo, rijen).slice(1).split('\r\n')[0];
    expect(kop.split(';').slice(2)).toEqual(['"Budget"', '"Opgenomen"', '"Aangevraagd"', '"Vrij"', '"Klein verlet"']);
  });

  it('formule-guard: tekst die met = + - @ begint krijgt een apostrof', () => {
    const csv = rapportCsv(UREN, [{ id: '1', naam: '=HYPERLINK("http://x")', saldo: 60, opmerking: '-5 graden' }, { id: '2', naam: '@jan', saldo: 0, opmerking: '+32 470' }]);
    const [, r1, r2] = csv.slice(1).split('\r\n');
    expect(r1).toBe('"\'=HYPERLINK(""http://x"")";"1:00";"\'-5 graden"');
    expect(r2).toBe('"\'@jan";"0:00";"\'+32 470"');
  });

  it('een negatief getal in een getal- of duurkolom blijft een getal', () => {
    const rijenUren: RapportRij[] = [{ id: '1', naam: 'Bert', saldo: -30, opmerking: null }];
    const [, rij, totaal] = rapportCsv(UREN, rijenUren, berekenTotalen(UREN, rijenUren)).slice(1).split('\r\n');
    expect(rij).toBe('"Bert";"-0:30";""');
    expect(totaal).toBe('"Totaal";"-0:30";""');
  });

  it('maar tekst in een getalkolom gaat wel door de guard', () => {
    const [, rij] = rapportCsv(UREN, [{ id: '1', naam: 'Bert', saldo: '-1+cmd|calc' as unknown as number, opmerking: '' }]).slice(1).split('\r\n');
    expect(rij).toBe('"Bert";"\'-1+cmd|calc";""');
  });

  it('zonder rijen alleen de kopregel', () => {
    expect(rapportCsv(UREN, [], { saldo: 0 }).slice(1)).toBe('"Naam";"Saldo";"Opmerking"');
  });
});

describe('bestandsnaam en print-URL', () => {
  it('rapport + periode in de bestandsnaam', () => {
    expect(csvBestandsnaam(verlofsaldo, { jaar: 2026, keuzes: {} })).toBe('vhb-verlofsaldo-2026.csv');
    expect(csvBestandsnaam(UREN, { van: '2026-09-01', tot: '2026-09-30', keuzes: {} })).toBe('vhb-uren-test-2026-09-01_2026-09-30.csv');
  });

  it('print-URL: ?print-rapport=<id> + dezelfde filterparameters, voluit', () => {
    expect(printUrlVoor(verlofsaldo, { jaar: 2026, keuzes: {} }, 'https://vhbportaal.com/rapporten/verlof/verlofsaldo'))
      .toBe('https://vhbportaal.com/rapporten/verlof/verlofsaldo?print-rapport=verlofsaldo&jaar=2026');
    expect(printUrlVoor(verlofsaldo, { jaar: 2025, chauffeur: '43', keuzes: {} }, 'http://x/', ' du priez '))
      .toBe('http://x/?print-rapport=verlofsaldo&jaar=2025&chauffeur=43&zoek=du+priez');
  });
});

describe('bereikUitleg (periode zonder gegevens)', () => {
  const bereik = { van: '2026-03-02', tot: '2026-12-23' };
  it('nog niets geregistreerd', () => {
    expect(bereikUitleg(verlofsaldo, { van: '2026-01-01', tot: '2026-12-31' }, null))
      .toEqual({ toestand: 'geen-bron', tekst: 'Er zijn nog geen verlofgegevens geregistreerd.' });
  });

  it('vóór de eerste gegevens: zegt vanaf wanneer, in dd/mm/jjjj', () => {
    expect(bereikUitleg(verlofsaldo, { van: '2025-01-01', tot: '2025-12-31' }, bereik))
      .toEqual({ toestand: 'buiten', tekst: 'Er zijn pas verlofgegevens vanaf 02/03/2026.' });
  });

  it('na de laatste gegevens', () => {
    expect(bereikUitleg(verlofsaldo, { van: '2027-01-01', tot: '2027-12-31' }, bereik))
      .toEqual({ toestand: 'buiten', tekst: 'De verlofgegevens lopen tot 23/12/2026, deze periode begint later.' });
  });

  it('gedeeltelijke overlap: regel boven de rijen', () => {
    expect(bereikUitleg(verlofsaldo, { van: '2026-01-01', tot: '2026-12-31' }, bereik))
      .toEqual({ toestand: 'deels', tekst: 'Er zijn pas verlofgegevens vanaf 02/03/2026, het begin van deze periode is dus leeg.' });
  });

  it('binnen het bereik of zonder periode: geen tekst', () => {
    expect(bereikUitleg(verlofsaldo, { van: '2026-04-01', tot: '2026-04-30' }, bereik)).toEqual({ toestand: 'binnen', tekst: null });
    expect(bereikUitleg(verlofsaldo, null, bereik)).toEqual({ toestand: 'binnen', tekst: null });
  });

  it('een lege bron is leeg, ook zonder periode, en de definitie zegt waar de gegevens ingevuld worden', () => {
    expect(bereikUitleg(verlofsaldo, null, null)).toEqual({ toestand: 'geen-bron', tekst: 'Er zijn nog geen verlofgegevens geregistreerd.' });
    expect(bereikUitleg(rapportVan('vervaldata-voertuigen')!, null, null)).toEqual({
      toestand: 'geen-bron',
      tekst: 'Er zijn nog geen vervaldata van voertuigen geregistreerd. Je vult ze in op de fiche van een voertuig, onder Vervaldata.',
    });
  });
});
