// @vitest-environment node
/**
 * Inkomende OCPI-auth (controle-ronde 27-08, nr. 31): Token A is alleen
 * geldig zolang de registratie nog niet rond is; daarna alleen Token B.
 */
import { describe, it, expect, beforeAll } from 'vitest';

process.env.OCPI_CPO_VERSIONS_URL = 'https://cpo.example.com/ocpi/versions';
process.env.OCPI_TOKEN_A = 'token-a-registratie';

let ocpiTokenGeldig: (presented: string, reg: { cpo_token_c?: string | null; our_token_b?: string | null } | null) => boolean;
beforeAll(async () => {
  ({ ocpiTokenGeldig } = await import('../api/ocpi.js'));
});
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('ocpiTokenGeldig', () => {
  it('vóór registratie: Token A geldig (plain én base64), Token B ook zodra hij bestaat', () => {
    expect(ocpiTokenGeldig('token-a-registratie', null)).toBe(true);
    expect(ocpiTokenGeldig(b64('token-a-registratie'), { cpo_token_c: null, our_token_b: null })).toBe(true);
    expect(ocpiTokenGeldig('token-b', { cpo_token_c: null, our_token_b: 'token-b' })).toBe(true);
  });
  it('ná registratie: Token A vervalt, alleen Token B blijft', () => {
    const reg = { cpo_token_c: 'token-c', our_token_b: 'token-b' };
    expect(ocpiTokenGeldig('token-a-registratie', reg)).toBe(false);
    expect(ocpiTokenGeldig(b64('token-a-registratie'), reg)).toBe(false);
    expect(ocpiTokenGeldig(b64('token-b'), reg)).toBe(true);
  });
  it('onbekend token nooit', () => {
    expect(ocpiTokenGeldig('iets-anders', { cpo_token_c: 'c', our_token_b: 'b' })).toBe(false);
    expect(ocpiTokenGeldig('', null)).toBe(false);
  });
});
