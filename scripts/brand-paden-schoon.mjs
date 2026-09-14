// Schone vectorpaden uit het getraceerde VHB-primary-pakket.
//
// De SVG's van de ontwerper (brand/vhb-final-logo-package/*.svg) zijn een
// automatische bitmap-trace: rechte randen golven, hoeken zijn afgerond,
// bogen bobbelen (zichtbaar op de login, in de sidebar op retina en in het
// app-icoon, Jarno 14-09). Dit script herleidt elke omtrek tot zuivere
// geometrie MET de trace als maatvoering, dus zonder het ontwerp te wijzigen:
//   - de omtrek wordt fijn bemonsterd (0,5 eenheid) en met Douglas-Peucker
//     tot hoekpunten herleid; hoeken worden herkend aan een geconcentreerde
//     richtingsverandering (kort én lang venster), bogen aan een verdeelde;
//   - rechte stukken worden kleinste-kwadraten-lijnen (verticaal/horizontaal
//     gesnapt), hoeken worden exacte snijpunten van die lijnen;
//   - afgeronde trace-hoekjes ("druppels") vallen weg in het snijpunt;
//   - gladde stukken worden strakke cubic Béziers (Schneider-fit), gesloten
//     ronde vormen (de O's) exacte cirkels.
// De naamregel is géén opgeschoonde trace maar het echte lettertype: de
// letters zijn Montserrat Medium (geïdentificeerd 14-09 via overlay op de
// trace, elke letter valt samen). Elke glyph wordt uit
// brand/vhb-final-logo-package/font/Montserrat-Medium.ttf (SIL OFL) gehaald
// en op de exacte letterpositie van het pakket gezet (linkerrand van de
// getraceerde letter, kaphoogte 32, basislijn 53), dus spatiëring en
// proporties blijven die van het pakket.
// Per pad wordt het oppervlakteverschil met de trace gemeten (raster 8×):
// merk ±0,4 %, streep ±0,6 %; naamregel ±17 % t.o.v. de trace, dat is de
// trace-ruis rond dunne halen (Regular 32 %, SemiBold 30 %: Medium past).
// Output: brand/vhb-final-logo-package/schoon/*.svg, dezelfde veertien
// bestanden met dezelfde structuur/ids/kleuren, alleen de d-attributen zijn
// schoon. BrandLogo.tsx en brand-icons.mjs lezen uit schoon/.
// Draaien na een nieuw pakket:  node scripts/brand-paden-schoon.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(ROOT, 'brand/vhb-final-logo-package');
const OUT = path.join(BRAND, 'schoon');
const MASTER = fs.readFileSync(path.join(BRAND, 'VHB-primary-kleur.svg'), 'utf8');
// De drie getraceerde paden (merk-inkt, merk-goud, naamregel) staan letterlijk
// gelijk in alle pakketbestanden; alleen de fill verschilt.
const paden = [...MASTER.matchAll(/<path fill="(#[0-9A-Fa-f]{6})" fill-rule="evenodd" d="([^"]+)"/g)].map((m) => ({ fill: m[1], d: m[2] }));
if (paden.length !== 3) throw new Error(`verwachtte 3 paden in het master, vond ${paden.length}`);

const PARAMS = { merk: { DP_TOL: 0.7, HOEK_GRAAD: 18, SNAP_GRAAD: 1.3, SNAP_KORT: 4, BEZ_TOL: 0.55, LINE_RES: 0.6, DROP: 5, W: 6, STAART: true, SNIJ_TOL: 9, SNIJ_HOEK: 8 }, letters: { DP_TOL: 0.5, HOEK_GRAAD: 24, SNAP_GRAAD: 3, SNAP_KORT: 5, BEZ_TOL: 0.45, LINE_RES: 0.8, DROP: 1.5, W: 3, STAART: false, SNIJ_TOL: 2.5, SNIJ_HOEK: 15 } };
let P = PARAMS.merk;
let DP_TOL, HOEK_GRAAD, SNAP_GRAAD, BEZ_TOL, LINE_RES, DROP, W_EENH;
function setP(p) { P = p; ({ DP_TOL, HOEK_GRAAD, SNAP_GRAAD, BEZ_TOL, LINE_RES, DROP } = p); W_EENH = p.W; }
setP(PARAMS.merk);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1], norm = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / norm(a));
function dp(pts, tol) { if (pts.length < 3) return pts; let maxD = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1]; const L = norm(sub(b, a));
  for (let i = 1; i < pts.length - 1; i++) { const d = L < 1e-9 ? norm(sub(pts[i], a)) : Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L; if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > tol) { const l = dp(pts.slice(0, idx + 1), tol), r = dp(pts.slice(idx), tol); return l.slice(0, -1).concat(r); } return [a, b]; }
function closedDPidx(S, tol) { // geeft indices in S
  const a = S[0]; let far = 0, fd = 0; S.forEach((p, i) => { const d = norm(sub(p, a)); if (d > fd) { fd = d; far = i; } });
  const withIdx = S.map((p, i) => [p[0], p[1], i]);
  const h1 = dp(withIdx.slice(0, far + 1), tol), h2 = dp(withIdx.slice(far), tol); return h1.slice(0, -1).concat(h2.slice(0, -1)).map((p) => p[2]); }
function lineFit(pts) { const n = pts.length; const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n; let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; } const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); let dir = [Math.cos(th), Math.sin(th)];
  // snap naar assen
  const span = norm(sub(pts[pts.length - 1], pts[0])); const snap = span < 10 ? P.SNAP_KORT : SNAP_GRAAD;
  const angV = Math.atan2(Math.abs(dir[0]), Math.abs(dir[1])) * 180 / Math.PI; if (angV < snap) dir = [0, 1]; else if (90 - angV < snap) dir = [1, 0];
  let maxr = 0; for (const q of pts) { const r = Math.abs(-dir[1] * (q[0] - mx) + dir[0] * (q[1] - my)); if (r > maxr) maxr = r; }
  return { p: [mx, my], dir, maxr }; }
function intersect(l1, l2) { const d = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0]; if (Math.abs(d) < 1e-6) return null; const w = sub(l2.p, l1.p); const t = (w[0] * l2.dir[1] - w[1] * l2.dir[0]) / d; return add(l1.p, mul(l1.dir, t)); }
function project(l, q) { const t = dot(sub(q, l.p), l.dir); return add(l.p, mul(l.dir, t)); }
// Schneider fit
function fitCubic(pts, t0, t1, tol) { const out = []; fitRec(pts, t0, t1, tol, out, 0); return out; }
function fitRec(pts, tHat1, tHat2, tol, out, depth) {
  if (pts.length === 2) { const d = norm(sub(pts[1], pts[0])) / 3; out.push([pts[0], add(pts[0], mul(tHat1, d)), add(pts[1], mul(tHat2, d)), pts[1]]); return; }
  let u = chordLen(pts); let bez = generate(pts, u, tHat1, tHat2); let [err, split] = maxErr(pts, bez, u);
  if (err < tol) { out.push(bez); return; }
  if (err < tol * tol && depth < 6) { for (let i = 0; i < 20; i++) { u = reparam(pts, u, bez); bez = generate(pts, u, tHat1, tHat2); [err, split] = maxErr(pts, bez, u); if (err < tol) { out.push(bez); return; } } }
  if (depth > 12) { out.push(bez); return; }
  const tC = unit(sub(pts[split - 1], pts[split + 1])); // centrum-tangent
  fitRec(pts.slice(0, split + 1), tHat1, tC, tol, out, depth + 1); fitRec(pts.slice(split), mul(tC, -1), tHat2, tol, out, depth + 1); }
function chordLen(pts) { const u = [0]; for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + norm(sub(pts[i], pts[i - 1]))); const L = u[u.length - 1]; return u.map((v) => v / L); }
const B0 = (t) => (1 - t) ** 3, B1 = (t) => 3 * t * (1 - t) ** 2, B2 = (t) => 3 * t * t * (1 - t), B3 = (t) => t ** 3;
function generate(pts, u, t1, t2) { const n = pts.length; const p0 = pts[0], p3 = pts[n - 1]; let C = [[0, 0], [0, 0]], X = [0, 0];
  for (let i = 0; i < n; i++) { const a1 = mul(t1, B1(u[i])), a2 = mul(t2, B2(u[i])); C[0][0] += dot(a1, a1); C[0][1] += dot(a1, a2); C[1][1] += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, B0(u[i]) + B1(u[i])), mul(p3, B2(u[i]) + B3(u[i])))); X[0] += dot(a1, tmp); X[1] += dot(a2, tmp); } C[1][0] = C[0][1];
  const det = C[0][0] * C[1][1] - C[1][0] * C[0][1]; let a1 = 0, a2 = 0; if (Math.abs(det) > 1e-12) { a1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det; a2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det; }
  const seg = norm(sub(p3, p0)); const eps = 1e-6 * seg; if (a1 < eps || a2 < eps) { const d = seg / 3; return [p0, add(p0, mul(t1, d)), add(p3, mul(t2, d)), p3]; }
  return [p0, add(p0, mul(t1, a1)), add(p3, mul(t2, a2)), p3]; }
function evalB(b, t) { return add(add(mul(b[0], B0(t)), mul(b[1], B1(t))), add(mul(b[2], B2(t)), mul(b[3], B3(t)))); }
function maxErr(pts, b, u) { let maxD = 0, split = pts.length >> 1; for (let i = 1; i < pts.length - 1; i++) { const d = norm(sub(evalB(b, u[i]), pts[i])); if (d > maxD) { maxD = d; split = i; } } return [maxD, split]; }
function reparam(pts, u, b) { return u.map((t, i) => { const q = evalB(b, t); const d1 = add(add(mul(b[0], -3 * (1 - t) ** 2), mul(b[1], 3 * (1 - t) ** 2 - 6 * t * (1 - t))), add(mul(b[2], 6 * t * (1 - t) - 3 * t * t), mul(b[3], 3 * t * t)));
  const d2 = add(add(mul(b[0], 6 * (1 - t)), mul(b[1], -12 * (1 - t) + 6 * t)), add(mul(b[2], 6 * (1 - t) - 12 * t), mul(b[3], 6 * t))); const diff = sub(q, pts[i]); const num = dot(diff, d1), den = dot(d1, d1) + dot(diff, d2); return den === 0 ? t : Math.min(1, Math.max(0, t - num / den)); }); }
function circleFit(pts) { let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = pts.length; for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [-sxz, -syz, -sz]; const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); const rep = (m, i, v) => m.map((r, k) => r.map((c, j) => (j === i ? v[k] : c))); const A = det(rep(M, 0, v)) / D, B = det(rep(M, 1, v)) / D, C = det(rep(M, 2, v)) / D; const cx = -A / 2, cy = -B / 2, r = Math.sqrt(cx * cx + cy * cy - C);
  let maxr = 0; for (const [x, y] of pts) { const e = Math.abs(Math.hypot(x - cx, y - cy) - r); if (e > maxr) maxr = e; } return { cx, cy, r, maxr }; }
const f = (v) => +v.toFixed(2);

function cleanSub(S) {
  const idx = closedDPidx(S, DP_TOL); const n = idx.length;
  const seg = (i) => { const a = idx[i], b = idx[(i + 1) % n]; return b > a ? S.slice(a, b + 1) : S.slice(a).concat(S.slice(0, b + 1)); };
  const dirs = idx.map((_, i) => { const p = seg(i); return unit(sub(p[p.length - 1], p[0])); });
  const lens = idx.map((_, i) => { const p = seg(i); return norm(sub(p[p.length - 1], p[0])); });
  // hoek bij vertex i = tussen segment i-1 en segment i
  // Hoekdetectie op vaste booglengte (schaal-onafhankelijk): richting van de
  // 4 eenheden vóór vs. ná een DP-vertex; scherp (> HOEK_GRAAD) = hoek.
  // Hoekdetectie met twee vensters: een echte hoek concentreert zijn draai in
  // één punt (korte en lange venster geven ~dezelfde draai), een boog verdeelt
  // hem (korte venster ≪ lange). Licht gladgestreken kopie (±1 eenheid).
  const N = S.length; const WL = Math.max(2, Math.round(W_EENH / 0.5)), WS = 4;
  const G = S.map((_, i) => { let x = 0, y = 0; for (let k = -2; k <= 2; k++) { const q = S[(i + k + N) % N]; x += q[0]; y += q[1]; } return [x / 5, y / 5]; });
  const turnAt = (i, W) => { const a = sub(G[i], G[(i - W + N) % N]), b = sub(G[(i + W) % N], G[i]); return Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180 / Math.PI; };
  const isCorner = idx.map((si) => { const tl = turnAt(si, WL), ts = turnAt(si, WS); return tl > HOEK_GRAAD && ts > 0.6 * tl; });
  let corners = idx.map((_, i) => i).filter((i) => isCorner[i]);
  if (corners.length <= 1) { // gesloten gladde lus: cirkel?
    const c = circleFit(S); if (c.maxr < 0.7) return { d: `M ${f(c.cx + c.r)} ${f(c.cy)} A ${f(c.r)} ${f(c.r)} 0 1 1 ${f(c.cx - c.r)} ${f(c.cy)} A ${f(c.r)} ${f(c.r)} 0 1 1 ${f(c.cx + c.r)} ${f(c.cy)} Z`, soort: 'cirkel', info: c };
    // anders: splits op 4 extremen en fit
    const ext = [0, 0, 0, 0]; S.forEach((p, i) => { if (p[0] < S[ext[0]][0]) ext[0] = i; if (p[1] < S[ext[1]][1]) ext[1] = i; if (p[0] > S[ext[2]][0]) ext[2] = i; if (p[1] > S[ext[3]][1]) ext[3] = i; });
    const cuts = [...new Set(ext)].sort((a, b) => a - b); let d = ''; const bezs = [];
    for (let k = 0; k < cuts.length; k++) { const a = cuts[k], b = cuts[(k + 1) % cuts.length]; const pts = b > a ? S.slice(a, b + 1) : S.slice(a).concat(S.slice(0, b + 1));
      const tan = (i) => unit(sub(S[(i + 3) % S.length], S[(i - 3 + S.length) % S.length])); bezs.push(...fitCubic(pts, tan(a), mul(tan(b), -1), BEZ_TOL)); }
    d = `M ${f(bezs[0][0][0])} ${f(bezs[0][0][1])} ` + bezs.map((b) => `C ${f(b[1][0])} ${f(b[1][1])} ${f(b[2][0])} ${f(b[2][1])} ${f(b[3][0])} ${f(b[3][1])}`).join(' ') + ' Z';
    return { d, soort: 'glad', n: bezs.length }; }
  // stukken tussen hoeken
  const pieces = []; for (let k = 0; k < corners.length; k++) { const ci = corners[k], cj = corners[(k + 1) % corners.length]; const a = idx[ci], b = idx[cj]; const pts = b > a ? S.slice(a, b + 1) : S.slice(a).concat(S.slice(0, b + 1));
    let nSeg = (cj - ci + n) % n; if (nSeg === 0) nSeg = n; pieces.push({ pts, nSeg, straight: nSeg === 1 }); }
  // lijnen fitten: één DP-segment, óf een kromme die binnen LINE_RES recht is
  for (const p of pieces) { const chord = norm(sub(p.pts[p.pts.length - 1], p.pts[0])); p.chord = chord; const lf = lineFit(p.pts);
    if (p.straight || (lf.maxr < LINE_RES && chord > 3)) { p.straight = true; p.line = lf; continue; }
    // Rechte rand met een afgerond staartje (trace-artefact op een hoek): lijn
    // fitten op het middenstuk, langste aaneengesloten run binnen LINE_RES
    // zoeken; dekt die ≥ 80 % van het stuk, dan is het een rechte rand en
    // vervangt het snijpunt met de buur de afronding.
    if (P.STAART && chord > 20) { const n = p.pts.length; const mid = lineFit(p.pts.slice(Math.floor(n * 0.2), Math.ceil(n * 0.8)));
      const res = p.pts.map((q) => Math.abs(-mid.dir[1] * (q[0] - mid.p[0]) + mid.dir[0] * (q[1] - mid.p[1])));
      let best = 0, bs = 0, run = 0, rs = 0; for (let i = 0; i < n; i++) { if (res[i] < LINE_RES) { if (run === 0) rs = i; run++; if (run > best) { best = run; bs = rs; } } else run = 0; }
      if (best >= 0.8 * n) { p.straight = true; p.line = lineFit(p.pts.slice(bs, bs + best)); p.staart = true; } } }
  // druppels/afrondingen: korte niet-rechte stukjes tussen twee rechte stukken → scherpe hoek
  let m = pieces.length;
  for (let k = 0; k < m; k++) { const cur = pieces[k], prev = pieces[(k - 1 + m) % m], next = pieces[(k + 1) % m];
    if (cur.chord < DROP && pieces.length > 3 && prev !== next) { if (prev.straight && next.straight) { const x = intersect(prev.line, next.line); if (x && norm(sub(x, cur.pts[0])) < 8) cur.drop = true; } else cur.drop = true; } }
  const kept = pieces.filter((p) => !p.drop); m = kept.length;
  // eindpunten: snijpunt van twee lijnen, anders projectie/ruw
  const starts = [];
  for (let k = 0; k < m; k++) { const prev = kept[(k - 1 + m) % m], cur = kept[k]; const raw = cur.pts[0]; let pt = raw;
    if (prev.straight && cur.straight) { const x = intersect(prev.line, cur.line); const hoek = Math.acos(Math.min(1, Math.abs(dot(prev.line.dir, cur.line.dir)))) * 180 / Math.PI; if (x && hoek > P.SNIJ_HOEK && norm(sub(x, raw)) < P.SNIJ_TOL) pt = x; else pt = project(cur.line, raw); }
    else if (cur.straight) pt = project(cur.line, raw); else if (prev.straight) pt = project(prev.line, raw); starts.push(pt); }
  let d = `M ${f(starts[0][0])} ${f(starts[0][1])}`; let nb = 0;
  for (let k = 0; k < m; k++) { const cur = kept[k]; const end = starts[(k + 1) % m];
    if (cur.straight) d += ` L ${f(end[0])} ${f(end[1])}`;
    else { const pts = [starts[k], ...cur.pts.slice(1, -1), end]; const t1 = unit(sub(pts[Math.min(4, pts.length - 1)], pts[0])), t2 = unit(sub(pts[Math.max(0, pts.length - 5)], pts[pts.length - 1]));
      const bezs = fitCubic(pts, t1, t2, BEZ_TOL); nb += bezs.length; for (const b of bezs) d += ` C ${f(b[1][0])} ${f(b[1][1])} ${f(b[2][0])} ${f(b[2][1])} ${f(b[3][0])} ${f(b[3][1])}`; } }
  d += ' Z'; return { d, soort: 'gemengd', hoeken: corners.length, bezier: nb, drops: pieces.length - m, stukken: kept.map((p) => (p.straight ? 'L' : 'C') + Math.round(p.chord)).join(' ') }; }


// --- bemonsteren (browser: getPointAtLength) --------------------------------
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<svg xmlns="http://www.w3.org/2000/svg" id="s" width="2000" height="600"></svg>');
const subs = await page.evaluate((paden) => {
  const svg = document.getElementById('s'); const out = [];
  paden.forEach((pad, pi) => pad.d.split(/(?=M)/).filter((x) => x.trim()).forEach((sd, si) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path'); el.setAttribute('d', sd); svg.appendChild(el);
    const L = el.getTotalLength(); const n = Math.max(200, Math.round(L / 0.5)); const pts = [];
    for (let i = 0; i <= n; i++) { const q = el.getPointAtLength((L * i) / n); pts.push([q.x, q.y]); }
    out.push({ pad: pi, sub: si, samples: pts });
  }));
  return out;
}, paden);

// --- opschonen ----------------------------------------------------------------
const schoonPerPad = [[], [], []];
for (const s of subs) { setP(s.pad === 2 ? PARAMS.letters : PARAMS.merk); const r = cleanSub(s.samples); schoonPerPad[s.pad].push(r.d); }
// Naamregel: Montserrat Medium op de letterposities van het pakket.
const TEKST = 'VANHOOREBEKE&ZOON'.split('');
const CAP = 32, BASIS = 53; // kapitalen in de trace: y 21–53
const font = opentype.loadSync(path.join(BRAND, 'font/Montserrat-Medium.ttf'));
const fontSize = CAP / ((font.tables.os2.sCapHeight || 700) / font.unitsPerEm);
const letterSubs = subs.filter((s) => s.pad === 2).slice(0, TEKST.length); // de 17 buitenomtrekken staan in leesvolgorde
const naamregel = TEKST.map((ch, i) => {
  const g = font.charToGlyph(ch); const bb = g.getPath(0, 0, fontSize).getBoundingBox();
  const links = Math.min(...letterSubs[i].samples.map((q) => q[0]));
  return g.getPath(links - bb.x1, BASIS, fontSize).toPathData(2);
}).join(' ');
schoonPerPad[2] = [naamregel];
const schoonD = schoonPerPad.map((ds) => ds.join(' '));

// --- controle: oppervlakteverschil met de trace (raster 8×) -------------------
const meting = await page.evaluate(({ paden, schoonD }) => {
  const c = document.createElement('canvas'); const S = 8; const out = [];
  for (let i = 0; i < paden.length; i++) { const box = i === 2 ? [880, 70] : [620, 240]; c.width = box[0] * S; c.height = box[1] * S; const ctx = c.getContext('2d');
    const draw = (d) => { ctx.setTransform(S, 0, 0, S, 0, 0); ctx.fillStyle = '#000'; ctx.fill(new Path2D(d), 'evenodd'); };
    ctx.clearRect(0, 0, c.width, c.height); draw(paden[i].d); const A = ctx.getImageData(0, 0, c.width, c.height).data;
    ctx.clearRect(0, 0, c.width, c.height); draw(schoonD[i]); const B = ctx.getImageData(0, 0, c.width, c.height).data;
    let area = 0, xor = 0; for (let k = 3; k < A.length; k += 4) { const a = A[k] > 127, b = B[k] > 127; if (a) area++; if (a !== b) xor++; }
    out.push(+(100 * xor / area).toFixed(2)); }
  return out;
}, { paden, schoonD });
await browser.close();
console.log(`verschil met de trace: merk ${meting[0]} % · streep ${meting[1]} % · naamregel ${meting[2]} %`);
if (meting[0] > 1 || meting[1] > 1.5 || meting[2] > 22) throw new Error('afwijking te groot, niet weggeschreven');

// --- wegschrijven: alle pakketbestanden met schone d's -----------------------
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const naam of fs.readdirSync(BRAND).filter((f) => f.endsWith('.svg'))) {
  let svg = fs.readFileSync(path.join(BRAND, naam), 'utf8'); let i = 0;
  svg = svg.replace(/(<path fill="#[0-9A-Fa-f]{6}" fill-rule="evenodd" d=")[^"]+(")/g, (_, a, b) => `${a}${schoonD[i++]}${b}`);
  if (i !== 3) throw new Error(`${naam}: ${i} paden vervangen`);
  svg = svg.replace('<title>', '<!-- Schone vectorversie (scripts/brand-paden-schoon.mjs) van het getraceerde pakketbestand: merk als zuivere geometrie op de trace, naamregel in Montserrat Medium op de letterposities van het pakket. --><title>');
  fs.writeFileSync(path.join(OUT, naam), svg); n++;
}
console.log(`✓ ${n} bestanden in brand/vhb-final-logo-package/schoon/`);
