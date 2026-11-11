import { describe, expect, it } from 'vitest';
import { bezettingCelTekst, verlofDagStand } from './verlofDagStand';

describe('verlofDagStand (dagdetail voor wie verlof aanvraagt)', () => {
  it('vrij: niemand afwezig', () => {
    expect(verlofDagStand(0, 2)).toEqual({ bezetting: 'vrij', tekst: 'Vrij, niemand afwezig' });
  });
  it('deels: hoeveel plaatsen er nog zijn, enkelvoud en meervoud', () => {
    expect(verlofDagStand(1, 2)).toEqual({ bezetting: 'deels', tekst: 'Nog 1 plaats, 1 van 2 afwezig' });
    expect(verlofDagStand(1, 4)).toEqual({ bezetting: 'deels', tekst: 'Nog 3 plaatsen, 1 van 4 afwezig' });
  });
  it('volzet: de limiet is bereikt, ook als er meer afwezig zijn dan de limiet', () => {
    expect(verlofDagStand(2, 2)).toEqual({ bezetting: 'volzet', tekst: 'Volzet, 2 van 2 afwezig' });
    expect(verlofDagStand(3, 2)).toEqual({ bezetting: 'volzet', tekst: 'Volzet, 3 van 2 afwezig' });
  });
  it('limiet 0: geen verlof mogelijk, wat de telling ook zegt', () => {
    expect(verlofDagStand(0, 0)).toEqual({ bezetting: 'geen', tekst: 'Geen verlof mogelijk op deze dag' });
    expect(verlofDagStand(1, 0)).toEqual({ bezetting: 'geen', tekst: 'Geen verlof mogelijk op deze dag' });
  });
  it('onbekend (niet geladen of mislukt): geen stand, nooit "vrij"', () => {
    expect(verlofDagStand(undefined, 2)).toBeNull();
    expect(verlofDagStand(null, 2)).toBeNull();
    expect(verlofDagStand(Number.NaN, 2)).toBeNull();
    // Ook op een dag zonder limiet raadt hij niets.
    expect(verlofDagStand(undefined, 0)).toBeNull();
  });
});

describe('bezettingCelTekst (kalendercel en bereikraster)', () => {
  it('geeft de tekst die de kalendercel altijd al droeg', () => {
    expect(bezettingCelTekst(0, 2)).toBe('vrij');
    expect(bezettingCelTekst(1, 2)).toBe('deels vrij, 1 van 2 afwezig');
    expect(bezettingCelTekst(2, 2)).toBe('volzet, 2 van 2 afwezig');
    expect(bezettingCelTekst(3, 2)).toBe('volzet, 3 van 2 afwezig');
    expect(bezettingCelTekst(0, 0)).toBe('geen verlof mogelijk');
    expect(bezettingCelTekst(1, 0)).toBe('geen verlof mogelijk');
  });
});
