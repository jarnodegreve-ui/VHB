// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  dagKort, dienstToegewezenTekst, meldingenPerTekst, ruilAanvraagMelding, ruilBeslisMelding, ruilBeslisser, ruilValidatieMelding,
  type RuilBeslissing, type RuilPlanningStand, type RuilVoorMelding,
} from '../api/_lib/meldingTeksten';
import { getServiceSegments } from '../api/_lib/storage';
import { isStafRol } from '../api/_lib/types';
import { persoonsVerloop, verloopUitLog } from '../shared/ruilVerloop';

/**
 * De tekst van de meldingen over een dienstruil en een toegewezen dienst
 * (ronde 6, punt 11). Elk soort ruil × elke overgang × elke ontvanger, met de
 * letterlijke zin; daarna de kortere vormen bij ontbrekende gegevens, en één
 * net over álle combinaties: nooit een intern statuswoord, een pijl,
 * "undefined", lege haakjes of een rauwe datum.
 */

const A = 'u-aanvrager';
const C = 'u-collega';
const NAMEN = { aanvrager: 'Jan Peeters', collega: 'Piet Janssens' };

// Jan geeft dienst 4101 van wo 11/11 aan Piet.
const basis = { requesterId: A, targetDriverId: C, shiftDate: '2026-11-11', shiftLine: '4101' };
const RUIL = {
  /** Tegen dienst 4205 van Piet op vr 13/11. */
  dienst: { ...basis, swapType: 'ruil', returnDate: '2026-11-13', returnCode: '4205' },
  /** Tegen dienst 4205 van Piet op dezelfde dag (zo slaat de handmatige wissel een 1-op-1 op). */
  zelfdeDag: { ...basis, swapType: 'ruil', returnDate: '2026-11-11', returnCode: '4205' },
  /** Tegen een vrije dag van Piet op vr 13/11; de opslag bewaart 'VRIJ' zoals de client het stuurt. */
  vrij: { ...basis, swapType: 'ruil', returnDate: '2026-11-13', returnCode: 'VRIJ' },
  /** Zonder tegenprestatie. */
  overname: { ...basis, swapType: 'overname' },
} satisfies Record<string, RuilVoorMelding>;
type Soort = keyof typeof RUIL;
const SOORTEN = Object.keys(RUIL) as Soort[];

const DOORGEVOERD: RuilPlanningStand = { richting: 'doorgevoerd', benen: { aangeboden: true, terug: true } };
const TERUGGEDRAAID: RuilPlanningStand = { richting: 'teruggedraaid', benen: { aangeboden: true, terug: true } };

const beslis = (soort: Soort, stap: Omit<RuilBeslissing, 'ruil' | 'namen'>, ontvanger: string, namen = NAMEN) =>
  ruilBeslisMelding({ ruil: RUIL[soort], namen, ...stap }, ontvanger);

describe('dagKort: korte weekdag met dag en maand', () => {
  it('schrijft elke weekdag in twee letters, met dag/maand zonder jaar', () => {
    expect(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map(dagKort))
      .toEqual(['ma 09/11', 'di 10/11', 'wo 11/11', 'do 12/11', 'vr 13/11', 'za 14/11', 'zo 15/11']);
    expect(dagKort('2027-01-02')).toBe('za 02/01');
    expect(dagKort('2028-02-29')).toBe('di 29/02');
  });

  it('leest alleen de dag uit een tijdstip, zonder te verschuiven', () => {
    expect(dagKort('2026-11-11T23:30:00+01:00')).toBe('wo 11/11');
    expect(dagKort('2026-11-11T00:00:00.000Z')).toBe('wo 11/11');
  });

  it('geeft niets voor wat geen echte kalenderdag is', () => {
    for (const fout of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '11/11/2026', 'morgen', '', null, undefined, 20261111, {}]) {
      expect(dagKort(fout)).toBeNull();
    }
  });
});

describe('nieuwe aanvraag, voor de aangezochte collega', () => {
  it('ruil met een dienst als tegenprestatie: wat jij krijgt en wat de aanvrager ervoor neemt', () => {
    expect(ruilAanvraagMelding(RUIL.dienst, NAMEN)).toEqual({
      titel: 'Nieuwe dienstruil-aanvraag',
      body: 'Jan Peeters vraagt een ruil: jij krijgt dienst 4101 op wo 11/11, in ruil voor jouw dienst 4205 op vr 13/11.',
    });
    expect(ruilAanvraagMelding(RUIL.zelfdeDag, NAMEN).body)
      .toBe('Jan Peeters vraagt een ruil: jij krijgt dienst 4101 op wo 11/11, in ruil voor jouw dienst 4205 op wo 11/11.');
  });

  it('ruil tegen een vrije dag: de dag van die vrije dag staat erbij, nooit "dienst VRIJ"', () => {
    expect(ruilAanvraagMelding(RUIL.vrij, NAMEN)).toEqual({
      titel: 'Nieuwe dienstruil-aanvraag',
      body: 'Jan Peeters vraagt een ruil: jij krijgt dienst 4101 op wo 11/11, in ruil voor jouw vrije dag op vr 13/11.',
    });
    expect(ruilAanvraagMelding({ ...RUIL.vrij, returnCode: 'vrij' }, NAMEN).body).toContain('jouw vrije dag op vr 13/11');
  });

  it('overname: eigen titel, de dienst en de dag, en dat er geen tegenprestatie is', () => {
    expect(ruilAanvraagMelding(RUIL.overname, NAMEN)).toEqual({
      titel: 'Vraag om een dienst over te nemen',
      body: 'Jan Peeters vraagt of je dienst 4101 van wo 11/11 wil overnemen, zonder tegenprestatie.',
    });
    // Een overname heeft nooit een tegenprestatie, ook niet als de client er velden voor meestuurt.
    expect(ruilAanvraagMelding({ ...RUIL.overname, returnDate: '2026-11-13', returnCode: '4205' }, NAMEN).body)
      .toBe('Jan Peeters vraagt of je dienst 4101 van wo 11/11 wil overnemen, zonder tegenprestatie.');
  });

  it('wat jij krijgt is wat het verloop per persoon bij de collega zet, voor elk soort ruil', () => {
    for (const soort of SOORTEN) {
      const regels = persoonsVerloop({ status: 'pending', ...RUIL[soort] });
      const collega = regels.find((r) => r.rol === 'collega')!.krijgt!;
      const aanvrager = regels.find((r) => r.rol === 'aanvrager')!.krijgt;
      const body = ruilAanvraagMelding(RUIL[soort], NAMEN).body;
      expect(body).toContain(`dienst ${collega.code}`);
      expect(body).toContain(dagKort(collega.datum)!);
      if (aanvrager) expect(body).toContain(`in ruil voor jouw ${aanvrager.code === 'VRIJ' ? 'vrije dag' : `dienst ${aanvrager.code}`} op ${dagKort(aanvrager.datum)}`);
      else expect(body).not.toContain('in ruil voor');
    }
  });
});

describe('de collega accepteert', () => {
  const stap = { van: 'pending', naar: 'accepted', doorStaf: false };

  it('de aanvrager leest wie accepteerde, voor welke ruil, en dat de planning nog moet beslissen', () => {
    for (const soort of ['dienst', 'zelfdeDag', 'vrij'] as const) {
      expect(beslis(soort, stap, A)).toEqual({
        titel: 'Dienstruil geaccepteerd',
        body: 'Piet Janssens accepteerde je ruil van wo 11/11 (dienst 4101), de planning moet nog goedkeuren.',
      });
    }
    expect(beslis('overname', stap, A)).toEqual({
      titel: 'Dienstruil geaccepteerd',
      body: 'Piet Janssens wil je dienst 4101 van wo 11/11 overnemen, de planning moet nog goedkeuren.',
    });
  });

  it('nog niets is beslist: niemand leest dat hij een dienst rijdt of vrij is', () => {
    for (const soort of SOORTEN) for (const wie of [A, C, 'u-derde']) {
      const { body } = beslis(soort, { ...stap, planning: DOORGEVOERD }, wie);
      expect(body).not.toMatch(/je rijdt|je bent vrij/);
    }
  });

  it('de planning leest wie akkoord ging met welke ruil, en wat er te checken valt', () => {
    expect(ruilValidatieMelding(RUIL.dienst, NAMEN)).toEqual({
      titel: 'Dienstruil wacht op validatie',
      body: 'Piet Janssens accepteerde de ruil van Jan Peeters: dienst 4101 op wo 11/11 tegen dienst 4205 op vr 13/11. Rij- en rusttijden checken.',
    });
    expect(ruilValidatieMelding(RUIL.vrij, NAMEN).body)
      .toBe('Piet Janssens accepteerde de ruil van Jan Peeters: dienst 4101 op wo 11/11 tegen een vrije dag op vr 13/11. Rij- en rusttijden checken.');
    expect(ruilValidatieMelding(RUIL.overname, NAMEN).body)
      .toBe('Piet Janssens wil dienst 4101 van wo 11/11 overnemen van Jan Peeters, zonder tegenprestatie. Rij- en rusttijden checken.');
  });
});

describe('de planning keurt goed: elk leest wat voor hem verandert', () => {
  const stap = { van: 'accepted', naar: 'approved', doorStaf: true, planning: DOORGEVOERD };

  it('ruil met een dienst terug: elk zijn nieuwe dienst, en wie de andere rijdt', () => {
    expect(beslis('dienst', stap, C)).toEqual({
      titel: 'Dienstruil goedgekeurd',
      body: 'Goedgekeurd: je rijdt dienst 4101 op wo 11/11, Jan Peeters rijdt dienst 4205 op vr 13/11.',
    });
    expect(beslis('dienst', stap, A)).toEqual({
      titel: 'Dienstruil goedgekeurd',
      body: 'Goedgekeurd: je rijdt dienst 4205 op vr 13/11, Piet Janssens rijdt dienst 4101 op wo 11/11.',
    });
  });

  it('twee diensten op dezelfde dag: de dag staat er één keer', () => {
    expect(beslis('zelfdeDag', stap, C).body).toBe('Goedgekeurd: je rijdt dienst 4101 op wo 11/11, Jan Peeters rijdt dienst 4205.');
    expect(beslis('zelfdeDag', stap, A).body).toBe('Goedgekeurd: je rijdt dienst 4205 op wo 11/11, Piet Janssens rijdt dienst 4101.');
  });

  it('vrije dag of overname: de collega rijdt, de aanvrager is vrij op de dag van zijn dienst', () => {
    for (const soort of ['vrij', 'overname'] as const) {
      expect(beslis(soort, stap, C).body).toBe('Goedgekeurd: je rijdt dienst 4101 op wo 11/11.');
      expect(beslis(soort, stap, A).body).toBe('Goedgekeurd: je bent vrij op wo 11/11, Piet Janssens rijdt dienst 4101.');
    }
  });

  it('de vrije dag van het voorstel (vr 13/11) is geen feit in de planning: bij de goedkeuring staat alleen de dag van de dienst', () => {
    for (const wie of [A, C]) expect(beslis('vrij', stap, wie).body).not.toContain('13/11');
  });

  it('een admin die zonder de collega goedkeurt of rechtstreeks afhandelt geeft dezelfde melding', () => {
    expect(beslis('dienst', { ...stap, van: 'pending' }, C)).toEqual(beslis('dienst', stap, C));
    expect(beslis('dienst', { ...stap, van: 'pending' }, A)).toEqual(beslis('dienst', stap, A));
  });

  describe('"je rijdt" staat er alleen als de planning het aantoont', () => {
    const NEUTRAAL = 'De planning keurde de ruil van wo 11/11 (dienst 4101) goed. Bekijk je rooster.';

    it('niets aangetoond (oude ruil zonder doorvoer, of een status die opnieuw bewaard is): de neutrale zin', () => {
      for (const planning of [null, undefined, { richting: 'doorgevoerd', benen: { aangeboden: false, terug: false } } as const]) {
        for (const soort of ['dienst', 'zelfdeDag', 'vrij'] as const) for (const wie of [A, C]) {
          expect(beslis(soort, { ...stap, planning }, wie).body).toBe(NEUTRAAL);
        }
        expect(beslis('overname', { ...stap, planning }, A).body).toBe('De planning keurde de overname van wo 11/11 (dienst 4101) goed. Bekijk je rooster.');
      }
    });

    it('de terugdienst verhuisde niet: alleen wat vaststaat, en een verwijzing naar het rooster', () => {
      const half = { ...stap, planning: { richting: 'doorgevoerd', benen: { aangeboden: true, terug: false } } as const };
      expect(beslis('dienst', half, C).body).toBe('Goedgekeurd: je rijdt dienst 4101 op wo 11/11. Bekijk je rooster.');
      expect(beslis('dienst', half, A).body).toBe('Goedgekeurd: Piet Janssens rijdt dienst 4101 op wo 11/11. Bekijk je rooster.');
      // Zonder dienst als tegenprestatie is één been de hele ruil: dan geen verwijzing.
      expect(beslis('vrij', half, C).body).toBe('Goedgekeurd: je rijdt dienst 4101 op wo 11/11.');
    });

    it('een beweging in de andere richting telt niet als doorvoer', () => {
      for (const wie of [A, C]) expect(beslis('dienst', { ...stap, planning: TERUGGEDRAAID }, wie).body).toBe(NEUTRAAL);
    });

    it('wie in deze ruil aanvrager noch collega is, leest nooit iets over zijn eigen diensten', () => {
      for (const soort of SOORTEN) {
        expect(beslis(soort, stap, 'u-derde').body).toMatch(/^De planning keurde de (ruil|overname) van wo 11\/11 \(dienst 4101\) goed\. Bekijk je rooster\.$/);
      }
      // Aanvrager en collega zijn dezelfde persoon (kan alleen bij kapotte data): ook neutraal.
      expect(ruilBeslisMelding({ ruil: { ...RUIL.dienst, targetDriverId: A }, namen: NAMEN, ...stap }, A).body).toBe(NEUTRAAL);
    });

    it('een ruil zonder aangezochte collega (oude open verzoeken) krijgt de neutrale zin', () => {
      const { targetDriverId: _weg, ...zonderCollega } = RUIL.vrij;
      expect(ruilBeslisMelding({ ruil: zonderCollega, namen: { aanvrager: 'Jan Peeters' }, ...stap }, A).body).toBe(NEUTRAAL);
    });
  });
});

describe('afwijzen, weigeren, intrekken en annuleren: elk zijn woord', () => {
  it('de planning wijst af (titel Afgewezen), voor beide chauffeurs dezelfde zin', () => {
    for (const van of ['pending', 'accepted']) for (const wie of [A, C]) {
      expect(beslis('dienst', { van, naar: 'rejected', doorStaf: true }, wie)).toEqual({
        titel: 'Dienstruil afgewezen',
        body: 'De planning wees de ruil van wo 11/11 (dienst 4101) af.',
      });
    }
    expect(beslis('overname', { van: 'accepted', naar: 'rejected', doorStaf: true }, A).body)
      .toBe('De planning wees de overname van wo 11/11 (dienst 4101) af.');
  });

  it('de collega weigert (titel Geweigerd, niet Afgewezen), met zijn naam', () => {
    expect(beslis('dienst', { van: 'pending', naar: 'rejected', doorStaf: false }, A)).toEqual({
      titel: 'Dienstruil geweigerd',
      body: 'Piet Janssens weigerde de ruil van wo 11/11 (dienst 4101).',
    });
    expect(beslis('overname', { van: 'pending', naar: 'rejected', doorStaf: false }, A).body)
      .toBe('Piet Janssens weigerde de overname van wo 11/11 (dienst 4101).');
  });

  it('de aanvrager trekt in: de collega leest wie en voor welke dag', () => {
    for (const van of ['pending', 'accepted']) {
      expect(beslis('dienst', { van, naar: 'cancelled', doorStaf: false }, C)).toEqual({
        titel: 'Dienstruil geannuleerd',
        body: 'Jan Peeters trok de aanvraag voor wo 11/11 (dienst 4101) in.',
      });
    }
  });

  it('de planning annuleert een ruil die nog niet goedgekeurd was', () => {
    for (const van of ['pending', 'accepted']) for (const wie of [A, C]) {
      expect(beslis('vrij', { van, naar: 'cancelled', doorStaf: true }, wie)).toEqual({
        titel: 'Dienstruil geannuleerd',
        body: 'De planning annuleerde de ruil van wo 11/11 (dienst 4101).',
      });
    }
  });

  it('een afwijzing van een niet-goedgekeurde ruil zegt niets over wie rijdt, ook niet als de route rijen terugzette', () => {
    for (const wie of [A, C]) {
      expect(beslis('dienst', { van: 'accepted', naar: 'rejected', doorStaf: true, planning: TERUGGEDRAAID }, wie).body)
        .toBe('De planning wees de ruil van wo 11/11 (dienst 4101) af.');
    }
  });

  it('de regel "wie besliste" is die van het verloop per persoon (rol van de actor in het log)', () => {
    const LOG_ACTIE: Record<string, string> = {
      accepted: 'Dienstruil geaccepteerd', approved: 'Dienstruil goedgekeurd', rejected: 'Dienstruil afgewezen',
      cancelled: 'Dienstruil geannuleerd', completed: 'Dienstruil voltooid',
    };
    for (const [naar, action] of Object.entries(LOG_ACTIE)) {
      for (const rol of ['chauffeur', 'technieker', 'planner', 'admin']) {
        const [stap] = verloopUitLog([{ createdAt: '2026-11-10T08:00:00Z', action, actorRole: rol, details: `Jan, dienstruil (pending → ${naar}).` }], { metStafNaam: false });
        expect(ruilBeslisser(naar, isStafRol(rol)), `${naar} door ${rol}`).toBe(stap.door);
      }
    }
  });
});

describe('de planning draait een goedgekeurde ruil terug (annuleren of alsnog afwijzen)', () => {
  const stap = (naar: string) => ({ van: 'approved', naar, doorStaf: true, planning: TERUGGEDRAAID });

  it('elk leest welke dienst hij weer zelf rijdt', () => {
    for (const [naar, titel] of [['cancelled', 'Dienstruil geannuleerd'], ['rejected', 'Dienstruil afgewezen']]) {
      expect(beslis('dienst', stap(naar), A)).toEqual({
        titel,
        body: 'De planning draaide de ruil terug: je rijdt dienst 4101 op wo 11/11 weer zelf, Piet Janssens rijdt dienst 4205 op vr 13/11.',
      });
      expect(beslis('dienst', stap(naar), C)).toEqual({
        titel,
        body: 'De planning draaide de ruil terug: je rijdt dienst 4205 op vr 13/11 weer zelf, Jan Peeters rijdt dienst 4101 op wo 11/11.',
      });
    }
    expect(beslis('zelfdeDag', stap('cancelled'), A).body)
      .toBe('De planning draaide de ruil terug: je rijdt dienst 4101 op wo 11/11 weer zelf, Piet Janssens rijdt dienst 4205.');
  });

  it('vrije dag of overname: de aanvrager rijdt zijn dienst weer zelf, de collega leest dat hij ze kwijt is', () => {
    expect(beslis('vrij', stap('cancelled'), A).body).toBe('De planning draaide de ruil terug: je rijdt dienst 4101 op wo 11/11 weer zelf.');
    expect(beslis('vrij', stap('cancelled'), C).body).toBe('De planning draaide de ruil terug: Jan Peeters rijdt dienst 4101 op wo 11/11 weer zelf.');
    expect(beslis('overname', stap('cancelled'), A).body).toBe('De planning draaide de overname terug: je rijdt dienst 4101 op wo 11/11 weer zelf.');
    expect(beslis('overname', stap('cancelled'), C).body).toBe('De planning draaide de overname terug: Jan Peeters rijdt dienst 4101 op wo 11/11 weer zelf.');
  });

  it('niets aantoonbaar teruggezet: geen zin over wie rijdt, wel de verwijzing naar het rooster', () => {
    for (const planning of [null, DOORGEVOERD, { richting: 'teruggedraaid', benen: { aangeboden: false, terug: false } } as const]) {
      for (const wie of [A, C, 'u-derde']) {
        expect(beslis('dienst', { ...stap('cancelled'), planning }, wie).body)
          .toBe('De planning draaide de goedgekeurde ruil van wo 11/11 (dienst 4101) terug. Bekijk je rooster.');
      }
    }
  });

  it('alleen één been teruggezet: wat vaststaat, met de verwijzing naar het rooster', () => {
    const half = { ...stap('cancelled'), planning: { richting: 'teruggedraaid', benen: { aangeboden: true, terug: false } } as const };
    expect(beslis('dienst', half, A).body).toBe('De planning draaide de ruil terug: je rijdt dienst 4101 op wo 11/11 weer zelf. Bekijk je rooster.');
    expect(beslis('dienst', half, C).body).toBe('De planning draaide de ruil terug: Jan Peeters rijdt dienst 4101 op wo 11/11 weer zelf. Bekijk je rooster.');
  });
});

describe('ontbrekende gegevens: een kortere, juiste zin', () => {
  const ZONDER_NAMEN = { aanvrager: '', collega: null };

  it('zonder namen: "een collega" of "je collega", nooit een lege plek of een id', () => {
    expect(ruilAanvraagMelding(RUIL.dienst, ZONDER_NAMEN).body)
      .toBe('Een collega vraagt een ruil: jij krijgt dienst 4101 op wo 11/11, in ruil voor jouw dienst 4205 op vr 13/11.');
    expect(ruilAanvraagMelding(RUIL.overname).body).toBe('Een collega vraagt of je dienst 4101 van wo 11/11 wil overnemen, zonder tegenprestatie.');
    expect(beslis('dienst', { van: 'pending', naar: 'accepted', doorStaf: false }, A, ZONDER_NAMEN as never).body)
      .toBe('Je collega accepteerde je ruil van wo 11/11 (dienst 4101), de planning moet nog goedkeuren.');
    expect(beslis('dienst', { van: 'accepted', naar: 'approved', doorStaf: true, planning: DOORGEVOERD }, C, ZONDER_NAMEN as never).body)
      .toBe('Goedgekeurd: je rijdt dienst 4101 op wo 11/11, je collega rijdt dienst 4205 op vr 13/11.');
    expect(beslis('vrij', { van: 'accepted', naar: 'approved', doorStaf: true, planning: DOORGEVOERD }, A, ZONDER_NAMEN as never).body)
      .toBe('Goedgekeurd: je bent vrij op wo 11/11, je collega rijdt dienst 4101.');
    expect(beslis('dienst', { van: 'pending', naar: 'rejected', doorStaf: false }, A, ZONDER_NAMEN as never).body)
      .toBe('Je collega weigerde de ruil van wo 11/11 (dienst 4101).');
    expect(beslis('dienst', { van: 'pending', naar: 'cancelled', doorStaf: false }, C, ZONDER_NAMEN as never).body)
      .toBe('Je collega trok de aanvraag voor wo 11/11 (dienst 4101) in.');
    expect(ruilValidatieMelding(RUIL.dienst, ZONDER_NAMEN).body)
      .toBe('De collega accepteerde de ruil: dienst 4101 op wo 11/11 tegen dienst 4205 op vr 13/11. Rij- en rusttijden checken.');
  });

  it('zonder dienst-info (aanvraag van vóór de dienstgegevens op de ruil): de zin noemt alleen wat er is', () => {
    const { shiftDate: _d, shiftLine: _l, ...oud } = RUIL.vrij;
    expect(ruilAanvraagMelding(oud, NAMEN)).toEqual({ titel: 'Nieuwe dienstruil-aanvraag', body: 'Jan Peeters wil een dienst met je ruilen.' });
    expect(ruilAanvraagMelding({ ...oud, swapType: 'overname' }, NAMEN).body).toBe('Jan Peeters vraagt of je een dienst wil overnemen, zonder tegenprestatie.');
    expect(ruilValidatieMelding(oud, NAMEN).body).toBe('Piet Janssens accepteerde de ruil van Jan Peeters, rij- en rusttijden checken.');
    const stap = (naar: string, doorStaf: boolean, van = 'pending') => ruilBeslisMelding({ ruil: oud, namen: NAMEN, van, naar, doorStaf }, A).body;
    expect(stap('accepted', false)).toBe('Piet Janssens accepteerde je ruil, de planning moet nog goedkeuren.');
    expect(stap('approved', true, 'accepted')).toBe('De planning keurde de ruil goed. Bekijk je rooster.');
    expect(stap('rejected', true)).toBe('De planning wees de ruil af.');
    expect(stap('rejected', false)).toBe('Piet Janssens weigerde de ruil.');
    expect(stap('cancelled', true)).toBe('De planning annuleerde de ruil.');
    expect(stap('cancelled', true, 'approved')).toBe('De planning draaide de goedgekeurde ruil terug. Bekijk je rooster.');
    expect(ruilBeslisMelding({ ruil: oud, namen: NAMEN, van: 'pending', naar: 'cancelled', doorStaf: false }, C).body).toBe('Jan Peeters trok de aanvraag in.');
    expect(ruilBeslisMelding({ ruil: { ...oud, swapType: 'overname' }, namen: NAMEN, van: 'pending', naar: 'accepted', doorStaf: false }, A).body)
      .toBe('Piet Janssens wil je dienst overnemen, de planning moet nog goedkeuren.');
  });

  it('alleen de dag of alleen het dienstnummer: de zin noemt wat er is', () => {
    const alleenDag = { ...RUIL.vrij, shiftLine: '  ' };
    const alleenDienst = { ...RUIL.vrij, shiftDate: undefined };
    const wijsAf = (ruil: RuilVoorMelding) => ruilBeslisMelding({ ruil, namen: NAMEN, van: 'pending', naar: 'rejected', doorStaf: true }, A).body;
    expect(wijsAf(alleenDag)).toBe('De planning wees de ruil van wo 11/11 af.');
    expect(wijsAf(alleenDienst)).toBe('De planning wees de ruil voor dienst 4101 af.');
    expect(ruilBeslisMelding({ ruil: alleenDienst, namen: NAMEN, van: 'pending', naar: 'cancelled', doorStaf: false }, C).body)
      .toBe('Jan Peeters trok de aanvraag voor dienst 4101 in.');
    // Zonder beide is er niets wat de collega aantoonbaar krijgt: de korte aanvraag.
    expect(ruilAanvraagMelding(alleenDag, NAMEN).body).toBe('Jan Peeters wil een dienst met je ruilen.');
  });

  it('een dag die niet bestaat valt uit de zin, de rest blijft staan', () => {
    const kapot = { ...RUIL.dienst, shiftDate: '2026-02-30' };
    expect(ruilAanvraagMelding(kapot, NAMEN).body).toBe('Jan Peeters vraagt een ruil: jij krijgt dienst 4101, in ruil voor jouw dienst 4205 op vr 13/11.');
    expect(ruilBeslisMelding({ ruil: kapot, namen: NAMEN, van: 'accepted', naar: 'approved', doorStaf: true, planning: DOORGEVOERD }, C).body)
      .toBe('Goedgekeurd: je rijdt dienst 4101, Jan Peeters rijdt dienst 4205 op vr 13/11.');
    // Zonder de dag van de dienst geen "je bent vrij op …": wel wie de dienst rijdt.
    expect(ruilBeslisMelding({ ruil: { ...RUIL.overname, shiftDate: '2026-02-30' }, namen: NAMEN, van: 'accepted', naar: 'approved', doorStaf: true, planning: DOORGEVOERD }, A).body)
      .toBe('Goedgekeurd: Piet Janssens rijdt dienst 4101.');
  });

  it('een ruil zonder tegenprestatie op het record noemt er geen', () => {
    const { returnDate: _d, returnCode: _c, ...zonder } = RUIL.dienst;
    expect(ruilAanvraagMelding(zonder, NAMEN).body).toBe('Jan Peeters vraagt een ruil: jij krijgt dienst 4101 op wo 11/11.');
    expect(ruilAanvraagMelding({ ...zonder, returnCode: '4205' }, NAMEN).body).toBe('Jan Peeters vraagt een ruil: jij krijgt dienst 4101 op wo 11/11.');
    expect(ruilValidatieMelding(zonder, NAMEN).body).toBe('Piet Janssens accepteerde de ruil van Jan Peeters: dienst 4101 op wo 11/11. Rij- en rusttijden checken.');
  });

  it('afhandelen (gaat vandaag naar niemand) en een status die de bouwer niet kent: een algemene zin, zonder het statuswoord', () => {
    expect(beslis('dienst', { van: 'approved', naar: 'completed', doorStaf: true }, A)).toEqual({
      titel: 'Dienstruil afgehandeld', body: 'De planning handelde de ruil van wo 11/11 (dienst 4101) af.',
    });
    expect(beslis('dienst', { van: 'accepted', naar: 'on_hold', doorStaf: true }, A)).toEqual({
      titel: 'Dienstruil bijgewerkt', body: 'Er is een wijziging aan de ruil van wo 11/11 (dienst 4101).',
    });
  });

  it('gooit nooit: een fout in de tekst geeft de algemene melding, geen mislukte beslissing', () => {
    const stil = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stuk = { get requesterId(): string { throw new Error('stuk'); } } as RuilVoorMelding;
    expect(ruilAanvraagMelding(stuk, NAMEN)).toEqual({ titel: 'Nieuwe dienstruil-aanvraag', body: 'Een collega vraagt je een dienstruil. Open de aanvraag om ze te bekijken.' });
    expect(ruilValidatieMelding(stuk, NAMEN)).toEqual({ titel: 'Dienstruil wacht op validatie', body: 'Een collega accepteerde een dienstruil, rij- en rusttijden checken.' });
    expect(ruilBeslisMelding({ ruil: stuk, van: 'accepted', naar: 'approved', doorStaf: true }, A))
      .toEqual({ titel: 'Dienstruil bijgewerkt', body: 'Er is beslist over een dienstruil waar je bij betrokken bent. Open de ruil om ze te bekijken.' });
    expect(dienstToegewezenTekst({ dienst: '12', datum: '2026-11-13', delen: [{ get startTime(): string { throw new Error('stuk'); } }] }))
      .toBe('Je kreeg een dienst toegewezen. Bekijk je rooster.');
    expect(stil).toHaveBeenCalledTimes(4);
    stil.mockRestore();
  });
});

describe('geen enkele tekst lekt iets wat een chauffeur niet hoort te lezen', () => {
  const VERBODEN: Array<[string, RegExp]> = [
    ['een intern statuswoord', /\b(pending|accepted|approved|rejected|completed|cancelled|on_hold)\b/i],
    ['een pijl', /→|->|⇄/],
    ['undefined, null of een object', /undefined|null|NaN|\[object/i],
    ['lege haakjes', /\(\s*\)/],
    ['een em dash', /—/],
    ['een rauwe ISO-datum', /\d{4}-\d{2}-\d{2}/],
    ['een dienst zonder nummer', /\bdienst\s*(?:[-,.)]|$)/],
    ['een dubbele spatie of spatie voor een leesteken', / {2}| [,.:]/],
    ['een onbekende gebruiker met id', /Onbekende gebruiker|u-aanvrager|u-collega/],
  ];

  const RUILEN: RuilVoorMelding[] = [
    ...Object.values(RUIL),
    { ...RUIL.vrij, returnCode: 'vrij', returnDate: '2026-11-11' },
    { ...RUIL.dienst, shiftDate: undefined },
    { ...RUIL.dienst, shiftLine: null },
    { ...RUIL.dienst, shiftDate: '2026-02-30', returnDate: 'gisteren' },
    { ...RUIL.dienst, returnDate: undefined },
    { ...RUIL.dienst, returnCode: '' },
    { ...RUIL.dienst, targetDriverId: undefined },
    { ...RUIL.dienst, targetDriverId: A },
    { ...RUIL.dienst, shiftLine: {}, returnCode: ['x'] },
    { requesterId: 3, targetDriverId: 4, shiftDate: '2026-11-11', shiftLine: 12, swapType: 'OVERNAME' },
    { requesterId: A },
    {},
  ];
  const NAMEN_VARIANTEN = [NAMEN, {}, { aanvrager: '  ', collega: undefined }, undefined];
  const STANDEN: Array<RuilPlanningStand | null | undefined> = [null, undefined];
  for (const richting of ['doorgevoerd', 'teruggedraaid'] as const) {
    for (const aangeboden of [true, false]) for (const terug of [true, false]) STANDEN.push({ richting, benen: { aangeboden, terug } });
  }
  const STATUSSEN = ['pending', 'accepted', 'approved', 'rejected', 'cancelled', 'completed', 'on_hold'];
  const ONTVANGERS = [A, C, 'u-derde', '3', '', undefined];

  /** Wat er aan één tekst schort; leeg = in orde. Zonder `expect` per regel:
   *  het net hieronder loopt over meer dan honderdduizend combinaties. */
  const gebreken = (waar: string, tekst: { titel: string; body: string }): string[] => {
    const uit: string[] = [];
    for (const veld of [tekst.titel, tekst.body]) {
      if (typeof veld !== 'string' || veld.trim() === '') uit.push(`${waar}: lege titel of tekst`);
      for (const [naam, patroon] of VERBODEN) if (patroon.test(String(veld))) uit.push(`${waar}: ${naam} in “${veld}”`);
    }
    if (!/\.$/.test(tekst.body)) uit.push(`${waar}: geen punt aan het einde van “${tekst.body}”`);
    return uit;
  };

  it('elke aanvraag en elke validatie, met en zonder gegevens', () => {
    const fouten: string[] = [];
    for (const ruil of RUILEN) for (const namen of NAMEN_VARIANTEN) {
      fouten.push(...gebreken('aanvraag', ruilAanvraagMelding(ruil, namen)));
      fouten.push(...gebreken('validatie', ruilValidatieMelding(ruil, namen)));
    }
    expect(fouten).toEqual([]);
  });

  it('elke beslissing: soort ruil × overgang × beslisser × stand van de planning × ontvanger × namen', () => {
    const fouten: string[] = [];
    let aantal = 0;
    for (const ruil of RUILEN) for (const namen of NAMEN_VARIANTEN) for (const van of STATUSSEN) for (const naar of STATUSSEN) {
      for (const doorStaf of [true, false]) for (const planning of STANDEN) for (const ontvanger of ONTVANGERS) {
        const tekst = ruilBeslisMelding({ ruil, namen, van, naar, doorStaf, planning }, ontvanger);
        aantal++;
        if (fouten.length > 20) continue;
        fouten.push(...gebreken(`${van} naar ${naar}`, tekst));
        // Een zin over de eigen dienst vraagt een beweging in de planning, in
        // de richting van de stap, en een ontvanger die in de ruil zit.
        if (!/je rijdt|je bent vrij|weer zelf/.test(tekst.body)) continue;
        const verwacht = naar === 'approved' ? 'doorgevoerd' : 'teruggedraaid';
        const aangetoond = planning?.richting === verwacht && (planning.benen.aangeboden || planning.benen.terug);
        const inDeRuil = ontvanger !== '' && ontvanger !== undefined
          && [String(ruil.requesterId ?? ''), String(ruil.targetDriverId ?? '')].includes(String(ontvanger));
        const magTerugdraaien = verwacht !== 'teruggedraaid' || (van === 'approved' && doorStaf && (naar === 'rejected' || naar === 'cancelled'));
        if (!aangetoond || !inDeRuil || !magTerugdraaien) {
          fouten.push(`${van} naar ${naar}, staf ${doorStaf}, planning ${JSON.stringify(planning)}, ontvanger ${String(ontvanger)}: “${tekst.body}” zonder grond`);
        }
      }
    }
    expect(fouten).toEqual([]);
    expect(aantal).toBeGreaterThan(100_000);
  });

  it('met gewone namen blijft elke tekst onder 160 tekens', () => {
    for (const soort of SOORTEN) {
      const teksten = [ruilAanvraagMelding(RUIL[soort], NAMEN), ruilValidatieMelding(RUIL[soort], NAMEN)];
      for (const van of STATUSSEN) for (const naar of STATUSSEN) for (const doorStaf of [true, false]) for (const planning of STANDEN) for (const wie of [A, C, 'u-derde']) {
        teksten.push(ruilBeslisMelding({ ruil: RUIL[soort], namen: NAMEN, van, naar, doorStaf, planning }, wie));
      }
      for (const t of teksten) expect(t.body.length, t.body).toBeLessThanOrEqual(160);
    }
  });
});

describe('meldingenPerTekst: per ontvanger een eigen tekst, zonder de lijst van ontvangers te wijzigen', () => {
  it('wie dezelfde tekst krijgt gaat samen, wie een eigen tekst krijgt apart, in de volgorde van de lijst', () => {
    const eigen = meldingenPerTekst([A, C], (id) => ({ titel: 'Dienstruil goedgekeurd', body: `voor ${id}` }));
    expect(eigen).toEqual([
      { titel: 'Dienstruil goedgekeurd', body: `voor ${A}`, userIds: [A] },
      { titel: 'Dienstruil goedgekeurd', body: `voor ${C}`, userIds: [C] },
    ]);
    expect(meldingenPerTekst([A, C], () => ({ titel: 'Dienstruil afgewezen', body: 'zelfde' }))).toEqual([{ titel: 'Dienstruil afgewezen', body: 'zelfde', userIds: [A, C] }]);
  });

  it('elke ontvanger precies één keer: dubbele en lege id\'s tellen niet, en zonder ontvangers is er niets te versturen', () => {
    const groepen = meldingenPerTekst([A, '', C, A, null, undefined, 4], (id) => ({ titel: 't', body: id === C ? 'anders' : 'zelfde' }));
    expect(groepen).toEqual([{ titel: 't', body: 'zelfde', userIds: [A, '4'] }, { titel: 't', body: 'anders', userIds: [C] }]);
    expect(groepen.flatMap((g) => g.userIds).sort()).toEqual([A, C, '4'].sort());
    expect(meldingenPerTekst([], () => { throw new Error('niet aanroepen'); })).toEqual([]);
    expect(meldingenPerTekst(['', null], () => { throw new Error('niet aanroepen'); })).toEqual([]);
  });

  it('een goedkeuring geeft twee teksten, een afwijzing door de planning één', () => {
    const goed = meldingenPerTekst([A, C], (id) => beslis('dienst', { van: 'accepted', naar: 'approved', doorStaf: true, planning: DOORGEVOERD }, id));
    expect(goed.map((g) => g.userIds)).toEqual([[A], [C]]);
    const af = meldingenPerTekst([A, C], (id) => beslis('dienst', { van: 'accepted', naar: 'rejected', doorStaf: true }, id));
    expect(af.map((g) => g.userIds)).toEqual([[A, C]]);
  });
});

describe('dienst toegewezen: weekdag, datum en de uren van elk deel', () => {
  const vr = '2026-11-13';

  it('noemt de uren van de dienst, met een en-dash zonder spaties', () => {
    expect(dienstToegewezenTekst({ dienst: '2116', datum: vr, delen: [{ startTime: '06:45', endTime: '14:30' }] }))
      .toBe('Je rijdt dienst 2116 op vr 13/11: 06:45–14:30.');
  });

  it('noemt alle delen van een gesplitste dienst', () => {
    expect(dienstToegewezenTekst({ dienst: '2116', datum: vr, delen: [{ startTime: '06:45', endTime: '10:00' }, { startTime: '15:45', endTime: '19:35' }] }))
      .toBe('Je rijdt dienst 2116 op vr 13/11: 06:45–10:00 en 15:45–19:35.');
    expect(dienstToegewezenTekst({ dienst: 2116, datum: vr, delen: [{ startTime: '05:10', endTime: '08:00' }, { startTime: '10:00', endTime: '12:30' }, { startTime: '15:45', endTime: '19:35' }] }))
      .toBe('Je rijdt dienst 2116 op vr 13/11: 05:10–08:00, 10:00–12:30 en 15:45–19:35.');
  });

  it('de echte blokken van het dienstoverzicht: wat de route in de planning zet, staat volledig in de tekst', () => {
    // Zoals wijsDienstToeIntern: de blokken van getServiceSegments worden de
    // planning-rijen, en diezelfde rijen gaan naar de tekst.
    const rijen = (dienst: Record<string, string>) =>
      getServiceSegments({ id: 'd', ...dienst } as never).map((s) => ({ date: vr, line: dienst.serviceNumber, startTime: s.startTime, endTime: s.endTime, loopnr: s.loopnr }));
    const gesplitst = rijen({ serviceNumber: '2116', startTime: '06:45', endTime: '10:00', startTime2: '15:45', endTime2: '19:35' });
    expect(gesplitst).toHaveLength(2);
    expect(dienstToegewezenTekst({ dienst: '2116', datum: vr, delen: gesplitst })).toBe('Je rijdt dienst 2116 op vr 13/11: 06:45–10:00 en 15:45–19:35.');
    const drieDelen = rijen({ serviceNumber: '2101', startTime: '06:15', endTime: '09:05', startTime2: '12:10', endTime2: '14:30', startTime3: '16:00', endTime3: '18:45' });
    expect(drieDelen).toHaveLength(3);
    expect(dienstToegewezenTekst({ dienst: '2101', datum: vr, delen: drieDelen })).toBe('Je rijdt dienst 2101 op vr 13/11: 06:15–09:05, 12:10–14:30 en 16:00–18:45.');
  });

  it('schrijft een uur zonder voorloopnul voluit en laat de busvak-notatie na middernacht staan', () => {
    expect(dienstToegewezenTekst({ dienst: '12', datum: vr, delen: [{ startTime: '6:45', endTime: '9:05' }, { startTime: '22:10', endTime: '26:16' }] }))
      .toBe('Je rijdt dienst 12 op vr 13/11: 06:45–09:05 en 22:10–26:16.');
  });

  it('één onleesbaar deel: geen halve lijst, wel de verwijzing naar het rooster', () => {
    for (const delen of [
      [{ startTime: '06:45', endTime: '10:00' }, { startTime: '', endTime: '19:35' }],
      [{ startTime: '06:45', endTime: '99:00' }],
      [{ startTime: undefined, endTime: null }],
      [{}],
      [],
    ]) {
      expect(dienstToegewezenTekst({ dienst: '2116', datum: vr, delen })).toBe('Je rijdt dienst 2116 op vr 13/11. Bekijk je rooster.');
    }
  });

  it('zonder leesbare dag of zonder dienstnummer blijft de zin juist', () => {
    const delen = [{ startTime: '06:45', endTime: '10:00' }];
    expect(dienstToegewezenTekst({ dienst: '2116', datum: '2026-02-30', delen })).toBe('Je rijdt dienst 2116: 06:45–10:00.');
    expect(dienstToegewezenTekst({ dienst: '', datum: vr, delen })).toBe('Je rijdt een dienst op vr 13/11: 06:45–10:00.');
    expect(dienstToegewezenTekst({ dienst: null, datum: null, delen: [] })).toBe('Je rijdt een dienst. Bekijk je rooster.');
  });
});
