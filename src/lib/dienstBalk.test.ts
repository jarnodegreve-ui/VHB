import { describe, expect, it } from 'vitest';
import { balkGeometrie, minNaarTijd } from './dienstBalk';

describe('balkGeometrie', () => {
  it('één blok: segment over de hele breedte, nu op de juiste plek', () => {
    const g = balkGeometrie([{ start: 956, end: 1520 }], 1152)!; // 15:56–25:20, nu 19:12
    expect(g.segmenten).toHaveLength(1);
    expect(g.segmenten[0].links).toBe(0);
    expect(g.segmenten[0].breedte).toBe(100);
    expect(g.segmenten[0].bezig).toBe(true);
    expect(Math.round(g.nuPct!)).toBe(35);
    expect(g.gaten).toEqual([]);
    expect(g.voortgang).toBe(35);
  });

  it('drie delen: twee gaten, gereden/bezig/te rijden correct', () => {
    const g = balkGeometrie([
      { start: 420, end: 600 }, // 07:00–10:00
      { start: 660, end: 780 }, // 11:00–13:00
      { start: 900, end: 1080 }, // 15:00–18:00
    ], 700)!;
    expect(g.gaten).toHaveLength(2);
    expect(g.segmenten.map((s) => s.gereden)).toEqual([true, false, false]);
    expect(g.segmenten.map((s) => s.bezig)).toEqual([false, true, false]);
    expect(g.segmenten[1].gevuld).toBeCloseTo(33.3, 0);
    // gereden 180 + 40 = 220 van 480 min
    expect(g.voortgang).toBe(46);
  });

  it('uurstreepjes: elke vol uur binnen de dag, groot om de 3 u, randen overgeslagen', () => {
    const g = balkGeometrie([{ start: 956, end: 1520 }], null)!;
    const uren = g.streepjes.map((s) => Math.round((s.pct / 100) * (1520 - 956) + 956) / 60);
    expect(uren[0]).toBe(17); // 16:00 ligt 4 min na de start → overgeslagen
    expect(uren[uren.length - 1]).toBe(25);
    expect(g.streepjes.filter((s) => s.groot).length).toBe(3); // 18, 21, 24
  });

  it('nu buiten de dag → geen wijzer; morgen (nu null) → niets gevuld', () => {
    expect(balkGeometrie([{ start: 600, end: 700 }], 500)!.nuPct).toBeNull();
    expect(balkGeometrie([{ start: 600, end: 700 }], 800)!.nuPct).toBeNull();
    const g = balkGeometrie([{ start: 600, end: 700 }], null)!;
    expect(g.segmenten[0].gevuld).toBe(0);
    expect(g.voortgang).toBe(0);
  });

  it('lege of ongeldige delen → null', () => {
    expect(balkGeometrie([], 0)).toBeNull();
    expect(balkGeometrie([{ start: 700, end: 600 }], 0)).toBeNull();
  });

  it('minNaarTijd houdt de busvak-notatie', () => {
    expect(minNaarTijd(1520)).toBe('25:20');
    expect(minNaarTijd(956)).toBe('15:56');
  });
});
