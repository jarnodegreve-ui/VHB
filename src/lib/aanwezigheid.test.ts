import { describe, it, expect } from 'vitest';
import { balkenVoorDag, duurKort, isBuitenland, knipPerDag, landNaam, nuOnline, periodeRegels, plaatsLabel, rijStaatOpen, telBuitenlandPerDag, telPerDag, voegSamen, type AanwezigheidSessie } from './aanwezigheid';

/**
 * Tijdstippen zonder zone: JS leest die als lokale tijd, dus de test meet de
 * logica (knippen op de lokale dagrand) en niet de tijdzone van de machine.
 * In productie stuurt de server ISO met zone en rekent de browser die zelf om
 * naar de Belgische klok van de kijker.
 */
const sessie = (naam: string, van: string, tot: string, userId = naam): AanwezigheidSessie =>
  ({ userId, naam, rol: 'chauffeur', van, tot });

describe('knipPerDag', () => {
  it('zet een sessie binnen één dag om in minuten sinds middernacht', () => {
    const perDag = knipPerDag([sessie('Jesus', '2026-09-18T06:05:00', '2026-09-18T06:40:00')]);
    expect([...perDag.keys()]).toEqual(['2026-09-18']);
    expect(perDag.get('2026-09-18')).toMatchObject([{ vanMin: 6 * 60 + 5, totMin: 6 * 60 + 40 }]);
  });

  it('knipt een sessie over middernacht in twee dagen', () => {
    const perDag = knipPerDag([sessie('Joost', '2026-09-17T23:40:00', '2026-09-18T00:20:00')]);
    expect([...perDag.keys()].sort()).toEqual(['2026-09-17', '2026-09-18']);
    // De eerste dag loopt tot de dagrand: 24:00, niet 00:00 — anders wordt het
    // een blok van 23:40 tot 00:00 met een negatieve breedte.
    expect(perDag.get('2026-09-17')).toMatchObject([{ vanMin: 23 * 60 + 40, totMin: 24 * 60 }]);
    expect(perDag.get('2026-09-18')).toMatchObject([{ vanMin: 0, totMin: 20 }]);
  });

  it('negeert onbruikbare rijen in plaats van het scherm te laten vallen', () => {
    const perDag = knipPerDag([
      sessie('Kapot', 'geen-datum', '2026-09-18T06:40:00'),
      sessie('Omgekeerd', '2026-09-18T08:00:00', '2026-09-18T07:00:00'),
      sessie('Goed', '2026-09-18T06:05:00', '2026-09-18T06:40:00'),
    ]);
    expect(perDag.get('2026-09-18')).toHaveLength(1);
    expect(perDag.get('2026-09-18')?.[0].naam).toBe('Goed');
  });
});

describe('voegSamen', () => {
  const p = (vanMin: number, totMin: number) => ({ vanMin, totMin, vanIso: '', totIso: '' });

  it('smelt overlappende periodes samen', () => {
    // Telefoon én bureau tegelijk, of twee instanties die samen een sessie
    // openen: ongesmolten geeft dat een gestreepte balk en dubbeltelling.
    expect(voegSamen([p(100, 200), p(150, 260)])).toMatchObject([{ vanMin: 100, totMin: 260 }]);
  });

  it('smelt aansluitende periodes samen', () => {
    expect(voegSamen([p(100, 200), p(200, 240)])).toMatchObject([{ vanMin: 100, totMin: 240 }]);
  });

  it('laat een echte onderbreking staan', () => {
    expect(voegSamen([p(100, 200), p(400, 460)])).toHaveLength(2);
  });

  it('slikt een periode die volledig binnen een andere valt', () => {
    expect(voegSamen([p(100, 300), p(150, 200)])).toMatchObject([{ vanMin: 100, totMin: 300 }]);
  });
});

describe('balkenVoorDag', () => {
  const dag = '2026-09-18';

  it('groepeert per persoon, langst aanwezig eerst', () => {
    const balken = balkenVoorDag([
      sessie('Kort', `${dag}T06:00:00`, `${dag}T06:10:00`),
      sessie('Lang', `${dag}T08:00:00`, `${dag}T11:00:00`),
    ], dag);
    expect(balken.map((b) => b.naam)).toEqual(['Lang', 'Kort']);
    expect(balken[0].totaalMin).toBe(180);
  });

  it('telt overlappende sessies van dezelfde persoon niet dubbel', () => {
    const balken = balkenVoorDag([
      sessie('Jarno', `${dag}T08:00:00`, `${dag}T09:00:00`),
      sessie('Jarno', `${dag}T08:30:00`, `${dag}T10:00:00`),
    ], dag);
    expect(balken).toHaveLength(1);
    expect(balken[0].periodes).toHaveLength(1);
    expect(balken[0].totaalMin).toBe(120);
  });

  it('houdt een middagpauze zichtbaar als twee blokken', () => {
    const balken = balkenVoorDag([
      sessie('Rudy', `${dag}T06:00:00`, `${dag}T07:00:00`),
      sessie('Rudy', `${dag}T14:00:00`, `${dag}T15:00:00`),
    ], dag);
    expect(balken[0].periodes).toHaveLength(2);
    expect(balken[0].totaalMin).toBe(120);
  });

  it('geeft een lege lijst voor een dag zonder aanwezigheid', () => {
    expect(balkenVoorDag([sessie('Jarno', `${dag}T08:00:00`, `${dag}T09:00:00`)], '2026-09-17')).toEqual([]);
  });
});

describe('telPerDag', () => {
  it('telt personen, niet sessies', () => {
    const tel = telPerDag([
      sessie('Jarno', '2026-09-18T06:00:00', '2026-09-18T07:00:00'),
      sessie('Jarno', '2026-09-18T14:00:00', '2026-09-18T15:00:00'),
      sessie('Rudy', '2026-09-18T06:00:00', '2026-09-18T07:00:00'),
    ]);
    expect(tel.get('2026-09-18')).toBe(2);
  });

  it('telt een sessie over middernacht op beide dagen mee', () => {
    const tel = telPerDag([sessie('Joost', '2026-09-17T23:40:00', '2026-09-18T00:20:00')]);
    expect(tel.get('2026-09-17')).toBe(1);
    expect(tel.get('2026-09-18')).toBe(1);
  });
});

describe('nuOnline', () => {
  const nu = Date.parse('2026-09-18T09:00:00');

  it('telt wie binnen het venster een teken van leven gaf', () => {
    const online = nuOnline([
      sessie('Vers', '2026-09-18T08:30:00', '2026-09-18T08:56:00'),
      sessie('Weg', '2026-09-18T06:00:00', '2026-09-18T06:40:00'),
    ], nu);
    expect(online.map((s) => s.naam)).toEqual(['Vers']);
  });

  it('toont iemand hoogstens één keer, ook met meerdere sessies', () => {
    const online = nuOnline([
      sessie('Jarno', '2026-09-18T08:00:00', '2026-09-18T08:52:00'),
      sessie('Jarno', '2026-09-18T08:53:00', '2026-09-18T08:58:00'),
    ], nu);
    expect(online).toHaveLength(1);
    expect(online[0].tot).toBe('2026-09-18T08:58:00');
  });
});

describe('duurKort', () => {
  it('schrijft minuten, uren en uren met rest uit', () => {
    expect(duurKort(48)).toBe('48 min');
    expect(duurKort(120)).toBe('2 u');
    expect(duurKort(372)).toBe('6 u 12');
  });
});

describe('plaats van aanmelden', () => {
  const dag = '2026-09-18';
  const met = (s: AanwezigheidSessie, plaats: Partial<AanwezigheidSessie>): AanwezigheidSessie => ({ ...s, ...plaats });
  const GENT = { land: 'BE', regio: 'VOV', stad: 'Gent' };
  const LILLE = { land: 'FR', regio: 'HDF', stad: 'Lille' };

  it('isBuitenland: alleen een bekend land dat niet België is', () => {
    expect(isBuitenland('FR')).toBe(true);
    expect(isBuitenland('fr')).toBe(true);
    expect(isBuitenland('BE')).toBe(false);
    expect(isBuitenland('be')).toBe(false);
    // Onbekend is geen alarm: oude sessies en lokaal ontwikkelen hebben geen land.
    expect(isBuitenland(null)).toBe(false);
    expect(isBuitenland(undefined)).toBe(false);
    expect(isBuitenland('')).toBe(false);
  });

  it('plaatsLabel: kort in België, het land voluit daarbuiten', () => {
    expect(plaatsLabel(GENT)).toBe('Gent, BE');
    expect(plaatsLabel(LILLE)).toBe(`Lille, ${landNaam('FR')}`);
    expect(plaatsLabel({ land: 'BE', stad: null })).toBe('België');
    expect(plaatsLabel({ land: 'NL' })).toBe(landNaam('NL'));
    expect(plaatsLabel({ land: null, stad: 'Gent' })).toBeNull();
    expect(plaatsLabel({})).toBeNull();
  });

  it('landNaam schrijft het land voluit en gooit niet op onzin', () => {
    expect(landNaam('FR')).toMatch(/Frankrijk|FR/);
    expect(() => landNaam('??')).not.toThrow();
  });

  it('balkenVoorDag draagt per persoon de plaatsen van die dag, in volgorde', () => {
    const [balk] = balkenVoorDag([
      met(sessie('Alex', `${dag}T12:05:00`, `${dag}T12:31:00`), LILLE),
      met(sessie('Alex', `${dag}T05:05:00`, `${dag}T05:30:00`), GENT),
    ], dag);
    expect(balk.plaatsen).toEqual(['Gent, BE', `Lille, ${landNaam('FR')}`]);
    expect(balk.buitenland).toBe(true);
    expect(balk.periodes.map((p) => p.buitenland)).toEqual([false, true]);
    expect(balk.periodes[1].plaatsen).toEqual([`Lille, ${landNaam('FR')}`]);
  });

  it('telt dezelfde plaats één keer en markeert een Belgische dag niet', () => {
    const [balk] = balkenVoorDag([
      met(sessie('Jesus', `${dag}T04:41:00`, `${dag}T05:15:00`), GENT),
      met(sessie('Jesus', `${dag}T09:12:00`, `${dag}T09:33:00`), GENT),
    ], dag);
    expect(balk.plaatsen).toEqual(['Gent, BE']);
    expect(balk.buitenland).toBe(false);
  });

  it('sessies zonder plaats (van vóór 20-09) geven een lege lijst, geen fout', () => {
    const [balk] = balkenVoorDag([sessie('Oud', `${dag}T08:00:00`, `${dag}T09:00:00`)], dag);
    expect(balk.plaatsen).toEqual([]);
    expect(balk.buitenland).toBe(false);
  });

  it('overlappende sessies van twee netwerken smelten samen en houden beide plaatsen', () => {
    const [balk] = balkenVoorDag([
      met(sessie('Jarno', `${dag}T08:00:00`, `${dag}T10:00:00`), GENT),
      met(sessie('Jarno', `${dag}T09:00:00`, `${dag}T11:00:00`), LILLE),
    ], dag);
    expect(balk.periodes).toHaveLength(1);
    expect(balk.periodes[0].plaatsen).toEqual(['Gent, BE', `Lille, ${landNaam('FR')}`]);
    expect(balk.periodes[0].buitenland).toBe(true);
  });

  it('telBuitenlandPerDag telt personen, niet sessies, en alleen dagen met een treffer', () => {
    const telling = telBuitenlandPerDag([
      met(sessie('Alex', `${dag}T05:05:00`, `${dag}T05:30:00`), LILLE),
      met(sessie('Alex', `${dag}T12:05:00`, `${dag}T12:31:00`), LILLE),
      met(sessie('Marc', `${dag}T21:10:00`, `${dag}T21:45:00`), { land: 'ES', stad: 'Málaga' }),
      met(sessie('Jesus', `${dag}T04:41:00`, `${dag}T05:15:00`), GENT),
      met(sessie('Oud', '2026-09-17T08:00:00', '2026-09-17T09:00:00'), {}),
    ]);
    expect(telling.get(dag)).toBe(2);
    expect(telling.has('2026-09-17')).toBe(false);
  });

  it('een buitenlandse sessie over middernacht telt op beide dagen', () => {
    const telling = telBuitenlandPerDag([met(sessie('Marc', '2026-09-17T23:40:00', '2026-09-18T00:20:00'), LILLE)]);
    expect([...telling.keys()].sort()).toEqual(['2026-09-17', '2026-09-18']);
  });

  it('periodeRegels geeft per periode tijd, duur en plaats, en de duren tellen op tot het totaal van de rij', () => {
    const [balk] = balkenVoorDag([
      met(sessie('Alex', `${dag}T05:05:00`, `${dag}T05:30:00`), LILLE),
      met(sessie('Alex', `${dag}T12:05:00`, `${dag}T13:31:00`), GENT),
      // Een sessie van nul minuten telt, net als in het totaal, voor één minuut.
      sessie('Alex', `${dag}T20:00:00`, `${dag}T20:00:00`),
    ], dag);
    const regels = periodeRegels(balk);
    expect(regels.map((r) => [r.vanMin, r.totMin, r.duurMin, r.plaats, r.buitenland])).toEqual([
      [5 * 60 + 5, 5 * 60 + 30, 25, `Lille, ${landNaam('FR')}`, true],
      [12 * 60 + 5, 13 * 60 + 31, 86, 'Gent, BE', false],
      [20 * 60, 20 * 60, 1, null, false],
    ]);
    expect(regels.reduce((som, r) => som + r.duurMin, 0)).toBe(balk.totaalMin);
    expect(new Set(regels.map((r) => r.sleutel)).size).toBe(3);
  });

  it('samengesmolten periodes van twee netwerken tonen beide plaatsen op één regel', () => {
    const [balk] = balkenVoorDag([
      met(sessie('Jarno', `${dag}T08:00:00`, `${dag}T10:00:00`), GENT),
      met(sessie('Jarno', `${dag}T09:00:00`, `${dag}T11:00:00`), LILLE),
    ], dag);
    expect(periodeRegels(balk)).toMatchObject([{ plaats: `Gent, BE en Lille, ${landNaam('FR')}`, buitenland: true, duurMin: 180 }]);
  });
});

describe('rijStaatOpen', () => {
  const thuis = { userId: 'a', buitenland: false };
  const weg = { userId: 'b', buitenland: true };

  it('standaard is elke rij dicht, ook die met een buitenlandse sessie', () => {
    expect(rijStaatOpen(thuis, false, new Set())).toBe(false);
    expect(rijStaatOpen(weg, false, new Set())).toBe(false);
  });

  it('met het filter aan staan de buitenlandse rijen open', () => {
    expect(rijStaatOpen(weg, true, new Set())).toBe(true);
    expect(rijStaatOpen(thuis, true, new Set())).toBe(false);
  });

  it('een tik keert de standaard om, in beide richtingen', () => {
    expect(rijStaatOpen(thuis, false, new Set(['a']))).toBe(true);
    expect(rijStaatOpen(weg, true, new Set(['b']))).toBe(false);
  });
});
