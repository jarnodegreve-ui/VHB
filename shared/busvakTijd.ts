/**
 * Dé parser voor een kloktijd in busvak-notatie: 'UU:MM' → minuten sinds
 * middernacht van de dienstdag. Uren vanaf 24 zijn geldig ("26:16" = 02:16
 * de nacht erna), tot en met 47:59; daarboven is het geen tijd maar vuil.
 * Spaties vooraan en achteraan tellen niet, een uur mag één cijfer hebben
 * ("7:05"), de minuten altijd twee.
 *
 * Twee strengheden, omdat de code er vóór de samenvoeging ook twee had en
 * ze voor dezelfde invoer een ander antwoord geven (src/tijdParsers.test.ts
 * legt de verschillen vast):
 *
 * - `parseHHMM` LEEST een tijd en kijkt alleen naar het begin: "07:05:00"
 *   (met seconden) is 07:05. Voor wat uit de planning of het dienstoverzicht
 *   komt en getoond of gerekend wordt.
 * - `parseHHMMStrikt` KEURT een tijd en eist dat er niets achter staat:
 *   "07:05:00" is ongeldig. Voor wat een dienst-deel geldig maakt (de opbouw
 *   van de planning uit het dienstoverzicht, de kerncijfers ervan).
 *
 * Zonder imports: deze module zit in de startbundel (src/lib/shiftTime.ts).
 */
const BEGIN = /^(\d{1,2}):(\d{2})/;
const GEHEEL = /^(\d{1,2}):(\d{2})$/;

const lees = (t: unknown, patroon: RegExp): number | null => {
  const m = patroon.exec(String(t ?? '').trim());
  if (!m) return null;
  const uur = Number(m[1]);
  const min = Number(m[2]);
  if (uur > 47 || min > 59) return null;
  return uur * 60 + min;
};

/** 'UU:MM' → minuten; busvak-uren tot 47:59; null bij vuil. Leest het begin. */
export const parseHHMM = (t: unknown): number | null => lees(t, BEGIN);

/** Zoals `parseHHMM`, maar met niets achter de minuten. */
export const parseHHMMStrikt = (t: unknown): number | null => lees(t, GEHEEL);
