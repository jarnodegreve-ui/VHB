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

  it('brusselseMinuten leest de Brusselse klok', () => {
    // 2026-09-24T10:00Z = 12:00 in Brussel (zomertijd).
    expect(brusselseMinuten(new Date('2026-09-24T10:00:00Z'))).toBe(12 * 60);
  });
});
