import { isValidHHMM } from "../storage.js";

/**
 * Tijden in een handmatige planning-save (beveiligingsscan 01-10). De import
 * en de heropbouw toetsen elke tijd al met `isValidHHMM` (uur 0 tot 47 voor de
 * busvak-notatie, minuten 0 tot 59); deze route schreef de rijen ongezien
 * weg, en een start of einde als "Infinity:00" liet daarna de agenda-feed van
 * die chauffeur hangen. Een lege tijd blijft toegestaan (een rij zonder
 * tijden bestaat, de feed slaat ze over). Een rij die al zo opgeslagen staat
 * en ongewijzigd meekomt, valt er buiten: de client stuurt altijd de hele
 * lijst, en één oude rij mag niet elke latere save tegenhouden.
 */
export const planningTijdFout = (rijen: readonly any[], vorige: readonly any[]): string | null => {
  const vorigeById = new Map(vorige.map((s: any) => [String(s?.id), s]));
  for (const rij of rijen) {
    const oud = vorigeById.get(String(rij?.id));
    for (const veld of ["startTime", "endTime"] as const) {
      const tijd = rij?.[veld];
      if (tijd == null || (typeof tijd === "string" && tijd.trim() === "")) continue;
      if (oud && oud[veld] === tijd) continue;
      if (typeof tijd !== "string" || !isValidHHMM(tijd)) {
        const dienst = String(rij?.line ?? "").trim().slice(0, 20);
        return `Ongeldige tijd in de planning${dienst ? ` bij dienst ${dienst}` : ""}: gebruik uu:mm, van 00:00 tot en met 47:59.`;
      }
    }
  }
  return null;
};
