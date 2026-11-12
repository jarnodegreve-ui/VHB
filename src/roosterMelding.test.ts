// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const pushes: Array<{ ids: string[]; payload: any }> = [];
/** Wat een verzending doet nadat ze genoteerd is; null = meteen klaar. */
let pushGedrag: null | ((ids: string[]) => Promise<void>) = null;
vi.mock('../api/_lib/push.js', () => ({
  sendPushToUsers: async (ids: string[], payload: any) => {
    pushes.push({ ids, payload });
    if (pushGedrag) await pushGedrag(ids);
  },
}));

const {
  ROOSTER_GELIJKTIJDIG, ROOSTER_TEKST_MAX, gewijzigdeDagen, gewijzigdeDagenPerChauffeur, importPushTekst, roosterAfdrukken, roosterDagAfdrukken, roosterPushTekst, verstuurRoosterPushes,
} = await import('../api/_lib/roosterMelding');

const rij = (driverId: string, date: string, line: string, startTime = '06:00', endTime = '14:00') => ({ driverId, date, line, startTime, endTime, loopnr: '1', busNumber: '' });

/**
 * Gerichte roostermeldingen (09-10): de melding noemt de gewijzigde dag of
 * dagen en gaat alleen naar wie echt iets ziet veranderen.
 */
describe('roosterDagAfdrukken en gewijzigdeDagen', () => {
  it('een andere tijd op één dag geeft alleen die dag, en alleen bij die chauffeur', () => {
    const oud = roosterDagAfdrukken([rij('3', '2026-10-14', '12'), rij('3', '2026-10-15', '12'), rij('4', '2026-10-14', '14')]);
    const nieuw = roosterDagAfdrukken([rij('3', '2026-10-14', '12', '06:30'), rij('3', '2026-10-15', '12'), rij('4', '2026-10-14', '14')]);
    expect(gewijzigdeDagenPerChauffeur(oud, nieuw)).toEqual(new Map([['3', ['2026-10-14']]]));
  });

  it('een dag erbij of weg telt als gewijzigd, ook bij een chauffeur die geen diensten meer heeft', () => {
    const oud = roosterDagAfdrukken([rij('3', '2026-10-14', '12'), rij('4', '2026-10-16', '14')]);
    const nieuw = roosterDagAfdrukken([rij('3', '2026-10-14', '12'), rij('3', '2026-10-17', '12')]);
    expect(gewijzigdeDagenPerChauffeur(oud, nieuw)).toEqual(new Map([['3', ['2026-10-17']], ['4', ['2026-10-16']]]));
    expect(gewijzigdeDagen(undefined, undefined)).toEqual([]);
  });

  it('de volgorde van de rijen en een gesplitste dienst maken geen verschil', () => {
    const a = roosterDagAfdrukken([rij('3', '2026-10-14', '12', '06:00', '10:00'), rij('3', '2026-10-14', '12', '14:00', '18:00')]);
    const b = roosterDagAfdrukken([rij('3', '2026-10-14', '12', '14:00', '18:00'), rij('3', '2026-10-14', '12', '06:00', '10:00')]);
    expect(a.get('3')).toEqual(b.get('3'));
    expect(gewijzigdeDagen(a.get('3'), b.get('3'))).toEqual([]);
  });

  it('de afdruk van een dag ligt vast: een wachtrij die bij een deploy klaarstaat draagt deze afdrukken', () => {
    // Onafhankelijk nagerekend (sha256 van de gesorteerde dienstsleutels, 16
    // tekens). Verschuift deze waarde, dan krijgt iedereen die op dat moment
    // in de wachtrij staat een melding over dagen waarop niets veranderde.
    const rijen = [
      { driverId: '3', date: '2026-11-13', line: '2116', startTime: '15:45', endTime: '19:35', loopnr: '4502', busNumber: '' },
      { driverId: '3', date: '2026-11-13', line: '2116', startTime: '06:45', endTime: '10:00', loopnr: '4501', busNumber: '' },
    ];
    expect(roosterDagAfdrukken(rijen)).toEqual(new Map([['3', { '2026-11-13': '1333bb39610e36d5' }]]));
    expect(roosterAfdrukken(rijen)).toEqual(new Map([['3', '1333bb39610e36d5e3f14810df360b37']]));
  });

  it('de oude afdruk van het hele rooster blijft stabiel (wachtrij van vóór 09-10)', () => {
    const rows = [rij('3', '2026-10-14', '12'), rij('3', '2026-10-15', '12')];
    expect(roosterAfdrukken(rows).get('3')).toHaveLength(32);
    expect(roosterAfdrukken(rows).get('3')).toBe(roosterAfdrukken([...rows].reverse()).get('3'));
  });
});

// Vrijdag 13/11/2026 en de dagen erna; de weekdag is gerekend (dagKort).
const VR = '2026-11-13';
const ZA = '2026-11-14';
const MA = '2026-11-16';
const deel = (date: string, line: unknown, startTime: unknown, endTime: unknown) => ({ driverId: '3', date, line, startTime, endTime, loopnr: '1', busNumber: '' });

describe('roosterPushTekst, alleen de dagen (de aanroeper kent de stand niet zeker)', () => {
  it('noemt tot drie dagen bij naam met de korte weekdag, daarboven het aantal met de eerste en de laatste dag', () => {
    expect(roosterPushTekst([])).toBe('Je rooster is gewijzigd, bekijk je diensten.');
    expect(roosterPushTekst([VR])).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
    expect(roosterPushTekst([ZA, VR])).toBe('Je rooster is gewijzigd op vr 13/11 en za 14/11. Bekijk je diensten.');
    expect(roosterPushTekst([VR, ZA, MA])).toBe('Je rooster is gewijzigd op vr 13/11, za 14/11 en ma 16/11. Bekijk je diensten.');
    expect(roosterPushTekst([VR, ZA, MA, '2026-11-19', '2026-11-17'])).toBe('Je rooster is gewijzigd op 5 dagen tussen vr 13/11 en do 19/11. Bekijk je diensten.');
    // null is hetzelfde als weglaten: geen stand bekend.
    expect(roosterPushTekst([VR], null)).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
  });

  it('een dag die geen echte kalenderdag is heeft geen korte vorm: dan de zin van vroeger, met of zonder rijen', () => {
    expect(roosterPushTekst(['2026-02-30'])).toBe('Je rooster is gewijzigd op 30/02/2026. Bekijk je diensten.');
    expect(roosterPushTekst(['2026-02-30', VR], [deel(VR, '2116', '06:45', '10:00')])).toBe('Je rooster is gewijzigd op 30/02/2026 en 13/11/2026. Bekijk je diensten.');
    expect(roosterPushTekst(['2026-02-30', VR, ZA, MA])).toBe('Je rooster is gewijzigd op 4 dagen tussen 30/02/2026 en 16/11/2026. Bekijk je diensten.');
  });
});

describe('roosterPushTekst, met de nieuwe stand (ronde 6, punt 11 stap 2)', () => {
  it('één gewijzigde dag met één dienst: dag, dienstnummer en uren', () => {
    expect(roosterPushTekst([VR], [deel(VR, '2116', '06:45', '14:30')])).toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116, 06:45–14:30.');
    // Een nummer als getal en een uur in een andere schrijfwijze (ook een busvak-uur boven 24).
    expect(roosterPushTekst([VR], [deel(VR, 12, '6:45', '26.16')])).toBe('Je rooster is gewijzigd op vr 13/11: dienst 12, 06:45–26:16.');
  });

  it('een gesplitste dienst noemt alle delen, op starttijd, in welke volgorde de rijen ook komen', () => {
    const delen = [deel(VR, '2116', '15:45', '19:35'), deel(VR, '2116', '06:45', '10:00')];
    expect(roosterPushTekst([VR], delen)).toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116, 06:45–10:00 en 15:45–19:35.');
    expect(roosterPushTekst([VR], [...delen].reverse())).toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116, 06:45–10:00 en 15:45–19:35.');
    expect(roosterPushTekst([VR], [deel(VR, '2101', '16:00', '18:45'), deel(VR, '2101', '06:15', '09:05'), deel(VR, '2101', '12:10', '14:30')]))
      .toBe('Je rooster is gewijzigd op vr 13/11: dienst 2101, 06:15–09:05, 12:10–14:30 en 16:00–18:45.');
  });

  it('twee diensten op één dag: allebei, met "en", de vroegste eerst', () => {
    expect(roosterPushTekst([VR], [deel(VR, '4101', '15:45', '19:35'), deel(VR, '2116', '06:45', '10:00')]))
      .toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116, 06:45–10:00 en dienst 4101, 15:45–19:35.');
    // De eerste gesplitst: de delen blijven bij hun dienst.
    expect(roosterPushTekst([VR], [deel(VR, '4101', '15:45', '19:35'), deel(VR, '2116', '10:00', '12:30'), deel(VR, '2116', '05:10', '08:00')]))
      .toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116, 05:10–08:00 en 10:00–12:30 en dienst 4101, 15:45–19:35.');
  });

  it('een dag zonder rijen: geen dienst meer in de planning, nooit "vrij"', () => {
    const zin = roosterPushTekst([VR], []);
    expect(zin).toBe('Je rooster is gewijzigd op vr 13/11: je hebt die dag geen dienst meer in de planning. Bekijk je rooster.');
    expect(zin.toLowerCase()).not.toContain('vrij');
    // Rijen op een andere dag veranderen daar niets aan.
    expect(roosterPushTekst([VR], [deel(ZA, '2116', '06:45', '10:00')])).toBe(zin);
  });

  it('een uur dat niet te lezen is: de uren vallen weg en de zin verwijst naar het rooster', () => {
    for (const [van, tot] of [['', '10:00'], ['06:45', null], ['later', '10:00'], ['48:00', '49:00'], [undefined, undefined]] as const) {
      expect(roosterPushTekst([VR], [deel(VR, '2116', van, tot)])).toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116. Bekijk je rooster.');
    }
    // Eén onleesbaar deel van een gesplitste dienst: geen halve lijst.
    expect(roosterPushTekst([VR], [deel(VR, '2116', '06:45', '10:00'), deel(VR, '2116', '15:45', '')]))
      .toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116. Bekijk je rooster.');
    // Twee diensten waarvan één zonder leesbaar uur: van geen van beide de uren.
    expect(roosterPushTekst([VR], [deel(VR, '2116', '06:45', '10:00'), deel(VR, '4101', '', '')]))
      .toBe('Je rooster is gewijzigd op vr 13/11: diensten 2116 en 4101. Bekijk je rooster.');
  });

  it('twee of drie dagen: per dag kort, alleen het dienstnummer of "geen dienst meer"', () => {
    const rijen = [deel(MA, '4101', '15:45', '19:35'), deel(VR, '2116', '15:45', '19:35'), deel(VR, '2116', '06:45', '10:00')];
    expect(roosterPushTekst([VR, ZA, MA], rijen))
      .toBe('Je rooster is gewijzigd: vr 13/11 dienst 2116, za 14/11 geen dienst meer, ma 16/11 dienst 4101. Bekijk je rooster.');
    expect(roosterPushTekst([VR, MA], rijen)).toBe('Je rooster is gewijzigd: vr 13/11 dienst 2116, ma 16/11 dienst 4101. Bekijk je rooster.');
    // Twee diensten op één van de dagen; een onleesbaar uur doet er in deze vorm niet toe.
    expect(roosterPushTekst([VR, ZA], [deel(VR, '4101', '15:45', '19:35'), deel(VR, '2116', '06:45', '10:00'), deel(ZA, '12', '', '')]))
      .toBe('Je rooster is gewijzigd: vr 13/11 diensten 2116 en 4101, za 14/11 dienst 12. Bekijk je rooster.');
    expect(roosterPushTekst([VR, ZA], [])).toBe('Je rooster is gewijzigd: vr 13/11 geen dienst meer, za 14/11 geen dienst meer. Bekijk je rooster.');
  });

  it('de dagen staan oplopend en elk één keer, hoe ze ook binnenkomen', () => {
    const rijen = [deel(MA, '4101', '15:45', '19:35'), deel(VR, '2116', '06:45', '10:00'), deel(ZA, '12', '08:00', '16:00')];
    expect(roosterPushTekst([MA, VR, ZA, VR, '', MA], rijen))
      .toBe('Je rooster is gewijzigd: vr 13/11 dienst 2116, za 14/11 dienst 12, ma 16/11 dienst 4101. Bekijk je rooster.');
  });

  it('rijen op een dag die niet gewijzigd is staan er niet in', () => {
    const rijen = [deel(VR, '2116', '06:45', '10:00'), deel(ZA, '12', '08:00', '16:00'), deel(MA, '4101', '15:45', '19:35')];
    expect(roosterPushTekst([ZA], rijen)).toBe('Je rooster is gewijzigd op za 14/11: dienst 12, 08:00–16:00.');
    const tweeDagen = roosterPushTekst([VR, MA], rijen);
    expect(tweeDagen).toBe('Je rooster is gewijzigd: vr 13/11 dienst 2116, ma 16/11 dienst 4101. Bekijk je rooster.');
    expect(tweeDagen).not.toContain('14/11');
  });

  it('meer dan drie dagen: het aantal met de eerste en de laatste dag, ook met rijen', () => {
    const dagen = [VR, ZA, MA, '2026-11-17', '2026-11-19'];
    expect(roosterPushTekst(dagen, dagen.map((dag) => deel(dag, '2116', '06:45', '10:00'))))
      .toBe('Je rooster is gewijzigd op 5 dagen tussen vr 13/11 en do 19/11. Bekijk je diensten.');
  });

  it('zonder dagen (een wachtrij van vóór 09-10) blijft de algemene tekst, ook met rijen', () => {
    expect(roosterPushTekst([], [deel(VR, '2116', '06:45', '10:00')])).toBe('Je rooster is gewijzigd, bekijk je diensten.');
  });

  it('de grens van 170 tekens: precies 170 blijft de zin met de stand, één teken meer valt terug op de dagen', () => {
    expect(ROOSTER_TEKST_MAX).toBe(170);
    // Drie dagen met samen elf diensten; het laatste nummer brengt de zin op maat.
    const rijen = (laatste: string) => [
      ...['2101', '2102', '2103', '2104'].map((nr, i) => deel(VR, nr, `0${i}:00`, `0${i}:30`)),
      ...['2201', '2202', '2203', '2204'].map((nr, i) => deel(ZA, nr, `0${i}:00`, `0${i}:30`)),
      ...['2301', '2302', laatste].map((nr, i) => deel(MA, nr, `0${i}:00`, `0${i}:30`)),
    ];
    const zin = (laatste: string) =>
      `Je rooster is gewijzigd: vr 13/11 diensten 2101, 2102, 2103 en 2104, za 14/11 diensten 2201, 2202, 2203 en 2204, ma 16/11 diensten 2301, 2302 en ${laatste}. Bekijk je rooster.`;
    expect(zin('23031')).toHaveLength(170);
    expect(roosterPushTekst([VR, ZA, MA], rijen('23031'))).toBe(zin('23031'));
    expect(zin('230311')).toHaveLength(171);
    expect(roosterPushTekst([VR, ZA, MA], rijen('230311'))).toBe('Je rooster is gewijzigd op vr 13/11, za 14/11 en ma 16/11. Bekijk je diensten.');
  });

  it('één dag met zoveel diensten dat de uren niet passen: eerst zonder uren, dan alleen de dag', () => {
    const nummersVan = (aantal: number) => Array.from({ length: aantal }, (_, i) => String(2101 + i));
    const zes = nummersVan(6).flatMap((nr, i) => [deel(VR, nr, `0${i}:00`, `0${i}:30`), deel(VR, nr, `1${i}:00`, `1${i}:30`)]);
    expect(roosterPushTekst([VR], zes)).toBe('Je rooster is gewijzigd op vr 13/11: diensten 2101, 2102, 2103, 2104, 2105 en 2106. Bekijk je rooster.');
    const veertig = nummersVan(40).map((nr) => deel(VR, nr, '06:00', '07:00'));
    expect(roosterPushTekst([VR], veertig)).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
  });

  it('een rij zonder dienstnummer: over die dag valt niets zeker te zeggen, dus alleen de dagen', () => {
    expect(roosterPushTekst([VR], [deel(VR, '', '06:45', '10:00')])).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
    expect(roosterPushTekst([VR, ZA], [deel(VR, '2116', '06:45', '10:00'), deel(ZA, { nr: 1 }, '06:45', '10:00')]))
      .toBe('Je rooster is gewijzigd op vr 13/11 en za 14/11. Bekijk je diensten.');
    // Een tekst die te lang is voor een nummer wordt niet afgekapt tot een dienst die niet bestaat.
    expect(roosterPushTekst([VR], [deel(VR, 'X'.repeat(40), '06:45', '10:00')])).toBe(`Je rooster is gewijzigd op vr 13/11: dienst ${'X'.repeat(40)}, 06:45–10:00.`);
    expect(roosterPushTekst([VR], [deel(VR, 'X'.repeat(41), '06:45', '10:00')])).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
  });

  it('gooit nooit: bij een fout de zin met alleen de dagen, en als ook die niet lukt de algemene tekst', () => {
    const stil = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const stuk = { driverId: '3', date: VR, line: '2116', get startTime(): string { throw new Error('stuk'); }, endTime: '10:00' };
      expect(roosterPushTekst([VR], [stuk])).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
      expect(roosterPushTekst([VR], [null as never])).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
      expect(roosterPushTekst([VR], 42 as never)).toBe('Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.');
      expect(roosterPushTekst(null as never, [])).toBe('Je rooster is gewijzigd, bekijk je diensten.');
      expect(roosterPushTekst(null as never)).toBe('Je rooster is gewijzigd, bekijk je diensten.');
      expect(stil).toHaveBeenCalled();
    } finally {
      stil.mockRestore();
    }
  });

  it('geen em dash, geen rauwe ISO-datum en geen statuswoord, in geen enkele vorm', () => {
    const rijen = [deel(VR, '2116', '06:45', '10:00'), deel(VR, '2116', '15:45', '19:35'), deel(MA, '4101', '15:45', '19:35')];
    const zinnen = [
      roosterPushTekst([]), roosterPushTekst([VR]), roosterPushTekst([VR, ZA, MA, '2026-11-17']),
      roosterPushTekst([VR], rijen), roosterPushTekst([ZA], rijen), roosterPushTekst([VR, ZA, MA], rijen),
      roosterPushTekst([VR], [deel(VR, '2116', '', '')]),
    ];
    for (const zin of zinnen) {
      expect(zin).not.toContain('—');
      expect(zin).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(zin).not.toMatch(/approved|pending|rejected|accepted|vrij\b/i);
      expect(zin.length).toBeLessThanOrEqual(170);
    }
  });
});

describe('importPushTekst', () => {
  it('een verse periode zegt dat de planning klaarstaat, ongewijzigd en ook met rijen', () => {
    const vers = 'Je planning van 01/11/2026 t/m 30/11/2026 staat klaar. Bekijk je rooster.';
    expect(importPushTekst({ hadDiensten: false, dagen: ['2026-11-02'], van: '2026-11-01', tot: '2026-11-30' })).toBe(vers);
    expect(importPushTekst({ hadDiensten: false, dagen: [VR], van: '2026-11-01', tot: '2026-11-30', rijen: [deel(VR, '2116', '06:45', '10:00')] })).toBe(vers);
    expect(importPushTekst({ hadDiensten: false, dagen: [VR], van: null, tot: null })).toBe('Je planning staat klaar. Bekijk je rooster.');
  });

  it('wie al diensten had hoort de dagen, en met de rijen ook wat er nu staat', () => {
    expect(importPushTekst({ hadDiensten: true, dagen: ['2026-11-02'], van: '2026-11-01', tot: '2026-11-30' })).toBe('Je rooster is gewijzigd op ma 02/11. Bekijk je diensten.');
    expect(importPushTekst({ hadDiensten: true, dagen: [VR], van: '2026-11-01', tot: '2026-11-30', rijen: [deel(VR, '2116', '06:45', '10:00')] }))
      .toBe('Je rooster is gewijzigd op vr 13/11: dienst 2116, 06:45–10:00.');
    expect(importPushTekst({ hadDiensten: true, dagen: [VR], van: '2026-11-01', tot: '2026-11-30', rijen: [] }))
      .toBe('Je rooster is gewijzigd op vr 13/11: je hebt die dag geen dienst meer in de planning. Bekijk je rooster.');
  });
});

describe('verstuurRoosterPushes', () => {
  it('zonder rijen: bundelt chauffeurs met dezelfde tekst in één verzending en telt de chauffeurs', async () => {
    pushes.length = 0;
    const aantal = await verstuurRoosterPushes(new Map([['3', ['2026-10-14']], ['4', ['2026-10-14']], ['5', ['2026-10-15']]]));
    expect(aantal).toBe(3);
    expect(pushes.map((p) => [p.ids, p.payload.body])).toEqual([
      [['3', '4'], 'Je rooster is gewijzigd op wo 14/10. Bekijk je diensten.'],
      [['5'], 'Je rooster is gewijzigd op do 15/10. Bekijk je diensten.'],
    ]);
    expect(pushes[0].payload).toMatchObject({ title: 'Rooster bijgewerkt', soort: 'planning', url: '/?view=rooster' });
  });

  it('met rijen: elke chauffeur leest zijn eigen stand; wie dezelfde tekst krijgt gaat nog altijd samen', async () => {
    pushes.length = 0;
    const planning = [
      // De id van de rij draagt nog de chauffeur uit de matrix (3); de kolom driverId zegt wie nu rijdt (4).
      { id: `${VR}-3-2116-1`, driverId: '4', date: VR, line: '2116', startTime: '06:45', endTime: '10:00' },
      { id: `${VR}-3-2116-2`, driverId: '4', date: VR, line: '2116', startTime: '15:45', endTime: '19:35' },
      { id: `${VR}-5-4101-1`, driverId: '5', date: VR, line: '4101', startTime: '05:10', endTime: '13:00' },
      // Iemand die geen melding krijgt telt niet mee.
      { id: `${VR}-9-12-1`, driverId: '9', date: VR, line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    const aantal = await verstuurRoosterPushes(new Map([['3', [VR]], ['4', [VR]], ['5', [VR]], ['6', [VR]]]), { rijen: planning });
    expect(aantal).toBe(4);
    expect(pushes.map((p) => [p.ids, p.payload.body])).toEqual([
      [['3', '6'], 'Je rooster is gewijzigd op vr 13/11: je hebt die dag geen dienst meer in de planning. Bekijk je rooster.'],
      [['4'], 'Je rooster is gewijzigd op vr 13/11: dienst 2116, 06:45–10:00 en 15:45–19:35.'],
      [['5'], 'Je rooster is gewijzigd op vr 13/11: dienst 4101, 05:10–13:00.'],
    ]);
    for (const p of pushes) expect(p.payload).toMatchObject({ title: 'Rooster bijgewerkt', soort: 'planning', url: '/?view=rooster' });
  });

  it('een eigen tekst (de import) krijgt de rijen van die chauffeur mee, of niets als de stand niet meegegeven is', async () => {
    pushes.length = 0;
    const gezien: Array<[string, unknown]> = [];
    const tekst = (id: string, _dagen: readonly string[], rijen: ReadonlyArray<{ line?: unknown }> | undefined) => {
      gezien.push([id, rijen?.map((r) => r.line)]);
      return `tekst voor ${id}`;
    };
    await verstuurRoosterPushes(new Map([['3', [VR]], ['4', [VR]]]), { titel: 'Planning bijgewerkt', tekst, rijen: [deel(VR, '2116', '06:45', '10:00')] });
    await verstuurRoosterPushes(new Map([['3', [VR]]]), { tekst });
    expect(gezien).toEqual([['3', ['2116']], ['4', []], ['3', undefined]]);
    expect(pushes.map((p) => [p.ids, p.payload.title, p.payload.body])).toEqual([
      [['3'], 'Planning bijgewerkt', 'tekst voor 3'], [['4'], 'Planning bijgewerkt', 'tekst voor 4'], [['3'], 'Rooster bijgewerkt', 'tekst voor 3'],
    ]);
  });

  it('rijen in een onverwachte vorm houden de verzending niet tegen: dan de dagen alleen', async () => {
    pushes.length = 0;
    const stil = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await verstuurRoosterPushes(new Map([['3', [VR]]]), { rijen: [null as never] })).toBe(1);
    } finally {
      stil.mockRestore();
    }
    expect(pushes.map((p) => [p.ids, p.payload.body])).toEqual([[['3'], 'Je rooster is gewijzigd op vr 13/11. Bekijk je diensten.']]);
  });

  it('niets te melden = geen verzending', async () => {
    pushes.length = 0;
    expect(await verstuurRoosterPushes(new Map())).toBe(0);
    expect(await verstuurRoosterPushes(new Map(), { rijen: [deel(VR, '2116', '06:45', '10:00')] })).toBe(0);
    expect(pushes).toEqual([]);
  });
});

/**
 * Na de tegenlezing (ronde 6): met de stand in de tekst heeft bij één tot drie
 * gewijzigde dagen elke chauffeur zijn eigen tekst, dus zijn eigen verzending.
 * Die vertrekken samen, met een grens, en niet meer na elkaar.
 */
describe('verstuurRoosterPushes: veel verzendingen vertrekken samen, met een grens', () => {
  const AANTAL = 2 * ROOSTER_GELIJKTIJDIG + 5;
  const ids = Array.from({ length: AANTAL }, (_, i) => String(100 + i));
  /** Elke chauffeur zijn eigen dienst op dezelfde dag: evenveel teksten als chauffeurs. */
  const eigenDag = () => ({
    dagen: new Map(ids.map((id) => [id, [VR]] as const)),
    rijen: ids.map((id) => ({ driverId: id, date: VR, line: `2${id}`, startTime: '06:45', endTime: '10:00' })),
  });
  /** Laat alles wat klaarstaat lopen (microtaken en één ronde van de lus). */
  const rust = () => new Promise<void>((klaar) => setTimeout(klaar, 0));
  /** Per verzending een belofte die de test zelf afrondt. */
  const metHand = () => {
    const open = new Map<string, { klaar: () => void; mislukt: (fout: Error) => void }>();
    let onderweg = 0;
    let hoogste = 0;
    pushGedrag = (naar) => new Promise<void>((klaar, mislukt) => {
      onderweg += 1;
      hoogste = Math.max(hoogste, onderweg);
      const af = () => { onderweg -= 1; open.delete(naar[0]!); };
      open.set(naar[0]!, { klaar: () => { af(); klaar(); }, mislukt: (fout) => { af(); mislukt(fout); } });
    });
    /** Rondt alles af wat op dit moment onderweg is. */
    const rondAf = () => { for (const verzending of [...open.values()]) verzending.klaar(); };
    return { open, rondAf, hoogste: () => hoogste, onderweg: () => onderweg };
  };
  const gestart = () => pushes.map((p) => p.ids[0]);

  it('de grens is een gewoon getal waarmee het slechtste geval onder de limiet van de functie blijft', () => {
    // 60 chauffeurs met elk een eigen tekst, elke verzending op haar uiterste
    // grens van 8 s (PUSH_DEADLINE_MS): het aantal rondes maal 8 s blijft
    // onder de 60 s van vercel.json.
    expect(Number.isInteger(ROOSTER_GELIJKTIJDIG)).toBe(true);
    expect(ROOSTER_GELIJKTIJDIG).toBeGreaterThan(1);
    expect(ROOSTER_GELIJKTIJDIG).toBeLessThanOrEqual(12);
    expect(Math.ceil(60 / ROOSTER_GELIJKTIJDIG) * 8).toBeLessThan(60);
  });

  it('elke chauffeur één verzending met zijn eigen tekst, gestart in de volgorde van de lijst, nooit meer dan de grens tegelijk', async () => {
    pushes.length = 0;
    const hand = metHand();
    try {
      const { dagen, rijen } = eigenDag();
      const bezig = verstuurRoosterPushes(dagen, { rijen });
      await rust();
      // De eerste reeks is samen vertrokken, de rest wacht op een vrije plaats.
      expect(gestart()).toEqual(ids.slice(0, ROOSTER_GELIJKTIJDIG));
      expect(hand.onderweg()).toBe(ROOSTER_GELIJKTIJDIG);
      // Eén verzending klaar = precies één nieuwe, de volgende uit de lijst.
      hand.open.get(ids[3]!)!.klaar();
      await rust();
      expect(gestart()).toEqual(ids.slice(0, ROOSTER_GELIJKTIJDIG + 1));
      expect(hand.onderweg()).toBe(ROOSTER_GELIJKTIJDIG);
      // De rest: telkens afronden wat onderweg is, tot alles vertrokken is.
      for (let ronde = 0; ronde < AANTAL && hand.onderweg() > 0; ronde++) {
        hand.rondAf();
        await rust();
      }
      expect(await bezig).toBe(AANTAL);
      expect(gestart()).toEqual(ids);
      expect(hand.hoogste()).toBe(ROOSTER_GELIJKTIJDIG);
      expect(pushes.map((p) => p.payload.body)).toEqual(ids.map((id) => `Je rooster is gewijzigd op vr 13/11: dienst 2${id}, 06:45–10:00.`));
      for (const p of pushes) {
        expect(p.ids).toHaveLength(1);
        expect(p.payload).toMatchObject({ title: 'Rooster bijgewerkt', soort: 'planning', url: '/?view=rooster' });
      }
    } finally {
      pushGedrag = null;
    }
  });

  it('een verzending die blijft hangen houdt de andere niet tegen', async () => {
    pushes.length = 0;
    const hangt: Array<() => void> = [];
    let klaar = 0;
    // De eerste chauffeur blijft hangen (een pushdienst die niet antwoordt), de rest gaat vlot.
    pushGedrag = (naar) => (naar[0] === ids[0]
      ? new Promise<void>((los) => { hangt.push(los); })
      : Promise.resolve().then(() => { klaar += 1; }));
    try {
      const { dagen, rijen } = eigenDag();
      let afgerond = false;
      const bezig = verstuurRoosterPushes(dagen, { rijen }).then((aantal) => { afgerond = true; return aantal; });
      await rust();
      // Iedereen is vertrokken en alle anderen zijn klaar, terwijl de eerste nog hangt.
      expect(gestart()).toEqual(ids);
      expect(klaar).toBe(AANTAL - 1);
      expect(afgerond).toBe(false);
      hangt[0]!();
      expect(await bezig).toBe(AANTAL);
    } finally {
      pushGedrag = null;
    }
  });

  it('een verzending die mislukt: geen nieuwe meer, wat onderweg is loopt af, en de aanroeper krijgt de fout', async () => {
    pushes.length = 0;
    const hand = metHand();
    try {
      const { dagen, rijen } = eigenDag();
      let uitkomst: unknown = 'bezig';
      const bezig = verstuurRoosterPushes(dagen, { rijen }).then(() => { uitkomst = 'gelukt'; }, (fout) => { uitkomst = fout; });
      await rust();
      hand.open.get(ids[2]!)!.mislukt(new Error('pushdienst onbereikbaar'));
      await rust();
      // Geen nieuwe verzending op de vrijgekomen plaats, en nog geen uitkomst:
      // de aanroeper (de cron, de knop) wacht tot wat onderweg is klaar is.
      expect(gestart()).toEqual(ids.slice(0, ROOSTER_GELIJKTIJDIG));
      expect(uitkomst).toBe('bezig');
      hand.rondAf();
      await bezig;
      expect(uitkomst).toEqual(new Error('pushdienst onbereikbaar'));
      expect(gestart()).toEqual(ids.slice(0, ROOSTER_GELIJKTIJDIG));
      expect(hand.onderweg()).toBe(0);
    } finally {
      pushGedrag = null;
    }
  });

  it('wie dezelfde tekst krijgt gaat nog altijd samen: meer dan drie dagen blijft één verzending', async () => {
    pushes.length = 0;
    const vier = ['2026-11-09', '2026-11-10', '2026-11-12', VR];
    expect(await verstuurRoosterPushes(new Map(ids.map((id) => [id, vier] as const)), { rijen: eigenDag().rijen })).toBe(AANTAL);
    expect(pushes.map((p) => [p.ids, p.payload.body])).toEqual([[ids, 'Je rooster is gewijzigd op 4 dagen tussen ma 09/11 en vr 13/11. Bekijk je diensten.']]);
  });
});
