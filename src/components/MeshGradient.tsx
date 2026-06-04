import { useId } from 'react';

/**
 * Animated SVG mesh gradient — vervangt de oude CSS radial-blob aurora.
 *
 * Werkt door 4 grote ge-blurde cirkels te animeren met SMIL (SVG-native
 * animaties). Voordeel boven CSS-gradiënten: véél vloeiendere overgangen,
 * geen rasterized halos, en de blur loopt in screen-space dus blijft scherp
 * op alle zoom-niveau's. Stripe/Linear-stijl mesh.
 *
 * Performance: GPU-accelerated via filter:blur + animateTransform.
 * Geen Date.now / new Date — alle animaties zijn declaratief in de SVG.
 * Volledig statisch bij prefers-reduced-motion (geen animateTransform).
 */
export function MeshGradient({
  className,
  reducedMotion = false,
}: {
  className?: string;
  /** Skip animaties (bv. voor prefers-reduced-motion users). */
  reducedMotion?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const filterId = `mesh-blur-${id}`;

  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Heavy blur via filter — geeft het organische mesh-effect.
            stdDeviation in user-coords (0-100 viewBox = 0-100% van canvas) */}
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      {/* Vier ge-blurde cirkels met VHB-brand-palette:
          - Oker (hoofdkleur)          → bright warm
          - Diep amber (oker-700)      → diepte zonder koudte
          - Cream (oker-50/100)        → zachte warmth, lighter touch
          - Donker antraciet/zwart     → subtle anchor (zoals zwart op de bus) */}
      <g filter={`url(#${filterId})`}>
        {/* Bright oker — warm linksboven, drift naar midden */}
        <circle r="32" fill="rgba(245, 158, 11, 0.55)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="20;38;28;20" dur="22s" repeatCount="indefinite" />
              <animate attributeName="cy" values="22;30;18;22" dur="22s" repeatCount="indefinite" />
              <animate attributeName="r"  values="32;38;30;32" dur="22s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="20" dur="0s" fill="freeze" /><animate attributeName="cy" values="22" dur="0s" fill="freeze" /></>}
        </circle>

        {/* Deep amber (oker-700 #b45309) — diepte rechtsonder, vervangt indigo */}
        <circle r="32" fill="rgba(180, 83, 9, 0.42)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="82;72;78;82" dur="26s" repeatCount="indefinite" />
              <animate attributeName="cy" values="78;68;84;78" dur="26s" repeatCount="indefinite" />
              <animate attributeName="r"  values="32;38;30;32" dur="26s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="82" dur="0s" fill="freeze" /><animate attributeName="cy" values="78" dur="0s" fill="freeze" /></>}
        </circle>

        {/* Soft cream (oker-100 #fef3c7) — lichte warmth rechtsboven */}
        <circle r="28" fill="rgba(254, 243, 199, 0.55)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="80;72;86;80" dur="28s" repeatCount="indefinite" />
              <animate attributeName="cy" values="18;28;22;18" dur="28s" repeatCount="indefinite" />
              <animate attributeName="r"  values="28;34;26;28" dur="28s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="80" dur="0s" fill="freeze" /><animate attributeName="cy" values="18" dur="0s" fill="freeze" /></>}
        </circle>

        {/* Antraciet anker — knipoog naar het zwart op de bus, grounds the
            warme palette met een koel tegenwicht zonder felle indigo */}
        <circle r="20" fill="rgba(30, 41, 59, 0.18)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="30;60;40;30" dur="32s" repeatCount="indefinite" />
              <animate attributeName="cy" values="68;55;72;68" dur="32s" repeatCount="indefinite" />
              <animate attributeName="r"  values="20;26;18;20" dur="32s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="30" dur="0s" fill="freeze" /><animate attributeName="cy" values="68" dur="0s" fill="freeze" /></>}
        </circle>
      </g>
    </svg>
  );
}
