// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { bouwVerlofsaldo, type VerlofsaldoBron } from '../api/_lib/rapporten/verlofsaldo';
import { berekenTotalen } from '../shared/rapporten/opmaak';
import { rapportVan } from '../shared/rapporten/register';
import { stelExtraFeestdagenIn } from './lib/leaveBalance';
import { verlofSaldoRijen } from './lib/verlofSaldoRijen';
import type { LeaveRequest, User } from './types';

/**
 * Rapport Verlofsaldo op vaste cijfers, en cijfer voor cijfer gelijk aan het
 * saldo-overzicht in Verlof (VerlofSaldoModal rekent via verlofSaldoRijen).
 * De dagen hieronder zijn met de hand nageteld op de kalender van 2026:
 * zondagen, wettelijke feestdagen en de extra vrije dag tellen niet mee.
 */
const def = rapportVan('verlofsaldo')!;

const gebruiker = (id: string, name: string, role: User['role'], rest: Partial<User> = {}): User =>
  ({ id, name, role, employeeId: `VHB-${id}`, isActive: true, ...rest });

const USERS: User[] = [
  gebruiker('1', 'Annelies Admin', 'admin'),
  gebruiker('2', 'Pieter Planner', 'planner'),
  gebruiker('10', 'Bert Buschauffeur', 'chauffeur', { section: 'Reguliere diensten' }),
  gebruiker('11', 'Tom Technieker', 'technieker', { verlofBudget: 20, section: ' Garage ' }),
  gebruiker('12', 'Carla Vertrokken', 'chauffeur', { isActive: false }),
  gebruiker('13', 'Beheerder', 'chauffeur'),
  gebruiker('14', 'Dirk Deeltijds', 'chauffeur', { verlofBudget: 10 }),
];

let nr = 0;
const verlof = (userId: string, startDate: string, endDate: string, type: LeaveRequest['type'], status: LeaveRequest['status']): LeaveRequest =>
  ({ id: `l${++nr}`, userId, startDate, endDate, type, status, createdAt: '2026-01-01T08:00:00Z' });

const LEAVE: LeaveRequest[] = [
  // Bert: 5 (ma-vr) + 5 (21-27/12: Kerstmis en de zondag vallen weg, zaterdag telt) + 2 (2 en 3 januari; nieuwjaar valt weg)
  verlof('10', '2026-08-10', '2026-08-14', 'betaald_verlof', 'approved'),
  verlof('10', '2026-12-21', '2026-12-27', 'betaald_verlof', 'approved'),
  verlof('10', '2025-12-29', '2026-01-03', 'betaald_verlof', 'approved'),
  verlof('10', '2026-10-05', '2026-10-06', 'betaald_verlof', 'pending'),
  verlof('10', '2026-03-02', '2026-03-02', 'klein_verlet', 'approved'),
  verlof('10', '2026-02-02', '2026-02-06', 'betaald_verlof', 'rejected'),
  verlof('10', '2025-06-01', '2025-06-10', 'ziekte', 'approved'),
  // Tom: ma 11 t/m za 16 mei = 6 dagen, min Hemelvaart (14/05) en de extra vrije dag (15/05) = 4
  verlof('11', '2026-05-11', '2026-05-16', 'betaald_verlof', 'approved'),
  // Carla is uit dienst: alleen zichtbaar als je haar kiest
  verlof('12', '2026-04-13', '2026-04-15', 'betaald_verlof', 'approved'),
  // Dirk: 1 t/m 17 juni = 15 werkdagen (ma-za), vijf boven zijn budget van 10
  verlof('14', '2026-06-01', '2026-06-17', 'betaald_verlof', 'approved'),
  // Verwijderd account: de aanvragen staan er nog
  verlof('999', '2026-09-07', '2026-09-09', 'betaald_verlof', 'approved'),
];

const EXTRA = new Set(['2026-05-15']);
const bron: VerlofsaldoBron = { users: USERS, leave: LEAVE, extraFeestdagen: EXTRA };

afterEach(() => stelExtraFeestdagenIn([]));

describe('bouwVerlofsaldo (vaste cijfers)', () => {
  it('2026, iedereen: wie verlof opneemt, met de nagetelde dagen', () => {
    const { rijen } = bouwVerlofsaldo(bron, { jaar: 2026, keuzes: {} });
    expect(rijen).toEqual([
      { id: '10', naam: 'Bert Buschauffeur', sectie: 'Reguliere diensten', budget: 24, opgenomen: 12, aangevraagd: 2, vrij: 10, kleinVerlet: 1 },
      { id: '11', naam: 'Tom Technieker', sectie: 'Garage', budget: 20, opgenomen: 4, aangevraagd: 0, vrij: 16, kleinVerlet: 0 },
      { id: '14', naam: 'Dirk Deeltijds', sectie: null, budget: 10, opgenomen: 15, aangevraagd: 0, vrij: 0, kleinVerlet: 0 },
    ]);
  });

  it('totalen', () => {
    const { rijen } = bouwVerlofsaldo(bron, { jaar: 2026, keuzes: {} });
    expect(berekenTotalen(def, rijen)).toEqual({ budget: 54, opgenomen: 31, aangevraagd: 2, vrij: 26, kleinVerlet: 1 });
  });

  it('staf, wie uit dienst is en het beheerdersaccount staan niet in de lijst', () => {
    const ids = bouwVerlofsaldo(bron, { jaar: 2026, keuzes: {} }).rijen.map((r) => r.id);
    expect(ids).toEqual(['10', '11', '14']);
  });

  it('een periode over de jaargrens telt in elk jaar alleen haar eigen dagen', () => {
    const bert2025 = bouwVerlofsaldo(bron, { jaar: 2025, keuzes: {} }).rijen.find((r) => r.id === '10');
    expect(bert2025).toMatchObject({ opgenomen: 3, aangevraagd: 0, vrij: 21, kleinVerlet: 0 });
  });

  it('zonder de extra vrije dag telt 15 mei gewoon mee', () => {
    const tom = bouwVerlofsaldo({ ...bron, extraFeestdagen: new Set() }, { jaar: 2026, keuzes: {} }).rijen.find((r) => r.id === '11');
    expect(tom).toMatchObject({ opgenomen: 5, vrij: 15 });
  });

  it('medewerkerfilter: één rij, ook voor wie uit dienst is', () => {
    expect(bouwVerlofsaldo(bron, { jaar: 2026, chauffeur: '12', keuzes: {} }).rijen).toEqual([
      { id: '12', naam: 'Carla Vertrokken (uit dienst)', sectie: null, budget: 24, opgenomen: 3, aangevraagd: 0, vrij: 21, kleinVerlet: 0 },
    ]);
  });

  it('een verwijderde gebruiker blijft staan als "Onbekend (<id>)", met zijn verlof', () => {
    expect(bouwVerlofsaldo(bron, { jaar: 2026, chauffeur: '999', keuzes: {} }).rijen).toEqual([
      { id: '999', naam: 'Onbekend (999)', sectie: null, budget: 24, opgenomen: 3, aangevraagd: 0, vrij: 21, kleinVerlet: 0 },
    ]);
  });

  it('een jaar zonder verlof geeft nullen (het scherm beslist met het bereik of dat een tabel wordt)', () => {
    const { rijen } = bouwVerlofsaldo(bron, { jaar: 2019, keuzes: {} });
    expect(berekenTotalen(def, rijen)).toEqual({ budget: 54, opgenomen: 0, aangevraagd: 0, vrij: 54, kleinVerlet: 0 });
  });
});

describe('bereik', () => {
  it('eerste en laatste dag met verlof of klein verlet; ziekte en geweigerd tellen niet', () => {
    expect(bouwVerlofsaldo(bron, { jaar: 2026, keuzes: {} }).bereik).toEqual({ van: '2025-12-29', tot: '2026-12-27' });
  });

  it('nog niets geregistreerd = null', () => {
    expect(bouwVerlofsaldo({ ...bron, leave: [] }, { jaar: 2026, keuzes: {} }).bereik).toBeNull();
    expect(bouwVerlofsaldo({ ...bron, leave: [verlof('10', '2026-01-05', '2026-01-09', 'ziekte', 'approved')] }, { jaar: 2026, keuzes: {} }).bereik).toBeNull();
  });
});

describe('gelijk aan het saldo-overzicht in Verlof (VerlofSaldoModal)', () => {
  for (const jaar of [2025, 2026, 2027]) {
    it(`${jaar}: dezelfde mensen, dezelfde cijfers, dezelfde totalen`, () => {
      // De modal leest de extra vrije dagen uit de datalaag (stelExtraFeestdagenIn).
      stelExtraFeestdagenIn(EXTRA);
      const modal = verlofSaldoRijen(USERS, LEAVE, jaar);
      const rapport = bouwVerlofsaldo(bron, { jaar, keuzes: {} }).rijen;

      expect(rapport.map((r) => r.id)).toEqual(modal.map((m) => m.user.id));
      // Dezelfde kolommen als de CSV van de modal: Budget, Opgenomen, Aangevraagd, Vrij, Klein verlet.
      expect(rapport.map((r) => [r.naam, r.budget, r.opgenomen, r.aangevraagd, r.vrij, r.kleinVerlet])).toEqual(
        modal.map((m) => [m.user.name, m.balans.betaaldBudget, m.balans.betaaldGebruikt, m.balans.betaaldAangevraagd, m.balans.betaaldVrij, m.balans.kleinVerletDagen]),
      );

      const totaalModal = modal.reduce((t, m) => ({
        budget: t.budget + m.balans.betaaldBudget, opgenomen: t.opgenomen + m.balans.betaaldGebruikt,
        aangevraagd: t.aangevraagd + m.balans.betaaldAangevraagd, vrij: t.vrij + m.balans.betaaldVrij,
        kleinVerlet: t.kleinVerlet + m.balans.kleinVerletDagen,
      }), { budget: 0, opgenomen: 0, aangevraagd: 0, vrij: 0, kleinVerlet: 0 });
      expect(berekenTotalen(def, rapport)).toEqual(totaalModal);
    });
  }
});
