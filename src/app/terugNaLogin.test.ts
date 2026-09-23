import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Login → oorspronkelijke bestemming (tranche 3C, 23-09): alleen een intern
 * pad naar een bekend scherm mag een terugkeerdoel zijn (geen open redirect),
 * en het startdoel wordt één keer uitgegeven.
 */

const laadRouter = async (pad: string) => {
  window.history.replaceState(null, '', pad);
  vi.resetModules();
  const router = await import('./router');
  // De normalisatie draait bij de eerste useRoute; renderHook is hier niet
  // nodig, useRoute's initialisatie is een gewone functie-aanroep in useState.
  const { renderHook } = await import('@testing-library/react');
  renderHook(() => router.useRoute());
  return router;
};

afterEach(() => { window.history.replaceState(null, '', '/'); });

describe('veiligInternPad', async () => {
  const { veiligInternPad } = await import('./terugNaLogin');

  it.each([
    ['/verlof', '/verlof'],
    ['/verlof/abc-123', '/verlof/abc-123'],
    ['/dienstruil/r1?x=1', '/dienstruil/r1?x=1'],
    ['/rapporten/ziekte/ziekte-kalenderdagen?sorteer=-kalenderdagen', '/rapporten/ziekte/ziekte-kalenderdagen?sorteer=-kalenderdagen'],
    ['/verlof#iets', '/verlof'],
  ])('laat %s door', (invoer, verwacht) => {
    expect(veiligInternPad(invoer)).toBe(verwacht);
  });

  it.each([
    'https://evil.example/verlof',
    '//evil.example/verlof',
    '/\\evil.example/verlof',
    '\\\\evil.example',
    'javascript:alert(1)',
    'verlof',
    '',
    '/\tverlof',
    '/verlof\n',
    '/',
    '/' + 'a'.repeat(3000),
  ])('weigert %j', (invoer) => {
    expect(veiligInternPad(invoer)).toBeNull();
  });

  it('weigert iets anders dan een string', () => {
    expect(veiligInternPad(null)).toBeNull();
    expect(veiligInternPad({ toString: () => '/verlof' })).toBeNull();
  });

  it('een ge-encodeerde dubbele slash blijft op deze origin', () => {
    // /%2F%2Fevil is een pad op onze eigen origin (geen scheme-relatieve URL);
    // de router kent het niet als scherm, dus het wordt nooit een doel.
    expect(veiligInternPad('/%2F%2Fevil.example')).toBeNull();
  });
});

describe('neemStartDoel', () => {
  it('onthoudt een koude start op een scherm, één keer', async () => {
    const router = await laadRouter('/verlof/abc?x=1');
    expect(router.neemStartDoel()).toBe('/verlof/abc?x=1');
    expect(router.neemStartDoel()).toBeNull();
  });

  it('geen doel bij een start op het dashboard', async () => {
    const router = await laadRouter('/');
    expect(router.neemStartDoel()).toBeNull();
  });

  it('oude ?view=-links tellen als doel na omzetting', async () => {
    const router = await laadRouter('/?view=verlof');
    expect(router.neemStartDoel()).toBe('/verlof');
  });
});
