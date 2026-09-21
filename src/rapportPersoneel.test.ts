// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bouwActieveMedewerkers, bouwContactlijst, bouwPersoneelVerval, type RapportMedewerker, type RapportPersoneelVerval } from '../api/_lib/rapporten/personeel';
import { RAPPORT_MEDEWERKER_KOLOMMEN, naarRapportMedewerker } from '../api/_lib/rapporten/personeelBron';
import { berekenTotalen } from '../shared/rapporten/opmaak';
import { rapportVan } from '../shared/rapporten/register';
import type { RapportFilters } from '../shared/rapporten/types';

/**
 * De rapporten van het domein Personeel op vaste cijfers, met een vaste
 * peildatum (21/09/2026) en zone-loze ISO-dagen; dezelfde verwachtingen
 * gelden onder TZ=UTC en TZ=Europe/Brussels.
 */
const VANDAAG = '2026-09-21';
const filters = (keuzes: Record<string, string> = {}, rest: Partial<RapportFilters> = {}): RapportFilters => ({ keuzes, ...rest });

const mens = (id: string, name: string, role: string, rest: Partial<RapportMedewerker> = {}): RapportMedewerker =>
  ({ id, name, role, employeeId: `VHB-${id}`, isActive: true, showInContacts: true, ...rest });

const USERS: RapportMedewerker[] = [
  mens('1', 'Annelies Admin', 'admin', { phone: '0470 00 00 01', email: 'annelies@vhb.be', startDate: '2016-09-21' }), // 10,0 jaar
  mens('2', 'Pieter Planner', 'planner', { email: 'pieter@vhb.be', showInContacts: false }),
  mens('10', 'Bert Buschauffeur', 'chauffeur', { section: 'Reguliere', phone: '0470 00 00 10', email: 'bert@vhb.be', startDate: '2019-01-23' }), // 7,7
  mens('11', 'Tom Technieker', 'technieker', { phone: ' ', startDate: '2026-07-09' }), // 0,2
  mens('12', 'Carla Vertrokken', 'chauffeur', { section: 'Nacht', isActive: false, startDate: '2010-01-01' }),
  mens('13', 'Beheerder', 'admin'),
  mens('14', 'Dirk Nacht', 'chauffeur', { section: 'Nacht', startDate: '2024-02-29' }), // 2,6 (schrikkeldag)
  mens('15', 'Els Zonderdatum', 'chauffeur', { section: 'Flexi', employeeId: null }),
];

describe('Contactlijst', () => {
  it('alle actieve medewerkers, ook wie niet in de gedeelde contactlijst staat (met markering)', () => {
    const { rijen, bereik, peildatum } = bouwContactlijst(USERS, filters(), VANDAAG);
    expect(rijen.map((r) => [r.naam, r.rol, r.sectie, r.telefoon, r.gedeeld])).toEqual([
      ['Annelies Admin', 'Beheer', null, '0470 00 00 01', true],
      ['Pieter Planner', 'Planning', null, null, false],
      ['Bert Buschauffeur', 'Chauffeur', 'Reguliere', '0470 00 00 10', true],
      ['Tom Technieker', 'Technieker', null, null, true],
      ['Dirk Nacht', 'Chauffeur', 'Nacht', null, true],
      ['Els Zonderdatum', 'Chauffeur', 'Flexi', null, true],
    ]);
    expect(rijen[2]).toEqual({ id: '10', naam: 'Bert Buschauffeur', rol: 'Chauffeur', sectie: 'Reguliere', telefoon: '0470 00 00 10', email: 'bert@vhb.be', gedeeld: true });
    expect(bereik).not.toBeNull();
    expect(peildatum).toBeUndefined();
  });

  it('rol en sectie, met "Zonder sectie" voor staf en techniekers', () => {
    const namen = (f: RapportFilters) => bouwContactlijst(USERS, f, VANDAAG).rijen.map((r) => r.naam);
    expect(namen(filters({ rol: 'chauffeur' }))).toEqual(['Bert Buschauffeur', 'Dirk Nacht', 'Els Zonderdatum']);
    expect(namen(filters({ sectie: 'Nacht' }))).toEqual(['Dirk Nacht']);
    expect(namen(filters({ sectie: 'geen' }))).toEqual(['Annelies Admin', 'Pieter Planner', 'Tom Technieker']);
    expect(namen(filters({ rol: 'technieker', sectie: 'Nacht' }))).toEqual([]);
  });

  it('zonder één actieve medewerker: een lege bron', () => {
    expect(bouwContactlijst([USERS[4], USERS[5]], filters(), VANDAAG)).toEqual({ rijen: [], bereik: null });
  });
});

describe('Volledige lijst actieven', () => {
  const def = rapportVan('actieve-medewerkers')!;

  it('anciënniteit op de peildatum; zonder datum in dienst geen anciënniteit', () => {
    const { rijen, peildatum } = bouwActieveMedewerkers(USERS, filters(), VANDAAG);
    expect(peildatum).toBe(VANDAAG);
    expect(rijen.map((r) => [r.naam, r.personeelsnr, r.inDienst, r.ancienniteit])).toEqual([
      ['Annelies Admin', 'VHB-1', '2016-09-21', 10],
      ['Pieter Planner', 'VHB-2', null, null],
      ['Bert Buschauffeur', 'VHB-10', '2019-01-23', 7.7],
      ['Tom Technieker', 'VHB-11', '2026-07-09', 0.2],
      ['Dirk Nacht', 'VHB-14', '2024-02-29', 2.6],
      ['Els Zonderdatum', null, null, null],
    ]);
  });

  it('totaalrij: het aantal staat in de eerste kolom, de anciënniteit is een gemiddelde', () => {
    const { rijen } = bouwActieveMedewerkers(USERS, filters(), VANDAAG);
    expect(rijen).toHaveLength(6);
    expect(berekenTotalen(def, rijen).ancienniteit).toBeCloseTo((10 + 7.7 + 0.2 + 2.6) / 4, 10);
    // Niemand met een datum: geen verzonnen nul in de totaalrij.
    expect(berekenTotalen(def, bouwActieveMedewerkers(USERS, filters({ sectie: 'Flexi' }), VANDAAG).rijen)).toEqual({});
  });

  it('wie uit dienst is of het systeemaccount staat er niet in', () => {
    const namen = bouwActieveMedewerkers(USERS, filters(), VANDAAG).rijen.map((r) => r.naam);
    expect(namen).not.toContain('Carla Vertrokken');
    expect(namen).not.toContain('Beheerder');
  });
});

describe('de bron leest nooit wachtwoord- of auth-velden', () => {
  it('expliciete kolomlijst, zonder password, authid, sessie- of voorkeurvelden', () => {
    const kolommen = RAPPORT_MEDEWERKER_KOLOMMEN.split(',').map((k) => k.trim());
    expect(kolommen).toEqual(['id', 'name', 'role', 'phone', 'email', 'employeeid', 'section', 'startdate', 'isactive', 'showincontacts']);
    for (const verboden of ['*', 'password', 'authid', 'lastlogin', 'activesessions', 'dashboardvoorkeuren']) expect(kolommen).not.toContain(verboden);
  });

  it('en wat er toch meekomt in een rij wordt niet doorgegeven', () => {
    const uit = naarRapportMedewerker({ id: 7, name: 'Jan', role: 'chauffeur', password: 'geheim', authid: 'abc', employeeid: 'VHB-7', isactive: null, showincontacts: false });
    expect(uit).toEqual({ id: '7', name: 'Jan', role: 'chauffeur', phone: null, email: null, employeeId: 'VHB-7', section: null, startDate: null, isActive: true, showInContacts: false });
  });
});

describe('Medische schiftingen en vakbekwaamheden (één lader, vaste soort)', () => {
  const VERVAL: RapportPersoneelVerval[] = [
    { userId: '10', soort: 'medische_schifting', validUntil: '2026-09-20', updatedAt: '2026-01-05T09:00:00+00:00' }, // gisteren
    { userId: '14', soort: 'medische_schifting', validUntil: '2026-12-20', updatedAt: '2025-12-31T23:30:00+00:00' }, // 90 dagen; bijgewerkt op 01/01 in België
    { userId: '12', soort: 'medische_schifting', validUntil: '2027-01-01' }, // uit dienst
    { userId: '10', soort: 'code95', validUntil: '2031-09-02' },
    { userId: '11', soort: 'medische_schifting', validUntil: '2026-10-01' }, // technieker: niet in de kring
  ];
  const bron = { users: USERS, vervaldata: VERVAL };

  it('elke actieve chauffeur, ook wie geen datum heeft (lege datum, status "Geen datum")', () => {
    const { rijen, bereik, peildatum } = bouwPersoneelVerval(bron, 'medische_schifting', filters(), VANDAAG);
    expect(rijen).toEqual([
      { id: '10', naam: 'Bert Buschauffeur', personeelsnr: 'VHB-10', geldigTot: '2026-09-20', resterend: -1, status: 'Vervallen', bijgewerktOp: '2026-01-05' },
      { id: '14', naam: 'Dirk Nacht', personeelsnr: 'VHB-14', geldigTot: '2026-12-20', resterend: 90, status: 'Binnenkort', bijgewerktOp: '2026-01-01' },
      { id: '15', naam: 'Els Zonderdatum', personeelsnr: null, geldigTot: null, resterend: null, status: 'Geen datum', bijgewerktOp: null },
    ]);
    expect(bereik).toEqual({ van: '2026-09-20', tot: '2027-01-01' });
    expect(peildatum).toBe(VANDAAG);
  });

  it('dezelfde lader met de andere soort', () => {
    const { rijen } = bouwPersoneelVerval(bron, 'code95', filters(), VANDAAG);
    expect(rijen.map((r) => [r.naam, r.geldigTot, r.status])).toEqual([
      ['Bert Buschauffeur', '2031-09-02', 'In orde'],
      ['Dirk Nacht', null, 'Geen datum'],
      ['Els Zonderdatum', null, 'Geen datum'],
    ]);
  });

  it('termijn: wie geen datum heeft blijft staan, wie later vervalt valt weg', () => {
    const namen = (termijn: string) => bouwPersoneelVerval(bron, 'medische_schifting', filters({ termijn }), VANDAAG).rijen.map((r) => r.naam);
    expect(namen('30')).toEqual(['Bert Buschauffeur', 'Els Zonderdatum']);
    expect(namen('60')).toEqual(['Bert Buschauffeur', 'Els Zonderdatum']);
    expect(namen('90')).toEqual(['Bert Buschauffeur', 'Dirk Nacht', 'Els Zonderdatum']);
  });

  it('één chauffeur: ook wie uit dienst is, en een verwijderd account blijft "Onbekend (<id>)"', () => {
    expect(bouwPersoneelVerval(bron, 'medische_schifting', filters({}, { chauffeur: '12' }), VANDAAG).rijen)
      .toEqual([{ id: '12', naam: 'Carla Vertrokken (uit dienst)', personeelsnr: 'VHB-12', geldigTot: '2027-01-01', resterend: 102, status: 'In orde', bijgewerktOp: null }]);
    expect(bouwPersoneelVerval(bron, 'medische_schifting', filters({}, { chauffeur: '999' }), VANDAAG).rijen.map((r) => [r.naam, r.status]))
      .toEqual([['Onbekend (999)', 'Geen datum']]);
  });

  it('nog geen enkele datum van deze soort: een lege bron', () => {
    expect(bouwPersoneelVerval({ users: USERS, vervaldata: [] }, 'code95', filters(), VANDAAG).bereik).toBeNull();
  });

  it('de standaardsortering zet het dringendste eerst en wie geen datum heeft onderaan', async () => {
    const { sorteerRijen } = await import('../shared/rapporten/opmaak');
    const def = rapportVan('medische-schiftingen')!;
    const { rijen } = bouwPersoneelVerval(bron, 'medische_schifting', filters(), VANDAAG);
    const gesorteerd = sorteerRijen(def, [rijen[2], rijen[1], rijen[0]], def.sortering.kolom, def.sortering.richting);
    expect(gesorteerd.map((r) => r.resterend)).toEqual([-1, 90, null]);
  });
});
