import { aantal as tel } from './format';
import { leesFout } from './fouten';

/**
 * Wat het scherm doet met het antwoord van een verzending (nr. 5 en 11).
 *
 * Een reeks mails kan helemaal, deels of niet vertrokken zijn, en soms weet
 * niemand het (geen antwoord van de server). Vroeger had elke fout de knop
 * "Opnieuw proberen", die de VOLLEDIGE verzending herstartte: wie de mail al
 * had, kreeg hem nog eens. Nu:
 *  - alles vertrokken: een toast, klaar;
 *  - deels: het scherm zegt hoeveel er vertrokken zijn en biedt aan om
 *    ALLEEN de resterende adressen te versturen;
 *  - geen antwoord (netwerk, time-out, serverfout): geen knop om opnieuw te
 *    versturen, wel de verwijzing naar het verzendlog.
 */
export type MailUitkomst = {
  aantal: number;
  gelukt: number;
  mislukt: number;
  nietGeprobeerd?: number;
  onzeker?: number;
  mocked?: boolean;
  overgeslagen?: boolean;
  /** Adressen die zeker niet vertrokken zijn. */
  resterend?: string[];
  /** Adressen waarvan niet zeker is of de mail vertrok. */
  onzekerAdressen?: string[];
  bijlagen?: number;
  /** Bijlagen van het record die niet geladen konden worden (omleiding). */
  ontbrekendeBijlagen?: string[];
};

export type MailBeoordeling =
  | { soort: 'klaar'; tekst: string; toon: 'success' | 'info' | 'error' }
  | { soort: 'deels'; titel: string; regels: string[]; resterend: string[] };

const opsomming = (adressen: string[], max = 6) => `${adressen.slice(0, max).join(', ')}${adressen.length > max ? ` en nog ${adressen.length - max}` : ''}`;

/** "haltes.pdf" ging niet mee: dat hoort de planner te weten, ook als elke
 *  mail vertrokken is (nr. 11). */
const bijlagenRegel = (u: MailUitkomst) =>
  u.ontbrekendeBijlagen && u.ontbrekendeBijlagen.length > 0 ? `Niet meegegaan, bestand niet gevonden: ${u.ontbrekendeBijlagen.join(', ')}.` : '';

/** `werkwoord` = "Mail verstuurd" of "Omleiding gemaild". */
export function beoordeelUitkomst(u: MailUitkomst, werkwoord: string): MailBeoordeling {
  const bijlagen = bijlagenRegel(u);
  if (u.overgeslagen) return { soort: 'klaar', tekst: 'Mail staat uit in Beheer › Mails, er is niets verstuurd.', toon: 'info' };
  if (u.mocked) return { soort: 'klaar', tekst: `Mail gelogd voor ${tel(u.aantal, 'ontvanger', 'ontvangers')} (geen SMTP ingesteld).`, toon: 'success' };
  const resterend = u.resterend ?? [];
  const onzeker = u.onzekerAdressen ?? [];
  const nietVertrokken = u.mislukt + (u.nietGeprobeerd ?? 0);
  if (nietVertrokken === 0 && onzeker.length === 0 && (u.onzeker ?? 0) === 0) {
    return { soort: 'klaar', tekst: [`${werkwoord} naar ${tel(u.aantal, 'ontvanger', 'ontvangers')}.`, bijlagen].filter(Boolean).join(' '), toon: bijlagen ? 'error' : 'success' };
  }
  const regels: string[] = [];
  if (nietVertrokken > 0) {
    regels.push(resterend.length > 0
      ? `${tel(nietVertrokken, 'adres heeft', 'adressen hebben')} de mail niet gekregen: ${opsomming(resterend)}.`
      : `${tel(nietVertrokken, 'adres heeft', 'adressen hebben')} de mail niet gekregen.`);
  }
  if (onzeker.length > 0 || (u.onzeker ?? 0) > 0) {
    const n = onzeker.length || (u.onzeker ?? 0);
    regels.push(`Bij ${tel(n, 'adres', 'adressen')} is niet zeker of de mail vertrok${onzeker.length > 0 ? ` (${opsomming(onzeker)})` : ''}. Die krijgen de mail niet opnieuw; vraag het na.`);
  }
  if (bijlagen) regels.push(bijlagen);
  return { soort: 'deels', titel: `Verstuurd naar ${u.gelukt} van ${u.aantal}`, regels, resterend };
}

/**
 * Kwam er geen bruikbaar antwoord van de server? Dan weet het scherm niet
 * wat er vertrokken is: een netwerkfout of time-out (geen status) en elke
 * serverfout (5xx). Een 4xx is wél een antwoord: de server heeft geweigerd
 * en niets verstuurd.
 */
export function isZonderAntwoord(err: unknown): boolean {
  const { status } = leesFout(err);
  return status === undefined || status >= 500;
}
