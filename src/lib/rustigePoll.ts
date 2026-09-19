/**
 * Rustige achtergrond-poll voor de werkvoorraad-bronnen (vervaldata,
 * wachtende toestellen; ronde 3, 19-09). Vroeger: een 10-min-interval dat ook
 * in verborgen tabbladen doorliep, plus een fetch op ELK window-focus-event
 * zonder rem (elke klik terug in het venster = twee API-calls van 250-400 ms).
 *
 * - meteen één keer ophalen;
 * - daarna elke `intervalMs`, maar alleen zolang het tabblad zichtbaar is
 *   (het interval stopt bij verbergen en start opnieuw bij tonen);
 * - bij focus of opnieuw zichtbaar worden hooguit één keer per `focusMinMs`.
 *
 * Geeft de opruimfunctie terug (voor een useEffect). Niet voor de
 * onderhoudspoll: die heeft zijn eigen ritme.
 */
export function startRustigePoll(
  haal: () => void,
  { intervalMs = 10 * 60_000, focusMinMs = 5 * 60_000 }: { intervalMs?: number; focusMinMs?: number } = {},
): () => void {
  let laatste = 0;
  let timer: number | null = null;
  const zichtbaar = () => typeof document === 'undefined' || document.visibilityState === 'visible';
  const doe = () => {
    laatste = Date.now();
    haal();
  };
  const start = () => {
    if (timer === null) timer = window.setInterval(doe, intervalMs);
  };
  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const opFocus = () => {
    if (zichtbaar() && Date.now() - laatste >= focusMinMs) doe();
  };
  const opZichtbaarheid = () => {
    if (zichtbaar()) {
      start();
      opFocus();
    } else {
      stop();
    }
  };

  doe();
  if (zichtbaar()) start();
  window.addEventListener('focus', opFocus);
  document.addEventListener('visibilitychange', opZichtbaarheid);
  return () => {
    stop();
    window.removeEventListener('focus', opFocus);
    document.removeEventListener('visibilitychange', opZichtbaarheid);
  };
}
