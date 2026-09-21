// Rapporten stap 4 (21-09): vaste antwoorden van GET /api/rapporten/<id> voor
// de domeinen ruilen en planning (en Inzet per voertuig). Vaste cijfers en een
// vaste peildatum, zodat de e2e-spec en de screenshots stabiel blijven. De
// rekenkern zelf is getest in src/rapportRuilen.test.ts en
// src/rapportPlanning.test.ts; hier staat alleen wat het scherm nodig heeft,
// in de vorm die de laders geven.

const PEILDATUM = '2026-09-21';
const GEGENEREERD = '2026-09-21T08:30:00.000Z';
const binnen = (dag, q) => (!q.get('van') || dag >= q.get('van')) && (!q.get('tot') || dag <= q.get('tot'));
const NAAM = { 42: 'Test Chauffeur', 43: 'Alex Du Priez', 44: 'Diether Van Haute', 60: 'Annelies Verstraete', 61: 'Bart Claeys', 62: 'Carine De Smet' };

// uitgevoerd (UTC-moment, Brusselse dag en tijd), van, naar, dienstdatum, dienst, soort, tegendatum, tegendienst, door, status
const UITGEVOERD = [
  ['2026-09-18T09:40:45.949Z', '2026-09-18', '11:40', '61', '44', '2026-10-06', '2112', 'Ruil', '2026-10-06', '2109', 'Jarno De Greve', 'Goedgekeurd'],
  ['2026-09-18T09:35:01.377Z', '2026-09-18', '11:35', '60', '43', '2026-09-25', '2116', 'Handmatig', null, null, 'Jarno De Greve', 'Goedgekeurd'],
  ['2026-09-17T11:36:40.676Z', '2026-09-17', '13:36', '44', '62', '2026-10-29', '2104', 'Handmatig', '2026-10-29', '2114', 'Jarno De Greve', 'Goedgekeurd'],
  ['2026-09-16T13:25:41.891Z', '2026-09-16', '15:25', '43', '61', '2026-09-18', '2111', 'Ruil', '2026-09-18', '2105', 'Jarno De Greve', 'Afgehandeld'],
  ['2026-09-14T09:45:34.926Z', '2026-09-14', '11:45', '62', '42', '2026-09-15', '2102', 'Handmatig', null, null, 'Jarno De Greve', 'Teruggedraaid'],
  ['2026-09-10T22:30:12.000Z', '2026-09-11', '00:30', '42', '60', '2026-09-20', '2703', 'Overname', null, null, 'Jarno De Greve', 'Afgehandeld'],
];

const uitgevoerdeWissels = (q) => {
  const chauffeur = q.get('chauffeur') || '';
  const rijen = UITGEVOERD
    .filter(([, dag, , van, naar]) => binnen(dag, q) && (!chauffeur || van === chauffeur || naar === chauffeur))
    .map(([moment, uitgevoerdOp, , van, naar, dienstdatum, dienst, soort, tegenDatum, tegenDienst, door, status]) => ({
      id: `w|${moment}`, uitgevoerdOp, uitgevoerdMoment: moment, van: NAAM[van], naar: NAAM[naar], dienstdatum, dienst, soort, tegenDatum, tegenDienst, door, status,
    }));
  return { rijen, totalen: {}, bereik: { van: '2026-07-24', tot: '2026-09-18' }, gegenereerdOp: GEGENEREERD };
};

// id, aangevraagd op, aanvrager, collega, dienstdatum, dienst, soort, status (sleutel + label), antwoord, beslist op, door, doorlooptijd
const AANVRAGEN = [
  ['a9', '2026-09-19', '43', '44', '2026-10-04', '2703', 'Overname', 'bij-planning', 'Bij planning', 'Geaccepteerd', null, null, 2],
  ['a8', '2026-09-18', '61', '44', '2026-10-06', '2112', 'Ruil', 'goedgekeurd', 'Goedgekeurd', 'Niet afgewacht', '2026-09-18', 'Jarno De Greve', 0],
  ['a7', '2026-09-18', '60', '43', '2026-09-25', '2116', 'Handmatig', 'goedgekeurd', 'Goedgekeurd', 'Niet nodig', '2026-09-18', 'Jarno De Greve', null],
  ['a6', '2026-09-17', '42', '62', '2026-10-01', '2101', 'Ruil', 'bij-collega', 'Bij collega', 'Wacht', null, null, 4],
  ['a5', '2026-09-14', '62', '42', '2026-09-15', '2102', 'Handmatig', 'teruggedraaid', 'Teruggedraaid', 'Niet nodig', '2026-09-14', 'Jarno De Greve', null],
  ['a4', '2026-09-11', '44', '61', '2026-09-22', '2607', 'Overname', 'geweigerd', 'Geweigerd', 'Geweigerd', '2026-09-12', 'Bart Claeys', 1],
  ['a3', '2026-09-11', '43', '60', '2026-09-19', '2515', 'Ruil', 'ingetrokken', 'Ingetrokken', 'Geen antwoord', '2026-09-11', 'Alex Du Priez', 0],
  ['a2', '2026-09-09', '43', '61', '2026-09-18', '2111', 'Ruil', 'afgehandeld', 'Afgehandeld', 'Geaccepteerd', '2026-09-16', 'Jarno De Greve', 7],
];
const SOORT_WAARDE = { Ruil: 'ruil', Overname: 'overname', Handmatig: 'handmatig' };

const ruilaanvragen = (q) => {
  const status = q.get('status') || 'alle';
  const soort = q.get('soort') || 'alle';
  const chauffeur = q.get('chauffeur') || '';
  const rijen = AANVRAGEN
    .filter(([, dag, aanvrager, collega, , , srt, stand]) => binnen(dag, q)
      && (!chauffeur || aanvrager === chauffeur || collega === chauffeur)
      && (status === 'alle' || stand === status)
      && (soort === 'alle' || SOORT_WAARDE[srt] === soort))
    .map(([id, aangevraagdOp, aanvrager, collega, dienstdatum, dienst, srt, , statusLabel, antwoord, beslistOp, door, doorlooptijd]) => ({
      id, aangevraagdOp, aangevraagdMoment: `${aangevraagdOp}T08:00:00.000Z`, aanvrager: NAAM[aanvrager], collega: NAAM[collega], dienstdatum, dienst, soort: srt, status: statusLabel, antwoord, beslistOp, door, doorlooptijd,
    }));
  const met = rijen.filter((r) => r.doorlooptijd !== null);
  return {
    rijen,
    totalen: met.length ? { doorlooptijd: met.reduce((n, r) => n + r.doorlooptijd, 0) / met.length } : {},
    bereik: { van: '2026-06-09', tot: '2026-09-19' },
    peildatum: PEILDATUM,
    gegenereerdOp: GEGENEREERD,
  };
};

// naam, aangevraagd, ontvangen, goedgekeurd, geweigerd, ingetrokken, teruggedraaid, open, door planning
const PER_CHAUFFEUR = [
  ['43', 3, 1, 1, 0, 1, 0, 1, 1], ['61', 1, 2, 2, 1, 0, 0, 0, 0], ['44', 1, 2, 1, 1, 0, 0, 1, 1], ['42', 1, 0, 0, 0, 0, 1, 1, 1],
  ['60', 0, 1, 0, 0, 1, 0, 0, 1], ['62', 0, 1, 0, 0, 0, 1, 1, 2],
];
const ruilenPerChauffeur = () => ({
  rijen: PER_CHAUFFEUR.map(([id, aangevraagd, ontvangen, goedgekeurd, geweigerd, ingetrokken, teruggedraaid, open, doorPlanning]) => ({ id, naam: NAAM[id], aangevraagd, ontvangen, goedgekeurd, geweigerd, ingetrokken, teruggedraaid, open, doorPlanning })),
  // Ruilen, niet de som van de rijen: een ruil staat bij twee chauffeurs.
  totalen: { aangevraagd: 6, ontvangen: 6, goedgekeurd: 2, geweigerd: 1, ingetrokken: 1, teruggedraaid: 1, open: 2, doorPlanning: 3 },
  bereik: { van: '2026-06-09', tot: '2026-09-19' },
  gegenereerdOp: GEGENEREERD,
});

// id, naam, sectie, dagen met dienst, minuten, ander werk, ziek, betaald afwezig, vrij, overig, dagen
const OVERZICHT = [
  ['43', 'Alex Du Priez', 'Reguliere', 18, 8745, 0, 0, 2, 10, 0, 30],
  ['61', 'Bart Claeys', 'Reguliere', 16, 7610, 1, 3, 1, 9, 0, 30],
  ['44', 'Diether Van Haute', 'Reguliere', 19, 9030, 0, 0, 0, 11, 0, 30],
  ['42', 'Test Chauffeur', 'Reguliere', 15, 7125, 2, 0, 4, 9, 0, 30],
  ['60', 'Annelies Verstraete', 'Nacht', 14, 6020, 0, 5, 0, 11, 0, 30],
  ['62', 'Carine De Smet', 'Flexi', 6, 2430, 0, 0, 0, 0, 1, 7],
];
const overzichtPerChauffeur = (q) => {
  const chauffeur = q.get('chauffeur') || '';
  const rijen = OVERZICHT
    .filter(([id]) => !chauffeur || id === chauffeur)
    .map(([id, naam, sectie, diensten, minuten, anderWerk, ziek, betaald, vrij, overig, dagen]) => ({ id, naam, sectie, diensten, minuten, anderWerk, ziek, betaald, vrij, overig, dagen }));
  const som = (k) => rijen.reduce((n, r) => n + r[k], 0);
  return {
    rijen,
    totalen: Object.fromEntries(['diensten', 'minuten', 'anderWerk', 'ziek', 'betaald', 'vrij', 'overig', 'dagen'].map((k) => [k, som(k)])),
    bereik: { van: '2026-07-01', tot: '2026-11-08' },
    gegenereerdOp: GEGENEREERD,
  };
};

// datum, dag, dienst, deel, start, einde, duur, loop, chauffeur
const DELEN = [
  ['2026-09-21', 'ma', '2101', 1, '04:36', '07:52', 196, '4500', '42'],
  ['2026-09-21', 'ma', '2101', 2, '13:39', '17:29', 230, '4611', '42'],
  ['2026-09-21', 'ma', '2109', 1, '06:53', '08:23', 90, '4601', '43'],
  ['2026-09-21', 'ma', '2109', 2, '13:10', '19:15', 365, '4602', '43'],
  ['2026-09-21', 'ma', '2607', 1, '15:41', '26:16', 635, '4500', '44'],
  ['2026-09-22', 'di', '2102', 1, '05:28', '12:13', 405, '4600', '61'],
  ['2026-09-22', 'di', '2515', 1, '07:08', '08:34', 86, '4505', '60'],
  ['2026-09-22', 'di', '2515', 2, '15:13', '21:55', 402, '4510', '60'],
  ['2026-09-22', 'di', '2515', 3, '24:10', '25:10', 60, '4515', '60'],
  ['2026-09-23', 'wo', '2101', 1, '04:36', '07:52', 196, '4500', '43'],
  ['2026-09-23', 'wo', '2101', 2, '13:39', '17:29', 230, '4611', '43'],
  ['2026-09-24', 'do', '4101', 1, '06:12', '09:30', 198, '4500', '62'],
];
const dienstenPerDag = (q) => {
  const chauffeur = q.get('chauffeur') || '';
  // Zoals productie vandaag: de planning houdt geen bus per dienst bij.
  const rijen = q.get('voertuig') ? [] : DELEN
    .filter(([datum, , , , , , , , wie]) => binnen(datum, q) && (!chauffeur || wie === chauffeur))
    .map(([datum, dag, dienst, deel, start, einde, duur, loop, wie]) => ({
      id: `${datum}|${dienst}|${deel}`, datum, dag, dienst, deel, start, einde, duur, loop, bus: null, chauffeur: NAAM[wie], volgorde: `${datum}|${dienst.padStart(8, '0')}|${deel}|${wie}`,
    }));
  return { rijen, totalen: {}, bereik: { van: '2026-07-01', tot: '2026-11-08' }, gegenereerdOp: GEGENEREERD };
};

// datum, dag, dagtype, dienst, reden, ingevuld door, status
const OPEN = [
  ['2026-09-21', 'ma', 'schooldag', '2101', 'Ziek: Annelies Verstraete', null, 'Open'],
  ['2026-09-21', 'ma', 'schooldag', '2115', 'Niet toegewezen', null, 'Open'],
  ['2026-09-21', 'ma', 'schooldag', '2109', 'Verlof: Bart Claeys', 'Alex Du Priez', 'Ingevuld'],
  ['2026-09-23', 'wo', 'schooldag', '2607', 'Ziek: Annelies Verstraete', null, 'Open'],
  ['2026-09-27', 'zo', 'zondag', '2703', 'Klein verlet: Diether Van Haute', 'Test Chauffeur', 'Ingevuld'],
  ['2026-10-03', 'za', 'zaterdag', '2515', 'Niet toegewezen', null, 'Open'],
];
const openstaandeDiensten = (q) => ({
  rijen: OPEN
    .filter(([datum]) => binnen(datum, q))
    .map(([datum, dag, dagtype, dienst, reden, ingevuldDoor, status], i) => ({ id: `${datum}|${dienst}`, datum, dag, dagtype, dienst, reden, ingevuldDoor, status, volgorde: `${datum}|${i}` })),
  totalen: {},
  bereik: { van: PEILDATUM, tot: '2026-11-08' },
  peildatum: PEILDATUM,
  gegenereerdOp: GEGENEREERD,
});

/** Het antwoord voor dit rapport, of null als dit bestand het niet kent (dan zoekt audit-fixtures verder). */
export function rapportFixtureRuilenPlanning(id, query) {
  switch (id) {
    case 'uitgevoerde-wissels': return uitgevoerdeWissels(query);
    case 'ruilen-per-chauffeur': return ruilenPerChauffeur();
    case 'ruilaanvragen': return ruilaanvragen(query);
    case 'overzicht-per-chauffeur': return overzichtPerChauffeur(query);
    case 'diensten-per-dag': return dienstenPerDag(query);
    // Geen bus in de planning: een lege bron ("nog niets geregistreerd"), geen lege tabel.
    case 'inzet-per-voertuig': return { rijen: [], totalen: { duur: 0 }, bereik: null, gegenereerdOp: GEGENEREERD };
    case 'openstaande-diensten': return openstaandeDiensten(query);
    default: return null;
  }
}
