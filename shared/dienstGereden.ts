/**
 * Wanneer is een dienst "gereden"? (J, 24-09)
 *
 * Eén regel voor client én server: een dienst is gereden zodra het laatste
 * deel zijn eindtijd voorbij is, op de kalenderdag van de dienst. Vóór die
 * eindtijd (ook al is het eerste deel al voorbij) is ze "vandaag, bezig of
 * nog te rijden". Rooster telt een gereden dienst bij het verleden, de
 * ruilknop verdwijnt, en de server weigert er een nieuwe ruilaanvraag voor.
 *
 * Eindtijden staan in busvak-notatie: "26:16" = 02:16 de dag erna, dus een
 * eindtijd boven 24:00 telt gewoon door in minuten sinds middernacht van de
 * dienstdag. Alles is kalender- en klokvrij: de aanroeper geeft `vandaag`
 * (ISO, Brussel) en `nuMin` (minuten sinds middernacht, Brussel) mee.
 *
 * Het einde van een deel volgt `deelVenster` (Jarno 29-09, nummer 28e): een
 * einde vóór de start in gewone uren valt op de volgende dag. 22:00 tot 06:00
 * eindigt dus om 30:00 en is op haar eigen dienstdag nooit gereden (vroeger
 * vanaf 06:00 's ochtends, 16 uur voor ze begon), 16:00 tot 00:00 eindigt om
 * 24:00 (vroeger de hele dag gereden). Busvak-notatie verandert niet. Een
 * deel zonder venster (gelijke begin- en eindtijd, of een einde dat ook na
 * +24 u niet na de start ligt) is ongeldig en telt, zoals vroeger, alleen met
 * zijn eindtijd; ook een deel zonder leesbare begintijd.
 */
import { deelVenster, parseHHMM } from './busvakTijd.js';

/** 'HH:MM' → minuten sinds middernacht; busvak-uren tot 47; null bij vuil.
 *  De gedeelde parser (shared/busvakTijd.ts) onder de naam van deze regel. */
export const eindtijdMinuten: (t: string) => number | null = parseHHMM;

/** Einde van één deel in minuten sinds middernacht van de dienstdag. */
const eindeVanDeel = (d: { startTime?: string; endTime: string }): number | null =>
  deelVenster(d.startTime, d.endTime)?.end ?? eindtijdMinuten(d.endTime);

export function dienstGereden(
  dienst: { date: string; delen: ReadonlyArray<{ startTime?: string; endTime: string }> },
  vandaag: string,
  nuMin: number,
): boolean {
  if (dienst.date < vandaag) return true;
  if (dienst.date > vandaag) return false;
  const eindes = dienst.delen.map(eindeVanDeel).filter((n): n is number => n !== null);
  // Zonder leesbare eindtijd weten we het niet: dan niet gereden (veilige kant:
  // de ruilknop blijft, de server laat het door zoals vroeger).
  if (eindes.length === 0) return false;
  return Math.max(...eindes) <= nuMin;
}

/** Minuten sinds middernacht in Brussel voor een tijdstip. */
export function brusselseMinuten(nu: Date = new Date()): number {
  const [h, m] = nu.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  return (h % 24) * 60 + m;
}
