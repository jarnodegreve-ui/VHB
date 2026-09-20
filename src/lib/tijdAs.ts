/**
 * De etmaal-as van de aanwezigheidsbalken: welk venster de as toont, waar de
 * uurlijnen en labels vallen, en waar een blok op de as terechtkomt.
 *
 * Alles in minuten sinds middernacht en procenten van de asbreedte, los van
 * React, zodat de meetkunde testbaar is zonder scherm.
 */

export type AsVenster = { vanMin: number; totMin: number };

const MIN_PER_DAG = 24 * 60;

/** Het hele etmaal. */
export const VOLLE_DAG: AsVenster = { vanMin: 0, totMin: MIN_PER_DAG };

/**
 * Ingezoomd begint de as om 04:00. De eerste diensten vertrekken rond half
 * vijf, dus op een gewone dag is 00:00 tot 04:00 een leeg zesde van de balk
 * dat elk blok smaller maakt dan nodig.
 */
export const INZOOM_VAN_MIN = 4 * 60;

/** Smaller dan dit wordt een blok niet getekend, anders verdwijnt een bezoek van vijf minuten. */
export const MIN_BLOK_PCT = 0.5;

/**
 * Het venster van de as voor één dag. Bewust maar twee standen, zodat de as
 * voorspelbaar blijft wanneer je tussen dagen wisselt: 04:00 tot 24:00, en het
 * volle etmaal zodra iemand die dag vóór 04:00 actief was (nachtdienst, of een
 * sessie die over middernacht liep). Nooit inzoomen op "het eerste blok van
 * vandaag": dan verschuift de as per dag en valt er niets meer te vergelijken.
 */
export const asVenster = (periodes: ReadonlyArray<{ vanMin: number }>): AsVenster =>
  periodes.some((p) => p.vanMin < INZOOM_VAN_MIN) ? VOLLE_DAG : { vanMin: INZOOM_VAN_MIN, totMin: MIN_PER_DAG };

const klem = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Plaats van een tijdstip op de as, in procent (0 tot 100, geklemd). */
export const asPositie = (min: number, venster: AsVenster): number => {
  const lengte = venster.totMin - venster.vanMin;
  if (lengte <= 0) return 0;
  return klem(((min - venster.vanMin) / lengte) * 100, 0, 100);
};

/**
 * Een blok op de as: linkerrand en breedte in procent. Wat buiten het venster
 * valt wordt afgeknipt, en de minimumbreedte schuift een blok aan de
 * rechterrand naar binnen in plaats van het over de rand te laten lopen.
 */
export const blokOpAs = (per: { vanMin: number; totMin: number }, venster: AsVenster): { links: number; breedte: number } => {
  const van = asPositie(per.vanMin, venster);
  const tot = asPositie(per.totMin, venster);
  const breedte = Math.max(MIN_BLOK_PCT, tot - van);
  return { links: Math.min(van, 100 - breedte), breedte };
};

export type AsMarkering = {
  uur: number;
  /** Plaats op de as in procent. */
  pct: number;
  /** "06", of null voor een uur zonder label (alleen een fijn streepje). */
  label: string | null;
  /** Uitlijning van het label: aan de randen naar binnen, anders gecentreerd. */
  lijn: 'begin' | 'midden' | 'eind';
};

/**
 * Eén markering per heel uur in het venster, randen inbegrepen. Een uur draagt
 * een label (en een iets sterkere lijn) wanneer het een veelvoud van
 * `labelStap` is: om de 2 uur op een breed scherm, om de 6 uur op een telefoon.
 * De fijne uurlijnen blijven er altijd alle 24 (of 20).
 */
export const asMarkeringen = (venster: AsVenster, labelStap: number): AsMarkering[] => {
  const stap = Math.max(1, Math.round(labelStap));
  const eersteUur = Math.ceil(venster.vanMin / 60);
  const laatsteUur = Math.floor(venster.totMin / 60);
  const uit: AsMarkering[] = [];
  for (let uur = eersteUur; uur <= laatsteUur; uur += 1) {
    const min = uur * 60;
    uit.push({
      uur,
      pct: asPositie(min, venster),
      label: uur % stap === 0 ? String(uur).padStart(2, '0') : null,
      lijn: min === venster.vanMin ? 'begin' : min === venster.totMin ? 'eind' : 'midden',
    });
  }
  return uit;
};

/**
 * Hoeveel uur tussen twee labels, gegeven de breedte van het scherm. Een label
 * is twee cijfers mono (±14 px) en wil minstens evenveel lucht ernaast.
 */
export const labelStapVoor = (breedte: 'telefoon' | 'tablet' | 'desktop'): number =>
  breedte === 'desktop' ? 2 : breedte === 'tablet' ? 3 : 6;
