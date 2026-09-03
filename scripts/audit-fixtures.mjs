/**
 * Gedeelde fixtures voor de visuele audits en de e2e-specs die een compleet
 * ingelogd scherm nodig hebben (scripts/mobile-audit.mjs, scripts/visueel-ci.mjs,
 * e2e/desktop.spec.ts, e2e/a11y.spec.ts). Eén bron: wie hier een veld
 * toevoegt, ziet het in álle screenshots en scans tegelijk.
 *
 * Werkwijze (zie ook e2e/dashboard.spec.ts): de sessie wordt vóór het laden
 * in localStorage gezet (supabase-js leest die uit zonder handtekening te
 * valideren) en elke /api/**-call wordt met vaste data beantwoord.
 */

export const SESSION_KEY = 'sb-localhost-auth-token';

/** Vandaag + n dagen als yyyy-mm-dd (lokale tijd, zoals de app rekent). */
export const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const CHAUFFEUR = { id: '42', name: 'Test Chauffeur', role: 'chauffeur', employeeId: 'VHB-000042', email: 'test@vhb.be', isActive: true, verlofBudget: 20, phone: '0470 00 00 00' };
export const ADMIN = { id: '1', name: 'Jarno De Greve', role: 'admin', employeeId: 'VHB-000001', email: 'jarno@vhb.be', isActive: true };
export const USERS = [ADMIN, CHAUFFEUR,
  { id: '43', name: 'Alex Du Priez', role: 'chauffeur', employeeId: 'VHB-000043', email: 'alex@vhb.be', isActive: true, phone: '0470 11 11 11' },
  { id: '44', name: 'Diether Van Haute', role: 'chauffeur', employeeId: 'VHB-000044', email: 'diether@vhb.be', isActive: true, phone: '0470 22 22 22' },
];
export const PLANNING = [
  { id: 't1', date: dayOffset(0), startTime: '04:36', endTime: '07:52', line: '2101', busNumber: '', loopnr: '4500', driverId: '42' },
  { id: 't2', date: dayOffset(0), startTime: '13:39', endTime: '17:29', line: '2101', busNumber: '', loopnr: '4611', driverId: '42' },
  { id: 's1', date: dayOffset(1), startTime: '06:12', endTime: '09:30', line: '4101', busNumber: '', loopnr: '4500', driverId: '43' },
  { id: 's2', date: dayOffset(2), startTime: '15:41', endTime: '26:16', line: '2607', busNumber: '', loopnr: '4500', driverId: '44' },
];
export const SERVICES = [
  { id: '1', serviceNumber: '2101', startTime: '04:36', endTime: '07:52', loopnr: '4500', startTime2: '13:39', endTime2: '17:29', loopnr2: '4611' },
  { id: '2', serviceNumber: '2607', startTime: '15:41', endTime: '26:16', loopnr: '4500' },
  { id: '3', serviceNumber: '2515', startTime: '07:08', endTime: '08:34', loopnr: '4505', startTime2: '15:13', endTime2: '21:55', loopnr2: '4510', startTime3: '24:10', endTime3: '25:10', loopnr3: '4515' },
];
export const DIVERSIONS = [
  { id: 'd1', line: '58', title: 'Werken Markt Zottegem', description: 'Omleiding via de ring, haltes Markt en Station vervallen tijdelijk.', startDate: dayOffset(-3), endDate: dayOffset(14), severity: 'medium' },
  { id: 'd2', line: '23', title: 'Wielerwedstrijd', description: 'Volledige doortocht afgesloten tussen 12u en 18u.', startDate: dayOffset(-30), endDate: dayOffset(-2), severity: 'high' },
];
export const UPDATES = [
  { id: 'u1', title: 'Nieuwe zomeruniformen beschikbaar', content: 'Vanaf volgende week liggen de nieuwe zomeruniformen klaar in het depot. Kom langs tijdens de kantooruren om jouw maat te passen.\n\nGraag ophalen vóór eind augustus.', date: '2026-07-20', isUrgent: false, category: 'algemeen' },
  { id: 'u2', title: 'Onderhoud aan boordcomputers', content: 'Alle bussen krijgen dit weekend een software-update.', date: '2026-07-27', isUrgent: true, category: 'technisch' },
];
export const LEAVE = [
  { id: 'l1', userId: '43', startDate: dayOffset(5), endDate: dayOffset(9), type: 'betaald_verlof', status: 'pending', createdAt: new Date().toISOString() },
  { id: 'l2', userId: '42', startDate: dayOffset(-20), endDate: dayOffset(-16), type: 'betaald_verlof', status: 'approved', createdAt: new Date(Date.now() - 25 * 864e5).toISOString(), decidedAt: new Date(Date.now() - 22 * 864e5).toISOString() },
];
export const SWAPS = [
  { id: 'sw1', shiftId: 's1', requesterId: '43', targetDriverId: '42', status: 'pending', reason: 'Familiefeest', createdAt: new Date(Date.now() - 3600e3).toISOString(), returnDate: dayOffset(3), returnCode: 'VRIJ' },
];
export const DEVICES = [
  { userId: '42', deviceToken: 'tok-1', name: 'iPhone · app', status: 'approved', createdAt: dayOffset(-8), lastSeenAt: dayOffset(0) },
  { userId: '43', deviceToken: 'tok-2', name: 'Android · browser', status: 'pending', createdAt: dayOffset(0), lastSeenAt: dayOffset(0) },
];
export const LOGINS = USERS.map((u, i) => ({ id: `lg${i}`, actorName: u.name, action: 'Aangemeld', category: 'auth', createdAt: new Date(Date.now() - i * 7200e3).toISOString(), entityId: u.id, details: '' }));
export const ACTIVITY = [
  { id: 'a1', createdAt: new Date().toISOString(), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'planning', action: 'Planning geïmporteerd', details: 'Matrix juli verwerkt.' },
  { id: 'a2', createdAt: new Date(Date.now() - 3600e3).toISOString(), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'users', action: 'Gebruiker gewijzigd', details: 'Alex Du Priez bijgewerkt.' },
];

/**
 * Route-handler voor `page.route('**\/api/**', apiFixtures(user))`.
 * `extra(pad, request)` mag een eigen antwoord teruggeven (alles behalve
 * `undefined` wordt als JSON verstuurd) — zo overschrijft een spec één
 * collectie zonder de rest opnieuw op te bouwen.
 */
export function apiFixtures(user, extra) {
  return async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (extra) {
      const eigen = extra(p, route.request());
      if (eigen !== undefined) return json(eigen);
    }
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
    if (p.endsWith('/api/push/subscribers')) return json({ userIds: ['42'] });
    if (p.endsWith('/api/planning-matrix/changes-since-import')) return json({ lastImport: { createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), importedDays: 31 }, approvedLeave: [], approvedSwaps: [] });
    if (p.includes('/api/coverage-gaps')) return json({ days: [{ date: new Date().toISOString().slice(0, 10), expected: ['2101', '2607'], scheduled: ['2101'], missing: ['2607'], unknown: [] }] });
    if (p.endsWith('/api/coverage-expectations')) return json({ weekdays: ['', '', '', '', '', '', ''], overrides: [] });
    if (p.includes('/api/health')) return json({ status: 'ok', supabase: 'configured', tables: {}, smtp: { status: 'configured', from: 'noreply@vhbportaal.com', host: 'smtp.resend.com' }, env: 'e2e', time: new Date().toISOString() });
    return json([]);
  };
}

/**
 * Init-script (draait vóór de app): sessie in localStorage, laatst geopende
 * view (de router herstelt die op `/`) en optioneel een expliciet thema.
 * Zonder `thema` volgt de app de rol-standaard (planner/admin = donker).
 * Gebruik: `page.addInitScript(sessieInitScript, { key, user, view, thema })`.
 */
export function sessieInitScript({ key, user, view, thema }) {
  const inAnHour = Math.floor(Date.now() / 1000) + 3600;
  window.localStorage.setItem(key, JSON.stringify({ access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, expires_at: inAnHour, user: { id: 'auth-e2e', email: user.email, aud: 'authenticated' } }));
  if (view) window.localStorage.setItem('vhb-current-view', view);
  if (thema === 'light' || thema === 'dark') window.localStorage.setItem('vhb-theme', thema);
}

/** Sessie + api-mocks op één pagina zetten; `extra` zoals bij apiFixtures. */
export async function seedPagina(page, { user, view, thema, extra } = {}) {
  await page.addInitScript(sessieInitScript, { key: SESSION_KEY, user, view: view ?? '', thema: thema ?? '' });
  await page.route('**/api/**', apiFixtures(user, extra));
}
