import { afterEach, describe, expect, it, vi } from 'vitest';
import { leesFout, meldSchrijffout, schrijffout, vervolgstap } from './fouten';

const online = (waarde: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(waarde);

afterEach(() => vi.restoreAllMocks());

describe('schrijffout', () => {
  it('noemt de actie én een vervolgstap, ook zonder fout-object', () => {
    online(true);
    expect(schrijffout('Opslaan')).toBe('Opslaan is mislukt. Probeer het zo opnieuw. Blijft het misgaan, meld het via het accountmenu, Meld een probleem.');
  });

  it('netwerkfout → verbinding controleren', () => {
    online(true);
    expect(schrijffout('Verwijderen', new TypeError('Failed to fetch'))).toBe('Verwijderen is mislukt. Controleer je verbinding en probeer het opnieuw.');
  });

  it('offline wint van alles', () => {
    online(false);
    expect(vervolgstap(leesFout({ status: 500 }))).toMatch(/^Je bent offline/);
  });

  it('4xx met een reden van de server: reden + vervolgstap, één punt per zin', () => {
    online(true);
    const err = Object.assign(new Error('Busnummer 12 bestaat al'), { status: 409 });
    expect(schrijffout('Bewaren', err)).toBe('Bewaren is mislukt. Busnummer 12 bestaat al. Iemand anders heeft dit intussen gewijzigd. Vernieuw de lijst en probeer het opnieuw.');
  });

  it('generieke of 5xx-teksten komen niet in de zin', () => {
    online(true);
    const generiek = Object.assign(new Error('Er ging iets mis (code 500). Probeer het opnieuw.'), { status: 500 });
    expect(schrijffout('Opslaan', generiek)).toBe('Opslaan is mislukt. Probeer het zo opnieuw. Blijft het misgaan, meld het via het accountmenu, Meld een probleem.');
    const server = Object.assign(new Error('Interne fout in de databank'), { status: 502 });
    expect(schrijffout('Opslaan', server)).not.toContain('databank');
  });

  it('per status een eigen stap', () => {
    online(true);
    expect(vervolgstap(leesFout({ status: 403 }))).toMatch(/geen rechten/);
    expect(vervolgstap(leesFout({ status: 401 }))).toMatch(/opnieuw aan/);
    expect(vervolgstap(leesFout({ status: 404 }))).toMatch(/Vernieuw de lijst/);
    expect(vervolgstap(leesFout({ status: 400 }))).toMatch(/Pas de invoer aan/);
    expect(vervolgstap(leesFout({ status: 413 }))).toMatch(/kleiner/);
    expect(vervolgstap(leesFout({ status: 503 }))).toMatch(/onderhoud/);
    expect(vervolgstap(leesFout(new Response(null, { status: 429 })))).toMatch(/Wacht even/);
  });

  it('meldSchrijffout stuurt een rode toast met "Opnieuw proberen" als er een herkansing is', () => {
    online(true);
    const gezien: CustomEvent[] = [];
    const luister = (e: Event) => gezien.push(e as CustomEvent);
    window.addEventListener('vhb-toast', luister);
    const opnieuw = vi.fn();
    meldSchrijffout('Toewijzen', new TypeError('Failed to fetch'), opnieuw);
    meldSchrijffout('Toewijzen');
    window.removeEventListener('vhb-toast', luister);
    expect(gezien).toHaveLength(2);
    expect(gezien[0].detail.tone).toBe('error');
    expect(gezien[0].detail.message).toMatch(/^Toewijzen is mislukt\. Controleer je verbinding/);
    expect(gezien[0].detail.action.label).toBe('Opnieuw proberen');
    gezien[0].detail.action.run();
    expect(opnieuw).toHaveBeenCalledTimes(1);
    expect(gezien[1].detail.action).toBeUndefined();
  });
});
