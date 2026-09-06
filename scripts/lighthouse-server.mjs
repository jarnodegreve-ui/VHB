#!/usr/bin/env node
/**
 * Statische server + API-mocks voor Lighthouse CI (prestatiebudget, 09-2026).
 *
 * Serveert `dist/` zoals Vercel dat doet (SPA-fallback naar index.html,
 * immutable cache op /assets, brotli/gzip — zonder compressie meet Lighthouse
 * 630 kB ongecomprimeerde JS en zakt de score naar 0,6 terwijl Vercel wél
 * comprimeert) en beantwoordt elke /api/**-call met dezelfde
 * fixtures als de e2e-specs en de visuele regressie (scripts/audit-fixtures.mjs)
 * — één bron, geen tweede set testdata.
 *
 * Twee soorten pagina's:
 *   /            loginscherm (geen sessie)
 *   /mijn-dag    ingelogd als chauffeur: index.html krijgt vóór de app-bundel
 *                één inline script dat de sessie + view in localStorage zet
 *                (sessieInitScript uit de fixtures — precies wat Playwright
 *                via addInitScript doet). Lighthouse heeft geen init-script-
 *                haak zonder puppeteer, vandaar deze omweg.
 *
 * Gebruik (lhci start hem zelf via .lighthouserc.json):
 *   node scripts/lighthouse-server.mjs [--port 4191] [--dist dist]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { CHAUFFEUR, SESSION_KEY, apiFixtures, sessieInitScript } from './audit-fixtures.mjs';

const args = process.argv.slice(2);
const optie = (naam, standaard) => {
  const i = args.indexOf(`--${naam}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : standaard;
};
const PORT = Number(optie('port', '4191'));
const DIST = path.resolve(optie('dist', 'dist'));

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`Geen ${path.join(DIST, 'index.html')} — eerst bouwen (met VITE_SUPABASE_URL=http://localhost:${PORT}).`);
  process.exit(1);
}

/** Paden die als ingelogde chauffeur geladen worden (URL = view, zie routes.tsx). */
const INGELOGD = new Map([
  ['/mijn-dag', 'mijn-dag'],
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');

/** Tekstbestanden die gecomprimeerd de lijn op gaan (zoals bij Vercel). */
const COMPRIMEERBAAR = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.map', '.txt']);
const brotliCache = new Map();
const brotli = (sleutel, buf) => {
  let out = brotliCache.get(sleutel);
  if (!out) {
    out = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
    brotliCache.set(sleutel, out);
  }
  return out;
};
// Vooraf comprimeren wat in het kritieke pad zit (assets + html), zodat de
// eerste Lighthouse-run geen compressietijd in zijn TTFB meet.
for (const naam of fs.readdirSync(path.join(DIST, 'assets'))) {
  if (/\.(js|css)$/.test(naam)) brotli(`/assets/${naam}`, fs.readFileSync(path.join(DIST, 'assets', naam)));
}
brotli('/index.html', Buffer.from(indexHtml));

/** Antwoord met brotli (Chrome) of gzip als terugval; anders ongecomprimeerd. */
function stuur(req, res, status, headers, body, sleutel) {
  const accept = String(req.headers['accept-encoding'] ?? '');
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (sleutel && /\bbr\b/.test(accept)) {
    res.writeHead(status, { ...headers, 'content-encoding': 'br', vary: 'accept-encoding' });
    res.end(brotli(sleutel, buf));
  } else if (/\bgzip\b/.test(accept)) {
    res.writeHead(status, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' });
    res.end(zlib.gzipSync(buf));
  } else {
    res.writeHead(status, headers);
    res.end(buf);
  }
}

/** index.html met de sessie in localStorage, vóór het module-script. */
function indexMetSessie(view) {
  const init = `<script>(${sessieInitScript.toString()})(${JSON.stringify({ key: SESSION_KEY, user: CHAUFFEUR, view, thema: 'light' })});</script>`;
  return indexHtml.replace('<script type="module"', `${init}\n    <script type="module"`);
}

const mock = apiFixtures(CHAUFFEUR);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = url.pathname;

  // API-mocks via een minimaal Playwright-route-achtig object.
  if (p.startsWith('/api/')) {
    await mock({
      request: () => ({ url: () => url.toString(), method: () => req.method ?? 'GET' }),
      fulfill: ({ status, contentType, body }) => {
        stuur(req, res, status, { 'content-type': contentType, 'cache-control': 'no-store' }, body);
      },
    });
    return;
  }

  // Statisch bestand uit dist/ (padtraversal afgevangen door de prefix-check).
  const bestand = path.normalize(path.join(DIST, decodeURIComponent(p)));
  if (bestand.startsWith(DIST) && fs.existsSync(bestand) && fs.statSync(bestand).isFile()) {
    const ext = path.extname(bestand);
    const immutable = p.startsWith('/assets/');
    const headers = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      // Gehashte assets: een jaar immutable (zoals Vercel); de rest kort.
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    };
    if (COMPRIMEERBAAR.has(ext)) stuur(req, res, 200, headers, fs.readFileSync(bestand), p);
    else { res.writeHead(200, headers); fs.createReadStream(bestand).pipe(res); }
    return;
  }

  // SPA-fallback: index.html, met sessie voor de ingelogde paden.
  const view = INGELOGD.get(p);
  const headers = { 'content-type': MIME['.html'], 'cache-control': 'no-store' };
  if (view) stuur(req, res, 200, headers, indexMetSessie(view), `/index.html#${view}`);
  else stuur(req, res, 200, headers, indexHtml, '/index.html');
});

server.listen(PORT, () => {
  console.log(`Lighthouse-server luistert op http://localhost:${PORT} (dist: ${DIST})`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
