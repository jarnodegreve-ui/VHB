/**
 * Bus-mascotte voor empty states — versie van het nieuwe VHB-logo
 * zonder de "Van Hoorebeke & Zoon" tekst eronder.
 *
 * Geometry is letterlijk overgenomen uit brand/ (vhb-logo.svg), alleen
 * de text-paths zijn weggelaten. Tight viewBox rond het bus-icoon
 * zelf zodat 't scaled netjes oogt in een empty-state container.
 */
export function BrandBus({
  className,
  width = 160,
  dark = false,
}: {
  className?: string;
  width?: number;
  /** Dark variant: licht bus-lichaam (i.p.v. zwart) zodat 't op een
   *  donkere achtergrond zichtbaar is. Oker accenten blijven gelijk. */
  dark?: boolean;
}) {
  const body = dark ? '#F2F3F4' : '#0D0D0F';      // bus-lichaam + wielrand (VHB Black / Light Grey)
  const wheelHub = dark ? '#0D0D0F' : '#FFFFFF';   // wiel-hart (contrast met rand)
  return (
    <svg
      viewBox="100 55 350 170"
      width={width}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(310 60) scale(0.66) translate(-505 -192)">
        {/* Oker speed-line rechthoeken aan de linkerkant */}
        <rect x="234" y="228" width="96" height="24" rx="12" fill="#E8A33D" />
        <rect x="198" y="276" width="132" height="24" rx="12" fill="#E8A33D" />
        <rect x="234" y="324" width="96" height="24" rx="12" fill="#E8A33D" />
        {/* Bus-lichaam */}
        <rect x="354" y="192" width="360" height="192" rx="33.6" fill={body} />
        {/* Drie oker raampjes */}
        <rect x="392.4" y="228" width="81.6" height="62.4" rx="12" fill="#E8A33D" />
        <rect x="493.2" y="228" width="81.6" height="62.4" rx="12" fill="#E8A33D" />
        <rect x="594" y="228" width="81.6" height="62.4" rx="12" fill="#E8A33D" />
        {/* Twee wielen: bus-kleur rand + contrasterend hart */}
        <circle cx="445.2" cy="400.8" r="33.6" fill={body} />
        <circle cx="445.2" cy="400.8" r="14.4" fill={wheelHub} />
        <circle cx="637.2" cy="400.8" r="33.6" fill={body} />
        <circle cx="637.2" cy="400.8" r="14.4" fill={wheelHub} />
      </g>
    </svg>
  );
}
