// @vitest-environment node
/**
 * De planningsrapporten op vaste cijfers, en de gelijkheidstest: één maand in
 * "Overzicht per chauffeur" is cijfer voor cijfer het Maandoverzicht van de
 * maandplanning (GET /api/month-planning?format=summary), en meerdere maanden
 * zijn de som van hun maandoverzichten.
 */
import { describe, expect, it } from 'vitest';
import { berekenMaandoverzicht, telMaandoverzichtenOp } from '../api/helpers';
import { berekenCelWaarheid } from '../api/_lib/celWaarheid';
import { bouwDienstenPerDag, bouwOpenstaandeDiensten, bouwOverzichtPerChauffeur, maandoverzichtVan, type DienstenBron, type OverzichtBron } from '../api/_lib/rapporten/planning';
import { rapportVan } from '../shared/rapporten/register';
import { berekenTotalen, totalenVoor } from '../shared/rapporten/opmaak';
import { bereikToestand } from '../shared/rapporten/periode';
import type { DayGap } from '../shared/coverageGaps';
import type { RapportFilters } from '../shared/rapporten/types';
import { telDienstdagen, telDiensten } from './lib/dienstTelling';

const filters = (van: string, tot: string, extra: Partial<RapportFilters> = {}): RapportFilters => ({ van, tot, keuzes: {}, ...extra });

// === Overzicht per chauffeur ===

const users = [
  { id: '1', name: 'Jan Janssen', role: 'chauffeur', isActive: true, section: 'Reguliere', startDate: '2010-01-01' },
  { id: '2', name: 'An Peeters', role: 'chauffeur', isActive: true, section: 'Nacht', startDate: '2012-01-01' },
  { id: '3', name: 'Piet Nieuw', role: 'chauffeur', isActive: true, section: 'Reguliere', startDate: '2020-01-01' },
  { id: '4', name: 'Els Planner', role: 'planner', isActive: true },
  { id: '5', name: 'Oud Weg', role: 'chauffeur', isActive: false },
];
const services = [
  // Gesplitste dienst: 6:45 + 1:59 = 8:44.
  { serviceNumber: '2102', startTime: '05:28', endTime: '12:13', startTime2: '15:28', endTime2: '17:27' },
  // Nachtdienst over middernacht: 22:00 tot 02:30 = 4:30.
  { serviceNumber: '2703', startTime: '22:00', endTime: '02:30' },
  // Dienst zonder tijden: telt als dienst, niet in de uren.
  { serviceNumber: '2999' },
];
const codes = [
  { code: 'bv', category: 'leave', description: 'Betaald verlof', isPaidAbsence: true },
  { code: 'vrij', category: 'absence', description: 'Vrij', isDayOff: true },
  { code: 'ziek', category: 'absence', description: 'Ziek' },
  { code: 'eek', category: 'service', description: 'EEK', countsAsShift: true },
];
const rows = [
  { source_date: '2026-09-29', assignments: { 'Jan Janssen': '2102', 'An Peeters': 'vrij', 'Piet Nieuw': 'eek' } },
  { source_date: '2026-09-30', assignments: { 'Jan Janssen': '2102', 'An Peeters': 'vrij', 'Piet Nieuw': 'bv' } },
  { source_date: '2026-10-01', assignments: { 'Jan Janssen': 'vrij', 'An Peeters': '2703', 'Piet Nieuw': '2999' } },
  { source_date: '2026-10-02', assignments: { 'Jan Janssen': 'vrij', 'An Peeters': '2703', 'Piet Nieuw': 'xx' } },
];
const leave = [
  // Ziekte over de maandgrens: 30/09 (dienst 2102 overdekt) en 01/10 (een vrije dag wordt "ziek").
  { userId: '1', startDate: '2026-09-30', endDate: '2026-10-01', status: 'approved', type: 'ziekte' },
];
const swaps = [
  // Ruil over de maandgrens: Jan geeft 2102 van 29/09 aan An, en krijgt haar 2703 van 02/10.
  { id: 'r1', requesterId: '1', targetDriverId: '2', status: 'approved', decidedAt: '2026-09-20T10:00:00Z', shiftDate: '2026-09-29', shiftLine: '2102', returnDate: '2026-10-02', returnCode: '2703', swapType: 'ruil', reason: '' },
];
const bron = { rows, users, services, codes, leave, swaps, grenzen: { eerste: '2026-09-29', laatste: '2026-10-02' } } as unknown as OverzichtBron;

/** Wat GET /api/month-planning?format=summary voor deze maand antwoordt (zelfde twee aanroepen als de route). */
const maandoverzichtVanDeRoute = (maand: string) => {
  const { dates, chauffeurs, cells } = berekenCelWaarheid(maand, bron);
  return berekenMaandoverzicht(dates, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, services, codes);
};
const CIJFERS = ['diensten', 'minuten', 'anderWerk', 'ziek', 'betaald', 'vrij', 'dagen'] as const;

describe('Overzicht per chauffeur is het Maandoverzicht van de maandplanning', () => {
  const def = rapportVan('overzicht-per-chauffeur')!;

  for (const [maand, van, tot] of [['2026-09', '2026-09-01', '2026-09-30'], ['2026-10', '2026-10-01', '2026-10-31']] as const) {
    it(`één maand (${maand}): elke chauffeur en elk cijfer gelijk, in de bordvolgorde, en de totaalrij gelijk aan het totaal`, () => {
      const overzicht = maandoverzichtVanDeRoute(maand);
      const rapport = bouwOverzichtPerChauffeur(bron, filters(van, tot));
      expect(rapport.rijen.map((r) => r.naam)).toEqual(overzicht.rijen.map((r) => r.naam));
      for (const r of overzicht.rijen) {
        const rij = rapport.rijen.find((x) => x.id === r.driverId)!;
        for (const cijfer of CIJFERS) expect(rij[cijfer], `${r.naam}: ${cijfer}`).toBe(r[cijfer]);
        expect(rij.overig, `${r.naam}: overig`).toBe(r.overig.reduce((n, o) => n + o.keren, 0));
      }
      const totalen = totalenVoor(def, rapport.rijen);
      for (const cijfer of [...CIJFERS, 'overig'] as const) expect(totalen[cijfer], cijfer).toBe(overzicht.totaal[cijfer]);
      // `maandoverzichtVan` is geen tweede telling maar dezelfde twee aanroepen.
      expect(maandoverzichtVan(maand, bron)).toEqual(overzicht);
    });
  }

  it('de vaste cijfers van september: ruil doorgevoerd, ziekte overdekt de dienst, gesplitste dienst telt één dag', () => {
    const rapport = bouwOverzichtPerChauffeur(bron, filters('2026-09-01', '2026-09-30'));
    const perNaam = Object.fromEntries(rapport.rijen.map((r) => [r.naam, r]));
    // Jan: 29/09 weggeruild (vrij), 30/09 ziek → geen dienst meer.
    expect(perNaam['Jan Janssen']).toMatchObject({ sectie: 'Reguliere', diensten: 0, minuten: 0, ziek: 1, vrij: 1, dagen: 2 });
    // An: was vrij op 29/09 en rijdt door de ruil de 2102 van Jan (8:44), 30/09 vrij.
    expect(perNaam['An Peeters']).toMatchObject({ diensten: 1, minuten: 524, vrij: 1, dagen: 2 });
    expect(perNaam['Piet Nieuw']).toMatchObject({ diensten: 0, anderWerk: 1, betaald: 1, dagen: 2 });
    expect(rapport.rijen.some((r) => r.naam === 'Oud Weg' || r.naam === 'Els Planner')).toBe(false);
  });

  it('twee maanden zijn de som van de twee maandoverzichten, ook voor de ruil en de ziekte over de maandgrens', () => {
    const september = maandoverzichtVanDeRoute('2026-09');
    const oktober = maandoverzichtVanDeRoute('2026-10');
    const rapport = bouwOverzichtPerChauffeur(bron, filters('2026-09-01', '2026-10-31'));
    for (const rij of rapport.rijen) {
      const s = september.rijen.find((r) => r.driverId === rij.id)!;
      const o = oktober.rijen.find((r) => r.driverId === rij.id)!;
      for (const cijfer of CIJFERS) expect(rij[cijfer], `${rij.naam}: ${cijfer}`).toBe(s[cijfer] + o[cijfer]);
    }
    const perNaam = Object.fromEntries(rapport.rijen.map((r) => [r.naam, r]));
    // Jan: in oktober 01/10 ziek, 02/10 de 2703 van An (4:30).
    expect(perNaam['Jan Janssen']).toMatchObject({ diensten: 1, minuten: 270, ziek: 2, vrij: 1, dagen: 4 });
    // Piet: 2999 zonder tijden telt als dienst maar niet in de uren; "xx" is overig.
    expect(perNaam['Piet Nieuw']).toMatchObject({ diensten: 1, minuten: 0, anderWerk: 1, betaald: 1, overig: 1, dagen: 4 });
    expect(berekenTotalen(def, rapport.rijen)).toMatchObject({ diensten: 4, minuten: 524 + 270 + 270, ziek: 2, dagen: 12 });
  });

  it('optellen: overig per code, en één maand blijft die maand', () => {
    const september = maandoverzichtVanDeRoute('2026-09');
    expect(telMaandoverzichtenOp([september])).toEqual(september);
    const dubbel = telMaandoverzichtenOp([maandoverzichtVanDeRoute('2026-10'), maandoverzichtVanDeRoute('2026-10')]);
    expect(dubbel.rijen.find((r) => r.naam === 'Piet Nieuw')!.overig).toEqual([{ code: 'xx', keren: 2 }]);
    expect(dubbel.totaal.overig).toBe(2);
    expect(telMaandoverzichtenOp([])).toEqual({ rijen: [], totaal: { diensten: 0, minuten: 0, anderWerk: 0, ziek: 0, betaald: 0, vrij: 0, overig: 0, dagen: 0 } });
  });

  it('chauffeurfilter, een maand zonder planning, en het bereik van de import', () => {
    expect(bouwOverzichtPerChauffeur(bron, filters('2026-09-01', '2026-09-30', { chauffeur: '2' })).rijen.map((r) => r.naam)).toEqual(['An Peeters']);
    const voor = bouwOverzichtPerChauffeur(bron, filters('2026-06-01', '2026-06-30'));
    expect(voor.bereik).toEqual({ van: '2026-09-29', tot: '2026-10-02' });
    expect(bereikToestand({ van: '2026-06-01', tot: '2026-06-30' }, voor.bereik)).toBe('buiten');
    expect(bouwOverzichtPerChauffeur({ ...bron, rows: [], grenzen: { eerste: null, laatste: null } }, filters('2026-09-01', '2026-09-30')).bereik).toBeNull();
  });
});

// === Diensten per dag en Inzet per voertuig ===

const planning = [
  // Gesplitste dienst 2109 van Jan op 21/09: twee delen, bewust in omgekeerde volgorde aangeleverd.
  { id: 'p2', date: '2026-09-21', startTime: '13:10', endTime: '19:15', line: '2109', busNumber: '', loopnr: '4602', driverId: '1' },
  { id: 'p1', date: '2026-09-21', startTime: '06:53', endTime: '08:23', line: '2109', busNumber: '013 023', loopnr: '4601', driverId: '1' },
  { id: 'p3', date: '2026-09-21', startTime: '05:28', endTime: '12:13', line: '2102', busNumber: '23', loopnr: '4600', driverId: '2' },
  // Nachtdienst over middernacht.
  { id: 'p4', date: '2026-09-22', startTime: '22:00', endTime: '02:30', line: '2703', busNumber: '', loopnr: '', driverId: '2' },
  { id: 'p5', date: '2026-10-01', startTime: '06:00', endTime: '14:00', line: '2101', busNumber: '613 026', loopnr: '', driverId: '9' },
];
const voertuigen = [{ id: 'v23', busnr: '013 023', kortNr: 23 }, { id: 'v26', busnr: '613 026', kortNr: 26 }];
const dienstenBron: DienstenBron = { planning, users, voertuigen };
const WEEK = ['2026-09-21', '2026-09-27'] as const;

describe('Diensten per dag', () => {
  it('één rij per dienst-deel, gesorteerd op datum, dienst en deel; de duur is die van het deel', () => {
    const uit = bouwDienstenPerDag(dienstenBron, filters(...WEEK));
    expect(uit.rijen.map((r) => [r.datum, r.dag, r.dienst, r.deel, r.start, r.einde, r.duur, r.loop, r.bus, r.chauffeur])).toEqual([
      ['2026-09-21', 'ma', '2102', 1, '05:28', '12:13', 405, '4600', '23', 'An Peeters'],
      ['2026-09-21', 'ma', '2109', 1, '06:53', '08:23', 90, '4601', '013 023', 'Jan Janssen'],
      ['2026-09-21', 'ma', '2109', 2, '13:10', '19:15', 365, '4602', null, 'Jan Janssen'],
      ['2026-09-22', 'di', '2703', 1, '22:00', '02:30', 270, null, null, 'An Peeters'],
    ]);
  });

  it('een gesplitste dienst is één dag met dienst en één dienst, maar twee delen (de telling van Jarno, 14-09)', () => {
    const vanJan = planning.filter((p) => p.driverId === '1');
    const rijen = bouwDienstenPerDag(dienstenBron, filters(...WEEK, { chauffeur: '1' })).rijen;
    expect(rijen).toHaveLength(2);
    expect(telDienstdagen(vanJan)).toBe(1);
    expect(telDiensten(vanJan)).toBe(1);
  });

  it('chauffeurfilter houdt het deelnummer: deel 2 blijft deel 2', () => {
    expect(bouwDienstenPerDag(dienstenBron, filters(...WEEK, { chauffeur: '1' })).rijen.map((r) => r.deel)).toEqual([1, 2]);
  });

  it('voertuigfilter: op busnummer of kort nummer, zonder spaties; een onbekend voertuig geeft niets', () => {
    expect(bouwDienstenPerDag(dienstenBron, filters(...WEEK, { voertuig: 'v23' })).rijen.map((r) => r.id)).toEqual(['p3', 'p1']);
    expect(bouwDienstenPerDag(dienstenBron, filters(...WEEK, { voertuig: 'v26' })).rijen).toEqual([]);
    expect(bouwDienstenPerDag(dienstenBron, filters(...WEEK, { voertuig: 'bestaat-niet' })).rijen).toEqual([]);
  });

  it('een verwijderde chauffeur blijft staan als "Onbekend (<id>)"', () => {
    expect(bouwDienstenPerDag(dienstenBron, filters('2026-10-01', '2026-10-01')).rijen[0].chauffeur).toBe('Onbekend (9)');
  });

  it('lege periode, periode vóór de eerste gegevens en een lege planning', () => {
    const leeg = bouwDienstenPerDag(dienstenBron, filters('2026-09-23', '2026-09-27'));
    expect(leeg.rijen).toEqual([]);
    expect(leeg.bereik).toEqual({ van: '2026-09-21', tot: '2026-10-01' });
    const voor = bouwDienstenPerDag(dienstenBron, filters('2026-06-01', '2026-06-30'));
    expect(bereikToestand({ van: '2026-06-01', tot: '2026-06-30' }, voor.bereik)).toBe('buiten');
    expect(bouwDienstenPerDag({ ...dienstenBron, planning: [] }, filters(...WEEK)).bereik).toBeNull();
  });
});

describe('Inzet per voertuig: dezelfde lader, alleen de delen met een bus', () => {
  const def = rapportVan('inzet-per-voertuig')!;

  it('delen zonder bus vallen weg, de totaalrij telt de duur op', () => {
    const uit = bouwDienstenPerDag(dienstenBron, filters('2026-09-01', '2026-10-31'), { alleenMetBus: true });
    expect(uit.rijen.map((r) => [r.datum, r.bus, r.dienst, r.deel, r.duur])).toEqual([
      ['2026-09-21', '23', '2102', 1, 405],
      // Deel 1 van de gesplitste dienst had een bus, deel 2 niet.
      ['2026-09-21', '013 023', '2109', 1, 90],
      ['2026-10-01', '613 026', '2101', 1, 480],
    ]);
    expect(totalenVoor(def, uit.rijen)).toEqual({ duur: 975 });
    expect(uit.bereik).toEqual({ van: '2026-09-21', tot: '2026-10-01' });
  });

  it('zoals productie vandaag: nergens een bus ingevuld, dus een lege bron in plaats van een lege tabel', () => {
    const zonderBus = { ...dienstenBron, planning: planning.map((p) => ({ ...p, busNumber: '' })) };
    const uit = bouwDienstenPerDag(zonderBus, filters(...WEEK), { alleenMetBus: true });
    expect(uit).toEqual({ rijen: [], bereik: null });
    // Diensten per dag toont dezelfde planning wél, met een streepje in de kolom Bus.
    expect(bouwDienstenPerDag(zonderBus, filters(...WEEK)).rijen).toHaveLength(4);
  });
});

// === Openstaande diensten ===

const gaten: DayGap[] = [
  { date: '2026-09-20', dayType: 'zondag', expected: 2, covered: 1, missing: ['2701'] },
  {
    date: '2026-09-21', dayType: 'schooldag', expected: 4, covered: 2, missing: ['2115', '2101'],
    uitval: { 2101: { name: 'Jan Janssen', reason: 'ziek' } },
    opgevangen: { 2109: { name: 'Piet Nieuw', reason: 'verlof', door: 'An Peeters' } },
  },
  { date: '2026-09-22', dayType: 'schooldag', expected: 4, covered: 4, missing: [] },
];
const grenzen = { eerste: '2026-07-01', laatste: '2026-11-08' };

describe('Openstaande diensten', () => {
  it('één rij per open dienst met de reden, en wat intussen overgenomen is staat erbij als ingevuld', () => {
    const uit = bouwOpenstaandeDiensten({ gaten, grenzen }, filters('2026-09-21', '2026-10-18'), '2026-09-21');
    expect(uit.rijen.map((r) => [r.datum, r.dag, r.dagtype, r.dienst, r.reden, r.ingevuldDoor, r.status])).toEqual([
      ['2026-09-21', 'ma', 'schooldag', '2101', 'Ziek: Jan Janssen', null, 'Open'],
      ['2026-09-21', 'ma', 'schooldag', '2115', 'Niet toegewezen', null, 'Open'],
      ['2026-09-21', 'ma', 'schooldag', '2109', 'Verlof: Piet Nieuw', 'An Peeters', 'Ingevuld'],
    ]);
    expect(uit.peildatum).toBe('2026-09-21');
  });

  it('voorbije dagen zijn geen gat meer: ze vallen weg en het bereik begint vandaag', () => {
    const uit = bouwOpenstaandeDiensten({ gaten, grenzen }, filters('2026-09-01', '2026-09-30'), '2026-09-21');
    expect(uit.rijen.some((r) => r.datum === '2026-09-20')).toBe(false);
    expect(uit.bereik).toEqual({ van: '2026-09-21', tot: '2026-11-08' });
    // Een periode die helemaal voorbij is valt buiten het bereik: het scherm zegt dan vanaf wanneer.
    expect(bereikToestand({ van: '2026-08-01', tot: '2026-08-31' }, uit.bereik)).toBe('buiten');
  });

  it('planning die al afgelopen is, en geen planning', () => {
    expect(bouwOpenstaandeDiensten({ gaten: [], grenzen }, filters('2026-12-01', '2026-12-31'), '2026-12-01').bereik).toEqual({ van: '2026-11-08', tot: '2026-11-08' });
    expect(bouwOpenstaandeDiensten({ gaten: [], grenzen: { eerste: null, laatste: null } }, filters('2026-09-21', '2026-10-18'), '2026-09-21')).toEqual({ rijen: [], peildatum: '2026-09-21', bereik: null });
  });
});
