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
 * Wat alleen het Dienstoverzicht en de server nodig hebben (de melding bij
 * gelijke begin- en eindtijd) staat daarom apart, in shared/gelijkeTijden.ts.
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

/**
 * Begin en einde van één dienst-deel in minuten sinds middernacht van de
 * dienstdag (beslissing Jarno 29-09, nummer 28a):
 *
 * - een einde vóór de start in gewone uren is over middernacht (+24 u):
 *   22:00 tot 06:00 loopt tot 30:00 (8 uur), 16:00 tot 00:00 tot 24:00;
 * - busvak-uren gelden zoals ze er staan: 22:00 tot 30:00 is 8 uur, 08:00 tot
 *   32:00 is een etmaal;
 * - gelijke begin- en eindtijd (08:00 tot 08:00, ook 00:00 tot 00:00) is
 *   ONGELDIG, net als een deel zonder twee leesbare tijden: null. Zonder
 *   expliciete volgende-dagcontext is dat geen etmaal. Het deel blijft wel
 *   zichtbaar (de planningsopbouw, het rooster en de agenda laten het door);
 *   het telt alleen nergens als duur, venster of rustregel. De ingang weigert
 *   het (formulier, Excel-import, POST /api/services);
 * - evenmin een venster: een einde dat ook na +24 u niet na de start ligt.
 *   Dat kan alleen met een start in busvak-uren en een einde in gewone uren
 *   (24:00 tot 00:00 en 30:00 tot 06:00 zijn leeg, 24:30 tot 00:00 zou -30
 *   minuten zijn). Ook null, en ook geweigerd aan de ingang.
 *
 * Eén regel voor elke plek die de duur of het venster van een deel rekent: de
 * server (Maandoverzicht en rapporten, api/helpers.ts), de app (Mijn dag, het
 * dashboard en de geplande uren op het rooster via shiftWindowMinutes in
 * src/lib/shiftTime.ts), de kerncijfers van het Dienstoverzicht, de
 * maandprint, de rustregel (shared/ruilRust.ts) en "gereden"
 * (shared/dienstGereden.ts). src/dienstMinuten.test.ts legt vast wat elke
 * plek geeft. Op 29-09 had de productie geen enkel deel met gelijke tijden en
 * geen nachtdeel in gewone uren: de regel verandert geen cijfer van toen, ze
 * zet de randgevallen dicht.
 */
export const deelVenster = (start: unknown, eind: unknown): { start: number; end: number } | null => {
  const s = parseHHMM(start);
  const e = parseHHMM(eind);
  if (s === null || e === null) return null;
  const end = e < s ? e + 1440 : e;
  return end > s ? { start: s, end } : null;
};

/** Duur van één dienst-deel in minuten (`deelVenster`), altijd meer dan 0;
 *  null zonder twee leesbare tijden of zonder venster (gelijke begin- en
 *  eindtijd, of een einde dat niet na de start ligt). */
export const deelMinuten = (start: unknown, eind: unknown): number | null => {
  const v = deelVenster(start, eind);
  return v ? v.end - v.start : null;
};
