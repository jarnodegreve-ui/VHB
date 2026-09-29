import { describe, expect, it } from 'vitest';
import { bouwMail, IPHONE_REGEL } from '../api/_lib/mailLayout';

/**
 * De vaste mail-lay-out (mailtranche PR 2): één opbouw, twee versies. De
 * HTML moet zonder externe CSS werken (tabellen, inline stijlen), alles wat
 * van een gebruiker komt moet ge-escaped zijn, en de tekstversie moet
 * dezelfde inhoud dragen.
 */
describe('bouwMail', () => {
  const basis = {
    portaalUrl: 'https://vhbportaal.com',
    kicker: 'Verlof',
    titel: 'Verlofaanvraag afgewezen',
    status: { label: 'Afgewezen', toon: 'fout' as const },
    aanhef: 'Hallo Jan,',
    alineas: ['Je verlofaanvraag is afgewezen door Planning.'],
    feiten: [{ label: 'Periode', waarde: '06/10/2026 t/m 10/10/2026' }, { label: 'Type', waarde: 'Betaald verlof' }],
    blok: { kop: 'Reden', tekst: 'Te veel collega\'s vrij.\nProbeer een andere week.' },
    knop: { tekst: 'Bekijk in het portaal', url: 'https://vhbportaal.com/verlof' },
    voet: 'Vragen? Bel de planning.',
  };

  it('bouwt HTML met logo, statuspuntje, feitenlijst, blok en één knop', () => {
    const { html } = bouwMail(basis);
    expect(html).toContain('<img src="https://vhbportaal.com/mail/vhb-logo.png"');
    expect(html).toContain('VERLOF');
    expect(html).toContain('<h1');
    expect(html).toContain('Verlofaanvraag afgewezen');
    expect(html).toContain('border-radius: 5px; background-color: #C64F63');
    expect(html).toContain('Periode</td>');
    expect(html).toContain('06/10/2026 t/m 10/10/2026');
    expect(html).toContain('REDEN');
    expect(html).toContain('white-space: pre-wrap');
    expect((html.match(/<a href="https:\/\/vhbportaal\.com\/verlof"/g) ?? []).length).toBe(1);
    expect(html).toContain('niet beantwoorden');
    // Geen externe stylesheet, geen flex: alleen tabellen en inline stijlen.
    expect(html).not.toMatch(/<link|display:\s*flex/);
    expect(html).not.toContain(' — ');
  });

  it('escapet gebruikersinvoer in titel, alinea, feiten, blok en knop', () => {
    const { html } = bouwMail({
      ...basis,
      titel: '<script>alert(1)</script>',
      alineas: ['Tom & Jerry <b>'],
      feiten: [{ label: 'Wie', waarde: '"Jan" <jan@x.be>' }],
      blok: { kop: 'Reden', tekst: '<img src=x onerror=alert(1)>' },
      knop: { tekst: 'Klik', url: 'https://x.test/?a=1&b="2"' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Tom &amp; Jerry &lt;b&gt;');
    expect(html).toContain('&quot;Jan&quot; &lt;jan@x.be&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('href="https://x.test/?a=1&amp;b=&quot;2&quot;"');
  });

  it('laat bewust rauwe HTML door in een alinea, met eigen tekstversie', () => {
    const { html, text } = bouwMail({ ...basis, alineas: [{ html: '<pre>openssl enc -d</pre>', tekst: '  openssl enc -d' }] });
    expect(html).toContain('<pre>openssl enc -d</pre>');
    expect(text).toContain('  openssl enc -d');
  });

  it('tekstversie draagt dezelfde inhoud, in leesvolgorde', () => {
    const { text } = bouwMail({ ...basis, lijst: { kop: 'Openstaande dienst(en)', items: ['wo 2 sep, 4407', 'do 3 sep, 4408'] } });
    const volgorde = ['VERLOF', 'Verlofaanvraag afgewezen', 'Status: Afgewezen', 'Hallo Jan,', 'Je verlofaanvraag is afgewezen', 'Periode: 06/10/2026 t/m 10/10/2026', 'Openstaande dienst(en)', '- wo 2 sep, 4407', 'Reden: Te veel', 'Bekijk in het portaal: https://vhbportaal.com/verlof', 'Vragen? Bel de planning.', 'niet beantwoorden', 'https://vhbportaal.com'];
    let vorige = -1;
    for (const stuk of volgorde) {
      const i = text.indexOf(stuk, vorige + 1);
      expect(i, stuk).toBeGreaterThan(vorige);
      vorige = i;
    }
    // Secties gescheiden door één witregel, nooit meer.
    expect(text).toContain('Hallo Jan,\n\nJe verlofaanvraag');
    expect(text).not.toContain('<');
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('de knop houdt zijn marge in Outlook: marge en achtergrond op de cel, de link blijft volledig aanklikbaar', () => {
    const { html } = bouwMail(basis);
    const cel = html.match(/<td[^>]*>\s*<a href="https:\/\/vhbportaal\.com\/verlof"[^>]*>/)?.[0] ?? '';
    // Outlook (Word-motor) leest de padding van een <a> niet, wel die van de cel.
    expect(cel).toContain('bgcolor="#0D0D0F"');
    expect(cel).toMatch(/<td[^>]*style="[^"]*background-color: #0D0D0F;[^"]*mso-padding-alt: 12px 22px;/);
    // Andere clients: de padding blijft op de link, dus hetzelfde beeld en de hele knop klikbaar.
    expect(cel).toMatch(/<a [^>]*style="display: inline-block; padding: 12px 22px; mso-padding-alt: 0;/);
  });

  it('onder een knop staat één regel voor iPhone, in HTML en tekst; zonder knop niet', () => {
    const { html, text } = bouwMail(basis);
    expect(html).toContain('Op iPhone open je beter de app op je beginscherm, daar ben je al aangemeld.');
    expect((html.match(/Op iPhone/g) ?? []).length).toBe(1);
    // In de stijl van de voetregels: klein en gedempt, ná de knop.
    expect(html.indexOf('Op iPhone')).toBeGreaterThan(html.indexOf('Bekijk in het portaal</a>'));
    expect(html).toMatch(/<p style="margin: 0 0 6px; font-size: 12px; line-height: 1\.6; color: #6E767F;">Op iPhone/);
    expect(text).toContain('Bekijk in het portaal: https://vhbportaal.com/verlof\nOp iPhone open je beter de app op je beginscherm, daar ben je al aangemeld.');
    const zonder = bouwMail({ ...basis, knop: undefined });
    expect(zonder.html).not.toContain('Op iPhone');
    expect(zonder.text).not.toContain('Op iPhone');
  });

  it('een knop met een eenmalige link (actie) zegt waar je daarna verder gaat, niet dat je de link moet overslaan', () => {
    const { html, text } = bouwMail({ ...basis, knop: { tekst: 'Wachtwoord instellen', url: 'https://x.test/token', actie: true } });
    expect(html).toContain(IPHONE_REGEL.actie);
    expect(html).not.toContain(IPHONE_REGEL.portaal);
    expect(text).toContain(IPHONE_REGEL.actie);
    expect(IPHONE_REGEL.actie).not.toContain(' — ');
    expect(IPHONE_REGEL.portaal).not.toContain(' — ');
  });

  it('zonder status, feiten, blok of knop blijft de opbouw geldig en leeg waar niets is', () => {
    const { html, text } = bouwMail({ portaalUrl: 'https://vhbportaal.com', titel: 'Testmail', nietBeantwoorden: false });
    expect(html).toContain('Testmail');
    expect(html).not.toContain('border-radius: 5px; background-color');
    expect(html).not.toContain('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 4px 0 18px');
    expect(html).not.toContain('niet beantwoorden');
    expect(text.trim().split('\n')[0]).toBe('Testmail');
  });
});
