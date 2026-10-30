#!/usr/bin/env node
/**
 * Bouwt het schema op in de LOKALE Supabase (supabase/config.toml), uit
 * supabase/volgorde.json. Migraties draaien op productie en staging met de
 * hand in de SQL Editor; dit script is het bewijs dat diezelfde bestanden,
 * in die volgorde, een lege database volledig opbouwen.
 *
 *   node scripts/db-opbouwen.mjs --controle   alleen het manifest nakijken
 *                                             (geen database nodig)
 *   node scripts/db-opbouwen.mjs              manifest nakijken + alles draaien
 *   node scripts/db-opbouwen.mjs --twee-keer  daarna alles nog eens: elk
 *                                             bestand moet idempotent zijn
 *
 * Praat alleen met de databasecontainer van de lokale Supabase (docker exec),
 * nooit met een URL: het kan productie of staging dus niet raken.
 * Zonder dependencies, zoals de andere scripts hier.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTAINER = 'supabase_db_vhb-portaal-lokaal';

const manifest = JSON.parse(readFileSync(join(ROOT, 'supabase/volgorde.json'), 'utf8'));
const volgorde = manifest.volgorde;
const overgeslagen = Object.keys(manifest.overgeslagen);

/** Elk schemabestand staat precies één keer in het manifest, en omgekeerd. */
const controleerManifest = () => {
  const fouten = [];
  const opSchijf = [
    ...readdirSync(join(ROOT, 'supabase')).filter((f) => f.endsWith('.sql')).map((f) => `supabase/${f}`),
    // De enige uit staging/ die schema is; seed.sql is testdata.
    'supabase/staging/000_tabellen_buiten_repo.sql',
  ];
  const bekend = new Set([...volgorde, ...overgeslagen]);
  for (const f of opSchijf) {
    if (!bekend.has(f)) fouten.push(`${f} staat niet in supabase/volgorde.json: zet het onderaan in "volgorde".`);
  }
  for (const f of bekend) {
    if (!existsSync(join(ROOT, f))) fouten.push(`${f} staat in supabase/volgorde.json maar bestaat niet.`);
  }
  const gezien = new Set();
  for (const f of [...volgorde, ...overgeslagen]) {
    if (gezien.has(f)) fouten.push(`${f} staat twee keer in supabase/volgorde.json.`);
    gezien.add(f);
  }
  return fouten;
};

const draai = (bestand) => {
  const r = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
    { input: readFileSync(join(ROOT, bestand)), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.error) return `docker niet bereikbaar: ${r.error.message}`;
  if (r.status !== 0) return (r.stderr || r.stdout || `psql stopte met code ${r.status}`).trim();
  return null;
};

const fouten = controleerManifest();
if (fouten.length > 0) {
  console.error(fouten.join('\n'));
  process.exit(1);
}
console.log(`Manifest in orde: ${volgorde.length} bestanden in volgorde, ${overgeslagen.length} bewust overgeslagen.`);
if (process.argv.includes('--controle')) process.exit(0);

const rondes = process.argv.includes('--twee-keer') ? 2 : 1;
for (let ronde = 1; ronde <= rondes; ronde += 1) {
  for (const bestand of volgorde) {
    const fout = draai(bestand);
    if (fout) {
      console.error(`\nRonde ${ronde}, ${bestand} is mislukt:\n${fout}`);
      if (ronde === 2) console.error('\nDe eerste keer liep dit bestand door: het is dus niet idempotent.');
      process.exit(1);
    }
  }
  console.log(`Ronde ${ronde}: ${volgorde.length} bestanden zonder fout.`);
}

// Sinds 30-10-2026 geeft Supabase een nieuwe tabel in public geen
// Data-API-rechten meer, en setup_security.sql zet die stand als eerste ook
// hier. Dit bewijst dat ze er echt is: een verse tabel zonder grant mag voor
// service_role niet leesbaar zijn en voor anon en authenticated geen enkel
// recht dragen (dat laatste komt van 2026-08-02_anon_rechten_intrekken.sql,
// dat ook truncate, references, trigger en maintain uit de defaults haalt).
// Zonder deze stand zouden
// de databasetests ook slagen op een migratie die haar grants vergeet, en
// zou precies die migratie in een vers project de API breken.
const proef = spawnSync(
  'docker',
  ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c',
    "drop table if exists public.__rechten_proef; create table public.__rechten_proef (id int);" +
    // Een lijst rechten in has_table_privilege betekent "minstens één ervan".
    " select has_table_privilege('anon', 'public.__rechten_proef', 'select, insert, update, delete, truncate, references, trigger, maintain')" +
    " or has_table_privilege('authenticated', 'public.__rechten_proef', 'select, insert, update, delete, truncate, references, trigger, maintain')" +
    " or has_table_privilege('service_role', 'public.__rechten_proef', 'select');" +
    ' drop table public.__rechten_proef;'],
  { encoding: 'utf8' },
);
if (proef.status !== 0 || !['t', 'f'].includes(proef.stdout.trim())) {
  console.error(`De rechtenproef is niet te draaien:\n${(proef.stderr || proef.stdout).trim()}`);
  process.exit(1);
}
if (proef.stdout.trim() === 't') {
  console.error(
    'Een verse tabel krijgt hier nog default Data-API-rechten, terwijl Supabase die sinds 30-10-2026 niet meer geeft.\n' +
    'Staat het blok "alter default privileges for role postgres" nog bovenaan supabase/setup_security.sql,\n' +
    'en staan de default-revokes voor anon en authenticated nog in supabase/2026-08-02_anon_rechten_intrekken.sql?',
  );
  process.exit(1);
}
console.log('Rechtenproef: een verse tabel is zonder grant onleesbaar voor anon, authenticated en service_role.');

// Het register (supabase/2026-10-05_schema_migraties.sql): elk bestand uit de
// lijst moet er na het draaien in staan. Een nieuwe migratie die zichzelf niet
// inschrijft, zou op productie nooit als "nog te draaien" opvallen.
const register = spawnSync(
  'docker',
  ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', 'select bestand from public.schema_migraties'],
  { encoding: 'utf8' },
);
if (register.status !== 0) {
  console.error(`Het register public.schema_migraties is niet te lezen:\n${register.stderr.trim()}`);
  process.exit(1);
}
const ingeschreven = new Set(register.stdout.split('\n').filter(Boolean));
const nietIngeschreven = volgorde.map((f) => f.replace(/^supabase\//, '')).filter((f) => !ingeschreven.has(f));
if (nietIngeschreven.length > 0) {
  console.error(
    `Deze migraties schrijven zichzelf niet in het register in:\n  ${nietIngeschreven.join('\n  ')}\n` +
    "Zet vóór de commit van elk bestand:\n  insert into public.schema_migraties (bestand) values ('<bestandsnaam>') on conflict (bestand) do nothing;",
  );
  process.exit(1);
}
console.log(`Register: ${ingeschreven.size} migraties ingeschreven.`);

// De REST-laag leest het schema uit een cache: zonder dit ziet ze de tabellen
// van daarnet nog niet wanneer de tests meteen hierna starten.
spawnSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-c', "notify pgrst, 'reload schema';"]);
