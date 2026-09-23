import { describe, expect, it } from 'vitest';
import { ankerPositie } from './AnkerPopover';

// Rekenkern van AnkerPopover (portal + fixed): onder het anker als
// het past, anders erboven, anders tegen de onderrand, pas daarna een eigen
// scroll; horizontaal altijd binnen de viewport (marge 8 px).
const VP = { breedte: 1024, hoogte: 768 };
const VLAK = { breedte: 256, hoogte: 340 };
const anker = (top: number, left: number, hoogte = 32, breedte = 80) => ({ top, bottom: top + hoogte, left, right: left + breedte });

describe('ankerPositie', () => {
  it('onder het anker als het daar past', () => {
    const p = ankerPositie(anker(100, 200), VLAK, VP, 'left');
    expect(p.boven).toBe(false);
    expect(p.stijl).toMatchObject({ top: 140, left: 200 });
    expect(p.stijl.maxHeight).toBeUndefined();
  });

  it('erboven als er onder geen plaats is (onderste rij)', () => {
    const p = ankerPositie(anker(700, 200), VLAK, VP, 'left');
    expect(p.boven).toBe(true);
    expect(p.stijl).toMatchObject({ bottom: 768 - 700 + 8, left: 200 });
  });

  it('past het aan geen kant, dan tegen de onderrand zonder eigen scroll', () => {
    const p = ankerPositie(anker(300, 20), { breedte: 256, hoogte: 400 }, { breedte: 390, hoogte: 664 }, 'left');
    expect(p.boven).toBe(false);
    expect(p.stijl.top).toBe(664 - 8 - 400);
    expect(p.stijl.overflowY).toBeUndefined();
  });

  it('hoger dan de viewport: volle hoogte met een eigen scroll', () => {
    const p = ankerPositie(anker(300, 20), { breedte: 256, hoogte: 900 }, VP, 'left');
    expect(p.stijl).toMatchObject({ top: 8, maxHeight: 768 - 16, overflowY: 'auto' });
  });

  it('schuift horizontaal binnen de viewport', () => {
    expect(ankerPositie(anker(100, 900), VLAK, VP, 'left').stijl.left).toBe(1024 - 8 - 256);
    expect(ankerPositie(anker(100, 0, 32, 40), VLAK, VP, 'right').stijl.left).toBe(8);
    expect(ankerPositie(anker(100, 600, 32, 80), VLAK, VP, 'right').stijl.left).toBe(680 - 256);
  });

  it('smaller dan het vlak: de breedte krimpt tot de viewport min de marges', () => {
    const p = ankerPositie(anker(100, 10), VLAK, { breedte: 240, hoogte: 600 }, 'left');
    expect(p.stijl).toMatchObject({ width: 224, left: 8 });
  });

  it('mobielVol op een telefoon: volle breedte met marges', () => {
    const p = ankerPositie(anker(100, 10), VLAK, { breedte: 390, hoogte: 664 }, 'left', true);
    expect(p.stijl).toMatchObject({ left: 8, right: 8, width: 'auto' });
  });
});
