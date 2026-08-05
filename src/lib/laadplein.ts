/**
 * Vaste busplaatsen op het laadplein (stelplaats Maldegem).
 *
 * Bron: "Mapping bussen en laadpalen.xlsx" (~/VHB/Documenten, 05-08-2026),
 * plattegrond bevestigd door Jarno. Elke bus heeft een vaste plek, dus het
 * laadpunt-nummer identificeert de bus betrouwbaarder dan wat ChargEye over
 * het voertuig meestuurt (dat is slechts een modelprofiel-match).
 *
 * Bewust NIET in de lijst (keuze Jarno 05-08): de reservebussen (R 23 op
 * punt 3, R 24 op punt 15.B), S 44 (plek zonder laadpunt) en de XX-plekken
 * bij punten 16 t/m 18.B — die punten hebben geen vaste bus.
 *
 * Wijzigt er een plaats op het plein, pas dan alléén deze tabel aan.
 */
export const BUS_PER_LAADPUNT: Record<string, string> = {
  '1': '40',
  '2': '43',
  '4': '41',
  '5': '39',
  '6': '38',
  '7': '37',
  '8': '36',
  '9': '35',
  '10': '34',
  '11': '27',
  '12.A': '26',
  '12.B': '28',
  '13.A': '29',
  '13.B': '30',
  '14.A': '31',
  '14.B': '32',
  '15.A': '33',
};

/** Busnummer bij een laadpunt, of null als er geen vaste bus staat. */
export const busVoorLaadpunt = (evseId?: string | null): string | null =>
  BUS_PER_LAADPUNT[String(evseId ?? '').trim()] ?? null;
