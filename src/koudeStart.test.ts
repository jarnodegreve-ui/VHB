// @vitest-environment node
/**
 * Koude start (ronde 3): zware pakketten mogen in api/ en shared/ alleen nog
 * via `await import()` binnenkomen, in de route of functie die ze gebruikt.
 * Eén statische import bovenaan een module in het auth-pad en elke koude
 * start van de functie leest het pakket weer in (xlsx alleen al ±1 MB).
 * `import type` mag: dat verdwijnt bij het bouwen.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const ZWAAR = ['xlsx', 'pdf-lib', 'nodemailer', 'web-push', 'source-map-js', 'dotenv'];

const loop = (dir: string, uit: string[] = []): string[] => {
  for (const naam of fs.readdirSync(dir)) {
    const p = path.join(dir, naam);
    if (fs.statSync(p).isDirectory()) loop(p, uit);
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) uit.push(p);
  }
  return uit;
};

describe('koude start van de API', () => {
  it('geen statische import van een zwaar pakket in api/ of shared/', () => {
    const fouten: string[] = [];
    for (const bestand of [...loop(path.join(ROOT, 'api')), ...loop(path.join(ROOT, 'shared'))]) {
      const bron = fs.readFileSync(bestand, 'utf8');
      for (const m of bron.matchAll(/^import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
        if (!m[1] && ZWAAR.includes(m[2]!)) fouten.push(`${path.relative(ROOT, bestand)}: ${m[2]}`);
      }
    }
    expect(fouten).toEqual([]);
  });

  it('getVapidPublicKey geeft de sleutel zonder web-push te laden', async () => {
    const vorige = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
    process.env.VAPID_PUBLIC_KEY = 'publiek';
    process.env.VAPID_PRIVATE_KEY = 'geheim';
    try {
      const { getVapidPublicKey } = await import('../api/push');
      // Met de oude code gooide dit: web-push weigert deze nepsleutels in
      // setVapidDetails. Nu is het gewoon de env-var.
      expect(getVapidPublicKey()).toBe('publiek');
      delete process.env.VAPID_PRIVATE_KEY;
      expect(getVapidPublicKey()).toBeNull();
    } finally {
      if (vorige.pub === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = vorige.pub;
      if (vorige.priv === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = vorige.priv;
    }
  });
});
