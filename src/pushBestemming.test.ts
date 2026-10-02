// @vitest-environment node
/**
 * Welke endpoints mag een push-abonnement hebben? (beveiligingsscan 01-10,
 * keuze 10; api/_lib/pushBestemming.ts.) Vroeger passeerde elke publieke
 * https-host: een gebruiker kon zijn eigen server opgeven, of een hostnaam die
 * naar een intern adres wijst. Nu alleen de pushdiensten van de browsers.
 */
import { describe, expect, it } from 'vitest';
import { beoordeelPushBestemming } from '../api/_lib/pushBestemming';

describe('toegestane push-bestemmingen', () => {
  it.each([
    // [endpoint, host]
    ['https://fcm.googleapis.com/fcm/send/eeg8M0Ydr0Y:APA91bE5xr9wV2hLFyMuavOJ_-W4', 'fcm.googleapis.com'],
    ['https://fcm.googleapis.com/wp/dGVzdA', 'fcm.googleapis.com'],
    ['https://jmt17.google.com/fcm/send/eeg8M0Ydr0Y:APA91bE5', 'jmt17.google.com'],
    ['https://updates.push.services.mozilla.com/wpush/v2/gAAAAABm_abc-DEF', 'updates.push.services.mozilla.com'],
    ['https://web.push.apple.com/QGuQyavXutnMH9', 'web.push.apple.com'],
    ['https://api.push.apple.com/3/device/abc', 'api.push.apple.com'],
    ['https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD%2bxyz%2f%3d', 'wns2-par02p.notify.windows.com'],
    ['https://db5p.notify.windows.com/w/?token=AwYAAAC', 'db5p.notify.windows.com'],
    ['https://a.b.notify.windows.com/w/?token=AwYAAAC', 'a.b.notify.windows.com'],
  ])('laat %s door, ongewijzigd', (endpoint, host) => {
    // Een endpoint zoals een browser het aanmaakt gaat letterlijk zo de deur
    // uit: de genormaliseerde vorm is dezelfde tekst.
    expect(beoordeelPushBestemming(endpoint)).toEqual({ toegestaan: true, host, url: endpoint });
  });

  it.each([
    // [endpoint, genormaliseerd]
    ['https://FCM.GoogleAPIs.com/fcm/send/AbC', 'https://fcm.googleapis.com/fcm/send/AbC'],
    ['HTTPS://UPDATES.PUSH.SERVICES.MOZILLA.COM/wpush/v2/AbC', 'https://updates.push.services.mozilla.com/wpush/v2/AbC'],
    ['https://fcm.googleapis.com./fcm/send/AbC', 'https://fcm.googleapis.com/fcm/send/AbC'],
    ['https://WEB.PUSH.APPLE.COM./AbC', 'https://web.push.apple.com/AbC'],
    ['https://Wns2-Par02p.Notify.Windows.Com./w/?token=AbC', 'https://wns2-par02p.notify.windows.com/w/?token=AbC'],
    // Expliciet de standaardpoort is dezelfde bestemming.
    ['https://fcm.googleapis.com:443/fcm/send/AbC', 'https://fcm.googleapis.com/fcm/send/AbC'],
  ])('hoofdletters, een punt aan het einde en :443 tellen niet mee: %s', (endpoint, url) => {
    expect(beoordeelPushBestemming(endpoint)).toEqual({ toegestaan: true, host: new URL(url).hostname, url });
  });
});

describe('geweigerde push-bestemmingen', () => {
  it.each([
    // Een eigen server of een willekeurige publieke host.
    ['https://push.aanvaller.tld/x', 'push.aanvaller.tld'],
    ['https://example.com/x', 'example.com'],
    // Lijkt op een pushdienst, is het niet.
    ['https://fcm.googleapis.com.aanvaller.tld/fcm/send/x', 'fcm.googleapis.com.aanvaller.tld'],
    ['https://evil-fcm.googleapis.com/fcm/send/x', 'evil-fcm.googleapis.com'],
    ['https://evil.fcm.googleapis.com/fcm/send/x', 'evil.fcm.googleapis.com'],
    ['https://googleapis.com/fcm/send/x', 'googleapis.com'],
    ['https://xfcm.googleapis.com/fcm/send/x', 'xfcm.googleapis.com'],
    ['https://fcm.googleapis.com%2eaanvaller.tld/x', 'fcm.googleapis.com.aanvaller.tld'],
    ['https://jmt18.google.com/fcm/send/x', 'jmt18.google.com'],
    ['https://www.google.com/fcm/send/x', 'www.google.com'],
    ['https://push.services.mozilla.com/wpush/v2/x', 'push.services.mozilla.com'],
    ['https://evil.updates.push.services.mozilla.com/wpush/v2/x', 'evil.updates.push.services.mozilla.com'],
    ['https://updates.push.services.mozilla.com.aanvaller.tld/x', 'updates.push.services.mozilla.com.aanvaller.tld'],
    ['https://push.apple.com/x', 'push.apple.com'],
    ['https://a.b.push.apple.com/x', 'a.b.push.apple.com'],
    ['https://webpush.apple.com/x', 'webpush.apple.com'],
    ['https://web.push.apple.com.aanvaller.tld/x', 'web.push.apple.com.aanvaller.tld'],
    ['https://-x.push.apple.com/x', '-x.push.apple.com'],
    ['https://notify.windows.com/w/?token=x', 'notify.windows.com'],
    ['https://evilnotify.windows.com/w/?token=x', 'evilnotify.windows.com'],
    ['https://wns.notify.windows.com.aanvaller.tld/w/', 'wns.notify.windows.com.aanvaller.tld'],
    // Twee punten aan het einde is geen genormaliseerde hostnaam.
    ['https://fcm.googleapis.com../fcm/send/x', 'fcm.googleapis.com.'],
    // Geen https.
    ['http://fcm.googleapis.com/fcm/send/x', 'fcm.googleapis.com'],
    ['ftp://fcm.googleapis.com/fcm/send/x', 'fcm.googleapis.com'],
    // Een andere poort dan de standaard.
    ['https://fcm.googleapis.com:8443/fcm/send/x', 'fcm.googleapis.com'],
    ['https://fcm.googleapis.com:80/fcm/send/x', 'fcm.googleapis.com'],
    ['https://web.push.apple.com:4443/x', 'web.push.apple.com'],
    // Aanmeldgegevens in de URL, ook als de host daarna klopt.
    ['https://gebruiker:geheim@fcm.googleapis.com/fcm/send/x', 'fcm.googleapis.com'],
    ['https://gebruiker@fcm.googleapis.com/fcm/send/x', 'fcm.googleapis.com'],
    ['https://fcm.googleapis.com@aanvaller.tld/x', 'aanvaller.tld'],
    ['https://fcm.googleapis.com:443@aanvaller.tld/x', 'aanvaller.tld'],
    // IP-adressen, publiek of intern, in elke schrijfwijze.
    ['https://142.250.179.170/fcm/send/x', '142.250.179.170'],
    ['https://127.0.0.1/x', '127.0.0.1'],
    ['https://169.254.169.254/latest/meta-data', '169.254.169.254'],
    ['https://10.0.0.5/x', '10.0.0.5'],
    ['https://0x7f.1/x', '127.0.0.1'],
    ['https://2130706433/x', '127.0.0.1'],
    ['https://[::1]/x', '[::1]'],
    ['https://[2a00:1450:400e:80c::200a]/fcm/send/x', '[2a00:1450:400e:80c::200a]'],
    // Interne namen: de oude controle liet een naam door die naar binnen wijst.
    ['https://localhost/x', 'localhost'],
    ['https://localtest.me/x', 'localtest.me'],
    ['https://metadata.google.internal/x', 'metadata.google.internal'],
  ])('weigert %s', (endpoint, host) => {
    expect(beoordeelPushBestemming(endpoint)).toEqual({ toegestaan: false, host });
  });

  it.each([[''], ['geen url'], ['//fcm.googleapis.com/x'], ['fcm.googleapis.com/fcm/send/x'], [null], [undefined], [42], [{ endpoint: 'https://fcm.googleapis.com/x' }]])(
    'weigert wat geen URL is: %j',
    (endpoint) => {
      expect(beoordeelPushBestemming(endpoint)).toEqual({ toegestaan: false, host: null });
    },
  );
});

describe('de aanroep gaat naar de genormaliseerde URL', () => {
  // web-push leest het endpoint met de oude url.parse; de controle met
  // `new URL`. Leest de ene parser een andere host dan de andere, dan zou een
  // goedgekeurde tekst toch elders uitkomen. Daarom wordt de URL opnieuw
  // opgebouwd uit wat de controle las.
  it.each([
    // Een backslash is voor `new URL` een schuine streep: de rest is pad.
    ['https://fcm.googleapis.com\\@aanvaller.tld/x', 'https://fcm.googleapis.com/@aanvaller.tld/x'],
    // Tabs en regeleinden vallen weg, spaties aan de rand ook.
    [' https://fcm.googleapis.com/fcm/send/x\n', 'https://fcm.googleapis.com/fcm/send/x'],
    ['https://fcm.goog\tleapis.com/fcm/send/x', 'https://fcm.googleapis.com/fcm/send/x'],
    // Het fragment gaat nooit naar een server.
    ['https://fcm.googleapis.com/fcm/send/x#@aanvaller.tld', 'https://fcm.googleapis.com/fcm/send/x'],
    // Een leeg stuk vóór het apenstaartje verdwijnt.
    ['https://@fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com/fcm/send/x'],
  ])('%j wordt %s', (endpoint, url) => {
    const oordeel = beoordeelPushBestemming(endpoint);
    expect(oordeel).toEqual({ toegestaan: true, host: 'fcm.googleapis.com', url });
    // De opnieuw opgebouwde URL leest elke parser als dezelfde, toegestane host.
    expect(new URL(url).hostname).toBe('fcm.googleapis.com');
    expect(url.startsWith('https://fcm.googleapis.com/')).toBe(true);
  });
});
