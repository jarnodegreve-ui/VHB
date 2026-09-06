#!/usr/bin/env node
/**
 * Staging: Supabase-Auth-accounts voor de seed-gebruikers aanmaken en aan
 * users.authid koppelen (supabase/staging/README.md, stap 4).
 *
 * Leest de gebruikers uit de staging-database zelf (e-mail @staging.vhb.test,
 * zoals supabase/staging/seed.sql ze aanmaakt) — de seed is de enige bron,
 * hier staat geen tweede namenlijst. Per gebruiker:
 *   - bestaat er nog geen Auth-account op dat adres → aanmaken (e-mail
 *     bevestigd, geen mail);
 *   - bestaat het al → wachtwoord opnieuw zetten;
 *   - users.authid = de Auth-uid (zoals api/middleware.ts bij de eerste
 *     aanmelding zou doen; de RLS-helpers uit 2026-09-05_users_authid.sql
 *     kijken hier eerst naar).
 * Idempotent: nogmaals draaien verandert niets, behalve dat het wachtwoord
 * weer op STAGING_WACHTWOORD staat.
 *
 * Draaien (waarden uit het staging-project, nooit die van productie):
 *   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
 *   STAGING_SERVICE_ROLE_KEY=… \
 *   STAGING_WACHTWOORD='…' \
 *     node scripts/staging-accounts.mjs
 *
 * Vangrails: weigert de productie-ref, weigert adressen buiten
 * @staging.vhb.test en eist een wachtwoord van minstens 10 tekens
 * (WACHTWOORD_MIN in shared/schemas/constanten.ts).
 */
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.STAGING_SUPABASE_URL;
const KEY = process.env.STAGING_SERVICE_ROLE_KEY;
const WACHTWOORD = process.env.STAGING_WACHTWOORD;

const PRODUCTIE_REF = 'nbupdofxuoxvgeiedzkk';
const STAGING_DOMEIN = '@staging.vhb.test';
const WACHTWOORD_MIN = 10;

if (!URL_ || !KEY || !WACHTWOORD) {
  console.error('Ontbrekende env: STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE_KEY, STAGING_WACHTWOORD');
  process.exit(1);
}
if (URL_.includes(PRODUCTIE_REF)) {
  console.error(`Geweigerd: ${URL_} is het productieproject. Dit script is alleen voor staging.`);
  process.exit(1);
}
if (WACHTWOORD.length < WACHTWOORD_MIN) {
  console.error(`STAGING_WACHTWOORD moet minstens ${WACHTWOORD_MIN} tekens hebben (zelfde regel als het portaal).`);
  process.exit(1);
}

const admin = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const normalize = (s) => String(s ?? '').trim().toLowerCase();

// 1) Seed-gebruikers uit de staging-database.
const { data: users, error: usersErr } = await admin
  .from('users')
  .select('id, name, email, role, authid')
  .ilike('email', `%${STAGING_DOMEIN}`)
  .order('id');
if (usersErr) {
  console.error('users lezen mislukt:', usersErr.message);
  process.exit(1);
}
if (!users?.length) {
  console.error(`Geen gebruikers met ${STAGING_DOMEIN} gevonden — draai eerst supabase/staging/seed.sql.`);
  process.exit(1);
}

// 2) Bestaande Auth-accounts (staging is klein; één pagina volstaat).
const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) {
  console.error('Auth-accounts lezen mislukt:', listErr.message);
  process.exit(1);
}
const authByEmail = new Map(page.users.map((u) => [normalize(u.email), u]));

let aangemaakt = 0;
let bijgewerkt = 0;
let gekoppeld = 0;
let fouten = 0;

for (const user of users) {
  const email = normalize(user.email);
  if (!email.endsWith(STAGING_DOMEIN)) continue; // dubbele vangrail op de ilike

  let authUser = authByEmail.get(email);
  if (!authUser) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: WACHTWOORD,
      email_confirm: true,
      user_metadata: { staging: true, naam: user.name },
    });
    if (error) {
      console.error(`  ✗ ${email}: aanmaken mislukt — ${error.message}`);
      fouten++;
      continue;
    }
    authUser = data.user;
    authByEmail.set(email, authUser);
    aangemaakt++;
  } else {
    const { error } = await admin.auth.admin.updateUserById(authUser.id, { password: WACHTWOORD, email_confirm: true });
    if (error) {
      console.error(`  ✗ ${email}: wachtwoord zetten mislukt — ${error.message}`);
      fouten++;
      continue;
    }
    bijgewerkt++;
  }

  // 3) Koppeling users.authid (alleen schrijven als ze nog niet klopt).
  if (user.authid !== authUser.id) {
    const { error } = await admin.from('users').update({ authid: authUser.id }).eq('id', user.id);
    if (error) {
      console.error(`  ✗ ${email}: authid koppelen mislukt — ${error.message} (migratie 2026-09-05_users_authid.sql gedraaid?)`);
      fouten++;
      continue;
    }
    gekoppeld++;
  }
  console.log(`  ✓ ${user.role.padEnd(9)} ${email}`);
}

console.log(`\nKlaar: ${aangemaakt} aangemaakt, ${bijgewerkt} wachtwoord vernieuwd, ${gekoppeld} authid gekoppeld, ${fouten} fout(en).`);
console.log(`Inloggen op de preview met een van de adressen hierboven en STAGING_WACHTWOORD.`);
process.exit(fouten ? 1 : 0);
