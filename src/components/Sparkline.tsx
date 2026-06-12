import { useId } from 'react';
/**
 * Sparkline — kleine inline-SVG trendlijn voor KPI-tegels.
 * Lichtgewicht, geen chart-library nodig. Toont een 30-day trend.
 *
 * Default: 14 points, 80x28px. Aanpasbaar via props.
 */
export function Sparkline({
  data,
  width = 80,
  height = 28,
  color = 'currentColor',
  fillOpacity = 0.18,
  strokeWidth = 1.5,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  className?: string;
}) {
  // SVG-ids zijn document-globaal: een gedeeld id liet alle sparklines de
  // gradient-kleur van de eerste instantie gebruiken.
  const gradientId = useId();
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  // Padding boven/onder zodat extreme punten niet aan de rand kleven
  const padY = 3;
  const usableH = height - padY * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = padY + (1 - (v - min) / range) * usableH;
    return [x, y] as const;
  });

  const pathD = points
    .map(([x, y], i) => (i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `L ${x.toFixed(1)} ${y.toFixed(1)}`))
    .join(' ');

  const fillD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  const lastPoint = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradientId})`} />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End-dot voor het laatste data-punt */}
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r={2.2} fill={color} />
    </svg>
  );
}
