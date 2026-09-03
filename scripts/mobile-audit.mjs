/**
 * Visuele audit/regressie: laadt elk scherm als iPhone (WebKit), Android
 * (Chromium) en — met VISUEEL_DESKTOP=1 — als desktop (1440×900), in licht
 * én donker, schiet screenshots en meet per pagina:
 * schiet full-page screenshots en meet per pagina:
 *  - horizontale overflow (+ de breedste boosdoeners)
 *  - zichtbare interactieve elementen kleiner dan 40×40 px
 *  - inputs met font-size < 16px (iOS zoomt daarop in bij focus)
 *  - pageerrors / console.errors
 * Draait tegen de e2e-preview-build op :4173 met gemockte API.
 */
import { chromium, webkit, devices } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.env.AUDIT_OUT || '/tmp/mobiel-audit';
// Poort van de preview-server (npm run preview -- --port <PORT>); zie ook
// scripts/screenshot-diff.py voor het vergelijken van twee uitvoermappen.
const PORT = process.env.AUDIT_PORT || '4173';
const DESKTOP = process.env.VISUEEL_DESKTOP === '1';
const ALLE_THEMAS = process.env.VISUEEL_ALLE_THEMAS === '1';
fs.mkdirSync(OUT, { recursive: true });

const SESSION_KEY = 'sb-localhost-auth-token';
const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const CHAUFFEUR = { id: '42', name: 'Test Chauffeur', role: 'chauffeur', employeeId: 'VHB-000042', email: 'test@vhb.be', isActive: true, verlofBudget: 20, phone: '0470 00 00 00' };
const ADMIN = { id: '1', name: 'Jarno De Greve', role: 'admin', employeeId: 'VHB-000001', email: 'jarno@vhb.be', isActive: true };
const USERS = [ADMIN, CHAUFFEUR,
  { id: '43', name: 'Alex Du Priez', role: 'chauffeur', employeeId: 'VHB-000043', email: 'alex@vhb.be', isActive: true, phone: '0470 11 11 11' },
  { id: '44', name: 'Diether Van Haute', role: 'chauffeur', employeeId: 'VHB-000044', email: 'diether@vhb.be', isActive: true, phone: '0470 22 22 22' },
];
const PLANNING = [
  { id: 't1', date: dayOffset(0), startTime: '04:36', endTime: '07:52', line: '2101', busNumber: '', loopnr: '4500', driverId: '42' },
  { id: 't2', date: dayOffset(0), startTime: '13:39', endTime: '17:29', line: '2101', busNumber: '', loopnr: '4611', driverId: '42' },
  { id: 's1', date: dayOffset(1), startTime: '06:12', endTime: '09:30', line: '4101', busNumber: '', loopnr: '4500', driverId: '43' },
  { id: 's2', date: dayOffset(2), startTime: '15:41', endTime: '26:16', line: '2607', busNumber: '', loopnr: '4500', driverId: '44' },
];
const SERVICES = [
  { id: '1', serviceNumber: '2101', startTime: '04:36', endTime: '07:52', loopnr: '4500', startTime2: '13:39', endTime2: '17:29', loopnr2: '4611' },
  { id: '2', serviceNumber: '2607', startTime: '15:41', endTime: '26:16', loopnr: '4500' },
  { id: '3', serviceNumber: '2515', startTime: '07:08', endTime: '08:34', loopnr: '4505', startTime2: '15:13', endTime2: '21:55', loopnr2: '4510', startTime3: '24:10', endTime3: '25:10', loopnr3: '4515' },
];
const DIVERSIONS = [
  { id: 'd1', line: '58', title: 'Werken Markt Zottegem', description: 'Omleiding via de ring, haltes Markt en Station vervallen tijdelijk.', startDate: dayOffset(-3), endDate: dayOffset(14), severity: 'medium' },
  { id: 'd2', line: '23', title: 'Wielerwedstrijd', description: 'Volledige doortocht afgesloten tussen 12u en 18u.', startDate: dayOffset(-30), endDate: dayOffset(-2), severity: 'high' },
];
const UPDATES = [
  { id: 'u1', title: 'Nieuwe zomeruniformen beschikbaar', content: 'Vanaf volgende week liggen de nieuwe zomeruniformen klaar in het depot. Kom langs tijdens de kantooruren om jouw maat te passen.\n\nGraag ophalen vóór eind augustus.', date: '2026-07-20', isUrgent: false, category: 'algemeen' },
  { id: 'u2', title: 'Onderhoud aan boordcomputers', content: 'Alle bussen krijgen dit weekend een software-update.', date: '2026-07-27', isUrgent: true, category: 'technisch' },
];
const LEAVE = [
  { id: 'l1', userId: '43', startDate: dayOffset(5), endDate: dayOffset(9), type: 'betaald_verlof', status: 'pending', createdAt: new Date().toISOString() },
  { id: 'l2', userId: '42', startDate: dayOffset(-20), endDate: dayOffset(-16), type: 'betaald_verlof', status: 'approved', createdAt: new Date(Date.now() - 25 * 864e5).toISOString(), decidedAt: new Date(Date.now() - 22 * 864e5).toISOString() },
];
const SWAPS = [
  { id: 'sw1', shiftId: 's1', requesterId: '43', targetDriverId: '42', status: 'pending', reason: 'Familiefeest', createdAt: new Date(Date.now() - 3600e3).toISOString(), returnDate: dayOffset(3), returnCode: 'VRIJ' },
];
const DEVICES = [
  { userId: '42', deviceToken: 'tok-1', name: 'iPhone · app', status: 'approved', createdAt: dayOffset(-8), lastSeenAt: dayOffset(0) },
  { userId: '43', deviceToken: 'tok-2', name: 'Android · browser', status: 'pending', createdAt: dayOffset(0), lastSeenAt: dayOffset(0) },
];
const LOGINS = USERS.map((u, i) => ({ id: `lg${i}`, actorName: u.name, action: 'Aangemeld', category: 'auth', createdAt: new Date(Date.now() - i * 7200e3).toISOString(), entityId: u.id, details: '' }));
const ACTIVITY = [
  { id: 'a1', createdAt: new Date().toISOString(), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'planning', action: 'Planning geïmporteerd', details: 'Matrix juli verwerkt.' },
  { id: 'a2', createdAt: new Date(Date.now() - 3600e3).toISOString(), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'users', action: 'Gebruiker gewijzigd', details: 'Alex Du Priez bijgewerkt.' },
];

function apiFixtures(user) {
  return async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.endsWith('/api/me')) return json(user);
    if (p.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (p.endsWith('/api/devices/gate')) return json({ enabled: true });
    if (p.endsWith('/api/devices')) return json(DEVICES);
    if (p.endsWith('/api/planning')) return json(PLANNING);
    if (p.endsWith('/api/users')) return json(USERS);
    if (p.endsWith('/api/services')) return json(SERVICES);
    if (p.endsWith('/api/diversions')) return json(DIVERSIONS);
    if (p.endsWith('/api/updates')) return json(UPDATES);
    if (p.endsWith('/api/leave')) return json(user.role === 'chauffeur' ? LEAVE.filter((l) => l.userId === user.id) : LEAVE);
    if (p.endsWith('/api/swaps')) return json(SWAPS);
    if (p.endsWith('/api/activity/logins')) return json({ logins: LOGINS });
    if (p.endsWith('/api/activity')) return json(ACTIVITY);
    if (p.endsWith('/api/ritblaadje')) return json(null);
    if (p.endsWith('/api/planning-matrix/changes-since-import')) return json({ lastImport: { createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), importedDays: 31 }, approvedLeave: [], approvedSwaps: [] });
    if (p.includes('/api/coverage-gaps')) return json({ days: [{ date: new Date().toISOString().slice(0, 10), expected: ['2101', '2607'], scheduled: ['2101'], missing: ['2607'], unknown: [] }] });
    if (p.endsWith('/api/coverage-expectations')) return json({ weekdays: ['', '', '', '', '', '', ''], overrides: [] });
    if (p.includes('/api/health')) return json({ status: 'ok', supabase: 'configured', tables: {}, smtp: { status: 'configured', from: 'noreply@vhbportaal.com', host: 'smtp.resend.com' }, env: 'e2e', time: new Date().toISOString() });
    return json([]);
  };
}

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
