import { describe, expect, it } from 'vitest';
import { KNIJP_DREMPEL, knijpNaarZoomStap, vingerAfstand } from './ritbladZoom';

/** Knijpen op het ritblad (controle 16-09, nr. 9). */

const STAPPEN = 4; // ZOOM_STAPPEN in RitbladViewer

describe('vingerAfstand', () => {
  it('meet de afstand tussen twee aanrakingen', () => {
    expect(vingerAfstand({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
    expect(vingerAfstand({ clientX: 10, clientY: 10 }, { clientX: 10, clientY: 10 })).toBe(0);
  });
});

describe('knijpNaarZoomStap', () => {
  it('zoomt pas in voorbij de drempel en herstart dan de meting', () => {
    expect(knijpNaarZoomStap(0, 100, 100 * KNIJP_DREMPEL - 1, STAPPEN)).toEqual({ idx: 0, herstart: false });
    expect(knijpNaarZoomStap(0, 100, 100 * KNIJP_DREMPEL, STAPPEN)).toEqual({ idx: 1, herstart: true });
    expect(knijpNaarZoomStap(1, 100, 400, STAPPEN)).toEqual({ idx: 2, herstart: true });
  });

  it('zoomt uit bij samenknijpen', () => {
    expect(knijpNaarZoomStap(2, 100, 100 / KNIJP_DREMPEL, STAPPEN)).toEqual({ idx: 1, herstart: true });
    expect(knijpNaarZoomStap(2, 100, 90, STAPPEN)).toEqual({ idx: 2, herstart: false });
  });

  it('blijft binnen de grenzen en herstart daar niet', () => {
    expect(knijpNaarZoomStap(STAPPEN - 1, 100, 400, STAPPEN)).toEqual({ idx: STAPPEN - 1, herstart: false });
    expect(knijpNaarZoomStap(0, 100, 10, STAPPEN)).toEqual({ idx: 0, herstart: false });
  });

  it('doet niets bij een onbruikbare meting', () => {
    expect(knijpNaarZoomStap(1, 0, 200, STAPPEN)).toEqual({ idx: 1, herstart: false });
    expect(knijpNaarZoomStap(1, 100, 0, STAPPEN)).toEqual({ idx: 1, herstart: false });
  });
});
