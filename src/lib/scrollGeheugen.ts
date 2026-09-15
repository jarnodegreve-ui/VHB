/**
 * Scrollpositie per route onthouden en terugzetten (punt 19, 15-09).
 *
 * De scroll-root is één element voor alle schermen (`[data-scroll-root]` in
 * App.tsx), dus zonder geheugen landde je na terug (swipe-back, terugknop)
 * op een willekeurige hoogte in het vorige scherm. Nu:
 * - vooruit navigeren (tik op een tab, link) = bovenaan beginnen, zoals het was;
 * - terug/vooruit via de historiek (popstate) = de positie van dat scherm terug.
 * De sleutel is het pad inclusief parameters (`/omleidingen/123`), dus een
 * lijst met een geselecteerd record herstelt op zijn eigen positie.
 *
 * Terugzetten kan niet meteen: het scherm rendert nog (lazy chunk, Suspense,
 * data). `planHerstel` probeert daarom per frame tot de inhoud hoog genoeg
 * is voor het doel, met een deadline; scrolt de gebruiker zelf, dan stopt
 * het. Zuivere functies (geheugen, sleutel, beslissing per frame) staan los
 * van de DOM zodat ze te testen zijn.
 */
const posities = new Map<string, number>();

/** Sleutel per route: pad zonder afsluitende schuine streep, zonder query/hash. */
export const scrollSleutel = (pathname: string): string => {
  const kaal = pathname.replace(/\/+$/, '');
  return kaal || '/';
};

/** Positie bewaren; 0 = vergeten (bovenaan is de standaard). */
export function bewaarScroll(sleutel: string, top: number): void {
  if (top > 0) posities.set(sleutel, Math.round(top));
  else posities.delete(sleutel);
}

export const leesScroll = (sleutel: string): number | null => posities.get(sleutel) ?? null;

/** Alles vergeten (uitloggen, tests). */
export const wisScrollGeheugen = (): void => { posities.clear(); };

/** Maximale hoogte die een element nu kan scrollen. */
const maxScroll = (el: { scrollHeight: number; clientHeight: number }) => Math.max(0, el.scrollHeight - el.clientHeight);

/**
 * Beslissing per frame, zuiver: `zet` = nu op het doel zetten, `klaar` =
 * stoppen. Zolang de inhoud nog te laag is voor het doel (skelet, chunk nog
 * onderweg) wachten we, tot de deadline; dán zetten we wat kan (de browser
 * klemt vanzelf) zodat een korter geworden lijst toch zo dicht mogelijk landt.
 */
export function herstelStap(
  el: { scrollHeight: number; clientHeight: number },
  doel: number,
  frame: number,
  maxFrames: number,
): { zet: boolean; klaar: boolean } {
  if (doel <= 0) return { zet: true, klaar: true };
  if (maxScroll(el) >= doel) return { zet: true, klaar: true };
  if (frame >= maxFrames) return { zet: true, klaar: true };
  return { zet: false, klaar: false };
}

export const HERSTEL_MAX_FRAMES = 90; // ±1,5 s bij 60 Hz: ruim voor chunk + data, kort genoeg om niet te "springen"

type Frame = (cb: () => void) => number;
type AnnuleerFrame = (id: number) => void;

let annuleerLopend: (() => void) | null = null;

/** Een lopend herstel afbreken (nieuwe navigatie, gebruiker scrolt zelf). */
export function annuleerHerstel(): void {
  annuleerLopend?.();
  annuleerLopend = null;
}

/**
 * Herstel plannen op `el` naar `doel`. Eén tegelijk: een nieuw plan vervangt
 * het vorige. Geeft de afbreker terug. `raf`/`caf` zijn injecteerbaar voor
 * tests; standaard requestAnimationFrame.
 */
export function planHerstel(
  el: HTMLElement,
  doel: number,
  opties: { maxFrames?: number; raf?: Frame; caf?: AnnuleerFrame } = {},
): () => void {
  annuleerHerstel();
  const maxFrames = opties.maxFrames ?? HERSTEL_MAX_FRAMES;
  const raf: Frame = opties.raf ?? ((cb) => window.requestAnimationFrame(cb));
  const caf: AnnuleerFrame = opties.caf ?? ((id) => window.cancelAnimationFrame(id));
  let frame = 0;
  let id: number | null = null;
  let actief = true;
  const stop = () => {
    if (!actief) return;
    actief = false;
    if (id !== null) caf(id);
    el.removeEventListener('wheel', stop);
    el.removeEventListener('touchstart', stop);
    el.removeEventListener('keydown', stop);
    if (annuleerLopend === stop) annuleerLopend = null;
  };
  const tik = () => {
    if (!actief) return;
    const { zet, klaar } = herstelStap(el, doel, frame, maxFrames);
    if (zet) el.scrollTop = doel;
    if (klaar) { stop(); return; }
    frame += 1;
    id = raf(tik);
  };
  // Eigen scrollgebaar van de gebruiker wint van het herstel.
  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('touchstart', stop, { passive: true });
  el.addEventListener('keydown', stop);
  annuleerLopend = stop;
  tik();
  return stop;
}
