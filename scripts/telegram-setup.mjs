#!/usr/bin/env node
/**
 * Registreert de Telegram-webhook voor de VHB-portaal-bot (setWebhook) en
 * toont de status (getWebhookInfo). Eénmalig draaien na het zetten van de
 * env-vars, en opnieuw na een domeinwissel.
 *
 * Gebruik:
 *   node scripts/telegram-setup.mjs [pad-naar-.env] [webhook-url]
 *
 * Leest TELEGRAM_BOT_TOKEN en TELEGRAM_WEBHOOK_SECRET uit het environment,
 * of uit een .env-bestand (bv. .env.production.local van `vercel env pull`).
 * Print het token zelf nooit.
 */
import { readFileSync } from 'node:fs';

const envPad = process.argv[2];
const url = process.argv[3] ?? 'https://vhbportaal.com/api/telegram/webhook';

const env = { ...process.env };
if (envPad) {
  for (const regel of readFileSync(envPad, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)="?([^"\r\n]*)"?\s*$/.exec(regel.trim());
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
}

// Waarden uit `vercel env pull` kunnen eindigen op een letterlijke "\n"
// (ge-escapete newline van een gepipete `vercel env add`) — de server trimt
// de échte newline bij het lezen, dus hier dezelfde staart wegstrippen.
const schoon = (v) => String(v ?? '').replace(/(\\n|\\r|\s)+$/g, '').trim();
const token = schoon(env.TELEGRAM_BOT_TOKEN);
const secret = schoon(env.TELEGRAM_WEBHOOK_SECRET);
if (!token || !secret) {
  console.error('TELEGRAM_BOT_TOKEN en TELEGRAM_WEBHOOK_SECRET zijn nodig — zet ze in het environment of geef een .env-bestand als eerste argument.');
  process.exit(1);
}

const api = async (methode, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${methode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
};

const set = await api('setWebhook', {
  url,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
});
console.log('setWebhook:', set.ok ? `OK → ${url}` : `FOUT — ${set.description ?? 'onbekend'}`);

const info = await api('getWebhookInfo');
console.log('geregistreerde url:', info.result?.url || '(leeg)');
console.log('wachtende updates:', info.result?.pending_update_count ?? 0);
if (info.result?.last_error_message) {
  console.log('laatste fout:', new Date((info.result.last_error_date ?? 0) * 1000).toISOString(), '—', info.result.last_error_message);
}
