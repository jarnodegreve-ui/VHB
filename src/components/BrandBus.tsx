/**
 * Inline SVG van de VHB-busje-mascotte. Past de brand-DNA toe:
 * - Wit lichaam met subtiele oker accent-strepen
 * - "VANHOOREBEKE" rolling-sign bovenop
 * - Yellow line onder voor speelse beweging
 *
 * Gebruik als brand-mascotte in empty states. Schaalbaar via width-prop.
 */
export function BrandBus({ className, width = 160 }: { className?: string; width?: number }) {
  return (
    <svg
      viewBox="0 0 280 140"
      width={width}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Subtle ground shadow */}
      <ellipse cx="140" cy="130" rx="115" ry="6" fill="rgba(15, 23, 42, 0.08)" />

      {/* Bus body */}
      <g>
        {/* Main rectangle */}
        <rect
          x="20"
          y="34"
          width="240"
          height="78"
          rx="14"
          fill="#ffffff"
          stroke="#0f172a"
          strokeWidth="2.2"
        />
        {/* Rolling sign at top */}
        <rect x="38" y="20" width="184" height="16" rx="4" fill="#0f172a" />
        <text
          x="130"
          y="32"
          textAnchor="middle"
          fontSize="9"
          fontWeight="800"
          fill="#fbbf24"
          letterSpacing="0.08em"
          fontFamily="Manrope, system-ui, sans-serif"
        >
          VANHOOREBEKE
        </text>

        {/* Front windshield (right side) */}
        <path
          d="M230 50 Q252 50 252 72 L252 92 Q252 102 244 102 L230 102 Z"
          fill="#cbd5e1"
          stroke="#0f172a"
          strokeWidth="2.2"
        />
        {/* Driver silhouette */}
        <circle cx="240" cy="78" r="6" fill="#475569" />
        <rect x="234" y="84" width="12" height="14" rx="3" fill="#475569" />

        {/* Side windows */}
        <rect x="36" y="48" width="34" height="22" rx="3" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.4" />
        <rect x="74" y="48" width="34" height="22" rx="3" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.4" />
        <rect x="112" y="48" width="34" height="22" rx="3" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.4" />
        <rect x="150" y="48" width="34" height="22" rx="3" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.4" />
        <rect x="188" y="48" width="34" height="22" rx="3" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.4" />

        {/* Yellow accent stripe under windows */}
        <rect x="36" y="74" width="186" height="3" fill="#fbbf24" />

        {/* Door */}
        <rect x="36" y="80" width="14" height="28" rx="2" fill="#e2e8f0" stroke="#0f172a" strokeWidth="1.4" />
        <line x1="43" y1="82" x2="43" y2="106" stroke="#0f172a" strokeWidth="1.2" />

        {/* Yellow accent square (brand) */}
        <rect x="56" y="86" width="14" height="14" rx="2" fill="#fbbf24" />

        {/* "MAN" badge */}
        <text x="135" y="106" textAnchor="middle" fontSize="6" fontWeight="800" fill="#0f172a" fontFamily="Manrope, system-ui, sans-serif">
          MAN
        </text>

        {/* Wheels */}
        <circle cx="76" cy="118" r="13" fill="#0f172a" />
        <circle cx="76" cy="118" r="5" fill="#475569" />
        <circle cx="204" cy="118" r="13" fill="#0f172a" />
        <circle cx="204" cy="118" r="5" fill="#475569" />
      </g>

      {/* Yellow ground line */}
      <line x1="14" y1="134" x2="266" y2="134" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Subtle "wuif"-animatie (kleine sway). Plak op de SVG-container.
 * Wordt automatisch uitgezet bij prefers-reduced-motion.
 */
export const BUS_SWAY_CSS = `
  @keyframes bus-sway {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50%      { transform: translateY(-3px) rotate(-1deg); }
  }
  .bus-sway {
    animation: bus-sway 4s ease-in-out infinite;
    transform-origin: center bottom;
  }
  @media (prefers-reduced-motion: reduce) {
    .bus-sway { animation: none; }
  }
`;
