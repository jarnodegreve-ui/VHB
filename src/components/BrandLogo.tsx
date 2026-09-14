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
 * (bbox x 19–861 · y 19–55,3, één pad voor "VAN HOOREBEKE & ZOON"). */
const MERK_INK = 'M 412.27 21.54 L 412.27 53.5 C 436.86 53.7 461.46 53.9 486.05 54.2 C 494.22 54.3 502.38 54.41 510.55 54.65 C 514.91 54.78 519.75 54.5 524.01 55.52 C 527.08 56.25 529.77 60.34 531.22 62.9 C 536.89 72.91 532.99 87.35 523.28 93.39 C 519.73 95.6 515.31 95.98 511.24 96.3 C 504.43 96.83 497.57 96.87 490.75 96.92 C 473.25 97.07 455.74 97 438.24 97 C 429.91 97 420.05 95.93 412.24 97.25 L 412.24 215.28 C 422.06 215.81 432.04 215.41 441.89 215.41 C 460.06 215.43 478.23 215.46 496.4 215.45 C 510.26 215.44 525.18 216.78 538.87 214.36 C 545.79 213.14 552.83 210.37 559.12 207.28 C 581.66 196.22 593.8 171.62 590.29 147.13 C 589.36 140.6 587.51 133.91 583.97 128.29 C 579.83 121.73 573.64 116.25 566.86 112.53 C 563.47 110.67 559.41 109.27 556.22 107.64 C 563.05 98.17 572.73 91.74 576.72 80.24 C 584.13 58.86 573.64 32.69 551.89 24.9 C 534.63 18.72 514.38 20.94 496.31 20.84 C 477.97 20.74 459.63 20.64 441.3 20.72 C 431.87 20.75 421.53 19.8 412.27 21.54 Z M 19.6 21.08 L 106.64 214 L 112.29 213.54 L 134.96 173.94 L 67.5 21.08 L 19.6 21.08 Z M 127.71 130.77 L 141.89 161.79 L 221.82 21 L 188.74 21 L 127.71 130.77 Z M 356 102.12 L 249.44 102.12 L 249.44 65.44 L 206 140.83 L 206 214.77 L 249.76 214.77 L 249.76 133.83 L 356 133.83 L 356 215 L 397 215 L 397 21 L 356 21 L 356 102.12 Z M 450.24 173.5 C 466.88 173.5 483.53 173.53 500.18 173.49 C 508.06 173.47 518.03 174.81 525.51 171.93 C 530.49 170.02 535.04 166.8 537.71 162.11 C 542.14 154.32 540.31 142.72 533.78 136.73 C 526.79 130.32 516.95 131.36 508.13 131.2 C 488.83 130.83 469.53 131 450.24 131 L 450.24 173.5 Z';
const MERK_GOUD = 'M 124.99 213.92 L 145.06 213.92 L 256.96 21.02 L 237.49 21.02 L 124.99 213.92 Z';
const NAAMREGEL = 'M 35.65 46.63 C 32.15 42.07 30.15 35.7 27.72 30.37 C 26.29 27.24 25.1 24.19 22.23 22.21 L 18.89 22.21 L 32.49 53.07 L 38.47 52.47 L 51.18 22.88 L 49.94 21.4 L 46.79 21.83 L 35.65 46.63 Z M 63.98 52.68 L 66.83 53.08 L 68.89 52.06 L 72.4 45 L 87.83 45 L 92.07 52.5 L 97.15 53.2 L 83.28 22.39 L 78.87 21.13 C 75.78 24.78 74.13 29.35 72.18 33.68 C 69.36 39.96 66.35 46.22 63.98 52.68 Z M 115.06 21.71 L 115.06 53.13 L 119.57 52.49 L 119.57 30.06 C 127.77 35.79 131.38 47.23 139.91 52.98 L 142.9 52.98 C 143.22 47.07 143.01 41.04 143 35.1 C 142.98 30.8 143.29 26.27 142.05 22.14 L 138.7 21.73 L 137.43 44.06 L 119.46 21.71 L 115.06 21.71 Z M 190 53.14 L 194.8 52.45 L 194.8 39 L 213 39 L 213 53.13 L 217.77 52.47 L 217.77 22.19 L 212.99 21.28 L 212.99 35 L 194.9 35 L 194.9 22.49 L 190 21.17 L 190 53.14 Z M 270.6 37.3 A 16.6 16.6 0 1 1 237.4 37.3 A 16.6 16.6 0 1 1 270.6 37.3 Z M 321.61 37.34 A 16.6 16.6 0 1 1 288.41 37.34 A 16.6 16.6 0 1 1 321.61 37.34 Z M 341.08 21.69 L 341.08 52.98 L 346.01 52.98 L 346.01 42.01 L 355.4 42.01 L 362.02 51.85 L 364.21 52.97 L 368.06 52.97 L 360.13 41.3 C 361.73 40.1 364.06 39.11 365.44 37.31 C 368.84 32.86 367.59 25.76 362.42 23.1 C 360.56 22.14 358.12 22.05 356.07 21.82 C 351.14 21.28 345.95 20.83 341.08 21.69 Z M 389 22.35 L 389 53 L 411.95 53 L 411.95 48.99 L 394 48.99 L 394 39.22 L 408.56 35.06 L 394.01 35.06 L 394.01 25.01 L 410.98 25.01 L 410.98 21.21 C 404.19 20.57 395.65 20.8 389 22.35 Z M 431 22.35 L 431 52.9 C 438.72 53.32 447.47 53.79 454.71 50.77 L 456.72 47.99 C 457.37 42.75 455.76 40.42 452.25 36.76 L 455.87 31.17 L 455.87 28.1 L 454.71 25.53 C 448.86 20.22 438.19 20.1 431 22.35 Z M 477 22.34 L 477 53 L 498.95 53 L 498.95 49 L 481.21 49 L 481.21 39.22 L 496.4 35.26 L 481.5 34.42 L 481.5 25.5 C 485.66 25.44 489.84 25.46 494 25.26 C 494.65 25.23 497.59 25.33 497.92 24.63 C 498.18 24.08 497.99 23.32 498.39 22.86 C 496.04 21.53 493.51 21.55 490.74 21.51 C 486.21 21.44 481.34 21.41 477 22.34 Z M 540.92 21.69 L 524 37.09 L 524 21.89 L 519.87 22.4 L 519.87 52.91 L 523.41 52.91 C 524.15 49.65 523.39 45.81 524.79 42.74 C 525.5 41.19 526.94 40.06 528.12 38.89 L 539.81 52.06 L 541.91 52.95 L 546.17 52.48 L 531.22 36.56 L 545.48 21.69 L 540.92 21.69 Z M 565 22.35 L 565 53 L 587.95 53 L 587.95 48.99 L 570 48.99 L 570 39.22 L 584.99 38.15 C 584.62 37.46 584.92 36.57 584.73 35.81 C 584.54 34.98 582.01 35.07 581.41 35.05 C 577.61 34.9 573.78 35.1 570.01 34.9 L 570.01 25 C 574.54 25 579.09 25.09 583.63 24.95 C 584.14 24.94 587.41 25.02 587.54 24.35 C 587.66 23.76 587.2 23.04 587.52 22.52 C 584.91 21.31 582.17 21.4 579.25 21.4 C 574.56 21.41 569.48 21.37 565 22.35 Z M 627.81 24.87 L 629.32 35.45 C 627.55 37.56 625.02 39.1 623.94 41.81 C 621.25 48.57 627.7 53.75 633.96 53.64 C 637.69 53.57 640.5 51.77 643.74 50.3 L 650.74 53.63 L 650.74 51.3 L 646.34 46.91 C 647.24 44.95 648.77 42.96 649.35 40.8 C 649.41 40.58 649.77 38.92 649.39 38.83 C 648.58 38.63 647.59 39.12 646.88 38.68 L 643.68 44.38 L 637.22 36.93 C 639.99 33.68 643.35 31.57 644.01 27.01 L 642.85 24.14 L 636.32 20.37 L 627.81 24.87 Z M 687.21 22.7 L 687.21 25.39 L 706 25.39 C 702.57 31.98 696.71 37.55 692.16 43.47 C 689.93 46.38 687.18 49.26 687 53 L 712.95 53 L 712.95 48.92 L 694.1 48.92 C 697.37 42.57 703.11 37.18 707.52 31.48 C 709.53 28.86 711.73 26.2 712.73 23.14 C 707.82 20.61 700.09 21.59 694.56 21.66 C 692.02 21.7 689.47 21.66 687.21 22.7 Z M 762.23 37.33 A 16.62 16.62 0 1 1 728.99 37.33 A 16.62 16.62 0 1 1 762.23 37.33 Z M 813.37 37.31 A 16.61 16.61 0 1 1 780.15 37.31 A 16.61 16.61 0 1 1 813.37 37.31 Z M 856.97 21.99 L 856.97 43.98 C 848.64 38.92 845.43 27.13 836.82 22.04 L 833 22.04 L 833 52.98 L 838.22 52.98 L 838.22 29.82 C 845.48 36.7 849.94 46.66 858.03 52.95 L 860.97 52.95 L 860.97 21.25 L 856.97 21.99 Z M 632.08 28.22 C 632.06 30.06 632.87 31.56 633.95 32.99 C 634.09 33.18 634.64 34.16 634.86 34.19 C 635.11 34.23 636.02 33.07 636.22 32.87 C 637.48 31.61 639.9 29.68 640 27.74 C 640.09 25.81 637.85 24.02 636.06 24 C 633.7 23.97 632.11 26.01 632.08 28.22 Z M 266.07 37.31 A 12.04 12.04 0 1 1 242 37.31 A 12.04 12.04 0 1 1 266.07 37.31 Z M 317.18 37.3 A 12.11 12.11 0 1 1 292.97 37.3 A 12.11 12.11 0 1 1 317.18 37.3 Z M 346.11 25.57 L 346.11 37.96 C 349.72 38.12 355.56 38.97 358.87 37.27 C 363.37 34.96 364.06 29.1 359.51 26.5 C 355.92 24.45 349.96 24.85 346.11 25.57 Z M 436 34.94 C 439.74 35.21 444.65 35.57 448.19 34.11 C 450.34 33.22 451.8 30.69 450.62 28.44 C 448.22 23.92 440.16 25 436 25 L 436 34.94 Z M 757.64 37.37 A 12.13 12.13 0 1 1 733.38 37.37 A 12.13 12.13 0 1 1 757.64 37.37 Z M 808.76 37.35 A 12.04 12.04 0 1 1 784.68 37.35 A 12.04 12.04 0 1 1 808.76 37.35 Z M 74.06 40.8 L 86.4 41.64 L 80.35 26.27 L 74.06 40.8 Z M 436 49 C 440.53 49 447.27 50.14 450.99 47.07 C 452.8 44.37 451.75 40.7 448.82 39.27 C 445.01 37.41 440.11 38.01 436 38 L 436 49 Z M 641.47 47.07 L 632.46 37.99 C 629.83 40.24 625.83 45.35 629.16 48.76 C 632.27 51.94 638.76 49.33 641.47 47.07 Z';

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
