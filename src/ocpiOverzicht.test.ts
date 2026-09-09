// @vitest-environment node
/**
 * Laadpalen-herwerking (08-09-2026): de zuivere rekenlaag van het
 * maandoverzicht, de historiek en de sessielijst (api/_lib/ocpiOverzicht.ts).
 * Verraderlijk: de Brusselse dag-/maandgrens, de definitie laadbeurt vs.
 * mislukt, en de samenvoeging van dagpieken uit twee bronnen.
 */
import { describe, it, expect } from 'vitest';
import {
  bouwDagen, bouwMaanden, bouwPuntMatrix, bouwPunten, bouwTotalen, dagenReeks, dagpiekenUitSnapshots, dagpiekenUitTabel,
  maandGrenzenVan, sessieDetail, voegPiekenSamen,
} from '../api/_lib/ocpiOverzicht';

const periodes = [
  { start_date_time: '2026-09-07T17:21:52Z', dimensions: [{ type: 'ENERGY', volume: 0 }, { type: 'TIME', volume: 0 }, { type: 'STATE_OF_CHARGE', volume: 57 }] },
  { start_date_time: '2026-09-07T17:22:12Z', dimensions: [{ type: 'POWER', volume: 0 }, { type: 'ENERGY', volume: 159.379 }, { type: 'TIME', volume: 7.296666 }, { type: 'STATE_OF_CHARGE', volume: 88 }] },
  { start_date_time: '2026-09-08T02:16:35Z', dimensions: [{ type: 'ENERGY', volume: 65.519 }, { type: 'TIME', volume: 2.098333 }, { type: 'STATE_OF_CHARGE', volume: 100 }] },
  { start_date_time: '2026-09-08T04:22:29Z', dimensions: [{ type: 'PARKING_TIME', volume: 0.0008 }] },
];

describe('sessieDetail', () => {
  it('leidt duur, laadtijd, gemiddeld/max vermogen en batterij van→tot af uit de charging_periods', () => {
    const s = sessieDetail({
      id: 'S1', evse_uid: 'CS-1', status: 'COMPLETED', kwh: 224.898,
      start_date_time: '2026-09-07T17:22:12.212Z', end_date_time: '2026-09-08T04:22:32.483Z',
      periodes, klasse: 'OK', voertuig: 'MAN Lion’s City E',
    });
    expect(s.dag).toBe('2026-09-07');
    expect(s.duurMin).toBe(660);
    expect(s.laadMin).toBe(564); // 7,2967 + 2,0983 uur
    expect(s.kwh).toBe(224.9);
    expect(s.gemKw).toBe(23.9); // 224,9 / 9,395 u
    expect(s.maxKw).toBe(31.2); // blok 2: 65,519 / 2,0983
    expect(s.socStart).toBe(57);
    expect(s.socEind).toBe(100);
    expect(s.laadbeurt).toBe(true);
    expect(s.mislukt).toBe(false);
    expect(s.ongeldig).toBe(false);
    expect(s.voertuig).toBe('MAN Lion’s City E');
  });

  it('herkent een mislukte aankoppeling (classificatie ≠ OK, 0 kWh)', () => {
    const s = sessieDetail({ id: 'S2', evse_uid: 'CS-1', status: 'COMPLETED', kwh: 0, start_date_time: '2026-09-07T21:00:00Z', end_date_time: '2026-09-07T21:32:00Z', periodes: [], klasse: 'HANDSHAKE_FAIL' });
    expect(s).toMatchObject({ laadbeurt: false, mislukt: true, klasse: 'HANDSHAKE_FAIL', duurMin: 32, laadMin: null, gemKw: null, maxKw: null, socStart: null });
  });

  it('INVALID telt nergens mee, ook niet als mislukt', () => {
    const s = sessieDetail({ id: 'S3', evse_uid: 'CS-1', status: 'invalid', kwh: 12, start_date_time: '2026-09-07T21:00:00Z', klasse: 'LOW_POWER' });
    expect(s).toMatchObject({ ongeldig: true, laadbeurt: false, mislukt: false, duurMin: null, laadMin: null });
  });

  it('een lopende sessie heeft geen einde en geen duur; POWER in watt wordt kW', () => {
    const s = sessieDetail({
      id: 'S4', evse_uid: 'CS-2', status: 'ACTIVE', kwh: '40.5', start_date_time: '2026-09-08T01:00:00Z', end_date_time: null,
      periodes: [{ start_date_time: '2026-09-08T01:00:00Z', dimensions: [{ type: 'POWER', volume: 112000 }, { type: 'STATE_OF_CHARGE', volume: 40 }] }],
    });
    expect(s.duurMin).toBeNull();
    expect(s.maxKw).toBe(112);
    expect(s.kwh).toBe(40.5);
    expect(s.socStart).toBe(40);
    expect(s.socEind).toBe(40);
  });

  it('verdraagt rommel: ontbrekende velden, tekst-kWh, kapotte tijdstempels', () => {
    const s = sessieDetail({ id: null, evse_uid: undefined, kwh: 'x', start_date_time: 'rommel', periodes: 'geen', klasse: 42 });
    expect(s).toMatchObject({ id: '', evseUid: '', dag: '', kwh: 0, klasse: null, laadbeurt: false, mislukt: false, laadMin: null });
  });
});

describe('dagpieken', () => {
  it('bucket snapshots op de Brusselse dag; hoogste wint, bij gelijke stand het vroegste slot', () => {
    const m = dagpiekenUitSnapshots([
      { ts: '2026-08-31T22:15:00Z', total_power_kw: 300, charging: 5 }, // 1 sep 00:15 lokaal
      { ts: '2026-09-01T02:00:00Z', total_power_kw: 300, charging: 6 },
      { ts: '2026-09-01T01:00:00Z', total_power_kw: 280.44, charging: 4 },
      { ts: '2026-08-31T20:00:00Z', total_power_kw: 100, charging: 1 }, // nog 31 aug
      { ts: 'rommel', total_power_kw: 999 },
    ]);
    expect(m.get('2026-09-01')).toEqual({ kw: 300, ts: '2026-08-31T22:15:00Z', charging: 5 });
    expect(m.get('2026-08-31')).toEqual({ kw: 100, ts: '2026-08-31T20:00:00Z', charging: 1 });
    expect(m.size).toBe(2);
  });

  it('voegt de permanente tabel en de snapshots samen (hoogste wint)', () => {
    const tabel = dagpiekenUitTabel([{ dag: '2026-09-01', piek_kw: '310.5', piek_ts: '2026-09-01T03:00:00Z', charging: 7 }, { dag: 'x', piek_kw: 1 }]);
    const snaps = dagpiekenUitSnapshots([{ ts: '2026-09-01T02:00:00Z', total_power_kw: 300, charging: 6 }, { ts: '2026-09-02T02:00:00Z', total_power_kw: 250, charging: 3 }]);
    const samen = voegPiekenSamen(tabel, snaps);
    expect(samen.get('2026-09-01')).toEqual({ kw: 310.5, ts: '2026-09-01T03:00:00Z', charging: 7 });
    expect(samen.get('2026-09-02')?.kw).toBe(250);
    expect(samen.has('x')).toBe(false);
  });
});

const evses = [
  { uid: 'CS-1', evse_id: '12.A', physical_reference: 'mal.1.1', max_electric_power: 140000 },
  { uid: 'CS-2', evse_id: '12.B', physical_reference: 'mal.1.2', max_electric_power: 140000 },
];
const sessies = [
  sessieDetail({ id: 'a', evse_uid: 'CS-1', status: 'COMPLETED', kwh: 100, start_date_time: '2026-08-03T20:00:00Z', end_date_time: '2026-08-04T02:00:00Z', periodes: [{ dimensions: [{ type: 'ENERGY', volume: 100 }, { type: 'TIME', volume: 4 }] }], klasse: 'OK' }),
  sessieDetail({ id: 'b', evse_uid: 'CS-1', status: 'COMPLETED', kwh: 0, start_date_time: '2026-08-03T21:00:00Z', end_date_time: '2026-08-03T21:30:00Z', periodes: [], klasse: 'HANDSHAKE_FAIL' }),
  sessieDetail({ id: 'c', evse_uid: 'CS-2', status: 'COMPLETED', kwh: 50.26, start_date_time: '2026-08-31T22:30:00Z', end_date_time: '2026-09-01T03:00:00Z', periodes: [{ dimensions: [{ type: 'ENERGY', volume: 50 }, { type: 'TIME', volume: 1 }] }], klasse: 'OK' }), // 1 sep lokaal
  sessieDetail({ id: 'd', evse_uid: 'CS-1', status: 'INVALID', kwh: 999, start_date_time: '2026-08-10T20:00:00Z' }),
  sessieDetail({ id: 'e', evse_uid: 'WEG', status: 'COMPLETED', kwh: 7, start_date_time: '2026-08-12T20:00:00Z', periodes: [] }),
];
const pieken = dagpiekenUitSnapshots([
  { ts: '2026-08-03T20:00:00Z', total_power_kw: 220, charging: 4 }, // 3 aug 22:00 lokaal
  { ts: '2026-08-04T01:00:00Z', total_power_kw: 180, charging: 3 }, // 4 aug 03:00 lokaal
  { ts: '2026-08-12T20:00:00Z', total_power_kw: 330, charging: 6 },
]);

describe('bouwDagen / bouwTotalen', () => {
  const AUG = { van: '2026-08-01', tot: '2026-08-31' };
  it('geeft elke kalenderdag met verbruik, tellingen en dagpiek (0/null waar niets is)', () => {
    const dagen = bouwDagen(AUG, sessies, pieken);
    expect(dagen).toHaveLength(31);
    expect(dagen[2]).toEqual({ dag: '2026-08-03', kwh: 100, sessies: 2, laadbeurten: 1, mislukt: 1, piekKw: 220, piekTs: '2026-08-03T20:00:00Z', piekCharging: 4 });
    expect(dagen[3]).toMatchObject({ dag: '2026-08-04', kwh: 0, sessies: 0, piekKw: 180 });
    expect(dagen[11]).toMatchObject({ dag: '2026-08-12', kwh: 7, laadbeurten: 1, piekKw: 330 });
    expect(dagen[30]).toMatchObject({ dag: '2026-08-31', kwh: 0, piekKw: null }); // sessie c = september
  });
  it('totalen: laaddagen, gemiddelde per laaddag, hoogste dag en de kwartierpiek van de periode', () => {
    const t = bouwTotalen(bouwDagen(AUG, sessies, pieken), sessies.filter((s) => s.dag.startsWith('2026-08')));
    expect(t).toMatchObject({
      kwh: 107, sessies: 3, laadbeurten: 2, mislukt: 1, laaddagen: 2, gemPerLaaddag: 53.5,
      hoogsteDag: { dag: '2026-08-03', kwh: 100 },
      piekKw: 330, piekDag: '2026-08-12', piekTs: '2026-08-12T20:00:00Z', piekCharging: 6,
      gemDagpiekKw: 243.3, piekDagen: 3, laadMin: 240,
    });
  });
  // Controle-ronde 09-09, nr. 1: draagt geen enkele sessie charging_periods,
  // dan is laadMin van elke sessie null. Dat mag geen 0 worden, anders staat
  // er een fout getal in het jaartotaal en de Excel-export.
  it('laadtijd blijft null wanneer geen enkele sessie laadperiodes had', () => {
    const zonderPeriodes = sessies
      .filter((s) => s.dag.startsWith('2026-08'))
      .map((s) => ({ ...s, laadMin: null }));
    const t = bouwTotalen(bouwDagen(AUG, sessies, pieken), zonderPeriodes);
    expect(t.laadMin).toBeNull();
    // De rest van de totalen blijft gewoon werken.
    expect(t.kwh).toBe(107);
  });

  it('dagenReeks en maandGrenzen lopen over maand-/jaargrenzen', () => {
    expect(dagenReeks('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(maandGrenzenVan('2028-02')).toEqual({ van: '2028-02-01', tot: '2028-02-29' });
  });
});

describe('bouwPunten', () => {
  it('per laadpunt: kWh, aandeel, tellingen, laadtijd, gem./max kW; onbekende uid alleen met kWh', () => {
    const p = bouwPunten({ van: '2026-08-01', tot: '2026-08-31' }, sessies, evses);
    expect(p).toHaveLength(3);
    expect(p[0]).toEqual({ evseUid: 'CS-1', evseId: '12.A', physicalReference: 'mal.1.1', maxElectricPowerKw: 140, kwh: 100, aandeel: 93.5, sessies: 2, laadbeurten: 1, mislukt: 1, laadMin: 240, gemKw: 25, maxKw: 25 });
    expect(p[1]).toMatchObject({ evseUid: 'CS-2', kwh: 0, aandeel: 0, sessies: 0, gemKw: null, maxKw: null });
    expect(p[2]).toMatchObject({ evseUid: 'WEG', evseId: null, kwh: 7, aandeel: 6.5 });
  });
});

describe('bouwMaanden / bouwPuntMatrix', () => {
  it('één rij per maand van de eerste sessie t/m de opgegeven maand, ook lege maanden', () => {
    const m = bouwMaanden(sessies, pieken, '2026-10');
    expect(m.map((x) => x.maand)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(m[0]).toMatchObject({ maand: '2026-08', dagen: 31, kwh: 107, laadbeurten: 2, mislukt: 1, piekKw: 330, klassen: { HANDSHAKE_FAIL: 1 } });
    expect(m[1]).toMatchObject({ maand: '2026-09', kwh: 50.3, laadbeurten: 1, piekKw: null, klassen: {} });
    expect(m[2]).toMatchObject({ maand: '2026-10', kwh: 0, sessies: 0 });
  });
  it('lege invoer geeft geen maanden', () => {
    expect(bouwMaanden([], new Map(), '2026-10')).toEqual([]);
  });
  it('matrix laadpunt × maand', () => {
    const x = bouwPuntMatrix(sessies, ['2026-08', '2026-09'], evses);
    expect(x[0]).toEqual({ evseUid: 'CS-1', evseId: '12.A', physicalReference: 'mal.1.1', perMaand: { '2026-08': 100, '2026-09': 0 }, totaal: 100 });
    expect(x[1]).toMatchObject({ evseUid: 'CS-2', perMaand: { '2026-08': 0, '2026-09': 50.3 }, totaal: 50.3 });
    expect(x[2]).toMatchObject({ evseUid: 'WEG', totaal: 7 });
  });
});
