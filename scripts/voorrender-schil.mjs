/**
 * Voorrenderen van de schil (verbeterronde 4, punt 10).
 *
 * `<div id="root">` was leeg: tot de ±225 kB JavaScript binnen, geparsed en
 * uitgevoerd was, stond er niets, en op een trage Android in de bus is dat
 * seconden. Dit script draait ná `vite build` en zet de twee schermen die
 * React toch als eerste toont als statische HTML in dist/index.html:
 *
 *   #voorschil-warm  het skelet van de app (AppSkeleton), bij een opgeslagen sessie
 *   #voorschil-koud  het carbon laadscherm (LaadScherm), anders
 *
 * Welke zichtbaar is kiest het bootscript in index.html met de klasse
 * `vhb-warm` op <html>. React vervangt de inhoud van #root bij zijn eerste
 * render door precies dezelfde componenten, dus de overgang is naadloos.
 *
 * Het zijn de échte componenten, gerenderd met react-dom/server: geen
 * gekopieerde HTML die uit de pas kan lopen met de app. Ze worden via Vite
 * zelf geladen (ssrLoadModule), want ze importeren code die `import.meta.env`
 * leest en dat bestaat buiten Vite niet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const INDEX = path.resolve(process.cwd(), 'dist/index.html');
const LEEG = '<div id="root"></div>';

const html = fs.readFileSync(INDEX, 'utf8');
if (!html.includes(LEEG)) {
  console.error(`voorrender-schil: ${LEEG} niet gevonden in dist/index.html (al voorgerenderd, of de opmaak is gewijzigd).`);
  process.exit(1);
}

// Geen afhankelijkheidsscan: we laden twee modules en sluiten meteen weer af;
// de scan liep dan nog en meldde bij het sluiten een (onschuldige) fout.
const vite = await createServer({
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  // React zelf komt gewoon uit Node (Vite externaliseert het bij SSR, dus het
  // is dezelfde instantie als die de componenten gebruiken).
  const { AppSkeleton } = await vite.ssrLoadModule('/src/app/AppSkeleton.tsx');
  const { LaadScherm } = await vite.ssrLoadModule('/src/app/PreAppScreens.tsx');
  const warm = renderToStaticMarkup(createElement(AppSkeleton));
  const koud = renderToStaticMarkup(createElement(LaadScherm));
  const schil = `<div id="root"><div id="voorschil-warm">${warm}</div><div id="voorschil-koud">${koud}</div></div>`;
  fs.writeFileSync(INDEX, html.replace(LEEG, schil));
  const kB = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`✓ schil voorgerenderd: skelet ${kB(warm.length)}, laadscherm ${kB(koud.length)}, index.html ${kB(html.length)} → ${kB(html.length - LEEG.length + schil.length)}`);
} finally {
  await vite.close();
}
