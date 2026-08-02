import { describe, it, expect } from 'vitest';
import { isDigestRuis } from '../api/helpers';

describe('isDigestRuis', () => {
  it('filtert de sessie-levenscyclus', () => {
    expect(isDigestRuis('Je sessie is verlopen. Log opnieuw in.')).toBe(true);
  });

  it('filtert chunk-laadfouten na een deploy', () => {
    // Deze kwamen op 02-08 binnen; lazyWithRetry vangt ze op, de gebruiker
    // merkt er niets van, maar de melding was al onderweg.
    expect(isDigestRuis('Failed to fetch dynamically imported module: https://vhbportaal.com/assets/VerlofKalenderView-5QSmFeVw.js')).toBe(true);
    expect(isDigestRuis('error loading dynamically imported module')).toBe(true);
    expect(isDigestRuis('Importing a module script failed.')).toBe(true);
    expect(isDigestRuis("Expected a JavaScript module script but the server responded with a MIME type of 'text/html'. Strict MIME type checking... 'text/html' is not a valid JavaScript MIME type")).toBe(true);
  });

  it('laat échte fouten staan', () => {
    expect(isDigestRuis('Kon de planning niet laden. Probeer te vernieuwen.')).toBe(false);
    expect(isDigestRuis('Kon je profiel niet laden. Vernieuw de pagina of log opnieuw in.')).toBe(false);
    expect(isDigestRuis('TypeError: undefined is not an object')).toBe(false);
    expect(isDigestRuis('')).toBe(false);
    expect(isDigestRuis(null)).toBe(false);
    expect(isDigestRuis(undefined)).toBe(false);
  });
});
