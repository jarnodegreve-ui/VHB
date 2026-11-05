/**
 * Uurwissel (zomer- en wintertijd) in Brussel, zonder bibliotheek.
 *
 * De planning rekent in klokminuten sinds middernacht van de dienstdag; een
 * busvak-tijd boven 24:00 ("26:16") is de klok van de nacht erna. In de nacht
 * waarin de klok verspringt is "24 uur erbij" fout: van zaterdag 27 op zondag
 * 28 maart 2027 duurt de nacht 23 uur (02:00 wordt 03:00), van 30 op 31
 * oktober 2027 25 uur. Wie tijden van twee dagen vergelijkt, zet ze hier
 * eerst om naar echte tijdstippen (controle-ronde 04-11, punt 35). Zuiver en
 * tijdzone-onafhankelijk: de Brusselse klok komt uit Intl, niet uit de
 * machine.
 *
 * Lezing van een kloktijd: wat op de klok staat, ook boven 24:00. "27:00" op
 * zaterdag is 03:00 op zondag, ook in de wisselnacht. Een kloktijd die er die
 * nacht niet is (02:30 op 28-03-2027) schuift een uur op naar 03:30; een
 * dubbele kloktijd (02:30 op 31-10-2027) is de eerste keer. Zo lezen de
 * rustregel (shared/ruilRust.ts) en de aftelling op Mijn dag
 * (src/lib/shiftTime.ts) een busvak-tijd op dezelfde manier.
 */

const BRUSSEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Brussels', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

const UUR = 3_600_000;

/** De Brusselse klok op een tijdstip, als getal: Date.UTC van de klokvelden
 *  ("alsof de klok UTC was"), handig om met een gevraagde kloktijd te vergelijken. */
const klokOp = (epochMs: number): number => {
  const deel: Record<string, string> = {};
  for (const p of BRUSSEL.formatToParts(new Date(epochMs))) deel[p.type] = p.value;
  return Date.UTC(Number(deel.year), Number(deel.month) - 1, Number(deel.day), Number(deel.hour), Number(deel.minute));
};

/** UTC-verschuiving van Brussel in minuten op een tijdstip: 60 in de winter, 120 in de zomer. */
const offsetOp = (epochMs: number): number => Math.round((klokOp(epochMs) - epochMs) / 60000);

/**
 * Een klokminuut van een dienstdag ('JJJJ-MM-DD') als echt tijdstip (epoch-ms)
 * op de Brusselse klok. Minuten boven 1440 zijn de dag(en) erna (busvak).
 * null voor wat geen ISO-dag of geen getal is.
 */
export const tijdstipBrussel = (isoDag: string, minuut: number): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDag ?? '').trim());
  if (!m || !Number.isFinite(minuut)) return null;
  const dagen = Math.floor(minuut / 1440);
  const klok = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dagen, 0, minuut - dagen * 1440);
  if (Number.isNaN(klok)) return null;
  // Eerste gok met de verschuiving van drie uur eerder (vóór een eventuele
  // wissel die nacht), dan nakijken of de klok op dat tijdstip klopt.
  let t = klok - offsetOp(klok - 3 * UUR) * 60000;
  if (klokOp(t) !== klok) {
    const t2 = klok - offsetOp(t) * 60000;
    // Klopt de tweede gok, dan was het een gewone kloktijd na de wissel;
    // anders bestaat de kloktijd die nacht niet (het gat in maart) en ligt t
    // een uur later op de klok, precies de bedoeling.
    if (klokOp(t2) === klok) t = t2;
  }
  return t;
};

/** Minuten van de ene kloktijd naar de andere, elk op zijn eigen dienstdag;
 *  negatief als `tot` eerder ligt. null als een van beide geen ISO-dag is. */
export const minutenTussenBrussel = (vanDag: string, vanMinuut: number, totDag: string, totMinuut: number): number | null => {
  const a = tijdstipBrussel(vanDag, vanMinuut);
  const b = tijdstipBrussel(totDag, totMinuut);
  return a === null || b === null ? null : Math.round((b - a) / 60000);
};
