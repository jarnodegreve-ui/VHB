import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** Een link naar het portaal in WhatsApp, Teams of Slack toont de
 *  Open Graph-kaart uit index.html (verbeterronde 14-10, punt 5). Deze test
 *  houdt de tags en het beeld (public/og-afbeelding.png, uit
 *  scripts/brand-icons.mjs) bij elkaar. */
describe('Open Graph', () => {
  const root = resolve(__dirname, '..');
  const html = readFileSync(resolve(root, 'index.html'), 'utf-8');
  const meta = (naam: string) => html.match(new RegExp(`<meta (?:property|name)="${naam}" content="([^"]*)"`))?.[1];

  it('beschrijft de pagina voor een gedeelde link', () => {
    expect(meta('og:title')).toBe('VHB Portaal');
    expect(meta('og:description')).toBe(meta('description'));
    expect(meta('og:url')).toBe('https://vhbportaal.com/');
    expect(meta('og:image')).toBe('https://vhbportaal.com/og-afbeelding.png');
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
    expect(meta('og:locale')).toBe('nl_BE');
    expect(meta('twitter:card')).toBe('summary_large_image');
  });

  it('gebruikt in de beschrijving een komma, geen em dash', () => {
    expect(meta('description')).not.toContain(' — ');
  });

  it('heeft het beeld van 1200 × 630 in public/, klein genoeg voor elke chatapp', () => {
    const pad = resolve(root, 'public/og-afbeelding.png');
    const png = readFileSync(pad);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(statSync(pad).size).toBeLessThan(200 * 1024);
  });
});
