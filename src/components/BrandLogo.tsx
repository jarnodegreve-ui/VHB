import { useEffect, useId, useRef, useState } from 'react';

/**
 * Het VHB-logo (pakket "VHB primary", 2026-09-14) als ínline SVG i.p.v.
 * <img src="…svg">.
 *
 * Waarom inline: Safari rastert een SVG in een <img> die in een gecomposite
 * laag zit (schuivende sidebar met transform, perspective-context op de
 * login) als bitmap op CSS-pixelresolutie en schaalt die daarna op —
 * kartelige randen op retina (#247, #261). Inline SVG wordt per device-pixel
 * vectorieel getekend en blijft dus overal strak.
 *
 * Geometrie is 1-op-1 brand/vhb-final-logo-package/schoon/VHB-primary-kleur.svg:
 * het beeldmerk (V·H·B als één zwaar woordmerk met de gouden schuine streep
 * tussen V en H) en de gespatieerde naamregel als lettercontouren (geen font
 * nodig). Drie opmaken uit het pakket: 'volledig' (beeldmerk boven naamregel,
 * 902×334), 'beeldmerk' (alleen het merk) en 'horizontaal' (merk | gouden
 * scheidingslijn | naamregel op twee regels, 1297×256). De negatief-variant
 * wisselt alleen carbon → wit, zoals VHB-primary-wit-goud.svg — maar niet
 * puur #FFFFFF: op het diepe zwart van dark mode/login vond Jarno dat te fel
 * (30-08), dus het negatief staat op slate-200-wit. Verder staan de kleuren
 * bewust hard (geen tokens): het logo mag niet meebewegen met een UI-retune.
 * Eén bewuste afwijking van het pakket: het goud. Het pakket levert
 * #CAA044; Jarno koos (14-09) voor het bestaande huisstijl-goud #E2A323,
 * zodat logo en UI-accenten (oker-500) hetzelfde goud dragen. Carbon blijft
 * het pakket-carbon #242628 (niet slate-900 #14181B).
 *
 * Maat: sizen op BREEDTE (w-36/w-56, h-auto), niet op hoogte; het losse
 * beeldmerk mag op hoogte (h-6 in de mobiele topbar).
 */
const CARBON = '#242628';
export const GOUD = '#E2A323'; // huisstijl-goud (oker-500); het pakket levert #CAA044, Jarno koos 14-09 voor het bestaande goud
const NEGATIEF = '#DCDFE2'; // gedempt wit (tussen slate-200 en -300) i.p.v. #FFFFFF, zie boven

/* Paden uit brand/vhb-final-logo-package/schoon/VHB-primary-kleur.svg: de
 * schone vectorversie van het getraceerde pakketbestand (zie
 * scripts/brand-paden-schoon.mjs; geometrie 1-op-1, alleen de trace-ruis is
 * weg). Het merk staat in de coördinaten van VHB-beeldmerk-kleur.svg (bbox
 * x 20–592,5 · y 20,6–215,5); de naamregel in die van de wordmark-groep
 * (bbox x 19–861 · y 19–55,3, één pad voor "VAN HOOREBEKE & ZOON"). De
 * naamregel is Montserrat Medium (het lettertype van het pakket, 14-09 via
 * overlay vastgesteld), glyph voor glyph op de letterposities van het pakket
 * gezet; zo blijft hij strak op elke maat zonder webfont. */
const MERK_INK = 'M 412.27 21.54 L 412.27 53.5 C 436.86 53.7 461.46 53.9 486.05 54.2 C 494.22 54.3 502.38 54.41 510.55 54.65 C 514.91 54.78 519.75 54.5 524.01 55.52 C 527.08 56.25 529.77 60.34 531.22 62.9 C 536.89 72.91 532.99 87.35 523.28 93.39 C 519.73 95.6 515.31 95.98 511.24 96.3 C 504.43 96.83 497.57 96.87 490.75 96.92 C 473.25 97.07 455.74 97 438.24 97 C 429.91 97 420.05 95.93 412.24 97.25 L 412.24 215.28 C 422.06 215.81 432.04 215.41 441.89 215.41 C 460.06 215.43 478.23 215.46 496.4 215.45 C 510.26 215.44 525.18 216.78 538.87 214.36 C 545.79 213.14 552.83 210.37 559.12 207.28 C 581.66 196.22 593.8 171.62 590.29 147.13 C 589.36 140.6 587.51 133.91 583.97 128.29 C 579.83 121.73 573.64 116.25 566.86 112.53 C 563.47 110.67 559.41 109.27 556.22 107.64 C 563.05 98.17 572.73 91.74 576.72 80.24 C 584.13 58.86 573.64 32.69 551.89 24.9 C 534.63 18.72 514.38 20.94 496.31 20.84 C 477.97 20.74 459.63 20.64 441.3 20.72 C 431.87 20.75 421.53 19.8 412.27 21.54 Z M 19.6 21.08 L 106.64 214 L 112.29 213.54 L 134.96 173.94 L 67.5 21.08 L 19.6 21.08 Z M 127.71 130.77 L 141.89 161.79 L 221.82 21 L 188.74 21 L 127.71 130.77 Z M 356 102.12 L 249.44 102.12 L 249.44 65.44 L 206 140.83 L 206 214.77 L 249.76 214.77 L 249.76 133.83 L 356 133.83 L 356 215 L 397 215 L 397 21 L 356 21 L 356 102.12 Z M 450.24 173.5 C 466.88 173.5 483.53 173.53 500.18 173.49 C 508.06 173.47 518.03 174.81 525.51 171.93 C 530.49 170.02 535.04 166.8 537.71 162.11 C 542.14 154.32 540.31 142.72 533.78 136.73 C 526.79 130.32 516.95 131.36 508.13 131.2 C 488.83 130.83 469.53 131 450.24 131 L 450.24 173.5 Z';
const MERK_GOUD = 'M 124.99 213.92 L 145.06 213.92 L 256.96 21.02 L 237.49 21.02 L 124.99 213.92 Z';
const NAAMREGEL = 'M37.8 53L33.2 53L19.2 21L24.1 21L35.6 47.3L47.2 21L51.8 21L37.8 53Z M68.7 53L64.0 53L78.5 21L83.0 21L97.6 53L92.8 53L89.2 45L72.2 45L68.7 53ZM80.7 25.7L73.8 41.3L87.6 41.3L80.7 25.7Z M119.6 53L115 53L115 21L118.7 21L137.9 44.9L137.9 21L142.5 21L142.5 53L138.8 53L119.6 29.1L119.6 53Z M217.5 53L212.9 53L212.9 38.7L194.6 38.7L194.6 53L190 53L190 21L194.6 21L194.6 34.8L212.9 34.8L212.9 21L217.5 21L217.5 53Z M254.2 53.4L254.2 53.4Q250.5 53.4 247.3 52.1Q244.2 50.9 242.0 48.7Q239.7 46.5 238.4 43.5Q237.1 40.5 237.1 37L237.1 37Q237.1 33.5 238.4 30.5Q239.7 27.5 242.0 25.3Q244.2 23.1 247.3 21.9Q250.5 20.6 254.2 20.6L254.2 20.6Q257.8 20.6 260.9 21.8Q264.0 23.1 266.3 25.3Q268.6 27.5 269.9 30.5Q271.1 33.5 271.1 37L271.1 37Q271.1 40.5 269.9 43.5Q268.6 46.5 266.3 48.7Q264.0 50.9 260.9 52.2Q257.8 53.4 254.2 53.4ZM254.2 49.3L254.2 49.3Q257.7 49.3 260.5 47.7Q263.3 46.1 264.9 43.3Q266.5 40.5 266.5 37L266.5 37Q266.5 33.5 264.9 30.7Q263.3 27.9 260.5 26.3Q257.7 24.7 254.2 24.7L254.2 24.7Q250.5 24.7 247.7 26.3Q244.9 27.9 243.3 30.7Q241.7 33.5 241.7 37L241.7 37Q241.7 40.5 243.3 43.3Q244.9 46.1 247.7 47.7Q250.5 49.3 254.2 49.3Z M305.2 53.4L305.2 53.4Q301.5 53.4 298.4 52.1Q295.3 50.9 293.0 48.7Q290.7 46.5 289.4 43.5Q288.1 40.5 288.1 37L288.1 37Q288.1 33.5 289.4 30.5Q290.7 27.5 293.0 25.3Q295.3 23.1 298.4 21.9Q301.5 20.6 305.2 20.6L305.2 20.6Q308.8 20.6 311.9 21.8Q315.0 23.1 317.3 25.3Q319.6 27.5 320.9 30.5Q322.2 33.5 322.2 37L322.2 37Q322.2 40.5 320.9 43.5Q319.6 46.5 317.3 48.7Q315.0 50.9 311.9 52.2Q308.8 53.4 305.2 53.4ZM305.2 49.3L305.2 49.3Q308.7 49.3 311.5 47.7Q314.3 46.1 316.0 43.3Q317.6 40.5 317.6 37L317.6 37Q317.6 33.5 316.0 30.7Q314.3 27.9 311.5 26.3Q308.7 24.7 305.2 24.7L305.2 24.7Q301.6 24.7 298.8 26.3Q296.0 27.9 294.3 30.7Q292.7 33.5 292.7 37L292.7 37Q292.7 40.5 294.3 43.3Q296.0 46.1 298.8 47.7Q301.6 49.3 305.2 49.3Z M345.6 53L341 53L341 21L353.5 21Q359.7 21 363.3 24.0Q366.8 26.9 366.8 32.2L366.8 32.2Q366.8 35.9 365 38.5Q363.2 41.1 359.8 42.3L359.8 42.3L367.4 53L362.4 53L355.5 43.2Q354.5 43.3 353.5 43.3L353.5 43.3L345.6 43.3L345.6 53ZM345.6 25.0L345.6 39.4L353.3 39.4Q357.7 39.4 360.0 37.5Q362.3 35.6 362.3 32.2L362.3 32.2Q362.3 28.7 360.0 26.9Q357.7 25.0 353.3 25.0L353.3 25.0L345.6 25.0Z M412.2 53L389 53L389 21L411.6 21L411.6 25.0L393.6 25.0L393.6 34.8L409.6 34.8L409.6 38.7L393.6 38.7L393.6 49.0L412.2 49.0L412.2 53Z M446.3 53L431 53L431 21L445.4 21Q450.9 21 453.9 23.2Q456.8 25.4 456.8 29.3L456.8 29.3Q456.8 31.9 455.6 33.7Q454.4 35.5 452.5 36.4L452.5 36.4Q455.2 37.2 456.9 39.2Q458.5 41.2 458.5 44.4L458.5 44.4Q458.5 48.5 455.4 50.7Q452.3 53 446.3 53L446.3 53ZM435.6 38.6L435.6 49.3L446.1 49.3Q449.9 49.3 451.9 48.0Q453.9 46.7 453.9 44.0L453.9 44.0Q453.9 41.2 451.9 39.9Q449.9 38.6 446.1 38.6L446.1 38.6L435.6 38.6ZM435.6 24.7L435.6 34.9L444.9 34.9Q448.4 34.9 450.3 33.7Q452.3 32.4 452.3 29.8L452.3 29.8Q452.3 27.3 450.3 26.0Q448.4 24.7 444.9 24.7L444.9 24.7L435.6 24.7Z M500.2 53L477 53L477 21L499.6 21L499.6 25.0L481.6 25.0L481.6 34.8L497.6 34.8L497.6 38.7L481.6 38.7L481.6 49.0L500.2 49.0L500.2 53Z M524.3 53L519.7 53L519.7 21L524.3 21L524.3 38.9L541.6 21L546.8 21L533.2 35.4L547.7 53L542.4 53L530.1 38.7L524.3 44.7L524.3 53Z M588.2 53L565 53L565 21L587.6 21L587.6 25.0L569.6 25.0L569.6 34.8L585.6 34.8L585.6 38.7L569.6 38.7L569.6 49.0L588.2 49.0L588.2 53Z M652.0 50.6L649.5 53.5L645.3 49.3Q641.0 53.4 634.6 53.4L634.6 53.4Q631.3 53.4 628.8 52.3Q626.3 51.3 624.8 49.4Q623.4 47.5 623.4 45.0L623.4 45.0Q623.4 42.1 625.2 39.8Q627.0 37.5 631.1 35.2L631.1 35.2Q629.0 33.0 628.1 31.4Q627.3 29.7 627.3 27.9L627.3 27.9Q627.3 24.7 629.7 22.7Q632.0 20.7 635.9 20.7L635.9 20.7Q639.6 20.7 641.7 22.5Q643.9 24.3 643.9 27.4L643.9 27.4Q643.9 29.8 642.3 31.7Q640.8 33.7 637.1 35.8L637.1 35.8L644.9 43.6Q646.3 41.2 647.0 37.8L647.0 37.8L650.5 39.0Q649.7 43.2 647.7 46.3L647.7 46.3L652.0 50.6ZM642.7 46.7L642.7 46.7L633.6 37.6Q630.2 39.5 628.9 41.1Q627.7 42.7 627.7 44.6L627.7 44.6Q627.7 46.9 629.6 48.3Q631.6 49.7 634.8 49.7L634.8 49.7Q639.6 49.7 642.7 46.7ZM634.6 33.3L634.6 33.3Q637.8 31.6 639.0 30.3Q640.2 29.0 640.2 27.4L640.2 27.4Q640.2 25.9 639.1 24.9Q638.0 23.9 635.9 23.9L635.9 23.9Q633.8 23.9 632.6 25.0Q631.4 26.1 631.4 27.8L631.4 27.8Q631.4 29.0 632.0 30.2Q632.7 31.3 634.6 33.3Z M713.7 53L687.0 53L687.0 49.9L707.1 25.0L687.3 25.0L687.3 21L713.1 21L713.1 24.1L693.1 49.0L713.7 49.0L713.7 53Z M745.9 53.4L745.9 53.4Q742.2 53.4 739.1 52.1Q736.0 50.9 733.7 48.7Q731.4 46.5 730.1 43.5Q728.8 40.5 728.8 37L728.8 37Q728.8 33.5 730.1 30.5Q731.4 27.5 733.7 25.3Q736.0 23.1 739.1 21.9Q742.2 20.6 745.9 20.6L745.9 20.6Q749.6 20.6 752.6 21.8Q755.7 23.1 758.0 25.3Q760.3 27.5 761.6 30.5Q762.9 33.5 762.9 37L762.9 37Q762.9 40.5 761.6 43.5Q760.3 46.5 758.0 48.7Q755.7 50.9 752.6 52.2Q749.6 53.4 745.9 53.4ZM745.9 49.3L745.9 49.3Q749.4 49.3 752.2 47.7Q755.0 46.1 756.7 43.3Q758.3 40.5 758.3 37L758.3 37Q758.3 33.5 756.7 30.7Q755.0 27.9 752.2 26.3Q749.4 24.7 745.9 24.7L745.9 24.7Q742.3 24.7 739.5 26.3Q736.7 27.9 735.0 30.7Q733.4 33.5 733.4 37L733.4 37Q733.4 40.5 735.0 43.3Q736.7 46.1 739.5 47.7Q742.3 49.3 745.9 49.3Z M797.1 53.4L797.1 53.4Q793.3 53.4 790.2 52.1Q787.1 50.9 784.8 48.7Q782.6 46.5 781.3 43.5Q780.0 40.5 780.0 37L780.0 37Q780.0 33.5 781.3 30.5Q782.6 27.5 784.8 25.3Q787.1 23.1 790.2 21.9Q793.3 20.6 797.1 20.6L797.1 20.6Q800.7 20.6 803.8 21.8Q806.9 23.1 809.2 25.3Q811.5 27.5 812.8 30.5Q814.0 33.5 814.0 37L814.0 37Q814.0 40.5 812.8 43.5Q811.5 46.5 809.2 48.7Q806.9 50.9 803.8 52.2Q800.7 53.4 797.1 53.4ZM797.1 49.3L797.1 49.3Q800.6 49.3 803.4 47.7Q806.2 46.1 807.8 43.3Q809.4 40.5 809.4 37L809.4 37Q809.4 33.5 807.8 30.7Q806.2 27.9 803.4 26.3Q800.6 24.7 797.1 24.7L797.1 24.7Q793.4 24.7 790.6 26.3Q787.8 27.9 786.2 30.7Q784.6 33.5 784.6 37L784.6 37Q784.6 40.5 786.2 43.3Q787.8 46.1 790.6 47.7Q793.4 49.3 797.1 49.3Z M837.6 53L833 53L833 21L836.7 21L855.9 44.9L855.9 21L860.5 21L860.5 53L856.8 53L837.6 29.1L837.6 53Z';

/* Opmaak 'volledig' = het primary-bestand: merk op (131 | 10), naamregel op
 * (11 | 250); viewBox strak om de inhoud (x 30–872, y 30–306). */
const VOLLEDIG = { viewBox: '30 30 842 276', merk: 'translate(131 10)', naam: 'translate(11 250)' };
/* Opmaak 'beeldmerk': alleen het merk, strak (573×195). */
const BEELDMERK = { viewBox: '20 20.5 573 195' };
/* Opmaak 'horizontaal' = het horizontaal-bestand: merk op (10 | 10), gouden
 * lijn op x 649, naamregel op twee regels (VAN HOOREBEKE / & ZOON) door de
 * ene naamregel twee keer te knippen: regel 1 = eerste 570 eenheden, regel 2
 * = eenheden 603–842, 53 lager. */
const HORIZONTAAL = { viewBox: '30 30 1237 196', merk: 'translate(10 10)', regel1: 'translate(678 64)', regel2: 'translate(75 117)' };

/* Laadstand: de gouden streep is de laadindicator. Een lichtband trekt van
 * onder naar boven door de streep (tekent hem in, veegt hem daarna uit) —
 * technisch een lijn over de as van de streep, geknipt op de streepvorm,
 * met stroke-dashoffset 100 → −100 (pathLength 100, dash 100/100). Onder de
 * band staat de streep gedempt (spoor) zodat de vorm blijft staan.
 *
 * Eén gedeelde tijdbasis (streepT0) zodat álle laad-logo's in fase lopen en
 * een logo dat ná het laden verschijnt (zijbalk, login) precies weet waar de
 * band op dat moment zat: het maakt de beweging af tot de streep vol is
 * (`landing`) i.p.v. abrupt naar de statische streep te springen. Web
 * Animations API i.p.v. een CSS-keyframe: de startTime is expliciet, dus na
 * een blokkerende hoofdthread springt de band naar de juiste fase in plaats
 * van te blijven hangen. */
const STREEP_OMLOOP_MS = 1400; // 0 → 200 dash-eenheden (in- en uitvegen)
const STREEP_VOL = 100; // fase waarop de streep volledig getekend is
const STREEP_LANDING_REK = 1.4;
// As van de streep (midden onderrand → midden bovenrand), iets verlengd zodat
// de geknipte uiteinden volledig gevuld raken.
const STREEP_AS = 'M133.5 217.5 L249.2 17.5';
const STREEP_BREEDTE = 24; // > loodrechte breedte van de streep (16,4)
const SPOOR_OPACITY = 0.28;
let streepT0: number | null = null;
let ladenActief = 0; // aantal gemonteerde laad-logo's (voor de landing-beslissing)

function nu(): number {
  return typeof document !== 'undefined' && document.timeline?.currentTime != null
    ? Number(document.timeline.currentTime)
    : performance.now();
}
function streepStart(): number {
  if (streepT0 === null) streepT0 = nu();
  return streepT0;
}
/** Huidige fase van de lichtband, 0–200 (0 = leeg, 100 = vol, 200 = weer leeg). */
function streepFase(): number {
  return (((nu() - streepStart()) % STREEP_OMLOOP_MS) / STREEP_OMLOOP_MS) * 200;
}
function minderBeweging(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export type LogoVariant = 'volledig' | 'beeldmerk' | 'horizontaal';

export function BrandLogo({
  tone = 'licht',
  variant = 'volledig',
  laden = false,
  className,
}: {
  /** 'licht' = carbon op lichte achtergrond; 'donker' = negatief (gedempt wit) op zwart/donker. */
  tone?: 'licht' | 'donker';
  /** 'volledig' = merk boven naamregel; 'beeldmerk' = alleen het merk; 'horizontaal' = merk | lijn | naamregel in twee regels. */
  variant?: LogoVariant;
  /** Laadstand: de lichtband trekt door de gouden streep (het logo ís de
   *  spinner). Alleen voor laadmomenten — het statische logo blijft het
   *  masterbestand. */
  laden?: boolean;
  className?: string;
}) {
  const ink = tone === 'donker' ? NEGATIEF : CARBON;
  const id = useId();
  const bandRef = useRef<SVGPathElement>(null);
  // Landing: een statisch logo dat verschijnt terwijl er (nog) een laad-logo
  // staat — of dit logo zelf net uit de laadstand komt — laat de band eerst
  // de streep vol maken. 'nee' = gewoon de statische streep.
  const [landing, setLanding] = useState<{ stand: 'nee' | 'bezig' | 'klaar'; van: number }>(() =>
    !laden && ladenActief > 0 && !minderBeweging() ? { stand: 'bezig', van: streepFase() } : { stand: 'nee', van: STREEP_VOL },
  );
  const vorigeLaden = useRef(laden);
  useEffect(() => {
    if (vorigeLaden.current && !laden) setLanding(minderBeweging() ? { stand: 'nee', van: STREEP_VOL } : { stand: 'bezig', van: streepFase() });
    if (laden) setLanding({ stand: 'nee', van: STREEP_VOL });
    vorigeLaden.current = laden;
  }, [laden]);
  useEffect(() => {
    if (!laden) return;
    ladenActief += 1;
    return () => {
      ladenActief -= 1;
    };
  }, [laden]);
  // Vegen (laadstand): oneindig op de gedeelde tijdbasis.
  useEffect(() => {
    const el = bandRef.current;
    if (!laden || !el || typeof el.animate !== 'function' || minderBeweging()) return;
    const veeg = el.animate([{ strokeDashoffset: '100' }, { strokeDashoffset: '-100' }], {
      duration: STREEP_OMLOOP_MS,
      iterations: Infinity,
      easing: 'linear',
    });
    veeg.startTime = streepStart();
    return () => veeg.cancel();
  }, [laden]);
  // Landen: vanaf de huidige fase door tot de streep vol is, uitlopend. Zat
  // de band al in het uitvegen, dan veegt hij eerst uit en tekent opnieuw in.
  useEffect(() => {
    const el = bandRef.current;
    if (landing.stand !== 'bezig' || !el) return;
    if (typeof el.animate !== 'function') {
      setLanding({ stand: 'klaar', van: STREEP_VOL });
      return;
    }
    const van = streepFase();
    const afstand = van <= STREEP_VOL ? STREEP_VOL - van : 300 - van;
    const land = el.animate([{ strokeDashoffset: `${100 - van}` }, { strokeDashoffset: `${100 - van - afstand}` }], {
      duration: (afstand / 200) * STREEP_OMLOOP_MS * STREEP_LANDING_REK,
      easing: 'cubic-bezier(0.25, 0.4, 0.5, 1)',
      fill: 'forwards',
    });
    land.onfinish = () => setLanding({ stand: 'klaar', van: STREEP_VOL });
    return () => land.cancel();
  }, [landing.stand]);
  const vegend = laden || landing.stand === 'bezig';
  const clipId = `${id}streep`;

  /* Het merk: letters in inkt, de gouden streep statisch óf als spoor + band. */
  const merk = (
    <>
      <path d={MERK_INK} fill={ink} fillRule="evenodd" />
      {vegend ? (
        <>
          <clipPath id={clipId}>
            <path d={MERK_GOUD} />
          </clipPath>
          <path d={MERK_GOUD} fill={GOUD} fillRule="evenodd" opacity={SPOOR_OPACITY} />
          <path
            ref={bandRef}
            d={STREEP_AS}
            clipPath={`url(#${clipId})`}
            fill="none"
            stroke={GOUD}
            strokeWidth={STREEP_BREEDTE}
            pathLength={100}
            strokeDasharray="100 100"
            // Basiswaarde vóór de animatie start: ladend = leeg (reduced
            // motion toont dan het spoor), landend = de fase op het moment
            // van renderen (geen flits van de volle streep in het eerste frame).
            style={{ strokeDashoffset: laden ? 100 : 100 - landing.van }}
            data-streep={laden ? 'veegt' : 'landt'}
          />
        </>
      ) : (
        <path d={MERK_GOUD} fill={GOUD} fillRule="evenodd" />
      )}
    </>
  );

  if (variant === 'beeldmerk') {
    return (
      <svg viewBox={BEELDMERK.viewBox} width={573} height={195} role="img" aria-label="VHB" className={className} style={{ overflow: 'visible' }}>
        {merk}
      </svg>
    );
  }
  if (variant === 'horizontaal') {
    const r1 = `${id}r1`;
    const r2 = `${id}r2`;
    return (
      <svg viewBox={HORIZONTAAL.viewBox} width={1237} height={196} role="img" aria-label="VHB, Van Hoorebeke & Zoon" className={className} style={{ overflow: 'visible' }}>
        <g transform={HORIZONTAAL.merk}>{merk}</g>
        <path d="M649 30 V226" stroke={GOUD} strokeWidth={5} />
        <clipPath id={r1}>
          <rect x={19} y={0} width={570} height={60} />
        </clipPath>
        <clipPath id={r2}>
          <rect x={622} y={0} width={239} height={60} />
        </clipPath>
        <g transform={HORIZONTAAL.regel1} clipPath={`url(#${r1})`}>
          <path d={NAAMREGEL} fill={ink} fillRule="evenodd" />
        </g>
        <g transform={HORIZONTAAL.regel2} clipPath={`url(#${r2})`}>
          <path d={NAAMREGEL} fill={ink} fillRule="evenodd" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox={VOLLEDIG.viewBox} width={842} height={276} role="img" aria-label="VHB, Van Hoorebeke & Zoon" className={className} style={{ overflow: 'visible' }}>
      <g transform={VOLLEDIG.merk}>{merk}</g>
      <g transform={VOLLEDIG.naam}>
        <path d={NAAMREGEL} fill={ink} fillRule="evenodd" />
      </g>
    </svg>
  );
}
