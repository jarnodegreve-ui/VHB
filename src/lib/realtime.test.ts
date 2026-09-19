import { describe, expect, it } from 'vitest';
import { VOLLEDIG_INTERVAL_MS, WEG_DREMPEL_MS, kiesCatchUp } from './realtime';

/**
 * Refetch-regime bij terugkeer naar het tabblad (ronde 3, 19-09). De
 * socket-reconnect loopt niet via deze keuze: die is altijd volledig.
 */
describe('kiesCatchUp', () => {
  const min = 60_000;

  it('korter dan de drempel weg: niets', () => {
    expect(kiesCatchUp(5_000, 60 * min)).toBe('geen');
    expect(kiesCatchUp(WEG_DREMPEL_MS, 60 * min)).toBe('geen');
  });

  it('tussen 60 s weg en 5 min na de laatste volledige ronde: alleen de lichte set', () => {
    expect(kiesCatchUp(WEG_DREMPEL_MS + 1, 2 * min)).toBe('licht');
    expect(kiesCatchUp(3 * min, VOLLEDIG_INTERVAL_MS - 1)).toBe('licht');
  });

  it('laatste volledige ronde 5 min of langer geleden: de volledige set', () => {
    expect(kiesCatchUp(2 * min, VOLLEDIG_INTERVAL_MS)).toBe('volledig');
    expect(kiesCatchUp(8 * 60 * min, 8 * 60 * min)).toBe('volledig');
  });

  it('niet vaker dan 1x per 5 min volledig: vlak na een volledige ronde blijft het licht', () => {
    // Twee keer kort na elkaar wisselen van tabblad, telkens > 60 s weg.
    expect(kiesCatchUp(90_000, 0)).toBe('licht');
    expect(kiesCatchUp(90_000, 90_000)).toBe('licht');
  });
});
