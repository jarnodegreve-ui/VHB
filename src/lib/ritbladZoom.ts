/**
 * Knijpen op het ritblad (controle 16-09, nr. 9). De viewer rendert elke
 * pagina naar een canvas op een vaste zoomstap, dus continu schalen zou bij
 * elke vinger-beweging opnieuw renderen. In plaats daarvan vertaalt dit de
 * knijpbeweging naar dezelfde stappen als de knopjes: voorbij de drempel
 * schuift de zoom één stap op en begint de meting opnieuw vanaf de huidige
 * vingerafstand, zodat doorknijpen verder blijft zoomen.
 */

/** Hoeveel de vingerafstand moet veranderen voor één stap. */
export const KNIJP_DREMPEL = 1.3;

export const vingerAfstand = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number =>
  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/**
 * Nieuwe zoom-index voor een knijpbeweging. `herstart` betekent: neem de
 * huidige vingerafstand als nieuw beginpunt (de stap is verzilverd).
 * Buiten de grenzen verandert er niets en blijft de meting staan, zodat
 * terugknijpen meteen weer werkt.
 */
export const knijpNaarZoomStap = (
  huidigeIdx: number,
  beginAfstand: number,
  nuAfstand: number,
  aantalStappen: number,
): { idx: number; herstart: boolean } => {
  if (!(beginAfstand > 0) || !(nuAfstand > 0)) return { idx: huidigeIdx, herstart: false };
  const verhouding = nuAfstand / beginAfstand;
  if (verhouding >= KNIJP_DREMPEL) {
    const idx = Math.min(aantalStappen - 1, huidigeIdx + 1);
    return { idx, herstart: idx !== huidigeIdx };
  }
  if (verhouding <= 1 / KNIJP_DREMPEL) {
    const idx = Math.max(0, huidigeIdx - 1);
    return { idx, herstart: idx !== huidigeIdx };
  }
  return { idx: huidigeIdx, herstart: false };
};
