import { describe, it, expect } from 'vitest';
import { balkenVoorDag, duurKort, knipPerDag, nuOnline, telPerDag, voegSamen, type AanwezigheidSessie } from './aanwezigheid';

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
