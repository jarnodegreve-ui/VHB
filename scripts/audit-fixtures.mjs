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
export const TECHNIEKER = { id: '55', name: 'Jelle Technieker', role: 'technieker', employeeId: 'VHB-000055', email: 'jelle@vhb.be', isActive: true, verlofBudget: 20 };
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
// Activiteit: een realistische week — bursts van dezelfde actie (vouwen samen
// in de feed), cron-hartslagen (standaard verborgen) en meerdere personen.
const uurGeleden = (u) => new Date(Date.now() - u * 3600e3).toISOString();
export const ACTIVITY = [
  { id: 'a1', createdAt: uurGeleden(1), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'planning', action: 'Matrix import bevestigd', details: '56 dagen verwerkt (periode 2026-08-31 t/m 2026-10-25 vervangen), 1 349 diensten.' },
  { id: 'a2', createdAt: uurGeleden(1.02), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'planning', action: 'Planning opnieuw opgebouwd', details: '1 981 diensten opgebouwd vanuit de actuele matrix, 2 goedgekeurde ruilen opnieuw doorgevoerd.' },
  ...['Alex Du Priez, telefoon.', 'Diether Van Haute, telefoon.', 'Test Chauffeur, status: actief→inactief.', 'Luc Cherlet, e-mail.'].map((d, i) => ({ id: `a3-${i}`, createdAt: uurGeleden(2 + i * 0.02), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'users', action: 'Gebruiker gewijzigd', details: d })),
  { id: 'a4', createdAt: uurGeleden(3), actorName: 'Systeem (cron)', actorRole: 'admin', category: 'system', action: 'Cron geslaagd: ocpi-sync', details: 'Sync ok (all).' },
  { id: 'a5', createdAt: uurGeleden(5), actorName: 'Test Planning', actorRole: 'planner', category: 'leave', action: 'Verlof goedgekeurd', details: 'Alex Du Priez, 14 t/m 18 september (betaald verlof).' },
  { id: 'a6', createdAt: uurGeleden(6), actorName: 'Test Planning', actorRole: 'planner', category: 'swaps', action: 'Dienst handmatig overgezet', details: 'Dienst 2607 op 12 september van Diether Van Haute naar Alex Du Priez (ziek).' },
  { id: 'a7', createdAt: uurGeleden(9), actorName: 'Systeem (cron)', actorRole: 'admin', category: 'system', action: 'Cron geslaagd: backup', details: 'Back-up weggeschreven (2,1 MB).' },
  { id: 'a8', createdAt: uurGeleden(26), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'diversions', action: 'Omleiding toegevoegd', details: 'Lijn 58, Werken Markt Zottegem, t/m 22 september.' },
  { id: 'a9', createdAt: uurGeleden(28), actorName: 'Test Planning', actorRole: 'planner', category: 'leave', action: 'Ziekmelding', details: 'Diether Van Haute, 11 t/m 12 september.' },
  { id: 'a10', createdAt: uurGeleden(30), actorName: 'Systeem (cron)', actorRole: 'admin', category: 'system', action: 'Cron geslaagd: ocpi-sync', details: 'Sync ok (all).' },
  { id: 'a11', createdAt: uurGeleden(50), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'updates', action: 'Update geplaatst', details: 'Onderhoud aan boordcomputers (dringend).' },
  { id: 'a12', createdAt: uurGeleden(52), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'system', action: 'Toestel goedgekeurd', details: 'Android · browser van Alex Du Priez.' },
  { id: 'a13', createdAt: uurGeleden(75), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'services', action: 'Diensten opgeslagen', details: '3 diensten gewijzigd (2101, 2607, 2515).' },
  { id: 'a14', createdAt: uurGeleden(100), actorName: 'Jarno De Greve', actorRole: 'admin', category: 'planning_codes', action: 'Code gewijzigd', details: 'BV: telt als betaald verlof.' },
];

// ---- Laadpalen (OCPI): deterministische fixtures voor de vier tabbladen ----
// Seeded pseudo-random zodat screenshots stabiel blijven (visuele regressie).
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const OCPI_EVSES = [
  ['CSal2KA-9Oo-1', '1', '2.1'], ['CSal2KA-9Oo-2', '2', '2.2'], ['CSal2KA-9Oo-3', '3', '2.3'], ['CSal2KA-9Oo-4', '4', '2.4'], ['CSal2KA-9Oo-5', '5', '2.5'], ['CSal2KA-9Oo-6', '6', '2.6'], ['CSal2KA-9Oo-7', '7', '2.7'], ['CSal2KA-9Oo-8', '16', '2.8'],
  ['CSrh1AH0aNN-1', '12.A', 'mal.1.1'], ['CSrh1AH0aNN-2', '12.B', 'mal.1.2'], ['CSrh1AH0aNN-3', '13.A', 'mal.1.3'], ['CSrh1AH0aNN-4', '13.B', 'mal.1.4'], ['CSrh1AH0aNN-5', '8', 'mal.1.5'], ['CSrh1AH0aNN-6', '9', 'mal.1.6'], ['CSrh1AH0aNN-7', '10', 'mal.1.7'], ['CSrh1AH0aNN-8', '11', 'mal.1.8'],
  ['CS7MQt5TLO0-1', '17.A', 'CPU3 sat1.1'], ['CS7MQt5TLO0-2', '17.B', 'CPU3 sat1.2'], ['CS7MQt5TLO0-3', '18.A', 'CPU3 sat2.1'], ['CS7MQt5TLO0-4', '18.B', 'CPU3 sat2.2'], ['CS7MQt5TLO0-5', '14.A', 'CPU3 sat3.1'], ['CS7MQt5TLO0-6', '14.B', 'CPU3 sat3.2'], ['CS7MQt5TLO0-7', '15.A', 'CPU3 sat4.1'], ['CS7MQt5TLO0-8', '15.B', 'CPU3 sat4.2'],
].map(([uid, evseId, ref]) => ({ uid, evseId, physicalReference: ref }));
const ocpiSessies = (van, tot, seed) => {
  const r = lcg(seed);
  const uit = [];
  const d = new Date(`${van}T00:00:00`);
  const einde = new Date(`${tot}T00:00:00`);
  for (let i = 0; d <= einde && i < 400; i++, d.setDate(d.getDate() + 1)) {
    const dag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = d.getDay() === 0 ? 6 : 14 + Math.floor(r() * 6);
    for (let k = 0; k < n; k++) {
      const e = OCPI_EVSES[Math.floor(r() * OCPI_EVSES.length)];
      const mislukt = r() < 0.18;
      const startMin = 17 * 60 + Math.floor(r() * 7 * 60);
      const start = new Date(`${dag}T00:00:00`); start.setMinutes(startMin);
      const laadMin = mislukt ? 0 : 120 + Math.floor(r() * 420);
      const duurMin = mislukt ? 5 + Math.floor(r() * 40) : laadMin + Math.floor(r() * 240);
      const eind = new Date(start.getTime() + duurMin * 60000);
      const kwh = mislukt ? 0 : Math.round((60 + r() * 320) * 10) / 10;
      uit.push({
        id: `s-${dag}-${k}`, evseUid: e.uid, dag, start: start.toISOString(), eind: eind.toISOString(), status: 'COMPLETED',
        duurMin, laadMin: mislukt ? null : laadMin, kwh, gemKw: mislukt ? null : Math.round((kwh / (laadMin / 60)) * 10) / 10, maxKw: mislukt ? null : Math.round((40 + r() * 100) * 10) / 10,
        socStart: mislukt ? null : 20 + Math.floor(r() * 50), socEind: mislukt ? null : 90 + Math.floor(r() * 11),
        voertuig: mislukt ? null : 'MAN Lion’s City E 640.0 kWh', klasse: mislukt ? (r() < 0.8 ? 'HANDSHAKE_FAIL' : 'LOW_POWER') : 'OK',
        ongeldig: false, laadbeurt: !mislukt, mislukt,
      });
    }
  }
  return uit;
};
const ocpiDagen = (van, tot, seed) => {
  const r = lcg(seed);
  const sessies = ocpiSessies(van, tot, seed);
  const uit = [];
  const d = new Date(`${van}T00:00:00`);
  const einde = new Date(`${tot}T00:00:00`);
  for (; d <= einde; d.setDate(d.getDate() + 1)) {
    const dag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const s = sessies.filter((x) => x.dag === dag);
    const piek = Math.round((180 + r() * 160) * 10) / 10;
    uit.push({ dag, kwh: Math.round(s.reduce((a, x) => a + x.kwh, 0) * 10) / 10, sessies: s.length, laadbeurten: s.filter((x) => x.laadbeurt).length, mislukt: s.filter((x) => x.mislukt).length, piekKw: piek, piekTs: `${dag}T00:30:00.000Z`, piekCharging: 4 + Math.floor(r() * 6) });
  }
  return { sessies, dagen: uit };
};
const ocpiTotalen = (dagen, sessies) => {
  const kwh = dagen.reduce((a, d) => a + d.kwh, 0);
  const laaddagen = dagen.filter((d) => d.kwh > 0).length;
  const hoogste = dagen.reduce((b, d) => (!b || d.kwh > b.kwh ? d : b), null);
  const piek = dagen.reduce((b, d) => (!b || d.piekKw > b.piekKw ? d : b), null);
  return {
    kwh: Math.round(kwh * 10) / 10, sessies: dagen.reduce((a, d) => a + d.sessies, 0), laadbeurten: dagen.reduce((a, d) => a + d.laadbeurten, 0), mislukt: dagen.reduce((a, d) => a + d.mislukt, 0),
    laaddagen, gemPerLaaddag: laaddagen ? Math.round((kwh / laaddagen) * 10) / 10 : 0, hoogsteDag: hoogste ? { dag: hoogste.dag, kwh: hoogste.kwh } : null,
    piekKw: piek?.piekKw ?? null, piekTs: piek?.piekTs ?? null, piekDag: piek?.dag ?? null, piekCharging: piek?.piekCharging ?? null,
    gemDagpiekKw: Math.round((dagen.reduce((a, d) => a + d.piekKw, 0) / Math.max(1, dagen.length)) * 10) / 10, piekDagen: dagen.length,
    laadMin: sessies.reduce((a, s) => a + (s.laadMin ?? 0), 0),
  };
};
const ocpiPunten = (sessies, seed) => {
  const totaal = sessies.reduce((a, s) => a + s.kwh, 0);
  return OCPI_EVSES.map((e) => {
    const eigen = sessies.filter((s) => s.evseUid === e.uid);
    const kwh = Math.round(eigen.reduce((a, s) => a + s.kwh, 0) * 10) / 10;
    const laadMin = eigen.reduce((a, s) => a + (s.laadMin ?? 0), 0);
    return { evseUid: e.uid, evseId: e.evseId, physicalReference: e.physicalReference, maxElectricPowerKw: 160, kwh, kwhVorige: Math.round(kwh * (0.8 + ((seed % 7) / 20))), aandeel: totaal ? Math.round((kwh / totaal) * 1000) / 10 : 0, sessies: eigen.length, laadbeurten: eigen.filter((s) => s.laadbeurt).length, mislukt: eigen.filter((s) => s.mislukt).length, laadMin, gemKw: laadMin ? Math.round((kwh / (laadMin / 60)) * 10) / 10 : null, maxKw: eigen.reduce((a, s) => Math.max(a, s.maxKw ?? 0), 0) || null };
  });
};
const maandGrenzen = (maand) => { const [j, m] = maand.split('-').map(Number); return { van: `${maand}-01`, tot: `${maand}-${String(new Date(j, m, 0).getDate()).padStart(2, '0')}` }; };
export const OCPI_DASHBOARD = () => ({
  totals: { evses: OCPI_EVSES.length, sessions30d: 520, totalPowerKw: 214.6 },
  statusCounts: { AVAILABLE: 17, CHARGING: 6, INOPERATIVE: 1 },
  locations: [{ id: 'VHB', name: 'Stelplaats Maldegem', city: 'Maldegem', evses: OCPI_EVSES.map((e, i) => ({ uid: e.uid, evse_id: e.evseId, status: i % 4 === 1 ? 'CHARGING' : i === 9 ? 'INOPERATIVE' : 'AVAILABLE', physical_reference: e.physicalReference, connectors: [{ id: '1', standard: 'IEC_62196_T2_COMBO', power_type: 'DC', max_electric_power: 160000 }] })) }],
  activeSessions: OCPI_EVSES.filter((_, i) => i % 4 === 1).map((e, i) => ({ id: `act-${i}`, evse_uid: e.uid, location_id: 'VHB', status: 'ACTIVE', start_date_time: new Date(Date.now() - (60 + i * 25) * 60000).toISOString(), kwh: 40 + i * 17.5, powerKw: i === 2 ? 0 : 30 + i * 12, soc: i === 2 ? 100 : 35 + i * 9 })),
  kwhPerDay: Array.from({ length: 30 }, (_, i) => ({ date: dayOffset(i - 29), kwh: i % 7 === 6 ? 900 : 2400 + ((i * 37) % 900), sessions: 14 + (i % 5) })),
  powerCurve: Array.from({ length: 96 }, (_, i) => ({ ts: new Date(Date.now() - (95 - i) * 15 * 60000).toISOString(), kw: i < 20 || i > 70 ? 40 + (i % 5) * 20 : 150 + ((i * 53) % 160), charging: 2 + (i % 6) })),
  powerDays: Array.from({ length: 31 }, (_, i) => ({ date: dayOffset(i - 30), kw: 220 + ((i * 41) % 120), ts: `${dayOffset(i - 30)}T00:30:00.000Z`, charging: 4 + (i % 5) })),
  storingen: [
    { soort: 'laadpunt', evseUid: 'CSrh1AH0aNN-2', status: 'INOPERATIVE', wanneer: null },
    { soort: 'sessie', evseUid: 'CSal2KA-9Oo-3', classificatie: 'HANDSHAKE_FAIL', wanneer: new Date(Date.now() - 5 * 3600e3).toISOString() },
    { soort: 'sessie', evseUid: 'CS7MQt5TLO0-5', classificatie: 'LOW_POWER', wanneer: new Date(Date.now() - 30 * 3600e3).toISOString() },
  ],
});
export const OCPI_MAAND = (maand = '2026-08', van, tot) => {
  const g = van && tot ? { van, tot } : maandGrenzen(maand);
  const vorigeMaand = (() => { const [j, m] = maand.split('-').map(Number); const d = new Date(j, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const vg = maandGrenzen(vorigeMaand);
  const { sessies, dagen } = ocpiDagen(g.van, g.tot, 7);
  const vorige = ocpiDagen(vg.van, vg.tot, 11);
  const tv = ocpiTotalen(vorige.dagen, vorige.sessies);
  const klassen = {}; for (const s of sessies) if (s.mislukt) klassen[s.klasse] = (klassen[s.klasse] ?? 0) + 1;
  return { van: g.van, tot: g.tot, maand: van && tot ? null : maand, eersteDag: '2026-07-29', huidigeDag: dayOffset(0), totalen: ocpiTotalen(dagen, sessies), vorige: { van: vg.van, tot: vg.tot, maand: vorigeMaand, kwh: tv.kwh, laadbeurten: tv.laadbeurten, mislukt: tv.mislukt, piekKw: tv.piekKw, gemPerLaaddag: tv.gemPerLaaddag, laaddagen: tv.laaddagen }, dagen, punten: ocpiPunten(sessies, 7), klassen };
};
export const OCPI_HISTORIEK = () => {
  const maanden = ['2026-07', '2026-08', '2026-09'].map((maand, i) => {
    const g = maandGrenzen(maand);
    const { sessies, dagen } = ocpiDagen(maand === '2026-07' ? '2026-07-29' : g.van, maand === '2026-09' ? '2026-09-08' : g.tot, 3 + i);
    const dagRijen = maand === '2026-07' ? dagen.map((d) => ({ ...d, piekKw: null, piekTs: null, piekCharging: null })) : dagen;
    const t = ocpiTotalen(dagRijen, sessies);
    if (maand === '2026-07') Object.assign(t, { piekKw: null, piekTs: null, piekDag: null, piekCharging: null, gemDagpiekKw: null, piekDagen: 0 });
    const klassen = {}; for (const s of sessies) if (s.mislukt) klassen[s.klasse] = (klassen[s.klasse] ?? 0) + 1;
    return { maand, dagen: dagRijen.length, klassen, ...t, _sessies: sessies };
  });
  const matrix = OCPI_EVSES.map((e) => { const perMaand = {}; let totaal = 0; for (const m of maanden) { const k = Math.round(m._sessies.filter((s) => s.evseUid === e.uid).reduce((a, s) => a + s.kwh, 0)); perMaand[m.maand] = k; totaal += k; } return { evseUid: e.uid, evseId: e.evseId, physicalReference: e.physicalReference, perMaand, totaal }; });
  return { huidigeMaand: '2026-09', huidigeDag: dayOffset(0), maanden: maanden.map(({ _sessies, ...m }) => m), matrix };
};
export const OCPI_SESSIES = (van = '2026-08-01', tot = '2026-08-31') => {
  const sessies = ocpiSessies(van, tot, 5).reverse();
  return { van, tot, maand: null, huidigeDag: dayOffset(0), totaal: sessies.length, afgekapt: false, sessies, laadpunten: OCPI_EVSES };
};
export const OCPI_DAG = (dag = '2026-08-14') => {
  const { sessies, dagen } = ocpiDagen(dag, dag, 9);
  const r = lcg(13);
  return { dag, slots: Array.from({ length: 96 }, (_, i) => ({ ts: new Date(new Date(`${dag}T00:00:00`).getTime() + i * 15 * 60000).toISOString(), kw: i < 8 || (i > 28 && i < 68) ? 20 + Math.round(r() * 40) : 120 + Math.round(r() * 180), charging: 2 + Math.floor(r() * 7) })), piekKw: 296.4, piekTs: `${dag}T01:15:00.000Z`, piekCharging: 8, kwh: dagen[0].kwh, laadbeurten: dagen[0].laadbeurten, mislukt: dagen[0].mislukt, sessies, laadpunten: OCPI_EVSES };
};

export const VEHICLES = [
  { id: 'v26', busnr: '613 026', kortNr: 26, nummerplaat: '2-CWF-068', chassisnr: 'WMA12CZZ4PF019730', merk: "MAN LION'S CITY 12E", type: 'lijnbus', categorie: 'bus', aandrijving: 'elektrisch', status: 'actief', inDienst: '2022-12-20', uitDienst: null, zitplaatsen: 40, opmerking: null },
  { id: 'v34', busnr: '613 034', kortNr: 34, nummerplaat: '2-GPY-265', chassisnr: null, merk: "MAN LION'S CITY 18E", type: 'lijnbus', categorie: 'bus', aandrijving: 'elektrisch', status: 'actief', inDienst: '2025-02-20', uitDienst: null, zitplaatsen: 50, opmerking: null },
  { id: 'v98', busnr: 'Reserve 98', kortNr: 98, nummerplaat: '2-ECM-130', chassisnr: null, merk: 'VDL', type: 'lijnbus', categorie: 'bus', aandrijving: 'diesel', status: 'reserve', inDienst: '2023-08-29', uitDienst: null, zitplaatsen: null, opmerking: null },
];
export const VEHICLE_EXPIRIES = [
  { vehicleId: 'v26', soort: 'keuring', validUntil: dayOffset(12), opmerking: null },
  { vehicleId: 'v26', soort: 'brandblussers', validUntil: dayOffset(400), opmerking: '2 stuks' },
  { vehicleId: 'v34', soort: 'keuring', validUntil: dayOffset(-3), opmerking: null },
];
export const DEFECTEN = [
  { id: 'd1', vehicleId: 'v26', busnr: '613 026', kortNr: 26, gemeldOp: new Date(Date.now() - 2 * 864e5).toISOString(), gemeldDoor: '42', gemeldDoorNaam: 'Test Chauffeur', werktype: 'T', omschrijving: 'Bel doet het niet altijd', status: 'open', uitgevoerdOp: null, uitgevoerdDoor: null, uitgevoerdWerk: null, manuren: null, opmerking: null },
  { id: 'd2', vehicleId: 'v34', busnr: '613 034', kortNr: 34, gemeldOp: new Date(Date.now() - 20 * 864e5).toISOString(), gemeldDoor: '43', gemeldDoorNaam: 'Alex Du Priez', werktype: 'L', omschrijving: 'Oproep naar dispatch werkt niet', status: 'open', uitgevoerdOp: null, uitgevoerdDoor: null, uitgevoerdWerk: null, manuren: null, opmerking: null },
  { id: 'd3', vehicleId: 'v26', busnr: '613 026', kortNr: 26, gemeldOp: new Date(Date.now() - 30 * 864e5).toISOString(), gemeldDoor: '42', gemeldDoorNaam: 'Test Chauffeur', werktype: 'C', omschrijving: 'Schade rechts achter', status: 'uitgevoerd', uitgevoerdOp: dayOffset(-25), uitgevoerdDoor: '55', uitgevoerdDoorNaam: 'Jelle Technieker', uitgevoerdWerk: 'Plamuur en verf', manuren: 4, opmerking: null },
];
export const WERKPRESTATIES = [
  { id: 'w1', datum: dayOffset(0), mecanicienId: '55', mecanicienNaam: 'Jelle Technieker', vehicleId: 'v26', busnr: '613 026', kortNr: 26, werkcode: 'H', omschrijving: 'Bel vervangen', beginTijd: '08:00', eindeTijd: '09:00', werkuren: 1, kmstand: 47000, defectId: 'd1' },
  { id: 'w2', datum: dayOffset(-1), mecanicienId: '55', mecanicienNaam: 'Jelle Technieker', vehicleId: null, busnr: null, kortNr: null, werkcode: 'A', omschrijving: 'Stukken besteld', beginTijd: null, eindeTijd: null, werkuren: 2, kmstand: null, defectId: null },
];
export const LOON_CODES = [
  { code: '2101', codeWeergave: '2101', omschrijving: null, dienstType: 'lijn', inExport: true, easypayActiviteit: 'LIJN', easypayTypePrest: 40140, tik1: '04:32', tik2: '08:33', tik3: '15:50', tik4: '19:52', tik5: null, tik6: null, lbRijtijd: 404, lbStat100At: 28, lbStat100Nat: 21, lbStat50Nat: 0, lbOnd: 1, lbAndWrk: 0, lbNacht: 88, bron: 'import' },
  { code: '2607', codeWeergave: '2607', omschrijving: null, dienstType: 'lijn', inExport: true, easypayActiviteit: 'LIJN', easypayTypePrest: 40140, tik1: '06:00', tik2: '14:00', tik3: null, tik4: null, tik5: null, tik6: null, lbRijtijd: 400, lbStat100At: 0, lbStat100Nat: 0, lbStat50Nat: 0, lbOnd: 0, lbAndWrk: 0, lbNacht: 0, bron: 'import' },
  { code: 'bv', codeWeergave: 'BV', omschrijving: 'Betaald verlof', dienstType: 'varia', inExport: true, easypayActiviteit: '01', easypayTypePrest: 15200, tik1: null, tik2: null, tik3: null, tik4: null, tik5: null, tik6: null, lbRijtijd: 0, lbStat100At: 0, lbStat100Nat: 0, lbStat50Nat: 0, lbOnd: null, lbAndWrk: 0, lbNacht: 0, bron: 'import' },
  { code: 'ziek', codeWeergave: 'Ziek', omschrijving: 'ziekte', dienstType: 'varia', inExport: true, easypayActiviteit: '01', easypayTypePrest: 15800, tik1: null, tik2: null, tik3: null, tik4: null, tik5: null, tik6: null, lbRijtijd: 0, lbStat100At: 0, lbStat100Nat: 0, lbStat50Nat: 0, lbOnd: null, lbAndWrk: 0, lbNacht: 0, bron: 'import' },
  { code: 'vrij', codeWeergave: 'vrij', omschrijving: 'Vrij (geen dienst)', dienstType: 'varia', inExport: true, easypayActiviteit: '01', easypayTypePrest: 15102, tik1: null, tik2: null, tik3: null, tik4: null, tik5: null, tik6: null, lbRijtijd: 0, lbStat100At: 0, lbStat100Nat: 0, lbStat50Nat: 0, lbOnd: null, lbAndWrk: 0, lbNacht: 0, bron: 'import' },
];
export const LOON_MEDEWERKERS = [
  { userId: '42', naam: 'Test Chauffeur', employeeId: 'VHB-000042', easypayNr: 42, inExport: true },
  { userId: '43', naam: 'Alex Du Priez', employeeId: 'VHB-000043', easypayNr: null, inExport: true },
  { userId: '44', naam: 'Diether Van Haute', employeeId: 'VHB-000044', easypayNr: 44, inExport: false },
];
export const DAG_AFSLUITINGEN = [
  { datum: dayOffset(-2), status: 'afgesloten', geopendOp: new Date(Date.now() - 2 * 864e5).toISOString(), geopendDoor: '1', afgeslotenOp: new Date(Date.now() - 864e5).toISOString(), afgeslotenDoor: '1', heropendOp: null, heropendDoor: null, heropendReden: null, rijen: 3, overmin: 15, premies: 0, zonderCode: 0 },
  { datum: dayOffset(-1), status: 'open', geopendOp: new Date(Date.now() - 864e5).toISOString(), geopendDoor: '1', afgeslotenOp: null, afgeslotenDoor: null, heropendOp: null, heropendDoor: null, heropendReden: null, rijen: 3, overmin: 0, premies: 1, zonderCode: 0 },
];
const dagPrestatie = (id, userId, naam, planningCode, geredenCode, extra = {}) => ({
  id, datum: dayOffset(-1), userId, naam, volgnr: 1, planningCode, geredenCode, overmin: 0, overminNacht: 0, overminExtra: 0, onvPremie: false,
  qualOngeval: false, qualPanne: false, qualVerkeersovertreding: false, qualKlantklacht: false, qualAdmfout: false, qualInterneklacht: false, qualVertragingDrSchuld: false, qualRitNtGeredenDrSchuld: false,
  opmerking: null, bewerktOp: null, bewerktDoor: null, ...extra,
});
export const DAG_PRESTATIES = [
  dagPrestatie('p1', '42', 'Test Chauffeur', '2101', '2101'),
  dagPrestatie('p2', '43', 'Alex Du Priez', 'vrij', '2607', { overmin: 20, onvPremie: true, bewerktOp: new Date().toISOString() }),
  dagPrestatie('p3', '44', 'Diether Van Haute', 'bv', 'bv'),
];

/**
 * Route-handler voor `page.route('**\/api/**', apiFixtures(user))`.
 * `extra(pad, request)` mag een eigen antwoord teruggeven (alles behalve
 * `undefined` wordt als JSON verstuurd) — zo overschrijft een spec één
 * collectie zonder de rest opnieuw op te bouwen.
 */
export const SEGMENT_IMPORTS = [
  { id: 'imp1', createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), importedBy: '1', filename: 'dienstregeling-et-260901.xlsx', rijen: 1234, diensten: 67, dagtypes: ['21/0', '26/0', '27/0', '31/0'], waarschuwingen: [], bevindingen: [{ soort: 'duur_klopt_niet', ernst: 'waarschuwing', serviceNumber: '2115', dagtypeCode: '21/0', volgorde: 8, tekst: 'ANW 08:34 tot 08:38 is 4 min, de duur zegt 384 min.' }], actief: true, actiefSinds: new Date(Date.now() - 2 * 864e5).toISOString() },
];
const segm = (id, volgorde, type, startMin, eindeMin, extra = {}) => ({ id, importId: 'imp1', serviceNumber: '2101', dagtypeCode: '21/0', volgorde, type, startMin, eindeMin, duurMin: eindeMin - startMin, loop: '4500', internLoop: null, lijn: null, variant: null, rit: null, voertuig: 'standaard', vertrek: null, vertrekCode: null, aankomst: null, aankomstCode: null, afstandKm: null, atTijd: null, vtTijd: null, ...extra });
export const SEGMENTEN = [
  segm('s1', 1, 'AVO', 272, 276, { loop: null }),
  segm('s2', 2, 'LED', 276, 290, { vertrek: 'Garage Van Hoorebeke', aankomst: 'Eeklo Station', afstandKm: 6.2 }),
  segm('s3', 3, 'RIT', 290, 352, { lijn: '50', rit: '3', vertrek: 'Eeklo Station', aankomst: 'Brugge Station', afstandKm: 31.4 }),
  segm('s4', 4, 'STA', 352, 372, { loop: null }),
  segm('s5', 5, 'ONE', 372, 935, { loop: null }),
  segm('s6', 6, 'RIT', 935, 1010, { lijn: '50', rit: '31', vertrek: 'Brugge Station', aankomst: 'Eeklo Station', afstandKm: 31.4 }),
];

export function apiFixtures(user, extra) {
  return async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (extra) {
      const eigen = extra(p, route.request());
      if (eigen !== undefined) return json(eigen);
    }
    // Sinds golf 4 draagt /api/me het toestel-oordeel en (staf) de beveiligingsstatus mee,
    // zodat de mock dezelfde korte startketen meet als de echte server.
    if (p.endsWith('/api/me')) return json({ ...user, toestel: { status: 'approved', gateActief: false }, ...(user.role !== 'chauffeur' && user.role !== 'technieker' ? { beveiliging: { mfaVerplicht: false, aal: 'aal1' } } : {}) });
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
    // Techniek (13-09): voertuigen, gele boek, werkprestaties, vervaldata.
    if (p.endsWith('/api/vehicles')) return json(VEHICLES);
    if (p.endsWith('/api/vehicle-expiries')) return json(VEHICLE_EXPIRIES);
    if (p.endsWith('/api/defecten/aantal-open')) return json({ open: DEFECTEN.filter((d) => d.status === 'open').length });
    if (p.endsWith('/api/defecten')) return json(url.searchParams.get('mijn') === '1' ? DEFECTEN.filter((d) => d.gemeldDoor === user.id) : DEFECTEN);
    if (p.endsWith('/api/werkprestaties/rapport')) return json({ jaar: 2026, totaalUren: 3, aantal: 2, perBus: [{ label: 'Bus 26', uren: 3, aantal: 2, perKwartaal: [0, 0, 3, 0] }], perMecanicien: [{ label: 'Jelle Technieker', uren: 3, aantal: 2, perKwartaal: [0, 0, 3, 0] }], perWerkcode: [{ werkcode: 'H', uren: 3, aantal: 2 }] });
    if (p.endsWith('/api/werkprestaties')) return json(WERKPRESTATIES);
    // Loon (13-09): dagafsluiting, looncodes, matricules, export.
    // Dienstopbouw (13-09).
    if (p.endsWith('/api/dienstopbouw/imports')) return json(SEGMENT_IMPORTS);
    if (p.endsWith('/api/dienstopbouw/dagtypes')) return json([{ code: '21', omschrijving: 'Maandag schooldag', periode: '2', aantalPerJaar: 141, portaalDagtype: 'schooldag' }, { code: '26', omschrijving: 'Zaterdag', periode: '2', aantalPerJaar: 52, portaalDagtype: 'zaterdag' }]);
    if (p.endsWith('/api/dienstopbouw/segmenten')) return json({ import: SEGMENT_IMPORTS[0], segmenten: SEGMENTEN });
    if (p.endsWith('/api/dienstopbouw/ritblad')) return json({ serviceNumber: '2101', dagtypes: [{ dagtypeCode: '21/0', rijen: [{ type: 'LED', lijn: '', rit: 'led', loop: '4500', vertrek: 'Garage Van Hoorebeke', start: '04:36', aankomst: 'Eeklo Station', einde: '04:50', via: '4500' }, { type: 'RIT', lijn: '50', rit: '3', loop: '4500', vertrek: 'Eeklo Station', start: '04:50', aankomst: 'Brugge Station', einde: '05:52', via: '' }] }] });
    if (p.includes('/api/dienstopbouw/imports/') && p.endsWith('/loonparameters')) return json({ importId: 'imp1', diensten: [{ serviceNumber: '2101', dagtypeCode: '21/0', parameters: { lbRijtijd: 404, lbStat100At: 28, lbStat100Nat: 21, lbStat50Nat: 0, lbOnd: 1, lbAndWrk: 0, lbAdmT: 15, lbNacht: 88, lbArbTijd: 447, tiktijden: [{ begin: '04:32', einde: '08:18' }, { begin: '15:35', einde: '19:52' }], teVeelDelen: false }, huidig: null }] });
    if (p.endsWith('/api/loon/codes')) return json(LOON_CODES);
    if (p.endsWith('/api/loon/medewerkers')) return json(LOON_MEDEWERKERS);
    if (p.endsWith('/api/loon/instellingen')) return json({ easypayLidnr: 1234 });
    if (p.endsWith('/api/loon/export/controle')) return json({ maand: url.searchParams.get('maand') || '2026-08', dagenGeopend: 2, dagenAfgesloten: 1, openDagen: [dayOffset(-1)], lidnr: 1234, issues: [], samenvatting: { rijen: 4, personen: 2, overminRijen: 1, premies: 0 }, blokkerend: true });
    if (p.endsWith('/api/dagafsluiting')) return json({ maand: url.searchParams.get('maand') || '2026-08', dagen: DAG_AFSLUITINGEN, planningDagen: [dayOffset(-2), dayOffset(-1), dayOffset(0)] });
    if (/[/]api[/]dagafsluiting[/]\d{4}-\d{2}-\d{2}$/.test(p) && route.request().method() === 'GET') {
      const datum = p.slice(-10);
      const dag = DAG_AFSLUITINGEN.find((d) => d.datum === datum);
      if (!dag) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Deze dag is nog niet geopend.', inPlanning: true, voorstel: USERS.filter((u) => u.role === 'chauffeur').map((u) => ({ userId: u.id, naam: u.name, planningCode: u.id === '42' ? '2101' : 'vrij' })) }) });
      return json({ dag, rijen: DAG_PRESTATIES.map((r) => ({ ...r, datum })), planningAfwijkingen: [], ontbrekendeCodes: [], inPlanning: true });
    }
    if (p.endsWith('/api/push/subscribers')) return json({ userIds: ['42'] });
    if (p.endsWith('/api/planning-matrix/changes-since-import')) return json({ lastImport: { createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), importedDays: 31 }, approvedLeave: [], approvedSwaps: [] });
    if (p.includes('/api/coverage-gaps')) return json({ days: [{ date: new Date().toISOString().slice(0, 10), expected: ['2101', '2607'], scheduled: ['2101'], missing: ['2607'], unknown: [] }] });
    if (p.endsWith('/api/coverage-expectations')) return json({ weekdays: ['', '', '', '', '', '', ''], overrides: [] });
    if (p.endsWith('/api/ocpi/dashboard')) return json(OCPI_DASHBOARD());
    if (p.endsWith('/api/ocpi/maand')) return json(OCPI_MAAND(url.searchParams.get('maand') || '2026-08', url.searchParams.get('van'), url.searchParams.get('tot')));
    if (p.endsWith('/api/ocpi/historiek')) return json(OCPI_HISTORIEK());
    if (p.endsWith('/api/ocpi/sessies')) return json(OCPI_SESSIES(url.searchParams.get('van') || undefined, url.searchParams.get('tot') || undefined));
    if (p.endsWith('/api/ocpi/dag')) return json(OCPI_DAG(url.searchParams.get('dag') || undefined));
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
