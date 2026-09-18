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

  it('verkeerde zin levert nooit de originele inhoud op', () => {
    // Toetst de eigenschap die telt, niet het mechanisme. Dit was
    // `expect(...).toThrow()`, en dat is met AES-CBC zónder authenticatietag
    // wankel: een verkeerde sleutel levert een blok willekeurige bytes op, en
    // die vormen bij toeval geldige PKCS#7-padding in grofweg één op de 256
    // gevallen. Dan gooit decipher.final() niets en viel de test om, zoals op
    // 18-09 in CI gebeurde bij een PR die deze code niet eens raakte.
    //
    // Gooien mág (dat is het gebruikelijke gedrag), maar stil iets anders
    // teruggeven mag óók; wat niet mag is dat de klartekst eruit komt.
    const blob = encryptOpensslCompatible('geheim', geheim);
    let uit: string | null = null;
    try {
      uit = decryptOpensslCompatible(blob, 'fout');
    } catch {
      // Het gewone pad: ongeldige padding.
    }
    expect(uit).not.toBe('geheim');
  });

  it('een aangetast bestand levert nooit de originele inhoud op', () => {
    // Zelfde eigenschap, andere aanval: één omgeklapte bit in de ciphertext.
    // CBC zonder authenticatietag merkt dat niet betrouwbaar op, dus ook hier
    // is "gooit een fout" geen houdbare belofte. Wél houdbaar: er komt niet
    // stilletjes de juiste back-up uit.
    const blob = encryptOpensslCompatible('{"users":[1,2,3]}', geheim);
    const aangetast = Buffer.from(blob);
    aangetast[aangetast.length - 1] ^= 0x01;
    let uit: string | null = null;
    try {
      uit = decryptOpensslCompatible(aangetast, geheim);
    } catch {
      // Ook hier is gooien het gewone pad.
    }
    expect(uit).not.toBe('{"users":[1,2,3]}');
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
