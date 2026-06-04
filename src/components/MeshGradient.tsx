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

      {/* Vier ge-blurde cirkels met traag bewegende posities + scale.
          Elke cirkel = één van de brand-kleuren (oker, indigo, stone, warm-stone). */}
      <g filter={`url(#${filterId})`}>
        {/* Oker — warm linksboven, drift naar midden */}
        <circle r="30" fill="rgba(245, 158, 11, 0.55)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="20;38;28;20" dur="22s" repeatCount="indefinite" />
              <animate attributeName="cy" values="22;30;18;22" dur="22s" repeatCount="indefinite" />
              <animate attributeName="r"  values="30;36;28;30" dur="22s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="20" dur="0s" fill="freeze" /><animate attributeName="cy" values="22" dur="0s" fill="freeze" /></>}
        </circle>

        {/* Indigo — koel rechtsonder, drift naar links */}
        <circle r="32" fill="rgba(99, 102, 241, 0.42)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="82;72;78;82" dur="26s" repeatCount="indefinite" />
              <animate attributeName="cy" values="78;68;84;78" dur="26s" repeatCount="indefinite" />
              <animate attributeName="r"  values="32;38;30;32" dur="26s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="82" dur="0s" fill="freeze" /><animate attributeName="cy" values="78" dur="0s" fill="freeze" /></>}
        </circle>

        {/* Stone — warm rechtsboven, drift verticaal */}
        <circle r="26" fill="rgba(214, 196, 158, 0.45)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="80;72;86;80" dur="28s" repeatCount="indefinite" />
              <animate attributeName="cy" values="18;28;22;18" dur="28s" repeatCount="indefinite" />
              <animate attributeName="r"  values="26;30;24;26" dur="28s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="80" dur="0s" fill="freeze" /><animate attributeName="cy" values="18" dur="0s" fill="freeze" /></>}
        </circle>

        {/* Soft accent — diep oker, kleinere blob, drijft door midden */}
        <circle r="18" fill="rgba(180, 83, 9, 0.25)">
          {!reducedMotion && (
            <>
              <animate attributeName="cx" values="30;60;40;30" dur="32s" repeatCount="indefinite" />
              <animate attributeName="cy" values="68;55;72;68" dur="32s" repeatCount="indefinite" />
              <animate attributeName="r"  values="18;24;16;18" dur="32s" repeatCount="indefinite" />
            </>
          )}
          {reducedMotion && <><animate attributeName="cx" values="30" dur="0s" fill="freeze" /><animate attributeName="cy" values="68" dur="0s" fill="freeze" /></>}
        </circle>
      </g>
    </svg>
  );
}
