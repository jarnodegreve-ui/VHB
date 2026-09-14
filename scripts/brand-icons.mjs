// Genereert de app-/tab-iconen in public/ uit het icoon van de ontwerper
// (brand/vhb-final-logo-package/VHB-icoon.svg, pakket "VHB primary" van
// 2026-09-14): wit merk met gouden streep op een carbon tegel (#242628,
// hoekstraal 198). App-icoon én tab-icoon zijn hetzelfde beeld.
// Draaien na een logo-wissel:  node scripts/brand-icons.mjs
//
// Output (bestandsnamen blijven gelijk — manifest.json, index.html en sw.js
// verwijzen ernaar; de SW-cache wordt per build gestempeld, dus geen bump):
//   vhb-icoon.svg / -192.png / -512.png   afgeronde tegel (manifest "any")
//   vhb-icoon-maskable.png (1024)          vol vlak, merk in de safe-zone
//   apple-touch-icon-180.png               vol vlak (iOS rondt zelf af)
//   vhb-favicon.svg / -64.png / favicon.ico tab-icoon (zelfde beeld)
// Rasteren gebeurt met de Playwright-Chromium die al als devDependency
// aanwezig is (geen sharp/rsvg nodig).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'brand/vhb-final-logo-package/VHB-icoon.svg');
const OUT = path.join(ROOT, 'public');

const master = fs.readFileSync(SRC, 'utf-8');
// Tegelkleur en merk-groep uit het masterbestand zelf.
const TEGEL = master.match(/<rect [^>]*fill="(#[0-9A-Fa-f]{6})"/)[1];
// Goud = het huisstijl-goud (#E2A323, keuze Jarno 14-09) i.p.v. het pakket-goud #CAA044.
const GOUD = '#E2A323';
const defs = master.slice(master.indexOf('<defs>'), master.indexOf('</defs>') + '</defs>'.length).replace(/#CAA044/gi, GOUD);
// Buitenmaten van het merk in de coördinaten van #vhb-mark (na zijn eigen
// translate(-20 -20)): x 0–572,5 · y 0,6–195,5.
const MERK = { cx: 286.25, cy: 98, w: 572.5, h: 195 };

/** Tegel (1024²) met het merk gecentreerd op `markWidth` px breed. */
function tileSvg({ rx, markWidth, title }) {
  const s = markWidth / MERK.w;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${title}">
  ${defs}
  <rect width="1024" height="1024" rx="${rx}" ry="${rx}" fill="${TEGEL}"/>
  <g transform="translate(512 512) scale(${s.toFixed(5)}) translate(${-MERK.cx} ${-MERK.cy})"><use href="#vhb-mark"/></g>
</svg>
`;
}

// Het app-icoon volgt de ontwerper: merk 804 px breed (schaal 1,408) op de
// afgeronde tegel (rx 198). Apple-touch en maskable blijven vol — het OS
// maskeert die zelf; de maskable houdt het merk binnen de veilige 80 %-cirkel
// (819 px op 1024: 740 px breed past, diagonaal 782).
const ICOON = tileSvg({ rx: 198, markWidth: 804, title: 'VHB app-icoon' });
const VOL = tileSvg({ rx: 0, markWidth: 804, title: 'VHB app-icoon' });
const MASKABLE = tileSvg({ rx: 0, markWidth: 740, title: 'VHB app-icoon' });
const FAVICON = ICOON;

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
