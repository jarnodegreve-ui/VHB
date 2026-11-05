import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

/**
 * Versleuteling van de wekelijkse off-site back-upmail (30/07): de bijlage
 * bevatte de volledige personeelsdata leesbaar in admin-mailboxen (én in het
 * Resend-dashboard). Nu AES-256-CBC in het OpenSSL-bestandsformaat, zodat
 * Jarno zonder speciale tooling kan ontsleutelen met één commando:
 *
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
 *     -in vhb-backup-….json.enc -out vhb-backup-….json
 *
 * (OpenSSL vraagt dan zelf om de wachtwoordzin — BACKUP_PASSPHRASE.)
 *
 * Formaat: "Salted__" + 8 bytes salt + ciphertext; sleutel en IV komen uit
 * PBKDF2-SHA256 met 200.000 iteraties — exact wat `openssl enc -pbkdf2
 * -iter 200000` verwacht.
 */
const OPENSSL_MAGIC = Buffer.from("Salted__", "ascii");
const PBKDF2_ITERATIES = 200_000;

const deriveKeyIv = (passphrase: string, salt: Buffer) => {
  const keyIv = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIES, 48, "sha256");
  return { key: keyIv.subarray(0, 32), iv: keyIv.subarray(32, 48) };
};

export const encryptOpensslCompatible = (plaintext: string, passphrase: string): Buffer => {
  const salt = randomBytes(8);
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([OPENSSL_MAGIC, salt, encrypted]);
};

/** Alleen voor tests/restore-tooling: het spiegelbeeld van encrypt. */
export const decryptOpensslCompatible = (blob: Buffer, passphrase: string): string => {
  if (!blob.subarray(0, 8).equals(OPENSSL_MAGIC)) {
    throw new Error("Geen OpenSSL-Salted__-bestand.");
  }
  const salt = blob.subarray(8, 16);
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(blob.subarray(16)), decipher.final()]).toString("utf8");
};
