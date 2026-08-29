import { describe, it, expect } from 'vitest';
import { viewUitUrl, zoekdeelVan } from './deeplink';

const toegestaan = ['dashboard', 'verlof', 'ruil-verzoeken'];

describe('deeplink (controle-ronde 27-08, nr. 44)', () => {
  it('leest een toegestane view uit de querystring', () => {
    expect(viewUitUrl('?view=verlof', toegestaan)).toBe('verlof');
    expect(viewUitUrl('view=ruil-verzoeken&x=1', toegestaan)).toBe('ruil-verzoeken');
  });
  it('negeert ontbrekende, lege of onbekende waarden', () => {
    expect(viewUitUrl('', toegestaan)).toBeNull();
    expect(viewUitUrl('?view=', toegestaan)).toBeNull();
    expect(viewUitUrl('?view=beheer-debug', toegestaan)).toBeNull();
    expect(viewUitUrl('?view=<script>', toegestaan)).toBeNull();
  });
  it('haalt het zoekdeel uit een pad', () => {
    expect(zoekdeelVan('/?view=verlof')).toBe('?view=verlof');
    expect(zoekdeelVan('/')).toBe('');
  });
});
