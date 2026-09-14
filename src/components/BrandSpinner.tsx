/**
 * Laad-spinner in de vormtaal van het logo: de gouden schuine streep uit het
 * VHB-merk, waar een lichtband van onder naar boven doorheen trekt (zoals de
 * laadstand van BrandLogo). Vervangt de generieke border-draaicirkels op
 * laadmomenten.
 *
 * Geen rotatie: de band loopt via stroke-dashoffset over de as van de streep,
 * geknipt op de streepvorm (pathLength 100, keyframes `vhb-streep-veeg` in
 * index.css). Bewust géén kopie van het logo (geen letters) — dit is een
 * UI-element dat het merk citeert, niet het logo zelf. Zelfde helling als in
 * het merk (30° uit de verticaal).
 */
import { useId } from 'react';

// Parallellogram met dezelfde helling als de streep in het merk: onderrand
// x 6–11 op y 29, bovenrand x 21–26 op y 3.
const STREEP = 'M 6 29 H 11 L 26 3 H 21 Z';
const AS = 'M 7.5 31 L 24.5 1';

export function BrandSpinner({
  size = 16,
  tone = 'licht',
  className,
}: {
  /** Hoogte én breedte in px (vierkant). */
  size?: number;
  /** 'licht' = slate-spoor (lichte vlakken); 'donker' = wit-transparant spoor (carbon/login). */
  tone?: 'licht' | 'donker';
  className?: string;
}) {
  const id = useId();
  const spoor = tone === 'donker' ? 'rgba(255, 255, 255, 0.2)' : 'var(--color-slate-200, #E4E6E8)';
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <clipPath id={id}>
        <path d={STREEP} />
      </clipPath>
      <path d={STREEP} fill={spoor} />
      <path
        d={AS}
        clipPath={`url(#${id})`}
        fill="none"
        stroke="#CAA044"
        strokeWidth={8}
        pathLength={100}
        strokeDasharray="100 100"
        className="vhb-streep-veeg"
      />
    </svg>
  );
}
