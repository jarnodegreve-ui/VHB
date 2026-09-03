#!/usr/bin/env node
/**
 * Visuele regressie in CI (verbeterronde 03-09, nr. 11).
 *
 * Zes sleutelschermen — desktop 1440×900 (admin-dashboard, gebruikers,
 * maandplanning) en iPhone 13/WebKit (chauffeur-dashboard, rooster, verlof),
 * licht thema — worden met gemockte API (scripts/audit-fixtures.mjs)
 * geschoten op de PR-branch én op de basis-branch, en daarna per pixel
 * vergeleken. Boven de drempel (1,5 % per scherm) faalt de job NIET: het is
 * een signaal voor de reviewer. De diff-afbeeldingen komen als artifact mee.
 *
 * Gebruik:
 *   node scripts/visueel-ci.mjs schiet --out <map> [--app <gebouwde app-map>] [--port 4173]
 *   node scripts/visueel-ci.mjs vergelijk <basis-map> <kop-map> --out <diff-map> [--drempel 1.5]
 *
 * `schiet` start zelf `vite preview` in de app-map (dist moet gebouwd zijn met
 * de dummy-Supabase-env, zie playwright.config.ts) en stopt hem weer.
 * Geen Python nodig (anders dan scripts/screenshot-diff.py): pixel-diff via
 * pngjs. Lokaal: zie e2e/README.md.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices, webkit } from '@playwright/test';
import { PNG } from 'pngjs';
import { ADMIN, CHAUFFEUR, seedPagina } from './audit-fixtures.mjs';

const DREMPEL_STANDAARD = 1.5;
/** Kanaalverschil (0-255) waaronder een pixel als "gelijk" telt — vangt
 *  anti-aliasing/subpixel-ruis, zelfde waarde als screenshot-diff.py. */
const PIXEL_TOLERANTIE = 24;

const SCHERMEN = [
  { naam: 'desktop-admin-dashboard', profiel: 'desktop', user: ADMIN, view: 'dashboard' },
  { naam: 'desktop-admin-gebruikers', profiel: 'desktop', user: ADMIN, view: 'gebruikers' },
  { naam: 'desktop-admin-maandplanning', profiel: 'desktop', user: ADMIN, view: 'bezetting' },
  { naam: 'iphone-chauffeur-dashboard', profiel: 'iphone', user: CHAUFFEUR, view: 'dashboard' },
  { naam: 'iphone-chauffeur-rooster', profiel: 'iphone', user: CHAUFFEUR, view: 'rooster' },
  { naam: 'iphone-chauffeur-verlof', profiel: 'iphone', user: CHAUFFEUR, view: 'verlof' },
];

const PROFIELEN = {
  desktop: { browser: chromium, context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, fullPage: false },
  iphone: { browser: webkit, context: { ...devices['iPhone 13'] }, fullPage: true },
};

function argumenten(argv) {
  const los = [];
  const opties = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { opties[a.slice(2)] = argv[i + 1]; i++; } else los.push(a);
  }
  return { los, opties };
}

async function wachtOpServer(url, ms = 60_000) {
  const tot = Date.now() + ms;
  while (Date.now() < tot) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* nog niet op */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Preview-server op ${url} kwam niet op binnen ${ms / 1000}s.`);
}

async function schiet({ out, app = '.', port = '4173' }) {
  if (!out) throw new Error('--out ontbreekt');
  const appMap = path.resolve(app);
  if (!fs.existsSync(path.join(appMap, 'dist', 'index.html'))) throw new Error(`Geen dist/index.html in ${appMap} — eerst bouwen.`);
  fs.mkdirSync(out, { recursive: true });

  const url = `http://localhost:${port}/`;
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: appMap, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  const stop = () => { if (!server.killed) server.kill('SIGTERM'); };
  process.on('exit', stop);

  try {
    await wachtOpServer(url).catch((e) => { throw new Error(`${e.message}\n${serverLog}`); });
    const browsers = new Map();
    for (const scherm of SCHERMEN) {
      const profiel = PROFIELEN[scherm.profiel];
      if (!browsers.has(scherm.profiel)) browsers.set(scherm.profiel, await profiel.browser.launch());
      const context = await browsers.get(scherm.profiel).newContext({ ...profiel.context, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'nl-BE', timezoneId: 'Europe/Brussels' });
      const page = await context.newPage();
      const fouten = [];
      page.on('pageerror', (e) => fouten.push(e.message));
      // Expliciet licht: admins landen anders in de rol-standaard (donker).
      await seedPagina(page, { user: scherm.user, view: scherm.view, thema: 'light' });
      await page.goto(url, { waitUntil: 'networkidle' });
      // Fonts + lazy chunks binnen; de korte extra wacht dekt count-ups en
      // late layout (zelfde budget als mobile-audit).
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, `${scherm.naam}.png`), fullPage: profiel.fullPage, animations: 'disabled', caret: 'hide' });
      console.log(`${fouten.length ? '!!' : '  '} ${scherm.naam}${fouten.length ? `  (pageerror: ${fouten[0].slice(0, 120)})` : ''}`);
      await context.close();
    }
    for (const b of browsers.values()) await b.close();
  } finally {
    stop();
  }
}

/** Percentage afwijkende pixels + een diff-beeld (basis | kop | verschil). */
function vergelijkPng(basisPad, kopPad) {
  const a = PNG.sync.read(fs.readFileSync(basisPad));
  const b = PNG.sync.read(fs.readFileSync(kopPad));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const diff = new PNG({ width: w * 3, height: h });
  let anders = 0;
  let bbox = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      const id = (y * diff.width + x) * 4;
      const d = Math.max(
        Math.abs(a.data[ia] - b.data[ib]),
        Math.abs(a.data[ia + 1] - b.data[ib + 1]),
        Math.abs(a.data[ia + 2] - b.data[ib + 2]),
      );
      // Paneel 1: basis, paneel 2: kop, paneel 3: kop vervaagd + rood waar het verschilt.
      diff.data.set(a.data.subarray(ia, ia + 4), id);
      diff.data.set(b.data.subarray(ib, ib + 4), id + w * 4);
      const id3 = id + w * 8;
      if (d > PIXEL_TOLERANTIE) {
        anders++;
        diff.data[id3] = 220; diff.data[id3 + 1] = 38; diff.data[id3 + 2] = 38; diff.data[id3 + 3] = 255;
        if (!bbox) bbox = [x, y, x, y];
        else { bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y); bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y); }
      } else {
        const grijs = Math.round(0.3 * b.data[ib] + 0.59 * b.data[ib + 1] + 0.11 * b.data[ib + 2]);
        const licht = 160 + Math.round(grijs * 0.37);
        diff.data[id3] = licht; diff.data[id3 + 1] = licht; diff.data[id3 + 2] = licht; diff.data[id3 + 3] = 255;
      }
    }
  }
  return {
    pct: (100 * anders) / (w * h),
    bbox,
    maatVerschil: a.width !== b.width || a.height !== b.height ? `${a.width}×${a.height} → ${b.width}×${b.height}` : null,
    diff,
  };
}

function vergelijk({ basis, kop, out, drempel = DREMPEL_STANDAARD }) {
  if (!basis || !kop || !out) throw new Error('gebruik: vergelijk <basis-map> <kop-map> --out <diff-map>');
  fs.mkdirSync(out, { recursive: true });
  const rijen = [];
  const namen = new Set([
    ...fs.readdirSync(kop).filter((f) => f.endsWith('.png')),
    ...(fs.existsSync(basis) ? fs.readdirSync(basis).filter((f) => f.endsWith('.png')) : []),
  ]);
  for (const naam of [...namen].sort()) {
    const b = path.join(basis, naam);
    const k = path.join(kop, naam);
    if (!fs.existsSync(b)) { rijen.push({ naam, status: 'nieuw', pct: null }); continue; }
    if (!fs.existsSync(k)) { rijen.push({ naam, status: 'weg', pct: null }); continue; }
    const r = vergelijkPng(b, k);
    const boven = r.pct > drempel;
    // Diff-beeld alleen als er iets te zien is (≥ 0,01 %): 0,00 %-rijen zonder plaatje.
    if (r.pct >= 0.01) fs.writeFileSync(path.join(out, naam), PNG.sync.write(r.diff));
    rijen.push({ naam, status: boven ? 'afwijkend' : 'ok', pct: r.pct, bbox: r.bbox, maatVerschil: r.maatVerschil });
  }

  const fmt = (r) => r.pct == null ? r.status : `${r.pct.toFixed(2)} %`;
  const kop1 = 'scherm'.padEnd(34);
  const lijnen = [
    `${kop1} ${'afwijking'.padStart(10)}  status${'  opmerking'}`,
    ...rijen.map((r) => `${r.naam.replace(/\.png$/, '').padEnd(34)} ${fmt(r).padStart(10)}  ${(r.status === 'afwijkend' ? '!! boven drempel' : r.status).padEnd(16)}${r.maatVerschil ? `  hoogte/breedte: ${r.maatVerschil}` : ''}`),
  ];
  console.log(`\nVisuele regressie — drempel ${drempel} % per scherm\n`);
  console.log(lijnen.join('\n'));
  const afwijkend = rijen.filter((r) => r.status === 'afwijkend');
  console.log(afwijkend.length
    ? `\n${afwijkend.length} scherm(en) boven de drempel — bekijk de diff-afbeeldingen in ${out} (basis | deze branch | verschil in rood). Dit blokkeert de PR niet.`
    : '\nGeen scherm boven de drempel.');

  fs.writeFileSync(path.join(out, 'rapport.json'), JSON.stringify({ drempel, rijen }, null, 1));
  const md = [
    `### Visuele regressie (drempel ${drempel} % per scherm)`,
    '', '| Scherm | Afwijking | Status |', '|---|---:|---|',
    ...rijen.map((r) => `| ${r.naam.replace(/\.png$/, '')} | ${fmt(r)} | ${r.status === 'afwijkend' ? '⚠️ boven drempel' : r.status}${r.maatVerschil ? ` (${r.maatVerschil})` : ''} |`),
    '',
    afwijkend.length ? `${afwijkend.length} scherm(en) boven de drempel — de diff-afbeeldingen staan in het artifact \`visuele-regressie\`.` : 'Geen scherm boven de drempel.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(out, 'rapport.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

const { los, opties } = argumenten(process.argv.slice(2));
const [modus, ...rest] = los;
try {
  if (modus === 'schiet') await schiet({ out: opties.out, app: opties.app, port: opties.port });
  else if (modus === 'vergelijk') vergelijk({ basis: rest[0], kop: rest[1], out: opties.out, drempel: opties.drempel ? Number(opties.drempel) : undefined });
  else {
    console.error('gebruik: visueel-ci.mjs schiet --out <map> [--app <map>] [--port 4173]\n        visueel-ci.mjs vergelijk <basis-map> <kop-map> --out <diff-map> [--drempel 1.5]');
    process.exit(2);
  }
} catch (e) {
  console.error(`✗ visueel-ci: ${e.message}`);
  process.exit(1);
}
