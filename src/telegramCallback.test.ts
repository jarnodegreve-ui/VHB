import { describe, it, expect } from 'vitest';
import { isBeslisCallback } from '../api/telegram';

// Security-audit 07-09-2026, bevinding 9: callback_data `lv|<id>|<besluit>`
// werd met split('|') gelezen en nam alleen de eerste velden; een id met een
// pipe kon zo het doelrecord verleggen. De parser eist nu exact drie velden.
describe('isBeslisCallback', () => {
  it('accepteert de normale knoppen', () => {
    expect(isBeslisCallback('lv|3f2a9c1e-0000-4000-8000-000000000000|approved')).toBe(true);
    expect(isBeslisCallback('rl2|1725000000000-ab12cd|rejected')).toBe(true);
  });

  it('weigert extra velden, vreemde tekens en onbekende besluiten', () => {
    expect(isBeslisCallback('lv|ander-id|approved|approved')).toBe(false);
    expect(isBeslisCallback('lv|id met spatie|approved')).toBe(false);
    expect(isBeslisCallback('lv|id|verwijderd')).toBe(false);
    expect(isBeslisCallback('lv|approved')).toBe(false);
    expect(isBeslisCallback('lv||approved')).toBe(false);
  });
});
