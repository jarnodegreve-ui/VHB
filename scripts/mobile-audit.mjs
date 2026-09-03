/**
 * Visuele audit/regressie: laadt elk scherm als iPhone (WebKit), Android
 * (Chromium) en — met VISUEEL_DESKTOP=1 — als desktop (1440×900), in licht
 * én donker, schiet screenshots en meet per pagina:
 * schiet full-page screenshots en meet per pagina:
 *  - horizontale overflow (+ de breedste boosdoeners)
 *  - zichtbare interactieve elementen kleiner dan 40×40 px
 *  - inputs met font-size < 16px (iOS zoomt daarop in bij focus)
 *  - pageerrors / console.errors
 * Draait tegen de e2e-preview-build op :4173 met gemockte API (fixtures:
 * scripts/audit-fixtures.mjs — gedeeld met visueel-ci.mjs en de e2e-specs).
 */
import { chromium, webkit, devices } from '@playwright/test';
import fs from 'node:fs';
import { ADMIN, CHAUFFEUR, SESSION_KEY, apiFixtures } from './audit-fixtures.mjs';

const OUT = process.env.AUDIT_OUT || '/tmp/mobiel-audit';
// Poort van de preview-server (npm run preview -- --port <PORT>); zie ook
// scripts/screenshot-diff.py voor het vergelijken van twee uitvoermappen.
const PORT = process.env.AUDIT_PORT || '4173';
const DESKTOP = process.env.VISUEEL_DESKTOP === '1';
const ALLE_THEMAS = process.env.VISUEEL_ALLE_THEMAS === '1';
fs.mkdirSync(OUT, { recursive: true });

const CHAUFFEUR_VIEWS = ['dashboard', 'instellingen', 'rooster', 'omleidingen', 'ritblaadjes', 'documenten', 'contacten', 'updates', 'ruil-verzoeken', 'bezetting', 'verlof'];
const ADMIN_VIEWS = ['dashboard', 'verlof', 'verlof-kalender', 'dekking', 'beheer-roosters', 'planning-matrix', 'planning-codes', 'dienstoverzicht', 'beheer-dienstoverzicht', 'beheer-updates', 'beheer-omleidingen', 'gebruikers', 'toestellen', 'activiteit', 'beheer-debug'];

const PROFILES = [
  ...(DESKTOP ? [{ key: 'desktop', browser: chromium, device: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } }] : []),
  { key: 'iphone', browser: webkit, device: devices['iPhone 13'] },
  ...(DESKTOP ? [] : [{ key: 'android', browser: chromium, device: devices['Pixel 7'] }]),
];

const results = [];

async function auditPage(context, role, user, view, profileKey, dark) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });

  await page.addInitScript(([key, u, v, isDark]) => {
    const inAnHour = Math.floor(Date.now() / 1000) + 3600;
    window.localStorage.setItem(key, JSON.stringify({ access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, expires_at: inAnHour, user: { id: 'auth-e2e', email: u.email, aud: 'authenticated' } }));
    window.localStorage.setItem('vhb-current-view', v);
    if (isDark) window.localStorage.setItem('vhb-theme', 'dark');
  }, [SESSION_KEY, user, view, dark]);
  await page.route('**/api/**', apiFixtures(user));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement;
    const overflowPx = Math.max(doc.scrollWidth - vw, document.body.scrollWidth - vw, 0);
    const offenders = [];
    const small = [];
    const zoomInputs = [];
    const seen = new Set();
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (overflowPx > 1 && r.right > vw + 2 && r.width > 24 && offenders.length < 6) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || ''} (${Math.round(r.width)}px, tot ${Math.round(r.right)})`);
      }
      const interactive = el.matches('button, a[href], [role="button"], [role="switch"], input[type="checkbox"], input[type="radio"], select, summary');
      if (interactive && (r.width < 40 || r.height < 40) && r.width > 2 && r.height > 2) {
        const key = label(el) + Math.round(r.width) + 'x' + Math.round(r.height);
        if (!seen.has(key)) { seen.add(key); if (small.length < 10) small.push(`${label(el)} — ${Math.round(r.width)}×${Math.round(r.height)}`); }
      }
      if (el.matches('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
        const fs = parseFloat(style.fontSize);
        if (fs < 16 && zoomInputs.length < 6) zoomInputs.push(`${el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName} — ${fs}px`);
      }
    }
    return { overflowPx, offenders, smallCount: seen.size, small, zoomInputs };
  });

  const shot = `${OUT}/${profileKey}-${role}-${view}${dark ? '-dark' : ''}.png`;
  await page.screenshot({ path: shot, fullPage: profileKey !== 'desktop' });
  results.push({ profile: profileKey, role, view, dark, ...metrics, errors: errors.slice(0, 4), shot });
  await page.close();
}

for (const profile of PROFILES) {
  const browser = await profile.browser.launch();
  const context = await browser.newContext({ ...profile.device, serviceWorkers: 'block' });

  for (const view of CHAUFFEUR_VIEWS) await auditPage(context, 'chauffeur', CHAUFFEUR, view, profile.key, false);
  for (const view of ADMIN_VIEWS) await auditPage(context, 'admin', ADMIN, view, profile.key, false);
  // Dark-mode: spot-checks, of (VISUEEL_ALLE_THEMAS=1) álle schermen.
  if (ALLE_THEMAS) {
    for (const view of CHAUFFEUR_VIEWS) await auditPage(context, 'chauffeur', CHAUFFEUR, view, profile.key, true);
    for (const view of ADMIN_VIEWS) await auditPage(context, 'admin', ADMIN, view, profile.key, true);
  } else {
    for (const view of ['dashboard', 'rooster', 'verlof']) await auditPage(context, 'chauffeur', CHAUFFEUR, view, profile.key, true);
  }

  // Login-scherm (zonder sessie)
  const page = await context.newPage();
  await page.route('**/api/**', apiFixtures(CHAUFFEUR));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${profile.key}-login.png`, fullPage: true });
  await page.close();

  await browser.close();
}

fs.writeFileSync(`${OUT}/rapport.json`, JSON.stringify(results, null, 1));
const flagged = results.filter((r) => r.overflowPx > 2 || r.smallCount > 0 || r.zoomInputs.length > 0 || r.errors.length > 0);
console.log(`Klaar: ${results.length} pagina-audits, ${flagged.length} met bevindingen.`);
for (const r of flagged) {
  console.log(`\n▶ ${r.profile}/${r.role}/${r.view}${r.dark ? ' (dark)' : ''}`);
  if (r.overflowPx > 2) console.log(`  overflow: ${r.overflowPx}px — ${r.offenders.join(' | ')}`);
  if (r.smallCount > 0) console.log(`  kleine targets (${r.smallCount}): ${r.small.slice(0, 5).join(' | ')}`);
  if (r.zoomInputs.length) console.log(`  zoom-inputs: ${r.zoomInputs.join(' | ')}`);
  if (r.errors.length) console.log(`  fouten: ${r.errors.join(' || ')}`);
}
