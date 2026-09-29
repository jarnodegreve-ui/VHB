import { describe, expect, it } from 'vitest';
import { brusselseMinuten, dienstGereden, eindtijdMinuten } from './dienstGereden';

describe('dienstGereden (J, 24-09)', () => {
  const vandaag = '2026-09-24';
  const tweeDelen = { date: vandaag, delen: [{ endTime: '07:52' }, { endTime: '17:29' }] };

  it('gisteren is gereden, morgen niet', () => {
    expect(dienstGereden({ date: '2026-09-23', delen: [{ endTime: '17:29' }] }, vandaag, 0)).toBe(true);
    expect(dienstGereden({ date: '2026-09-25', delen: [{ endTime: '05:00' }] }, vandaag, 23 * 60)).toBe(false);
  });

  it('vandaag: pas gereden na het einde van het laatste deel', () => {
    expect(dienstGereden(tweeDelen, vandaag, 8 * 60)).toBe(false); // eerste deel voorbij, tweede nog niet
    expect(dienstGereden(tweeDelen, vandaag, 17 * 60 + 28)).toBe(false);
    expect(dienstGereden(tweeDelen, vandaag, 17 * 60 + 29)).toBe(true);
  });

  it('busvak-eindtijd na middernacht telt door op de dienstdag', () => {
    const nacht = { date: vandaag, delen: [{ endTime: '26:16' }] };
    expect(dienstGereden(nacht, vandaag, 23 * 60 + 59)).toBe(false);
    // Kalenderdag erna: de dienst van gisteren is gereden zodra 02:16 voorbij is; in
    // minuten van de dienstdag is dat 26:16, en de dag zelf ligt in het verleden.
    expect(dienstGereden(nacht, '2026-09-25', 60)).toBe(true);
  });

  it('zonder leesbare eindtijd: niet gereden (veilige kant)', () => {
    expect(dienstGereden({ date: vandaag, delen: [{ endTime: '' }] }, vandaag, 23 * 60)).toBe(false);
    expect(eindtijdMinuten('48:00')).toBeNull();
    expect(eindtijdMinuten('26:16')).toBe(26 * 60 + 16);
  });

  it('het einde van een deel volgt deelVenster (Jarno 29-09): 22:00-06:00, 16:00-00:00, 08:00-32:00 en 08:00-08:00', () => {
    const deel = (startTime: string, endTime: string) => ({ date: vandaag, delen: [{ startTime, endTime }] });
    // 22:00 tot 06:00 op D eindigt de dag erna: om 07:00 op D nog niet gereden (vroeger wel), de hele dag niet.
    expect(dienstGereden(deel('22:00', '06:00'), vandaag, 7 * 60)).toBe(false);
    expect(dienstGereden(deel('22:00', '06:00'), vandaag, 23 * 60 + 59)).toBe(false);
    // 16:00 tot 00:00 eindigt om middernacht: om 20:00 op D nog niet gereden (vroeger de hele dag).
    expect(dienstGereden(deel('16:00', '00:00'), vandaag, 20 * 60)).toBe(false);
    // Busvak-notatie verandert niet: 22:00 tot 30:00 en 08:00 tot 32:00 lopen de nacht door.
    expect(dienstGereden(deel('22:00', '30:00'), vandaag, 7 * 60)).toBe(false);
    expect(dienstGereden(deel('08:00', '32:00'), vandaag, 23 * 60 + 59)).toBe(false);
    // Na middernacht blijft de regel van 24-09: de dienstdag ligt in het verleden.
    expect(dienstGereden(deel('22:00', '06:00'), '2026-09-25', 60)).toBe(true);
    // Gelijke begin- en eindtijd is ongeldig en telt zoals vroeger alleen met de eindtijd.
    expect(dienstGereden(deel('08:00', '08:00'), vandaag, 8 * 60 - 1)).toBe(false);
    expect(dienstGereden(deel('08:00', '08:00'), vandaag, 8 * 60)).toBe(true);
    // Een einde dat ook na +24 u niet na de start ligt, evenmin een venster:
    // 24:30 tot 00:00 telt zoals vroeger alleen met de eindtijd, 00:00.
    expect(dienstGereden(deel('24:30', '00:00'), vandaag, 0)).toBe(true);
    expect(dienstGereden(deel('30:00', '06:00'), vandaag, 6 * 60)).toBe(true);
  });

  it('gesplitst: een ongeldig deel naast een nachtdeel, het nachtdeel beslist; zonder begintijd telt de eindtijd', () => {
    const gesplitst = { date: vandaag, delen: [{ startTime: '08:00', endTime: '08:00' }, { startTime: '22:00', endTime: '06:00' }] };
    expect(dienstGereden(gesplitst, vandaag, 9 * 60)).toBe(false);
    // Zonder leesbare begintijd weten we alleen de eindtijd: zoals vroeger.
    expect(dienstGereden({ date: vandaag, delen: [{ startTime: '', endTime: '06:00' }] }, vandaag, 7 * 60)).toBe(true);
    expect(dienstGereden({ date: vandaag, delen: [{ endTime: '06:00' }] }, vandaag, 7 * 60)).toBe(true);
  });

  it('brusselseMinuten leest de Brusselse klok', () => {
    // 2026-09-24T10:00Z = 12:00 in Brussel (zomertijd).
    expect(brusselseMinuten(new Date('2026-09-24T10:00:00Z'))).toBe(12 * 60);
  });
});
