#!/usr/bin/env node
/**
 * Backfill: de oude enkelvoudige omleidings-PDF naar de bijlagenlijst
 * (controle-ronde 29-09, nr. 30, stap 1).
 *
 * Vóór 25-09 hing er bij een omleiding hoogstens één PDF, op `<id>.pdf` in
 * de bucket `diversions`, met de kolom "pdfUrl" als marker. Sindsdien hangt
 * een PDF op `<id>-<slot>.pdf` en zegt de kolom `bijlagen` wat er hangt. Een
 * oude rij verhuist pas bij de eerstvolgende upload of verwijdering op die
 * omleiding, dus omleidingen die niemand aanraakt houden de overgangslaag in
 * de code (omleidingBijlagen, de legacy-parameter in api/storage.ts) eeuwig
 * in leven. Dit script verhuist ze in één keer.
 *
 * Per omleiding met een oude PDF:
 *   1. `<id>.pdf` verhuist naar `<id>-1.pdf`;
 *   2. `bijlagen` wordt [{ slot: 1, filename: "omleiding.pdf", sizeBytes }];
 *   3. "pdfUrl" gaat op null.
 * Met de functies die het portaal zelf gebruikt
 * (verplaatsDiversionLegacyBijlage en zetDiversionBijlagen uit
 * api/storage.ts), niet met een kopie ervan. De chauffeur ziet vóór en na
 * dezelfde bijlage met dezelfde naam.
 *
 * STANDAARD EEN DROGE RUN: het script telt en toont wat er zou gebeuren en
 * schrijft niets. Echt schrijven vraagt de vlag --schrijf.
 *
 * Idempotent: een tweede run vindt niets meer te verhuizen. Strandt een run
 * tussen stap 1 en 2, dan ziet de volgende run "lijst-herstellen" en maakt
 * hij het af.
 *
 * Draaien (tsx, want api/storage.ts is TypeScript). De sleutels komen uit de
 * env, nooit uit een argument; van de URL toont het script alleen de host.
 *
 *   Staging, droog en daarna echt:
 *     STAGING_SUPABASE_URL=https://bzxnkjswfhaiqqbxbmky.supabase.co \
 *     STAGING_SERVICE_ROLE_KEY=… \
 *       npx tsx scripts/omleiding-pdf-backfill.mjs --omgeving staging
 *     (zelfde commando met --schrijf erachter)
 *
 *   Productie, droog en daarna echt (.env.local met SUPABASE_URL en
 *   SUPABASE_SERVICE_ROLE_KEY van productie):
 *     npx tsx --env-file=.env.local scripts/omleiding-pdf-backfill.mjs --omgeving productie
 *     npx tsx --env-file=.env.local scripts/omleiding-pdf-backfill.mjs --omgeving productie --schrijf
 *
 * Draai het op een rustig moment: een planner die op hetzelfde ogenblik een
 * PDF bij dezelfde omleiding zet, kan met het script botsen. De volgende
 * droge run toont dan wat er nog te doen is.
 *
 * WAT DE UITVOER MOET TONEN VOOR STAP 2 (de overgangslaag schrappen) VEILIG
 * IS: een droge run ná de schrijf-run, op productie én op staging, met
 *     Te verhuizen           0
 *     Lijst te herstellen    0
 *     Conflict               0
 *     Ongeldig id            0
 * en de slotregel "Stap 2 is veilig". "Marker zonder bestand" mag boven nul
 * staan: bij die omleidingen hangt er geen PDF meer, ze tonen vandaag ook
 * geen bijlage. Wordt er later een oude back-up teruggezet, draai het script
 * dan opnieuw: een back-up van vóór de backfill brengt de markers terug.
 *
 * Exitcode: 0 = gelukt, 1 = er mislukte iets bij het schrijven,
 * 2 = verkeerd gebruik of ontbrekende env.
 */
import { ACTIE_UITLEG, planBackfill, stap2Veilig, telPlan, voerBackfillUit } from './omleiding-pdf-backfill-kern.mjs';

const PRODUCTIE_REF = 'nbupdofxuoxvgeiedzkk';
const GEBRUIK = 'Gebruik: npx tsx scripts/omleiding-pdf-backfill.mjs --omgeving staging|productie [--schrijf]';

const args = process.argv.slice(2);
const omgevingIdx = args.indexOf('--omgeving');
const omgeving = omgevingIdx >= 0 ? args[omgevingIdx + 1] : undefined;
const schrijf = args.includes('--schrijf');
const onbekend = args.filter((a, i) => a !== '--schrijf' && a !== '--omgeving' && !(omgevingIdx >= 0 && i === omgevingIdx + 1));
if (onbekend.length || !['productie', 'staging'].includes(omgeving ?? '')) {
  console.error(GEBRUIK);
  console.error('De omgeving is verplicht, zodat het script nooit per ongeluk tegen de verkeerde database draait.');
  process.exit(2);
}

const staging = omgeving === 'staging';
const ENV_URL = staging ? 'STAGING_SUPABASE_URL' : 'SUPABASE_URL';
const ENV_KEY = staging ? 'STAGING_SERVICE_ROLE_KEY' : 'SUPABASE_SERVICE_ROLE_KEY';
const url = (process.env[ENV_URL] ?? '').trim().replace(/\/+$/, '');
const key = (process.env[ENV_KEY] ?? '').trim();
if (!url || !key) {
  console.error(`Ontbrekende env: ${ENV_URL} en ${ENV_KEY}.`);
  process.exit(2);
}
if (staging && url.includes(PRODUCTIE_REF)) {
  console.error('Geweigerd: --omgeving staging met de productie-URL. Zet STAGING_SUPABASE_URL op het staging-project.');
  process.exit(2);
}
if (!staging && !url.includes(PRODUCTIE_REF)) {
  console.error(`Geweigerd: --omgeving productie, maar ${ENV_URL} is niet het productieproject. Gebruik --omgeving staging met de STAGING_-variabelen.`);
  process.exit(2);
}

// api/db.ts leest SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY bij het laden:
// eerst de gekozen omgeving zetten, dan pas de portaalcode importeren.
process.env.SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;
// api/db.ts meldt "configuration missing" als de anon-sleutel ontbreekt. Het
// script werkt altijd met de service-role-client (db = supabaseAdmin), dus
// die melding zou hier alleen verwarren.
process.env.SUPABASE_ANON_KEY ||= key;
const { DIVERSIONS_BUCKET, getDiversionsData, lijstBijlageBestanden, verplaatsDiversionLegacyBijlage, zetDiversionBijlagen } = await import('../api/storage.ts');

const host = (() => { try { return new URL(url).host; } catch { return 'onbekende host'; } })();
console.log(`Omleidings-PDF's naar de bijlagenlijst, ${omgeving} (${host})`);
console.log(schrijf ? 'SCHRIJFT: bestanden verhuizen en rijen bijwerken.' : 'Droge run: er wordt niets geschreven. Voeg --schrijf toe om het uit te voeren.');

const leesStand = async () => {
  // Eén lijst van de hele bucket: gooit bij een fout, dus een storing in
  // Storage leidt nooit tot "bestand ontbreekt".
  const [omleidingen, bestanden] = await Promise.all([getDiversionsData(), lijstBijlageBestanden(DIVERSIONS_BUCKET)]);
  return planBackfill(omleidingen, bestanden);
};

const toonTelling = (plan) => {
  const n = telPlan(plan);
  const regel = (label, aantal) => console.log(`  ${label.padEnd(24)} ${String(aantal).padStart(4)}`);
  console.log(`\nOmleidingen in totaal: ${plan.length}`);
  regel('Al met bijlagenlijst', n.klaar);
  regel('Zonder PDF', n['geen-pdf']);
  regel('Te verhuizen', n.verhuizen);
  regel('Lijst te herstellen', n['lijst-herstellen']);
  regel('Conflict', n.conflict);
  regel('Ongeldig id', n['ongeldig-id']);
  regel('Marker zonder bestand', n['marker-zonder-bestand']);
};

const toonRegels = (plan) => {
  const teTonen = plan.filter((r) => r.actie !== 'klaar' && r.actie !== 'geen-pdf');
  if (teTonen.length === 0) return;
  console.log('\nPer omleiding:');
  for (const r of teTonen) console.log(`  ${r.actie.padEnd(22)} ${r.id}  “${r.titel}”\n    ${ACTIE_UITLEG[r.actie]}`);
};

let exit = 0;
try {
  const plan = await leesStand();
  toonTelling(plan);
  toonRegels(plan);

  if (!schrijf) {
    console.log(stap2Veilig(plan)
      ? '\nStap 2 is veilig: geen enkele omleiding leunt nog op de oude sleutel.'
      : '\nStap 2 is NIET veilig: er leunen nog omleidingen op de oude sleutel. Draai het script met --schrijf en kijk de conflicten na.');
  } else {
    console.log('\nUitvoeren:');
    const uit = await voerBackfillUit(plan, {
      verplaats: verplaatsDiversionLegacyBijlage,
      zetLijst: zetDiversionBijlagen,
      meld: (tekst) => console.log(tekst),
    });
    console.log(`\n${uit.verhuisd} verhuisd, ${uit.hersteld} lijst hersteld, ${uit.mislukt.length} mislukt.`);
    if (uit.mislukt.length > 0) exit = 1;

    // De stand opnieuw lezen: wat het script zegt is wat er nu echt staat.
    const na = await leesStand();
    console.log('\nStand na de run:');
    toonTelling(na);
    toonRegels(na);
    console.log(stap2Veilig(na)
      ? '\nStap 2 is veilig: geen enkele omleiding leunt nog op de oude sleutel.'
      : '\nStap 2 is NIET veilig: zie de regels hierboven.');
  }
} catch (err) {
  console.error('\nAfgebroken, er is niets (meer) geschreven:', err?.message || err);
  exit = 1;
}
process.exit(exit);
