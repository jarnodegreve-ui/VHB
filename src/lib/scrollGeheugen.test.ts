import { beforeEach, describe, expect, it } from 'vitest';
import { bewaarScroll, herstelStap, leesScroll, planHerstel, scrollSleutel, wisScrollGeheugen } from './scrollGeheugen';

/** Scroll-restoration per route (punt 19): geheugen, sleutel en de herstel-planner. */
describe('scrollGeheugen', () => {
  beforeEach(() => wisScrollGeheugen());

  it('sleutelt op het pad inclusief parameters, zonder afsluitende schuine streep', () => {
    expect(scrollSleutel('/rooster')).toBe('/rooster');
    expect(scrollSleutel('/rooster/')).toBe('/rooster');
    expect(scrollSleutel('/omleidingen/123')).toBe('/omleidingen/123');
    expect(scrollSleutel('/')).toBe('/');
    expect(scrollSleutel('')).toBe('/');
  });

  it('bewaart per sleutel en vergeet 0 (bovenaan is de standaard)', () => {
    bewaarScroll('/rooster', 420.6);
    bewaarScroll('/verlof', 0);
    expect(leesScroll('/rooster')).toBe(421);
    expect(leesScroll('/verlof')).toBeNull();
    bewaarScroll('/rooster', 0);
    expect(leesScroll('/rooster')).toBeNull();
  });

  it('herstelStap: wacht tot de inhoud hoog genoeg is, en zet uiterlijk op de deadline', () => {
    const laag = { scrollHeight: 800, clientHeight: 700 }; // skelet: kan 100 px scrollen
    const hoog = { scrollHeight: 3000, clientHeight: 700 };
    expect(herstelStap(laag, 500, 0, 90)).toEqual({ zet: false, klaar: false });
    expect(herstelStap(hoog, 500, 3, 90)).toEqual({ zet: true, klaar: true });
    expect(herstelStap(laag, 500, 90, 90)).toEqual({ zet: true, klaar: true });
    // Doel 0 = meteen bovenaan, geen wachten.
    expect(herstelStap(laag, 0, 0, 90)).toEqual({ zet: true, klaar: true });
  });

  it('planHerstel zet de positie pas zodra de inhoud er is (ná skelet/Suspense)', () => {
    const el = document.createElement('div');
    let scrollHeight = 800;
    Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight });
    Object.defineProperty(el, 'clientHeight', { get: () => 700 });
    const frames: Array<() => void> = [];
    const raf = (cb: () => void) => { frames.push(cb); return frames.length; };
    planHerstel(el, 500, { raf, caf: () => {}, maxFrames: 90 });
    expect(el.scrollTop).toBe(0);
    frames.shift()!(); // frame 1: nog skelet
    expect(el.scrollTop).toBe(0);
    scrollHeight = 3000; // inhoud gerenderd
    frames.shift()!();
    expect(el.scrollTop).toBe(500);
    expect(frames).toHaveLength(0); // klaar: geen volgend frame gepland
  });

  it('planHerstel stopt zodra de gebruiker zelf scrolt', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { get: () => 800 });
    Object.defineProperty(el, 'clientHeight', { get: () => 700 });
    const frames: Array<() => void> = [];
    let geannuleerd = 0;
    planHerstel(el, 500, { raf: (cb) => { frames.push(cb); return frames.length; }, caf: () => { geannuleerd += 1; }, maxFrames: 90 });
    el.dispatchEvent(new Event('wheel'));
    expect(geannuleerd).toBe(1);
    frames.shift()!(); // een al geplande frame doet niets meer
    expect(el.scrollTop).toBe(0);
  });

  it('een nieuw plan vervangt het vorige', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { get: () => 800 });
    Object.defineProperty(el, 'clientHeight', { get: () => 700 });
    let geannuleerd = 0;
    const raf = () => 1;
    planHerstel(el, 500, { raf, caf: () => { geannuleerd += 1; } });
    planHerstel(el, 50, { raf, caf: () => { geannuleerd += 1; } });
    expect(geannuleerd).toBe(1);
    expect(el.scrollTop).toBe(50);
  });
});
