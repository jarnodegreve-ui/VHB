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
 */

/** 'HH:MM' → minuten sinds middernacht; busvak-uren tot 47; null bij vuil. */
export function eindtijdMinuten(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
}

export function dienstGereden(
  dienst: { date: string; delen: ReadonlyArray<{ endTime: string }> },
  vandaag: string,
  nuMin: number,
): boolean {
  if (dienst.date < vandaag) return true;
  if (dienst.date > vandaag) return false;
  const eindes = dienst.delen.map((d) => eindtijdMinuten(d.endTime)).filter((n): n is number => n !== null);
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
