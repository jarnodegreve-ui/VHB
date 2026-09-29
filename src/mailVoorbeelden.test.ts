// @vitest-environment node
/**
 * De voorbeelden in Beheer › Mails mogen niet stil afwijken van de echte
 * mails (nr. 34, 29-09). Vroeger was api/_lib/mailVoorbeelden.ts een
 * handgeschreven kopie van de teksten in api/email.ts en de routes; het
 * weekoverzicht linkte in het voorbeeld al naar een ander adres dan de echte
 * mail. Nu heeft elke mail één bouwer, en het voorbeeld is die bouwer met
 * vaste gegevens. Deze tests bewaken dat het zo blijft:
 *
 *  1. elke mailsoort heeft een voorbeeld;
 *  2. de voorbeelden bouwen zelf geen mail op (geen mailOpbouw/bouwMail);
 *  3. geen route of cron bouwt zelf een mail op: dat gaat via een bouwer;
 *  4. elke bouwer wordt door een voorbeeld gebruikt;
 *  5. het voorbeeld "Wachtwoord vergeten" is de template die Supabase
 *     verstuurt (scripts/auth-mails.mjs), op de links na.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { voorbeeldMail } from '../api/_lib/mailVoorbeelden';
import { bouwVerlofBeslissingMail, portalUrl } from '../api/email';
import { bouwBackupWeekkopieMail, bouwZiekmeldingMail } from '../api/_lib/mailTeksten';
import { MAIL_SOORTEN } from '../shared/schemas/mail';
import { MAILS } from '../scripts/auth-mails.mjs';

const ROOT = path.resolve(__dirname, '..');
const lees = (pad: string) => fs.readFileSync(path.join(ROOT, pad), 'utf8');
const loop = (dir: string, uit: string[] = []): string[] => {
  for (const naam of fs.readdirSync(path.join(ROOT, dir))) {
    const p = path.join(dir, naam);
    if (fs.statSync(path.join(ROOT, p)).isDirectory()) loop(p, uit);
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) uit.push(p);
  }
  return uit;
};
/** Een aanroep van de lay-out, niet een import of een vermelding in commentaar. */
const BOUWT_ZELF = /^(?!\s*(\/\/|\*|\/\*)).*\b(mailOpbouw|bouwMail)\(/m;

describe('voorbeelden van de mails', () => {
  it('elke mailsoort heeft een voorbeeld met onderwerp, HTML en tekst', () => {
    for (const m of MAIL_SOORTEN) {
      const v = voorbeeldMail(m.soort);
      expect(v, m.soort).not.toBeNull();
      expect(v!.onderwerp.trim(), m.soort).not.toBe('');
      expect(v!.html, m.soort).toContain('<!DOCTYPE html>');
      expect(v!.text.trim(), m.soort).not.toBe('');
      expect(`${v!.onderwerp}\n${v!.text}`, m.soort).not.toContain(' — ');
    }
    expect(voorbeeldMail('bestaat-niet')).toBeNull();
  });

  it('de voorbeelden bouwen zelf geen mail op: ze roepen de bouwer van de echte mail aan', () => {
    expect(BOUWT_ZELF.test(lees('api/_lib/mailVoorbeelden.ts'))).toBe(false);
  });

  it('geen route of cron bouwt zelf een mail op', () => {
    // email.ts en mailTeksten.ts zijn de bouwers, mailLayout.ts de lay-out.
    // mailRoutes.ts bouwt de twee mails die een mens zelf schrijft (eigen
    // mail, omleiding mailen); die hebben geen voorbeeld in de lijst, hun
    // voorbeeld is de droge run vóór het versturen.
    const MAG = new Set(['api/email.ts', 'api/_lib/mailTeksten.ts', 'api/_lib/mailLayout.ts', 'api/_lib/mailRoutes.ts']);
    const zelf = loop('api').filter((p) => !MAG.has(p) && BOUWT_ZELF.test(lees(p)));
    expect(zelf).toEqual([]);
  });

  it('elke bouwer wordt door een voorbeeld gebruikt', () => {
    const voorbeelden = lees('api/_lib/mailVoorbeelden.ts');
    const bouwers = [...`${lees('api/email.ts')}\n${lees('api/_lib/mailTeksten.ts')}`.matchAll(/^export const (bouw\w+Mail)\b/gm)].map((m) => m[1]!);
    expect(bouwers.length).toBeGreaterThanOrEqual(11);
    expect(bouwers.filter((b) => !new RegExp(`\\b${b}\\(`).test(voorbeelden))).toEqual([]);
  });

  it('het voorbeeld is letterlijk wat de bouwer met dezelfde gegevens geeft', () => {
    expect(voorbeeldMail('ziekmelding')).toEqual(bouwZiekmeldingMail({ naam: 'Dirk Maes', periode: '02/09/2026 t/m 03/09/2026', gemeldDoor: 'Els Goossens', openDiensten: ['wo 2 sep, 4407', 'do 3 sep, 4408'] }));
    expect(voorbeeldMail('verlof-beslissing')).toEqual(bouwVerlofBeslissingMail({ recipientName: 'Jan', decidedByName: 'Els Goossens', typeLabel: 'Betaald verlof', startDate: '2026-10-06', endDate: '2026-10-10', action: 'rejected', reden: "Die week zijn er al te veel collega's vrij. Probeer de week erna." }));
    // Het weekoverzicht linkt naar hetzelfde adres als de echte mail.
    expect(voorbeeldMail('weekoverzicht')!.html).toContain(`href="${portalUrl()}/?view=beheer-debug"`);
  });

  it('"Wachtwoord vergeten" is de template die Supabase verstuurt, op de links na', () => {
    const v = voorbeeldMail('wachtwoord')!;
    const url = portalUrl();
    // Supabase vult {{ .SiteURL }} pas bij het versturen in; de lay-out toont
    // het adres in de voet zonder https://, wat ze bij een sjabloon niet kan.
    const template = MAILS.recovery.html
      .replaceAll('>{{ .SiteURL }}</a>', `>${url.replace(/^https?:\/\//, '')}</a>`)
      .replaceAll('{{ .SiteURL }}', url)
      .replaceAll('{{ .ConfirmationURL }}', url);
    expect(v.html).toBe(template);
    expect(v.onderwerp).toBe(MAILS.recovery.onderwerp);
  });
});

describe('bouwers', () => {
  it('de wekelijkse back-up noemt de bestandsnaam ongewijzigd in het commando', () => {
    const m = bouwBackupWeekkopieMail({ filename: 'vhb-backup-2026-09-27.json', dag: '2026-09-27' });
    expect(m.text).toContain('-in vhb-backup-2026-09-27.json.enc -out vhb-backup-2026-09-27.json');
  });
});
