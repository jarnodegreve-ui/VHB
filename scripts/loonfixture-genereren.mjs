#!/usr/bin/env node
/**
 * Verzonnen loonfixture voor shared/loon/easypay.test.ts.
 *
 * ALLES in shared/loon/__fixtures__/easypay-verzonnen.json is verzonnen en
 * komt uit dit script: de medewerkers (matricules 900001 en hoger bestaan
 * niet), de maand (november 2030), wie wanneer welke dienst reed, wie
 * afwezig was, de overminuten en de premies. Een toevalsgenerator met een
 * vaste seed bepaalt de verdeling, dus elke run geeft byte voor byte
 * hetzelfde bestand. Het script leest geen enkele echte dagadministratie.
 *
 * Het enige wat uit de repo komt is de tabel met looncodes
 * (supabase/2026-09-13_loon_dagafsluiting.sql): welke dienstnummers en
 * afwezigheidscodes bestaan, met hun Easypay-activiteit, typeprestatie en
 * tiktijden. Dat zijn gegevens over diensten, niet over personen.
 *
 *   node scripts/loonfixture-genereren.mjs            schrijft de fixture
 *   node scripts/loonfixture-genereren.mjs --controle  vergelijkt, exit 1 bij verschil
 *
 * VERWACHTE RIJEN. Ze komen NIET uit shared/loon/easypay.ts: dit script
 * importeert geen productiecode. Ze volgen uit de regels hieronder (REGELS),
 * die beschrijven wat de Access-query
 * `-frmloonadmEasyPayExportVorigeMaand-union LB+Overmin` doet. Geeft de
 * productiecode iets anders dan deze regels, dan faalt de test en is een van
 * de twee fout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SEED = 20301101;
export const MAAND = '2030-11';
export const LIDNR = 9999;
export const EERSTE_MATRICULE = 900001;
export const AANTAL_MEDEWERKERS = 20;
/** Allerheiligen en Wapenstilstand: wie niet rijdt krijgt de code F. */
export const FEESTDAGEN = ['2030-11-01', '2030-11-11'];

const HIER = path.dirname(fileURLToPath(import.meta.url));
export const SEED_SQL = path.join(HIER, '..', 'supabase', '2026-09-13_loon_dagafsluiting.sql');
export const FIXTURE = path.join(HIER, '..', 'shared', 'loon', '__fixtures__', 'easypay-verzonnen.json');

/**
 * De regels, per soort geval. `bron` zegt waar de regel beschreven staat,
 * los van de rekenfunctie in shared/loon/easypay.ts.
 */
export const REGELS = [
  {
    geval: 'dagrij',
    wanneer: 'Elke dag van elke medewerker, ook een dag zonder dienst (code -).',
    uitkomst: 'Eén rij: soc 1, composant 1, matricule, datum, Type Info TH, duree 0, periode = jjjjmm, alphal2 = het lidnummer, alle overige getalvelden 0 en de vrije velden leeg.',
    bron: 'Kop van shared/loon/easypay.ts (beschrijving van de Access-query); kolommen: EASYPAY_KOLOMMEN in shared/loon.ts.',
  },
  {
    geval: 'activiteit en typeprestatie',
    wanneer: 'Op elke dagrij.',
    uitkomst: 'Uit de looncode: een lijndienst is LIJN met 40140, - is 01 met 15102, BV is 01 met 15200, Ziek is 01 met 15800, F is 01 met 15100, Tk is 01 met 15501.',
    bron: 'Seed van loon_codes in supabase/2026-09-13_loon_dagafsluiting.sql (uit tblDienstNummerGegevens). VASTE_CODES hieronder herhaalt de vijf afwezigheidscodes met de hand; het script stopt als de seed iets anders zegt.',
  },
  {
    geval: 'tiktijden',
    wanneer: 'Op elke dagrij.',
    uitkomst: 'HD = de eerste gevulde van tiktijd 1, 3, 5. HA = de eerste gevulde van tiktijd 6, 4, 2. Een code zonder tiktijden geeft twee lege velden.',
    bron: 'Commentaar bij de kolommen tik1..tik6 in supabase/2026-09-13_loon_dagafsluiting.sql.',
  },
  {
    geval: 'service',
    wanneer: 'Op elke rij.',
    uitkomst: 'De code zoals ze in de dagadministratie geschreven staat (BV, Ziek, 2102), niet de sleutel in kleine letters.',
    bron: 'Kop van shared/loon/easypay.ts ("Service = de code").',
  },
  {
    geval: 'premie onvoorziene dienst',
    wanneer: 'De dag draagt de premie.',
    uitkomst: 'Prime 12 op de dagrij, anders leeg.',
    bron: 'Kop van shared/loon/easypay.ts.',
  },
  {
    geval: 'overminuten, som groter dan nul',
    wanneer: 'Gewoon + nacht + extra is samen meer dan 0.',
    uitkomst: 'Een tweede rij voor die dag, gelijk aan de dagrij, maar met typeprestatie 40945, Type Info PRT en duree = de som in minuten gedeeld door 1440 (een dagfractie).',
    bron: 'Kop van shared/loon/easypay.ts; TYPPRE_OVERMIN_POSITIEF in shared/loon.ts.',
  },
  {
    geval: 'overminuten, som kleiner dan nul',
    wanneer: 'Gewoon + nacht + extra is samen minder dan 0.',
    uitkomst: 'Een tweede rij zoals hierboven, met typeprestatie 40946 en een negatieve duree.',
    bron: 'Kop van shared/loon/easypay.ts; TYPPRE_OVERMIN_NEGATIEF in shared/loon.ts.',
  },
  {
    geval: 'overminuten, som precies nul',
    wanneer: 'Er staan minuten, maar ze heffen elkaar op.',
    uitkomst: 'Geen tweede rij.',
    bron: 'Kop van shared/loon/easypay.ts ("som van gewoon + nacht + extra ≠ 0").',
  },
];

/** De vijf afwezigheidscodes, met de hand overgenomen: [schrijfwijze, activiteit, typeprestatie]. */
export const VASTE_CODES = [
  ['-', '01', 15102],
  ['BV', '01', 15200],
  ['Ziek', '01', 15800],
  ['F', '01', 15100],
  ['Tk', '01', 15501],
];
const LIJN_ACTIVITEIT = 'LIJN';
const LIJN_TYPEPRESTATIE = 40140;
const OVERMIN_POSITIEF = 40945;
const OVERMIN_NEGATIEF = 40946;
const MINUTEN_PER_DAG = 1440;

// --- De looncodes uit de seed lezen (eigen lezer, geen productiecode) -------

/** Eén rij `( 'a', null, true, 12, ... )` naar een lijst waarden. */
const leesRij = (regel) => {
  const waarden = [];
  let i = regel.indexOf('(') + 1;
  while (i < regel.length) {
    const c = regel[i];
    if (c === ' ' || c === ',') { i += 1; continue; }
    if (c === ')') break;
    if (c === "'") {
      let tekst = '';
      i += 1;
      while (i < regel.length) {
        if (regel[i] === "'" && regel[i + 1] === "'") { tekst += "'"; i += 2; continue; }
        if (regel[i] === "'") { i += 1; break; }
        tekst += regel[i];
        i += 1;
      }
      waarden.push(tekst);
      continue;
    }
    let ruw = '';
    while (i < regel.length && regel[i] !== ',' && regel[i] !== ')') { ruw += regel[i]; i += 1; }
    ruw = ruw.trim();
    waarden.push(ruw === 'null' ? null : ruw === 'true' ? true : ruw === 'false' ? false : Number(ruw));
  }
  return waarden;
};

export function leesLooncodes(sql) {
  const start = sql.indexOf('insert into public.loon_codes');
  if (start < 0) throw new Error('Seed van loon_codes niet gevonden.');
  const kolommen = sql.slice(sql.indexOf('(', start) + 1, sql.indexOf(')', start)).split(',').map((k) => k.trim());
  const blok = sql.slice(sql.indexOf('values', start) + 6, sql.indexOf('on conflict do nothing', start));
  const codes = new Map();
  for (const regel of blok.split('\n')) {
    if (!/^\s*\(/.test(regel)) continue;
    const waarden = leesRij(regel);
    if (waarden.length !== kolommen.length) throw new Error(`Seedrij met ${waarden.length} waarden, verwacht ${kolommen.length}: ${regel.trim().slice(0, 40)}`);
    const rij = Object.fromEntries(kolommen.map((k, n) => [k, waarden[n]]));
    codes.set(rij.code, {
      sleutel: rij.code,
      schrijfwijze: rij.code_weergave,
      soort: rij.dienst_type,
      inExport: rij.in_export,
      activiteit: rij.easypay_activiteit,
      typeprestatie: rij.easypay_type_prest,
      tik: [rij.tik1, rij.tik2, rij.tik3, rij.tik4, rij.tik5, rij.tik6],
    });
  }
  return codes;
}

// --- Toeval met een vaste seed (mulberry32) --------------------------------

const maakToeval = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// --- De regels als rekenwerk ------------------------------------------------

const eersteGevulde = (...tijden) => tijden.find((t) => typeof t === 'string' && t !== '') ?? null;

/** Verwachte Easypay-rijen voor de invoer, volgens REGELS. */
export function verwachteRijen(invoer, codes) {
  const rijen = [];
  for (const dag of invoer) {
    const code = codes.get(dag.code.trim().toLowerCase());
    if (!code || !code.inExport) throw new Error(`De fixture hoort alleen codes te bevatten die in de export staan: ${dag.code}`);
    const [tik1, tik2, tik3, tik4, tik5, tik6] = code.tik;
    const dagrij = {
      soc: 1,
      matric: dag.matric,
      date: dag.datum,
      composant: 1,
      activit: code.activiteit,
      hd: eersteGevulde(tik1, tik3, tik5),
      ha: eersteGevulde(tik6, tik4, tik2),
      duree: 0,
      typpre: code.typeprestatie,
      nbpl: 0,
      alpha1: 0,
      dec1: 0,
      alphal2: LIDNR,
      deci2: 0,
      typeInfo: 'TH',
      prime: dag.onvPremie ? '12' : '',
      vrijveld: '',
      service: dag.code,
      version: '',
      periode: MAAND.replace('-', ''),
      jd: 0,
      ja: 0,
    };
    rijen.push(dagrij);
    const som = dag.overmin + dag.overminNacht + dag.overminExtra;
    if (som > 0) rijen.push({ ...dagrij, typpre: OVERMIN_POSITIEF, typeInfo: 'PRT', duree: som / MINUTEN_PER_DAG });
    if (som < 0) rijen.push({ ...dagrij, typpre: OVERMIN_NEGATIEF, typeInfo: 'PRT', duree: som / MINUTEN_PER_DAG });
  }
  return rijen;
}

// --- De verzonnen maand -----------------------------------------------------

const dagenVanDeMaand = () => {
  const [jaar, maand] = MAAND.split('-').map(Number);
  const aantal = new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
  return Array.from({ length: aantal }, (_, n) => `${MAAND}-${String(n + 1).padStart(2, '0')}`);
};
const weekdag = (datum) => new Date(`${datum}T12:00:00Z`).getUTCDay();

export function bouwFixture(seedSql) {
  const codes = leesLooncodes(seedSql);
  for (const [schrijfwijze, activiteit, typeprestatie] of VASTE_CODES) {
    const c = codes.get(schrijfwijze.toLowerCase());
    if (!c || c.schrijfwijze !== schrijfwijze || c.activiteit !== activiteit || c.typeprestatie !== typeprestatie || !c.inExport || c.tik.some(Boolean)) {
      throw new Error(`De seed zegt over ${schrijfwijze} iets anders dan VASTE_CODES.`);
    }
  }

  const toeval = maakToeval(SEED);
  const geheel = (van, tot) => van + Math.floor(toeval() * (tot - van + 1));
  const kans = (p) => toeval() < p;
  const schud = (lijst) => {
    const uit = [...lijst];
    for (let i = uit.length - 1; i > 0; i -= 1) {
      const j = geheel(0, i);
      [uit[i], uit[j]] = [uit[j], uit[i]];
    }
    return uit;
  };

  // Dienstnummers: alleen gewone lijndiensten (4 of 5 cijfers), per opbouw.
  const lijn = [...codes.values()].filter((c) => c.soort === 'lijn' && c.inExport && /^[0-9]{4,5}$/.test(c.sleutel)
    && c.activiteit === LIJN_ACTIVITEIT && c.typeprestatie === LIJN_TYPEPRESTATIE);
  const opbouw = (c) => (!c.tik.some(Boolean) ? 'zonder' : c.tik[4] || c.tik[5] ? 'drie' : c.tik[2] || c.tik[3] ? 'twee' : 'een');
  const kies = (soort, aantal) => schud(lijn.filter((c) => opbouw(c) === soort)).slice(0, aantal);
  const diensten = [...kies('een', 22), ...kies('twee', 14), ...kies('drie', 6), ...kies('zonder', 12)];

  const dagen = dagenVanDeMaand();
  const medewerkers = Array.from({ length: AANTAL_MEDEWERKERS }, (_, n) => EERSTE_MATRICULE + n);

  // Stap 1: per medewerker een ritme van werkdagen (D) en rustdagen (-).
  const rooster = new Map();
  for (const matric of medewerkers) {
    const codesPerDag = [];
    let werkt = kans(0.7);
    let rest = werkt ? geheel(1, 5) : geheel(1, 2);
    for (let d = 0; d < dagen.length; d += 1) {
      codesPerDag.push(werkt ? 'D' : '-');
      rest -= 1;
      if (rest === 0) {
        werkt = !werkt;
        rest = werkt ? geheel(3, 6) : geheel(1, 3);
      }
    }
    rooster.set(matric, codesPerDag);
  }

  // Stap 2: afwezigheden erover. Een blok vervangt de werkdagen; bij ziekte
  // ook de rustdagen.
  const blok = (matric, code, lengte, ookRust) => {
    const r = rooster.get(matric);
    const begin = geheel(0, dagen.length - lengte);
    for (let d = begin; d < begin + lengte; d += 1) if (ookRust || r[d] === 'D') r[d] = code;
  };
  const volgorde = schud(medewerkers);
  const zonderDienst = volgorde.slice(0, 2);
  const metVerlof = volgorde.slice(2, 12);
  const metZiekte = volgorde.slice(9, 14);
  const metTk = volgorde.slice(14, 17);
  for (const matric of metVerlof) blok(matric, 'BV', geheel(2, 9), false);
  for (const matric of metZiekte) blok(matric, 'Ziek', geheel(1, 13), true);
  for (const matric of metTk) blok(matric, 'Tk', geheel(1, 4), false);
  // Twee medewerkers rijden de hele maand niet: de ene is met verlof, de
  // andere is ziek gemeld.
  rooster.set(zonderDienst[0], rooster.get(zonderDienst[0]).map((c) => (c === 'D' ? 'BV' : c)));
  rooster.set(zonderDienst[1], rooster.get(zonderDienst[1]).map((c) => (c === 'D' ? 'Ziek' : c)));

  // Stap 3: feestdagen. Wie die dag zou rijden of rust had, krijgt meestal F;
  // een deel rijdt toch.
  for (const feestdag of FEESTDAGEN) {
    const d = dagen.indexOf(feestdag);
    if (d < 0) throw new Error(`Feestdag ${feestdag} valt buiten ${MAAND}.`);
    for (const matric of medewerkers) {
      const r = rooster.get(matric);
      if ((r[d] === 'D' || r[d] === '-') && kans(0.65)) r[d] = 'F';
    }
  }

  // Stap 4: per dag de diensten verdelen (elke dienst hoogstens één keer per
  // dag) en de overminuten en premies trekken.
  const vijfvoud = (van, tot) => geheel(van / 5, tot / 5) * 5;
  const invoer = [];
  const perDag = new Map(dagen.map((datum) => [datum, schud(diensten)]));
  for (const matric of medewerkers) {
    dagen.forEach((datum, d) => {
      const soort = rooster.get(matric)[d];
      const rij = { matric, datum, code: soort, overmin: 0, overminNacht: 0, overminExtra: 0, onvPremie: false };
      if (soort === 'D') {
        const dienst = perDag.get(datum).pop();
        if (!dienst) throw new Error(`Te weinig diensten voor ${datum}.`);
        rij.code = dienst.schrijfwijze;
        const worp = toeval();
        if (worp < 0.12) rij.overmin = vijfvoud(5, 90);
        else if (worp < 0.17) rij.overminNacht = vijfvoud(5, 60);
        else if (worp < 0.21) rij.overminExtra = vijfvoud(10, 120);
        else if (worp < 0.25) rij.overmin = -vijfvoud(5, 60);
        else if (worp < 0.27) { rij.overmin = vijfvoud(5, 45); rij.overminNacht = vijfvoud(5, 30); }
        else if (worp < 0.29) { rij.overmin = vijfvoud(5, 20); rij.overminNacht = -vijfvoud(25, 60); }
        else if (worp < 0.31) { rij.overmin = vijfvoud(10, 40); rij.overminExtra = -rij.overmin; }
        else if (worp < 0.35) rij.onvPremie = true;
      }
      invoer.push(rij);
    });
  }

  const verwacht = verwachteRijen(invoer, codes);
  const dekking = telDekking(invoer, verwacht, codes);
  for (const [geval, aantal] of Object.entries(dekking)) {
    if (aantal === 0) throw new Error(`De fixture dekt "${geval}" niet af. Kies een andere seed of pas de kansen aan.`);
  }

  return {
    _toelichting: [
      'VERZONNEN DATA. Geen enkele rij komt uit een echte dagadministratie.',
      `Gegenereerd door scripts/loonfixture-genereren.mjs met seed ${SEED}.`,
      `De maand ${MAAND}, de matricules ${EERSTE_MATRICULE} tot ${EERSTE_MATRICULE + AANTAL_MEDEWERKERS - 1} en het lidnummer ${LIDNR} bestaan niet.`,
      'Niet met de hand aanpassen: wijzig het script en draai het opnieuw. De test vergelijkt dit bestand met wat het script geeft.',
      'De verwachte rijen volgen uit de regels in het script (REGELS), niet uit shared/loon/easypay.ts.',
    ].join(' '),
    script: 'scripts/loonfixture-genereren.mjs',
    seed: SEED,
    maand: MAAND,
    lidnr: LIDNR,
    dekking,
    regels: REGELS,
    inputs: invoer,
    expected: verwacht,
  };
}

/** Telling per soort geval. Elk geval moet minstens één keer voorkomen. */
export function telDekking(invoer, verwacht, codes) {
  const code = (r) => codes.get(r.code.trim().toLowerCase());
  const isDienst = (r) => code(r).soort === 'lijn';
  const som = (r) => r.overmin + r.overminNacht + r.overminExtra;
  const tel = (lijst, fn) => lijst.filter(fn).length;
  const feest = new Set(FEESTDAGEN);
  return {
    'code - (geen dienst)': tel(invoer, (r) => r.code === '-'),
    'code BV': tel(invoer, (r) => r.code === 'BV'),
    'code Ziek': tel(invoer, (r) => r.code === 'Ziek'),
    'code F': tel(invoer, (r) => r.code === 'F'),
    'code Tk': tel(invoer, (r) => r.code === 'Tk'),
    'dienst met tiktijden, 1 deel': tel(invoer, (r) => isDienst(r) && code(r).tik[0] && !code(r).tik[2] && !code(r).tik[4]),
    'dienst met tiktijden, 2 delen': tel(invoer, (r) => isDienst(r) && code(r).tik[2] && !code(r).tik[4] && !code(r).tik[5]),
    'dienst met tiktijden, 3 delen': tel(invoer, (r) => isDienst(r) && Boolean(code(r).tik[4] || code(r).tik[5])),
    'dienst zonder tiktijden': tel(invoer, (r) => isDienst(r) && !code(r).tik.some(Boolean)),
    'overminuten gewoon': tel(invoer, (r) => r.overmin > 0),
    'overminuten nacht': tel(invoer, (r) => r.overminNacht > 0),
    'overminuten extra': tel(invoer, (r) => r.overminExtra > 0),
    'overminuten negatief': tel(invoer, (r) => r.overmin < 0 || r.overminNacht < 0 || r.overminExtra < 0),
    'som overminuten groter dan nul': tel(invoer, (r) => som(r) > 0),
    'som overminuten kleiner dan nul': tel(invoer, (r) => som(r) < 0),
    'som overminuten nul terwijl er minuten staan': tel(invoer, (r) => som(r) === 0 && (r.overmin !== 0 || r.overminNacht !== 0 || r.overminExtra !== 0)),
    'premie onvoorziene dienst': tel(invoer, (r) => r.onvPremie),
    'dienst op zaterdag': tel(invoer, (r) => isDienst(r) && weekdag(r.datum) === 6),
    'dienst op zondag': tel(invoer, (r) => isDienst(r) && weekdag(r.datum) === 0),
    'dienst op een feestdag': tel(invoer, (r) => isDienst(r) && feest.has(r.datum)),
    'verwachte dagrijen (TH)': tel(verwacht, (r) => r.typeInfo === 'TH'),
    'verwachte overminuten-rijen 40945': tel(verwacht, (r) => r.typeInfo === 'PRT' && r.typpre === OVERMIN_POSITIEF),
    'verwachte overminuten-rijen 40946': tel(verwacht, (r) => r.typeInfo === 'PRT' && r.typpre === OVERMIN_NEGATIEF),
  };
}

/** Vaste schrijfvorm: één rij per regel, zodat een diff leesbaar blijft. */
export function serialiseerFixture(fixture) {
  const { inputs, expected, ...kop } = fixture;
  const lijst = (rijen) => `[\n${rijen.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`;
  const kopTekst = JSON.stringify(kop, null, 2).replace(/\n}$/, '');
  return `${kopTekst},\n  "inputs": ${lijst(inputs)},\n  "expected": ${lijst(expected)}\n}\n`;
}

// --- Opdrachtregel ----------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tekst = serialiseerFixture(bouwFixture(fs.readFileSync(SEED_SQL, 'utf8')));
  const rel = path.relative(process.cwd(), FIXTURE);
  if (process.argv.includes('--controle')) {
    const staat = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : null;
    if (staat !== tekst) {
      console.error(`${rel} is niet wat het script geeft. Draai node scripts/loonfixture-genereren.mjs.`);
      process.exit(1);
    }
    console.log(`${rel} is gelijk aan wat het script geeft.`);
  } else {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, tekst);
    const f = JSON.parse(tekst);
    console.log(`${rel} geschreven: ${f.inputs.length} invoerrijen, ${f.expected.length} verwachte rijen, seed ${SEED}.`);
  }
}
