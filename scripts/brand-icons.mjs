// Genereert de app-/tab-iconen in public/ uit het officiële VHB-beeldmerk
// (brand/vhb-final-logo-package/VHB-beeldmerk-negatief.svg): wit + goud op
// een VHB Black-tegel. Draaien na een logo-wissel:  node scripts/brand-icons.mjs
//
// Output (bestandsnamen blijven gelijk — manifest.json, index.html en sw.js
// verwijzen ernaar; de SW-cache wordt per build gestempeld, dus geen bump):
//   vhb-icoon.svg / -192.png / -512.png   afgeronde tegel (manifest "any")
//   vhb-icoon-maskable.png (1024)          vol vlak, beeldmerk in de safe-zone
//   apple-touch-icon-180.png               vol vlak (iOS rondt zelf af)
//   vhb-favicon.svg / -64.png / favicon.ico tab-icoon: carbon monogram op goud
// Rasteren gebeurt met de Playwright-Chromium die al als devDependency
// aanwezig is (geen sharp/rsvg nodig).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'brand/vhb-final-logo-package/VHB-beeldmerk-negatief.svg');
const OUT = path.join(ROOT, 'public');

// Tegelkleur = VHB Black, gelijk aan manifest background_color/theme-color:
// anders tekent de PWA-splash een net iets lichtere tegel op de donkere
// achtergrond. Carbonzwart (#14181B) is de logo-inkt op licht, niet de tegel.
const TEGEL = '#0D0D0F';
// Buitenmaten van de lus in het master-coördinatenstelsel (stroke 57 →
// halve lijndikte 28,5 buiten de paden): x 229,5–1197, y 132–543.
const MARK = { cx: 713.25, cy: 337.5, w: 967.5 };

const master = fs.readFileSync(SRC, 'utf-8');
const inner = master.slice(master.indexOf('</desc>') + '</desc>'.length, master.lastIndexOf('</svg>')).trim();
// Alleen het monogram (V·H·B + H-verbinding), voor het tab-icoon: de lus met
// drie lettertjes erin is op 16–32 px een vlekje (Jarno 30-08). Eén kleur
// (carbon, ook de H-verbinding — zoals VHB-beeldmerk-zwart.svg) op een goud-
// tegel: leesbaar op 16 px en zichtbaar in lichte én donkere tabbalken, waar
// een zwarte tegel wegvalt.
const GOUD = '#E2A323';
const monogram = inner.slice(inner.indexOf('<g id="vhb-monogram">')).replace(/#FFFFFF|#E2A323/g, TEGEL);
const MONOGRAM = { cx: 714, cy: 348, w: 580 }; // bbox x 424–1004, y 262–434

/** Tegel (1024²) met een merkteken gecentreerd op `markWidth` px breed. */
function tileSvg({ rx, markWidth, title, body = inner, geom = MARK, fill = TEGEL }) {
  const s = markWidth / geom.w;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${title}">
  <rect width="1024" height="1024" rx="${rx}" ry="${rx}" fill="${fill}"/>
  <g transform="translate(512 512) scale(${s.toFixed(5)}) translate(${-geom.cx} ${-geom.cy})">
    ${body.replace(/\n\s*/g, '\n    ')}
  </g>
</svg>
`;
}

// Afgeronde hoeken op de tab-/app-iconen (iOS-achtige radius); apple-touch en
// maskable blijven vol — het OS maskeert die zelf. Maskable: safe-zone is een
// cirkel van 80 % → een 2:1-beeldmerk past tot ±730 px, we houden 680.
const ICOON = tileSvg({ rx: 224, markWidth: 760, title: 'VHB app-icoon' });
const FAVICON = tileSvg({ rx: 200, markWidth: 920, title: 'VHB', body: monogram, geom: MONOGRAM, fill: GOUD });
const VOL = tileSvg({ rx: 0, markWidth: 760, title: 'VHB app-icoon' });
const MASKABLE = tileSvg({ rx: 0, markWidth: 680, title: 'VHB app-icoon' });

fs.writeFileSync(path.join(OUT, 'vhb-icoon.svg'), ICOON);
fs.writeFileSync(path.join(OUT, 'vhb-favicon.svg'), FAVICON);

const browser = await chromium.launch();
async function render(svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${data}">`,
  );
  await page.waitForFunction(() => document.images[0]?.complete);
  const png = await page.screenshot({ omitBackground: true, type: 'png' });
  await page.close();
  return png;
}

/** ICO-container met PNG-entries (Vista+/alle browsers). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length; dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.png)]);
}

const jobs = [
  ['vhb-icoon-192.png', ICOON, 192],
  ['vhb-icoon-512.png', ICOON, 512],
  ['vhb-icoon-maskable.png', MASKABLE, 1024],
  ['apple-touch-icon-180.png', VOL, 180],
  ['vhb-favicon-64.png', FAVICON, 64],
];
for (const [name, svg, size] of jobs) {
  fs.writeFileSync(path.join(OUT, name), await render(svg, size));
  console.log('✓', name);
}
const icoSizes = [16, 32, 48];
fs.writeFileSync(
  path.join(OUT, 'favicon.ico'),
  ico(await Promise.all(icoSizes.map(async (size) => ({ size, png: await render(FAVICON, size) })))),
);
console.log('✓ favicon.ico (16/32/48)');
await browser.close();
