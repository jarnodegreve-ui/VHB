import { cn } from '../lib/ui';

/**
 * Type-gebaseerde VHB-wordmark voor login + sidebar:
 *   VHB PORTAAL
 *   VAN HOOREBEKE EN ZOON
 *
 * Pure CSS/typografie — geen afbeelding nodig. Past zich aan via `size`.
 */
export function BrandWordmark({
  size = 'lg',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const titleSize = {
    sm: 'text-xl',
    md: 'text-2xl',
    lg: 'text-3xl',
  }[size];

  const subSize = {
    sm: 'text-[9px] tracking-[0.18em] mt-1.5',
    md: 'text-[10px] tracking-[0.22em] mt-2',
    lg: 'text-[11px] tracking-[0.24em] mt-2',
  }[size];

  return (
    <div className={cn('inline-flex flex-col', className)}>
      <h1
        className={cn(
          'brand-wordmark brand-wordmark-anim leading-none text-slate-900',
          titleSize,
        )}
      >
        VHB <span className="brand-accent text-oker-500">PORTAAL</span>
      </h1>
      <p
        className={cn(
          'font-bold text-slate-400 uppercase',
          subSize,
        )}
      >
        Van Hoorebeke en Zoon
      </p>
    </div>
  );
}
