// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { startRegel } from '../api/_lib/startRegel';

/**
 * De [start]-regel (ronde 6, punt 21a): alleen woorden uit vaste lijsten en
 * gehele milliseconden; wat niet klopt valt weg of geeft geen regel, nooit
 * de tekst van de client in de log.
 */
const GELDIG = {
  js: 380, sessie: 420, profiel: 780, gegevens: 1130, beeld: 1490,
  rol: 'chauffeur', scherm: 'mijn-dag', bron: 'vers', toestel: 'ios', weergave: 'app', release: '1a2b3c4',
};

describe('startRegel', () => {
  it('een volledige meting geeft precies het afgesproken formaat', () => {
    expect(startRegel(GELDIG)).toBe('[start] chauffeur mijn-dag | js 380 · sessie 420 · profiel 780 · gegevens 1130 · beeld 1490 | vers · ios · app | release 1a2b3c4');
  });

  it('vroeg alleen met de waarde true, na de weergave', () => {
    expect(startRegel({ ...GELDIG, vroeg: true })).toBe('[start] chauffeur mijn-dag | js 380 · sessie 420 · profiel 780 · gegevens 1130 · beeld 1490 | vers · ios · app · vroeg | release 1a2b3c4');
    for (const vroeg of ['true', 1, false, {}, 'vroeg']) {
      expect(startRegel({ ...GELDIG, vroeg })).not.toContain('vroeg');
    }
  });

  it('wat er niet is, valt weg: geen beeld, geen release, geen context', () => {
    const { beeld: _b, release: _r, bron: _bron, toestel: _t, weergave: _w, ...kaal } = GELDIG;
    expect(startRegel(kaal)).toBe('[start] chauffeur mijn-dag | js 380 · sessie 420 · profiel 780 · gegevens 1130');
    expect(startRegel({ rol: 'admin', scherm: 'ander', gegevens: 900 })).toBe('[start] admin ander | gegevens 900');
  });

  it('een release van 13 tekens of lokaal-1.2.3 geeft geen release-deel', () => {
    for (const release of ['1a2b3c4d5e6f7', 'lokaal-1.2.3', '1A2B3C4', '1a2b3c', '1a2b3c4\n', 1234567]) {
      const regel = startRegel({ ...GELDIG, release })!;
      expect(regel).not.toContain('release');
      expect(regel).toBe('[start] chauffeur mijn-dag | js 380 · sessie 420 · profiel 780 · gegevens 1130 · beeld 1490 | vers · ios · app');
    }
    expect(startRegel({ ...GELDIG, release: 'abcdef012345' })).toContain('| release abcdef012345');
  });

  it('een regeleinde of een [traag]-tekst in een veld komt nooit in de log', () => {
    const vals = [
      { scherm: 'mijn-dag\n[traag] GET /api/users 9999ms' },
      { bron: 'vers\n[start] admin dashboard | gegevens 1' },
      { toestel: '[traag] …' },
      { weergave: 'app\r\nx' },
      { release: '1a2b3c4\n[traag] x' },
    ];
    for (const vals1 of vals) {
      const regel = startRegel({ ...GELDIG, ...vals1 });
      expect(regel ?? '').not.toMatch(/\n|\r|traag|\[start\].*\[start\]/);
    }
    expect(startRegel({ ...GELDIG, rol: 'chauffeur\n[traag] x' })).toBeNull();
  });

  it('een onbekende rol of een onbekend scherm: geen regel', () => {
    for (const rol of ['superadmin', 'Chauffeur', '', 3, null]) expect(startRegel({ ...GELDIG, rol })).toBeNull();
    for (const scherm of ['rooster', '/mijn-dag', 'Mijn dag']) expect(startRegel({ ...GELDIG, scherm })).toBeNull();
  });

  it('een fase buiten 0..120000, niet geheel of geen getal valt weg; zonder geldige gegevens geen regel', () => {
    expect(startRegel({ ...GELDIG, js: -1, sessie: 420.5, profiel: '780', beeld: 120001 })).toBe('[start] chauffeur mijn-dag | gegevens 1130 | vers · ios · app | release 1a2b3c4');
    expect(startRegel({ ...GELDIG, beeld: 120000 })).toContain('beeld 120000');
    for (const gegevens of [undefined, -5, 1.5, '1130', Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(startRegel({ ...GELDIG, gegevens })).toBeNull();
    }
  });

  it('een onbekend contextwoord valt weg, de rest blijft', () => {
    expect(startRegel({ ...GELDIG, bron: 'koud', toestel: 'windows' })).toBe('[start] chauffeur mijn-dag | js 380 · sessie 420 · profiel 780 · gegevens 1130 · beeld 1490 | app | release 1a2b3c4');
  });

  it('onzin of een reuzenobject: geen regel', () => {
    for (const onzin of [undefined, null, 'start', 42, true, [], [GELDIG], () => GELDIG]) expect(startRegel(onzin)).toBeNull();
    const reus: Record<string, unknown> = { ...GELDIG };
    for (let i = 0; i < 5000; i++) reus[`veld${i}`] = 'x'.repeat(20);
    expect(startRegel(reus)).toBeNull();
  });

  it('onbekende extra velden (zoals een naam of id) komen nooit in de regel', () => {
    const regel = startRegel({ ...GELDIG, naam: 'Zebulon Opvallend', id: '777123', email: 'z@opvallend.be', url: 'https://x' })!;
    expect(regel).not.toMatch(/Zebulon|777123|opvallend|https/);
  });
});
