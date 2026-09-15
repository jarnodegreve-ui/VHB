/**
 * Haptische tik (punt 19, 15-09): één korte trilling op de momenten waarop
 * de vinger iets "vastpakt": de pull-to-refresh die de drempel haalt, de
 * bulkbalk die verschijnt, en de knop "Ongedaan maken". Bewust drie vaste
 * duren en niets anders, geen patronen, geen tik per toets.
 *
 * `navigator.vibrate` bestaat op Android/Chromium; iOS Safari heeft het niet
 * (dan stil no-op, geen fout). Reduced motion zet ook de tikken uit: wie
 * beweging uit heeft, wil doorgaans ook geen trilling. Geeft terug of er
 * werkelijk getrild is, zodat een test dat kan controleren.
 */
export type TikSoort = 'drempel' | 'bulk' | 'ongedaan';

export const TIK_MS: Record<TikSoort, number> = {
  drempel: 10,
  bulk: 15,
  ongedaan: 20,
};

const reducedMotion = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function tik(soort: TikSoort): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  if (reducedMotion()) return false;
  try {
    return navigator.vibrate(TIK_MS[soort]) === true;
  } catch {
    return false;
  }
}
