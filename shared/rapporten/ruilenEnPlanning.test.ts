import { describe, expect, it } from 'vitest';
import { DOMEINEN, RAPPORTEN, rapportVan, rapportenVanDomein } from './register';
import { VASTE_PARAMS, filtersInWoorden, filtersNaarQuery, leesFilters, standaardFilters } from './filters';
import { filterSchemaVoor } from './filterSchema';
import {
  RAPPORT_PER_PAGINA, SMAL_BREEDTE, SMAL_KADER_REM, VEEL_RIJEN, formatWaarde, isPilKolom, kolomIndeling, smalleBreedte, sorteerRijen, totaalSoort, veelRijenUitleg,
} from './opmaak';
import {
  PERIODE_KEUZES, herkenPeriode, isHeleMaanden, maandagVanWeek, maandenInPeriode, opHeleMaanden, periodeFout, periodeKeuzesVoor, periodeVoor,
} from './periode';

/**
 * Wat het fundament in stap 4 bijleerde voor de domeinen ruilen en planning:
 * snelkeuzes per soort rapport (terug, per dag, vooruit), een periode in hele
 * maanden, de kolomtypes `tijd` en `code`, de melding bij veel rijen, en de
 * definities zelf.
 */
const NIEUW = [...rapportenVanDomein('ruilen'), ...rapportenVanDomein('planning'), rapportVan('inzet-per-voertuig')!];
const query = (tekst: string) => new URLSearchParams(tekst);

describe('de definities van ruilen en planning', () => {
  it('drie ruilrapporten, drie planningsrapporten, en Inzet per voertuig staat bij Voertuigen', () => {
    expect(rapportenVanDomein('ruilen').map((r) => r.id)).toEqual(['uitgevoerde-wissels', 'ruilen-per-chauffeur', 'ruilaanvragen']);
    expect(rapportenVanDomein('planning').map((r) => r.id)).toEqual(['overzicht-per-chauffeur', 'diensten-per-dag', 'openstaande-diensten']);
    expect(rapportVan('inzet-per-voertuig')!.domein).toBe('voertuigen');
    expect(DOMEINEN.filter((d) => !d.volgtLater).every((d) => rapportenVanDomein(d.id).length > 0)).toBe(true);
    expect(new Set(RAPPORTEN.map((r) => r.id)).size).toBe(RAPPORTEN.length);
  });

  it('telefoon: de eerste kolom plus wat ervoor het scrollen staat past binnen het tabelkader op 375 px', () => {
    for (const def of NIEUW) {
      const { kolommen } = kolomIndeling(def, 'smal');
      const vooraan = kolommen.slice(1).filter((k) => !k.smal);
      const som = SMAL_BREEDTE.eerste + vooraan.reduce((n, k) => n + smalleBreedte(k, false), 0);
      // Het kader, niet het scherm: 375 px min de zijmarges van de pagina (e2e meet hetzelfde op 375 en 390 px).
      expect(som, def.id).toBeLessThanOrEqual(SMAL_KADER_REM);
      expect(vooraan.length, def.id).toBeGreaterThan(0);
    }
  });

  it('nooit een doorgesneden statuspil: een pilkolom staat onder de eerste kolom of helemaal achteraan', () => {
    for (const def of NIEUW) {
      const { kolommen } = kolomIndeling(def, 'smal');
      const pillen = kolommen.filter(isPilKolom);
      for (const k of pillen) expect(kolommen.indexOf(k), `${def.id}: ${k.id}`).toBe(kolommen.length - 1);
    }
  });

  it('wat in de totaalrij telt verdwijnt op de telefoon nooit, en de sorteerkolom bestaat', () => {
    for (const def of NIEUW) {
      expect(def.kolommen.some((k) => k.id === def.sortering.kolom), def.id).toBe(true);
      for (const k of def.kolommen) if (totaalSoort(k)) expect(k.smal === 'verberg' || k.smal === 'onderEerste', `${def.id}: ${k.id}`).toBe(false);
    }
  });

  it('een keuzelijst botst nooit met een vaste parameter, heeft korte labels en is uniek', () => {
    const bezet = new Set<string>([...VASTE_PARAMS, 'zoek', 'print-rapport']);
    for (const def of NIEUW) {
      const keuzes = def.filters.flatMap((f) => (f.soort === 'keuze' ? [f] : []));
      for (const f of keuzes) {
        expect(bezet.has(f.id), `${def.id}: ${f.id}`).toBe(false);
        // Het veld is op de telefoon een halve regel breed (±13 tekens naast de pijl).
        for (const o of f.opties) expect(o.label.length, `${def.id}: ${o.label}`).toBeLessThanOrEqual(13);
      }
      expect(new Set(keuzes.map((f) => f.id)).size, def.id).toBe(keuzes.length);
    }
  });

  it('wat tegenover vandaag rekent zegt dat; elke lege bron heeft een tekst, en een knop waar er een scherm voor is', () => {
    expect(NIEUW.filter((r) => r.peildatum).map((r) => r.id)).toEqual(['ruilaanvragen', 'openstaande-diensten']);
    for (const def of NIEUW) {
      expect(def.bronNaam.length, def.id).toBeGreaterThan(3);
      expect(def.geenBron?.tekst, def.id).toBeTruthy();
    }
    // Een bus per dienst houdt het portaal nergens bij: daar is geen scherm voor, dus ook geen knop.
    expect(rapportVan('inzet-per-voertuig')!.geenBron?.actie).toBeUndefined();
  });

  it('Openstaande diensten zegt eerlijk dat het de toestand van nu is', () => {
    expect(rapportVan('openstaande-diensten')!.omschrijving).toMatch(/toestand van nu, geen historiek/);
  });

  it('geen em dash als zinsscheiding in titels, omschrijvingen en lege teksten', () => {
    for (const def of NIEUW) expect(`${def.titel} ${def.omschrijving} ${def.geenBron?.tekst ?? ''}`, def.id).not.toMatch(/ — /);
  });

  it('Diensten per dag en Inzet per voertuig: dezelfde kolommen, anders geschikt; alleen Inzet telt de duur op', () => {
    const ids = (id: string) => rapportVan(id)!.kolommen.map((k) => k.id);
    expect(ids('diensten-per-dag')).toEqual(['datum', 'dag', 'dienst', 'deel', 'start', 'einde', 'duur', 'loop', 'bus', 'chauffeur']);
    expect(ids('inzet-per-voertuig')).toEqual(['datum', 'dag', 'bus', 'dienst', 'duur', 'deel', 'start', 'einde', 'chauffeur']);
    expect(rapportVan('inzet-per-voertuig')!.filters[0]).toEqual({ soort: 'voertuig' });
    expect(totaalSoort(rapportVan('inzet-per-voertuig')!.kolommen.find((k) => k.id === 'duur')!)).toBe('som');
    expect(totaalSoort(rapportVan('diensten-per-dag')!.kolommen.find((k) => k.id === 'duur')!)).toBeNull();
  });
});

describe('snelkeuzes per soort rapport', () => {
  it('terugkijken blijft wat het was; per dag en vooruit hebben hun eigen lijst', () => {
    expect(PERIODE_KEUZES.map((k) => k.waarde)).toEqual(['deze-maand', 'vorige-maand', 'dit-kwartaal', 'dit-jaar', 'vrij']);
    expect(periodeKeuzesVoor('dagen').map((k) => k.label)).toEqual(['Deze week', 'Vorige week', 'Deze maand', 'Vorige maand', 'Vrije periode']);
    expect(periodeKeuzesVoor('vooruit').map((k) => k.label)).toEqual(['Deze week', 'Komende 4 weken', 'Deze maand', 'Volgende maand', 'Vrije periode']);
  });

  it('deze week loopt van maandag tot en met zondag, ook op zondag en over een jaargrens', () => {
    expect(periodeVoor('deze-week', '2026-09-21')).toEqual({ van: '2026-09-21', tot: '2026-09-27' });
    expect(periodeVoor('deze-week', '2026-09-27')).toEqual({ van: '2026-09-21', tot: '2026-09-27' });
    expect(periodeVoor('deze-week', '2027-01-01')).toEqual({ van: '2026-12-28', tot: '2027-01-03' });
    expect(periodeVoor('vorige-week', '2026-09-21')).toEqual({ van: '2026-09-14', tot: '2026-09-20' });
    expect(maandagVanWeek('2026-09-23')).toBe('2026-09-21');
  });

  it('een week met de zomer- of winteruurwissel telt gewoon zeven dagen', () => {
    // 29/03/2026 en 25/10/2026: de klok verspringt op zondag.
    expect(periodeVoor('deze-week', '2026-03-29')).toEqual({ van: '2026-03-23', tot: '2026-03-29' });
    expect(periodeVoor('deze-week', '2026-10-25')).toEqual({ van: '2026-10-19', tot: '2026-10-25' });
    expect(periodeVoor('komende-4-weken', '2026-10-20')).toEqual({ van: '2026-10-20', tot: '2026-11-16' });
  });

  it('volgende maand schuift over de jaargrens', () => {
    expect(periodeVoor('volgende-maand', '2026-12-15')).toEqual({ van: '2027-01-01', tot: '2027-01-31' });
  });

  it('een periode wordt alleen herkend als snelkeuze uit de eigen lijst', () => {
    const week = periodeVoor('deze-week', '2026-09-21');
    expect(herkenPeriode(week, '2026-09-21')).toBe('vrij');
    expect(herkenPeriode(week, '2026-09-21', 'dagen')).toBe('deze-week');
    expect(herkenPeriode(periodeVoor('komende-4-weken', '2026-09-21'), '2026-09-21', 'vooruit')).toBe('komende-4-weken');
  });

  it('de standaard van de definitie: Diensten per dag = deze week, Openstaande diensten = komende vier weken', () => {
    expect(standaardFilters(rapportVan('diensten-per-dag')!, '2026-09-23')).toMatchObject({ van: '2026-09-21', tot: '2026-09-27' });
    expect(standaardFilters(rapportVan('openstaande-diensten')!, '2026-09-21')).toMatchObject({ van: '2026-09-21', tot: '2026-10-18' });
    expect(standaardFilters(rapportVan('ruilaanvragen')!, '2026-09-21')).toMatchObject({ van: '2026-01-01', tot: '2026-12-31', keuzes: { status: 'alle', soort: 'alle' } });
  });
});

describe('periode in hele maanden (Overzicht per chauffeur)', () => {
  const def = rapportVan('overzicht-per-chauffeur')!;
  const schema = filterSchemaVoor(def);

  it('maanden van een periode, over een jaargrens', () => {
    expect(maandenInPeriode({ van: '2026-11-01', tot: '2027-02-28' })).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(maandenInPeriode({ van: '2026-09-01', tot: '2026-09-30' })).toEqual(['2026-09']);
    expect(maandenInPeriode({ van: '2026-09-30', tot: '2026-09-01' })).toEqual([]);
  });

  it('afronden en herkennen, met de schrikkeldag', () => {
    expect(opHeleMaanden({ van: '2028-02-10', tot: '2028-02-12' })).toEqual({ van: '2028-02-01', tot: '2028-02-29' });
    expect(isHeleMaanden({ van: '2026-07-01', tot: '2026-09-30' })).toBe(true);
    expect(isHeleMaanden({ van: '2026-07-01', tot: '2026-09-29' })).toBe(false);
  });

  it('de server is streng: een halve maand is 400 bij het veld, hele maanden mogen', () => {
    expect(schema.safeParse({ van: '2026-07-01', tot: '2026-09-30' }).success).toBe(true);
    const halfBegin = schema.safeParse({ van: '2026-07-15', tot: '2026-09-30' });
    expect(halfBegin.success).toBe(false);
    expect(!halfBegin.success && halfBegin.error.issues[0]).toMatchObject({ path: ['van'], message: 'Dit rapport telt per hele maand: begin op de eerste dag van een maand' });
    const halfEinde = schema.safeParse({ van: '2026-07-01', tot: '2026-09-29' });
    expect(!halfEinde.success && halfEinde.error.issues[0]).toMatchObject({ path: ['tot'] });
    expect(periodeFout({ van: '2026-01-01', tot: '2027-01-31' }, { heleMaanden: true })).toEqual({ veld: 'tot', tekst: 'Kies hoogstens twaalf maanden' });
    // Een gewoon rapport merkt er niets van.
    expect(periodeFout({ van: '2026-07-15', tot: '2026-09-29' })).toBeNull();
  });

  it('de lezer aan de clientkant rondt een link met losse datums af op hele maanden', () => {
    expect(leesFilters(def, query('van=2026-07-15&tot=2026-09-02'), '2026-09-21')).toMatchObject({ van: '2026-07-01', tot: '2026-09-30' });
    // Zonder keuze: deze maand; en de URL die eruit volgt is wat de server aanvaardt.
    const standaard = leesFilters(def, query(''), '2026-09-21');
    expect(standaard).toMatchObject({ van: '2026-09-01', tot: '2026-09-30' });
    expect(schema.safeParse(Object.fromEntries(filtersNaarQuery(def, standaard))).success).toBe(true);
    expect(filtersInWoorden(def, standaard)).toEqual(['Periode 01/09/2026 t/m 30/09/2026', 'Chauffeur: alle']);
  });
});

describe('kolomtypes tijd en code', () => {
  const def = rapportVan('diensten-per-dag')!;
  const kolom = (id: string) => def.kolommen.find((k) => k.id === id)!;

  it('een kloktijd blijft wat ze is, 24 uur, in beeld en in de CSV; leeg is een streepje', () => {
    expect(formatWaarde(kolom('start'), '05:28')).toBe('05:28');
    expect(formatWaarde(kolom('einde'), '26:16', 'csv')).toBe('26:16');
    expect(formatWaarde(kolom('start'), null)).toBe('—');
    expect(formatWaarde(kolom('duur'), 405)).toBe('6:45');
  });

  it('smal op de telefoon: een tijd en een dienstnummer zijn zo breed als een cijfer, een busnummer blijft gewone tekst', () => {
    expect(smalleBreedte(kolom('start'), false)).toBe(SMAL_BREEDTE.tijd);
    expect(smalleBreedte(kolom('dienst'), false)).toBe(SMAL_BREEDTE.code);
    expect(smalleBreedte(kolom('bus'), false)).toBe(SMAL_BREEDTE.tekst);
  });

  it('de datum sorteert op datum, dienst en deel (de sleutel `volgorde`)', () => {
    const rijen = [
      { id: 'c', datum: '2026-09-22', volgorde: '2026-09-22|00002101|1|7' },
      { id: 'b', datum: '2026-09-21', volgorde: '2026-09-21|00002109|2|7' },
      { id: 'a', datum: '2026-09-21', volgorde: '2026-09-21|00002109|1|7' },
    ];
    expect(sorteerRijen(def, rijen, 'datum', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('veel rijen', () => {
  it('onder de grens niets, erboven één zin met het aantal pagina’s, zonder em dash', () => {
    expect(veelRijenUitleg(VEEL_RIJEN - 1)).toBeNull();
    const tekst = veelRijenUitleg(2225)!;
    expect(tekst).toContain('2225 rijen');
    expect(tekst).toContain(`${Math.ceil(2225 / RAPPORT_PER_PAGINA)} pagina`);
    expect(tekst).not.toMatch(/ — /);
  });
});
