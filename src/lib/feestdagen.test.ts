import { describe, expect, it } from 'vitest';
import { parseExtraFeestdagenLos } from '../../shared/feestdagen';

describe('parseExtraFeestdagenLos (zod-vrij, startbundel)', () => {
  it('leest een geldig antwoord en sorteert op datum', () => {
    expect(parseExtraFeestdagenLos({ extra: [
      { id: 'b', datum: '2026-12-24', naam: 'Sluiting' },
      { id: 'a', datum: '2026-05-15', naam: ' Brugdag ' },
    ] })).toEqual([{ id: 'a', datum: '2026-05-15', naam: 'Brugdag' }, { id: 'b', datum: '2026-12-24', naam: 'Sluiting' }]);
  });
  it('laat rommel weg en geeft leeg bij een verkeerde vorm', () => {
    expect(parseExtraFeestdagenLos([])).toEqual([]);
    expect(parseExtraFeestdagenLos(null)).toEqual([]);
    expect(parseExtraFeestdagenLos({ extra: [{ id: 'x', datum: '15/05/2026', naam: 'Fout' }, { id: '', datum: '2026-05-15', naam: 'Leeg id' }, 7] })).toEqual([]);
  });
});
