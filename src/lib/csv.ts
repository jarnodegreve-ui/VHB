/**
 * CSV-export aan de clientkant — één regel voor alle exports.
 *
 * csvCel: aanhalingstekens verdubbeld én een formule-prefix (= + - @, tab,
 * CR) geneutraliseerd met een apostrof, zodat Excel/Numbers bij het openen
 * geen formule of DDE uitvoert uit gebruikersinvoer (toestelnaam in het
 * activiteitenlog, opmerking, chauffeursnaam uit de Excel…). Zelfde regel als
 * veilig() aan de serverkant voor de xlsx-export (controle-ronde 27-08,
 * bevinding 29).
 */
export const csvCel = (value: unknown): string => {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** Rijen → CSV-tekst (Windows-vriendelijk: \r\n, zoals Excel verwacht). */
export const csvTekst = (rijen: unknown[][], scheiding = ','): string =>
  rijen.map((rij) => rij.map(csvCel).join(scheiding)).join('\r\n');
