/**
 * Hoe ver de Maandplanning terugkijkt voor wie geen staf is (Jarno 02-10):
 * een chauffeur ziet de lopende week en wat daarna komt, niet wat collega's
 * vroeger reden. Een week die bezig is blijft volledig zichtbaar, ook de
 * dagen die al voorbij zijn. Planner en admin zien alles.
 *
 * Eén definitie voor server en scherm: GET /api/month-planning knipt hiermee
 * (en zegt in `zichtbaarVanaf` waar), het scherm kiest er zijn startpositie
 * mee vóór het eerste antwoord er is. Het eigen rooster volgt deze regel
 * niet: daar kijkt een chauffeur gewoon terug.
 *
 * Zonder imports: het scherm laadt dit bestand mee in zijn eigen chunk.
 */

/**
 * De eerste dag die een niet-staflid ziet: de maandag van de week waarin
 * `nu` valt, als kalenderdag in Europe/Brussels ('YYYY-MM-DD').
 *
 * Eerst de Brusselse kalenderdag (los van de klok van de server, die in UTC
 * loopt, en van het toestel), daarna rekenen op die dag in UTC: een
 * kalenderdag heeft geen zomer- of winteruur, dus de nacht van de
 * uurwissel verschuift niets.
 */
export function eersteZichtbareDag(nu: Date = new Date()): string {
  const dag = new Date(`${nu.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })}T00:00:00Z`);
  const weekdag = dag.getUTCDay(); // 0 = zondag
  dag.setUTCDate(dag.getUTCDate() - (weekdag === 0 ? 6 : weekdag - 1));
  return dag.toISOString().slice(0, 10);
}

/** De delen van het maandbord die per dag iets over collega's zeggen. */
type Maandbord = {
  dates: string[];
  cells: Record<string, Record<string, unknown>>;
  geimporteerd?: { eerste: string | null; laatste: string | null } | null;
  /** Het dagtype per dag (10-10); volgt dezelfde grens als `dates`. */
  dagtypes?: Record<string, unknown>;
};

/**
 * Het maandbord zonder de dagen vóór `vanaf`: geen dag in `dates`, geen cel.
 * Een chauffeur zonder zichtbare cel verdwijnt uit `cells` (zoals een
 * chauffeur zonder planning er nooit in stond), de lijst `drivers` blijft.
 *
 * `geimporteerd.eerste` schuift mee naar `vanaf`: het scherm bladert al
 * niet voorbij die grens, dus ook een toestel met een oudere versie van de
 * app stopt meteen op de juiste dag. `zichtbaarVanaf` zegt erbij dat het de
 * terugblikregel is en niet het begin van de import, voor de uitleg bij de
 * knop.
 */
export function begrensMaandbord<T extends Maandbord>(bord: T, vanaf: string): T & { zichtbaarVanaf: string } {
  const cells: Record<string, Record<string, unknown>> = {};
  for (const [chauffeur, perDag] of Object.entries(bord.cells)) {
    const zichtbaar = Object.entries(perDag).filter(([dag]) => dag >= vanaf);
    if (zichtbaar.length > 0) cells[chauffeur] = Object.fromEntries(zichtbaar);
  }
  const eerste = bord.geimporteerd?.eerste ?? null;
  // Het dagtype per dag (10-10) volgt dezelfde grens als de dagen zelf.
  const dagtypes = bord.dagtypes ? Object.fromEntries(Object.entries(bord.dagtypes).filter(([dag]) => dag >= vanaf)) : undefined;
  return {
    ...bord,
    dates: bord.dates.filter((dag) => dag >= vanaf),
    cells: cells as T['cells'],
    ...(dagtypes ? { dagtypes } : {}),
    ...(bord.geimporteerd ? { geimporteerd: { ...bord.geimporteerd, eerste: eerste && eerste < vanaf ? vanaf : eerste } } : {}),
    zichtbaarVanaf: vanaf,
  };
}
