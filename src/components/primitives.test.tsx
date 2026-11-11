import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button, IconButton } from './primitives';

afterEach(cleanup);

/** De look van een knop die echt uitgeschakeld is: halve dekking en het
 *  verbodsbord. Een bezige knop draagt die twee klassen niet. */
const UITGESCHAKELD = ['disabled:cursor-not-allowed', 'disabled:opacity-50'];

const klassenVan = (ui: ReactElement) => {
  const { container, unmount } = render(ui);
  const klassen = container.querySelector('button')!.className.split(/\s+/).sort();
  unmount();
  return klassen;
};

/**
 * Een bezige knop blijft de hoofdactie (ronde 6): tijdens het wachten op de
 * server houdt hij de kleuren van zijn variant. Tot dan werd elke knop met
 * `bezig` een half doorzichtig vlak (de gouden zelfs grijs) en las hij als
 * uitgeschakeld of mislukt. `disabled` en `aria-busy` blijven wel staan.
 */
describe('Button: bezig is geen uitgeschakeld', () => {
  const VARIANTEN = ['primary', 'secondary', 'ghost', 'success', 'warning', 'danger', 'dangerSolid', 'ink'] as const;

  it.each(VARIANTEN)('%s: dezelfde klassen als in rust, zonder de uitgeschakelde look en met de wacht-aanwijzer', (variant) => {
    const rust = klassenVan(<Button variant={variant}>Opslaan</Button>);
    const bezig = klassenVan(<Button variant={variant} bezig>Opslaan</Button>);
    expect(rust).toEqual(expect.arrayContaining(UITGESCHAKELD));
    expect(bezig).toEqual([...rust.filter((k) => !UITGESCHAKELD.includes(k)), 'cursor-progress'].sort());
  });

  it('blijft in de DOM uitgeschakeld en aria-busy, met zijn label en de spinner in het icoonslot', () => {
    const klik = vi.fn();
    render(<Button variant="primary" bezig icon={<svg data-testid="icoon" />} onClick={klik}>Opslaan</Button>);
    const knop = screen.getByRole('button', { name: 'Opslaan' }) as HTMLButtonElement;
    expect(knop.disabled).toBe(true);
    expect(knop.getAttribute('aria-busy')).toBe('true');
    expect(knop.className).toContain('btn-primary');
    // De spinner deelt het slot met het icoon, dat onzichtbaar blijft staan (geen breedtesprong).
    const slot = screen.getByTestId('icoon').parentElement!;
    expect(slot.getAttribute('aria-hidden')).toBe('true');
    expect(slot.parentElement!.querySelector('.vhb-streep-veeg')).not.toBeNull();
    // Dubbel tikken blijft geblokkeerd.
    fireEvent.click(knop);
    expect(klik).not.toHaveBeenCalled();
  });

  it('uitgeschakeld zonder bezig houdt de uitgeschakelde look, in elke variant', () => {
    for (const variant of VARIANTEN) {
      expect(klassenVan(<Button variant={variant} disabled>Opslaan</Button>)).toEqual(klassenVan(<Button variant={variant}>Opslaan</Button>));
    }
    render(<Button variant="primary" disabled>Opslaan</Button>);
    const knop = screen.getByRole('button', { name: 'Opslaan' }) as HTMLButtonElement;
    expect(knop.disabled).toBe(true);
    expect(knop.hasAttribute('aria-busy')).toBe(false);
    expect(knop.className).not.toContain('cursor-progress');
    expect(knop.querySelector('.vhb-streep-veeg')).toBeNull();
  });

  it('bezig wint van disabled: wie wacht, ziet een bezige knop', () => {
    expect(klassenVan(<Button variant="primary" bezig disabled>Opslaan</Button>)).toEqual(klassenVan(<Button variant="primary" bezig>Opslaan</Button>));
  });
});

describe('IconButton: bezig is geen uitgeschakeld', () => {
  const VARIANTEN = ['ghost', 'secondary', 'danger', 'success', 'primary'] as const;

  it.each(VARIANTEN)('%s: dezelfde klassen als in rust, zonder de uitgeschakelde look', (variant) => {
    const rust = klassenVan(<IconButton label="Verwijderen" variant={variant}><svg /></IconButton>);
    const bezig = klassenVan(<IconButton label="Verwijderen" variant={variant} bezig><svg /></IconButton>);
    expect(rust).toEqual(expect.arrayContaining(UITGESCHAKELD));
    expect(bezig).toEqual([...rust.filter((k) => !UITGESCHAKELD.includes(k)), 'cursor-progress'].sort());
    expect(klassenVan(<IconButton label="Verwijderen" variant={variant} disabled><svg /></IconButton>)).toEqual(rust);
  });

  it('blijft uitgeschakeld en aria-busy; het icoon maakt plaats voor de spinner', () => {
    render(<IconButton label="Verwijderen" bezig><svg data-testid="icoon" /></IconButton>);
    const knop = screen.getByRole('button', { name: 'Verwijderen' }) as HTMLButtonElement;
    expect(knop.disabled).toBe(true);
    expect(knop.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('icoon')).toBeNull();
    expect(knop.querySelector('.vhb-streep-veeg')).not.toBeNull();
  });
});

/**
 * De andere helft staat in src/index.css en is in jsdom niet te renderen;
 * deze tests lezen de bron, zoals src/lib/cn.test.ts dat voor de
 * typografie-rollen doet.
 */
describe('index.css: bezig, gedempt vlak in donker en de aanwijzer', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Kop van elke regel waarin `selector` voorkomt. */
  const koppen = (selector: string) => [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((kop) => kop.includes(selector));
  /** Het blok dat na `kop` opent, tot zijn sluitende accolade. */
  const blok = (kop: string) => {
    const start = css.indexOf(kop);
    if (start < 0) throw new Error(`blok ${kop} niet gevonden`);
    let diepte = 0;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') diepte++;
      else if (css[i] === '}' && --diepte === 0) return css.slice(start, i + 1);
    }
    throw new Error(`blok ${kop} niet gevonden`);
  };

  // Chromium en WebKit matchen :hover en :active ook op een uitgeschakelde
  // knop: zonder deze uitsluiting tilt en krimpt een bezige knop alsnog, en
  // wordt de gouden grijs.
  it.each(['.btn-primary:disabled', '.btn-primary:hover', '.btn-primary:active', '.ios-pressable:hover', '.ios-pressable:active', '.control-button-soft:hover'])('%s geldt niet voor een bezige knop, en weegt even zwaar als vroeger', (selector) => {
    const gevonden = koppen(selector);
    expect(gevonden.length).toBeGreaterThan(0);
    // :where() telt niet mee in de specificiteit: de uitgeschakelde stijl wordt niet zwakker of sterker.
    for (const kop of gevonden) expect(kop.endsWith(`${selector}:where(:not([aria-busy="true"]))`)).toBe(true);
  });

  // De veeg van de spinner is goud: op een knop die goud blijft was ze niet te
  // zien, en met "minder beweging" (veeg vol) bleef er van de spinner niets over.
  // Op amber (Button warning, de bevestigknop van ConfirmationModal) evenmin:
  // goud op amber is 1,3:1.
  it('op een bezige gouden of amber knop tekent de spinner in de tekstkleur van de knop, niet goud op goud of amber', () => {
    const GOUD = ':is(.btn-primary, .bg-oker-500, .bg-amber-500)[aria-busy="true"]';
    expect(blok(`${GOUD} .vhb-streep-veeg {`)).toMatch(/stroke:\s*currentColor;/);
    const spoor = blok(`${GOUD} path:has(+ .vhb-streep-veeg) {`);
    expect(spoor).toMatch(/fill:\s*currentColor;/);
    expect(spoor).toMatch(/fill-opacity:\s*0\.2;/);
    // Die selectors leunen op wat de knoppen renderen: de klasse van het vlak
    // en aria-busy op de knop zelf, en het spoor als pad vlak voor de veeg.
    const GOUDEN_KNOPPEN = [
      [<Button variant="primary" bezig>Opslaan</Button>, 'btn-primary'],
      [<IconButton label="Opslaan" variant="primary" bezig><svg /></IconButton>, 'bg-oker-500'],
      [<Button variant="warning" bezig>Toch goedkeuren</Button>, 'bg-amber-500'],
    ] as const;
    for (const [ui, klasse] of GOUDEN_KNOPPEN) {
      const { container, unmount } = render(ui);
      const knop = container.querySelector('button')!;
      expect(knop.classList.contains(klasse)).toBe(true);
      expect(knop.getAttribute('aria-busy')).toBe('true');
      expect(knop.querySelector('.vhb-streep-veeg')!.previousElementSibling?.tagName.toLowerCase()).toBe('path');
      unmount();
    }
  });

  // WCAG-contrast van twee dekkende kleuren.
  const lineair = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const helderheid = ([r, g, b]: number[]) => 0.2126 * lineair(r) + 0.7152 * lineair(g) + 0.0722 * lineair(b);
  const contrast = (a: number[], b: number[]) => { const [licht, donker] = [helderheid(a), helderheid(b)].sort((x, y) => y - x); return (licht + 0.05) / (donker + 0.05); };
  const kleur = (waarde: string) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(waarde);
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const rgba = /^rgba?\(([^)]+)\)$/.exec(waarde);
    if (!rgba) throw new Error(`geen kleur: ${waarde}`);
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  };
  const over = ([r, g, b, a]: number[], onder: number[]) => [r, g, b].map((c, i) => c * a + onder[i] * (1 - a));

  it('donker: het gedempte vlak verschilt zichtbaar van de kaart en het canvas, en de gedempte tekst blijft leesbaar', () => {
    const donker = blok('html.dark {');
    const token = (naam: string) => new RegExp(`${naam}:\\s*([^;]+);`).exec(donker)![1].trim();
    const canvas = kleur(token('--laag-canvas'));
    // De kaart zoals .surface-card haar in donker tekent: 95 % kaartlaag op het canvas.
    const kaart = over([...kleur(token('--laag-kaart')).slice(0, 3), 0.95], canvas);
    const gedempt = kleur(token('--laag-gedempt'));
    const opKaart = over(gedempt, kaart);
    // Het oude vlak, rgba(23, 24, 26, 0.6), gaf op de kaart 1,00:1: onzichtbaar.
    expect(contrast(opKaart, kaart)).toBeGreaterThan(1.08);
    expect(contrast(over(gedempt, canvas), canvas)).toBeGreaterThan(1.05);
    // --tekst-micro is in donker slate-500; de gedempte leestekst is slate-600.
    expect(token('--tekst-micro')).toBe('var(--color-slate-500)');
    const micro = contrast(kleur(token('--color-slate-500')), opKaart);
    const leestekst = contrast(kleur(token('--color-slate-600')), opKaart);
    expect(micro).toBeGreaterThanOrEqual(4.5); // gemeten 6,19:1
    expect(leestekst).toBeGreaterThanOrEqual(4.5); // gemeten 7,90:1
    // Ook een gedempt vlak in een gedempt vlak (5,53:1) blijft boven de grens.
    expect(contrast(kleur(token('--color-slate-500')), over(gedempt, opKaart))).toBeGreaterThanOrEqual(4.5);
  });

  it('de schuifbalkduim en de selectie lezen een token dat per thema een waarde heeft', () => {
    expect(css).toMatch(/scrollbar-color:\s*var\(--schuifbalk-duim\) transparent;/);
    expect(blok('*::-webkit-scrollbar-thumb {')).toContain('background-color: var(--schuifbalk-duim);');
    const selectie = blok('::selection {');
    expect(selectie).toContain('background-color: var(--selectie-vlak);');
    expect(selectie).toContain('color: var(--selectie-tekst);');
    const donker = blok('html.dark {');
    const licht = css.replace(donker, '');
    for (const naam of ['--schuifbalk-duim', '--selectie-vlak']) {
      const waarde = new RegExp(`${naam}:\\s*([^;]+);`);
      expect(waarde.exec(licht)?.[1]).toBeTruthy();
      expect(waarde.exec(donker)?.[1]).toBeTruthy();
      expect(waarde.exec(donker)![1]).not.toBe(waarde.exec(licht)![1]);
    }
  });

  // De donkere selectiekleur staat er als vaste kleur (een geneste color-mix
  // kreeg van de bouwstap de kaartlaag als terugval: selectie onzichtbaar op
  // een kaart). Deze test houdt haar gelijk aan de tokens waaruit ze komt.
  it('donker: de selectiekleur is 30 % goud op de kaartlaag, als vaste kleur', () => {
    const donker = blok('html.dark {');
    const token = (naam: string, bron: string) => new RegExp(`${naam}:\\s*([^;]+);`).exec(bron)![1].trim();
    const kaart = kleur(token('--laag-kaart', donker));
    const goud = kleur(token('--color-oker-500', css));
    const [r, g, b, alfa] = kleur(token('--selectie-vlak', donker));
    expect([r, g, b]).toEqual([0, 1, 2].map((i) => Math.round(kaart[i] * 0.7 + goud[i] * 0.3)));
    // 99 % en niet 100: Safari maakt een volledig dekkende selectiekleur zelf doorschijnend.
    expect(alfa).toBe(0.99);
    // Goud zelf wordt in donker niet gespiegeld: de 500-trede uit @theme geldt ook daar.
    expect(donker).not.toMatch(/--color-oker-500:/);
  });

  // De browser tekent de selectiekleur óver een afbeelding of ingebedde PDF:
  // met het (bijna) dekkende vlak van de tekstselectie verdween het beeld.
  it('een beeld in de selectie krijgt de doorschijnende tint, niet het dekkende vlak', () => {
    const beeld = blok(':is(img, canvas, iframe, video, embed, object)::selection {');
    expect(beeld).toContain('background-color: var(--selectie-beeld);');
    expect(beeld).not.toContain('--selectie-vlak');
    expect(/--selectie-beeld:\s*([^;]+);/.exec(css)![1].trim()).toBe('color-mix(in srgb, var(--color-oker-500) 30%, transparent)');
  });

  it('de aanwijzer staat in de base-laag, zodat een cursor-utility altijd wint, en slaat uitgeschakeld over', () => {
    const basis = blok('@layer base {');
    const regel = /([^{}]+)\{\s*cursor:\s*pointer;\s*\}/g;
    // Splitst op de komma's van de lijst zelf, niet op die binnen :is(…).
    const selectors = [...basis.matchAll(regel)].flatMap((m) => m[1].split(/,(?![^()]*\))/).map((s) => s.trim()));
    expect(selectors).toEqual(expect.arrayContaining(['button:not(:disabled, [aria-disabled="true"])', '[role="button"]:not([aria-disabled="true"])', 'summary', 'a[href]', 'select:not(:disabled)']));
    // Een label met `for`, en een label rond zijn invoer.
    expect(selectors.some((s) => s.startsWith('label[for]:not('))).toBe(true);
    expect(selectors.some((s) => s.startsWith('label:has('))).toBe(true);
    // Geen kale `button`, `select` of `label[for]`: wat uitgeschakeld is houdt zijn aanwijzer.
    for (const kaal of ['button', 'select', 'label', 'label[for]']) expect(selectors).not.toContain(kaal);
    // Buiten de base-laag zet niets het handje als basisregel.
    expect(css.replace(basis, '')).not.toMatch(/cursor:\s*pointer/);
  });
});
