import { describe, expect, it } from 'vitest';
import { komendeDagNummers, komendeDagStukken, komendeDienstDagen, type KomendeDag } from './komendeDiensten';

/** De tweede regel zoals ze op het scherm te lezen is. */
const komendeDagRegel = (dag: KomendeDag) => komendeDagStukken(dag).join(' · ');

const deel = (date: string, startTime: string, endTime: string, line = '2101', loopnr = '') => ({ date, startTime, endTime, line, loopnr });

// Woensdag 11 november 2026, 08:00 lokale tijd (de tests draaien in Europe/Brussels).
const NU = new Date(2026, 10, 11, 8, 0);

describe('komendeDienstDagen: drie dagen met een dienst', () => {
  it('een gesplitste dienst is één dag, geen twee rijen: er passen weer drie dagen in', () => {
    const dagen = komendeDienstDagen([
      deel('2026-11-12', '06:45', '10:00', '2109', '4500'),
      deel('2026-11-12', '15:45', '19:35', '2109', '4611'),
      deel('2026-11-13', '06:12', '14:30', '4101', '4500'),
      deel('2026-11-14', '15:41', '23:16', '2607'),
      deel('2026-11-16', '05:10', '13:02', '2304'),
    ], NU);
    expect(dagen.map((d) => d.datum)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
    expect(dagen[0].delen.map((d) => [d.startTime, d.endTime, d.loopnr])).toEqual([['06:45', '10:00', '4500'], ['15:45', '19:35', '4611']]);
    expect(dagen[1].delen).toHaveLength(1);
    expect(dagen.map(komendeDagNummers)).toEqual(['2109', '4101', '2607']);
    expect(dagen.map(komendeDagRegel)).toEqual(['06:45–10:00 · 15:45–19:35', '06:12–14:30 · loop 4500', '15:41–23:16']);
  });

  it('minder dan drie dagen met een dienst: zoveel als er zijn, en leeg zonder diensten', () => {
    const dagen = komendeDienstDagen([
      deel('2026-11-20', '06:12', '14:30'),
      deel('2026-11-12', '06:45', '10:00'),
      deel('2026-11-12', '15:45', '19:35'),
    ], NU);
    expect(dagen.map((d) => d.datum)).toEqual(['2026-11-12', '2026-11-20']);
    expect(komendeDienstDagen([], NU)).toEqual([]);
    // Alleen diensten in het verleden: niets komend.
    expect(komendeDienstDagen([deel('2026-11-10', '06:12', '14:30'), deel('2026-11-03', '06:12', '14:30')], NU)).toEqual([]);
  });

  it('een dienst van vandaag die al begon telt niet meer als komend', () => {
    // 05:30 gestart, het is 08:00: vandaag staat in de Vandaag-tegel, niet hier.
    const dagen = komendeDienstDagen([
      deel('2026-11-11', '05:30', '13:45', '2101'),
      deel('2026-11-12', '06:12', '14:30', '4101'),
    ], NU);
    expect(dagen.map((d) => d.datum)).toEqual(['2026-11-12']);
    // Precies op het startuur is de dienst begonnen (start > nu, zoals vroeger).
    expect(komendeDienstDagen([deel('2026-11-11', '08:00', '13:45')], NU)).toEqual([]);
    expect(komendeDienstDagen([deel('2026-11-11', '08:01', '13:45')], NU).map((d) => d.datum)).toEqual(['2026-11-11']);
  });

  it('van een gesplitste dienst van vandaag blijft alleen het deel dat nog moet beginnen', () => {
    const middag = deel('2026-11-11', '13:39', '17:29', '2101', '4611');
    const dagen = komendeDienstDagen([deel('2026-11-11', '04:36', '07:52', '2101', '4500'), middag], NU);
    expect(dagen).toEqual([{ datum: '2026-11-11', delen: [middag] }]);
    // Eén deel over: de rij leest zoals vroeger, met het loopnummer.
    expect(komendeDagRegel(dagen[0])).toBe('13:39–17:29 · loop 4611');
    // Zodra ook het tweede deel begon, valt vandaag weg.
    expect(komendeDienstDagen([
      deel('2026-11-11', '04:36', '07:52'),
      deel('2026-11-11', '13:39', '17:29'),
    ], new Date(2026, 10, 11, 13, 39))).toEqual([]);
  });

  it('sorteert op dag en binnen de dag op starttijd, ongeacht de volgorde van de rijen', () => {
    const rijen = [
      deel('2026-11-14', '15:41', '23:16', '2607'),
      deel('2026-11-12', '15:45', '19:35', '2109'),
      deel('2026-11-13', '06:12', '14:30', '4101'),
      deel('2026-11-12', '06:45', '10:00', '2109'),
      deel('2026-11-15', '05:10', '13:02', '2304'),
    ];
    const kopie = [...rijen];
    const dagen = komendeDienstDagen(rijen, NU);
    expect(dagen.map((d) => d.datum)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
    expect(dagen[0].delen.map((d) => d.startTime)).toEqual(['06:45', '15:45']);
    // De invoer (de planning uit de datalaag) blijft in haar eigen volgorde.
    expect(rijen).toEqual(kopie);
  });

  it('een nachtdienst van gisteren met een busvak-start na middernacht hoort bij gisteren, niet bij vandaag', () => {
    // Dienstdag 10-11, start "25:10" = 01:10 op 11-11; om 00:30 moet dat deel nog beginnen.
    const dagen = komendeDienstDagen([
      deel('2026-11-10', '25:10', '26:16', '2607'),
      deel('2026-11-12', '06:12', '14:30', '4101'),
    ], new Date(2026, 10, 11, 0, 30));
    expect(dagen.map((d) => d.datum)).toEqual(['2026-11-10', '2026-11-12']);
  });

  it('het aantal dagen is instelbaar', () => {
    const rijen = ['12', '13', '14', '15'].map((d) => deel(`2026-11-${d}`, '06:12', '14:30'));
    expect(komendeDienstDagen(rijen, NU, 2)).toHaveLength(2);
    expect(komendeDienstDagen(rijen, NU, 4)).toHaveLength(4);
  });
});

describe('komendeDagNummers: het dienstnummer voor de chip', () => {
  it('een gesplitste dienst noemt haar nummer één keer; twee diensten op één dag staan er allebei', () => {
    expect(komendeDagNummers({ datum: '2026-11-12', delen: [deel('2026-11-12', '06:45', '10:00', '2109'), deel('2026-11-12', '15:45', '19:35', '2109')] })).toBe('2109');
    expect(komendeDagNummers({ datum: '2026-11-12', delen: [deel('2026-11-12', '06:45', '10:00', '2109'), deel('2026-11-12', '15:45', '19:35', '2304')] })).toBe('2109 / 2304');
  });

  it('zonder dienstnummer blijft de chip leeg (ServiceChip tekent dan niets)', () => {
    expect(komendeDagNummers({ datum: '2026-11-13', delen: [deel('2026-11-13', '06:12', '14:30', '')] })).toBe('');
    expect(komendeDagNummers({ datum: '2026-11-13', delen: [deel('2026-11-13', '06:12', '10:00', ''), deel('2026-11-13', '12:00', '14:30', '4101')] })).toBe('4101');
  });
});

describe('komendeDagStukken: de uren van alle delen op één regel', () => {
  it('één deel houdt zijn loopnummer, zoals de rij het vroeger toonde', () => {
    const metLoop = { datum: '2026-11-13', delen: [deel('2026-11-13', '06:12', '14:30', '4101', '4500')] };
    expect(komendeDagStukken(metLoop)).toEqual(['06:12–14:30', 'loop 4500']);
    expect(komendeDagRegel(metLoop)).toBe('06:12–14:30 · loop 4500');
    expect(komendeDagStukken({ datum: '2026-11-13', delen: [deel('2026-11-13', '06:12', '14:30', '4101', '')] })).toEqual(['06:12–14:30']);
  });

  it('een gesplitste dienst toont de uren van alle delen, zonder loopnummers', () => {
    const gesplitst = {
      datum: '2026-11-12',
      delen: [deel('2026-11-12', '06:45', '10:00', '2109', '4500'), deel('2026-11-12', '15:45', '19:35', '2109', '4611')],
    };
    // Elk tijdvak is één stuk: de rij breekt tussen de stukken, nooit erin.
    expect(komendeDagStukken(gesplitst)).toEqual(['06:45–10:00', '15:45–19:35']);
    expect(komendeDagRegel(gesplitst)).toBe('06:45–10:00 · 15:45–19:35');
    expect(komendeDagRegel({
      datum: '2026-11-12',
      delen: [deel('2026-11-12', '05:10', '07:40'), deel('2026-11-12', '09:15', '12:05'), deel('2026-11-12', '15:45', '19:35')],
    })).toBe('05:10–07:40 · 09:15–12:05 · 15:45–19:35');
  });
});
