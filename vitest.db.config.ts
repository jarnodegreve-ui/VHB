import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

// Databasetests (`npm run db:test`): de code tegen een échte, lokale Supabase
// in plaats van tegen nagebootste antwoorden. De sleutels komen uit de
// draaiende lokale stack (`npm run db:start`), nooit uit een .env: deze tests
// kunnen productie of staging dus niet raken.
// De CLI-versie staat op één plek: het script `db:supabase` in package.json.
const SUPABASE = 'npm run -s db:supabase --';

const lokaleEnv = (): Record<string, string> => {
  let uit: string;
  try {
    uit = execSync(`${SUPABASE} status -o env`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('De lokale Supabase draait niet. Start hem met `npm run db:start` en bouw het schema op met `npm run db:opbouwen`.');
  }
  const env = Object.fromEntries(
    uit.split('\n').map((regel) => regel.match(/^([A-Z0-9_]+)="?(.*?)"?$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1], m[2]]),
  );
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.API_URL ?? '')) {
    throw new Error(`Geweigerd: de databasetests draaien alleen tegen een lokale Supabase, niet tegen "${env.API_URL}".`);
  }
  return {
    SUPABASE_URL: env.API_URL,
    SUPABASE_ANON_KEY: env.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
  };
};

process.env.TZ = 'Europe/Brussels';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['dbtests/**/*.test.ts'],
    globals: true,
    // Eén database voor alle bestanden: na elkaar, niet door elkaar.
    fileParallelism: false,
    env: { TZ: 'Europe/Brussels', VERCEL: '1', ...lokaleEnv() },
  },
});
