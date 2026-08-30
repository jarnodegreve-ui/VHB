/**
 * Bus-mascotte voor empty states, hertekend in de vormtaal van het
 * definitieve logo (verbeterronde 30-08, nr. 6): outline-lichaam zoals de
 * ovale lus, met het gouden segment rechtsboven als merk-citaat, gouden
 * raampjes en speed-lines. Zelfde API als de oude Schakel-versie; wordt op
 * width≈88 gebruikt, dus bewust detailarm.
 */
export function BrandBus({
  className,
  width = 160,
  dark = false,
}: {
  className?: string;
  width?: number;
  /** Dark variant: licht lichaam (i.p.v. carbon) zodat 't op een donkere
   *  achtergrond zichtbaar is. Goud-accenten blijven gelijk. */
  dark?: boolean;
}) {
  const ink = dark ? 'var(--color-slate-100, #F2F3F4)' : 'var(--color-slate-900, #14181B)';
  const goud = 'var(--color-oker-500, #E2A323)';
  const hub = dark ? 'var(--color-slate-900, #14181B)' : '#FFFFFF';
  return (
    <svg viewBox="0 24 352 148" width={width} className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Speed-lines links, zoals voorheen */}
      <rect x="8" y="76" width="52" height="12" rx="6" fill={goud} />
      <rect x="24" y="102" width="36" height="12" rx="6" fill={goud} />
      {/* Lichaam: open outline met het goudsegment rechtsboven (citaat van de
          lus in het logo — inkt stopt vóór de rechterbovenhoek, goud neemt de
          hoek, en de rechterflank blijft even open). */}
      <path
        d="M 286 40 H 118 A 34 34 0 0 0 84 74 V 106 A 34 34 0 0 0 118 140 H 302 A 34 34 0 0 0 336 106 V 98"
        fill="none"
        stroke={ink}
        strokeWidth={12}
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
      <path d="M 298 40 H 302 A 34 34 0 0 1 336 74 V 76" fill="none" stroke={goud} strokeWidth={12} strokeLinecap="butt" />
      {/* Drie gouden raampjes */}
      <rect x="112" y="66" width="38" height="30" rx="8" fill={goud} />
      <rect x="162" y="66" width="38" height="30" rx="8" fill={goud} />
      <rect x="212" y="66" width="38" height="30" rx="8" fill={goud} />
      {/* Wielen op de onderrand: inkt-schijf met contrasterend hart */}
      <circle cx="138" cy="140" r="22" fill={ink} />
      <circle cx="138" cy="140" r="9" fill={hub} />
      <circle cx="282" cy="140" r="22" fill={ink} />
      <circle cx="282" cy="140" r="9" fill={hub} />
    </svg>
  );
}
