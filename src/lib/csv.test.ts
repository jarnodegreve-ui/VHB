import { describe, it, expect } from 'vitest';
import { csvCel, csvTekst } from './csv';

describe('csvCel / csvTekst (formule-guard, controle-ronde 27-08 nr. 29)', () => {
  it('quote en verdubbelt aanhalingstekens', () => {
    expect(csvCel('gewoon')).toBe('"gewoon"');
    expect(csvCel('zegt "hoi"')).toBe('"zegt ""hoi"""');
    expect(csvCel(null)).toBe('""');
    expect(csvCel(12)).toBe('"12"');
  });
  it('neutraliseert formule-prefixen met een apostrof', () => {
    expect(csvCel('=1+1')).toBe('"\'=1+1"');
    expect(csvCel('+cmd')).toBe('"\'+cmd"');
    expect(csvCel('-1')).toBe('"\'-1"');
    expect(csvCel('@SUM')).toBe('"\'@SUM"');
    expect(csvCel('\tx')).toBe('"\'\tx"');
  });
  it('bouwt regels met de gevraagde scheiding en CRLF', () => {
    expect(csvTekst([['a', 'b'], ['=x', 'y']])).toBe('"a","b"\r\n"\'=x","y"');
    expect(csvTekst([['a', 'b']], ';')).toBe('"a";"b"');
  });
});
