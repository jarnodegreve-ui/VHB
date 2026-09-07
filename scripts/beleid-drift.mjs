#!/usr/bin/env node
/**
 * Beleidsdrift-check (verbeterronde 07-09, nr. 10): vergelijkt de live
 * beveiligingsstand van Supabase (RLS per tabel, policies, grants,
 * definer-functies, via public.security_snapshot() uit
 * supabase/2026-09-08_security_snapshot.sql) met het gecommitte snapshot.
 * Migraties draaien met de hand in de SQL Editor; dit is de controle dat
 * wat live staat nog is wat de repo zegt. Nachtelijk in CI
 * (.github/workflows/beleid-drift.yml); verschil = exit 1 = rode run = mail.
 *
 *   node scripts/beleid-drift.mjs                      → vergelijken (exit 1 bij drift)
 *   node scripts/beleid-drift.mjs --update             → snapshot herschrijven
 *   node scripts/beleid-drift.mjs --omgeving staging   → idem tegen staging
 *
 * Env (productie): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, lokaal het
 * makkelijkst via `node --env-file=.env.local scripts/beleid-drift.mjs`.
 * Staging: STAGING_SUPABASE_URL + STAGING_SERVICE_ROLE_KEY, vergeleken met
 * supabase/beleid-snapshot-staging.json (bestaat dat niet, dan wordt de
 * check overgeslagen: staging-snapshot is optioneel).
 *
 * Geen dependencies (fetch + fs). Sleutels komen nooit in de uitvoer; van
 * de URL wordt alleen de host getoond. De zuivere logica staat in
 * scripts/beleid-drift-kern.mjs (getest in src/lib/beleidDrift.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { formatteerDiff, heeftDrift, normaliseer, samenvatting, serialiseer, vergelijk } from './beleid-drift-kern.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const MIGRATIE = 'supabase/2026-09-08_security_snapshot.sql';
const PRODUCTIE_REF = 'nbupdofxuoxvgeiedzkk';

const args = process.argv.slice(2);
const update = args.includes('--update');
const omgevingIdx = args.indexOf('--omgeving');
const omgeving = omgevingIdx >= 0 ? args[omgevingIdx + 1] : 'productie';
const onbekend = args.filter((a, i) => a !== '--update' && a !== '--omgeving' && !(omgevingIdx >= 0 && i === omgevingIdx + 1));
if (onbekend.length || !['productie', 'staging'].includes(omgeving ?? '')) {
  console.error('Gebruik: node scripts/beleid-drift.mjs [--update] [--omgeving productie|staging]');
  process.exit(2);
}

const staging = omgeving === 'staging';
const ENV_URL = staging ? 'STAGING_SUPABASE_URL' : 'SUPABASE_URL';
const ENV_KEY = staging ? 'STAGING_SERVICE_ROLE_KEY' : 'SUPABASE_SERVICE_ROLE_KEY';
const SNAPSHOT = path.join(ROOT, 'supabase', staging ? 'beleid-snapshot-staging.json' : 'beleid-snapshot.json');
const snapshotRel = path.relative(ROOT, SNAPSHOT);

const url = (process.env[ENV_URL] ?? '').trim().replace(/\/+$/, '');
const key = (process.env[ENV_KEY] ?? '').trim();
if (!url || !key) {
  console.error(`Ontbrekende env: ${ENV_URL} en ${ENV_KEY} (lokaal: node --env-file=.env.local scripts/beleid-drift.mjs).`);
  process.exit(2);
}
if (staging && url.includes(PRODUCTIE_REF)) {
  console.error('Geweigerd: --omgeving staging met de productie-URL. Zet STAGING_SUPABASE_URL op het staging-project.');
  process.exit(2);
}

// Staging zonder gecommit snapshot: bewust overslaan, niet falen. De
// productie-snapshot is verplicht (zie onder).
if (staging && !update && !fs.existsSync(SNAPSHOT)) {
  console.log(`Geen ${snapshotRel}: staging-check overgeslagen (maak er een met --omgeving staging --update).`);
  process.exit(0);
}

const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return '(ongeldige URL)';
  }
})();

/** Live document via PostgREST-RPC; alleen de service-role heeft execute. */
async function haalSnapshot() {
  let res;
  try {
    res = await fetch(`${url}/rest/v1/rpc/security_snapshot`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`Geen verbinding met ${host}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tekst = await res.text();
  /** @type {any} */
  let body = null;
  try {
    body = JSON.parse(tekst);
  } catch {
    // geen JSON (bv. HTML-foutpagina): hieronder afgehandeld op status
  }
  if (res.status === 404 || body?.code === 'PGRST202') {
    throw new Error(`Functie public.security_snapshot() ontbreekt op ${host}: migratie ${MIGRATIE} nog niet gedraaid.`);
  }
  if (res.status === 401 || res.status === 403 || body?.code === '42501') {
    throw new Error(`Toegang geweigerd op ${host} (${res.status}): is ${ENV_KEY} de service_role-sleutel van dit project?`);
  }
  if (!res.ok) {
    throw new Error(`RPC mislukt op ${host}: HTTP ${res.status} ${body?.message ?? body?.code ?? ''}`.trim());
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`Onverwacht antwoord van ${host}: geen jsonb-object.`);
  }
  return normaliseer(body);
}

/** Diff ook in de GitHub-job-samenvatting, als die er is (CI). */
function schrijfSamenvatting(kop, tekst) {
  const bestand = process.env.GITHUB_STEP_SUMMARY;
  if (!bestand) return;
  try {
    fs.appendFileSync(bestand, `### ${kop}\n\n\`\`\`\n${tekst}\n\`\`\`\n\n`);
  } catch {
    // samenvatting is een extraatje; de log heeft de diff al
  }
}

try {
  const live = await haalSnapshot();

  if (update) {
    fs.writeFileSync(SNAPSHOT, serialiseer(live));
    console.log(`Snapshot geschreven: ${snapshotRel} (${samenvatting(live)}, bron ${host}). Commit dit bestand.`);
    process.exit(0);
  }

  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`${snapshotRel} ontbreekt: maak eerst een snapshot met --update en commit het.`);
    process.exit(1);
  }
  let vorige;
  try {
    vorige = normaliseer(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')));
  } catch (e) {
    console.error(`${snapshotRel} is onleesbaar (${e instanceof Error ? e.message : String(e)}): maak hem opnieuw met --update.`);
    process.exit(1);
  }

  const diff = vergelijk(vorige, live);
  if (!heeftDrift(diff)) {
    console.log(`Geen drift op ${host}: live stand = ${snapshotRel} (${samenvatting(live)}).`);
    process.exit(0);
  }

  const tekst = formatteerDiff(diff);
  const telling = `${diff.toegevoegd.length} toegevoegd, ${diff.verwijderd.length} verwijderd, ${diff.gewijzigd.length} gewijzigd`;
  console.error(`DRIFT op ${host} t.o.v. ${snapshotRel}: ${telling}\n`);
  console.error(tekst);
  console.error(
    `\nBewust (nieuwe migratie gedraaid)? Draai \`node scripts/beleid-drift.mjs${staging ? ' --omgeving staging' : ''} --update\` en commit ${snapshotRel}.` +
      '\nOnbedoeld? Zet de live stand terug met de migraties in supabase/ en controleer wie toegang tot de SQL Editor heeft.',
  );
  schrijfSamenvatting(`Beleidsdrift ${omgeving} (${telling})`, tekst);
  process.exit(1);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
