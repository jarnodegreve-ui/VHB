// @vitest-environment node
import { api, mem } from './harnas';
import { describe, it, expect } from 'vitest';

/**
 * Meldingen over een dienstruil en een toegewezen dienst (ronde 6, punt 11).
 *
 * DEEL 1 legt vast WIE welke melding krijgt, met welke soort en welke url.
 * Het is geschreven en groen gedraaid op de routes van vóór de tekstwijziging
 * en daarna niet meer aangeraakt: alleen titel en tekst zijn veranderd, niet
 * wie iets krijgt, wanneer, met welke soort of naar welk scherm.
 *
 * Geteld wordt per ontvanger, niet per verzending: of twee chauffeurs samen in
 * één verzending zitten of elk hun eigen tekst krijgen, is voor hen hetzelfde.
 */

const DAG = '2026-07-08'; // dienst 12 van chauffeur A (sh-c); chauffeur B staat die dag op bv
const TERUGDAG = '2026-07-02'; // dienst 14 van chauffeur B (sh-b)
const A = '3';
const B = '4';
const ADMIN = '1';
const PLANNER = '2';

type Soort = 'dienst' | 'vrij' | 'overname';

/** Een ruil van A naar B over dienst 12 van 08/07, in de drie soorten. */
const ruil = (soort: Soort, status: string, extra: Record<string, unknown> = {}) => ({
  id: 's-m', shiftId: 'sh-c', requesterId: A, targetDriverId: B, status, reason: '',
  createdAt: '2026-06-12T08:00:00Z', shiftDate: DAG, shiftLine: '12',
  ...(soort === 'dienst' ? { swapType: 'ruil', returnDate: TERUGDAG, returnCode: '14' } : {}),
  ...(soort === 'vrij' ? { swapType: 'ruil', returnDate: DAG, returnCode: 'VRIJ' } : {}),
  ...(soort === 'overname' ? { swapType: 'overname' } : {}),
  ...extra,
});

/** De planning zoals ze na de doorvoer van die ruil staat. */
const voerDoorInPlanning = (soort: Soort) => {
  mem.planning = mem.planning.map((p: any) => {
    if (p.id === 'sh-c') return { ...p, driverId: B };
    if (p.id === 'sh-b' && soort === 'dienst') return { ...p, driverId: A };
    return p;
  });
};

const zaai = (soort: Soort, status: string) => {
  mem.swaps = [ruil(soort, status, status === 'approved' ? { decidedAt: '2026-06-13T08:00:00Z' } : {})];
  if (status === 'approved') voerDoorInPlanning(soort);
};

type Weg = 'PATCH' | 'lijst';
const TOKEN: Record<string, string> = { [A]: 'tok-a', [B]: 'tok-b', [ADMIN]: 'tok-admin', [PLANNER]: 'tok-planner' };

/** Eén statuswissel op s-m, langs de delta-route of langs de lijstroute. */
const wissel = (weg: Weg, door: string, naar: string) => {
  const nu = mem.swaps.find((s: any) => s.id === 's-m')!;
  if (weg === 'PATCH') return api('PATCH', '/api/swaps/s-m', { token: TOKEN[door], body: { status: naar, ifStatus: nu.status } });
  // Een chauffeur stuurt alleen zijn eigen ruilen terug, staf de hele lijst.
  const eigen = door === A || door === B
    ? mem.swaps.filter((s: any) => s.requesterId === door || s.targetDriverId === door)
    : mem.swaps;
  return api('POST', '/api/swaps', { token: TOKEN[door], body: eigen.map((s: any) => (s.id === 's-m' ? { ...s, status: naar } : s)) });
};

/** Elke melding per ontvanger als "ontvanger | soort | url", gesorteerd. */
const ontvangen = () => mem.pushesSent
  .flatMap((p) => p.userIds.map((id) => `${id} | ${p.payload.soort} | ${p.payload.url}`))
  .sort();

const naarRuil = (...ids: string[]) => ids.map((id) => `${id} | ruil | /dienstruil/s-m`).sort();
const naarRooster = (...ids: string[]) => ids.map((id) => `${id} | planning | /?view=rooster`).sort();

type Overgang = {
  naam: string;
  /** Status waarin de ruil staat vóór de beslissing. */
  van: string;
  naar: string;
  door: string;
  /** Wie een melding krijgt (elk precies één keer). */
  ontvangers: string[];
  wegen: Weg[];
};

const OVERGANGEN: Overgang[] = [
  { naam: 'de collega accepteert', van: 'pending', naar: 'accepted', door: B, ontvangers: [A, ADMIN, PLANNER], wegen: ['PATCH', 'lijst'] },
  { naam: 'de collega weigert', van: 'pending', naar: 'rejected', door: B, ontvangers: [A], wegen: ['PATCH', 'lijst'] },
  { naam: 'de planner keurt goed', van: 'accepted', naar: 'approved', door: PLANNER, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'een admin keurt goed zonder het antwoord van de collega', van: 'pending', naar: 'approved', door: ADMIN, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'een admin handelt een open ruil rechtstreeks af', van: 'accepted', naar: 'completed', door: ADMIN, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'de planner handelt een goedgekeurde ruil af', van: 'approved', naar: 'completed', door: PLANNER, ontvangers: [], wegen: ['PATCH', 'lijst'] },
  { naam: 'de planner wijst een open aanvraag af', van: 'pending', naar: 'rejected', door: PLANNER, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'de planner wijst een geaccepteerde ruil af', van: 'accepted', naar: 'rejected', door: PLANNER, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'de planner wijst een goedgekeurde ruil alsnog af', van: 'approved', naar: 'rejected', door: PLANNER, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'de aanvrager trekt een open aanvraag in', van: 'pending', naar: 'cancelled', door: A, ontvangers: [B], wegen: ['PATCH'] },
  { naam: 'de aanvrager trekt een geaccepteerde ruil in', van: 'accepted', naar: 'cancelled', door: A, ontvangers: [B], wegen: ['PATCH'] },
  { naam: 'de planner annuleert een open aanvraag', van: 'pending', naar: 'cancelled', door: PLANNER, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'de planner annuleert een geaccepteerde ruil', van: 'accepted', naar: 'cancelled', door: PLANNER, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
  { naam: 'de planner annuleert een goedgekeurde ruil', van: 'approved', naar: 'cancelled', door: PLANNER, ontvangers: [A, B], wegen: ['PATCH', 'lijst'] },
];

const SOORTEN: Soort[] = ['dienst', 'vrij', 'overname'];

describe('ruilmeldingen, deel 1: wie krijgt welke melding (ongewijzigd)', () => {
  describe('een nieuwe aanvraag gaat naar de aangezochte collega', () => {
    const nieuw = (soort: Soort) => {
      const { shiftDate: _d, shiftLine: _l, ...zonderDienstInfo } = ruil(soort, 'pending', { id: 's-nieuw' });
      return zonderDienstInfo;
    };
    for (const soort of SOORTEN) {
      it(`${soort}: alleen de collega, soort ruil, link naar de aanvraag`, async () => {
        const eigen = mem.swaps.filter((s: any) => s.requesterId === A || s.targetDriverId === A);
        const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...eigen, nieuw(soort)] });
        expect(res.status).toBe(200);
        expect(ontvangen()).toEqual([`${B} | ruil | /dienstruil/s-nieuw`]);
      });
    }
  });

  for (const o of OVERGANGEN) {
    for (const weg of o.wegen) {
      for (const soort of SOORTEN) {
        it(`${o.naam} (${o.van} naar ${o.naar}, ${weg}, ${soort}): ${o.ontvangers.length ? `naar ${o.ontvangers.join(', ')}` : 'geen melding'}`, async () => {
          zaai(soort, o.van);
          const res = await wissel(weg, o.door, o.naar);
          expect(res.status).toBe(200);
          expect(mem.swaps.find((s: any) => s.id === 's-m')?.status).toBe(o.naar);
          expect(ontvangen()).toEqual(naarRuil(...o.ontvangers));
        });
      }
    }
  }

  it('wie zelf beslist krijgt zijn eigen melding niet, ook niet als hij in de ruil zit', async () => {
    // s-2 uit het harnas: chauffeur B vraagt een ruil aan de planner.
    const res = await api('PATCH', '/api/swaps/s-2', { token: 'tok-planner', body: { status: 'rejected', ifStatus: 'pending' } });
    expect(res.status).toBe(200);
    expect(ontvangen()).toEqual([`${B} | ruil | /dienstruil/s-2`]);
  });

  it('een aanvraag die de aanvrager uit zijn lijst weglaat verdwijnt zonder melding', async () => {
    zaai('vrij', 'pending');
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [] });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-m')).toBeUndefined();
    expect(ontvangen()).toEqual([]);
  });

  describe('handmatige wissel door een admin: titel, tekst, soort en ontvangers blijven zoals ze waren', () => {
    const zet = (body: Record<string, unknown>) =>
      api('POST', '/api/admin/shift-swap', { token: 'tok-admin', body: { date: '2026-07-22', line: '12', fromDriverId: A, toDriverId: B, reason: 'Ziekte', ...body } });

    it('een dienst overzetten', async () => {
      mem.planning.push({ id: 'sh-y1', driverId: A, date: '2026-07-22', line: '12' });
      expect((await zet({})).status).toBe(200);
      expect(ontvangen()).toEqual(naarRooster(A, B));
      expect(mem.pushesSent).toHaveLength(1);
      expect(mem.pushesSent[0].payload.title).toBe('Planning aangepast');
      expect(mem.pushesSent[0].payload.body).toBe('Dienst 12 op 22/07/2026 is overgezet van Chauffeur A naar Chauffeur B. Reden: Ziekte.');
    });

    it('twee diensten 1-op-1 wisselen', async () => {
      mem.planning.push({ id: 'sh-y1', driverId: A, date: '2026-07-22', line: '12' }, { id: 'sh-y2', driverId: B, date: '2026-07-22', line: '14' });
      expect((await zet({ returnLine: '14' })).status).toBe(200);
      expect(ontvangen()).toEqual(naarRooster(A, B));
      expect(mem.pushesSent).toHaveLength(1);
      expect(mem.pushesSent[0].payload.title).toBe('Planning aangepast');
      expect(mem.pushesSent[0].payload.body).toBe('Op 22/07/2026 zijn de diensten gewisseld: Chauffeur B rijdt dienst 12, Chauffeur A rijdt dienst 14. Reden: Ziekte.');
    });
  });
});

describe('dienst toegewezen, deel 1: wie krijgt de melding (ongewijzigd)', () => {
  it('alleen de chauffeur die de dienst krijgt, soort planning, link naar het rooster', async () => {
    // 08/07: chauffeur B staat op bv, dienst 14 (10:00 tot 18:00) staat op niemand.
    const res = await api('POST', '/api/planning/assign-service', { token: 'tok-planner', body: { date: DAG, serviceNumber: '14', driverId: B } });
    expect(res.status).toBe(200);
    expect(ontvangen()).toEqual(naarRooster(B));
    expect(mem.pushesSent.map((p) => p.payload.title)).toEqual(['Dienst toegewezen']);
  });
});
