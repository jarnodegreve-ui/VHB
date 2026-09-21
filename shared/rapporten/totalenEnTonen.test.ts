import { describe, expect, it } from 'vitest';
import type { RapportDefinitie, RapportRij } from './types';
import { DOMEINEN, RAPPORTEN, rapportVan, rapportenVanDomein } from './register';
import { VASTE_PARAMS, filtersInWoorden, filtersNaarQuery, leesFilters, standaardFilters } from './filters';
import { filterSchemaVoor } from './filterSchema';
import { berekenTotalen, celToon, csvRijen, formatWaarde, heeftTotaalrij, kolomIndeling, totaalSoort } from './opmaak';

/**
 * Wat het fundament in stap 3 bijleerde: totalen die geen som zijn (kleinste,
 * grootste, gewogen gemiddelde), een vast aantal decimalen, de toon van een
 * cel, de peildatum in de filterregel, en de definities van de domeinen
 * voertuigen en personeel.
 */
const DEF: RapportDefinitie = {
  id: 'groepen-test',
  domein: 'voertuigen',
  titel: 'Groepen',
  omschrijving: 'Test',
  filters: [{ soort: 'keuze', id: 'termijn', label: 'Vervalt', opties: [{ waarde: 'alles', label: 'Alles' }, { waarde: '30', label: 'Binnen 30 dagen' }] }],
  kolommen: [
    { id: 'groep', titel: 'Groep', type: 'tekst' },
    { id: 'aantal', titel: 'Aantal', type: 'getal', totaal: true },
    { id: 'gemiddeld', titel: 'Gemiddeld', type: 'getal', decimalen: 1, totaal: 'gemiddelde', totaalGewicht: 'gewicht' },
    { id: 'gewoon', titel: 'Gewoon gemiddelde', type: 'getal', totaal: 'gemiddelde' },
    { id: 'oudste', titel: 'Oudste', type: 'getal', totaal: 'max' },
    { id: 'jongste', titel: 'Jongste', type: 'getal', totaal: 'min' },
    { id: 'resterend', titel: 'Dagen', type: 'getal', signaal: { gevaarOnder: 0, waarschuwingTot: 90 } },
    { id: 'status', titel: 'Status', type: 'tekst', tonen: { Vervallen: 'gevaar', Binnenkort: 'waarschuwing', 'In orde': 'goed' } },
  ],
  sortering: { kolom: 'groep', richting: 'asc' },
  print: 'staand',
  bronNaam: 'testgegevens',
  peildatum: true,
};

const RIJEN: RapportRij[] = [
  { id: 'a', groep: 'Bus', aantal: 4, gewicht: 3, gemiddeld: 6, gewoon: 6, oudste: 10, jongste: 0.2 },
  { id: 'b', groep: 'Privéwagen', aantal: 1, gewicht: 1, gemiddeld: 2, gewoon: 2, oudste: 2, jongste: 2 },
  { id: 'c', groep: 'Zonder datum', aantal: 2, gewicht: 0, gemiddeld: null, gewoon: null, oudste: null, jongste: null },
];

describe('totalen die geen som zijn', () => {
  it('som, gewogen gemiddelde, gewoon gemiddelde, grootste en kleinste', () => {
    expect(berekenTotalen(DEF, RIJEN)).toEqual({ aantal: 7, gemiddeld: 5, gewoon: 4, oudste: 10, jongste: 0.2 });
  });

  it('`true` blijft een som, en een som zonder rijen blijft 0', () => {
    expect(totaalSoort(DEF.kolommen[1])).toBe('som');
    expect(totaalSoort(DEF.kolommen[0])).toBeNull();
    expect(berekenTotalen(DEF, [])).toEqual({ aantal: 0 });
  });

  it('gemiddelde, kleinste en grootste zonder één getal ontbreken: geen verzonnen nul', () => {
    const totalen = berekenTotalen(DEF, [RIJEN[2]]);
    expect(totalen).toEqual({ aantal: 2 });
    // De totaalrij in de CSV laat die cellen leeg.
    expect(csvRijen(DEF, [RIJEN[2]], totalen).at(-1)).toEqual(['Totaal', '2', '', '', '', '', '', '']);
  });

  it('een rij zonder gewicht telt niet mee in een gewogen gemiddelde', () => {
    expect(berekenTotalen(DEF, [{ id: 'x', groep: 'X', aantal: 1, gemiddeld: 9 }, RIJEN[1]]).gemiddeld).toBe(2);
  });

  it('heeftTotaalrij kent elke soort', () => {
    expect(heeftTotaalrij({ ...DEF, kolommen: [DEF.kolommen[0], DEF.kolommen[5]] })).toBe(true);
    expect(heeftTotaalrij({ ...DEF, kolommen: [DEF.kolommen[0], DEF.kolommen[6]] })).toBe(false);
  });
});

describe('vast aantal decimalen', () => {
  it('7 wordt "7,0", in beeld en in de CSV; zonder opgave blijft het "7"', () => {
    expect(formatWaarde(DEF.kolommen[2], 7)).toBe('7,0');
    expect(formatWaarde(DEF.kolommen[2], 5.125)).toBe('5,1');
    expect(formatWaarde(DEF.kolommen[2], 5.96, 'csv')).toBe('6,0');
    expect(formatWaarde(DEF.kolommen[1], 7)).toBe('7');
    expect(formatWaarde(DEF.kolommen[2], null)).toBe('—');
  });
});

describe('celToon', () => {
  const dagen = DEF.kolommen[6];
  const status = DEF.kolommen[7];

  it('getal met een grens: negatief = gevaar, tot en met de grens = waarschuwing, daarna niets', () => {
    expect(celToon(dagen, -1)).toBe('gevaar');
    expect(celToon(dagen, 0)).toBe('waarschuwing');
    expect(celToon(dagen, 90)).toBe('waarschuwing');
    expect(celToon(dagen, 91)).toBeNull();
    expect(celToon(dagen, null)).toBeNull();
  });

  it('statustekst: de toon uit de definitie, een onbekende waarde krijgt er geen', () => {
    expect(celToon(status, 'Vervallen')).toBe('gevaar');
    expect(celToon(status, 'In orde')).toBe('goed');
    expect(celToon(status, 'Iets anders')).toBeNull();
    expect(celToon(DEF.kolommen[0], 'Bus')).toBeNull();
  });
});

describe('peildatum in de filterregel', () => {
  it('sluit de filters in woorden af, in dd/mm/jjjj, en alleen bij een rapport met een peildatum', () => {
    const filters = standaardFilters(DEF, '2026-09-21');
    expect(filtersInWoorden(DEF, filters, { peildatum: '2026-09-21' })).toEqual(['Vervalt: Alles', 'Peildatum 21/09/2026']);
    expect(filtersInWoorden(DEF, filters)).toEqual(['Vervalt: Alles']);
    expect(filtersInWoorden({ ...DEF, peildatum: false }, filters, { peildatum: '2026-09-21' })).toEqual(['Vervalt: Alles']);
  });

  it('de peildatum is geen parameter: de URL bevat alleen de keuzes', () => {
    expect(filtersNaarQuery(DEF, standaardFilters(DEF, '2026-09-21')).toString()).toBe('termijn=alles');
  });
});

describe('de definities van voertuigen en personeel', () => {
  const NIEUW = [...rapportenVanDomein('voertuigen'), ...rapportenVanDomein('personeel')];

  it('zeven voertuigrapporten en vier personeelsrapporten, en het domein personeel staat in de catalogus', () => {
    expect(rapportenVanDomein('voertuigen').map((r) => r.id)).toEqual([
      'wagenpark-overzicht', 'wagenpark-leeftijd', 'wagenpark-technisch', 'wagenpark-samenvatting', 'vervaldata-voertuigen', 'defecten', 'uitgevoerde-werken',
    ]);
    expect(rapportenVanDomein('personeel').map((r) => r.id)).toEqual(['contactlijst', 'actieve-medewerkers', 'medische-schiftingen', 'vakbekwaamheden']);
    expect(DOMEINEN.map((d) => d.id)).toContain('personeel');
    expect(new Set(RAPPORTEN.map((r) => r.id)).size).toBe(RAPPORTEN.length);
  });

  it('een keuzelijst botst nooit met een vaste parameter, de zoekterm of de printparameter, en is uniek binnen het rapport', () => {
    const bezet = new Set<string>([...VASTE_PARAMS, 'zoek', 'print-rapport']);
    for (const def of NIEUW) {
      const ids = def.filters.flatMap((f) => (f.soort === 'keuze' ? [f.id] : []));
      for (const id of ids) expect(bezet.has(id), `${def.id}: ${id}`).toBe(false);
      expect(new Set(ids).size, def.id).toBe(ids.length);
      for (const f of def.filters) if (f.soort === 'keuze') expect(f.opties.length, `${def.id}: ${f.id}`).toBeGreaterThan(1);
    }
  });

  it('telefoon: hoogstens de eerste kolom plus drie smalle of twee bredere kolommen vóór het scrollen', () => {
    // Zelfde breedtes als RapportTabel (rem): eerste 9,5 · getal 3,75 · datum en ja/nee 5,5 · tekst 8; een telefoon van 375 px is 23,4 rem.
    const breedte = (type: string) => (type === 'getal' || type === 'duur' ? 3.75 : type === 'tekst' ? 8 : 5.5);
    for (const def of NIEUW) {
      const { kolommen } = kolomIndeling(def, 'smal');
      const vooraan = kolommen.slice(1).filter((k) => !k.smal);
      const som = 9.5 + vooraan.reduce((n, k) => n + breedte(k.type), 0);
      expect(som, def.id).toBeLessThanOrEqual(23.4);
      expect(vooraan.length, def.id).toBeGreaterThan(0);
    }
  });

  it('wat in de totaalrij telt verdwijnt op de telefoon nooit, en de sorteerkolom bestaat', () => {
    for (const def of NIEUW) {
      expect(def.kolommen.some((k) => k.id === def.sortering.kolom), def.id).toBe(true);
      for (const k of def.kolommen) if (totaalSoort(k)) expect(k.smal === 'verberg' || k.smal === 'onderEerste', `${def.id}: ${k.id}`).toBe(false);
    }
  });

  it('een rapport dat tegenover vandaag rekent zegt dat, en elk leeg geval heeft een bronnaam', () => {
    const metPeildatum = NIEUW.filter((r) => r.peildatum).map((r) => r.id);
    expect(metPeildatum).toEqual(['wagenpark-overzicht', 'wagenpark-leeftijd', 'wagenpark-samenvatting', 'vervaldata-voertuigen', 'defecten', 'actieve-medewerkers', 'medische-schiftingen', 'vakbekwaamheden']);
    for (const def of NIEUW) expect(def.bronNaam.length, def.id).toBeGreaterThan(3);
    // De tabellen die vandaag leeg zijn zeggen waar je ze invult, met een knop naar dat scherm.
    for (const id of ['vervaldata-voertuigen', 'uitgevoerde-werken']) expect(rapportVan(id)!.geenBron?.actie?.view, id).toBeTruthy();
  });

  it('geen em dash als zinsscheiding in titels en omschrijvingen', () => {
    for (const def of NIEUW) expect(`${def.titel} ${def.omschrijving} ${def.geenBron?.tekst ?? ''}`, def.id).not.toMatch(/ — /);
  });
});

describe('filtervalidatie van de nieuwe keuzelijsten (server: streng, client: vergevingsgezind)', () => {
  const overzicht = rapportVan('wagenpark-overzicht')!;
  const medisch = rapportVan('medische-schiftingen')!;

  it('zonder parameters gelden de standaarden: in dienst, alle categorieën, alles', () => {
    expect(filterSchemaVoor(overzicht).parse({})).toEqual({ keuzes: { status: 'in_dienst', categorie: 'alle', aandrijving: 'alle' } });
    expect(filterSchemaVoor(medisch).parse({})).toEqual({ keuzes: { termijn: 'alles' } });
    expect(filterSchemaVoor(medisch).parse({ termijn: '30', chauffeur: '43' })).toEqual({ chauffeur: '43', keuzes: { termijn: '30' } });
  });

  it('een onbekende keuze is een fout bij dat veld', () => {
    const uit = filterSchemaVoor(overzicht).safeParse({ status: 'gesloopt' });
    expect(uit.success).toBe(false);
    if (!uit.success) expect(uit.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['status', 'Ongeldige keuze']]);
    expect(filterSchemaVoor(medisch).safeParse({ termijn: '45' }).success).toBe(false);
  });

  it('de lezer aan de clientkant valt bij rommel terug op de standaard', () => {
    expect(leesFilters(overzicht, new URLSearchParams('status=gesloopt&categorie=bus'), '2026-09-21').keuzes).toEqual({ status: 'in_dienst', categorie: 'bus', aandrijving: 'alle' });
  });
});
