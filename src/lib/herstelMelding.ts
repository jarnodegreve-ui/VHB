/**
 * Wat de toast zegt na "Ongedaan maken" van een verwijderde omleiding of
 * update (controle-ronde 29-09, nr. 12). Het record komt altijd terug; de
 * PDF's alleen als de server ze nog in Storage vond. Kwam er minder terug dan
 * er hing, dan zegt de toast dat eerlijk, met wat je eraan doet.
 */
export function herstelMelding(
  soort: 'Omleiding' | 'Update',
  verwacht: number,
  terug: number,
): { tekst: string; toon: 'success' | 'info' } {
  const kwijt = Math.max(0, verwacht - terug);
  if (kwijt === 0) return { tekst: `${soort} hersteld.`, toon: 'success' };
  if (verwacht === 1) return { tekst: `${soort} hersteld, maar de PDF kwam niet mee terug. Voeg hem opnieuw toe.`, toon: 'info' };
  return {
    tekst: kwijt === 1
      ? `${soort} hersteld, maar 1 van de ${verwacht} PDF’s kwam niet mee terug. Voeg hem opnieuw toe.`
      : `${soort} hersteld, maar ${kwijt} van de ${verwacht} PDF’s kwamen niet mee terug. Voeg ze opnieuw toe.`,
    toon: 'info',
  };
}
