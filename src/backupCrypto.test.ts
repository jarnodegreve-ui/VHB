import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptOpensslCompatible, decryptOpensslCompatible } from '../api/backupCrypto';

describe('back-upversleuteling (OpenSSL-compatibel)', () => {
  const geheim = 'test-zin-alleen-voor-deze-test';

  it('rondgang encrypt → decrypt', () => {
    const blob = encryptOpensslCompatible('{"users":[1,2,3]}', geheim);
    expect(blob.subarray(0, 8).toString('ascii')).toBe('Salted__');
    expect(decryptOpensslCompatible(blob, geheim)).toBe('{"users":[1,2,3]}');
  });

  it('verkeerde zin faalt', () => {
    const blob = encryptOpensslCompatible('geheim', geheim);
    expect(() => decryptOpensslCompatible(blob, 'fout')).toThrow();
  });

  it('het geadverteerde openssl-commando kan onze bijlage écht ontsleutelen', () => {
    // Dit is het contract met de mail-instructie: als dit breekt, kan Jarno
    // zijn off-site kopie niet meer openen. Slaat over als openssl ontbreekt.
    let opensslAanwezig = true;
    try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { opensslAanwezig = false; }
    if (!opensslAanwezig) return;
    const dir = mkdtempSync(join(tmpdir(), 'vhb-backup-'));
    const enc = join(dir, 'b.json.enc');
    const out = join(dir, 'b.json');
    writeFileSync(enc, encryptOpensslCompatible('{"ok":true}', geheim));
    execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-in', enc, '-out', out, '-pass', `pass:${geheim}`]);
    expect(readFileSync(out, 'utf8')).toBe('{"ok":true}');
  });
});
