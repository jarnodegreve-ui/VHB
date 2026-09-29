import { describe, expect, it } from 'vitest';
import { beoordeelUitkomst, isZonderAntwoord } from './mailUitkomst';

const basis = { aantal: 3, gelukt: 3, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, mocked: false, overgeslagen: false, resterend: [], onzekerAdressen: [] };

describe('beoordeelUitkomst', () => {
  it('alles vertrokken: dezelfde toast als altijd', () => {
    expect(beoordeelUitkomst(basis, 'Mail verstuurd')).toEqual({ soort: 'klaar', tekst: 'Mail verstuurd naar 3 ontvangers.', toon: 'success' });
    expect(beoordeelUitkomst({ ...basis, aantal: 1, gelukt: 1 }, 'Omleiding gemaild')).toEqual({ soort: 'klaar', tekst: 'Omleiding gemaild naar 1 ontvanger.', toon: 'success' });
    // Een oudere server zonder de nieuwe velden.
    expect(beoordeelUitkomst({ aantal: 3, gelukt: 3, mislukt: 0, mocked: false }, 'Mail verstuurd')).toEqual({ soort: 'klaar', tekst: 'Mail verstuurd naar 3 ontvangers.', toon: 'success' });
  });

  it('zonder SMTP en uitgeschakeld zeggen wat er echt gebeurde', () => {
    expect(beoordeelUitkomst({ ...basis, mocked: true }, 'Mail verstuurd')).toEqual({ soort: 'klaar', tekst: 'Mail gelogd voor 3 ontvangers (geen SMTP ingesteld).', toon: 'success' });
    expect(beoordeelUitkomst({ ...basis, gelukt: 0, nietGeprobeerd: 3, overgeslagen: true }, 'Mail verstuurd')).toEqual({ soort: 'klaar', tekst: 'Mail staat uit in Beheer › Mails, er is niets verstuurd.', toon: 'info' });
  });

  it('deels vertrokken: hoeveel, wie niet, en alleen die adressen om opnieuw te versturen', () => {
    const b = beoordeelUitkomst({ ...basis, aantal: 40, gelukt: 27, mislukt: 1, nietGeprobeerd: 12, resterend: Array.from({ length: 13 }, (_, i) => `p${i + 1}@vhb.be`) }, 'Mail verstuurd');
    expect(b.soort).toBe('deels');
    if (b.soort !== 'deels') return;
    expect(b.titel).toBe('Verstuurd naar 27 van 40');
    expect(b.resterend).toHaveLength(13);
    expect(b.regels).toEqual(['13 adressen hebben de mail niet gekregen: p1@vhb.be, p2@vhb.be, p3@vhb.be, p4@vhb.be, p5@vhb.be, p6@vhb.be en nog 7.']);
  });

  it('onzekere adressen staan erbij maar nooit in het restant', () => {
    const b = beoordeelUitkomst({ ...basis, gelukt: 1, mislukt: 1, onzeker: 1, resterend: ['b@vhb.be'], onzekerAdressen: ['c@vhb.be'] }, 'Mail verstuurd');
    expect(b).toEqual({
      soort: 'deels',
      titel: 'Verstuurd naar 1 van 3',
      regels: ['1 adres heeft de mail niet gekregen: b@vhb.be.', 'Bij 1 adres is niet zeker of de mail vertrok (c@vhb.be). Die krijgen de mail niet opnieuw; vraag het na.'],
      resterend: ['b@vhb.be'],
    });
  });

  it('een bijlage die niet meeging wordt gemeld, ook als elke mail vertrok (nr. 11)', () => {
    expect(beoordeelUitkomst({ ...basis, bijlagen: 1, ontbrekendeBijlagen: ['haltes.pdf'] }, 'Omleiding gemaild')).toEqual({
      soort: 'klaar', tekst: 'Omleiding gemaild naar 3 ontvangers. Niet meegegaan, bestand niet gevonden: haltes.pdf.', toon: 'error',
    });
    const deels = beoordeelUitkomst({ ...basis, gelukt: 2, mislukt: 1, resterend: ['b@vhb.be'], ontbrekendeBijlagen: ['haltes.pdf'] }, 'Omleiding gemaild');
    expect(deels.soort === 'deels' && deels.regels.at(-1)).toBe('Niet meegegaan, bestand niet gevonden: haltes.pdf.');
    expect(beoordeelUitkomst({ ...basis, ontbrekendeBijlagen: [] }, 'Omleiding gemaild')).toMatchObject({ soort: 'klaar', toon: 'success' });
  });

  it('geen em dash in de teksten', () => {
    const b = beoordeelUitkomst({ ...basis, gelukt: 1, mislukt: 1, onzeker: 1, resterend: ['b@vhb.be'], onzekerAdressen: ['c@vhb.be'], ontbrekendeBijlagen: ['x.pdf'] }, 'Mail verstuurd');
    expect(JSON.stringify(b)).not.toContain(' — ');
  });
});

describe('isZonderAntwoord', () => {
  it('netwerkfout, time-out en serverfout: niemand weet wat er vertrok', () => {
    expect(isZonderAntwoord(new TypeError('Failed to fetch'))).toBe(true);
    expect(isZonderAntwoord(new Error('Load failed'))).toBe(true);
    expect(isZonderAntwoord(Object.assign(new Error('Versturen is mislukt.'), { status: 500 }))).toBe(true);
    expect(isZonderAntwoord(Object.assign(new Error('time-out'), { status: 504 }))).toBe(true);
    expect(isZonderAntwoord(undefined)).toBe(true);
  });
  it('een 4xx is een antwoord: de server heeft geweigerd en niets verstuurd', () => {
    expect(isZonderAntwoord(Object.assign(new Error('Kies minstens één ontvanger'), { status: 400 }))).toBe(false);
    expect(isZonderAntwoord(Object.assign(new Error('Te veel'), { status: 429 }))).toBe(false);
    expect(isZonderAntwoord(Object.assign(new Error('Geen toegang'), { status: 403 }))).toBe(false);
  });
});
