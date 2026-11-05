/**
 * Uurwissel (zomer- en wintertijd) in Brussel, zonder bibliotheek.
 *
 * De planning rekent in klokminuten sinds middernacht van de dienstdag en
 * telt voor "de dag ervoor" of "de dag erna" vlak 24 uur bij. In de nacht
 * waarin de klok verspringt klopt dat niet: van zaterdag 27 op zondag 28
 * maart 2027 duurt de nacht 23 uur (02:00 wordt 03:00), van 30 op 31 oktober
 * 2027 25 uur. Wie klokminuten van twee verschillende dagen met elkaar
 * vergelijkt, haalt het verschil hier (controle-ronde 04-11, punt 35).
 * Zuiver en tijdzone-onafhankelijk: de Brusselse klok komt uit Intl, niet uit
 * de machine.
 */

const BRUSSEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Brussels', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

const offsetOfNull = (isoDag: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDag ?? '').trim());
  if (!m) return null;
  const middagUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (Number.isNaN(middagUtc)) return null;
  const deel: Record<string, string> = {};
  for (const p of BRUSSEL.formatToParts(new Date(middagUtc))) deel[p.type] = p.value;
  const lokaal = Date.UTC(Number(deel.year), Number(deel.month) - 1, Number(deel.day), Number(deel.hour), Number(deel.minute));
  return Math.round((lokaal - middagUtc) / 60000);
};

/** UTC-verschuiving van Brussel in minuten op een ISO-dag ('JJJJ-MM-DD'): 60
 *  in de winter, 120 in de zomer. Gemeten op 12:00 UTC van die dag, nooit bij
 *  de wissel zelf (die valt om 01:00 UTC). 0 voor wat geen datum is. */
export const brusselOffsetMin = (isoDag: string): number => offsetOfNull(isoDag) ?? 0;

/** Hoeveel minuten de klok tussen twee dagen versprong: +60 als de latere dag
 *  zomertijd heeft en de eerdere niet (de nacht ertussen duurde 23 uur), -60
 *  andersom, anders 0. Klokminuten van de latere dag plus 24 uur min dit
 *  getal zijn vergelijkbaar met klokminuten van de eerdere dag. Is een van
 *  beide geen datum, dan is er geen correctie (0), nooit een verzonnen uur. */
export const uurwisselMin = (eerder: string, later: string): number => {
  const a = offsetOfNull(eerder);
  const b = offsetOfNull(later);
  return a === null || b === null ? 0 : b - a;
};
