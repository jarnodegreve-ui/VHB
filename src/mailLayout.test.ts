import fs from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { bouwMail, IPHONE_REGEL, VOET } from '../api/_lib/mailLayout';

/**
 * De vaste mail-lay-out (mailtranche PR 2, nieuw kader 30-09): één opbouw,
 * twee versies. De HTML moet zonder externe CSS werken (tabellen, inline
 * stijlen), alles wat van een gebruiker komt moet ge-escaped zijn, en de
 * tekstversie moet dezelfde inhoud dragen.
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

  it('bouwt HTML met logo, label met statuspil, feiten, blok en één knop', () => {
    const { html } = bouwMail(basis);
    expect(html).toContain('<img src="https://vhbportaal.com/mail/vhb-logo.png"');
    // Label in hoofdletters via CSS; de bron houdt de gewone schrijfwijze.
    expect(html).toMatch(/text-transform: uppercase;[^"]*">Verlof<\/td>/);
    expect(html).toContain('<h1');
    expect(html).toContain('Verlofaanvraag afgewezen');
    // Status als pil in de tint van de toon, met een stip in de statuskleur.
    expect(html).toContain('background-color: #FAEEF1;');
    expect(html).toMatch(/<span style="color: #C94F6D; font-size: 10px;">&#9679;<\/span>&nbsp;&nbsp;Afgewezen<\/span>/);
    expect(html).toContain('Periode</td>');
    expect(html).toContain('06/10/2026 t/m 10/10/2026');
    // Het blok houdt zijn vlak met de gouden streep (Jarno 30-09); regeleinden blijven.
    expect(html).toContain('border-left: 3px solid #E2A323;');
    expect(html).toMatch(/text-transform: uppercase;[^"]*">Reden<\/p>/);
    expect(html).toContain('white-space: pre-wrap');
    expect((html.match(/<a href="https:\/\/vhbportaal\.com\/verlof"/g) ?? []).length).toBe(1);
    expect(html).toContain('niet beantwoorden');
    expect(html).toContain('Van Hoorebeke &amp; Zoon');
    // Geen externe stylesheet, geen flex: alleen tabellen en inline stijlen.
    expect(html).not.toMatch(/<link|display:\s*flex/);
    expect(html).not.toContain(' — ');
  });

  it('escapet gebruikersinvoer in label, titel, voorbeeldregel, alinea, feiten, lijst, blok en knop', () => {
    const { html } = bouwMail({
      ...basis,
      kicker: 'Tom & Jerry',
      titel: '<script>alert(1)</script>',
      voorbeeld: 'Reden: <b>',
      alineas: ['Tom & Jerry <b>'],
      feiten: [{ label: 'Wie', waarde: '"Jan" <jan@x.be>' }],
      lijst: { kop: 'Kop <i>', items: ['<u>item</u>'], tag: '<s>' },
      blok: { kop: 'Reden', tekst: '<img src=x onerror=alert(1)>' },
      knop: { tekst: 'Klik', url: 'https://x.test/?a=1&b="2"' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('>Tom &amp; Jerry</td>');
    expect(html).not.toContain('&AMP;');
    expect(html).toContain('Reden: &lt;b&gt;');
    expect(html).toContain('Tom &amp; Jerry &lt;b&gt;');
    expect(html).toContain('&quot;Jan&quot; &lt;jan@x.be&gt;');
    expect(html).toContain('Kop &lt;i&gt;');
    expect(html).toContain('&lt;u&gt;item&lt;/u&gt;');
    expect(html).toContain('&lt;S&gt;');
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
    const volgorde = ['VERLOF', 'Verlofaanvraag afgewezen', 'Status: Afgewezen', 'Hallo Jan,', 'Je verlofaanvraag is afgewezen', 'Periode: 06/10/2026 t/m 10/10/2026', 'Openstaande dienst(en)', '- wo 2 sep, 4407', 'Reden: Te veel', 'Bekijk in het portaal: https://vhbportaal.com/verlof', 'Vragen? Bel de planning.', 'VHB · Van Hoorebeke & Zoon', 'niet beantwoorden', 'https://vhbportaal.com'];
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

  it('volgt de gekozen volgorde, in HTML én tekst (omleiding: feiten eerst)', () => {
    const { html, text } = bouwMail({ ...basis, volgorde: ['feiten', 'blok', 'alineas', 'lijsten'] });
    // Vanaf de titel zoeken: de verborgen voorbeeldregel bovenaan draagt de eerste alinea ook.
    const na = (stuk: string) => html.indexOf(stuk, html.indexOf('<h1'));
    expect(na('Periode</td>')).toBeLessThan(na('>Reden</p>'));
    expect(na('>Reden</p>')).toBeLessThan(na('Je verlofaanvraag is afgewezen'));
    expect(text.indexOf('Periode: ')).toBeLessThan(text.indexOf('Reden: '));
    expect(text.indexOf('Reden: ')).toBeLessThan(text.indexOf('Je verlofaanvraag is afgewezen'));
  });

  it('lijsten met fijne lijnen, een label per item en een vaste letter voor technische regels; het label niet in de tekst', () => {
    const { html, text } = bouwMail({
      ...basis,
      feitenKop: 'Afgelopen 7 dagen',
      lijsten: [{ kop: 'In bijlage', items: ['plan.pdf'], tag: 'PDF' }, { kop: 'Meldingen', items: ['2× [error-toast] x'], technisch: true }],
    });
    expect(html).toMatch(/text-transform: uppercase;[^"]*">In bijlage<\/p>/);
    expect(html).toMatch(/>PDF<\/span><\/td><td[^>]*>plan\.pdf<\/td>/);
    expect(html).toMatch(/font-family: ui-monospace[^"]*">2× \[error-toast\] x<\/td>/);
    expect(text).toContain('Afgelopen 7 dagen\nPeriode: 06/10/2026 t/m 10/10/2026');
    expect(text).toContain('In bijlage\n- plan.pdf');
    expect(text).not.toContain('[PDF]');
  });

  it('zet een verborgen voorbeeldregel voor de inbox: de eigen tekst, anders de eerste alinea, nooit in de tekstversie', () => {
    const eigen = bouwMail({ ...basis, voorbeeld: 'Reden:  te veel\ncollega\'s vrij' });
    // Vóór alles, zodat de inbox niet met het label begint; lege tekens erna.
    expect(eigen.html).toMatch(/<body[^>]*>\s*<div style="display: none;[^"]*">Reden: te veel collega&#39;s vrij(&#847;&zwnj;&nbsp;)+<\/div>/);
    expect(eigen.text).not.toContain('Reden: te veel collega');
    const standaard = bouwMail(basis);
    expect(standaard.html).toMatch(/<div style="display: none;[^"]*">Je verlofaanvraag is afgewezen door Planning\.&#847;/);
    const leeg = bouwMail({ portaalUrl: 'https://vhbportaal.com', titel: 'Testmail' });
    expect(leeg.html).not.toContain('display: none;');
  });

  it('de knop houdt zijn marge in Outlook: marge en achtergrond op de cel, de link blijft volledig aanklikbaar', () => {
    const { html } = bouwMail(basis);
    const cel = html.match(/<td[^>]*>\s*<a href="https:\/\/vhbportaal\.com\/verlof"[^>]*>/)?.[0] ?? '';
    // Outlook (Word-motor) leest de padding van een <a> niet, wel die van de cel.
    expect(cel).toContain('bgcolor="#E2A323"');
    expect(cel).toMatch(/<td[^>]*style="[^"]*background-color: #E2A323;[^"]*mso-padding-alt: 13px 24px;/);
    // Andere clients: de padding blijft op de link, dus hetzelfde beeld en de hele knop klikbaar.
    expect(cel).toMatch(/<a [^>]*style="display: inline-block; padding: 13px 24px; mso-padding-alt: 0;/);
    // Inkt op goud, zoals .btn-primary: wit op goud haalt maar 2,2:1.
    expect(cel).toMatch(/<a [^>]*style="[^"]*color: #14181B;/);
  });

  it('onder een knop staat één regel voor iPhone, in HTML en tekst; zonder knop niet', () => {
    const { html, text } = bouwMail(basis);
    expect(html).toContain('Op iPhone open je beter de app op je beginscherm, daar ben je al aangemeld.');
    expect((html.match(/Op iPhone/g) ?? []).length).toBe(1);
    // In de stijl van de voetregels: klein en gedempt, ná de knop.
    expect(html.indexOf('Op iPhone')).toBeGreaterThan(html.indexOf('Bekijk in het portaal</a>'));
    expect(html).toMatch(/<p style="margin: 0 0 6px; font-size: 12px; line-height: 18px; color: #656D76;">Op iPhone/);
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

  it('een systeemmail voor admins (doelgroep beheer) heeft geen iPhone-regel en geen verwijzing naar de planning', () => {
    const { html, text } = bouwMail({ ...basis, doelgroep: 'beheer' });
    expect(html).not.toContain('Op iPhone');
    expect(text).not.toContain('Op iPhone');
    expect(html).toContain(VOET.beheer);
    expect(html).not.toContain('Contacteer de planning');
    expect(text).toContain('Bekijk in het portaal: https://vhbportaal.com/verlof\n\nVragen? Bel de planning.');
  });

  it('laadt Manrope van het portaal zelf (nooit van Google), buiten het zicht van Outlook, en zet elk stijlblok apart', () => {
    const { html } = bouwMail(basis);
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain("src: url('https://vhbportaal.com/fonts/manrope-latin.woff2') format('woff2')");
    expect(head).not.toMatch(/googleapis|gstatic/);
    // Binnen @media screen: Outlook (Word-motor) leest dat niet en viel anders terug op Times New Roman.
    expect(head).toMatch(/@media screen \{\s*@font-face \{ font-family: 'Manrope'/);
    expect(html).toMatch(/<h1 class="vhb-titel" style="[^"]*font-family: Manrope, /);
    // Gmail gooit een heel <style>-blok weg als het één regel niet kent: lettertype,
    // smalle opmaak en de links van Apple Mail staan elk in een eigen blok.
    const blokken = head.split('<style>').slice(1).map((b) => b.slice(0, b.indexOf('</style>')));
    for (const regel of ['@font-face', 'max-width: 520px', 'x-apple-data-detectors']) {
      expect(blokken.filter((b) => b.includes(regel)), regel).toHaveLength(1);
    }
    for (const b of blokken) {
      expect(['@font-face', 'max-width: 520px', 'x-apple-data-detectors'].filter((r) => b.includes(r)).length).toBeLessThanOrEqual(1);
    }
  });

  it('zegt dat de mail licht ontworpen is (color-scheme) en toont het logo op zijn tegel van 160 × 45', () => {
    const { html } = bouwMail(basis);
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('<meta name="color-scheme" content="light">');
    expect(head).toContain('<meta name="supported-color-schemes" content="light">');
    expect(html).toContain('<img src="https://vhbportaal.com/mail/vhb-logo.png" width="160" height="45"');
    // 8 px minder marge op de cel dan de tekst (40): de tegel brengt er zelf 8 mee.
    expect(html).toMatch(/<td class="vhb-logo" style="padding: 32px 32px 0;">\s*<img/);
  });

  it('zonder status, feiten, blok of knop blijft de opbouw geldig en leeg waar niets is', () => {
    const { html, text } = bouwMail({ portaalUrl: 'https://vhbportaal.com', titel: 'Testmail', nietBeantwoorden: false });
    expect(html).toContain('Testmail');
    expect(html).not.toContain('border-radius: 11px; background-color');
    expect(html).not.toContain('border-collapse: separate');
    expect(html).not.toContain('border-left: 3px solid');
    expect(html).not.toContain('Op iPhone');
    expect(html).not.toContain('niet beantwoorden');
    expect(text.trim().split('\n')[0]).toBe('Testmail');
  });
});

/**
 * Het logo in de mails (nr. 4): Gmail en Outlook keren in dark mode de
 * achtergrond om en laten afbeeldingen staan. Een transparant logo met
 * carbon letters verdween daar; de witte tegel zit daarom in de PNG zelf.
 */
describe('public/mail/vhb-logo.png', () => {
  const lees = (pad: string) => PNG.sync.read(fs.readFileSync(pad));
  const logo = lees('public/mail/vhb-logo.png');
  const bron = lees('brand/mail/vhb-logo-transparant.png');
  const pixel = (p: PNG, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];

  it('is 800 × 224 (200 × 56 in de mail) met een dekkende witte tegel achter het logo', () => {
    expect([logo.width, logo.height]).toEqual([800, 224]);
    // Rand van de tegel, midden boven en links: dekkend wit.
    expect(pixel(logo, 400, 4)).toEqual([255, 255, 255, 255]);
    expect(pixel(logo, 4, 112)).toEqual([255, 255, 255, 255]);
    // Waar de bron doorzichtig was (tussen merk en naam) staat nu wit, niets doorzichtigs.
    let doorzichtigInTegel = 0;
    for (let y = 32; y < logo.height - 32; y += 1) {
      for (let x = 0; x < logo.width; x += 1) if (pixel(logo, x, y)[3] !== 255) doorzichtigInTegel += 1;
    }
    expect(doorzichtigInTegel).toBe(0);
  });

  it('heeft afgeronde, doorzichtige hoeken', () => {
    for (const [x, y] of [[0, 0], [799, 0], [0, 223], [799, 223]]) expect(pixel(logo, x, y)[3]).toBe(0);
  });

  it('laat het logo zelf ongemoeid: elke dekkende pixel van de bron staat er ongewijzigd, ook het goud', () => {
    let vergeleken = 0;
    let goud = 0;
    for (let y = 0; y < bron.height; y += 1) {
      for (let x = 0; x < bron.width; x += 1) {
        const b = pixel(bron, x, y);
        if (b[3] !== 255) continue;
        vergeleken += 1;
        if (b[0] === 202 && b[1] === 160 && b[2] === 68) goud += 1;
        expect(pixel(logo, x + 40, y + 41)).toEqual(b);
      }
    }
    expect(vergeleken).toBeGreaterThan(15_000);
    expect(goud).toBeGreaterThan(500);
  });
});
