/**
 * Lijnen van een omleiding (verzoek Jarno 09-09). Het veld `line` blijft één
 * tekst in de database en de API (compatibel met wat er staat: "801",
 * "883, 884", "Alle"), maar de app rekent met een lijst. Zod-vrij, zodat
 * zowel `api/` als `src/` dit kunnen laden zonder de schil te verzwaren.
 *
 * Canonieke vorm: nummers gescheiden door ", " ("883, 884"); "Alle" is het
 * speciale geval "geldt voor alle lijnen".
 */

export const ALLE_LIJNEN = 'Alle';

/** Is dit de "alle lijnen"-waarde (ongeacht hoofdletters of spaties)? */
export const isAlleLijnen = (line: string | null | undefined): boolean =>
  String(line ?? '').trim().toLowerCase() === ALLE_LIJNEN.toLowerCase();

/**
 * Tekst → lijst lijnnummers. Accepteert wat mensen typen: komma's, puntkomma's,
 * schuine strepen, "&", "en", losse spaties, en een voorvoegsel "lijn(en)".
 * Ontdubbelt met behoud van volgorde. "Alle" (in welke vorm ook) → ['Alle'].
 */
export const lijnenVan = (line: string | null | undefined): string[] => {
  const ruw = String(line ?? '').trim();
  if (!ruw) return [];
  if (isAlleLijnen(ruw)) return [ALLE_LIJNEN];
  const zonderPrefix = ruw.replace(/^\s*lijn(?:en)?\s*:?\s*/i, '');
  const delen = zonderPrefix
    .split(/\s*(?:,|;|\/|&|\+|\ben\b|\s)\s*/i)
    .map((d) => d.trim())
    .filter(Boolean);
  const uit: string[] = [];
  for (const d of delen) {
    if (isAlleLijnen(d)) return [ALLE_LIJNEN];
    if (!uit.some((x) => x.toLowerCase() === d.toLowerCase())) uit.push(d);
  }
  return uit;
};

/** Lijst → canonieke tekst voor opslag ("883, 884"); leeg → ''. */
export const lijnenNaarTekst = (lijnen: readonly string[]): string => {
  const schoon = lijnenVan(lijnen.join(', '));
  return schoon.join(', ');
};

/**
 * Leesbaar label: "Lijn 801", "Lijnen 883 en 884", "Lijnen 50, 58 en 82",
 * "Alle lijnen". Voor badges, ondertitels, mails en Telegram.
 */
export const lijnLabel = (line: string | null | undefined): string => {
  const lijnen = lijnenVan(line);
  if (lijnen.length === 0) return 'Lijn onbekend';
  if (isAlleLijnen(lijnen[0])) return 'Alle lijnen';
  if (lijnen.length === 1) return `Lijn ${lijnen[0]}`;
  const laatste = lijnen[lijnen.length - 1];
  return `Lijnen ${lijnen.slice(0, -1).join(', ')} en ${laatste}`;
};

/** Hoort dit lijnnummer bij deze omleiding? "Alle" matcht altijd. */
export const raaktLijn = (line: string | null | undefined, lijn: string): boolean => {
  const lijnen = lijnenVan(line);
  if (lijnen.length > 0 && isAlleLijnen(lijnen[0])) return true;
  return lijnen.some((l) => l.toLowerCase() === lijn.trim().toLowerCase());
};
