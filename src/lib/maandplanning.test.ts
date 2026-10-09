import { describe, it, expect } from 'vitest';
import type { MonthCell } from './monthPlanning';
import {
  addDaysIso, berekenCodeLegend, bouwDagRijen, celTitel, dayHeader, formatDayMonth, groepeerPerSectie,
  maandNaarParam, maandUitParam, mondayOf, monthOf, noteKey, sectieLabel, sectionOf, sorteerOverzichtRijen,
  urenLabel, voegCellenSamen, voegChauffeursSamen, werkdagenUitCellen, wisselOverzichtSortering,
  type Cellen, type OverzichtRij,
} from './maandplanning';

/**
 * De pure helpers van de Maandplanning, op 09-10 uit CapacityView.tsx
 * verplaatst (stap 1 van de splitsing). Vaste cijfers, zodat een latere
 * wijziging aan de view of aan deze module het gedrag niet stil verschuift.
 */
const cel = (code: string, kind: MonthCell['kind'] = 'service', extra: Partial<MonthCell> = {}): MonthCell =>
  ({ code, kind, label: extra.label ?? (kind === 'service' ? `Dienst ${code}` : code), segments: [], ...extra });

describe('datumrekenwerk', () => {
  it('mondayOf geeft de maandag van de week, ook op zondag', () => {
    expect(mondayOf('2026-10-09')).toBe('2026-10-05'); // vrijdag
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // zondag
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // maandag zelf
  });

  it('addDaysIso telt over een maandgrens en terug', () => {
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDaysIso('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('monthOf knipt de maand uit een ISO-datum', () => {
    expect(monthOf('2026-10-09')).toBe('2026-10');
  });

  it('dayHeader kent letter, dagnummer, weekend en maandag', () => {
    expect(dayHeader('2026-10-05')).toEqual({ letter: 'M', day: 5, weekend: false, isMonday: true });
    expect(dayHeader('2026-10-10')).toEqual({ letter: 'Z', day: 10, weekend: true, isMonday: false });
    expect(dayHeader('2026-10-11')).toEqual({ letter: 'Z', day: 11, weekend: true, isMonday: false });
  });

  it('formatDayMonth geeft dag en korte maand', () => {
    expect(formatDayMonth('2026-10-09')).toMatch(/^9 okt/);
  });
});

describe('maand in de URL', () => {
  it('leest alleen een geldige maand', () => {
    expect(maandUitParam('2026-10')).toEqual(new Date(2026, 9, 1));
    expect(maandUitParam('2026-13')).toBeNull();
    expect(maandUitParam('2026-1')).toBeNull();
    expect(maandUitParam(null)).toBeNull();
  });

  it('schrijft de maand met twee cijfers', () => {
    expect(maandNaarParam(new Date(2026, 0, 15))).toBe('2026-01');
    expect(maandNaarParam(new Date(2026, 11, 1))).toBe('2026-12');
  });
});

describe('sectie en notitie', () => {
  it('sectionOf valt terug op Overige, sectieLabel maakt van Reguliere de volle naam', () => {
    expect(sectionOf({ section: null })).toBe('Overige');
    expect(sectionOf({ section: 'Flexi' })).toBe('Flexi');
    expect(sectieLabel('Reguliere')).toBe('Reguliere diensten');
    expect(sectieLabel(' reguliere ')).toBe('Reguliere diensten');
    expect(sectieLabel('Flexi/invallers')).toBe('Flexi/invallers');
  });

  it('noteKey is chauffeur en dag', () => {
    expect(noteKey('7', '2026-10-09')).toBe('7:2026-10-09');
  });
});

describe('celTitel', () => {
  it('beschrijft type, code, open dienst, ruil en notitie', () => {
    expect(celTitel(cel('4102'), false)).toBe('Dienst · 4102, klik voor details');
    expect(celTitel(cel('ziek', 'absence', { hiddenService: '4102' }), true))
      .toBe('Afwezig · ziek · dienst 4102 nog niet herverdeeld · notitie, klik voor details');
    expect(celTitel(cel('4102', 'service', { swapId: 's1', swapFrom: 'Bert' }), false))
      .toBe('Dienst · 4102 · geruild met Bert, klik voor details');
    expect(celTitel(cel('4102', 'service', { swapId: 's1', swapManual: true }), false))
      .toBe('Dienst · 4102 · handmatig overgezet van een collega, klik voor details');
    expect(celTitel(cel('vrij', 'absence', { swapId: 's1', swapAway: true, swapTo: 'Anna' }), false))
      .toBe('Afwezig · vrij · dienst weggeruild naar Anna, klik voor details');
  });
});

describe('twee maanden in één venster', () => {
  const basis = [{ id: '1', name: 'Anna', section: 'Reguliere' }, { id: '2', name: 'Bert', section: 'Flexi' }];
  const extra = [{ id: '2', name: 'Bert', section: 'Flexi' }, { id: '3', name: 'Cas', section: 'Flexi' }];

  it('voegChauffeursSamen houdt de volgorde van de hoofdmaand en voegt nieuwe achteraan toe', () => {
    expect(voegChauffeursSamen(basis, extra).map((d) => d.id)).toEqual(['1', '2', '3']);
    // Zonder extra maand komt precies de basislijst terug (zelfde referentie, geen hermemoisatie).
    expect(voegChauffeursSamen(basis, [])).toBe(basis);
  });

  it('voegCellenSamen laat de hoofdmaand winnen per dag', () => {
    const hoofd: Cellen = { '1': { '2026-10-30': cel('11') } };
    const ander: Cellen = { '1': { '2026-10-30': cel('99'), '2026-11-02': cel('12') }, '3': { '2026-11-02': cel('13') } };
    const samen = voegCellenSamen(hoofd, ander);
    expect(samen['1']['2026-10-30'].code).toBe('11');
    expect(samen['1']['2026-11-02'].code).toBe('12');
    expect(samen['3']['2026-11-02'].code).toBe('13');
    expect(voegCellenSamen(hoofd, {})).toBe(hoofd);
  });
});

describe('werkdagen en secties', () => {
  const cells: Cellen = {
    '1': { '2026-10-05': cel('11'), '2026-10-06': cel('ziek', 'absence', { hiddenService: '11' }), '2026-10-07': cel('vrij', 'absence') },
    '2': { '2026-10-05': cel('bv', 'leave') },
  };

  it('werkdagenUitCellen telt diensten en de dienst onder een afwezigheid', () => {
    const per = werkdagenUitCellen(cells);
    expect([...per.get('1')!]).toEqual(['2026-10-05', '2026-10-06']);
    expect(per.get('2')!.size).toBe(0);
  });

  it('groepeerPerSectie begint een groep waar de sectie wisselt', () => {
    const groepen = groepeerPerSectie([
      { id: '1', name: 'Anna', section: 'Reguliere' },
      { id: '2', name: 'Bert', section: 'Reguliere' },
      { id: '3', name: 'Cas', section: null },
      { id: '4', name: 'Dirk', section: 'Reguliere' },
    ]);
    expect(groepen.map((g) => [g.naam, g.drivers.map((d) => d.id)])).toEqual([
      ['Reguliere', ['1', '2']],
      ['Overige', ['3']],
      ['Reguliere', ['4']],
    ]);
  });
});

describe('bouwDagRijen', () => {
  const drivers = [
    { id: '1', name: 'Anna', section: 'Reguliere' },
    { id: '2', name: 'Bert', section: 'Reguliere' },
    { id: '3', name: 'Cas', section: 'Flexi' },
    { id: '4', name: 'Dirk', section: 'Flexi' },
  ];
  const cells: Cellen = {
    '1': { '2026-10-05': cel('4102') },
    '2': { '2026-10-05': cel('ziek', 'absence', { hiddenService: '410' }) },
    '3': { '2026-10-05': cel('bv', 'leave') },
  };

  it('zet wie rijdt of aandacht vraagt per sectie op dienstnummer, de rest in de rustgroep', () => {
    const { secties, rust } = bouwDagRijen(drivers, cells, '2026-10-05');
    expect(secties.map((s) => [s.naam, s.rijen.map((r) => r.drv.id)])).toEqual([['Reguliere', ['2', '1']]]);
    expect(rust.map((r) => [r.drv.id, r.cell?.code ?? null])).toEqual([['3', 'bv'], ['4', null]]);
  });

  it('is leeg zonder gekozen dag', () => {
    expect(bouwDagRijen(drivers, cells, null)).toEqual({ secties: [], rust: [] });
  });
});

describe('berekenCodeLegend', () => {
  it('kiest de eerste dienst als voorbeeld, ordent codes op soort en ziet een ruil', () => {
    const cells: Cellen = {
      '1': {
        '2026-10-05': cel('4102'),
        '2026-10-06': cel('xq', 'unknown', { label: 'xq' }),
        '2026-10-07': cel('tk', 'absence', { label: 'Tijdskrediet' }),
      },
      '2': {
        '2026-10-05': cel('BV', 'leave', { label: 'bv' }),
        '2026-10-06': cel('bv', 'leave', { label: 'Verlof' }),
        '2026-10-07': cel('4103', 'service', { swapId: 's1' }),
      },
    };
    const legend = berekenCodeLegend(cells);
    expect(legend.serviceExample).toBe('4102');
    expect(legend.heeftRuil).toBe(true);
    expect(legend.entries).toEqual([
      // BV: de eerste schrijfwijze wint, zonder eigen omschrijving = de categorie.
      { code: 'BV', kind: 'leave', meaning: 'Verlof' },
      { code: 'tk', kind: 'absence', meaning: 'Tijdskrediet' },
      { code: 'xq', kind: 'unknown', meaning: 'Onbekende code' },
    ]);
  });

  it('is leeg zonder cellen', () => {
    expect(berekenCodeLegend({})).toEqual({ serviceExample: null, entries: [], heeftRuil: false });
  });
});

describe('maandoverzicht', () => {
  const rij = (naam: string, diensten: number, minuten: number): OverzichtRij =>
    ({ driverId: naam.toLowerCase(), naam, diensten, minuten, anderWerk: 0, ziek: 0, betaald: 0, vrij: 0, overig: [], dagen: diensten });
  const rijen = [rij('Bert', 18, 8600), rij('Anna', 10, 4800), rij('Cas', 18, 7000)];

  it('urenLabel toont minuten als u:mm', () => {
    expect(urenLabel(4800)).toBe('80:00');
    expect(urenLabel(125)).toBe('2:05');
    expect(urenLabel(0)).toBe('0:00');
  });

  it('wisselOverzichtSortering: zelfde kolom keert om, cijferkolom begint aflopend, naam oplopend', () => {
    expect(wisselOverzichtSortering({ kolom: 'naam', richting: 1 }, 'diensten')).toEqual({ kolom: 'diensten', richting: -1 });
    expect(wisselOverzichtSortering({ kolom: 'diensten', richting: -1 }, 'diensten')).toEqual({ kolom: 'diensten', richting: 1 });
    expect(wisselOverzichtSortering({ kolom: 'diensten', richting: 1 }, 'naam')).toEqual({ kolom: 'naam', richting: 1 });
  });

  it('sorteerOverzichtRijen sorteert op de kolom en bij gelijkspel op naam, zonder de bron te raken', () => {
    expect(sorteerOverzichtRijen(rijen, { kolom: 'diensten', richting: -1 }).map((r) => r.naam)).toEqual(['Bert', 'Cas', 'Anna']);
    expect(sorteerOverzichtRijen(rijen, { kolom: 'naam', richting: 1 }).map((r) => r.naam)).toEqual(['Anna', 'Bert', 'Cas']);
    expect(sorteerOverzichtRijen(rijen, { kolom: 'minuten', richting: 1 }).map((r) => r.naam)).toEqual(['Anna', 'Cas', 'Bert']);
    expect(rijen.map((r) => r.naam)).toEqual(['Bert', 'Anna', 'Cas']);
  });
});
