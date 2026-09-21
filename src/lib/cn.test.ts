import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cn, TYPOGRAFIE_ROLLEN } from './cn';

describe('cn() en de typografie-rollen', () => {
  it('houdt rol en tekstkleur allebei, in beide volgordes', () => {
    expect(cn('text-micro', 'text-slate-500 ml-1')).toBe('text-micro text-slate-500 ml-1');
    expect(cn('text-slate-500', 'text-micro')).toBe('text-slate-500 text-micro');
    expect(cn('text-body-sm font-normal text-slate-600')).toBe('text-body-sm font-normal text-slate-600');
    expect(cn('text-stat', 'text-oker-700')).toBe('text-stat text-oker-700');
    expect(cn('text-label', 'text-keuze-vlak-tekst')).toBe('text-label text-keuze-vlak-tekst');
  });

  it('laat een important-kleur naast de rol staan', () => {
    expect(cn('text-micro', '!text-oker-700')).toBe('text-micro !text-oker-700');
    expect(cn('text-micro text-slate-500', '!text-oker-700')).toBe('text-micro text-slate-500 !text-oker-700');
  });

  it('twee kleuren naast een rol: de laatste kleur wint, de rol blijft', () => {
    expect(cn('text-micro text-slate-500', 'text-amber-700')).toBe('text-micro text-amber-700');
  });

  it('twee rollen: de laatste wint', () => {
    expect(cn('text-card-title', 'text-section-title')).toBe('text-section-title');
    expect(cn('text-micro', 'text-label')).toBe('text-label');
    expect(cn('text-body', 'text-body-sm')).toBe('text-body-sm');
    expect(cn('text-stat text-stat-mono', 'text-micro')).toBe('text-micro');
  });

  it('text-stat-mono is een aanvulling op text-stat, geen vervanger', () => {
    expect(cn('text-stat', 'text-stat-mono')).toBe('text-stat text-stat-mono');
    expect(cn('text-stat text-slate-900', true && 'text-stat-mono')).toBe('text-stat text-slate-900 text-stat-mono');
  });

  it('losse maat NA de rol overschrijft alleen de maat, de rol blijft', () => {
    expect(cn('text-micro', 'text-sm')).toBe('text-micro text-sm');
    expect(cn('text-card-title', 'font-semibold')).toBe('text-card-title font-semibold');
    expect(cn('text-micro', 'normal-case tracking-normal')).toBe('text-micro normal-case tracking-normal');
  });

  it('rol NA een losse utility voor een eigenschap die de rol zet: de rol wint', () => {
    expect(cn('text-sm', 'text-micro')).toBe('text-micro');
    expect(cn('text-sm leading-5 font-bold uppercase tracking-wide', 'text-micro')).toBe('text-micro');
    expect(cn('font-sans text-lg', 'text-card-title')).toBe('text-card-title');
    // text-body zet geen gewicht of spatiëring: die blijven staan.
    expect(cn('text-sm font-bold tracking-wide', 'text-body')).toBe('font-bold tracking-wide text-body');
    // text-label zet geen kapitalen.
    expect(cn('uppercase', 'text-label')).toBe('uppercase text-label');
  });

  it('varianten botsen alleen binnen dezelfde variant', () => {
    expect(cn('text-card-title', 'md:text-section-title')).toBe('text-card-title md:text-section-title');
    expect(cn('md:text-sm', 'md:text-micro')).toBe('md:text-micro');
  });

  it('bestaand gedrag van cn blijft intact', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('text-slate-500', 'text-slate-900')).toBe('text-slate-900');
    expect(cn('text-sm', 'text-md')).toBe('text-md');
    expect(cn('text-2xs', 'text-xs')).toBe('text-xs');
    expect(cn('text-left', 'text-slate-500', 'text-sm')).toBe('text-left text-slate-500 text-sm');
    expect(cn('leading-6', 'text-sm')).toBe('text-sm');
    expect(cn('a', false, null, undefined, ['b', { c: true, d: false }])).toBe('a b c');
    expect(cn('bg-paper hover:bg-surface-soft-hover', 'bg-ink')).toBe('hover:bg-surface-soft-hover bg-ink');
    expect(cn()).toBe('');
  });
});

/**
 * Eén bron: de rollen staan in src/index.css. Deze test leest ze daar en
 * vergelijkt naam én eigenschappen met de merge-config, zodat een nieuwe rol
 * (of een rol die er een eigenschap bij krijgt) niet stil door `cn()` wordt
 * weggegooid.
 */
describe('TYPOGRAFIE_ROLLEN volgt src/index.css', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /** CSS-eigenschap → tailwind-merge-groep. `null` = bewust geen conflict. */
  const GROEP_PER_EIGENSCHAP: Record<string, string | null> = {
    'font-size': 'font-size',
    'line-height': 'leading',
    'font-weight': 'font-weight',
    'letter-spacing': 'tracking',
    'font-family': 'font-family',
    'text-transform': 'text-transform',
    'text-wrap': 'text-wrap',
    'font-variant-numeric': 'fvn-spacing',
    // Kleur: een text-<kleur> naast de rol is altijd een bewuste overschrijving.
    'color': null,
  };

  const uitCss = new Map<string, Set<string>>();
  for (const m of css.matchAll(/\.text-([a-z0-9-]+)\s*\{([^}]*)\}/g)) {
    const eigenschappen = uitCss.get(m[1]) ?? new Set<string>();
    for (const d of m[2].split(';')) {
      const naam = d.split(':')[0].trim();
      if (naam) eigenschappen.add(naam);
    }
    uitCss.set(m[1], eigenschappen);
  }

  it('vindt de rollen in index.css', () => {
    expect(uitCss.size).toBeGreaterThanOrEqual(10);
    expect(uitCss.has('micro')).toBe(true);
  });

  it('elke .text-<rol> uit index.css staat in de config, en omgekeerd', () => {
    expect([...uitCss.keys()].sort()).toEqual(Object.keys(TYPOGRAFIE_ROLLEN).sort());
  });

  it('de conflictgroepen per rol zijn precies de eigenschappen die de rol zet', () => {
    for (const [rol, eigenschappen] of uitCss) {
      const verwacht = new Set<string>();
      for (const e of eigenschappen) {
        expect(GROEP_PER_EIGENSCHAP, `onbekende eigenschap "${e}" in .text-${rol}: kies een tailwind-merge-groep (of null)`).toHaveProperty(e);
        const g = GROEP_PER_EIGENSCHAP[e];
        if (g) verwacht.add(g);
      }
      const config = TYPOGRAFIE_ROLLEN[rol as keyof typeof TYPOGRAFIE_ROLLEN] ?? [];
      expect([...config].sort(), `.text-${rol}`).toEqual([...verwacht].sort());
    }
  });
});
