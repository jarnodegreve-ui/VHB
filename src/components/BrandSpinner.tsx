/**
 * Laad-spinner in de vormtaal van het logo: een stadium-lus waarover een
 * goud segment reist — zoals de gouden boog in het merk (verbeterronde
 * 30-08, nr. 5). Vervangt de generieke border-draaicirkels op laadmomenten.
 *
 * Geen rotatie van het element zelf (een draaiende ovaal zwalkt): het
 * goudsegment loopt via stroke-dashoffset over een gesloten pad
 * (pathLength 100, keyframes `vhb-lus-loop` in index.css). Bewust géén
 * kopie van het logo (geen onderbreking/monogram) — dit is een UI-element
 * dat het merk citeert, niet het logo zelf.
 */
const PAD = 'M 19 3 H 37 A 13 13 0 0 1 37 29 H 19 A 13 13 0 0 1 19 3 Z';

export function BrandSpinner({
  size = 16,
  tone = 'licht',
  className,
}: {
  /** Hoogte in px; de breedte volgt de lus-verhouding (1,75×). */
  size?: number;
  /** 'licht' = slate-track (lichte vlakken); 'donker' = wit-transparante track (carbon/login). */
  tone?: 'licht' | 'donker';
  className?: string;
}) {
  const track = tone === 'donker' ? 'rgba(255, 255, 255, 0.2)' : 'var(--color-slate-200, #E4E6E8)';
  return (
    <svg viewBox="0 0 56 32" width={size * 1.75} height={size} className={className} aria-hidden="true">
      <path d={PAD} fill="none" stroke={track} strokeWidth={6} />
      <path
        d={PAD}
        fill="none"
        stroke="var(--color-oker-500, #E2A323)"
        strokeWidth={6}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="22 78"
        className="vhb-lus-loop"
      />
    </svg>
  );
}
