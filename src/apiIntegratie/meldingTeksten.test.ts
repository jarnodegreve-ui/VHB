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

// ---------------------------------------------------------------------------
// DEEL 2: wat er in de melding staat. Toegevoegd met de tekstwijziging; deel 1
// hierboven is daarbij niet gewijzigd.
// ---------------------------------------------------------------------------

type Tekst = { titel: string; body: string };

/** Per ontvanger de melding die hij kreeg; twee meldingen voor één ontvanger laten de test falen. */
const perOntvanger = (): Record<string, Tekst> => {
  const uit: Record<string, Tekst> = {};
  for (const p of mem.pushesSent) {
    for (const id of p.userIds) {
      expect(uit[id], `ontvanger ${id} kreeg meer dan één melding`).toBeUndefined();
      uit[id] = { titel: p.payload.title, body: p.payload.body };
    }
  }
  return uit;
};

/** Wat nooit in een melding mag staan. */
const VERBODEN: Array<[string, RegExp]> = [
  ['een intern statuswoord', /\b(pending|accepted|approved|rejected|completed|cancelled)\b/i],
  ['een pijl', /→|->/],
  ['undefined of null', /undefined|null|NaN|\[object/i],
  ['lege haakjes', /\(\s*\)/],
  ['een em dash', /—/],
  ['een rauwe ISO-datum', /\d{4}-\d{2}-\d{2}/],
  ['een dienst zonder nummer', /\bdienst\s*(?:[-,.)]|$)/],
  ['een onbekende gebruiker', /Onbekende gebruiker/],
];
const gebreken = (): string[] => mem.pushesSent.flatMap((p) => [p.payload.title, p.payload.body].flatMap((veld: unknown) => {
  if (typeof veld !== 'string' || veld.trim() === '') return ['lege titel of tekst'];
  return VERBODEN.filter(([, patroon]) => patroon.test(veld)).map(([naam]) => `${naam} in “${veld}”`);
}));

const woord = (soort: Soort) => (soort === 'overname' ? 'overname' : 'ruil');
const beide = (tekst: Tekst) => ({ [A]: tekst, [B]: tekst });

/** De melding per ontvanger, per soort ruil. Chauffeur A geeft dienst 12 van
 *  wo 08/07 aan Chauffeur B; als tegenprestatie dienst 14 van do 02/07, een
 *  vrije dag op wo 08/07, of niets (overname). */
const GOEDGEKEURD = (soort: Soort): Record<string, Tekst> => ({
  [A]: {
    titel: 'Dienstruil goedgekeurd',
    body: soort === 'dienst'
      ? 'Goedgekeurd: je rijdt dienst 14 op do 02/07, Chauffeur B rijdt dienst 12 op wo 08/07.'
      : 'Goedgekeurd: je bent vrij op wo 08/07, Chauffeur B rijdt dienst 12.',
  },
  [B]: {
    titel: 'Dienstruil goedgekeurd',
    body: soort === 'dienst'
      ? 'Goedgekeurd: je rijdt dienst 12 op wo 08/07, Chauffeur A rijdt dienst 14 op do 02/07.'
      : 'Goedgekeurd: je rijdt dienst 12 op wo 08/07.',
  },
});
const TERUGGEDRAAID = (titel: string) => (soort: Soort): Record<string, Tekst> => ({
  [A]: {
    titel,
    body: soort === 'dienst'
      ? 'De planning draaide de ruil terug: je rijdt dienst 12 op wo 08/07 weer zelf, Chauffeur B rijdt dienst 14 op do 02/07.'
      : `De planning draaide de ${woord(soort)} terug: je rijdt dienst 12 op wo 08/07 weer zelf.`,
  },
  [B]: {
    titel,
    body: soort === 'dienst'
      ? 'De planning draaide de ruil terug: je rijdt dienst 14 op do 02/07 weer zelf, Chauffeur A rijdt dienst 12 op wo 08/07.'
      : `De planning draaide de ${woord(soort)} terug: Chauffeur A rijdt dienst 12 op wo 08/07 weer zelf.`,
  },
});
const AFGEWEZEN = (soort: Soort) => beide({ titel: 'Dienstruil afgewezen', body: `De planning wees de ${woord(soort)} van wo 08/07 (dienst 12) af.` });
const GEANNULEERD = (soort: Soort) => beide({ titel: 'Dienstruil geannuleerd', body: `De planning annuleerde de ${woord(soort)} van wo 08/07 (dienst 12).` });
const INGETROKKEN = (): Record<string, Tekst> => ({ [B]: { titel: 'Dienstruil geannuleerd', body: 'Chauffeur A trok de aanvraag voor wo 08/07 (dienst 12) in.' } });

const TEKSTEN: Record<string, (soort: Soort) => Record<string, Tekst>> = {
  'de collega accepteert': (soort) => {
    const validatie: Tekst = {
      titel: 'Dienstruil wacht op validatie',
      body: {
        dienst: 'Chauffeur B accepteerde de ruil van Chauffeur A: dienst 12 op wo 08/07 tegen dienst 14 op do 02/07. Rij- en rusttijden checken.',
        vrij: 'Chauffeur B accepteerde de ruil van Chauffeur A: dienst 12 op wo 08/07 tegen een vrije dag op wo 08/07. Rij- en rusttijden checken.',
        overname: 'Chauffeur B wil dienst 12 van wo 08/07 overnemen van Chauffeur A, zonder tegenprestatie. Rij- en rusttijden checken.',
      }[soort],
    };
    return {
      [A]: {
        titel: 'Dienstruil geaccepteerd',
        body: soort === 'overname'
          ? 'Chauffeur B wil je dienst 12 van wo 08/07 overnemen, de planning moet nog goedkeuren.'
          : 'Chauffeur B accepteerde je ruil van wo 08/07 (dienst 12), de planning moet nog goedkeuren.',
      },
      [ADMIN]: validatie,
      [PLANNER]: validatie,
    };
  },
  'de collega weigert': (soort) => ({ [A]: { titel: 'Dienstruil geweigerd', body: `Chauffeur B weigerde de ${woord(soort)} van wo 08/07 (dienst 12).` } }),
  'de planner keurt goed': GOEDGEKEURD,
  'een admin keurt goed zonder het antwoord van de collega': GOEDGEKEURD,
  'een admin handelt een open ruil rechtstreeks af': GOEDGEKEURD,
  'de planner handelt een goedgekeurde ruil af': () => ({}),
  'de planner wijst een open aanvraag af': AFGEWEZEN,
  'de planner wijst een geaccepteerde ruil af': AFGEWEZEN,
  'de planner wijst een goedgekeurde ruil alsnog af': TERUGGEDRAAID('Dienstruil afgewezen'),
  'de aanvrager trekt een open aanvraag in': INGETROKKEN,
  'de aanvrager trekt een geaccepteerde ruil in': INGETROKKEN,
  'de planner annuleert een open aanvraag': GEANNULEERD,
  'de planner annuleert een geaccepteerde ruil': GEANNULEERD,
  'de planner annuleert een goedgekeurde ruil': TERUGGEDRAAID('Dienstruil geannuleerd'),
};

describe('ruilmeldingen, deel 2: wat er in de melding staat', () => {
  it('elke overgang uit deel 1 heeft hier zijn tekst', () => {
    expect(Object.keys(TEKSTEN).sort()).toEqual(OVERGANGEN.map((o) => o.naam).sort());
  });

  describe('een nieuwe aanvraag zegt wat de collega krijgt en wat de aanvrager ervoor neemt', () => {
    const AANVRAAG: Record<Soort, Tekst> = {
      dienst: { titel: 'Nieuwe dienstruil-aanvraag', body: 'Chauffeur A vraagt een ruil: jij krijgt dienst 12 op wo 08/07, in ruil voor jouw dienst 14 op do 02/07.' },
      vrij: { titel: 'Nieuwe dienstruil-aanvraag', body: 'Chauffeur A vraagt een ruil: jij krijgt dienst 12 op wo 08/07, in ruil voor jouw vrije dag op wo 08/07.' },
      overname: { titel: 'Vraag om een dienst over te nemen', body: 'Chauffeur A vraagt of je dienst 12 van wo 08/07 wil overnemen, zonder tegenprestatie.' },
    };
    for (const soort of SOORTEN) {
      it(soort, async () => {
        // Zonder dienst-info in de aanvraag: de server leest dienst en dag zelf uit de planning.
        const { shiftDate: _d, shiftLine: _l, ...nieuw } = ruil(soort, 'pending', { id: 's-nieuw' });
        const eigen = mem.swaps.filter((s: any) => s.requesterId === A || s.targetDriverId === A);
        expect((await api('POST', '/api/swaps', { token: 'tok-a', body: [...eigen, nieuw] })).status).toBe(200);
        expect(perOntvanger()).toEqual({ [B]: AANVRAAG[soort] });
        expect(gebreken()).toEqual([]);
      });
    }
  });

  for (const o of OVERGANGEN) {
    for (const weg of o.wegen) {
      for (const soort of SOORTEN) {
        it(`${o.naam} (${weg}, ${soort})`, async () => {
          zaai(soort, o.van);
          expect((await wissel(weg, o.door, o.naar)).status).toBe(200);
          expect(perOntvanger()).toEqual(TEKSTEN[o.naam](soort));
          expect(gebreken()).toEqual([]);
        });
      }
    }
  }

  it('dezelfde tekst staat onder de bel: de rij in het meldingencentrum is de melding van die ontvanger', async () => {
    zaai('dienst', 'accepted');
    expect((await wissel('PATCH', PLANNER, 'approved')).status).toBe(200);
    const rijen = mem.meldingen.map((m: any) => [m.userId, m.titel, m.tekst, m.soort, m.doel]).sort();
    expect(rijen).toEqual([
      [A, 'Dienstruil goedgekeurd', 'Goedgekeurd: je rijdt dienst 14 op do 02/07, Chauffeur B rijdt dienst 12 op wo 08/07.', 'ruil', 'dienstruil/s-m'],
      [B, 'Dienstruil goedgekeurd', 'Goedgekeurd: je rijdt dienst 12 op wo 08/07, Chauffeur A rijdt dienst 14 op do 02/07.', 'ruil', 'dienstruil/s-m'],
    ]);
  });

  describe('"je rijdt" staat er alleen als de planning het na de beslissing aantoont', () => {
    for (const weg of ['PATCH', 'lijst'] as const) {
      it(`${weg}: een oude ruil zonder dienst-info wordt goedgekeurd zonder doorvoer, dus zonder zin over wie rijdt`, async () => {
        mem.swaps = [{ id: 's-m', shiftId: 'sh-a', requesterId: A, targetDriverId: B, status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' }];
        const voor = JSON.stringify(mem.planning);
        expect((await wissel(weg, PLANNER, 'approved')).status).toBe(200);
        expect(JSON.stringify(mem.planning)).toBe(voor);
        expect(perOntvanger()).toEqual(beide({ titel: 'Dienstruil goedgekeurd', body: 'De planning keurde de ruil goed. Bekijk je rooster.' }));
        // Eén tekst voor beiden: dan ook één verzending, zoals vroeger.
        expect(mem.pushesSent).toHaveLength(1);
        expect(gebreken()).toEqual([]);
      });

      it(`${weg}: de terugdienst staat niet meer bij de collega: alleen wat verhuisde staat in de melding`, async () => {
        zaai('dienst', 'accepted');
        // Dienst 14 van do 02/07 ging intussen naar een derde: de aangeboden dienst verhuist, de terugdienst niet.
        mem.planning = mem.planning.map((p: any) => (p.id === 'sh-b' ? { ...p, driverId: '9' } : p));
        expect((await wissel(weg, PLANNER, 'approved')).status).toBe(200);
        expect(mem.planning.find((p: any) => p.id === 'sh-c')?.driverId).toBe(B);
        expect(mem.planning.find((p: any) => p.id === 'sh-b')?.driverId).toBe('9');
        expect(perOntvanger()).toEqual({
          [A]: { titel: 'Dienstruil goedgekeurd', body: 'Goedgekeurd: Chauffeur B rijdt dienst 12 op wo 08/07. Bekijk je rooster.' },
          [B]: { titel: 'Dienstruil goedgekeurd', body: 'Goedgekeurd: je rijdt dienst 12 op wo 08/07. Bekijk je rooster.' },
        });
        expect(gebreken()).toEqual([]);
      });

      it(`${weg}: stond de wissel al in de planning (halve doorvoer), dan toont de planning hem en zegt de melding wie rijdt`, async () => {
        zaai('dienst', 'accepted');
        voerDoorInPlanning('dienst');
        expect((await wissel(weg, PLANNER, 'approved')).status).toBe(200);
        expect(perOntvanger()).toEqual(GOEDGEKEURD('dienst'));
      });

      it(`${weg}: een goedgekeurde ruil waarvan de rijen niet meer terug te vinden zijn wordt geannuleerd zonder zin over wie rijdt`, async () => {
        zaai('overname', 'approved');
        // De dienst staat intussen bij een derde: er valt niets terug te zetten.
        mem.planning = mem.planning.map((p: any) => (p.id === 'sh-c' ? { ...p, driverId: '9' } : p));
        expect((await wissel(weg, PLANNER, 'cancelled')).status).toBe(200);
        expect(mem.planning.find((p: any) => p.id === 'sh-c')?.driverId).toBe('9');
        expect(perOntvanger()).toEqual(beide({ titel: 'Dienstruil geannuleerd', body: 'De planning draaide de goedgekeurde overname van wo 08/07 (dienst 12) terug. Bekijk je rooster.' }));
        expect(gebreken()).toEqual([]);
      });
    }

    it('lijstroute: de tekst beschrijft het record zoals het doorgevoerd is; wie daar niet in zit krijgt de neutrale zin', async () => {
      // Een admin keurt een open overname goed en zet ze in dezelfde save op
      // naam van een andere collega. De ontvangers komen zoals altijd uit het
      // opgeslagen record (A en B); de dienst gaat naar C.
      mem.users.push({ id: '5', name: 'Chauffeur C', email: 'c@vhb.be', role: 'chauffeur', isActive: true });
      mem.planningMatrix = [{ id: 'm-1', source_date: DAG, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'bv', 'Chauffeur C': 'vrij' }, raw_row: '' }];
      zaai('overname', 'pending');
      const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s: any) => ({ ...s, status: 'approved', targetDriverId: '5' })) });
      expect(res.status).toBe(200);
      expect(mem.planning.find((p: any) => p.id === 'sh-c')?.driverId).toBe('5');
      expect(perOntvanger()).toEqual({
        [A]: { titel: 'Dienstruil goedgekeurd', body: 'Goedgekeurd: je bent vrij op wo 08/07, Chauffeur C rijdt dienst 12.' },
        [B]: { titel: 'Dienstruil goedgekeurd', body: 'De planning keurde de overname van wo 08/07 (dienst 12) goed. Bekijk je rooster.' },
      });
      expect(gebreken()).toEqual([]);
    });
  });

  it('een verwijderd account in de ruil: "je collega", geen id en geen "Onbekende gebruiker"', async () => {
    // Het account van de aanvrager bestaat niet meer; de ruil staat er nog.
    zaai('vrij', 'pending');
    mem.users = mem.users.filter((u: any) => u.id !== A);
    expect((await wissel('PATCH', B, 'accepted')).status).toBe(200);
    expect(perOntvanger()[PLANNER]).toEqual({
      titel: 'Dienstruil wacht op validatie',
      body: 'Chauffeur B accepteerde de ruil: dienst 12 op wo 08/07 tegen een vrije dag op wo 08/07. Rij- en rusttijden checken.',
    });
    expect(gebreken()).toEqual([]);
    mem.pushesSent = [];
    expect((await wissel('PATCH', PLANNER, 'cancelled')).status).toBe(200);
    expect(perOntvanger()[B]).toEqual({ titel: 'Dienstruil geannuleerd', body: 'De planning annuleerde de ruil van wo 08/07 (dienst 12).' });
    expect(gebreken()).toEqual([]);
    // En omgekeerd: het account van de collega is weg, de aanvrager leest "je collega".
    mem.pushesSent = [];
    mem.users = [...mem.users.filter((u: any) => u.id !== B), { id: A, name: 'Chauffeur A', email: 'a@vhb.be', role: 'chauffeur', isActive: true }];
    mem.swaps = [ruil('vrij', 'accepted')];
    mem.planning = mem.planning.map((p: any) => (p.id === 'sh-c' ? { ...p, driverId: B } : p));
    expect((await wissel('PATCH', PLANNER, 'approved')).status).toBe(200);
    expect(perOntvanger()[A]).toEqual({ titel: 'Dienstruil goedgekeurd', body: 'Goedgekeurd: je bent vrij op wo 08/07, je collega rijdt dienst 12.' });
    expect(gebreken()).toEqual([]);
  });
});

describe('dienst toegewezen, deel 2: de melding noemt weekdag, datum en uren', () => {
  const wijsToe = (serviceNumber: string) =>
    api('POST', '/api/planning/assign-service', { token: 'tok-planner', body: { date: DAG, serviceNumber, driverId: B } });

  it('een dienst in één stuk: de uren zoals ze in de planning komen', async () => {
    expect((await wijsToe('14')).status).toBe(200);
    expect(mem.pushesSent[0].payload).toMatchObject({ title: 'Dienst toegewezen', body: 'Je rijdt dienst 14 op wo 08/07: 10:00–18:00.' });
    expect(mem.planning.filter((p: any) => p.date === DAG && p.line === '14').map((p: any) => [p.driverId, p.startTime, p.endTime])).toEqual([[B, '10:00', '18:00']]);
    expect(gebreken()).toEqual([]);
  });

  it('de uren in de melding zijn precies de blokken die op naam van de chauffeur in de planning komen', async () => {
    // Het harnas geeft van een dienst alleen het eerste blok (zijn
    // getServiceSegments). Alle delen van een gesplitste dienst, op de echte
    // blokken uit het dienstoverzicht, staan in src/meldingTeksten.test.ts.
    mem.services.push({ id: 'd-vroeg', serviceNumber: '2116', startTime: '06:45', endTime: '10:00', startTime2: '15:45', endTime2: '19:35' });
    expect((await wijsToe('2116')).status).toBe(200);
    const blokken = mem.planning.filter((p: any) => p.date === DAG && p.line === '2116' && p.driverId === B).map((p: any) => `${p.startTime}–${p.endTime}`);
    expect(blokken.length).toBeGreaterThan(0);
    expect(mem.pushesSent[0].payload.body).toBe(`Je rijdt dienst 2116 op wo 08/07: ${blokken.join(' en ')}.`);
    expect(gebreken()).toEqual([]);
  });
});
