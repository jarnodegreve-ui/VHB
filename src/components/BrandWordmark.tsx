import { cn } from '../lib/ui';

/**
 * Type-gebaseerde VHB-wordmark voor login + sidebar:
 *   VHB PORTAAL
 *   VAN HOOREBEKE EN ZOON
 *
 * Pure CSS/typografie — gebruikt EXACT dezelfde classes als de sidebar
 * op het dashboard (brand-wordmark + brand-wordmark-anim + section-title)
 * zodat font + tracking + line-height identiek zijn. Alleen de grootte
 * varieert per `size`-prop.
 */
export function BrandWordmark({
  size = 'lg',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  // Zelfde stijl als sidebar (text-[1.25rem]); voor login een tikje groter
  // maar dichtbij identiek qua proportie.
  const titleSize = {
    sm: 'text-[1.25rem]',   // = 20px (zelfde als sidebar)
    md: 'text-[1.375rem]',  // = 22px
    lg: 'text-[1.625rem]',  // = 26px
  }[size];

  const subSize = {
    sm: 'text-[9px] tracking-[0.2em] mt-0.5',
    md: 'text-[10px] tracking-[0.2em] mt-1',
    lg: 'text-[11px] tracking-[0.22em] mt-1.5',
  }[size];

  return (
    <div className={cn('inline-flex flex-col', className)}>
      <h1
        className={cn(
          'brand-wordmark brand-wordmark-anim section-title text-slate-900 leading-none',
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
