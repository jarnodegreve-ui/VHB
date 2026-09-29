import type { StatusDef } from './status.js';

/**
 * Status van een regel in het verzendlog (Beheer › Mails), voor server en
 * client (nr. 5 en 25, 29-09).
 *
 * `mail_log` heeft geen statuskolom: een regel is `gelukt` of niet, en `fout`
 * zegt waarom niet. Dat blijft zo (geen migratie); de status wordt hier uit
 * die twee afgeleid, op één plek, zodat het scherm en de server dezelfde
 * woorden gebruiken.
 *
 * Een reeks (eigen mail, omleiding mailen) schrijft haar regel VÓÓR ze begint,
 * met `MAIL_LOG_NIET_AFGEROND` als reden, en werkt hem na afloop bij. Breekt de
 * functie onderweg af, dan blijft die regel staan: "Onderbroken", met het
 * aantal ontvangers waarvoor de verzending bedoeld was. Vroeger stond de
 * logregel ná de lus en liet een afgebroken verzending niets achter.
 *
 * Bewust een eigen module en niet in shared/status.ts: die zit in de
 * startbundel (primitives.tsx leest ze), het verzendlog is één adminscherm.
 */

/** Reden in `fout` zolang een reeks niet is afgerond. Begint met het woord
 *  waaraan `mailLogStatus` de regel herkent. */
export const MAIL_LOG_NIET_AFGEROND = 'onderbroken: de verzending is niet afgerond, mogelijk is een deel vertrokken';

/** Zo lang geldt een niet-afgeronde regel als "bezig". Een functie leeft
 *  hoogstens 60 s (vercel.json); daarna is ze afgebroken. */
export const MAIL_LOG_BEZIG_MS = 90_000;

export const MAIL_LOG_STATUS = {
  verstuurd: { label: 'Verstuurd', toon: 'goed' },
  bezig: { label: 'Bezig', toon: 'info' },
  // Een fout is rood, zoals een afgewezen aanvraag (nr. 25): vroeger was
  // "Mislukt" dezelfde stille amber pil als "Uitgeschakeld".
  mislukt: { label: 'Mislukt', toon: 'gevaar' },
  // Niemand weet hoeveel er vertrokken zijn: vraagt een blik, geen paniek.
  onderbroken: { label: 'Onderbroken', toon: 'waarschuwing' },
  uitgeschakeld: { label: 'Uitgeschakeld', toon: 'neutraal' },
  'alleen-gelogd': { label: 'Alleen gelogd', toon: 'neutraal' },
} as const satisfies Record<string, StatusDef>;
export type MailLogStatus = keyof typeof MAIL_LOG_STATUS;

/** Statussen die iemand moeten opvallen: een gekleurde pil. De rest is een
 *  rusttoestand en krijgt de stille pil met alleen een puntje. */
export const mailLogVraagtAandacht = (status: MailLogStatus): boolean => status === 'mislukt' || status === 'onderbroken';

export function mailLogStatus(rij: { gelukt: boolean; fout?: string | null; verzondenOp?: string | null }, nu: number = Date.now()): MailLogStatus {
  if (rij.gelukt) return 'verstuurd';
  const fout = rij.fout ?? '';
  if (/^onderbroken/i.test(fout)) {
    const sinds = rij.verzondenOp ? nu - Date.parse(rij.verzondenOp) : Number.NaN;
    return Number.isFinite(sinds) && sinds >= 0 && sinds < MAIL_LOG_BEZIG_MS ? 'bezig' : 'onderbroken';
  }
  if (/uitgeschakeld/i.test(fout)) return 'uitgeschakeld';
  if (/SMTP niet/i.test(fout)) return 'alleen-gelogd';
  return 'mislukt';
}

/** Wat er naast de pil staat: de reden bij een fout, een vaste uitleg bij een
 *  onderbroken verzending, niets bij een rusttoestand. */
export function mailLogToelichting(status: MailLogStatus, fout?: string | null): string {
  if (status === 'onderbroken') return 'Niet afgerond; onbekend hoeveel er vertrokken zijn.';
  if (status === 'mislukt') return fout ?? '';
  return '';
}

/** De uitkomst van een reeks als reden voor het log; null = alles vertrokken.
 *  Alleen aantallen, nooit adressen (het log bevat bewust geen adressen). */
export function mailReeksReden(u: { aantal: number; mislukt: number; nietGeprobeerd: number; onzeker: number; mocked: boolean; overgeslagen: boolean }): string | null {
  if (u.overgeslagen) return 'uitgeschakeld in Beheer › Mails';
  if (u.mocked) return 'SMTP niet geconfigureerd, mail alleen gelogd';
  const delen = [
    u.mislukt > 0 ? `${u.mislukt} van ${u.aantal} mislukt` : '',
    u.nietGeprobeerd > 0 ? `${u.nietGeprobeerd} van ${u.aantal} niet verstuurd (tijd op)` : '',
    u.onzeker > 0 ? `${u.onzeker} van ${u.aantal} onzeker (geen antwoord van de mailserver)` : '',
  ].filter(Boolean);
  return delen.length > 0 ? delen.join(', ') : null;
}
