/**
 * Motion-tokens — één ritme voor de hele app.
 *
 * Dezelfde waarden staan als CSS-variabelen in index.css
 * (--duration-fast/base/slow, --ease-standard, --ease-spring) voor CSS-
 * transities; dit bestand is de tegenhanger voor de `motion`-package. Kies
 * uit de ladder, geen losse getallen: fast = hover/menu's, base = modals/
 * toasts/panelen, slow = grote vlakken (slide-over, PWA-chrome), entrance =
 * eenmalige intro-animaties (login).
 */
export const DUR = {
  fast: 0.15,
  base: 0.22,
  slow: 0.32,
  entrance: 0.55,
} as const;

/** Standaard-easing (ease-out-quint-achtig): snel weg, zacht landen. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Veer-easing voor bínnenkomende panelen (sheet, slide-over, modal, menu):
 * schiet een fractie voorbij en zet zich dan — voelt als een fysiek paneel
 * i.p.v. een fade. Bewust mild (overshoot ±2 %): geen bounce. Uitgaand
 * blijft EASE (snel weg, niets dat nog nazwaait). Zelfde curve als
 * `--ease-spring` in index.css.
 */
export const EASE_SPRING = [0.34, 1.2, 0.64, 1] as const;

/** Kant-en-klare transition-props voor `motion`-elementen. */
export const transitie = (duration: number = DUR.base, delay = 0) => ({ duration, ease: EASE, delay });

/** Binnenkomend paneel: veer-easing op de ladder-duur. */
export const transitieSpring = (duration: number = DUR.base) => ({ duration, ease: EASE_SPRING });
