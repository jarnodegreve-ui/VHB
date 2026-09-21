// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bouwZiekteDetails, bouwZiekteKalenderdagen, bouwZiektePerMaand, type ZiekteBron } from '../api/_lib/rapporten/ziekte';
import type { VerlofRij } from '../api/_lib/rapporten/gedeeld';
import { berekenTotalen } from '../shared/rapporten/opmaak';
import { rapportVan } from '../shared/rapporten/register';
import { bereikToestand } from '../shared/rapporten/periode';
import { berekenZiektePeriode } from '../shared/ziekteInzicht';
import { berekenZiekteInzicht } from './lib/ziekteInzicht';
import type { LeaveRequest } from './types';

/**
 * De drie ziekterapporten op vaste cijfers, en cijfer voor cijfer gelijk aan
 * het jaaroverzicht van het Ziekte-scherm (ZiekteInzicht rekent via
 * berekenZiekteInzicht). De dagen hieronder zijn met de hand nageteld op de
 * kalender van 2026; "vandaag" is overal 21/09/2026. Alles rekent op zone-loze
 * ISO-dagen, dus de uitkomst is dezelfde onder TZ=Europe/Brussels en TZ=UTC.
 */
const VANDAAG = '2026-09-21';
const JAAR = { van: '2026-01-01', tot: '2026-12-31', keuzes: {} };

const USERS = [
  { id: '10', name: 'Bert Buschauffeur', role: 'chauffeur', isActive: true, employeeId: 'VHB-010' },
  { id: '11', name: 'Carla Vertrokken', role: 'chauffeur', isActive: false, employeeId: 'VHB-011' },
  { id: '12', name: 'Dirk Deeltijds', role: 'chauffeur', isActive: true, employeeId: ' ' },
];

let nr = 0;
const ziek = (userId: string, startDate: string, endDate: string, rest: Partial<VerlofRij> = {}): VerlofRij =>
  ({ id: `z${++nr}`, userId, startDate, endDate, type: 'ziekte', status: 'approved', createdAt: `${startDate}T07:00:00Z`, ...rest });

const LEAVE: VerlofRij[] = [
  // Bert: 17/08 t/m 25/09 loopt nog. T/m vandaag: 15 dagen in augustus + 21 in september = 36.
  ziek('10', '2026-08-17', '2026-09-25', { id: 'bert-lang', comment: ' Rug ' }),
  // Carla (uit dienst): één dag, en 25/08 t/m 04/09 = 7 + 4 = 11 dagen. Samen 12, langste reeks 11.
  ziek('11', '2026-08-22', '2026-08-22', { id: 'carla-dag' }),
  ziek('11', '2026-08-25', '2026-09-04', { id: 'carla-lang' }),
  // Dirk: twee meldingen die aansluiten (verlenging) en één dag overlappen: 01/09-05/09 en 05/09-08/09
  // = 8 unieke dagen, één reeks van 8; de meldingen zelf tellen 5 en 4 dagen.
  ziek('12', '2026-09-01', '2026-09-05', { id: 'dirk-1' }),
  ziek('12', '2026-09-05', '2026-09-08', { id: 'dirk-2', comment: 'Verlenging' }),
  // Verwijderd account: over de jaargrens, in 2026 alleen 01/01 t/m 03/01 = 3 dagen.
  ziek('999', '2025-12-29', '2026-01-03', { id: 'weg' }),
  // Telt nergens mee: geannuleerd, nog niet begonnen, en gewoon verlof.
  ziek('10', '2026-03-02', '2026-03-06', { id: 'geannuleerd', status: 'cancelled' }),
  ziek('12', '2026-10-05', '2026-10-09', { id: 'toekomst' }),
  ziek('10', '2026-06-01', '2026-06-05', { id: 'verlof', type: 'betaald_verlof' }),
];

const bron: ZiekteBron = { users: USERS, leave: LEAVE, vandaag: VANDAAG };

describe('Ziekte in kalenderdagen (vaste cijfers)', () => {
  const def = rapportVan('ziekte-kalenderdagen')!;

  it('2026: één rij per chauffeur, meeste dagen eerst, t/m vandaag', () => {
    const { rijen, bereik } = bouwZiekteKalenderdagen(bron, JAAR);
    expect(rijen).toEqual([
      { id: '10', naam: 'Bert Buschauffeur', personeelsnr: 'VHB-010', meldingen: 1, kalenderdagen: 36, langstePeriode: 36, laatsteMelding: '2026-08-17' },
      { id: '11', naam: 'Carla Vertrokken (uit dienst)', personeelsnr: 'VHB-011', meldingen: 2, kalenderdagen: 12, langstePeriode: 11, laatsteMelding: '2026-08-25' },
      { id: '12', naam: 'Dirk Deeltijds', personeelsnr: null, meldingen: 2, kalenderdagen: 8, langstePeriode: 8, laatsteMelding: '2026-09-05' },
      { id: '999', naam: 'Onbekend (999)', personeelsnr: null, meldingen: 1, kalenderdagen: 3, langstePeriode: 3, laatsteMelding: '2025-12-29' },
    ]);
    expect(berekenTotalen(def, rijen)).toEqual({ meldingen: 6, kalenderdagen: 59 });
    // Bereik: de eerste ziektedag, en niet verder dan vandaag (de melding van oktober bestaat nog niet).
    expect(bereik).toEqual({ van: '2025-12-29', tot: VANDAAG });
  });

  it('een melding over de periodegrens telt alleen haar dagen binnen de periode', () => {
    // September: Bert 01-21 = 21, Carla 01-04 = 4, Dirk 8.
    const { rijen } = bouwZiekteKalenderdagen(bron, { van: '2026-09-01', tot: '2026-09-30', keuzes: {} });
    expect(rijen.map((r) => [r.id, r.meldingen, r.kalenderdagen, r.langstePeriode])).toEqual([['10', 1, 21, 21], ['12', 2, 8, 8], ['11', 1, 4, 4]]);
    // Eén week midden in Berts ziekte: 7 dagen, ook al duurt de melding 40 dagen.
    const week = bouwZiekteKalenderdagen(bron, { van: '2026-08-24', tot: '2026-08-30', keuzes: {} }).rijen;
    expect(week.find((r) => r.id === '10')).toMatchObject({ kalenderdagen: 7, langstePeriode: 7 });
    expect(week.find((r) => r.id === '11')).toMatchObject({ meldingen: 1, kalenderdagen: 6 });
  });

  it('een lopende melding telt tot vandaag, of tot het einde van de periode als dat vroeger valt', () => {
    // Periode loopt voorbij vandaag: Bert telt t/m 21/09, niet t/m 25/09.
    expect(bouwZiekteKalenderdagen(bron, { van: '2026-09-15', tot: '2026-09-30', keuzes: {} }).rijen[0]).toMatchObject({ id: '10', kalenderdagen: 7 });
    // Periode eindigt vóór vandaag: tot het einde van de periode.
    expect(bouwZiekteKalenderdagen(bron, { van: '2026-09-15', tot: '2026-09-18', keuzes: {} }).rijen[0]).toMatchObject({ id: '10', kalenderdagen: 4 });
    // Een dag later is er een dag bij.
    expect(bouwZiekteKalenderdagen({ ...bron, vandaag: '2026-09-22' }, JAAR).rijen[0]).toMatchObject({ id: '10', kalenderdagen: 37 });
  });

  it('chauffeurfilter, ook voor wie uit dienst is of verwijderd werd', () => {
    expect(bouwZiekteKalenderdagen(bron, { ...JAAR, chauffeur: '11' }).rijen.map((r) => r.naam)).toEqual(['Carla Vertrokken (uit dienst)']);
    expect(bouwZiekteKalenderdagen(bron, { ...JAAR, chauffeur: '999' }).rijen.map((r) => r.naam)).toEqual(['Onbekend (999)']);
    expect(bouwZiekteKalenderdagen(bron, { ...JAAR, chauffeur: '404' }).rijen).toEqual([]);
  });

  it('lege periode, toekomst en een periode vóór de eerste gegevens', () => {
    // Binnen het bereik, maar niemand ziek: geen rijen ("filters leveren niets op").
    const juni = { van: '2026-06-01', tot: '2026-06-30' };
    const leeg = bouwZiekteKalenderdagen(bron, { ...juni, keuzes: {} });
    expect(leeg.rijen).toEqual([]);
    expect(bereikToestand(juni, leeg.bereik)).toBe('binnen');
    // Volledig in de toekomst: geen rijen, en het bereik zegt "buiten" (de gegevens lopen tot vandaag).
    const oktober = { van: '2026-10-01', tot: '2026-10-31' };
    const later = bouwZiekteKalenderdagen(bron, { ...oktober, keuzes: {} });
    expect(later.rijen).toEqual([]);
    expect(bereikToestand(oktober, later.bereik)).toBe('buiten');
    // Vóór de eerste melding.
    const vroeger = { van: '2025-01-01', tot: '2025-06-30' };
    expect(bereikToestand(vroeger, bouwZiekteKalenderdagen(bron, { ...vroeger, keuzes: {} }).bereik)).toBe('buiten');
    // Nog nooit iemand ziek gemeld: geen bron.
    expect(bouwZiekteKalenderdagen({ ...bron, leave: LEAVE.filter((l) => l.type !== 'ziekte') }, JAAR)).toEqual({ rijen: [], bereik: null });
  });
});

describe('Details ziekte (vaste cijfers)', () => {
  it('één rij per melding, met de geregistreerde datums en de dagen binnen de periode', () => {
    const { rijen } = bouwZiekteDetails(bron, JAAR);
    expect(rijen).toEqual([
      { id: 'bert-lang', naam: 'Bert Buschauffeur', personeelsnr: 'VHB-010', van: '2026-08-17', tot: '2026-09-25', kalenderdagen: 36, opmerking: 'Rug' },
      { id: 'carla-dag', naam: 'Carla Vertrokken (uit dienst)', personeelsnr: 'VHB-011', van: '2026-08-22', tot: '2026-08-22', kalenderdagen: 1, opmerking: null },
      { id: 'carla-lang', naam: 'Carla Vertrokken (uit dienst)', personeelsnr: 'VHB-011', van: '2026-08-25', tot: '2026-09-04', kalenderdagen: 11, opmerking: null },
      { id: 'dirk-1', naam: 'Dirk Deeltijds', personeelsnr: null, van: '2026-09-01', tot: '2026-09-05', kalenderdagen: 5, opmerking: null },
      { id: 'dirk-2', naam: 'Dirk Deeltijds', personeelsnr: null, van: '2026-09-05', tot: '2026-09-08', kalenderdagen: 4, opmerking: 'Verlenging' },
      { id: 'weg', naam: 'Onbekend (999)', personeelsnr: null, van: '2025-12-29', tot: '2026-01-03', kalenderdagen: 3, opmerking: null },
    ]);
  });

  it('de standaardsortering is "van", nieuwste eerst', () => {
    expect(rapportVan('ziekte-details')!.sortering).toEqual({ kolom: 'van', richting: 'desc' });
  });

  it('periodegrens en chauffeurfilter', () => {
    const sept = bouwZiekteDetails(bron, { van: '2026-09-01', tot: '2026-09-30', keuzes: {}, chauffeur: '11' }).rijen;
    expect(sept).toEqual([expect.objectContaining({ id: 'carla-lang', van: '2026-08-25', tot: '2026-09-04', kalenderdagen: 4 })]);
  });
});

describe('Ziekte per maand (vaste cijfers)', () => {
  const def = rapportVan('ziekte-per-maand')!;

  it('2026: elke maand t/m vandaag, ook zonder ziekte; totalen zonder dubbeltelling', () => {
    const { rijen, totalen } = bouwZiektePerMaand(bron, JAAR);
    expect(rijen.map((r) => [r.maand, r.maandSleutel, r.meldingen, r.kalenderdagen, r.chauffeurs])).toEqual([
      ['Januari 2026', '2026-01', 1, 3, 1],
      ['Februari 2026', '2026-02', 0, 0, 0],
      ['Maart 2026', '2026-03', 0, 0, 0],
      ['April 2026', '2026-04', 0, 0, 0],
      ['Mei 2026', '2026-05', 0, 0, 0],
      ['Juni 2026', '2026-06', 0, 0, 0],
      ['Juli 2026', '2026-07', 0, 0, 0],
      // Augustus: Bert 15 + Carla 1 + 7. September: Bert 21 + Carla 4 + Dirk 8.
      ['Augustus 2026', '2026-08', 3, 23, 2],
      ['September 2026', '2026-09', 4, 33, 3],
    ]);
    // De kalenderdagen zijn een som; meldingen en chauffeurs niet (Bert en Carla tellen in twee maanden).
    expect(berekenTotalen(def, rijen)).toEqual({ kalenderdagen: 59 });
    expect(totalen).toEqual({ meldingen: 6, chauffeurs: 4 });
  });

  it('een periode over de jaargrens houdt de maanden uit elkaar, en een halve maand telt half', () => {
    const { rijen } = bouwZiektePerMaand(bron, { van: '2025-12-15', tot: '2026-01-02', keuzes: {} });
    expect(rijen.map((r) => [r.maand, r.kalenderdagen])).toEqual([['December 2025', 3], ['Januari 2026', 2]]);
  });

  it('sorteert op de maand zelf, niet op haar naam', () => {
    expect(def.kolommen[0]).toMatchObject({ id: 'maand', sorteerOp: 'maandSleutel' });
  });
});

describe('gelijk aan het Ziekte-scherm (berekenZiekteInzicht)', () => {
  // Het scherm krijgt LeaveRequest's uit GET /api/leave; dezelfde rijen, ander type.
  const meldingen = LEAVE as unknown as LeaveRequest[];

  for (const [jaar, vandaag] of [[2026, VANDAAG], [2025, VANDAAG], [2026, '2026-12-31'], [2027, VANDAAG]] as const) {
    it(`${jaar}, vandaag ${vandaag}: totalen, per chauffeur en per maand`, () => {
      const scherm = berekenZiekteInzicht(meldingen, jaar, vandaag);
      const b: ZiekteBron = { ...bron, vandaag };
      const filters = { van: `${jaar}-01-01`, tot: `${jaar}-12-31`, keuzes: {} };

      const perChauffeur = bouwZiekteKalenderdagen(b, filters).rijen;
      expect(perChauffeur.map((r) => ({ userId: r.id, kalenderdagen: r.kalenderdagen, meldingen: r.meldingen }))).toEqual(scherm.chauffeurs);
      const totalen = berekenTotalen(rapportVan('ziekte-kalenderdagen')!, perChauffeur);
      expect(totalen.kalenderdagen).toBe(scherm.totaalKalenderdagen);
      expect(totalen.meldingen).toBe(scherm.aantalMeldingen);

      const perMaand = bouwZiektePerMaand(b, filters);
      // Het scherm toont altijd twaalf maanden (een maand die nog moet beginnen als streepje); het rapport alleen wat begonnen is.
      const begonnen = scherm.maanden.filter((m) => `${jaar}-${String(m.maand).padStart(2, '0')}-01` <= vandaag);
      expect(perMaand.rijen.map((r) => ({ maand: Number(String(r.maandSleutel).slice(5, 7)), kalenderdagen: r.kalenderdagen, meldingen: r.meldingen }))).toEqual(begonnen);
      expect(perMaand.totalen).toEqual({ meldingen: scherm.aantalMeldingen, chauffeurs: scherm.chauffeurs.length });

      const details = bouwZiekteDetails(b, filters).rijen;
      expect(details).toHaveLength(scherm.aantalMeldingen);
    });
  }
});

describe('berekenZiektePeriode (de periode-vrije kern)', () => {
  it('ongeldige, omgekeerde of toekomstige periode: leeg', () => {
    const leeg = { totEnMet: null, totaalKalenderdagen: 0, aantalMeldingen: 0, maanden: [], chauffeurs: [], meldingen: [] };
    expect(berekenZiektePeriode(LEAVE, '2026-02-30', '2026-03-01', VANDAAG)).toEqual(leeg);
    expect(berekenZiektePeriode(LEAVE, '2026-09-02', '2026-09-01', VANDAAG)).toEqual(leeg);
    expect(berekenZiektePeriode(LEAVE, '2026-10-01', '2026-10-31', VANDAAG)).toEqual(leeg);
  });

  it('de overgang naar zomertijd kost geen dag', () => {
    // 29/03/2026 is in Brussel maar 23 uur lang.
    const uit = berekenZiektePeriode([ziek('10', '2026-03-28', '2026-03-30')], '2026-03-01', '2026-03-31', VANDAAG);
    expect(uit.totaalKalenderdagen).toBe(3);
    expect(uit.totEnMet).toBe('2026-03-31');
  });

  it('dezelfde melding twee keer aangeleverd telt één keer', () => {
    const dubbel = ziek('10', '2026-05-04', '2026-05-06', { id: 'dubbel' });
    expect(berekenZiektePeriode([dubbel, dubbel], '2026-05-01', '2026-05-31', VANDAAG)).toMatchObject({ aantalMeldingen: 1, totaalKalenderdagen: 3 });
  });
});
