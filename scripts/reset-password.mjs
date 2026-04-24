import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.TARGET_EMAIL;
const NEW_PASSWORD = process.env.NEW_PASSWORD;

if (!SUPABASE_URL || !SERVICE_KEY || !EMAIL || !NEW_PASSWORD) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TARGET_EMAIL, NEW_PASSWORD');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalize = (s) => s?.trim().toLowerCase();

const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) {
  console.error('List error:', listErr.message);
  process.exit(1);
}

const user = page.users.find((u) => normalize(u.email) === normalize(EMAIL));
if (!user) {
  console.error(`No auth user found for ${EMAIL}`);
  console.log('Available emails:', page.users.map((u) => u.email).join(', '));
  process.exit(1);
}

console.log(`Found user: ${user.email} (id=${user.id})`);

const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
  password: NEW_PASSWORD,
});
if (updateErr) {
  console.error('Update error:', updateErr.message);
  process.exit(1);
}

console.log(`Password successfully reset for ${user.email}`);
